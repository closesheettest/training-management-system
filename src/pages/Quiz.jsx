import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'

// /quiz/:token — public page trainees land on from the morning-quiz SMS.
// Token-gated (anyone with the link gets in). Three states:
//
//   1. Loading      — fetching the attempt + questions.
//   2. Taking quiz  — multiple choice, one question per row, no skipping.
//   3. Results      — server-graded breakdown showing right/wrong + the
//                     correct answer for any they missed.
//
// Scoring happens server-side in /.netlify/functions/submit-training-quiz
// so client can't fake a perfect score. We just collect selections and
// hand them off.

export default function Quiz() {
  const { token } = useParams()
  const [status, setStatus] = useState('loading') // 'loading' | 'taking' | 'results' | 'error' | 'done'
  const [attempt, setAttempt] = useState(null)
  const [questions, setQuestions] = useState([])
  const [answers, setAnswers] = useState({}) // { [question_id]: selected_index }
  const [result, setResult] = useState(null)
  const [errorText, setErrorText] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  async function load() {
    setStatus('loading')
    // 1. Lookup attempt by token. Includes trainee first_name for the
    //    "Hi {firstName}" header.
    const { data: att, error: aErr } = await supabase
      .from('training_day_attempts')
      .select(
        'id, day_number, quiz_started_at, quiz_completed_at, quiz_score, quiz_total, quiz_answers, trainees(first_name)',
      )
      .eq('quiz_token', token)
      .maybeSingle()
    if (aErr) {
      setErrorText(aErr.message)
      setStatus('error')
      return
    }
    if (!att) {
      setErrorText('Quiz link not found. It may have expired or been mistyped.')
      setStatus('error')
      return
    }
    setAttempt(att)

    // 2. Load questions. For an already-completed attempt we load with
    //    correct_index for the breakdown view; for an in-progress one
    //    we omit correct_index so it doesn't leak via DevTools.
    const wantCorrect = !!att.quiz_completed_at
    const { data: qs, error: qErr } = await supabase
      .from('training_day_quiz_questions')
      .select(
        wantCorrect
          ? 'id, position, question_text, options, correct_index'
          : 'id, position, question_text, options',
      )
      .eq('day_number', att.day_number)
      .order('position', { ascending: true })
    if (qErr) {
      setErrorText(qErr.message)
      setStatus('error')
      return
    }
    setQuestions(qs || [])

    // 3. If already completed, show results immediately. Reconstruct the
    //    breakdown from saved quiz_answers + question bank.
    if (att.quiz_completed_at) {
      const selBy = new Map(
        (att.quiz_answers || []).map((a) => [a.question_id, a.selected_index]),
      )
      const breakdown = (qs || []).map((q) => ({
        question_id: q.id,
        question_text: q.question_text,
        options: q.options,
        correct_index: q.correct_index,
        selected_index: selBy.has(q.id) ? selBy.get(q.id) : -1,
        is_correct: selBy.get(q.id) === q.correct_index,
      }))
      setResult({ score: att.quiz_score, total: att.quiz_total, breakdown })
      setStatus('results')
      return
    }

    // 4. Stamp started_at on first open (best-effort; ignore errors).
    if (!att.quiz_started_at) {
      supabase
        .from('training_day_attempts')
        .update({ quiz_started_at: new Date().toISOString() })
        .eq('id', att.id)
        .then(() => {})
    }
    setStatus('taking')
  }

  function pick(questionId, optionIndex) {
    setAnswers((prev) => ({ ...prev, [questionId]: optionIndex }))
  }

  async function submit() {
    if (submitting) return
    setSubmitting(true)
    const payload = {
      token,
      answers: questions.map((q) => ({
        question_id: q.id,
        selected_index: answers[q.id] ?? -1,
      })),
    }
    try {
      const res = await fetch('/.netlify/functions/submit-training-quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setErrorText(data.error || `HTTP ${res.status}`)
        setStatus('error')
        return
      }
      setResult({ score: data.score, total: data.total, breakdown: data.breakdown })
      setStatus('results')
    } catch (e) {
      setErrorText(e.message || 'Network error')
      setStatus('error')
    } finally {
      setSubmitting(false)
    }
  }

  const firstName = attempt?.trainees?.first_name || 'there'
  const answeredCount = Object.keys(answers).length
  const totalQuestions = questions.length
  const allAnswered = answeredCount === totalQuestions && totalQuestions > 0

  if (status === 'loading') {
    return <p className="text-center text-sm text-slate-500 mt-10">Loading quiz…</p>
  }

  if (status === 'error') {
    return (
      <div className="mx-auto max-w-md p-6 mt-8 rounded-lg border border-red-200 bg-red-50 text-red-800">
        <h2 className="text-lg font-semibold">Something went wrong</h2>
        <p className="mt-2 text-sm">{errorText}</p>
      </div>
    )
  }

  if (status === 'results') {
    const score = result?.score ?? 0
    const total = result?.total ?? 0
    const pct = total > 0 ? Math.round((score / total) * 100) : 0
    const passed = pct >= 80
    return (
      <div className="mx-auto max-w-2xl p-6 space-y-6">
        <div
          className={
            'rounded-lg p-5 ' +
            (passed
              ? 'border-2 border-emerald-300 bg-emerald-50 text-emerald-900'
              : 'border-2 border-amber-300 bg-amber-50 text-amber-900')
          }
        >
          <div className="text-lg font-semibold">
            {passed ? '🎉 Nice work, ' : '📚 Worth a re-read, '}
            {firstName}
          </div>
          <div className="mt-1 text-3xl font-bold">
            {score}/{total} · {pct}%
          </div>
          <div className="mt-2 text-sm">
            {passed
              ? 'You internalized yesterday\'s material — keep that energy today.'
              : 'A couple to revisit. Scroll down for the correct answers — review them before today\'s session.'}
          </div>
        </div>
        <ol className="space-y-4">
          {(result?.breakdown || []).map((b, idx) => (
            <li
              key={b.question_id}
              className={
                'rounded-lg border p-4 ' +
                (b.is_correct
                  ? 'border-emerald-200 bg-emerald-50'
                  : 'border-red-200 bg-red-50')
              }
            >
              <div className="flex items-start gap-2">
                <span
                  className={
                    'inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ' +
                    (b.is_correct ? 'bg-emerald-200 text-emerald-900' : 'bg-red-200 text-red-900')
                  }
                >
                  {b.is_correct ? '✓' : '✗'} Q{idx + 1}
                </span>
                <div className="flex-1">
                  <div className="font-semibold text-slate-900">{b.question_text}</div>
                  <ul className="mt-2 space-y-1.5 text-sm">
                    {(b.options || []).map((opt, i) => {
                      const isYours = i === b.selected_index
                      const isCorrect = i === b.correct_index
                      let chip = null
                      if (isCorrect) {
                        chip = (
                          <span className="ml-2 rounded-full bg-emerald-200 px-2 py-0.5 text-[10px] font-bold text-emerald-900">
                            Correct
                          </span>
                        )
                      } else if (isYours) {
                        chip = (
                          <span className="ml-2 rounded-full bg-red-200 px-2 py-0.5 text-[10px] font-bold text-red-900">
                            Your answer
                          </span>
                        )
                      }
                      return (
                        <li
                          key={i}
                          className={
                            'rounded-md px-3 py-2 ' +
                            (isCorrect
                              ? 'bg-emerald-100'
                              : isYours
                                ? 'bg-red-100'
                                : 'bg-white border border-slate-200')
                          }
                        >
                          <span>{opt}</span>
                          {chip}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              </div>
            </li>
          ))}
        </ol>
        <p className="text-center text-xs text-slate-500">
          Quiz for Day {attempt?.day_number} content. Show this screen to Neal if you'd like to walk through it together.
        </p>
      </div>
    )
  }

  // status === 'taking'
  return (
    <div className="mx-auto max-w-2xl p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Good morning, {firstName}!</h1>
        <p className="mt-1 text-sm text-slate-600">
          Quick check on yesterday's material. Pick one answer per question — there's no time limit.
        </p>
      </header>
      <ol className="space-y-5">
        {questions.map((q, idx) => (
          <li key={q.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start gap-2">
              <span className="inline-block rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                Q{idx + 1}
              </span>
              <div className="flex-1 font-semibold text-slate-900">{q.question_text}</div>
            </div>
            <ul className="mt-3 space-y-2">
              {(q.options || []).map((opt, i) => {
                const selected = answers[q.id] === i
                return (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => pick(q.id, i)}
                      className={
                        'w-full text-left rounded-md border px-3 py-2 text-sm transition ' +
                        (selected
                          ? 'border-emerald-500 bg-emerald-50 font-semibold text-emerald-900'
                          : 'border-slate-300 bg-white hover:border-emerald-300 hover:bg-emerald-50')
                      }
                    >
                      <span
                        className={
                          'inline-block h-4 w-4 rounded-full border-2 mr-2 align-middle ' +
                          (selected ? 'border-emerald-600 bg-emerald-500' : 'border-slate-300')
                        }
                      />
                      {opt}
                    </button>
                  </li>
                )
              })}
            </ul>
          </li>
        ))}
      </ol>
      <div className="sticky bottom-0 bg-white/95 backdrop-blur border-t border-slate-200 p-4 -mx-6">
        <div className="mx-auto max-w-2xl flex items-center justify-between gap-3">
          <span className="text-sm text-slate-600">
            {answeredCount} of {totalQuestions} answered
          </span>
          <button
            type="button"
            onClick={submit}
            disabled={!allAnswered || submitting}
            className="rounded-md bg-emerald-700 px-6 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {submitting ? 'Scoring…' : allAnswered ? 'Submit quiz' : `Answer all ${totalQuestions} to submit`}
          </button>
        </div>
      </div>
    </div>
  )
}
