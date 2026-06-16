// netlify/functions/send-training-quiz.js
//
// Fires the morning mini-quiz SMS to a trainee right after they sign in
// at the kiosk. Called from Kiosk.jsx's signIn() handler. Idempotent —
// safe to call multiple times for the same trainee + day (only fires
// once because we check quiz_sent_at before composing the SMS).
//
// RULES (the user's spec):
//   • Day 1 has no quiz (nothing to test the day before).
//   • Quiz tests PREVIOUS day's content — so sign-in on Day N fires
//     quiz_questions where day_number = N-1.
//   • Strict attendance gate: trainee must have attended yesterday
//     (confirmed=true on that date) or no quiz fires. Matches the
//     "skip no-shows" decision we locked in for Phase 1.
//   • Skipped silently when the day's lesson is disabled OR has zero
//     questions authored. Lets admin populate content gradually
//     without firing half-built quizzes.
//
// USAGE:
//   POST /.netlify/functions/send-training-quiz
//   Body: { class_id, trainee_id }
//
// Returns: { ok, sent, skipped, quiz_token? } so the caller can log /
// surface state but isn't expected to block on it.

import { createClient } from '@supabase/supabase-js'
import { sendSmsViaGhl } from './_ghl.js'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' })

  const missing = []
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'GHL_PIT_TOKEN', 'GHL_LOCATION_ID']) {
    if (!process.env[k]) missing.push(k)
  }
  if (missing.length) return json(500, { error: `Missing env: ${missing.join(', ')}` })

  let body
  try { body = JSON.parse(event.body || '{}') }
  catch { return json(400, { error: 'Invalid JSON' }) }

  const { class_id, trainee_id } = body
  if (!class_id || !trainee_id) return json(400, { error: 'class_id and trainee_id required' })

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const siteUrl = (
    process.env.PUBLIC_SITE_URL || process.env.URL || 'https://trainingmanagementsys.netlify.app'
  ).replace(/\/$/, '')

  // 1. Fetch class for week_start_date — we use it to compute day_number.
  const { data: cls, error: clsErr } = await supabase
    .from('classes')
    .select('week_start_date, week_end_date, attendance_only')
    .eq('id', class_id)
    .maybeSingle()
  if (clsErr || !cls) return json(404, { error: 'Class not found' })
  if (cls.attendance_only) return json(200, { ok: true, skipped: 'attendance-only class' })

  // 2. Compute today's day_number for this class. Day 1 = class start.
  const todayIso = ymd(new Date())
  const todayDayNumber = daysBetween(cls.week_start_date, todayIso) + 1
  if (todayDayNumber < 2) {
    return json(200, { ok: true, skipped: 'Day 1 has no previous-day quiz' })
  }
  const quizDayNumber = todayDayNumber - 1

  // 3. Lesson must be enabled + have questions, else nothing to send.
  const { data: lesson } = await supabase
    .from('training_day_lessons')
    .select('day_number, enabled')
    .eq('day_number', quizDayNumber)
    .maybeSingle()
  if (!lesson?.enabled) return json(200, { ok: true, skipped: `Day ${quizDayNumber} disabled` })
  const { data: questions, error: qErr } = await supabase
    .from('training_day_quiz_questions')
    .select('id')
    .eq('day_number', quizDayNumber)
  if (qErr) return json(500, { error: qErr.message })
  if (!questions || questions.length === 0) {
    return json(200, { ok: true, skipped: `No questions for day ${quizDayNumber}` })
  }

  // 4. Attendance gate — they must have attended YESTERDAY (per strict
  //    policy). Today's sign-in is what triggered us; we don't double
  //    check that here.
  const yesterdayIso = ymd(addDays(new Date(todayIso), -1))
  const { data: yesterdayAtt } = await supabase
    .from('attendance')
    .select('confirmed')
    .eq('trainee_id', trainee_id)
    .eq('class_id', class_id)
    .eq('attendance_date', yesterdayIso)
    .eq('confirmed', true)
    .maybeSingle()
  if (!yesterdayAtt) {
    return json(200, { ok: true, skipped: 'Trainee did not attend yesterday' })
  }

  // 5. If we already sent for this trainee + day, don't double-fire.
  const { data: existing } = await supabase
    .from('training_day_attempts')
    .select('id, quiz_sent_at, quiz_token')
    .eq('trainee_id', trainee_id)
    .eq('day_number', quizDayNumber)
    .maybeSingle()
  if (existing?.quiz_sent_at) {
    return json(200, {
      ok: true,
      skipped: 'Quiz already sent today',
      quiz_token: existing.quiz_token,
    })
  }

  // 6. Generate token + create-or-update the attempt row.
  const quizToken = randomToken()
  const nowIso = new Date().toISOString()
  let attemptId = existing?.id
  if (existing) {
    const { error: upErr } = await supabase
      .from('training_day_attempts')
      .update({ quiz_token: quizToken, quiz_sent_at: nowIso, updated_at: nowIso })
      .eq('id', existing.id)
    if (upErr) return json(500, { error: `Could not update attempt: ${upErr.message}` })
  } else {
    const { data: inserted, error: inErr } = await supabase
      .from('training_day_attempts')
      .insert({
        trainee_id,
        class_id,
        day_number: quizDayNumber,
        quiz_token: quizToken,
        quiz_sent_at: nowIso,
      })
      .select('id')
      .single()
    if (inErr) return json(500, { error: `Could not create attempt: ${inErr.message}` })
    attemptId = inserted.id
  }

  // 7. Trainee phone + first name for the SMS.
  const { data: trainee } = await supabase
    .from('trainees')
    .select('first_name, phone')
    .eq('id', trainee_id)
    .maybeSingle()
  if (!trainee?.phone) {
    return json(200, { ok: true, skipped: 'Trainee has no phone on file', quiz_token: quizToken })
  }

  // 8. Compose + send. Keeps the body short — 2 SMS segments max.
  const firstName = trainee.first_name || 'there'
  const message =
    `Good morning ${firstName}! Quick quiz on yesterday's training (${questions.length} questions, ~2 min): ` +
    `${siteUrl}/quiz/${quizToken}`

  const smsRes = await sendSmsViaGhl(trainee.phone, message, {
    firstName,
    lastName: 'Trainee Quiz',
  })
  if (!smsRes.ok) {
    return json(500, {
      ok: false,
      error: `SMS send failed: ${smsRes.error || 'unknown'}`,
      attempt_id: attemptId,
    })
  }

  // Record the GHL message id so cron-check-sms-delivery can verify the quiz
  // text actually DELIVERED (GHL accepting a send ≠ the carrier delivering it).
  if (attemptId && smsRes.messageId) {
    await supabase
      .from('training_day_attempts')
      .update({ quiz_message_id: smsRes.messageId, quiz_delivery_status: null, quiz_delivery_checked_at: null })
      .eq('id', attemptId)
  }

  return json(200, { ok: true, sent: true, quiz_token: quizToken, day_number: quizDayNumber })
}

// ────────────────────────────────────────────────────────────────────
// Helpers

function ymd(d) {
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function addDays(d, n) {
  const x = new Date(d)
  x.setUTCDate(x.getUTCDate() + n)
  return x
}

function daysBetween(fromIso, toIso) {
  const f = new Date(fromIso + 'T00:00:00Z')
  const t = new Date(toIso + 'T00:00:00Z')
  return Math.round((t - f) / 86400000)
}

// 22-char random URL-safe token. Plenty of entropy for a quiz link
// that lives ~24h.
function randomToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < 22; i++) out += chars.charAt(Math.floor(Math.random() * chars.length))
  return out
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
