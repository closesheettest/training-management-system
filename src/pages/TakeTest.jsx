import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'

export default function TakeTest() {
  const { token } = useParams()
  const [status, setStatus] = useState('loading') // loading | not_found | not_registered | ready | submitting | already_done
  const [trainee, setTrainee] = useState(null)
  const [classId, setClassId] = useState(null)
  const [questions, setQuestions] = useState([])
  const [answers, setAnswers] = useState({}) // question_id -> string
  const [error, setError] = useState(null)
  const [attemptId, setAttemptId] = useState(null)

  useEffect(() => {
    if (!token) {
      setStatus('not_found')
      return
    }
    load()
  }, [token])

  async function load() {
    setStatus('loading')
    // Look up trainee + their class
    const { data: t, error: trErr } = await supabase
      .from('trainees')
      .select('id, first_name, last_name, registered, enrolled, class_id, classes!class_id(week_start_date, week_end_date, locations(name))')
      .eq('registration_token', token)
      .maybeSingle()
    if (trErr || !t) {
      setStatus('not_found')
      return
    }
    if (!t.registered) {
      setStatus('not_registered')
      setTrainee(t)
      return
    }
    setTrainee(t)
    setClassId(t.class_id)

    // Has this trainee already submitted?
    const { data: existing } = await supabase
      .from('test_attempts')
      .select('id, submitted_at')
      .eq('trainee_id', t.id)
      .eq('class_id', t.class_id)
      .maybeSingle()
    if (existing?.submitted_at) {
      setAttemptId(existing.id)
      setStatus('already_done')
      return
    }

    // Load active questions in order
    const { data: qs } = await supabase
      .from('questions')
      .select('*')
      .eq('active', true)
      .order('order_index', { ascending: true })
    setQuestions(qs || [])
    setStatus('ready')
  }

  function setAnswer(questionId, value) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }))
  }

  async function submit() {
    setError(null)
    // Validation: every active question must have an answer (we keep it strict)
    const unanswered = questions.filter((q) => !((answers[q.id] || '').trim()))
    if (unanswered.length > 0) {
      setError(
        `Please answer all questions before submitting. Missing: ${unanswered.length} of ${questions.length}.`,
      )
      // Scroll to first unanswered
      const el = document.getElementById(`q-${unanswered[0].id}`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    setStatus('submitting')
    try {
      // 1. Create or fetch the attempt row
      let attempt
      const { data: existing } = await supabase
        .from('test_attempts')
        .select('*')
        .eq('trainee_id', trainee.id)
        .eq('class_id', classId)
        .maybeSingle()
      if (existing) {
        attempt = existing
      } else {
        const { data: created, error: aErr } = await supabase
          .from('test_attempts')
          .insert({ trainee_id: trainee.id, class_id: classId })
          .select()
          .single()
        if (aErr) throw aErr
        attempt = created
      }

      // 2. Build response rows + score
      let correctCount = 0
      let totalMc = 0
      const responseRows = questions.map((q) => {
        const answer = (answers[q.id] || '').trim()
        let is_correct = null
        let selected_choice = null
        let essay_response = null
        if (q.question_type === 'multiple_choice') {
          selected_choice = answer
          totalMc++
          if (q.correct_choice) {
            is_correct = answer === q.correct_choice
            if (is_correct) correctCount++
          } else {
            is_correct = null // no correct answer set (rating questions)
          }
        } else {
          essay_response = answer
        }
        return {
          attempt_id: attempt.id,
          question_id: q.id,
          question_prompt: q.prompt,
          question_type: q.question_type,
          selected_choice,
          is_correct,
          essay_response,
          use_for_testimonial: !!q.use_for_testimonial,
          use_for_client_review: !!q.use_for_client_review,
        }
      })

      // Replace any existing response rows for this attempt (idempotent submit)
      await supabase.from('test_responses').delete().eq('attempt_id', attempt.id)
      const { error: rErr } = await supabase.from('test_responses').insert(responseRows)
      if (rErr) throw rErr

      // 3. Update attempt with score + submitted_at
      const scorableMc = questions.filter(
        (q) => q.question_type === 'multiple_choice' && q.correct_choice,
      ).length
      const retentionPct = scorableMc > 0 ? Math.round((correctCount / scorableMc) * 100) : null

      const { error: uErr } = await supabase
        .from('test_attempts')
        .update({
          submitted_at: new Date().toISOString(),
          correct_count: correctCount,
          total_mc: scorableMc,
          retention_pct: retentionPct,
        })
        .eq('id', attempt.id)
      if (uErr) throw uErr

      // Submitting the final test is the moment a trainee graduates
      // into "active sales rep" — they're now on the sales team in the
      // field, eligible for company-wide group messages. Flip the flag
      // unless it's already on (re-submitting an existing test).
      // Best-effort: failure here doesn't block them from seeing their
      // results page. Admin can also flip it manually on /active-reps.
      await supabase
        .from('trainees')
        .update({
          is_active_sales_rep: true,
          became_active_rep_at: new Date().toISOString(),
        })
        .eq('id', trainee.id)
        .eq('is_active_sales_rep', false)

      // Fire-and-forget review-request email. Best effort — never blocks
      // the trainee from seeing their results page. If the email fails
      // (no email on file, Resend down, etc.) the in-page CTAs on /test/:token/done
      // still let them leave a review manually.
      fetch('/.netlify/functions/send-review-request-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trainee_id: trainee.id }),
      }).catch(() => {})

      // Fire-and-forget Facebook post of their best testimonial-eligible
      // essay (if any). Generic copy — no client company name. Best effort.
      fetch('/.netlify/functions/post-social-testimonial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trainee_id: trainee.id }),
      }).catch(() => {})

      // Fire-and-forget text with a vCard link so the trainee can save
      // their handoff contacts (Sales Manager + Helpline + anyone region-
      // matched) to their phone in one tap. Skipped silently if no
      // contacts are configured yet on /handoff-contacts.
      fetch('/.netlify/functions/send-handoff-contacts-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trainee_id: trainee.id }),
      }).catch(() => {})

      // Navigate to done page
      window.location.href = `/test/${token}/done`
    } catch (err) {
      setError(err.message || 'Something went wrong submitting your test.')
      setStatus('ready')
    }
  }

  if (status === 'loading') return <p className="text-slate-500">Loading…</p>

  if (status === 'not_found') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center">
        <h1 className="text-2xl font-semibold text-red-900">Link not found</h1>
        <p className="mt-2 text-red-800">This link may have expired or been mistyped.</p>
      </div>
    )
  }

  if (status === 'not_registered') {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-8 text-center">
        <h1 className="text-2xl font-semibold text-amber-900">Please register first</h1>
        <p className="mt-2 text-amber-800">
          You need to complete your training registration before taking the final test.
        </p>
      </div>
    )
  }

  if (status === 'already_done') {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-green-200 bg-green-50 p-8 text-center">
          <h1 className="text-2xl font-semibold text-green-900">You've already submitted this test</h1>
          <p className="mt-2 text-green-800">
            Once submitted, the test is locked. View your responses and review links:
          </p>
        </div>
        <div className="text-center">
          <Link
            to={`/test/${token}/done`}
            className="inline-block rounded-md bg-brand-navy px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-navy-dark"
          >
            See my results & review links →
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-brand-navy">
          Final Training Assessment
        </h1>
        <p className="mt-2 text-slate-600">
          {trainee?.first_name ? `Hi ${trainee.first_name} — ` : ''}
          this is the assessment for {trainee?.classes?.locations?.name || 'your training'}. It
          checks what you retained and gives you a chance to share what you learned. Answer all
          questions, then submit.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <ol className="space-y-5">
        {questions.map((q, i) => (
          <li key={q.id} id={`q-${q.id}`} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Question {i + 1} of {questions.length}
              {q.question_type === 'essay' && (
                <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-800">
                  Essay
                </span>
              )}
            </div>
            <p className="mt-2 text-base font-medium text-slate-900">{q.prompt}</p>

            {q.question_type === 'multiple_choice' ? (
              <ul className="mt-3 space-y-2">
                {(q.choices || []).map((c) => (
                  <li key={c}>
                    <label className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50">
                      <input
                        type="radio"
                        name={`q-${q.id}`}
                        value={c}
                        checked={answers[q.id] === c}
                        onChange={() => setAnswer(q.id, c)}
                        className="mt-0.5 h-4 w-4 text-brand-navy focus:ring-brand-navy"
                      />
                      <span className="flex-1">{c}</span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <textarea
                rows={5}
                value={answers[q.id] || ''}
                onChange={(e) => setAnswer(q.id, e.target.value)}
                placeholder="Write your answer in your own words…"
                className="mt-3 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
              />
            )}
          </li>
        ))}
      </ol>

      <div className="sticky bottom-4 z-10 flex justify-end">
        <button
          onClick={submit}
          disabled={status === 'submitting'}
          className="rounded-md bg-brand-navy px-6 py-3 text-base font-semibold text-white shadow-lg hover:bg-brand-navy-dark disabled:opacity-50"
        >
          {status === 'submitting' ? 'Submitting…' : 'Submit test'}
        </button>
      </div>
    </div>
  )
}
