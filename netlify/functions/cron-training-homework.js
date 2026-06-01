// netlify/functions/cron-training-homework.js
//
// Nightly cron — fires the day's homework SMS to every trainee in every
// active training class who actually attended today. Per the user's
// strict-attendance policy, no-shows get no homework (they shouldn't be
// continuing anyway).
//
// Schedule: 20:30 UTC = 4:30 PM EDT / 3:30 PM EST. Runs daily. Quiet
// (no SMS, no errors) when nothing matches — e.g. weekends, between
// classes, or for the last day of a class (graduation day, no homework).
//
// Why 4:30 PM ET: training day ends at 4 PM ET (noon-4 on Mondays;
// 8-4 the rest of the week), so 4:30 lands ~30 min after dismissal
// while everyone's still on the way home and the topic is fresh.
//
// DST note: Netlify cron is UTC-only. 20:30 UTC tracks EDT (mid-March
// through early November). When clocks fall back to EST, the cron will
// fire at 3:30 PM ET instead. To keep 4:30 PM ET year-round, flip the
// schedule below to '30 21 * * *' (= 4:30 PM EST) when DST ends in Nov.
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

  const todayIso = ymd(new Date())

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
      .select('trainee_id, trainees(id, first_name, phone)')
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
      if (!t.phone) {
        skipped.push({ trainee_id: t.id, reason: 'No phone' })
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

      const smsRes = await sendSmsViaGhl(t.phone, message, {
        firstName,
        lastName: 'Homework',
      })
      if (!smsRes.ok) {
        errors.push({ trainee_id: t.id, error: smsRes.error })
        continue
      }

      // Stamp attempt row.
      const nowIso = new Date().toISOString()
      if (existing) {
        await supabase
          .from('training_day_attempts')
          .update({ homework_sent_at: nowIso, updated_at: nowIso })
          .eq('id', existing.id)
      } else {
        await supabase.from('training_day_attempts').insert({
          trainee_id: t.id,
          class_id: cls.id,
          day_number: dayNumber,
          homework_sent_at: nowIso,
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

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

// Netlify v2 scheduled function — daily at 20:30 UTC (4:30 PM EDT / 3:30 PM EST).
// See header comment for DST handling — bump to '30 21 * * *' in November.
export const config = { schedule: '30 20 * * *' }
