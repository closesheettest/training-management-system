import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'

// These are baked in from Neal's review URLs. If they change, update here.
const GOOGLE_REVIEW_URL = 'https://g.page/r/CYeQXuq6eOfTEAI/review'
const YELP_REVIEW_URL =
  'https://www.yelp.com/writeareview/biz/CPWQA_SoEVdP8Swql9keWQ?return_url=%2Fbiz%2FCPWQA_SoEVdP8Swql9keWQ&review_origin=biz-details-war-button'

export default function TestDone() {
  const { token } = useParams()
  const [status, setStatus] = useState('loading')
  const [trainee, setTrainee] = useState(null)
  const [attempt, setAttempt] = useState(null)
  const [responses, setResponses] = useState([])

  useEffect(() => {
    if (!token) {
      setStatus('not_found')
      return
    }
    load()
  }, [token])

  async function load() {
    const { data: t } = await supabase
      .from('trainees')
      .select('id, first_name, class_id')
      .eq('registration_token', token)
      .maybeSingle()
    if (!t) {
      setStatus('not_found')
      return
    }
    setTrainee(t)

    const { data: a } = await supabase
      .from('test_attempts')
      .select('*')
      .eq('trainee_id', t.id)
      .eq('class_id', t.class_id)
      .maybeSingle()
    if (!a || !a.submitted_at) {
      setStatus('not_submitted')
      return
    }
    setAttempt(a)

    const { data: r } = await supabase
      .from('test_responses')
      .select('*')
      .eq('attempt_id', a.id)
      .order('id', { ascending: true })
    setResponses(r || [])
    setStatus('ready')
  }

  if (status === 'loading') return <p className="text-slate-500">Loading…</p>

  if (status === 'not_found') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center">
        <h1 className="text-2xl font-semibold text-red-900">Link not found</h1>
      </div>
    )
  }

  if (status === 'not_submitted') {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-8 text-center">
        <h1 className="text-2xl font-semibold text-amber-900">No submitted test yet</h1>
        <p className="mt-2 text-amber-800">Complete your test first, then this page will show your results.</p>
      </div>
    )
  }

  const essays = responses.filter((r) => r.question_type === 'essay' && r.essay_response)
  const testimonialEssays = essays.filter((r) => r.use_for_testimonial)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-brand-navy">
          Thanks{trainee?.first_name ? `, ${trainee.first_name}` : ''}!
        </h1>
        <p className="mt-2 text-slate-600">
          Your training is complete. Here's how you did, plus an easy way to share your experience.
        </p>
      </div>

      {/* Retention score */}
      {attempt.total_mc > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-baseline gap-3">
            <span className="text-4xl font-bold text-brand-navy">
              {attempt.correct_count}/{attempt.total_mc}
            </span>
            {attempt.retention_pct != null && (
              <span className="text-xl font-semibold text-slate-500">
                ({attempt.retention_pct}%)
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-600">
            That's how many key training points you retained. Strong start — keep it up in the
            field.
          </p>
        </div>
      )}

      {/* Review CTA */}
      {testimonialEssays.length > 0 && (
        <section className="rounded-lg border-2 border-brand-red bg-red-50 p-6 shadow-sm">
          <h2 className="text-xl font-bold text-brand-navy">
            ⭐ One quick favor — leave Neal a review?
          </h2>
          <p className="mt-2 text-sm text-slate-700">
            You've already written what you thought of the training (your answers below). Just{' '}
            <strong>copy</strong> any of those answers and <strong>paste</strong> them as a review
            on Google or Yelp. Takes 30 seconds and means everything for the next cohort.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a
              href={GOOGLE_REVIEW_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md bg-[#4285F4] px-5 py-3 text-base font-semibold text-white shadow-sm hover:bg-[#3367D6]"
            >
              ⭐ Review on Google
            </a>
            <a
              href={YELP_REVIEW_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md bg-[#D32323] px-5 py-3 text-base font-semibold text-white shadow-sm hover:bg-[#A91D1D]"
            >
              ⭐ Review on Yelp
            </a>
          </div>
        </section>
      )}

      {/* Essay answers as copy-able boxes */}
      {essays.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-800">
            Your answers — tap "Copy" to use as a review
          </h2>
          {essays.map((r) => (
            <EssayCard key={r.id} response={r} />
          ))}
        </section>
      )}

      <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        You can come back to this page anytime by tapping the same link from your text message.
      </div>
    </div>
  )
}

function EssayCard({ response }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(response.essay_response || '')
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      window.prompt('Copy your answer:', response.essay_response || '')
    }
  }
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-semibold text-brand-navy">{response.question_prompt}</p>
      <blockquote className="mt-2 whitespace-pre-line rounded-md border-l-4 border-brand-navy bg-slate-50 px-4 py-3 text-sm italic text-slate-800">
        {response.essay_response}
      </blockquote>
      <div className="mt-3 flex justify-end">
        <button
          onClick={copy}
          className="rounded-md bg-brand-navy px-4 py-2 text-xs font-semibold text-white hover:bg-brand-navy-dark"
        >
          {copied ? 'Copied!' : 'Copy this answer'}
        </button>
      </div>
    </article>
  )
}
