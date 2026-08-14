// send-week-b-confirmation.js
//
// The Friday "confirm your Monday attendance for Week B" send. On the Friday
// ending a cohort's Week A, each trainee gets a text + email asking them to tap
// a link and confirm they'll be back Monday for Week B. Whoever confirms becomes
// HR's Week B hotel-booking list — they arrive Monday AFTERNOON, so the rooms
// have to be bookable Monday morning before they show up.
//
// Two ways in:
//   • MANUAL (from the class page): POST { class_id }  → send to that class now.
//   • CRON (Fridays): GET ?secret=CRON_SECRET           → auto-find the cohorts
//     whose Week A ends today (Friday) and send to each.
//
// Reuses the existing /confirm/<token> + confirmation_status flow. We RESET
// confirmation_status first so the badge reflects THIS Monday's confirmation,
// not a stale one. Best-effort stamps week_b_confirm_sent_at for cron dedupe
// (ignored if the column isn't there yet).
//
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN, GHL_LOCATION_ID,
//      CRON_SECRET (cron path only), optional PUBLIC_SITE_URL.

import { createClient } from '@supabase/supabase-js'
import { sendSmsViaGhl } from './_ghl.js'
import { sendEmail } from './_email.js'

// HTTP function: manual send (POST { class_id }) from the class page, or a
// secured GET (?secret=CRON_SECRET) for the Friday run. NOTE: this is deliberately
// NOT a native scheduled function — Netlify blocks HTTP calls to scheduled
// functions with a 403, which would break the manual button. The Friday auto-run
// lives in cron-week-b-confirmation.js, which hits this endpoint's GET path.

const SB_URL = process.env.SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SECRET_KEY

export const handler = async (event) => {
  if (!SB_URL || !SB_KEY) return json(500, { ok: false, error: 'Missing SUPABASE env vars' })
  const supabase = createClient(SB_URL, SB_KEY)
  const siteUrl = (process.env.PUBLIC_SITE_URL || process.env.URL || process.env.DEPLOY_URL || '').replace(/\/$/, '')

  // Parse an optional JSON body (the in-app button posts { class_id }).
  let body = {}
  try { body = JSON.parse(event.body || '{}') } catch { /* scheduled invokes may have no/other body */ }
  const classId = String(body.class_id || '').trim()

  // ---- MANUAL: POST { class_id } (in-app button) ----------------------------
  if (classId) {
    const cls = await loadClass(supabase, classId)
    if (!cls) return json(404, { ok: false, error: 'Class not found' })
    const r = await sendForClass(supabase, cls, siteUrl, { force: true })
    return json(200, { ok: true, mode: 'manual', class_id: classId, ...r })
  }

  // ---- CRON: the Friday scheduled run (native) or a secured external GET -----
  {
    const params = event.queryStringParameters || {}
    // A public GET (external trigger) must carry the secret. The native
    // scheduled invocation has no class_id and no ?secret — it's allowed.
    if (event.httpMethod === 'GET' && process.env.CRON_SECRET && params.secret !== process.env.CRON_SECRET) {
      return json(401, { ok: false, error: 'Unauthorized' })
    }
    const force = params.force === '1'
    const today = todayET()
    // Only run on Fridays (unless forced) — a cohort's Week A ends Friday.
    if (!force && dowET() !== 5) return json(200, { ok: true, mode: 'cron', skipped: 'not_friday', today })
    const thisMon = mondayOfISO(today)
    // Cohorts whose Week A started this Monday (so today = their Week A Friday).
    const { data: classes } = await supabase
      .from('classes')
      .select('id, region, week_start_date, week_end_date, cancelled_at, attendance_only, locations(name, city, state)')
      .eq('week_start_date', thisMon)
      .is('cancelled_at', null)
      .eq('attendance_only', false)
    const results = []
    for (const cls of classes || []) {
      const full = await loadClass(supabase, cls.id)
      if (full) results.push({ class_id: cls.id, region: cls.region, ...(await sendForClass(supabase, full, siteUrl, { force })) })
    }
    return json(200, { ok: true, mode: 'cron', today, classes: results.length, results })
  }

  return json(405, { ok: false, error: 'Method Not Allowed' })
}

