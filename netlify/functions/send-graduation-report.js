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
      trainees(
        id, first_name, last_name, company_email, enrolled,
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
        'No subscribers to graduation_class_report event with email enabled. Add one in /notifications.',
      source,
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
    const filename = `graduating-class-${(cls.region || 'class').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}-${cls.week_start_date}.pdf`
    const locationName = cls.locations?.name || `${cls.region} — TBD`
    const enrolled = (cls.trainees || []).filter((t) => t.enrolled !== false)
    const body =
      `Attached is the graduating class report for ${cls.region} · ${locationName} (week of ${dateLabel}).\n\n` +
      `${enrolled.length} graduate${enrolled.length === 1 ? '' : 's'}.\n\n` +
      `— Training System`

    if (dryRun) {
      results.push({
        class_id: cls.id,
        region: cls.region,
        location: locationName,
        graduates: enrolled.length,
        dry_run: true,
        preview_subject: subject,
        preview_filename: filename,
      })
      continue
    }

    const attachments = [{ filename, content: pdfBase64 }]
    let sentCount = 0
    const sendErrors = []
    for (const r of emailRecipients) {
      const s = await sendEmail(r.email, subject, body, { attachments })
      if (s.ok) sentCount++
      else sendErrors.push({ recipient: r.name, error: s.error, step: s.step })
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
      graduates: enrolled.length,
      sent_count: sentCount,
      recipient_count: emailRecipients.length,
      facebook: socialResult,
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

// ── PDF render via PDFShift ──────────────────────────────────────────────
async function renderPdf(html) {
  const key = process.env.PDFSHIFT_API_KEY
  if (!key) return { ok: false, error: 'PDFSHIFT_API_KEY not set' }
  try {
    const res = await fetch('https://api.pdfshift.io/v3/convert/pdf', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from(`api:${key}`).toString('base64'),
      },
      body: JSON.stringify({ source: html, format: 'Letter' }),
    })
    if (!res.ok) {
      const err = await res.text()
      return { ok: false, error: `PDFShift ${res.status}: ${err.slice(0, 300)}` }
    }
    const buf = await res.arrayBuffer()
    const base64 = Buffer.from(buf).toString('base64')
    // Magic bytes — PDF must start with %PDF-
    if (!base64.startsWith('JVBERi')) {
      return { ok: false, error: 'PDFShift returned non-PDF content' }
    }
    return { ok: true, base64 }
  } catch (err) {
    return { ok: false, error: err.message || 'Unknown' }
  }
}

// ── HTML builder ─────────────────────────────────────────────────────────
// Minimal-info graduation roster: just the headcount + a contact-info
// table (name, phone, home address). Per user request — no test scores,
// no days attended, no company email, no platform setup status.
// Leadership uses this to know who graduated and how to reach them.
function buildReportHtml(cls) {
  const enrolled = (cls.trainees || [])
    .filter((t) => t.enrolled !== false)
    .sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`))
  const locationName = esc(cls.locations?.name || `${cls.region || 'Region'} — TBD`)
  const region = esc(cls.region || '')
  const weekLabel = formatDateRange(cls.week_start_date, cls.week_end_date)

  const totalGraduates = enrolled.length

  const rows = enrolled
    .map((t, i) => {
      const phone = formatPhone(t.phone)
      const address = formatAddress(t.street_address, t.city, t.state, t.zip)
      return `
        <tr>
          <td style="text-align:center;color:#94a3b8;width:32px;">${i + 1}</td>
          <td><div style="font-weight:600;">${esc(t.first_name)} ${esc(t.last_name)}</div></td>
          <td style="white-space:nowrap;">${phone ? esc(phone) : '<span style="color:#94a3b8;">—</span>'}</td>
          <td style="color:#334155;">${esc(address) || '<span style="color:#94a3b8;">—</span>'}</td>
        </tr>
      `
    })
    .join('')

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; color: #0f172a; margin: 0; padding: 24px; }
  h1 { color: #13294b; font-size: 22px; margin: 0 0 4px; }
  .subtitle { color: #475569; font-size: 13px; margin: 0 0 16px; }
  .stripe { height: 4px; background: #b8324f; margin: 0 0 16px; }
  .headcount { display: inline-block; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 16px; background: #f8fafc; margin: 0 0 16px; }
  .headcount .num { font-size: 28px; font-weight: 700; color: #13294b; }
  .headcount .lbl { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-left: 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #13294b; color: white; text-align: left; padding: 8px 10px; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
  td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  tr:nth-child(even) td { background: #f8fafc; }
  .footer { margin-top: 18px; color: #94a3b8; font-size: 10px; }
</style>
</head>
<body>
  <div class="stripe"></div>
  <h1>Graduating class — ${region}</h1>
  <p class="subtitle">${locationName} · Week of ${esc(weekLabel)}</p>

  <div class="headcount">
    <span class="num">${totalGraduates}</span><span class="lbl">graduate${totalGraduates === 1 ? '' : 's'}</span>
  </div>

  <table>
    <thead>
      <tr>
        <th style="text-align:center;width:32px;">#</th>
        <th style="width:30%;">Name</th>
        <th style="width:22%;">Phone</th>
        <th>Home address</th>
      </tr>
    </thead>
    <tbody>${rows || '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:20px;">No enrolled trainees</td></tr>'}</tbody>
  </table>

  <p class="footer">Generated ${new Date().toLocaleString('en-US')} · U.S. Shingle &amp; Metal Training System</p>
</body></html>`
}

// Pretty-print a phone number. Accepts whatever the trainee typed:
//   "5551234567" → "(555) 123-4567"
//   "+15551234567" → "(555) 123-4567"
//   anything else → returned as-is (don't mangle good input).
function formatPhone(raw) {
  if (!raw) return ''
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  return String(raw)
}

// Build a single-line address: "123 Main St, Tampa, FL 33602"
// Skips parts the trainee didn't fill in.
function formatAddress(street, city, state, zip) {
  const cityStateZip = [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return [street, cityStateZip].filter(Boolean).join(', ')
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatDateRange(startIso, endIso) {
  if (!startIso) return ''
  const start = new Date(startIso + 'T12:00:00')
  const end = endIso ? new Date(endIso + 'T12:00:00') : null
  const sFmt = { month: 'short', day: 'numeric' }
  const eFmt = { month: 'short', day: 'numeric', year: 'numeric' }
  if (!end || start.getTime() === end.getTime()) {
    return start.toLocaleDateString('en-US', eFmt)
  }
  const sameMonth = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()
  if (sameMonth) {
    return `${start.toLocaleDateString('en-US', sFmt)} – ${end.getDate()}, ${end.getFullYear()}`
  }
  return `${start.toLocaleDateString('en-US', sFmt)} – ${end.toLocaleDateString('en-US', eFmt)}`
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
