// netlify/functions/cron-provisioning-nag.js
//
// Recurring "finish your part" escalation for the provisioning pipeline.
// Unlike the one-shot day-2 / IT-complete reminders, this cron keeps
// texting the responsible DEPARTMENT every 2 hours (daytime only) until
// the system shows that department's step complete. It never gives up on
// its own — it stops the instant the completion signal flips.
//
// Two department stages, each with its own completion signal (these MUST
// match what the app's own pages treat as "done", so a nag never fires
// for something the team already considers finished):
//
//   1. IT — company-email provisioning
//        Responsible: role 'it'
//        Due when:    day 2 of the class (day_2_it_notified_at, or the
//                     day-2 fallback time if that's somehow unset)
//        Complete:    classes.it_completed_at is set  (== the Provisioning
//                     Hub dropping the class off IT's list)
//        Action page: /provision/:class_id
//
//   2. VA — RepCard / JobNimbus / Sales Academy setup
//        Responsible: role 'va'
//        Due when:    IT marks emails complete (it_completed_at)
//        Complete:    every trainee with (enrolled !== false && a
//                     company_email) has all three *_setup_at stamps
//                     (== the Setup page's "fullyDone")
//        Action page: /setup/:class_id
//
// "A day late" gate: a stage is only nagged once it has been overdue by
// 24h or more (per Neal — don't pester the same day the work becomes due).
//
// Cadence: the cron's own schedule supplies the 2-hour spacing, so no
// per-class last-sent bookkeeping is needed. It fires every 2h during ET
// daytime; the overnight gap is intentional (no 2 AM texts). A safety
// in-code daytime gate also guards manual runs and DST drift.
//
// USAGE:
//   • Scheduled — fires automatically on the cron below.
//   • Manual debug: GET /.netlify/functions/cron-provisioning-nag
//       ?force=1  bypasses the daytime-hours gate (still respects the
//                 "24h late" + "not complete" gates).
//       ?dry=1    computes who WOULD be texted but sends nothing.
//
// Required env: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN,
// GHL_LOCATION_ID. Optional: PUBLIC_SITE_URL / URL, ADMIN_PHONE.

import { createClient } from '@supabase/supabase-js'
import { sendSmsViaGhl } from './_ghl.js'

const PLATFORM_FIELDS = ['repcard_setup_at', 'jobnimbus_setup_at', 'sales_academy_setup_at']
const LATE_MS = 24 * 60 * 60 * 1000 // a stage must be 24h+ overdue to nag
const GRACE_DAYS = 14 // don't resurrect classes that ended > 2 weeks ago

export const handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed' })
  }

  const missing = []
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'GHL_PIT_TOKEN', 'GHL_LOCATION_ID']) {
    if (!process.env[k]) missing.push(k)
  }
  if (missing.length) return json(500, { ok: false, error: `Missing env: ${missing.join(', ')}` })

  const params = event.queryStringParameters || {}
  const force = params.force === '1' || params.force === 'true'
  const dry = params.dry === '1' || params.dry === 'true'

  // Daytime-only gate (~9 AM–7:59 PM ET). The cron schedule already keeps
  // sends inside this window; this guards manual runs + DST drift.
  const nowEt = currentEtHour()
  if (!force && (nowEt < 9 || nowEt >= 20)) {
    return json(200, { ok: true, skipped: 'outside daytime window', now_et_hour: round1(nowEt) })
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const siteUrl = (
    process.env.PUBLIC_SITE_URL || process.env.URL || 'https://trainingmanagementsys.netlify.app'
  ).replace(/\/$/, '')

  const now = new Date()
  const todayIso = ymd(now)
  const graceFloorIso = ymd(new Date(now.getTime() - GRACE_DAYS * 86400000))

  // Candidate classes: started, not cancelled, not attendance-only, and
  // ended within the last GRACE_DAYS (so we keep nagging a class that just
  // graduated but never finished setup, without reviving ancient rows).
  const { data: classes, error: cErr } = await supabase
    .from('classes')
    .select(
      'id, region, week_start_date, week_end_date, day_2_it_notified_at, it_completed_at, ' +
        'trainees!class_id(id, enrolled, company_email, repcard_setup_at, jobnimbus_setup_at, sales_academy_setup_at)',
    )
    .lte('week_start_date', todayIso)
    .gte('week_end_date', graceFloorIso)
    .eq('attendance_only', false)
    .is('cancelled_at', null)
  if (cErr) return json(500, { ok: false, error: cErr.message })

  // Cache department recipients so we look them up once, not per class.
  const recipientCache = {}
  const getDept = async (role) => {
    if (!recipientCache[role]) recipientCache[role] = await recipientsByRole(supabase, role)
    return recipientCache[role]
  }

  let itNags = 0
  let vaNags = 0
  let sent = 0
  const errors = []
  const actions = [] // debug trail of every decision

  for (const cls of classes || []) {
    const weekStart = cls.week_start_date
    const label = `${cls.region} (week of ${weekStart})`

    // ── Stage 1: IT — company-email provisioning ──────────────────────
    if (!cls.it_completed_at) {
      // Due anchor: when IT was asked (day 2). Fall back to day-2 at
      // 11 AM ET if the reminder timestamp is missing.
      const anchor = cls.day_2_it_notified_at
        ? new Date(cls.day_2_it_notified_at)
        : day2ElevenAmEt(weekStart)
      const lateMs = now.getTime() - anchor.getTime()
      if (lateMs >= LATE_MS) {
        const daysLate = Math.floor(lateMs / 86400000)
        const dept = await getDept('it')
        const msg =
          `[Training] Reminder: ${label} still needs company emails created — ` +
          `now ${daysLate} day${daysLate === 1 ? '' : 's'} past due. ` +
          `Please finish IT provisioning so the class can move forward: ${siteUrl}/provision/${cls.id}`
        const r = await fanout(dept, msg, { dry, errors })
        sent += r.sent
        itNags++
        actions.push({ class_id: cls.id, stage: 'it', days_late: daysLate, recipients: dept.length, source: r.source, sent: r.sent })
      } else {
        actions.push({ class_id: cls.id, stage: 'it', skipped: 'not yet 24h late' })
      }
      // IT not done → VA can't start. Don't also nag VA for this class.
      continue
    }

    // ── Stage 2: VA — platform setup ──────────────────────────────────
    // Mirror the Setup page exactly: only trainees that are enrolled AND
    // have a company email are in scope; "done" = all 3 platforms each.
    const inScope = (cls.trainees || []).filter((t) => t.enrolled !== false && t.company_email)
    if (inScope.length === 0) {
      actions.push({ class_id: cls.id, stage: 'va', skipped: 'no enrolled+emailed trainees to set up' })
      continue
    }
    const remaining = inScope.filter((t) => !PLATFORM_FIELDS.every((f) => t[f]))
    if (remaining.length === 0) {
      actions.push({ class_id: cls.id, stage: 'va', skipped: 'fully set up' })
      continue
    }
    const anchor = new Date(cls.it_completed_at)
    const lateMs = now.getTime() - anchor.getTime()
    if (lateMs < LATE_MS) {
      actions.push({ class_id: cls.id, stage: 'va', skipped: 'not yet 24h late' })
      continue
    }
    const daysLate = Math.floor(lateMs / 86400000)
    const dept = await getDept('va')
    const msg =
      `[Training] Reminder: ${label} — ${remaining.length} trainee${remaining.length === 1 ? '' : 's'} ` +
      `still need RepCard / JobNimbus / Sales Academy setup, now ${daysLate} day${daysLate === 1 ? '' : 's'} past due. ` +
      `Finish here: ${siteUrl}/setup/${cls.id}`
    const r = await fanout(dept, msg, { dry, errors })
    sent += r.sent
    vaNags++
    actions.push({ class_id: cls.id, stage: 'va', days_late: daysLate, remaining: remaining.length, recipients: dept.length, source: r.source, sent: r.sent })
  }

  console.log(
    `cron-provisioning-nag: classes=${(classes || []).length} it_nags=${itNags} va_nags=${vaNags} sent=${sent} errors=${errors.length}${dry ? ' (DRY RUN)' : ''}`,
  )
  return json(200, {
    ok: true,
    dry_run: dry,
    now_et_hour: round1(nowEt),
    classes_considered: (classes || []).length,
    it_nags: itNags,
    va_nags: vaNags,
    sms_sent: sent,
    errors,
    actions,
  })
}

