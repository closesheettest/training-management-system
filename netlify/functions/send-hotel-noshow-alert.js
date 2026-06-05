// Netlify Function: hotel no-show "cancel the room" nag.
//
// Fires HOURLY during the training day. For every trainee who (a) has a
// hotel room booked (a trainee_hotel_stays row), (b) hasn't been cancelled
// yet (stay.cancelled_at is null), and (c) hasn't signed into class today,
// it texts the HR/Admin no-show subscribers so they can cancel the unused
// room. The text repeats every hour until a human presses "Cancelled
// Hotel" on the trainee (Hotels page or the class roster), which stamps
// stay.cancelled_at and drops them from the list for good.
//
// This replaces the old once-a-day batch alert. Two things changed:
//   1. Only BOOKED trainees are nagged (no room = nothing to cancel).
//   2. It repeats hourly instead of firing once — stay.cancel_nag_at
//      throttles to one text per hour; stay.cancelled_at is the off switch.
//
// The SMS wording is the same shape HR already knows (buildMessage).
//
// Schedule: hourly 14:00–23:00 UTC (= 10 AM–7 PM ET, DST-safe via the
// per-trainee clock gate below). Configured both in netlify.toml and the
// export const config at the bottom — keep them in sync.
//
// Required env: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN,
// GHL_LOCATION_ID. CRON_SECRET only enforced for manual HTTP calls.
//
// Manual call (testing): GET ?secret=<CRON_SECRET> with optional
//   ?dry_run=1            — log who'd be nagged, send nothing, stamp nothing
//   ?date=YYYY-MM-DD      — override "today" (also bypasses the too-early gate)
//   ?hour=N               — override the current ET hour (0-23)
//   ?force=1              — bypass the per-trainee time + once-an-hour gates

import { createClient } from '@supabase/supabase-js'
import { recipientsForEvent } from './_recipients.js'
import { notifyAll } from './_notify.js'

// Don't re-text the same booking more than once an hour. 55 min (not 60)
// so a cron that fires a hair early on the next hour still passes the gate.
const NAG_INTERVAL_MS = 55 * 60 * 1000

