// Netlify Function: weekly graduation report.
//
// Cron-triggered (every ~15 min). Finds every class where:
//   - graduation_report_sent_at IS NULL, AND
//   - every enrolled trainee has a submitted test_attempt (submitted_at set)
// Then for each one:
//   1. Builds an HTML report (roster, attendance days, test score, platform setup)
//   2. Renders it to PDF via PDFShift (same pattern as ccg-claims-docs/generate-weekly-report-pdf.js)
//   3. Emails the PDF as an attachment to every subscriber of the
//      'graduation_class_report' event
//   4. Stamps graduation_report_sent_at on the class so it doesn't refire
//
// Also supports POST { class_id } for an immediate manual fire (bypasses the
// "all tests submitted" check — useful for testing or one-off generation).
//
// Required env vars: SUPABASE_URL, SUPABASE_SECRET_KEY, RESEND_API_KEY,
// PDFSHIFT_API_KEY, CRON_SECRET. Optional: EMAIL_FROM.
//
// GET auth: ?secret=<CRON_SECRET> or X-Cron-Secret header
// POST: { class_id: 'uuid' } — no secret needed (admin UI is implicit auth)
// Query params: ?dry_run=1 — preview without sending or stamping

import { createClient } from '@supabase/supabase-js'
import { recipientsForEvent } from './_recipients.js'
import { sendEmail } from './_email.js'
import { sendSmsViaGhl } from './_ghl.js'
import { buildReportHtml, renderPdf, filenameFor, formatDateRange } from './_graduation_pdf.js'

