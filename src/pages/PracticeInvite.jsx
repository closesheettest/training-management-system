// /practice/:token — Sales Training Customer from a PRACTICE LINK. A trainer set
// the session up on /sales-practice and texted + emailed this link (the owner, a
// rep on Zoom). No PIN: the token opens this one session only, for 48 hours and
// until it is done; after that it shows the person their own report card.
// Everything else is the trainer page's LiveSession and Report.
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { LiveSession } from './SalesPractice.jsx'
import { personaByKey, sectionByKey } from '../lib/salesPractice.js'

const call = (token, payload) => fetch('/.netlify/functions/practice-invite', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token, ...payload }),
}).then((r) => r.json()).catch(() => ({ ok: false, error: 'Network error. Check the connection and try again.' }))

export default function PracticeInvite() {
  const { token } = useParams()
  const [inv, setInv] = useState(null)
  const [err, setErr] = useState('')
  const [stage, setStage] = useState('intro') // intro | live | report

  useEffect(() => { document.title = 'Sales practice — U.S. Shingle & Metal' }, [])
  useEffect(() => {
    call(token, { action: 'load' }).then((d) => {
      if (!d.ok) { setErr(d.error || 'This practice link is not valid.'); return }
      setInv(d)
      if (d.status === 'done') setStage('report')
    })
  }, [token])

  const wrap = (children) => <div className="min-h-screen bg-slate-50 px-4 py-6">{children}</div>
  if (err) return wrap(<div className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-6 text-center text-slate-700">{err}</div>)
  if (!inv) return wrap(<div className="p-6 text-center text-slate-500">Loading…</div>)

  const persona = personaByKey(inv.persona_key)
  const section = sectionByKey(inv.section)

  if (stage === 'report') {
    return wrap(<RepReport token={token} persona={persona} section={section} name={inv.name} />)
  }
  if (stage === 'live') {
    return wrap(
      <LiveSession
        persona={persona} section={section} trainee={{ id: null, name: inv.name, class_id: null }}
        fetchToken={async () => {
          const d = await call(token, { action: 'live' })
          if (!d.ok) throw new Error(d.error || 'Could not start the practice.')
          return d
        }}
        saveSession={(session) => call(token, { action: 'save', session })}
        onDone={(saved) => setStage(saved === null ? 'intro' : 'report')}
      />,
    )
  }
  if (inv.status === 'expired') {
    return wrap(<div className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-6 text-center text-slate-700">This practice link has expired. Ask {inv.sent_by || 'your trainer'} for a new one.</div>)
  }

  const first = String(inv.name || '').split(/\s+/)[0]
  return wrap(
    <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">U.S. Shingle &amp; Metal · Sales practice</div>
      <h1 className="mt-1 text-2xl font-bold text-brand-navy">Hi {first}, you’re up.</h1>
      <p className="mt-3 text-slate-700">
        {inv.sent_by ? `${inv.sent_by} set this up for you. ` : ''}You’ll present <b>{section.label}</b> out loud to an AI homeowner,
        <b> {persona.name}</b> ({persona.tagline.toLowerCase()}). They can hear you and they talk back.
        {section.seconds ? ` It runs for ${Math.round(section.seconds / 60)} minutes, then ends on its own.` : ''} When you’re done you get feedback on how it went.
      </p>
      <p className="mt-2 text-sm text-slate-600">{persona.blurb}</p>
      <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-700">
        <li>Use <b>Chrome</b> on a laptop or tablet, somewhere quiet. <b>Headphones</b> work best.</li>
        <li>When Chrome asks to use the <b>microphone</b>, click <b>Allow</b>.</li>
        {section.door
          ? <li>You’re at their <b>front door</b>: they got our mailer but weren’t expecting you. Get a yes to the free roof inspection. When you finish, click <b>End &amp; grade</b>.</li>
          : <>
            <li>The slides are on screen: use <b>Next / Back</b> (or the arrow keys) as you present.</li>
            <li>Talk to them like you’re at their kitchen table. When you finish, click <b>End &amp; grade</b>.</li>
          </>}
      </ul>
      <button type="button" onClick={() => setStage('live')} className="mt-6 w-full rounded-lg bg-brand-red px-6 py-3 text-lg font-bold text-white shadow hover:bg-brand-red-dark">
        🏠 Start the practice
      </button>
      <p className="mt-2 text-center text-xs text-slate-400">This link is just for you and works once.</p>
    </div>,
  )
}

// What the REP sees after a practice from a link (Neal, 25 Sep): no score, no
// grade, written to build them up. Their missed points ARE shown ("those are
// important"), in red, but with no numbers. The trainer's page has the full
// graded report and a coaching plan.
function RepReport({ token, persona, section, name }) {
  const [s, setS] = useState(null)
  const [showT, setShowT] = useState(false)
  useEffect(() => {
    let stop = false, timer, misses = 0
    const tick = async () => {
      const d = await call(token, { action: 'get' })
      if (stop) return
      if (!d.ok) { if (++misses < 40) timer = setTimeout(tick, 4000); return }
      setS(d.session)
      if (d.session.grade_status === 'pending') timer = setTimeout(tick, 3000)
    }
    tick()
    return () => { stop = true; clearTimeout(timer) }
  }, [token])

  const first = String(name || '').split(/\s+/)[0]
  if (!s || s.grade_status === 'pending') {
    return <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-600">📝 Nice work, {first}! Putting your feedback together… (a minute or two)</div>
  }
  if (s.grade_status === 'failed') {
    return <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-6 text-center text-slate-700">{s.grade_error}</div>
  }
  const e = s.encouragement || {}
  const missedAny = (s.parts || []).some((p) => p.missed.length)
  const box = 'mt-4 rounded-2xl border bg-white p-5'
  return (
    <div className="mx-auto max-w-2xl">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">U.S. Shingle &amp; Metal · Your practice: {section.label} with {persona.tagline.toLowerCase()}</div>
      <h1 className="mt-1 text-2xl font-bold text-brand-navy">Great work, {first}! 🎉</h1>
      {e.opening && <p className="mt-2 text-lg text-slate-800">{e.opening}</p>}

      {(e.wins || []).length > 0 && (
        <section className={`${box} border-emerald-200`}>
          <h2 className="font-bold text-emerald-700">💪 What you did well</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-800">{e.wins.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </section>
      )}

      {(e.level_up || []).length > 0 && (
        <section className={`${box} border-sky-200`}>
          <h2 className="font-bold text-sky-700">🚀 To make it even better</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-800">{e.level_up.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </section>
      )}

      {missedAny && (
        <section className={`${box} border-slate-200`}>
          <h2 className="font-bold text-brand-navy">📋 Points to bring out next time</h2>
          <p className="text-sm text-slate-500">What landed ✓, and what to add next time (in red).</p>
          <div className="mt-2 space-y-3">
            {s.parts.map((p, i) => (
              <div key={i}>
                <div className="font-semibold text-slate-800">{p.part}</div>
                {p.covered.map((c, j) => <div key={'c' + j} className="text-sm text-emerald-700">✓ {c}</div>)}
                {p.missed.map((m, j) => <div key={'m' + j} className="text-sm font-semibold text-red-600">✗ {m}</div>)}
              </div>
            ))}
          </div>
          {s.not_reached && <p className="mt-2 text-xs text-slate-500">Not reached this time: {s.not_reached}.</p>}
        </section>
      )}

      {s.drill && (s.pairs || []).some((x) => x.verdict !== 'kept') && (
        <section className={`${box} border-slate-200`}>
          <h2 className="font-bold text-brand-navy">🎯 Taking control back</h2>
          <p className="text-sm text-slate-500">Moments to come back with a question next time.</p>
          <div className="mt-2 space-y-3">
            {s.pairs.filter((x) => x.verdict !== 'kept').map((x, i) => (
              <div key={i} className="text-sm">
                <div className="text-slate-600"><b>{persona.speaker}:</b> “{x.homeowner}”</div>
                <div className="font-semibold text-red-600">✗ You answered without a question back</div>
                {x.better_question && <div className="text-slate-900"><b>Try:</b> {x.better_question}</div>}
              </div>
            ))}
          </div>
        </section>
      )}

      {e.closing && <p className="mt-5 text-lg font-semibold text-brand-navy">{e.closing}</p>}

      <div className="mt-4">
        <button type="button" onClick={() => setShowT((v) => !v)} className="text-sm font-semibold text-brand-navy">{showT ? 'Hide' : 'Show'} the conversation</button>
        {showT && (
          <div className="mt-2 space-y-1 rounded-xl border border-slate-200 bg-white p-4 text-sm">
            {(s.transcript || []).filter((t) => t.who !== 'slide').map((t, i) => <div key={i}><b>{t.who === 'rep' ? 'You' : persona.speaker}:</b> {t.text}</div>)}
          </div>
        )}
      </div>
    </div>
  )
}
