// Netlify Function: day-2 IT provisioning reminder (cron).
//
// Cron-triggered. Hourly between 7–11 AM Eastern is fine. For each class:
//   - Computes day 2 = week_start_date + 1
//   - If today is day 2 and day_2_it_notified_at IS NULL:
//       * If any trainee has signed in today, fire NOW.
//       * Else if we're past the cohort's own class start + 30 min, fire as
//         fallback (see the note on the gate below — NOT a fixed hour).
//       * Else skip.
//   - On fire: notify subscribers of event 'day_2_provision_due', stamp
//     day_2_it_notified_at to dedup.
//
// Required env vars: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN,
// GHL_LOCATION_ID, CRON_SECRET, RESEND_API_KEY (only if any subscriber wants email).
// Optional: PUBLIC_SITE_URL, NOTIFICATION_FROM_EMAIL.
//
// Auth: ?secret=<CRON_SECRET> or X-Cron-Secret header.
// Query params: ?dry_run=1, ?date=YYYY-MM-DD, ?hour=N (for testing).

import { createClient } from '@supabase/supabase-js'
import { recipientsForEvent } from './_recipients.js'
import { notifyAll } from './_notify.js'
import { loadStartHours, alertHourET } from './_schedule.js'

export const handler = async (event) => {
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
  const currentHour = params.hour !== undefined ? Number(params.hour) : computeFloridaHour()

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const startHours = await loadStartHours(supabase)
  const siteUrl = (process.env.PUBLIC_SITE_URL || process.env.URL || process.env.DEPLOY_URL || '').replace(/\/$/, '')

  const { data: candidates, error: clsErr } = await supabase
    .from('classes')
    .select('id, region, week_start_date, week_end_date, day_2_it_notified_at, locations(name), attendance(attendance_date, confirmed), trainees!class_id(first_name, last_name, region, enrolled, declined_at, dropped_out_at, attendance(attendance_date, confirmed))')
    .is('day_2_it_notified_at', null)
    .is('cancelled_at', null)
    .eq('attendance_only', false)
    .lte('week_start_date', today)
    .gte('week_end_date', today)
  if (clsErr) return json(500, { error: `Supabase: ${clsErr.message}` })

  const day2Classes = (candidates || []).filter((c) => addDaysIso(c.week_start_date, 1) === today)

  const results = []
  let firedCount = 0

  for (const cls of day2Classes) {
    const hasSignIn = (cls.attendance || []).some(
      (a) => a.attendance_date === today && a.confirmed,
    )
    // The fallback was a hardcoded 11 AM, written when training was one week
    // that started at 10. Under the two-week schedule Week A's TUESDAY — which
    // is day 2 — doesn't start until 2 PM, so 11 AM fired three hours before
    // the cohort it's about had walked in the door. The only people signing in
    // at that hour were the WEEK B cohort, which is exactly what it looked
    // like it was reacting to (Neal, 2026-08-18).
    //
    // Use the cohort's own start hour plus the same 30-minute grace the
    // no-show crons use, read from the live timetable — so this can't drift
    // from the hours trainees are actually told, and a noon LATE_START_DATES
    // day holds it back too. No class day for this cohort → no fallback at
    // all; only a real sign-in fires it.
    const fallbackHour = alertHourET(cls.week_start_date, today, startHours)
    const pastFallback = fallbackHour != null && currentHour >= fallbackHour
    const shouldFire = hasSignIn || pastFallback
    if (!shouldFire) {
      results.push({
        class_id: cls.id,
        region: cls.region,
        location: cls.locations?.name || null,
        fired: false,
        reason: fallbackHour == null
          ? `No classroom day for this cohort — waiting for a real sign-in (current hour: ${currentHour})`
          : `Waiting for first sign-in or the ${fallbackHour}:00 fallback (current hour: ${currentHour})`,
      })
      continue
    }

    const link = siteUrl ? `${siteUrl}/provision/${cls.id}` : `/provision/${cls.id}`
    const locationName = cls.locations?.name || `${cls.region} — TBD`
    const triggerLabel =
      hasSignIn ? 'Day 2 trainees have started checking in.' : 'Day 2 is underway.'

    // ZONES. Field training starts WEDNESDAY, and a regional manager only sees a
    // trainee once they have a zone (rep-zones places pre-grads by their region).
    // Day 2 is the moment to settle it, so the provisioning notice carries the
    // state of play and nags only when someone is still unassigned.
    const roster = (cls.trainees || []).filter(
      (t) => t.enrolled !== false && !t.declined_at && !t.dropped_out_at && !t.left_company_at,
    )
    const noZone = roster.filter((t) => !t.region)
    // WHO to provision. Two cohorts are in the building in any given week —
    // Week A here for day 2, and last week's cohort back for Week B — and Week
    // B already got their emails last week. Naming the people who actually
    // signed in today is the difference between IT knowing exactly who to set
    // up and IT guessing which class this is about (Neal, 2026-08-18).
    const presentToday = roster.filter((t) =>
      (t.attendance || []).some((a) => a.attendance_date === today && a.confirmed),
    )
    const nameOf = (t) => `${t.first_name || ''} ${t.last_name || ''}`.trim()
    const whoLine = presentToday.length
      ? `Signed in today (${presentToday.length} of ${roster.length}): ${presentToday.map(nameOf).join(', ')}.`
      : `Nobody has signed in yet — set up the ${roster.length} enrolled, or wait for the sign-in list on the Provision page.`

    const zoneLine = roster.length === 0
      ? ''
      : noZone.length === 0
        ? `Zones: all ${roster.length} assigned.`
        : `Zones: ${noZone.length} of ${roster.length} NOT assigned yet — ` +
          `${noZone.map((t) => `${t.first_name} ${t.last_name}`.trim()).join(', ')}. ` +
          `They won't show up for their manager on Wednesday until they have one.`
    const classLink = siteUrl ? `${siteUrl}/classes/${cls.id}` : `/classes/${cls.id}`

    const smsBody =
      `[Training] ${triggerLabel} Time to create company emails for ${cls.region} · ${locationName}. ` +
      `${whoLine} ` +
      `Open the Provision page and click "Mark provisioning complete" when done: ${link}` +
      (zoneLine ? ` — ${zoneLine}` : '')
    const emailSubject =
      `Create company emails for ${cls.region} — Week A, ${presentToday.length || roster.length} trainee` +
      `${(presentToday.length || roster.length) === 1 ? '' : 's'} (week of ${cls.week_start_date})`
    const emailBody =
      `${triggerLabel}\n\n` +
      `Time to create company emails for ${cls.region} · ${locationName} (week of ${cls.week_start_date}).\n\n` +
      `${whoLine}\n\n` +
      `Open the Provision page and click "Mark provisioning complete" when done:\n${link}\n\n` +
      (zoneLine ? `${zoneLine}\nAssign zones on the class page:\n${classLink}\n\n` : '') +
      `— Training System`

    const { recipients, source } = await recipientsForEvent(supabase, 'day_2_provision_due', {
      legacyRole: 'it',
    })

    if (recipients.length === 0) {
      results.push({
        class_id: cls.id,
        region: cls.region,
        location: cls.locations?.name || null,
        fired: false,
        warning: 'No active IT subscribers found.',
        recipients_source: source,
      })
      continue
    }

    if (dryRun) {
      results.push({
        class_id: cls.id,
        region: cls.region,
        location: cls.locations?.name || null,
        dry_run: true,
        would_send_to: recipients.length,
        preview_sms: smsBody,
        preview_email_subject: emailSubject,
        trigger: hasSignIn ? 'first_sign_in' : 'fallback_hour',
      })
      continue
    }

    const r = await notifyAll(recipients, {
      smsBody,
      emailSubject,
      emailBody,
      contactLabel: 'IT',
    })

    await supabase
      .from('classes')
      .update({ day_2_it_notified_at: new Date().toISOString() })
      .eq('id', cls.id)

    firedCount++
    results.push({
      class_id: cls.id,
      region: cls.region,
      location: cls.locations?.name || null,
      fired: true,
      sms_sent: r.sms_sent,
      email_sent: r.email_sent,
      recipient_count: recipients.length,
      recipients_source: source,
      trigger: hasSignIn ? 'first_sign_in' : 'fallback_hour',
      ...(r.errors.length ? { errors: r.errors } : {}),
    })
  }

  return json(200, {
    target_date: today,
    current_hour: currentHour,
    classes_checked: day2Classes.length,
    classes_fired: firedCount,
    results,
  })
}

function computeFloridaToday() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
  return fmt.format(new Date())
}

function computeFloridaHour() {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const [h, m] = fmt.format(new Date()).split(':').map(Number)
  return (h === 24 ? 0 : h) + (m || 0) / 60
}

function addDaysIso(iso, days) {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  const base = new Date(y, m - 1, d)
  base.setDate(base.getDate() + days)
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
