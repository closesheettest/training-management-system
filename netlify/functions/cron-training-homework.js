// netlify/functions/cron-training-homework.js
//
// Nightly cron — fires the day's homework SMS to every trainee in every
// active training class who actually attended today. Per the user's
// strict-attendance policy, no-shows get no homework (they shouldn't be
// continuing anyway).
//
// Schedule: 18:00, 19:00, 20:00 UTC = 2:00, 3:00, 4:00 PM EDT. Runs
// 3× daily. Each fire is gated per class on "has THIS class been
// dismissed for today?" Idempotent — only one homework SMS per
// trainee/day regardless of how many fires hit.
//
// Why 3 fires: homework goes out right at dismissal, and dismissal
// time varies by where we are in the training week:
//
//   Class starts MONDAY (week_start_date is Mon)
//     Day 1 Mon  noon → 4 PM    → homework 4:00 PM  (20:00 UTC EDT)
//     Day 2 Tue   8 AM → 2 PM   → homework 2:00 PM  (18:00 UTC EDT)
//     Day 3 Wed   8 AM → 2 PM   → homework 2:00 PM
//     Day 4 Thu   8 AM → 2 PM   → homework 2:00 PM
//     Day 5 Fri   graduation    → no homework
//
//   Class starts TUESDAY (week_start_date is Tue)
//     Day 1 Tue  noon → 4 PM    → homework 4:00 PM  (20:00 UTC EDT)
//     Day 2 Wed   8 AM → 3 PM   → homework 3:00 PM  (19:00 UTC EDT)
//     Day 3 Thu   8 AM → 3 PM   → homework 3:00 PM
//     Day 4 Fri   graduation    → no homework
//
// See CLASS_SCHEDULE constant below for the single source of truth.
//
// DST note: Netlify cron is UTC-only. The 18,19,20:00 fires track EDT
// (mid-March through early November). When clocks fall back to EST in
// November, the cron will fire 1 hour earlier than intended. To keep
// the same ET times year-round during EST, flip the schedule below to
// '0 19,20,21 * * *'.
//
// USAGE:
//   • Scheduled function — fires automatically on the configured cron.
//   • Can also be hit manually: GET /.netlify/functions/cron-training-homework
//     for a same-day re-run / debug.
//
// Required env: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN,
// GHL_LOCATION_ID, plus optional PUBLIC_SITE_URL / URL.
//
// Returns: { ok, processed_classes, sent, skipped, errors }.

import { createClient } from '@supabase/supabase-js'
import { sendSmsViaGhl } from './_ghl.js'
import { sendEmail } from './_email.js'

// Class end times in ET (24h) keyed by [start_day_of_week][day_number].
// Day-of-week: 1=Mon, 2=Tue, etc. Day_number: 1=first day, 2=second, …
// Missing entry = no homework (e.g. graduation day, or unsupported
// start day). See header comment for the rationale. Edit this table
// if the schedule changes — the cron will pick it up next fire.
const CLASS_SCHEDULE = {
  // Monday-start week — Day 1 is the short noon-4 day.
  1: { 1: 16, 2: 14, 3: 14, 4: 14 },
  // Tuesday-start week — Day 1 is also noon-4; subsequent days end at 3 PM.
  2: { 1: 16, 2: 15, 3: 15 },
}

// Returns the homework fire-time (ET hour as a float, e.g. 14.5 for
// 2:30 PM) for a given class on a given day_number, or null if no
// homework should ever fire for that combo.
function homeworkFireHour(dayNumber, startDow) {
  const schedule = CLASS_SCHEDULE[startDow]
  if (!schedule) return null
  const endHour = schedule[dayNumber]
  if (endHour == null) return null
  return endHour // send right at dismissal
}

