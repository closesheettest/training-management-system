// /practice-self — Sales Training Customer for a rep, on their own (Neal, 2026-10-09). Opened from the rep's
// Personal Dashboard (CCG ?mode=rep), which passes their sign-in in the link's #hash, so it already knows who they
// are. Three taps, nothing else: a LEVEL, WHAT to practice (one slide / control drill / full presentation), and
// (for a slide or the drill) WHICH slide. The homeowner is picked for them. Then the normal practice-link page
// (/practice/<token>) runs the session and shows their feedback.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

const KEY = 'practice_self_session'
const call = (payload) => fetch('/.netlify/functions/practice-self', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
}).then((r) => r.json()).catch(() => ({ ok: false, error: 'Network error. Check the connection and try again.' }))

const LEVEL_COLOR = { 'Very easy': '#16a34a', Easy: '#65a30d', Medium: '#ca8a04', Hard: '#ea580c', 'Very hard': '#dc2626' }
const WHAT = [
  { key: 'slide', emoji: '🖼️', label: 'One slide', desc: 'Pick a slide and present it. 3–5 minutes.' },
  { key: 'control', emoji: '🎯', label: 'Control drill', desc: 'Pick a slide. The homeowner keeps asking questions; keep control. 5 minutes.' },
  { key: 'full', emoji: '🏠', label: 'Full presentation', desc: 'Slide 1 through asking for the business. 30–60 minutes.' },
]

export default function PracticeSelf() {
  const nav = useNavigate()
  const [session] = useState(() => {
    // The dashboard hands the sign-in over in the #hash (never sent to a server log); keep it for this tab only.
    try {
      const h = new URLSearchParams(window.location.hash.slice(1)).get('s')
      if (h) { sessionStorage.setItem(KEY, h); window.history.replaceState(null, '', window.location.pathname) }
      return h || sessionStorage.getItem(KEY) || ''
    } catch { return '' }
  })
  const [st, setSt] = useState(null)
  const [err, setErr] = useState('')
  const [level, setLevel] = useState('')
  const [what, setWhat] = useState('')
  const [slide, setSlide] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { document.title = 'Practice your presentation — U.S. Shingle & Metal' }, [])
  useEffect(() => {
    if (!session) { setErr('Open Practice from your Personal Dashboard.'); return }
    call({ session, action: 'status' }).then((d) => { if (!d.ok) setErr(d.error || 'Something went wrong.'); else setSt(d) })
  }, [session])

  const start = async () => {
    setBusy(true); setErr('')
    const d = await call({ session, action: 'start', level, what, slide })
    setBusy(false)
    if (!d.ok) { setErr(d.error || 'Could not start.'); return }
    nav(`/practice/${d.token}`)
  }

  const wrap = (children) => <div className="min-h-screen bg-slate-50 px-4 py-6"><div className="mx-auto max-w-lg">{children}</div></div>
  if (err && !st) return wrap(<div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-slate-700">{err}</div>)
  if (!st) return wrap(<div className="p-6 text-center text-slate-500">Loading…</div>)
  const first = (st.name || '').split(/\s+/)[0]
  if (!st.open) return wrap(
    <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
      <div className="text-4xl">🎤</div>
      <div className="mt-2 text-xl font-black text-slate-900">Practice is full for this week</div>
      <div className="mt-2 text-slate-600">It opens again Monday. Keep running your presentation out loud in the meantime.</div>
    </div>,
  )
  const needSlide = what === 'slide' || what === 'control'
  const ready = level && what && (!needSlide || slide)
  const step = (n, t) => <div className="mb-2 mt-5 flex items-center gap-2 text-lg font-black text-slate-900"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-sm text-white">{n}</span>{t}</div>

  return wrap(
    <>
      <div className="text-2xl font-black text-slate-900">🎤 Practice your presentation</div>
      <div className="mt-1 text-slate-600">{first ? `Hi ${first}. ` : ''}Talk to an AI homeowner out loud, then get your feedback. Use Chrome, somewhere quiet, ideally with headphones.</div>

      {step(1, 'How hard?')}
      <div className="grid grid-cols-1 gap-2">
        {st.levels.map((l) => (
          <button key={l} type="button" onClick={() => setLevel(l)}
            className="rounded-xl border-2 px-4 py-3 text-left text-lg font-bold"
            style={{ borderColor: LEVEL_COLOR[l], background: level === l ? LEVEL_COLOR[l] : '#fff', color: level === l ? '#fff' : LEVEL_COLOR[l] }}>
            {l}
          </button>
        ))}
      </div>

      {step(2, 'What do you want to practice?')}
      <div className="grid grid-cols-1 gap-2">
        {WHAT.map((w) => (
          <button key={w.key} type="button" onClick={() => { setWhat(w.key); if (w.key === 'full') setSlide('') }}
            className={`rounded-xl border-2 px-4 py-3 text-left ${what === w.key ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-900'}`}>
            <div className="text-lg font-bold">{w.emoji} {w.label}</div>
            <div className={`text-sm ${what === w.key ? 'text-slate-200' : 'text-slate-500'}`}>{w.desc}</div>
          </button>
        ))}
      </div>

      {needSlide && (
        <>
          {step(3, 'Which slide?')}
          <select value={slide} onChange={(e) => setSlide(e.target.value)}
            className="w-full rounded-xl border-2 border-slate-300 bg-white px-3 py-3 text-lg font-semibold text-slate-900">
            <option value="">Pick a slide…</option>
            {st.slides.map((s) => <option key={s.n} value={s.n}>Slide {s.n}: {s.title}</option>)}
          </select>
        </>
      )}

      {err && <div className="mt-4 rounded-lg bg-red-50 p-3 font-semibold text-red-700">{err}</div>}
      <button type="button" disabled={!ready || busy} onClick={start}
        className="mt-6 w-full rounded-xl bg-green-600 px-4 py-4 text-xl font-black text-white disabled:bg-slate-300">
        {busy ? 'Starting…' : 'Start practice →'}
      </button>
      <div className="mt-3 text-center text-sm text-slate-500">The homeowner is picked for you.</div>
    </>,
  )
}
