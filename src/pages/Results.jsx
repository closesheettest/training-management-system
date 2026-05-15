import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'

// Public trainee-facing results page. Reached via a personal link
// sent by SMS from the Class detail page ("Send results" button).
// The token (registration_token) is the gate — only the trainee with
// that token can see their own results.
//
// Layout matches the admin AttemptDetail view conceptually but
// framed for the trainee themselves: "Here's how you did" + their
// own answers with right / wrong / correct-answer highlighted.

export default function Results() {
  const { token } = useParams()
  const [status, setStatus] = useState('loading') // loading | not_found | not_submitted | ready
  const [trainee, setTrainee] = useState(null)
  const [attempt, setAttempt] = useState(null)
  const [responses, setResponses] = useState([])

  useEffect(() => {
    if (!token) {
      setStatus('not_found')
      return
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  async function load() {
    setStatus('loading')

    // Demo mode for previewing from /messages — synthesizes a small
    // example without hitting the DB.
    if (token === 'demo') {
      setTrainee({ first_name: 'Sample', last_name: 'Attendee' })
      setAttempt({
        submitted_at: new Date().toISOString(),
        correct_count: 17,
        total_mc: 20,
        retention_pct: 85,
      })
      setResponses([
        {
          id: 'demo-1',
          question_type: 'multiple_choice',
          question_prompt: 'What is the purpose of the warm-up?',
          selected_choice: 'Build rapport and find common ground',
          is_correct: true,
          questions: {
            correct_choice: 'Build rapport and find common ground',
            choices: [
              'Build rapport and find common ground',
              'Pitch the product immediately',
              'Ask about their budget',
              'Get a signature on the contract',
            ],
            order_index: 1,
          },
        },
        {
          id: 'demo-2',
          question_type: 'multiple_choice',
          question_prompt: "When is the right time to introduce price?",
          selected_choice: 'Right after the warm-up',
          is_correct: false,
          questions: {
            correct_choice: "After they've seen the full value",
            choices: [
              "After they've seen the full value",
              'As soon as you knock on the door',
              'Right after the warm-up',
              'Never — let them ask first',
            ],
            order_index: 2,
          },
        },
        {
          id: 'demo-3',
          question_type: 'essay',
          question_prompt: 'After training, what will you do differently?',
          essay_response:
            'Slow down on the warm-up, read body language before pitching, and never lead with price.',
        },
      ])
      setStatus('ready')
      return
    }

    const { data: t, error: tErr } = await supabase
      .from('trainees')
      .select('id, first_name, last_name, registration_token, classes(region, week_start_date)')
      .eq('registration_token', token)
      .maybeSingle()
    if (tErr || !t) {
      setStatus('not_found')
      return
    }
    setTrainee(t)

    const { data: a } = await supabase
      .from('test_attempts')
      .select('id, submitted_at, correct_count, total_mc, retention_pct')
      .eq('trainee_id', t.id)
      .not('submitted_at', 'is', null)
      .maybeSingle()
    if (!a) {
      setStatus('not_submitted')
      return
    }
    setAttempt(a)

    const { data: r } = await supabase
      .from('test_responses')
      .select(
        'id, question_prompt, question_type, selected_choice, is_correct, essay_response, questions(correct_choice, choices, order_index)',
      )
      .eq('attempt_id', a.id)
    const sorted = (r || []).slice().sort((x, y) => {
      const xi = x.questions?.order_index ?? 999
      const yi = y.questions?.order_index ?? 999
      return xi - yi
    })
    setResponses(sorted)
    setStatus('ready')
  }

  if (status === 'loading') return <p className="text-sm text-slate-500">Loading your results…</p>
  if (status === 'not_found') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center">
        <h1 className="text-2xl font-semibold text-red-900">Results link not found</h1>
        <p className="mt-2 text-red-800">
          This link may have expired or been mistyped. Please check the text message you
          received, or contact your trainer.
        </p>
      </div>
    )
  }
  if (status === 'not_submitted') {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-8 text-center">
        <h1 className="text-2xl font-semibold text-amber-900">No test submitted yet</h1>
        <p className="mt-2 text-amber-800">
          Looks like you haven't finished your final test yet. Once you submit, your results
          will show up here.
        </p>
      </div>
    )
  }

  const mc = responses.filter((r) => r.question_type === 'multiple_choice')
  const essays = responses.filter((r) => r.question_type === 'essay')
  const wrongCount = mc.filter((r) => r.is_correct === false).length

  return (
    <div className="space-y-6">
      <header className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          {trainee?.first_name ? `${trainee.first_name}'s ` : ''}Final test results
        </h1>
        <p className="mt-2 text-slate-600">
          See exactly which questions you got right and which to revisit.
        </p>
      </header>

      {attempt?.total_mc > 0 && (
        <div className="rounded-xl border-2 border-brand-navy bg-white p-5 text-center shadow-sm">
          <div className="text-5xl font-extrabold text-brand-navy">
            {attempt.correct_count}
            <span className="text-3xl text-slate-400">/{attempt.total_mc}</span>
          </div>
          {attempt.retention_pct != null && (
            <div className="mt-1 text-base font-semibold text-slate-700">
              {attempt.retention_pct}% retention
            </div>
          )}
          <div className="mt-2 text-xs text-slate-500">
            Submitted {new Date(attempt.submitted_at).toLocaleString()}
          </div>
        </div>
      )}

      {mc.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">
            Multiple choice
            <span className="ml-2 text-sm font-medium text-slate-500">
              ({mc.length - wrongCount} right · {wrongCount} wrong)
            </span>
          </h2>
          <ol className="space-y-3">
            {mc.map((r, i) => {
              const correct = r.questions?.correct_choice
              const choices = Array.isArray(r.questions?.choices) ? r.questions.choices : []
              const noKey = correct === null || correct === undefined || correct === ''
              return (
                <li
                  key={r.id}
                  className={
                    'rounded-lg border p-4 shadow-sm ' +
                    (r.is_correct === true
                      ? 'border-emerald-300 bg-emerald-50'
                      : r.is_correct === false
                        ? 'border-red-300 bg-red-50'
                        : 'border-slate-200 bg-white')
                  }
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <span className="text-xs font-semibold text-slate-500">Q{i + 1}.</span>{' '}
                      <span className="font-semibold text-slate-900">{r.question_prompt}</span>
                    </div>
                    {noKey ? null : r.is_correct === true ? (
                      <span className="shrink-0 rounded-full bg-emerald-600 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
                        ✓ Correct
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-red-600 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
                        ✗ Wrong
                      </span>
                    )}
                  </div>
                  <div className="mt-3 space-y-1 text-sm">
                    {choices.length > 0 ? (
                      choices.map((c) => {
                        const isSelected = c === r.selected_choice
                        const isCorrect = !noKey && c === correct
                        return (
                          <div
                            key={c}
                            className={
                              'rounded-md px-3 py-2 ' +
                              (isCorrect
                                ? 'bg-white font-semibold text-emerald-900 ring-2 ring-emerald-400'
                                : isSelected
                                  ? 'bg-white font-medium text-red-900 ring-2 ring-red-400'
                                  : 'text-slate-700')
                            }
                          >
                            {isCorrect && <span className="mr-1">✓</span>}
                            {isSelected && !isCorrect && <span className="mr-1">✗</span>}
                            {c}
                            {isSelected && (
                              <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                (your answer)
                              </span>
                            )}
                            {isCorrect && !isSelected && (
                              <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                                (correct answer)
                              </span>
                            )}
                          </div>
                        )
                      })
                    ) : (
                      <div className="text-slate-600">
                        Your answer: <strong>{r.selected_choice || '— blank —'}</strong>
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        </section>
      )}

      {essays.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">Your essay answers</h2>
          <ol className="space-y-3">
            {essays.map((r, i) => (
              <li
                key={r.id}
                className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex-1">
                  <span className="text-xs font-semibold text-slate-500">E{i + 1}.</span>{' '}
                  <span className="font-semibold text-slate-900">{r.question_prompt}</span>
                </div>
                <div className="mt-2 whitespace-pre-wrap rounded-md bg-slate-50 px-3 py-2 text-sm italic text-slate-700">
                  {r.essay_response?.trim() ? `"${r.essay_response.trim()}"` : '— you left this blank —'}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <footer className="rounded-md border border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-500">
        Questions about your results? Reach out to your trainer.
      </footer>
    </div>
  )
}