export const handler = async (event) => {
  // Scheduled invocations have no httpMethod; manual GET / POST both ok.
  if (event.httpMethod && event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed' })
  }

  const missing = []
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'GHL_PIT_TOKEN', 'GHL_LOCATION_ID']) {
    if (!process.env[k]) missing.push(k)
  }
  if (missing.length) return json(500, { ok: false, error: `Missing env: ${missing.join(', ')}` })

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const siteUrl = (
    process.env.PUBLIC_SITE_URL || process.env.URL || 'https://trainingmanagementsys.netlify.app'
  ).replace(/\/$/, '')

  const params = event.queryStringParameters || {}
  // ?force=1 bypasses the "has class ended yet" gate. Useful for an
  // admin manually firing the cron earlier in the day for a particular
  // class. The per-trainee dedup still prevents double-sends.
  const force = params.force === '1' || params.force === 'true'

  // Auto homework stays ON (this cron sends to everyone who attended). The
  // per-trainee "📚 Homework" button on Class Detail (send-homework.js) is a
  // MANUAL re-send for anyone who didn't get theirs — it doesn't replace this.

  const todayIso = ymd(new Date())
  // Current ET clock as a float hour (e.g. 14.5 = 2:30 PM). Used by the
  // class-end gate to skip classes whose dismissal hasn't happened yet.
  const nowEt = currentEtHour()

  // 1. Active training classes today. Exclude attendance-only meetings
  //    (those aren't training weeks and don't have homework).
  const { data: classes, error: cErr } = await supabase
    .from('classes')
    .select('id, region, week_start_date, week_end_date')
    .lte('week_start_date', todayIso)
    .gte('week_end_date', todayIso)
    .eq('attendance_only', false)
  if (cErr) return json(500, { ok: false, error: cErr.message })
  if (!classes || classes.length === 0) {
    return json(200, { ok: true, message: 'No active classes today', processed_classes: 0 })
  }

  // 2. Load every enabled lesson + verify each has a homework body.
  //    Cache the lookup by day_number so we don't re-fetch per class.
  const { data: lessons, error: lErr } = await supabase
    .from('training_day_lessons')
    .select('day_number, label, homework_sms_body, homework_link_url, enabled')
  if (lErr) return json(500, { ok: false, error: lErr.message })
  const lessonByDay = new Map()
  for (const l of lessons || []) lessonByDay.set(l.day_number, l)

  let sent = 0
  const skipped = []
  const errors = []
  let processedClasses = 0

  for (const cls of classes) {
    processedClasses++
    const dayNumber = daysBetween(cls.week_start_date, todayIso) + 1

    // Last day of training = graduation. No homework — they're done
    // tomorrow. We still allow Day 1 homework because Day 2 morning's
    // quiz needs Day 1 content.
    if (todayIso === cls.week_end_date) {
      skipped.push({ class_id: cls.id, reason: 'Last day of class — no homework' })
      continue
    }

    // Has class actually ended for the day? Day-of-week-aware: e.g.
    // Mon-start Day 2 (Tuesday) ends at 2 PM → fire at 2:00 PM ET.
    // The 3 daily cron fires (2:00/3:00/4:00 PM EDT) overlap with all
    // possible end times — each class gets caught on the right wave.
    const startDow = dayOfWeekEt(cls.week_start_date)
    const fireHour = homeworkFireHour(dayNumber, startDow)
    if (fireHour == null) {
      skipped.push({
        class_id: cls.id,
        day_number: dayNumber,
        start_dow: startDow,
        reason: 'No homework scheduled for this class day (graduation or unsupported start day)',
      })
      continue
    }
    if (!force && nowEt < fireHour) {
      skipped.push({
        class_id: cls.id,
        day_number: dayNumber,
        reason: `Too early — class ends / homework fires at ${formatHour(fireHour)} ET (now ${formatHour(nowEt)} ET)`,
      })
      continue
    }
    const lesson = lessonByDay.get(dayNumber)
    if (!lesson?.enabled) {
      skipped.push({ class_id: cls.id, day_number: dayNumber, reason: 'Lesson disabled' })
      continue
    }
    const body = (lesson.homework_sms_body || '').trim()
    if (!body) {
      skipped.push({ class_id: cls.id, day_number: dayNumber, reason: 'No homework body authored' })
      continue
    }

    // 3. Find trainees who attended today. The user's strict-attendance
    //    rule means no-shows don't get homework — they're not continuing.
    const { data: attendance, error: aErr } = await supabase
      .from('attendance')
      .select('trainee_id, trainees(id, first_name, phone, email)')
      .eq('class_id', cls.id)
      .eq('attendance_date', todayIso)
      .eq('confirmed', true)
    if (aErr) {
      errors.push({ class_id: cls.id, error: aErr.message })
      continue
    }
    if (!attendance || attendance.length === 0) {
      skipped.push({ class_id: cls.id, day_number: dayNumber, reason: 'Nobody attended today' })
      continue
    }

    // 4. For each attended trainee, send homework SMS (if not already
    //    sent — second invocation in the same day is a no-op).
    for (const row of attendance) {
      const t = row.trainees
      if (!t) continue
      if (!t.phone && !t.email) {
        skipped.push({ trainee_id: t.id, reason: 'No phone or email' })
        continue
      }

      // Dedup check
      const { data: existing } = await supabase
        .from('training_day_attempts')
        .select('id, homework_sent_at')
        .eq('trainee_id', t.id)
        .eq('day_number', dayNumber)
        .maybeSingle()
      if (existing?.homework_sent_at) {
        skipped.push({ trainee_id: t.id, day_number: dayNumber, reason: 'Already sent today' })
        continue
      }

      // Compose message. Link gets appended on its own line so phones
      // render it as a tappable preview card.
      const firstName = t.first_name || 'there'
      const personalBody = body.replace(/\{firstName\}/g, firstName)
      const link = (lesson.homework_link_url || '').trim()
      const absoluteLink = link
        ? (link.startsWith('http') ? link : siteUrl + (link.startsWith('/') ? link : '/' + link))
        : ''
      const message = absoluteLink ? `${personalBody}\n\n${absoluteLink}` : personalBody

      // Send by BOTH email and SMS so trainees whose SMS is opted-out (DND)
      // still get it by email.
      const channels = []
      let smsMessageId = null
      let emailId = null
      if (t.email) {
        try { const er = await sendEmail(t.email, `Your Day ${dayNumber} homework — U.S. Shingle & Metal`, message); if (er && er.ok !== false) { channels.push('email'); emailId = er.id || null } } catch { /* best-effort */ }
      }
      if (t.phone) {
        const smsRes = await sendSmsViaGhl(t.phone, message, { firstName, lastName: 'Homework' })
        if (smsRes.ok) { channels.push('sms'); smsMessageId = smsRes.messageId || null }
        else errors.push({ trainee_id: t.id, error: smsRes.error })
      }
      if (!channels.length) continue

      // Stamp attempt row. Record the GHL message id + Resend email id and clear
      // any prior delivery status so the delivery-check cron picks this up fresh.
      const nowIso = new Date().toISOString()
      const stamp = {
        homework_sent_at: nowIso,
        homework_message_id: smsMessageId,
        homework_delivery_status: null,
        homework_delivery_checked_at: null,
        homework_email_id: emailId,
        homework_email_status: null,
        homework_email_checked_at: null,
      }
      if (existing) {
        await supabase
          .from('training_day_attempts')
          .update({ ...stamp, updated_at: nowIso })
          .eq('id', existing.id)
      } else {
        await supabase.from('training_day_attempts').insert({
          trainee_id: t.id,
          class_id: cls.id,
          day_number: dayNumber,
          ...stamp,
        })
      }
      sent++
    }
  }

  console.log(
    `cron-training-homework: ${processedClasses} class(es), sent=${sent}, skipped=${skipped.length}, errors=${errors.length}`,
  )
  return json(200, { ok: true, processed_classes: processedClasses, sent, skipped, errors })
}

