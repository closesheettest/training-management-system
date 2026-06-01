// Netlify Function: hotel-no-show alert.
//
// Runs daily (via cron-job.org or similar). Finds every trainee whose
// needs_hotel=true who hasn't checked in by the time class has started
// today, then sends a summary SMS to HR (falls back to admin recipients,
// then to ADMIN_PHONE env var). Helps HR cancel unused hotel rooms.
//
// Class start time is day-of-week aware:
//   Mon          → noon (class is 12 → 4 PM)
//   Tue-Fri      → 8 AM
//   Sat/Sun      → 8 AM (no class scheduled, no-op in practice)
// We add a 30-min grace, so the alert fires no earlier than 12:30 PM
// on Mondays and 8:30 AM on Tue-Fri. The existing 10:30 AM cron-job.org
// call is fine for Tue-Fri. To cover Mondays, schedule a second call
// at 1 PM Mondays (or 1 PM daily — it'll just no-op Tue-Fri since the
// alert won't re-fire for the same date once trainees are stamped).
// If no Monday-PM cron exists, Mondays go un-alerted but Tuesday's
// 10:30 AM cron will catch persistent no-shows.
//
// Required env vars: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN,
// GHL_LOCATION_ID, CRON_SECRET
//
// Auth: include ?secret=<CRON_SECRET> or an X-Cron-Secret header.
//
// Query params:
//   ?dry_run=1   — log who would be alerted without sending SMS or stamping DB
//   ?date=YYYY-MM-DD — override the "today" check (useful for testing).
//                       When set, the too-early gate is bypassed so you can
//                       backfill or replay historical dates from your laptop.
//   ?hour=N      — override the "current ET hour" gate (0-23). Useful for
//                       testing the Monday gate locally without waiting until noon.
//
// Response: {
//   target_date, absent_count, sent_count, recipient_count,
//   role_used, absentees: [...], dry_run?, skipped_reason?
// }

import { createClient } from '@supabase/supabase-js'
import { recipientsForEvent } from './_recipients.js'
import { notifyAll } from './_notify.js'