async function loadClass(supabase, classId) {
  const { data } = await supabase
    .from('classes')
    .select('id, region, week_start_date, locations(name, city, state), trainees!class_id(id, first_name, last_name, phone, email, registration_token, registered, enrolled, declined_at, dropped_out_at, week_b_confirm_sent_at, attendance(attendance_date, confirmed))')
    .eq('id', classId)
    .maybeSingle()
  return data || null
}

// Send the Week B confirmation to every eligible trainee of one class.
async function sendForClass(supabase, cls, siteUrl, { force }) {
  const waStart = mondayOfISO(cls.week_start_date)
  const waEnd = addDaysISO(waStart, 6)
  const attendedWeekA = (t) =>
    (t.attendance || []).some((a) => a.confirmed && a.attendance_date >= waStart && a.attendance_date <= waEnd)
  const weekBMonday = addDaysISO(waStart, 7)
  const niceDate = formatNice(weekBMonday)
  const loc = cls.locations?.name || 'your training location'
  let sent = 0, skipped = 0
  const errors = []
  const recipients = []   // { name, channels:[...] } — everyone we actually texted/emailed
  const skippedList = []  // { name, reason } — everyone we intentionally left out
  const nameOf = (t) => `${t.first_name || ''} ${t.last_name || ''}`.trim() || 'Trainee'
  for (const t of cls.trainees || []) {
    // Only people who ACTUALLY ATTENDED Week A get the Week B confirmation — if they
    // never showed for Week A there's no reason to send them Week B.
    if (t.enrolled === false || t.declined_at || t.dropped_out_at || !attendedWeekA(t)) {
      skipped++
      skippedList.push({ name: nameOf(t), reason: t.dropped_out_at ? 'dropped out' : t.declined_at ? 'declined' : t.enrolled === false ? 'not enrolled' : "didn't attend Week A" })
      continue
    }
    if (!force && t.week_b_confirm_sent_at) { skipped++; skippedList.push({ name: nameOf(t), reason: 'already sent' }); continue } // cron dedupe
    if (!t.phone && !t.email) { skipped++; skippedList.push({ name: nameOf(t), reason: 'no phone or email' }); continue }
    const link = `${siteUrl ? siteUrl : ''}/confirm/${t.registration_token}?week=B`
    const msg =
      `U.S. Shingle & Metal — great job finishing Week A! Your Week B schedule, address & directions are here 👉 ${link}  ` +
      `Tap to confirm you'll be there Monday, ${niceDate}. Confirming holds your seat and your hotel room.`
    const channels = []
    if (t.email) {
      try {
        const r = await sendEmail(t.email, 'Confirm your Week B attendance — U.S. Shingle & Metal', msg)
        if (r && r.ok !== false) channels.push('email')
      } catch (e) { errors.push(`email ${t.id}: ${e.message || 'err'}`) }
    }
    if (t.phone) {
      try {
        const r = await sendSmsViaGhl(t.phone, msg, { firstName: t.first_name, lastName: t.last_name })
        if (r && r.ok !== false) channels.push('sms')
      } catch (e) { errors.push(`sms ${t.id}: ${e.message || 'err'}`) }
    }
    if (channels.length) {
      // Fresh ask: clear any prior confirmation so the Week B badge reflects THIS Monday.
      const patch = { confirmation_status: null, confirmation_at: null }
      // Best-effort dedupe stamp (ignored if the column doesn't exist yet).
      try {
        await supabase.from('trainees').update({ ...patch, week_b_confirm_sent_at: new Date().toISOString() }).eq('id', t.id)
      } catch {
        await supabase.from('trainees').update(patch).eq('id', t.id)
      }
      sent++
      recipients.push({ name: nameOf(t), channels })
    } else {
      errors.push(`no channel for ${t.first_name} ${t.last_name}`)
      skippedList.push({ name: nameOf(t), reason: 'send failed (no channel delivered)' })
    }
  }
  return { sent, skipped, week_b_monday: weekBMonday, recipients, skipped_list: skippedList, ...(errors.length ? { errors } : {}) }
}

// ---- date helpers (ET) ------------------------------------------------------
function todayET() {
  const p = {}
  for (const part of new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())) p[part.type] = part.value
  return `${p.year}-${p.month}-${p.day}`
}
function dowET() {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(new Date())
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[wd]
}
function addDaysISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d)); dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}
function mondayOfISO(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  const dow = dt.getUTCDay(); const back = dow === 0 ? 6 : dow - 1
  return addDaysISO(iso, -back)
}
function formatNice(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
}
function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}
