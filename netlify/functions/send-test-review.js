// netlify/functions/send-test-review.js
//
// After a trainee submits the FINAL EXAM (TakeTest.jsx), text + email them a
// review of the multiple-choice questions they got WRONG, each paired with the
// correct answer (and what they picked). Essays are skipped — they have no
// "correct" answer. Fire-and-forget from the submit flow; never blocks the
// trainee from reaching their results page.
//
// Scoring is re-read server-side from test_responses + questions (never trust
// the client). Sends by BOTH channels — email reaches trainees whose SMS is
// blocked/opted-out in GHL.
//
// POST body: { trainee_id }   (resolves the trainee's latest submitted attempt)
// Response:  { ok, sent, missed_count, channels?, errors? }
//
// Required env: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN, GHL_LOCATION_ID
//   (+ RESEND_API_KEY / EMAIL_FROM for email — see _email.js)

import { createClient } from '@supabase/supabase-js'
import { sendSmsViaGhl } from './_ghl.js'
import { sendEmail } from './_email.js'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' })
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY']) {
    if (!process.env[k]) return json(500, { error: `Missing env: ${k}` })
  }

  let body
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Invalid JSON' }) }
  const trainee_id = body.trainee_id
  if (!trainee_id) return json(400, { error: 'trainee_id required' })

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  // 1. Trainee contact info.
  const { data: trainee } = await supabase
    .from('trainees').select('first_name, phone, email').eq('id', trainee_id).maybeSingle()
  if (!trainee) return json(404, { error: 'Trainee not found' })
  if (!trainee.phone && !trainee.email) return json(200, { ok: false, skipped: 'No phone or email on file' })

  // 2. Latest submitted attempt for this trainee.
  const { data: attempt } = await supabase
    .from('test_attempts')
    .select('id, correct_count, total_mc')
    .eq('trainee_id', trainee_id)
    .not('submitted_at', 'is', null)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!attempt) return json(200, { ok: false, skipped: 'No submitted attempt' })

  // 3. The MC questions they missed (is_correct = false).
  const { data: wrong } = await supabase
    .from('test_responses')
    .select('question_id, question_prompt, selected_choice')
    .eq('attempt_id', attempt.id)
    .eq('question_type', 'multiple_choice')
    .eq('is_correct', false)
  const missed = wrong || []

  // 4. Look up the correct answer for each missed question (authoritative).
  let correctById = {}
  if (missed.length) {
    const ids = missed.map((m) => m.question_id)
    const { data: qs } = await supabase
      .from('questions').select('id, prompt, correct_choice').in('id', ids)
    correctById = Object.fromEntries((qs || []).map((q) => [q.id, q]))
  }

  // 5. Compose. Perfect score gets a short congrats; otherwise the review list.
  const firstName = trainee.first_name || 'there'
  const score = attempt.total_mc ? `${attempt.correct_count}/${attempt.total_mc}` : null
  let message
  if (!missed.length) {
    message = `Hi ${firstName}, congratulations — you passed your final assessment${score ? ` with a perfect ${score}` : ''}! 🎉 Welcome to the team.`
  } else {
    const lines = [
      `Hi ${firstName}, here's your final assessment review${score ? ` (you scored ${score})` : ''}.`,
      `Questions to review (${missed.length}):`,
      '',
    ]
    missed.forEach((m, i) => {
      const q = correctById[m.question_id] || {}
      lines.push(`${i + 1}. ${q.prompt || m.question_prompt || 'Question'}`)
      if (m.selected_choice) lines.push(`   Your answer: ${m.selected_choice}`)
      lines.push(`   Correct answer: ${q.correct_choice || '(not set)'}`)
      lines.push('')
    })
    lines.push('Review these and you’ll have them down. Great work finishing the training!')
    message = lines.join('\n')
  }

  // 6. Send by both channels (best effort).
  const channels = []
  const errors = []
  if (trainee.email) {
    try {
      const r = await sendEmail(trainee.email, 'Your final assessment review — U.S. Shingle & Metal', message)
      if (r && r.ok !== false) channels.push('email'); else errors.push('email: ' + (r?.error || 'failed'))
    } catch (e) { errors.push('email: ' + (e.message || 'error')) }
  }
  if (trainee.phone) {
    const r = await sendSmsViaGhl(trainee.phone, message, { firstName, lastName: 'Assessment' })
    if (r.ok) channels.push('sms'); else errors.push('sms: ' + (r.error || 'failed'))
  }

  return json(200, { ok: channels.length > 0, sent: channels.length > 0, missed_count: missed.length, channels, errors: errors.length ? errors : undefined })
}

function json(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}
