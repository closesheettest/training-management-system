// Weekly Rep Report API — backs the "Weekly Report" panel on the public
// /regional-manager/:token dashboard.
//
// Each Thursday evening a regional manager is texted a reminder to complete a
// weekly report on their crew, due Friday morning. The report is ONE row per
// active sales rep in their zone, all numbers typed by hand:
//   • inspections signed   • back-to-retail appts   • total appts   • sales
//   • did the manager ride with them? (yes/no)  • if yes, their take (text)
// plus a free-text weekly summation for the whole zone.
//
// On submit the report is saved (one per zone+week), AND a summary is emailed
// and texted to ownership (see SUMMARY recipients), AND it stays viewable on
// the dashboard as weekly history.
//
// Auth: the same token as the rest of the regional dashboard — the manager's
// trainees.manager_access_token → managed_region. Everything is scoped to that
// zone server-side; a manager can't read or write another zone's report.
//
// Actions (POST { action, token, ... }):
//   'init'    → { ok, manager:{name,zone}, reps:[{id,name}], week_start,
//                 report:{rows,summary,status,submitted_at}|null }
//   'save'    { week_start, rows, summary }            → save a draft
//   'submit'  { week_start, rows, summary }            → save + send summary
//   'history' → { ok, reports:[{week_start,status,submitted_at,rows,summary}] }
//
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY. Optional recipients: a
//   notification_recipients row subscribed to 'weekly_manager_report', else
//   the FALLBACK list below (env NEAL_PHONE / DEWAYNE_EMAIL / DEWAYNE_PHONE).

import { createClient } from '@supabase/supabase-js'
import { recipientsForEvent } from './_recipients.js'
import { sendSmsViaGhl } from './_ghl.js'
import { sendEmail } from './_email.js'

const SB_URL = process.env.SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SECRET_KEY

// Who gets the submitted-report summary (email + SMS) when notification_recipients
// has nobody subscribed to 'weekly_manager_report'. Neal's email is known; the
// rest read from env so they can be set without a code change.
const FALLBACK_SUMMARY_RECIPIENTS = [
  { name: 'Neal', email: 'neals@shingleusa.com', phone: process.env.NEAL_PHONE || '' },
  { name: 'Dewayne', email: process.env.DEWAYNE_EMAIL || '', phone: process.env.DEWAYNE_PHONE || '' },
]

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method Not Allowed' })
  if (!SB_URL || !SB_KEY) return json(500, { ok: false, error: 'Missing SUPABASE env vars' })

  let body
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { ok: false, error: 'Invalid JSON body' }) }

  const action = String(body.action || '').trim()
  const token = String(body.token || '').trim()
  if (!token) return json(400, { ok: false, error: 'Missing token' })

  const supabase = createClient(SB_URL, SB_KEY)

  // token → manager (must have a managed_region to be a manager).
  const { data: manager } = await supabase
    .from('trainees')
    .select('id, first_name, last_name, managed_region')
    .eq('manager_access_token', token)
    .maybeSingle()
  if (!manager || !manager.managed_region) return json(404, { ok: false, error: 'Invalid or revoked access link.' })

  const zone = manager.managed_region
  const managerName = `${manager.first_name || ''} ${manager.last_name || ''}`.trim()

  try {
    if (action === 'init') {
      const reps = await activeReps(supabase, zone)
      const week_start = etMondayISO()
      const report = await getReport(supabase, zone, week_start)
      return json(200, { ok: true, manager: { name: managerName, zone }, reps, week_start, report })
    }

    if (action === 'save' || action === 'submit') {
      const week_start = normDate(body.week_start) || etMondayISO()
      const rows = sanitizeRows(body.rows)
      const summary = String(body.summary || '').slice(0, 4000)
      const submitting = action === 'submit'

      const record = {
        zone,
        manager_name: managerName,
        week_start,
        rows,
        summary,
        status: submitting ? 'submitted' : 'draft',
        updated_at: new Date().toISOString(),
      }
      if (submitting) record.submitted_at = new Date().toISOString()

      const { error } = await supabase
        .from('weekly_manager_reports')
        .upsert(record, { onConflict: 'zone,week_start' })
      if (error) return json(500, { ok: false, error: error.message })

      let delivery = null
      if (submitting) delivery = await sendSummary(supabase, { zone, managerName, week_start, rows, summary })

      return json(200, { ok: true, status: record.status, delivery })
    }

    if (action === 'history') {
      const { data, error } = await supabase
        .from('weekly_manager_reports')
        .select('week_start, status, submitted_at, rows, summary')
        .eq('zone', zone)
        .order('week_start', { ascending: false })
        .limit(26)
      if (error) return json(500, { ok: false, error: error.message })
      return json(200, { ok: true, reports: data || [] })
    }

    return json(400, { ok: false, error: `Unknown action: ${action}` })
  } catch (e) {
    return json(500, { ok: false, error: e.message || 'error' })
  }
}

// Active field reps in the zone — same filter the dashboard roster uses.
async function activeReps(supabase, zone) {
  const { data } = await supabase
    .from('trainees')
    .select('id, first_name, last_name')
    .eq('is_active_sales_rep', true)
    .neq('rep_level', 'non_field')
    .eq('region', zone)
    .order('first_name', { ascending: true })
  return (data || []).map((t) => ({ id: t.id, name: `${t.first_name || ''} ${t.last_name || ''}`.trim() }))
}

