// /sales-practice — Sales Training Customer (trainer-only, PIN-gated in App.jsx).
//
// The trainer runs this in class: picks the trainee who is up, an AI homeowner
// and a section, and the trainee gives the IN-HOME PRESENTATION out loud (not the
// door pitch). The homeowner answers by voice (Gemini Live, src/lib/geminiLive.js)
// and sees whichever slide the rep has up. When they end, the transcript is
// graded on POINTS (Slide Points), not words (practice-grade-background) and
// saved to the trainee. Trainees never get a link to this page.
//
// Homeowners, sections and the deck: src/lib/salesPractice.js.
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { LiveHomeowner } from '../lib/geminiLive.js'
import { PERSONAS, SECTIONS, DECK, personaByKey, sectionByKey, homeownerPrompt, slideSrc } from '../lib/salesPractice.js'

const PIN_KEY = 'sp_admin_ok_pin'
const readPin = () => { try { return sessionStorage.getItem(PIN_KEY) || '' } catch { return '' } }

async function api(payload) {
  const r = await fetch('/.netlify/functions/practice-api', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: readPin(), ...payload }),
  })
  return r.json().catch(() => ({ ok: false, error: 'Network error' }))
}

const fmtWhen = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const fmtDur = (s) => (s == null ? '' : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`)
const scoreColor = (n) => (n == null ? 'text-slate-400' : n >= 90 ? 'text-emerald-600' : n >= 75 ? 'text-lime-600' : n >= 60 ? 'text-amber-600' : 'text-red-600')

export default function SalesPractice() {
  const [stage, setStage] = useState('setup') // setup | live | report
  const [classes, setClasses] = useState([])
  const [traineeId, setTraineeId] = useState('')
  const [personaKey, setPersonaKey] = useState(PERSONAS[0].key)
  const [sectionKey, setSectionKey] = useState('full')
  const [slideN, setSlideN] = useState('')           // for "One slide"
  const [reps, setReps] = useState([])
  const [slidePoints, setSlidePoints] = useState([]) // Slide Points rows, for the one-slide picker
  const [reportId, setReportId] = useState(null)
  const [history, setHistory] = useState([])

  useEffect(() => { document.title = 'Sales Training Customer — TMS' }, [])

  // WHO CAN PRESENT: every active sales rep, plus trainees in a class that is
  // running today (Neal, 25 Sep). Reps practise too, not only trainees.
  useEffect(() => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
    supabase.from('classes')
      .select('id, region, week_start_date, week_end_date, attendance_only, cancelled_at, trainees!class_id(id, first_name, last_name, enrolled)')
      .lte('week_start_date', today).gte('week_end_date', today)
      .order('week_start_date', { ascending: false })
      .then(({ data }) => setClasses((data || []).filter((c) => !c.attendance_only && !c.cancelled_at)))
    supabase.from('trainees')
      .select('id, first_name, last_name, region')
      .eq('is_active_sales_rep', true)
      .order('first_name')
      .then(({ data }) => setReps(data || []))
    supabase.from('training_days').select('title, subject, on_slide').order('position')
      .then(({ data }) => setSlidePoints((data || []).filter((d) => /^Slides?\s*\d/.test(String(d.subject || '').trim()))))
  }, [])

  const loadHistory = () => api({ action: 'list' }).then((d) => { if (d.ok) setHistory(d.sessions) })
  useEffect(() => { loadHistory() }, [])

  const trainees = useMemo(() => {
    const out = [], seen = new Set()
    for (const c of classes) for (const t of c.trainees || []) {
      if (t.enrolled === false || seen.has(t.id)) continue
      seen.add(t.id)
      out.push({ id: t.id, name: `${t.first_name} ${t.last_name}`.trim(), class_id: c.id })
    }
    for (const r of reps) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      out.push({ id: r.id, name: `${r.first_name} ${r.last_name}`.trim(), class_id: null })
    }
    return out
  }, [classes, reps])
  const classIds = useMemo(() => new Set(classes.flatMap((c) => (c.trainees || []).map((t) => t.id))), [classes])
  const effectiveSection = (sectionKey === 'slide' || sectionKey === 'control') ? (slideN ? `${sectionKey}:${slideN}` : '') : sectionKey
  const trainee = trainees.find((t) => t.id === traineeId) || null
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkForm, setLinkForm] = useState({ name: '', phone: '', email: '' })
  const [linkBusy, setLinkBusy] = useState(false)
  const [linkMsg, setLinkMsg] = useState(null)
  const sendLink = async () => {
    setLinkBusy(true); setLinkMsg(null)
    const d = await api({ action: 'invite', invite: { ...linkForm, trainee_id: trainee?.id || null, class_id: trainee?.class_id || null, persona_key: personaKey, section: effectiveSection } })
    setLinkBusy(false)
    if (!d.ok) { setLinkMsg({ err: true, text: d.error || 'Could not send.' }); return }
    const how = [d.sms && 'texted', d.email && 'emailed'].filter(Boolean).join(' and ')
    setLinkMsg({ err: !how, text: how ? `Link ${how}. It works for 48 hours; the result shows up in Past practice.` : `The link was made but neither the text nor the email went through (${d.sms_error || ''} ${d.email_error || ''}). Copy it and send it yourself:`, link: d.link })
    loadHistory()
  }

  if (stage === 'live') {
    return (
      <LiveSession
        persona={personaByKey(personaKey)} section={sectionByKey(effectiveSection)} trainee={trainee}
        onDone={(id) => { setReportId(id); setStage(id ? 'report' : 'setup'); loadHistory() }}
      />
    )
  }
  if (stage === 'report') {
    return <Report id={reportId} onBack={() => { setStage('setup'); loadHistory() }} />
  }

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold text-brand-navy">Sales Training Customer</h1>
      <p className="mt-1 text-sm text-slate-600">
        A trainee gives the in-home presentation out loud to an AI homeowner who talks back. When they finish, it is graded on
        whether they brought out each slide’s points (from Slide Points), in their own words, and saved to the trainee. Put it on the projector so the class learns from each run.
      </p>

      <Step n="1" title="Who is presenting?">
        <select value={traineeId} onChange={(e) => setTraineeId(e.target.value)} className="w-full max-w-md rounded-md border border-slate-300 px-3 py-2">
          <option value="">Nobody listed: trainer try-out (still saved)</option>
          {classes.map((c) => (
            <optgroup key={c.id} label={`Trainees · ${c.region || 'Class'} · week of ${c.week_start_date}`}>
              {(c.trainees || []).filter((t) => t.enrolled !== false)
                .sort((a, b) => a.first_name.localeCompare(b.first_name))
                .map((t) => <option key={t.id} value={t.id}>{t.first_name} {t.last_name}</option>)}
            </optgroup>
          ))}
          {reps.some((r) => !classIds.has(r.id)) && (
            <optgroup label="Active sales reps">
              {reps.filter((r) => !classIds.has(r.id)).map((r) => (
                <option key={r.id} value={r.id}>{r.first_name} {r.last_name}{r.region ? ` · ${r.region}` : ''}</option>
              ))}
            </optgroup>
          )}
        </select>
      </Step>

      <Step n="2" title="Pick the homeowner">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PERSONAS.map((p) => (
            <button key={p.key} type="button" onClick={() => setPersonaKey(p.key)}
              className={`rounded-xl border p-4 text-left transition ${personaKey === p.key ? 'border-brand-navy bg-brand-navy-50 ring-2 ring-brand-navy' : 'border-slate-200 bg-white hover:border-slate-400'}`}>
              <div className="flex items-center justify-between">
                <span className="font-bold text-brand-navy">{p.tagline}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${p.difficulty === 'Hard' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>{p.difficulty}</span>
              </div>
              <div className="mt-0.5 text-xs text-slate-500">{p.name}</div>
              <div className="mt-2 text-sm text-slate-700">{p.blurb}</div>
            </button>
          ))}
        </div>
      </Step>

      <Step n="3" title="What are they practicing?">
        <div className="grid gap-2 sm:grid-cols-2">
          {SECTIONS.map((s) => (
            <label key={s.key} className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${sectionKey === s.key ? 'border-brand-navy bg-brand-navy-50' : 'border-slate-200 bg-white'}`}>
              <input type="radio" name="section" checked={sectionKey === s.key} onChange={() => setSectionKey(s.key)} className="mt-1" />
              <span><span className="font-semibold text-slate-800">{s.label}</span><span className="block text-xs text-slate-500">{s.desc}</span></span>
            </label>
          ))}
        </div>
        {(sectionKey === 'slide' || sectionKey === 'control') && (
          <select value={slideN} onChange={(e) => setSlideN(e.target.value)} className="mt-3 w-full max-w-md rounded-md border border-slate-300 px-3 py-2">
            <option value="">Pick the slide…</option>
            {slidePoints.map((d) => {
              const n = parseInt(String(d.subject).match(/\d+/)[0], 10)
              return <option key={d.subject} value={n}>{d.subject}: {d.title}</option>
            })}
          </select>
        )}
      </Step>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button type="button" onClick={() => setStage('live')} disabled={!effectiveSection} className="rounded-lg bg-brand-red px-6 py-3 text-lg font-bold text-white shadow hover:bg-brand-red-dark disabled:opacity-50">
          🏠 Sit down at the table
        </button>
        <button type="button" onClick={() => { setLinkOpen((v) => !v); setLinkMsg(null); setLinkForm({ name: '', phone: '', email: '' }) }} disabled={!effectiveSection}
          className="rounded-lg border-2 border-brand-navy px-5 py-2.5 font-bold text-brand-navy hover:bg-brand-navy-50 disabled:opacity-50">
          📲 Send practice link
        </button>
        <span className="text-xs text-slate-500">Chrome or Edge on a laptop. A headset works best; on speakers, keep the volume moderate so the homeowner doesn’t hear themselves.</span>
      </div>
      {linkOpen && (
        <div className="mt-3 max-w-xl rounded-xl border border-slate-200 bg-white p-4">
          <div className="font-bold text-brand-navy">Send {trainee ? trainee.name : 'someone'} a private practice link</div>
          <p className="mt-1 text-sm text-slate-600">
            They do this practice ({sectionByKey(effectiveSection).label}, {personaByKey(personaKey).tagline.toLowerCase()}) on their own laptop or tablet.
            {trainee ? ' Their cell and email on file are used; fill these in only to send somewhere else.' : ' For someone not in the list, enter their name and cell and/or email.'}
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {!trainee && <input value={linkForm.name} onChange={(e) => setLinkForm({ ...linkForm, name: e.target.value })} placeholder="Name" className="rounded-md border border-slate-300 px-2 py-1.5" />}
            <input value={linkForm.phone} onChange={(e) => setLinkForm({ ...linkForm, phone: e.target.value })} placeholder={trainee ? 'Cell (on file)' : 'Cell'} className="rounded-md border border-slate-300 px-2 py-1.5" />
            <input value={linkForm.email} onChange={(e) => setLinkForm({ ...linkForm, email: e.target.value })} placeholder={trainee ? 'Email (on file)' : 'Email'} className="rounded-md border border-slate-300 px-2 py-1.5" />
          </div>
          <button type="button" onClick={sendLink} disabled={linkBusy} className="mt-3 rounded-md bg-brand-navy px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
            {linkBusy ? 'Sending…' : 'Text + email the link'}
          </button>
          {linkMsg && (
            <div className={`mt-3 text-sm font-semibold ${linkMsg.err ? 'text-red-700' : 'text-emerald-700'}`}>
              {linkMsg.text}
              {linkMsg.link && <div className="mt-1 break-all font-normal text-slate-600">{linkMsg.link}</div>}
            </div>
          )}
        </div>
      )}

      <History sessions={history} onOpen={(id) => { setReportId(id); setStage('report') }} />
    </div>
  )
}

