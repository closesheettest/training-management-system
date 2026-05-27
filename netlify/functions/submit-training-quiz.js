// netlify/functions/submit-training-quiz.js
//
// Receives a quiz submission from Quiz.jsx (the public /quiz/:token page)
// and saves the score + per-question answers to training_day_attempts.
// Server-side scoring is intentional — never trust the client's "I got
// this right" flag. We load the question bank with correct_index here
// and grade against it.
//
// USAGE:
//   POST /.netlify/functions/submit-training-quiz
//   Body: { token, answers: [{ question_id, selected_index }, ...] }
//
// Returns: { ok, score, total, breakdown: [{question_id, correct_index, selected_index, is_correct, question_text, options}] }
//   The breakdown is what Quiz.jsx renders on the "results" view —
//   trainees see which they got right + the correct answer for any
//   they missed.

import { createClient } from '@supabase/supabase-js'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' })

  const missing = []
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY']) {
    if (!process.env[k]) missing.push(k)
  }
  if (missing.length) return json(500, { error: `Missing env: ${missing.join(', ')}` })

  let body
  try { body = JSON.parse(event.body || '{}') }
  catch { return json(400, { error: 'Invalid JSON' }) }

  const { token, answers } = body
  if (!token || !Array.isArray(answers)) {
    return json(400, { error: 'token + answers[] required' })
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  // 1. Resolve attempt by token. Reject expired / already-completed.
  const { data: attempt, error: aErr } = await supabase
    .from('training_day_attempts')
    .select('id, day_number, quiz_completed_at, trainee_id, class_id')
    .eq('quiz_token', token)
    .maybeSingle()
  if (aErr) return json(500, { error: aErr.message })
  if (!attempt) return json(404, { error: 'Quiz token not found' })
  if (attempt.quiz_completed_at) {
    return json(409, { error: 'This quiz was already submitted.' })
  }

  // 2. Load the question bank with correct_index — the authority.
  const { data: questions, error: qErr } = await supabase
    .from('training_day_quiz_questions')
    .select('id, position, question_text, options, correct_index')
    .eq('day_number', attempt.day_number)
    .order('position', { ascending: true })
  if (qErr) return json(500, { error: qErr.message })
  if (!questions || questions.length === 0) {
    return json(500, { error: 'No questions found for this day — quiz cannot be scored.' })
  }

  // 3. Build a lookup of submitted selections by question_id (last-wins
  //    if the client sent duplicates).
  const selectedByQ = new Map()
  for (const a of answers) {
    if (a && a.question_id !== undefined) {
      selectedByQ.set(a.question_id, Number(a.selected_index))
    }
  }

  // 4. Grade. Each question contributes 0 or 1 — straightforward MC.
  //    "Unanswered" counts as wrong (selected_index=-1) so partial
  //    submissions don't artificially inflate scores.
  let correct = 0
  const breakdown = questions.map((q) => {
    const sel = selectedByQ.has(q.id) ? selectedByQ.get(q.id) : -1
    const isCorrect = sel === q.correct_index
    if (isCorrect) correct++
    return {
      question_id: q.id,
      question_text: q.question_text,
      options: q.options,
      correct_index: q.correct_index,
      selected_index: sel,
      is_correct: isCorrect,
    }
  })
  const total = questions.length

  // 5. Persist to the attempt row. quiz_answers stores the breakdown
  //    minus the question_text/options snapshot — those re-load from
  //    the questions table for admin views. Keeping the row compact.
  const nowIso = new Date().toISOString()
  const compactAnswers = breakdown.map((b) => ({
    question_id: b.question_id,
    selected_index: b.selected_index,
    is_correct: b.is_correct,
  }))
  const { error: upErr } = await supabase
    .from('training_day_attempts')
    .update({
      quiz_completed_at: nowIso,
      quiz_score: correct,
      quiz_total: total,
      quiz_answers: compactAnswers,
      updated_at: nowIso,
    })
    .eq('id', attempt.id)
  if (upErr) return json(500, { error: `Could not save score: ${upErr.message}` })

  return json(200, { ok: true, score: correct, total, breakdown })
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