async function getReport(supabase, zone, week_start) {
  const { data } = await supabase
    .from('weekly_manager_reports')
    .select('rows, summary, status, submitted_at')
    .eq('zone', zone)
    .eq('week_start', week_start)
    .maybeSingle()
  return data || null
}

// Keep only the fields we expect; coerce the four counts to non-negative ints.
function sanitizeRows(rows) {
  if (!Array.isArray(rows)) return []
  return rows.slice(0, 100).map((r) => ({
    rep_id: r.rep_id != null ? String(r.rep_id) : null,
    rep_name: String(r.rep_name || '').slice(0, 120),
    insp_signed: toInt(r.insp_signed),
    back_to_retail: toInt(r.back_to_retail),
    appts: toInt(r.appts),
    sales: toInt(r.sales),
    rode: !!r.rode,
    take: String(r.take || '').slice(0, 1500),
  }))
}

// ── summary delivery (email + SMS to ownership) ─────────────────────────
async function sendSummary(supabase, { zone, managerName, week_start, rows, summary }) {
  let recipients = []
  try {
    const r = await recipientsForEvent(supabase, 'weekly_manager_report')
    recipients = r.recipients || []
  } catch { /* fall through to fallback */ }
  if (!recipients.length) {
    recipients = FALLBACK_SUMMARY_RECIPIENTS
      .filter((x) => x.email || x.phone)
      .map((x) => ({ name: x.name, email: x.email || null, phone: x.phone || null, notify_via_email: !!x.email, notify_via_sms: !!x.phone }))
  }

  const subject = `Weekly Rep Report — ${zone} (${managerName}) — week of ${week_start}`
  const emailBody = summaryText({ zone, managerName, week_start, rows, summary })
  const sms = summarySms({ zone, managerName, week_start, rows })

  const emailed = [], texted = []
  for (const rcpt of recipients) {
    if (rcpt.email && rcpt.notify_via_email !== false) {
      try { await sendEmail(rcpt.email, subject, emailBody); emailed.push(rcpt.email) } catch { /* best-effort */ }
    }
    if (rcpt.phone && rcpt.notify_via_sms !== false) {
      try { await sendSmsViaGhl(rcpt.phone, sms, { firstName: rcpt.name || 'Owner', lastName: '' }); texted.push(rcpt.phone) } catch { /* best-effort */ }
    }
  }
  return { emailed, texted }
}

function totals(rows) {
  return (rows || []).reduce((a, r) => ({
    insp_signed: a.insp_signed + toInt(r.insp_signed),
    back_to_retail: a.back_to_retail + toInt(r.back_to_retail),
    appts: a.appts + toInt(r.appts),
    sales: a.sales + toInt(r.sales),
  }), { insp_signed: 0, back_to_retail: 0, appts: 0, sales: 0 })
}

function summarySms({ zone, managerName, week_start, rows }) {
  const t = totals(rows)
  const lines = [
    `📋 Weekly Rep Report — ${zone} (${managerName})`,
    `Week of ${week_start} (Mon–Thu)`,
    `Reps: ${rows.length} | Signed ${t.insp_signed} • B2R ${t.back_to_retail} • Appts ${t.appts} • Sales ${t.sales}`,
  ]
  return lines.join('\n')
}

// Plain-text email body — _email.js wraps it (newlines → <br>, links clickable).
function summaryText({ zone, managerName, week_start, rows, summary }) {
  const t = totals(rows)
  const lines = [
    `WEEKLY REP REPORT — ${zone}`,
    `Manager: ${managerName}`,
    `Week of ${week_start} (Mon–Thu)`,
    '',
  ]
  for (const r of (rows || [])) {
    lines.push(`• ${r.rep_name || '(rep)'}`)
    lines.push(`    Signed ${toInt(r.insp_signed)} · Back-to-retail ${toInt(r.back_to_retail)} · Appts ${toInt(r.appts)} · Sales ${toInt(r.sales)}`)
    if (r.rode) lines.push(`    Rode with: Yes${r.take ? ` — Takeaway: ${r.take}` : ''}`)
    else lines.push(`    Rode with: No${r.take ? ` — Why not: ${r.take}` : ''}`)
    lines.push('')
  }
  lines.push(`TOTAL — Signed ${t.insp_signed} · Back-to-retail ${t.back_to_retail} · Appts ${t.appts} · Sales ${t.sales}`)
  if (summary) { lines.push('', 'WEEKLY SUMMATION:', summary) }
  return lines.join('\n')
}

// ── helpers ─────────────────────────────────────────────────────────────
function toInt(v) { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : 0 }
function normDate(s) { const m = String(s || '').match(/^\d{4}-\d{2}-\d{2}$/); return m ? s : null }

// Monday (ET) of the current week as YYYY-MM-DD. "This week so far" anchors
// on this Monday; the manager fills it Thursday for Friday-morning review.
function etMondayISO(now = new Date()) {
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const day = et.getDay()                 // 0 Sun … 6 Sat
  et.setDate(et.getDate() + (day === 0 ? -6 : 1 - day))
  const y = et.getFullYear(), m = String(et.getMonth() + 1).padStart(2, '0'), d = String(et.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function json(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}