export const handler = async (event) => {
  const isPost = event.httpMethod === 'POST'

  if (!isPost) {
    const provided =
      event.headers['x-cron-secret'] ||
      event.headers['X-Cron-Secret'] ||
      event.queryStringParameters?.secret
    if (!process.env.CRON_SECRET || provided !== process.env.CRON_SECRET) {
      return json(401, { error: 'Unauthorized' })
    }
  }

  const missing = []
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY']) {
    if (!process.env[k]) missing.push(k)
  }
  if (missing.length) return json(500, { error: `Missing env vars: ${missing.join(', ')}` })

  const params = event.queryStringParameters || {}
  const dryRun = params.dry_run === '1' || params.dry_run === 'true'

  let targetClassId = null
  if (isPost) {
    try {
      const body = JSON.parse(event.body || '{}')
      targetClassId = body.class_id || null
    } catch {
      return json(400, { error: 'Invalid JSON body' })
    }
    if (!targetClassId) return json(400, { error: 'class_id required for POST' })
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  // Pull classes that haven't been reported yet.
  // Cron mode (no targetClassId) filters out already-stamped classes
  // so we don't spam on every run. POST mode with a class_id bypasses
  // that filter so admins can manually re-send a report (e.g. recover
  // from a Resend outage that pre-dated the stamping fix). Also
  // bypasses the attendance_only=false filter since admin explicitly
  // chose this class.
  let query = supabase
    .from('classes')
    .select(`
      id, region, week_start_date, week_end_date,
      locations(name, street_address, city, state, zip),
      trainees!class_id(
        id, first_name, last_name, company_email, enrolled, region,
        phone, street_address, city, state, zip,
        repcard_setup_at, jobnimbus_setup_at, sales_academy_setup_at,
        attendance(attendance_date, confirmed),
        test_attempts(submitted_at, retention_pct, correct_count, total_mc)
      )
    `)
  if (targetClassId) {
    query = query.eq('id', targetClassId)
  } else {
    query = query
      .is('graduation_report_sent_at', null)
      .eq('attendance_only', false)
  }
  const { data: classes, error: clsErr } = await query
  if (clsErr) return json(500, { error: `Supabase: ${clsErr.message}` })

  const eligible = (classes || []).filter((c) => {
    const enrolled = (c.trainees || []).filter((t) => t.enrolled !== false)
    if (enrolled.length === 0) return false
    if (targetClassId) return true // manual fire bypasses the test-done check
    return enrolled.every((t) => (t.test_attempts || []).some((a) => a.submitted_at))
  })

  if (eligible.length === 0) {
    return json(200, {
      checked: (classes || []).length,
      eligible: 0,
      message: targetClassId ? 'Class not found or no enrolled trainees.' : 'No classes ready yet.',
    })
  }

  // Look up recipients ONCE — same subscriber list for every class today.
  const { recipients, source } = await recipientsForEvent(supabase, 'graduation_class_report', {})
  const emailRecipients = recipients.filter((r) => r.notify_via_email && r.email)

  if (emailRecipients.length === 0) {
    return json(200, {
      checked: (classes || []).length,
      eligible: eligible.length,
      warning:
        'No subscribers to graduation_class_report event with email enabled. Add a person on /notifications, check the "Graduating class report" event for them, and make sure their email channel is on.',
      source,
      recipient_count_raw: recipients.length, // before email/channel filter
      // Echo back what we found so the UI can show a concrete reason
      recipients_diagnostic: recipients.map((r) => ({
        name: r.name,
        has_email: !!r.email,
        email_channel_on: !!r.notify_via_email,
      })),
    })
  }

  const results = []
  for (const cls of eligible) {
    const html = buildReportHtml(cls)
    let pdfBase64 = null
    if (!dryRun) {
      const pdfRes = await renderPdf(html)
      if (!pdfRes.ok) {
        results.push({
          class_id: cls.id,
          region: cls.region,
          fired: false,
          error: `PDF render failed: ${pdfRes.error}`,
        })
        continue
      }
      pdfBase64 = pdfRes.base64
    }

    const dateLabel = formatDateRange(cls.week_start_date, cls.week_end_date)
    const subject = `Graduating training week of ${dateLabel}`
    const filename = filenameFor(cls)
    const locationName = cls.locations?.name || `${cls.region} — TBD`
    // "Graduate" = enrolled AND submitted the final test. Matches the
    // same filter buildReportHtml uses, so the email body number always
    // agrees with the row count in the attached PDF.
    const graduates = (cls.trainees || [])
      .filter((t) => t.enrolled !== false)
      .filter((t) => (t.test_attempts || []).some((a) => a.submitted_at))
    const body =
      `Attached is the graduating class report for ${cls.region} · ${locationName} (week of ${dateLabel}).\n\n` +
      `${graduates.length} graduate${graduates.length === 1 ? '' : 's'}.\n\n` +
      `— Training System`

    if (dryRun) {
      results.push({
        class_id: cls.id,
        region: cls.region,
        location: locationName,
        graduates: graduates.length,
        dry_run: true,
        preview_subject: subject,
        preview_filename: filename,
      })
      continue
    }

    const attachments = [{ filename, content: pdfBase64 }]
    // Parallelize the sends so we don't blow past Netlify's per-request
    // timeout when there are several subscribers. Resend handles
    // concurrent calls fine.
    const sendResults = await Promise.all(
      emailRecipients.map((r) =>
        sendEmail(r.email, subject, body, { attachments }).then((s) => ({ r, s })),
      ),
    )
    let sentCount = 0
    const sendErrors = []
    for (const { r, s } of sendResults) {
      if (s.ok) sentCount++
      else sendErrors.push({ recipient: r.name, email: r.email, error: s.error, step: s.step })
    }

    // Only stamp when at least ONE email actually delivered. If every
    // send failed (Resend rejected, bad sender, recipient bounced, etc.)
    // leaving graduation_report_sent_at null means the next cron run —
    // OR a manual re-send from the Class detail page — will retry.
    // This used to stamp unconditionally; we'd silently mark "sent" even
    // when nobody got the email.
    if (sentCount > 0) {
      await supabase
        .from('classes')
        .update({ graduation_report_sent_at: new Date().toISOString() })
        .eq('id', cls.id)
    }

    // Manager rep-handoff SMS — fires at the same moment the report goes
    // out. Group the new grads by zone and text each zone's regional
    // manager a link to a handoff page scoped to their team (tap a name →
    // save the rep's vCard; instructions to call/congratulate + set up
    // sales & inspection ride-alongs). Best-effort; never blocks the report.
    let handoffResult = null
    if (sentCount > 0) {
      try {
        handoffResult = await fireManagerHandoff(supabase, cls, graduates)
      } catch (e) {
        handoffResult = { ok: false, error: e.message }
      }
    }

    // Fire-and-forget Facebook post celebrating the graduation. Generic copy,
    // optional venue photo. Best-effort — never blocks the report email.
    let socialResult = null
    try {
      const siteBase = (process.env.PUBLIC_SITE_URL || process.env.URL || '').replace(/\/$/, '')
      if (siteBase) {
        const sr = await fetch(`${siteBase}/.netlify/functions/post-social-graduation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ class_id: cls.id }),
        })
        socialResult = await sr.json().catch(() => null)
      }
    } catch {
      // swallow — Facebook is gravy, not the headline action
    }

    results.push({
      class_id: cls.id,
      region: cls.region,
      location: locationName,
      graduates: graduates.length,
      sent_count: sentCount,
      recipient_count: emailRecipients.length,
      facebook: socialResult,
      manager_handoff: handoffResult,
      ...(sendErrors.length ? { errors: sendErrors } : {}),
    })
  }

  return json(200, {
    checked: (classes || []).length,
    eligible: eligible.length,
    fired: results.filter((r) => r.sent_count !== undefined).length,
    recipients_source: source,
    results,
  })
}

// PDF builder + renderer + phone/address/date helpers all live in
// _graduation_pdf.js so download-graduation-report.js can reuse them
// without duplicating ~150 lines.

// Zone → team name. Mirrors src/lib/zones.js ZONE_TEAMS (functions can't
// import from src/). Kept in lock-step with _graduation_pdf.js.
const ZONE_TEAMS = { 'Zone 1': 'SQUAD', 'Zone 2': 'SitSold', 'Zone 3': 'SHARKS', 'Zone 4': 'HURRICANE' }

// Group the class's graduates by zone, then text each zone's regional
// manager a link to their team-scoped handoff page. Returns a per-zone
// summary so the cron response shows who got notified.
async function fireManagerHandoff(supabase, cls, graduates) {
  const siteBase = (process.env.PUBLIC_SITE_URL || process.env.URL || 'https://trainingmanagementsys.netlify.app')
    .replace(/\/$/, '')

  // Grads with no zone of their own inherit the class region.
  const byZone = {}
  for (const t of graduates) {
    const zone = t.region || cls.region || ''
    if (!zone) continue
    ;(byZone[zone] = byZone[zone] || []).push(t)
  }
  const zones = Object.keys(byZone)
  if (zones.length === 0) return { ok: true, zones: [], note: 'No graduates had a zone to route by.' }

  // One lookup for every regional manager → keyed by the zone they manage.
  const { data: managers } = await supabase
    .from('trainees')
    .select('first_name, last_name, phone, email, managed_region')
    .not('managed_region', 'is', null)
  const managerByZone = {}
  for (const m of managers || []) managerByZone[m.managed_region] = m

  const out = []
  for (const zone of zones) {
    const grads = byZone[zone]
    const team = ZONE_TEAMS[zone] ? `${ZONE_TEAMS[zone]} (${zone})` : zone
    const mgr = managerByZone[zone]
    if (!mgr || (!mgr.phone && !mgr.email)) {
      out.push({ zone, team, graduates: grads.length, sent: false, reason: mgr ? 'manager has no phone/email on file' : 'no manager assigned to this zone' })
      continue
    }
    const link = `${siteBase}/handoff?class_id=${encodeURIComponent(cls.id)}&zone=${encodeURIComponent(zone)}`
    const n = grads.length
    // Roster of each new rep with their phone, so the manager can call right
    // away without having to open the handoff page first.
    const roster = grads.map((g) => {
      const name = `${g.first_name || ''} ${g.last_name || ''}`.trim() || 'New rep'
      return g.phone ? `• ${name} — ${g.phone}` : `• ${name} (no phone on file)`
    }).join('\n')

    const smsBody =
      `🎓 ${n} new rep${n === 1 ? '' : 's'} just graduated on your team, ${team}!\n\n` +
      `Call ${n === 1 ? 'them' : 'each one'} now to welcome ${n === 1 ? 'them' : 'them'}:\n${roster}\n\n` +
      `Then plan a ride-along on sales AND inspections. Save their contacts: ${link}`
    const emailBody =
      `${mgr.first_name || 'Manager'},\n\n` +
      `${n} new rep${n === 1 ? '' : 's'} just graduated onto your team — ${team}.\n\n` +
      `Please call ${n === 1 ? 'them' : 'each of them'} right away to welcome ${n === 1 ? 'them' : 'them'} aboard:\n\n` +
      `${roster}\n\n` +
      `Next step: set up a plan to ride along with ${n === 1 ? 'them' : 'each of them'} on both a sales day and an inspection.\n\n` +
      `You can also tap here to see them all and save their contacts to your phone:\n${link}`

    const channels = []
    const errs = []
    if (mgr.phone) {
      const sms = await sendSmsViaGhl(mgr.phone, smsBody, { firstName: mgr.first_name, lastName: mgr.last_name })
      if (sms.ok) channels.push('sms'); else errs.push('sms: ' + (sms.error || sms.step || 'failed'))
    }
    if (mgr.email) {
      try {
        const r = await sendEmail(mgr.email, `${n} new rep${n === 1 ? '' : 's'} on your team — call to welcome ${n === 1 ? 'them' : 'them'}`, emailBody)
        if (r && r.ok !== false) channels.push('email'); else errs.push('email: ' + (r?.error || 'failed'))
      } catch (e) { errs.push('email: ' + (e.message || 'error')) }
    }
    out.push({ zone, team, graduates: n, manager: `${mgr.first_name || ''} ${mgr.last_name || ''}`.trim(), channels, sent: channels.length > 0, ...(errs.length ? { errors: errs } : {}) })
  }
  return { ok: true, zones: out }
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