// ── Send a message to every SMS-reachable member of a department ──────
async function fanout(recipients, message, { dry, errors }) {
  const source = recipients.source
  let sent = 0
  for (const r of recipients) {
    if (!r.phone) continue
    if (dry) { sent++; continue }
    const res = await sendSmsViaGhl(r.phone, message, { firstName: r.name || 'Team', lastName: 'Provisioning' })
    if (res.ok) sent++
    else errors.push({ recipient: r.name || r.phone, error: res.error })
  }
  return { sent, source }
}

// ── Department recipients by role, with ADMIN_PHONE fallback ──────────
async function recipientsByRole(supabase, role) {
  const { data } = await supabase
    .from('notification_recipients')
    .select('id, name, phone, notify_via_sms, active, role')
    .eq('active', true)
    .eq('role', role)
  const list = (data || [])
    .filter((r) => r.notify_via_sms !== false)
    .map((r) => ({ id: r.id, name: r.name, phone: normalizePhone(r.phone) }))
    .filter((r) => r.phone)
  list.source = list.length ? `role:${role}` : null
  if (list.length === 0) {
    const envPhone = normalizePhone(process.env.ADMIN_PHONE)
    if (envPhone) {
      const fb = [{ id: 'env', name: 'ADMIN_PHONE', phone: envPhone }]
      fb.source = 'ADMIN_PHONE env var'
      return fb
    }
  }
  return list
}

// ── Helpers ───────────────────────────────────────────────────────────
function normalizePhone(raw) {
  if (!raw) return null
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return String(raw).startsWith('+') ? String(raw) : null
}

function ymd(d) {
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

// Day 2 of the class at 11:00 AM ET, as a Date. Used as the IT due-anchor
// when day_2_it_notified_at is missing. 11 ET ≈ 15:00 UTC during EDT; the
// exact minute doesn't matter since the gate is a 24h window.
function day2ElevenAmEt(weekStartIso) {
  const base = new Date(weekStartIso + 'T00:00:00Z')
  base.setUTCDate(base.getUTCDate() + 1) // day 2
  base.setUTCHours(15, 0, 0, 0) // ~11 AM ET (EDT)
  return base
}

function currentEtHour() {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const [h, m] = fmt.format(new Date()).split(':').map(Number)
  return (h === 24 ? 0 : h) + (m || 0) / 60
}

function round1(n) {
  return Math.round(n * 10) / 10
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

// Netlify v2 scheduled function — every 2 hours during ET daytime.
// 13,15,17,19,21,23 UTC = 9 AM, 11 AM, 1, 3, 5, 7 PM EDT. (During EST in
// winter this shifts an hour earlier, 8 AM–6 PM ET — still daytime.)
export const config = { schedule: '0 13,15,17,19,21,23 * * *' }