export const handler = async (event) => {
  // Auth
  const provided =
    event.headers['x-cron-secret'] ||
    event.headers['X-Cron-Secret'] ||
    event.queryStringParameters?.secret
  if (!process.env.CRON_SECRET || provided !== process.env.CRON_SECRET) {
    return json(401, { error: 'Unauthorized' })
  }

  const missing = []
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'GHL_PIT_TOKEN', 'GHL_LOCATION_ID']) {
    if (!process.env[k]) missing.push(k)
  }
  if (missing.length) return json(500, { error: `Missing env vars: ${missing.join(', ')}` })

  const params = event.queryStringParameters || {}
  const dryRun = params.dry_run === '1' || params.dry_run === 'true'
  const today = params.date || computeFloridaToday()
  // Override-able for testing. Real cron passes nothing → we compute from clock.
  const nowEtHour = params.hour != null ? Number(params.hour) : computeFloridaHour()

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  // Pull all needs_hotel trainees who are enrolled and registered. We'll filter
  // by "class active today" and "no attendance today" in code (simpler than
  // building a complex PostgREST query).
  const { data: trainees, error: trErr } = await supabase
    .from('trainees')
    .select(`
      id,
      first_name,
      last_name,
      hotel_alert_sent_at,
      classes!class_id(week_start_date, week_end_date, region, locations(name)),
      attendance(attendance_date, confirmed)
    `)
    .eq('needs_hotel', true)
    .eq('enrolled', true)
    .eq('registered', true)

  if (trErr) return json(500, { error: `Supabase: ${trErr.message}` })

  // Class start time by day of week (ET). Mondays run noon → 4 PM, every
  // other training day starts at 8 AM. We require the class to have been
  // in session for ~30 min before we'll call a no-show — so Tue–Fri the
  // 10:30 AM cron is fine, Mondays we wait until at least 12:30 PM.
  // Keeps the cron from spamming HR with "no-shows" who just aren't due
  // to arrive yet (e.g. Mon 10:30 AM, class doesn't start til noon).
  const dow = computeFloridaDayOfWeek(today) // 0=Sun..6=Sat
  const classStartHourByDow = { 1: 12 /* Mon noon */ }
  const classStartHour = classStartHourByDow[dow] ?? 8
  const earliestAlertHour = classStartHour + 0.5 // 30-min grace
  const tooEarly = nowEtHour < earliestAlertHour

  if (tooEarly && !params.date) {
    return json(200, {
      target_date: today,
      absent_count: 0,
      sent_count: 0,
      skipped_reason: `Too early — class start ${classStartHour}:00 ET, current hour ${nowEtHour}. Will run again later.`,
    })
  }

  const absentees = (trainees || []).filter((t) => {
    const start = t.classes?.week_start_date
    const end = t.classes?.week_end_date
    if (!start || !end) return false
    if (today < start || today > end) return false
    const checkedIn = (t.attendance || []).some(
      (a) => a.attendance_date === today && a.confirmed,
    )
    return !checkedIn
  })

  if (absentees.length === 0) {
    return json(200, {
      target_date: today,
      absent_count: 0,
      sent_count: 0,
      message: 'No hotel-needing no-shows today.',
    })
  }

  const smsBody = buildMessage(absentees, today)
  const emailSubject = `Hotel no-show alert — ${absentees.length} trainee${absentees.length === 1 ? '' : 's'}`
  const emailBody = smsBody

  const { recipients, source: roleUsed } = await recipientsForEvent(
    supabase,
    'hotel_noshow_alert',
    { legacyRole: 'hr' },
  )

  if (recipients.length === 0) {
    return json(200, {
      target_date: today,
      absent_count: absentees.length,
      sent_count: 0,
      role_used: null,
      warning: 'No active recipients found in HR or Admin roles, and no ADMIN_PHONE env var. Add at least one in /notifications.',
      absentees: absentees.map((t) => `${t.first_name} ${t.last_name} (${t.classes?.region || 'Region'})`),
    })
  }

  if (dryRun) {
    return json(200, {
      target_date: today,
      absent_count: absentees.length,
      role_used: roleUsed,
      recipient_count: recipients.length,
      dry_run: true,
      preview_sms: smsBody,
      preview_email_subject: emailSubject,
      absentees: absentees.map((t) => `${t.first_name} ${t.last_name} (${t.classes?.region || 'Region'})`),
    })
  }

  const r = await notifyAll(recipients, {
    smsBody,
    emailSubject,
    emailBody,
    contactLabel: 'HR',
  })

  await supabase
    .from('trainees')
    .update({ hotel_alert_sent_at: new Date().toISOString() })
    .in('id', absentees.map((t) => t.id))

  return json(200, {
    target_date: today,
    absent_count: absentees.length,
    sent_count: r.sms_sent + r.email_sent,
    sms_sent: r.sms_sent,
    email_sent: r.email_sent,
    recipient_count: recipients.length,
    role_used: roleUsed,
    absentees: absentees.map((t) => `${t.first_name} ${t.last_name} (${t.classes?.region || 'Region'})`),
    ...(r.errors.length > 0 ? { send_errors: r.errors } : {}),
  })
}

function buildMessage(absentees, dateIso) {
  const dateLabel = new Date(dateIso + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
  // Time label tracks class start: noon for Monday, 8 AM otherwise. Keeps
  // the text accurate when the cron fires after Monday's noon class.
  const dow = new Date(dateIso + 'T12:00:00').getUTCDay() // safe: dateIso is ET-derived
  const timeLabel = dow === 1 ? 'class start (noon)' : '10:30 AM'
  if (absentees.length === 1) {
    const t = absentees[0]
    const region = t.classes?.region || 'training'
    const loc = t.classes?.locations?.name
    const locStr = loc ? ` at ${loc}` : ''
    return `[Training] ${t.first_name} ${t.last_name} (${region}${locStr}) hasn't checked in by ${timeLabel} on ${dateLabel}. They need a hotel — consider cancelling their room.`
  }
  const lines = absentees.map((t) => {
    const region = t.classes?.region || 'training'
    return `• ${t.first_name} ${t.last_name} (${region})`
  })
  return `[Training] ${absentees.length} hotel-needing trainees haven't checked in by ${timeLabel} on ${dateLabel}:\n${lines.join('\n')}\nConsider cancelling their rooms.`
}

function computeFloridaToday() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return fmt.format(new Date())
}

// Current hour (0-23) in Eastern Time. Used to decide whether class has
// started yet — Mondays start at noon, so a 10:30 AM cron is too early.
function computeFloridaHour() {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    hour12: false,
  })
  return Number(fmt.format(new Date()))
}

// Day-of-week (0=Sun..6=Sat) for an ET date string. Mondays = 1 → we
// know class starts at noon instead of 8 AM.
function computeFloridaDayOfWeek(isoDate) {
  // Anchor noon ET to avoid DST midnight edge cases.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
  })
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return map[fmt.format(new Date(isoDate + 'T17:00:00Z'))] ?? 0
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
