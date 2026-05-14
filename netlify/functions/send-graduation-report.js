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
    .is('graduation_report_sent_at', null)
  if (targetClassId) query = query.eq('id', targetClassId)
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

    // Stamp regardless — partial failure beats spamming on the next cron.
    await supabase
      .from('classes')
      .update({ graduation_report_sent_at: new Date().toISOString() })
      .eq('id', cls.id)

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
function buildReportHtml(cls) {
  const enrolled = (cls.trainees || [])
    .filter((t) => t.enrolled !== false)
    .sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`))
  const locationName = esc(cls.locations?.name || `${cls.region || 'Region'} — TBD`)
  const region = esc(cls.region || '')
  const weekLabel = formatDateRange(cls.week_start_date, cls.week_end_date)

  // Totals only — no per-trainee scores or platform status.
  const totalGraduates = enrolled.length
  const totalDaysAttended = enrolled.reduce(
    (acc, t) => acc + (t.attendance || []).filter((a) => a.confirmed).length,
    0,
  )

  const rows = enrolled
    .map((t, i) => {
      const attendance = (t.attendance || []).filter((a) => a.confirmed).length
      const phone = formatPhone(t.phone)
      const address = formatAddress(t.street_address, t.city, t.state, t.zip)
      return `
        <tr>
          <td style="text-align:center;color:#94a3b8;">${i + 1}</td>
          <td>
            <div style="font-weight:600;">${esc(t.first_name)} ${esc(t.last_name)}</div>
            ${phone ? `<div style="color:#64748b;font-size:11px;margin-top:2px;">${esc(phone)}</div>` : ''}
          </td>
          <td style="color:#334155;font-size:11px;">${esc(address) || '<span style="color:#94a3b8;">—</span>'}</td>
          <td style="font-size:11px;">${esc(t.company_email || '—')}</td>
          <td style="text-align:center;">${attendance}</td>
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
  .stats { display: flex; gap: 12px; margin: 0 0 16px; }
  .stat { flex: 1; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px; background: #f8fafc; }
  .stat .num { font-size: 22px; font-weight: 700; color: #13294b; }
  .stat .lbl { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #13294b; color: white; text-align: left; padding: 8px 10px; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
  td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; }
  tr:nth-child(even) td { background: #f8fafc; }
  .footer { margin-top: 18px; color: #94a3b8; font-size: 10px; }
</style>
</head>
<body>
  <div class="stripe"></div>
  <h1>Graduating class — ${region}</h1>
  <p class="subtitle">${locationName} · Week of ${esc(weekLabel)}</p>

  <div class="stats">
    <div class="stat"><div class="num">${totalGraduates}</div><div class="lbl">Graduates</div></div>
    <div class="stat"><div class="num">${totalDaysAttended}</div><div class="lbl">Total days attended</div></div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="text-align:center;width:28px;">#</th>
        <th style="width:25%;">Name &amp; phone</th>
        <th style="width:32%;">Home address</th>
        <th style="width:28%;">Company email</th>
        <th style="text-align:center;width:60px;">Days</th>
      </tr>
    </thead>
    <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:20px;">No enrolled trainees</td></tr>'}</tbody>
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