// ────────────────────────────────────────────────────────────────────
// Date helpers — same logic as send-training-quiz.js for consistency.

function ymd(d) {
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function daysBetween(fromIso, toIso) {
  const f = new Date(fromIso + 'T00:00:00Z')
  const t = new Date(toIso + 'T00:00:00Z')
  return Math.round((t - f) / 86400000)
}

// Current wall-clock hour in Eastern Time, as a float (e.g. 14.5 =
// 2:30 PM). Used by the homework fire-time gate.
function currentEtHour() {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  // en-US with hour12:false returns "HH:MM" — except midnight, which
  // some Node versions render as "24:MM". Treat 24 as 0.
  const [h, m] = fmt.format(new Date()).split(':').map(Number)
  return (h === 24 ? 0 : h) + (m || 0) / 60
}

// Day-of-week (0=Sun..6=Sat) for an ET date string. Anchor at noon ET
// to dodge DST midnight edges (when 00:00 ET could fall on either side
// of the spring-forward / fall-back transition).
function dayOfWeekEt(isoDate) {
  if (!isoDate) return null
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
  })
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return map[fmt.format(new Date(isoDate + 'T17:00:00Z'))] ?? null
}

// Pretty-print a float hour as "H:MM AM/PM" for debug skip-reasons.
function formatHour(h) {
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60)
  const ampm = hh >= 12 ? 'PM' : 'AM'
  const hh12 = hh % 12 || 12
  return `${hh12}:${String(mm).padStart(2, '0')} ${ampm}`
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

// Netlify v2 scheduled function — fires at 18:00, 19:00, 20:00 UTC daily
// (= 2:00, 3:00, 4:00 PM EDT). Each fire processes only the classes whose
// dismissal-time has passed for today; the others get skipped with a
// "too early" reason in the response. Idempotent per trainee per day.
// See header comment for DST handling — bump to '0 19,20,21 * * *' in
// November to stay on the same ET times during EST.
export const config = { schedule: '0 18,19,20 * * *' }