function Step({ n, title, children }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">{n}. {title}</h2>
      {children}
    </section>
  )
}

// ── The live presentation ────────────────────────────────────────────────────
const trainerToken = async () => {
  const r = await fetch('/.netlify/functions/practice-token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: readPin() }),
  })
  const d = await r.json().catch(() => ({}))
  if (!d.ok) throw new Error(d.error || 'Could not start a session.')
  return d
}

// The live presentation. Used by the trainer page and by the practice link page
// (src/pages/PracticeInvite.jsx), which pass their own fetchToken / saveSession.
export function LiveSession({ persona, section, trainee, onDone, fetchToken = trainerToken, saveSession = null }) {
  const [status, setStatus] = useState('starting')
  const [err, setErr] = useState('')
  const [entries, setEntries] = useState([])
  const [level, setLevel] = useState(0)
  const [page, setPage] = useState(section.firstSlide) // 0 = no slide (intro + survey)
  const [closeSilence, setCloseSilence] = useState(null)
  const [saving, setSaving] = useState(false)
  const [muted, setMuted] = useState(false)
  const liveRef = useRef(null)
  const logRef = useRef(null)
  const endRef = useRef(null)
  // Timed sections (the 5-minute control drill): count down from the moment the
  // homeowner is connected, then end and grade on their own.
  const [left, setLeft] = useState(section.seconds || null)
  const started = status === 'listening' || status === 'speaking' || status === 'silence'
  useEffect(() => {
    if (!section.seconds || !started) return
    const t = setInterval(() => setLeft((x) => {
      if (x <= 1) { clearInterval(t); endRef.current?.(); return 0 }
      return x - 1
    }), 1000)
    return () => clearInterval(t)
  }, [section.seconds, started])

  useEffect(() => {
    const live = new LiveHomeowner({
      systemPrompt: homeownerPrompt(persona, section.key),
      voice: persona.voice,
      getToken: fetchToken,
      on: { status: setStatus, transcript: setEntries, level: setLevel, error: setErr, closeSilence: setCloseSilence },
    })
    liveRef.current = live
    live.start().catch((e) => { setErr(e.name === 'NotAllowedError' ? 'The browser blocked the microphone. Allow it (the icon in the address bar) and try again.' : e.message); setStatus('error') })
    return () => { if (liveRef.current === live) live.stop() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Tell the homeowner which slide is up whenever it changes (and at the start).
  useEffect(() => {
    if (!page) return
    const d = DECK.find((x) => x.page === page)
    liveRef.current?.showSlide(`Slide on screen: deck page ${page} (${d?.script || ''})`, d?.seen || '', page >= 29)
  }, [page])

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }) }, [entries])

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.key === 'ArrowRight' || e.key === 'PageDown') setPage((p) => Math.min(DECK.length, p + 1))
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') setPage((p) => Math.max(1, p - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const end = async () => {
    if (saving || !liveRef.current) return
    setSaving(true)
    const out = liveRef.current.stop()
    liveRef.current = null
    if (!out.entries.some((e) => e.who === 'rep')) {
      if (!window.confirm('Nothing the rep said was picked up. Save it anyway? (Cancel = throw it away)')) { onDone(null); return }
    }
    const session = {
      trainee_id: trainee?.id || null, trainee_name: trainee?.name || 'Trainer try-out', class_id: trainee?.class_id || null,
      persona_key: persona.key, section: section.key,
      started_at: out.startedAt, ended_at: out.endedAt, transcript: out.entries, close_silence: out.closeSilence, usage: out.usage,
    }
    const d = saveSession ? await saveSession(session) : await api({ action: 'save', session })
    if (!d.ok) { setErr(`Could not save: ${d.error}`); setSaving(false); return }
    onDone(d.id)
  }

  useEffect(() => { endRef.current = end })
  const statusLabel = {
    starting: 'Getting the microphone…', connecting: 'Connecting to the homeowner…', listening: '🎙️ Listening',
    speaking: `🗣️ ${persona.speaker} is talking`, silence: '🤫 Silence after the ask…', error: 'Stopped',
  }[status] || status

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{section.label}</div>
          <h1 className="text-xl font-bold text-brand-navy">{trainee?.name || 'Trainer try-out'} → {persona.name} <span className="font-normal text-slate-500">({persona.tagline})</span></h1>
        </div>
        <div className="flex items-center gap-3">
          {left != null && (
            <div className={`rounded-full px-3 py-1.5 text-lg font-black tabular-nums ${left <= 30 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}>
              ⏱ {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
            </div>
          )}
          <div className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700">
            <span>{statusLabel}</span>
            <span className="h-2 w-16 overflow-hidden rounded bg-slate-300"><span className="block h-full bg-emerald-500 transition-all" style={{ width: `${Math.round(level * 100)}%` }} /></span>
          </div>
          <button type="button" onClick={() => { setMuted((m) => { liveRef.current?.setMuted(!m); return !m }) }}
            className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${muted ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-slate-300 text-slate-600'}`}>
            {muted ? '🔇 Mic paused' : 'Pause mic'}
          </button>
          <button type="button" onClick={end} disabled={saving} className="rounded-md bg-brand-navy px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
            {saving ? 'Saving…' : '⏹ End & grade'}
          </button>
        </div>
      </div>
      {err && <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{err}</div>}

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_360px]">
        <div>
          {page === 0 ? (
            <div className="flex aspect-video flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-8 text-center">
              <div className="text-5xl">☕</div>
              <div className="mt-3 text-xl font-bold text-brand-navy">At the kitchen table</div>
              <p className="mt-2 max-w-md text-sm text-slate-600">Intro and customer survey: no slides yet. {persona.speaker} and their spouse are sitting across from you. Start whenever you’re ready.</p>
              {section.key !== 'survey' && <button type="button" onClick={() => setPage(1)} className="mt-4 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold">Start the slide show →</button>}
            </div>
          ) : (
            <img src={slideSrc(page)} alt={`Slide ${page}`} className="w-full rounded-xl border border-slate-200 bg-white shadow-sm" />
          )}
          <div className="mt-2 flex items-center justify-between text-sm">
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded-md border border-slate-300 px-3 py-1.5 font-semibold">← Back</button>
            <span className="text-slate-500">{page ? `Deck page ${page} of ${DECK.length} · ${DECK[page - 1]?.script}` : 'No slide'} · ← → keys work</span>
            <button type="button" onClick={() => setPage((p) => Math.min(DECK.length, p + 1))} className="rounded-md border border-slate-300 px-3 py-1.5 font-semibold">Next →</button>
          </div>
          {closeSilence && (
            <div className={`mt-3 rounded-md px-3 py-2 text-sm font-semibold ${closeSilence.held ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
              {closeSilence.held ? `✓ Held the silence after the ask (${closeSilence.seconds}s)` : `✗ Spoke again ${closeSilence.seconds}s after the ask, before the homeowner answered`}
            </div>
          )}
        </div>
        <div ref={logRef} className="h-[70vh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 text-sm">
          {!entries.length && <p className="text-slate-400">What’s said shows up here as it happens.</p>}
          {entries.map((e, i) => e.who === 'slide'
            ? <div key={i} className="my-2 text-center text-[11px] uppercase tracking-wide text-slate-400">{e.text.replace(/^Slide on screen: /, '')}</div>
            : (
              <div key={i} className={`my-1.5 ${e.who === 'rep' ? 'text-right' : ''}`}>
                <span className={`inline-block max-w-[90%] rounded-2xl px-3 py-1.5 text-left ${e.who === 'rep' ? 'bg-brand-navy text-white' : 'bg-slate-100 text-slate-800'}`}>
                  <span className="block text-[10px] font-bold uppercase opacity-60">{e.who === 'rep' ? 'Rep' : persona.speaker}</span>
                  {e.text}
                </span>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}

// ── The report card ──────────────────────────────────────────────────────────
const trainerLoad = (id) => api({ action: 'get', id })

export function Report({ id, onBack, load = trainerLoad, canRegrade = true }) {
  const [s, setS] = useState(null)
  const [err, setErr] = useState('')
  const [showT, setShowT] = useState(false)
  const [nonce, setNonce] = useState(0) // bump to poll again after "Try again"

  useEffect(() => {
    let stop = false, timer
    // KEEP ASKING. One failed check (a network blip, the laptop napping, a deploy
    // mid-grade) used to end the polling, and the card sat on "Grading…" while the
    // grade was already saved (Neal's first run, 25 Sep). Errors now just retry.
    let misses = 0
    const tick = async () => {
      let d
      try { d = await load(id) } catch { d = { ok: false } }
      if (stop) return
      if (!d.ok) {
        if (++misses >= 20) { setErr(d.error || 'Could not load this session.'); return }
        timer = setTimeout(tick, 4000); return
      }
      misses = 0
      setS(d.session)
      if (d.session.grade_status === 'pending') timer = setTimeout(tick, 3000)
    }
    tick()
    return () => { stop = true; clearTimeout(timer) }
  }, [id, nonce]) // eslint-disable-line react-hooks/exhaustive-deps

  const regrade = async () => { await api({ action: 'regrade', id }); setNonce((n) => n + 1) }

  if (err) return <div className="p-6 text-red-600">{err}</div>
  if (!s) return <div className="p-6 text-slate-500">Loading…</div>
  const p = personaByKey(s.persona_key)
  const r = s.report || {}

  return (
    <div className="mx-auto max-w-5xl">
      {onBack && <button type="button" onClick={onBack} className="text-sm font-semibold text-brand-navy">← Back to Sales Training Customer</button>}
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{sectionByKey(s.section).label} · {fmtWhen(s.started_at)} · {fmtDur(s.duration_sec)}</div>
          <h1 className="text-2xl font-bold text-brand-navy">{s.trainee_name} → {p.tagline}</h1>
          {s.trainer_name && <div className="text-xs text-slate-500">Run by {s.trainer_name}{r.cost != null ? ` · cost $${Number(r.cost).toFixed(2)}` : ''}</div>}
        </div>
        {s.grade_status === 'done' && <div className={`text-6xl font-black ${scoreColor(s.score)}`}>{s.score}</div>}
      </div>

      {s.grade_status === 'invited' && (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 text-slate-700">
          📲 Practice link sent{r.invite?.phone ? ` to ${r.invite.phone}` : ''}{r.invite?.email ? `${r.invite?.phone ? ' and' : ' to'} ${r.invite.email}` : ''}.
          Waiting for them to do it{r.invite?.expires_at ? ` (link good until ${fmtWhen(r.invite.expires_at)} ET)` : ''}.
          {r.invite?.token && <div className="mt-2 break-all text-xs text-slate-500">Link: https://trainingmanagementsys.netlify.app/practice/{r.invite.token}</div>}
        </div>
      )}
      {s.grade_status === 'pending' && <div className="mt-6 rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-600">📝 Grading the presentation… (usually 1–2 minutes; a full presentation can take 3)</div>}
      {s.grade_status === 'failed' && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Grading didn’t work: {s.grade_error}
          {canRegrade && <button type="button" onClick={regrade} className="ml-3 rounded-md bg-red-600 px-3 py-1 text-xs font-bold text-white">Try again</button>}
        </div>
      )}

      {s.grade_status === 'done' && r.drill && <DrillReport r={r} speaker={p.speaker} />}

      {s.grade_status === 'done' && !r.drill && (
        <>
          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-slate-800">{r.summary}</p>
            {r.outcome && <p className="mt-2 text-sm text-slate-600"><span className="font-semibold">How it ended:</span> {r.outcome}</p>}
            {r.not_reached && <p className="mt-2 text-sm text-slate-500"><span className="font-semibold">Not reached (not graded):</span> {r.not_reached}</p>}
            {s.close_silence && (
              <p className={`mt-2 text-sm font-semibold ${s.close_silence.held ? 'text-emerald-700' : 'text-red-700'}`}>
                {s.close_silence.held ? `✓ Held the silence after asking for the business (${s.close_silence.seconds}s)` : `✗ Spoke again ${s.close_silence.seconds}s after asking for the business. The script says: do not speak until they do.`}
              </p>
            )}
          </div>

          {r.control && (
            <Card title="🎯 Who controlled the conversation">
              <div className="flex flex-wrap items-center gap-4">
                <div className={`text-3xl font-black ${scoreColor(r.control.score * 10)}`}>{r.control.score}/10</div>
                <div className="text-sm font-semibold text-slate-700">
                  {r.control.who === 'rep' ? 'The rep was in control' : r.control.who === 'homeowner' ? 'The homeowner was in control' : 'Control went back and forth'}
                </div>
                {r.questions && (() => {
                  const tot = Math.max(1, r.questions.rep + r.questions.homeowner)
                  return (
                    <div className="min-w-[220px] flex-1">
                      <div className="flex h-3 overflow-hidden rounded bg-slate-200">
                        <div className="bg-brand-navy" style={{ width: `${(100 * r.questions.rep) / tot}%` }} />
                        <div className="bg-amber-400" style={{ width: `${(100 * r.questions.homeowner) / tot}%` }} />
                      </div>
                      <div className="mt-1 flex justify-between text-xs text-slate-500">
                        <span>Rep asked {r.questions.rep} question{r.questions.rep !== 1 ? 's' : ''}</span>
                        <span>Homeowner asked {r.questions.homeowner}</span>
                      </div>
                    </div>
                  )
                })()}
              </div>
              {r.questions && (r.questions.answered_with_question + r.questions.just_answered) > 0 && (
                <p className="mt-2 text-sm">
                  When the homeowner asked a question, the rep came back with a question{' '}
                  <span className="font-bold">{r.questions.answered_with_question} of {r.questions.answered_with_question + r.questions.just_answered}</span> times
                  {r.questions.just_answered ? <span className="text-amber-700"> · just answered {r.questions.just_answered} (control handed over)</span> : null}
                </p>
              )}
              <p className="mt-2 text-sm text-slate-700">{r.control.summary}</p>
              {(r.control.lost_moments || []).length > 0 && (
                <div className="mt-3 space-y-2">
                  <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Where control slipped</div>
                  {r.control.lost_moments.map((m, i) => (
                    <div key={i} className="border-l-2 border-amber-300 pl-3 text-sm">
                      <div className="text-slate-600"><span className="font-semibold">Homeowner:</span> “{m.homeowner_said}”</div>
                      <div className="text-slate-600"><span className="font-semibold">Rep:</span> {m.rep_did}</div>
                      <div className="text-slate-900"><span className="font-semibold">Take it back:</span> {m.take_it_back}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Card title="🔧 Fix these first" tone="red"><ol className="list-decimal space-y-1 pl-5">{(r.top_fixes || []).map((x, i) => <li key={i}>{x}</li>)}</ol></Card>
            <Card title="💪 What went well" tone="green"><ul className="list-disc space-y-1 pl-5">{(r.strengths || []).map((x, i) => <li key={i}>{x}</li>)}</ul></Card>
          </div>

          {(r.objections || []).length > 0 && (
            <Card title="🛑 Objections">
              <div className="space-y-3">
                {r.objections.map((o, i) => (
                  <div key={i} className="border-b border-slate-100 pb-2 last:border-0">
                    <div className="font-semibold text-slate-800">“{o.objection}” <span className={`ml-1 rounded-full px-2 py-0.5 text-[11px] ${o.handled === 'well' ? 'bg-emerald-50 text-emerald-700' : o.handled === 'partly' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>{o.handled}</span></div>
                    <div className="text-sm text-slate-600"><span className="font-semibold">They said:</span> {o.what_rep_said}</div>
                    <div className="text-sm text-slate-800"><span className="font-semibold">Say instead:</span> {o.say_instead}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card title="📋 Part by part">
            <div className="space-y-2">
              {(r.parts || []).map((x, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto] gap-2 border-b border-slate-100 pb-2 last:border-0">
                  <div>
                    <div className="font-semibold text-slate-800">{x.part}</div>
                    {(x.missed || []).length > 0 && <div className="text-sm text-red-700">Missed: {x.missed.join(' · ')}</div>}
                    {(x.covered || []).length > 0 && <div className="text-xs text-slate-500">Covered: {x.covered.join(' · ')}</div>}
                  </div>
                  <div className={`text-lg font-bold ${scoreColor(x.score * 10)}`}>{x.score}/10</div>
                </div>
              ))}
            </div>
          </Card>

          {(r.good_questions || []).length > 0 && (
            <Card title="✅ Questions that worked" tone="green">
              <ul className="list-disc space-y-1 pl-5 text-sm">{r.good_questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
            </Card>
          )}

          {(r.facts_wrong || []).length > 0 && (
            <Card title="⚠️ Facts to get right">
              <div className="space-y-2 text-sm">
                {r.facts_wrong.map((f, i) => (
                  <div key={i}><div className="text-slate-500"><span className="font-semibold">Said:</span> “{f.rep_said}”</div><div className="text-slate-800"><span className="font-semibold">Correct:</span> {f.correct}</div></div>
                ))}
              </div>
            </Card>
          )}

          {r.used_their_answers && <Card title="👂 Used what the homeowner told them?"><p className="text-sm">{r.used_their_answers}</p></Card>}
        </>
      )}

      <div className="mt-4">
        <button type="button" onClick={() => setShowT((v) => !v)} className="text-sm font-semibold text-brand-navy">{showT ? 'Hide' : 'Show'} full transcript</button>
        {showT && (
          <div className="mt-2 space-y-1 rounded-xl border border-slate-200 bg-white p-4 text-sm">
            {(s.transcript || []).map((e, i) => e.who === 'slide'
              ? <div key={i} className="text-center text-[11px] uppercase text-slate-400">{e.text}</div>
              : <div key={i}><span className="font-bold">{e.who === 'rep' ? 'Rep' : p.speaker}:</span> {e.text}</div>)}
          </div>
        )}
      </div>
    </div>
  )
}

// The control drill's card: kept control X of Y, then every exchange.
function DrillReport({ r, speaker }) {
  const pct = r.total ? Math.round((100 * r.kept) / r.total) : null
  const chip = { kept: ['✅ Kept control', 'bg-emerald-50 text-emerald-700'], gave_up: ['❌ Gave up control', 'bg-red-50 text-red-700'], off_topic: ['⚠️ Off-topic question', 'bg-amber-50 text-amber-800'] }
  return (
    <>
      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-2xl font-black text-brand-navy">Kept control {r.kept} of {r.total} time{r.total !== 1 ? 's' : ''}{pct != null ? ` (${pct}%)` : ''}</div>
        <div className="mt-1 text-sm text-slate-600">Gave it up {r.gave_up} · off-topic question back {r.off_topic}</div>
        <p className="mt-2 text-slate-800">{r.summary}</p>
      </div>
      {(r.tips || []).length > 0 && (
        <Card title="🔧 Habits to build" tone="red"><ol className="list-decimal space-y-1 pl-5">{r.tips.map((x, i) => <li key={i}>{x}</li>)}</ol></Card>
      )}
      <Card title="🎯 Every question, and what the rep did">
        <div className="space-y-3">
          {(r.pairs || []).map((x, i) => (
            <div key={i} className="border-b border-slate-100 pb-2 text-sm last:border-0">
              <div className="flex items-start justify-between gap-2">
                <div className="text-slate-600"><span className="font-semibold">{speaker}:</span> “{x.homeowner}”</div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${chip[x.verdict][1]}`}>{chip[x.verdict][0]}</span>
              </div>
              <div className="text-slate-800"><span className="font-semibold">Rep:</span> “{x.rep}”</div>
              {x.why && <div className="text-xs text-slate-500">{x.why}</div>}
              {x.better_question && <div className="text-slate-900"><span className="font-semibold">Come back with:</span> {x.better_question}</div>}
            </div>
          ))}
        </div>
      </Card>
    </>
  )
}

function Card({ title, tone, children }) {
  const border = tone === 'red' ? 'border-red-200' : tone === 'green' ? 'border-emerald-200' : 'border-slate-200'
  return (
    <section className={`mt-4 rounded-xl border ${border} bg-white p-4`}>
      <h2 className="mb-2 font-bold text-brand-navy">{title}</h2>
      {children}
    </section>
  )
}

// ── Past sessions ────────────────────────────────────────────────────────────
function History({ sessions, onOpen }) {
  const [who, setWho] = useState('')
  const list = who ? sessions.filter((s) => s.trainee_id === who) : sessions
  const names = [...new Map(sessions.filter((s) => s.trainee_id).map((s) => [s.trainee_id, s.trainee_name])).entries()]
  if (!sessions.length) return null
  return (
    <section className="mt-10">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Past practice ({list.length})</h2>
        <select value={who} onChange={(e) => setWho(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1 text-sm">
          <option value="">Everyone</option>
          {names.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
        </select>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {list.map((s) => (
          <button key={s.id} type="button" onClick={() => onOpen(s.id)} className="grid w-full grid-cols-[1fr_auto] items-center gap-2 border-b border-slate-100 px-4 py-2 text-left last:border-0 hover:bg-slate-50">
            <span>
              <span className="font-semibold text-slate-800">{s.trainee_name}</span>
              <span className="text-slate-500"> → {personaByKey(s.persona_key).tagline} · {sectionByKey(s.section).label}</span>
              <span className="block text-xs text-slate-400">{fmtWhen(s.started_at)} · {fmtDur(s.duration_sec)}{s.trainer_name ? ` · ${s.trainer_name}` : ''}</span>
            </span>
            <span className="text-right">
              <span className={`block text-xl font-black ${scoreColor(s.score)}`}>{s.grade_status === 'done' ? (s.score ?? '—') : s.grade_status === 'pending' ? '…' : s.grade_status === 'invited' ? '📲' : '—'}</span>
              <span className="block text-[11px] text-slate-400" title="What Google charged for the conversation and the grading">{s.cost != null ? `$${Number(s.cost).toFixed(2)}` : 'cost n/a'}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