export const handler = async (event) => {
  // Scheduled invocations (from Netlify) have no httpMethod and carry no
  // secret — allow those. Manual HTTP calls still require the secret.
  const isHttp = !!event.httpMethod
  if (isHttp) {
    const provided =
      event.headers['x-cron-secret'] ||
      event.headers['X-Cron-Secret'] ||
      event.queryStringParameters?.secret
    if (!process.env.CRON_SECRET || provided !== process.env.CRON_SECRET) {
      return json(401, { error: 'Unauthorized' })
    }
  }

  const missing = []
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'GHL_PIT_TOKEN', 'GHL_LOCATION_ID']) {
    if (!process.env[k]) missing.push(k)
  }
  if (missing.length) return json(500, { error: `Missing env vars: ${missing.join(', ')}` })

  const params = event.queryStringParameters || {}
  const dryRun = params.dry_run === '1' || params.dry_run === 'true'
  const force = params.force === '1' || params.force === 'true'
  const today = params.date || computeFloridaToday()
  const nowEtHour = params.hour != null ? Number(params.hour) : computeFloridaHour()
  const nowMs = Date.now()

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  // 1. All hotel-needing, enrolled, registered trainees + their class +
  //    today's attendance. (We filter to "booked" + "absent" in code.)
  const { data: trainees, error: trErr } = await supabase
    .from('trainees')
    .select(`
      id,
      first_name,
      last_name,
      class_id,
      classes!class_id(week_start_date, week_end_date, region, locations(name)),
      attendance(attendance_date, confirmed)
    `)
    .eq('needs_hotel', true)
    .eq('enrolled', true)
    .eq('registered', true)

  if (trErr) return json(500, { error: `Supabase: ${trErr.message}` })

  // 2. Open (un-cancelled) hotel bookings, keyed by trainee. A booking =
  //    proof a room exists to cancel. cancelled_at is the off switch.
  const { data: stays, error: stErr } = await supabase
    .from('trainee_hotel_stays')
    .select('id, trainee_id, cancel_nag_at, cancelled_at')
    .is('cancelled_at', null)
  if (stErr) return json(500, { error: `Supabase stays: ${stErr.message}` })

  const stayByTrainee = {}
  for (const s of stays || []) stayByTrainee[s.trainee_id] = s

  // 3. Eligible = booked + within class week + past the start grace +
  //    absent today + this booking's hourly nag is due.
  const eligible = []
  for (const t of trainees || []) {
    const stay = stayByTrainee[t.id]
    if (!stay) continue // no room booked → nothing to cancel
    const start = t.classes?.week_start_date
    const end = t.classes?.week_end_date
    if (!start || !end) continue
    if (today < start || today > end) continue

    // Class-start-aware grace: Day 1 starts at noon (alert ≥ 12:30 PM ET),
    // Day 2+ starts at 10 AM (alert ≥ 10:30 AM ET). Skip when overriding date.
    const isDay1 = today === start
    const earliestAlertHour = isDay1 ? 12.5 : 10.5
    if (!force && !params.date && nowEtHour < earliestAlertHour) continue

    const checkedIn = (t.attendance || []).some(
      (a) => a.attendance_date === today && a.confirmed,
    )
    if (checkedIn) continue // signed in → room is needed, no nag

    // Once-an-hour throttle per booking.
    if (!force && stay.cancel_nag_at) {
      const last = new Date(stay.cancel_nag_at).getTime()
      if (nowMs - last < NAG_INTERVAL_MS) continue
    }

    eligible.push({ trainee: t, stay })
  }

  if (eligible.length === 0) {
    return json(200, {
      target_date: today,
      booked_noshow_count: 0,
      sent_count: 0,
      message: 'No booked-room no-shows due for a nag right now.',
    })
  }

  const absentees = eligible.map((e) => e.trainee)
  const smsBody = buildMessage(absentees, today)
  const emailSubject = `Hotel no-show — cancel ${absentees.length} room${absentees.length === 1 ? '' : 's'}?`
  const emailBody = smsBody

  const { recipients, source: roleUsed } = await recipientsForEvent(
    supabase,
    'hotel_noshow_alert',
    { legacyRole: 'hr' },
  )

  if (recipients.length === 0) {
    return json(200, {
      target_date: today,
      booked_noshow_count: absentees.length,
      sent_count: 0,
      role_used: null,
      warning: 'No active recipients in HR or Admin roles, and no ADMIN_PHONE env var. Add at least one in /notifications.',
      absentees: absentees.map((t) => `${t.first_name} ${t.last_name} (${t.classes?.region || 'Region'})`),
    })
  }

  if (dryRun) {
    return json(200, {
      target_date: today,
      booked_noshow_count: absentees.length,
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

  // Stamp the nag time on every booking we just texted about, so each one
  // is throttled to roughly hourly until someone presses "Cancelled Hotel".
  await supabase
    .from('trainee_hotel_stays')
    .update({ cancel_nag_at: new Date().toISOString() })
    .in('id', eligible.map((e) => e.stay.id))

  return json(200, {
    target_date: today,
    booked_noshow_count: absentees.length,
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
  if (absentees.length === 1) {
    const t = absentees[0]
    const region = t.classes?.region || 'training'
    const loc = t.classes?.locations?.name
    const locStr = loc ? ` at ${loc}` : ''
    return `[Training] ${t.first_name} ${t.last_name} (${region}${locStr}) hasn't checked in by class start on ${dateLabel}. They have a room booked — cancel it, then press "Cancelled Hotel" to stop these texts.`
  }
  const lines = absentees.map((t) => {
    const region = t.classes?.region || 'training'
    return `• ${t.first_name} ${t.last_name} (${region})`
  })
  return `[Training] ${absentees.length} trainees with booked rooms haven't checked in by class start on ${dateLabel}:\n${lines.join('\n')}\nCancel their rooms, then press "Cancelled Hotel" on each to stop these texts.`
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

function computeFloridaHour() {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    hour12: false,
  })
  return Number(fmt.format(new Date()))
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

// Hourly, 10 AM–7 PM ET (14:00–23:00 UTC). Keep in sync with netlify.toml.
export const config = { schedule: '0 14-23 * * *' }
