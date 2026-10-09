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
import PracticeAudio from '../components/PracticeAudio.jsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { LiveHomeowner } from '../lib/geminiLive.js'
import { PERSONAS, SECTIONS, DECK, IMPULSES, IMPULSE_SECTIONS, IMPULSE_GUIDE, IMPULSE_BY_STEP, IMPULSE_PLAYBOOK, playbookFor, impulseQuestionsFor, impulseByKey, personaByKey, sectionByKey, homeownerPrompt, slideSrc, INTRO_POINTS, WARMUP_POINTS, SURVEY_POINTS, DOOR_POINTS, CLOSE_EXTRA } from '../lib/salesPractice.js'

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

// WHAT IT'S LOOKING FOR + HOW IT'S GRADED, under the chosen tile (Neal, 27 Sep).
// The lists are the grader's own (salesPractice.js + the Slide Points page), so
// what the trainer reads here is exactly what the grade checks.
function GradingGuide({ sectionKey, slideN, slidePoints }) {
  const picker = sectionKey === 'slide' || sectionKey === 'control'
  const sec = sectionByKey(picker ? (slideN ? `${sectionKey}:${slideN}` : '') : sectionKey)
  const slides = (slidePoints || [])
    .map((d) => ({ n: parseInt(String(d.subject).match(/\d+/)[0], 10), label: `${d.subject}: ${d.title}`, pts: String(d.on_slide || '').split(/\s*·\s*/).filter(Boolean) }))
  const groups = []
  if (sectionKey === 'survey') groups.push(['The warm-up: its purpose (counts the most)', WARMUP_POINTS], ['The intro', INTRO_POINTS], ['What should come out of the conversation (the survey)', SURVEY_POINTS])
  else if (sectionKey === 'door') groups.push(['The door pitch', DOOR_POINTS])
  else if (sec.range && (!picker || slideN)) {
    for (const sl of slides) if (sl.n >= sec.range[0] && sl.n <= sec.range[1] && sl.pts.length) groups.push([sl.label, sl.pts])
    if (sec.range[1] >= 23) groups.push(['Closing the deal', CLOSE_EXTRA])
  }

  const how = {
    survey: [
      'The homeowner starts a little guarded. They relax and open up only if it feels like a normal conversation: common ground, reacting to their answers, natural follow-ups. Questions read off the list like a form keep them short and impatient.',
      'THE GAUGE: the homeowner starts with one-word answers. Did the rep turn that into a real conversation (their mind opening), and move to the kitchen table once they were talking freely, not before and not dragging on? The report shows how long their answers were at the start vs the end.',
      'Graded mostly on the PURPOSE: common ground, their wants and needs found casually, and a homeowner who is open for the presentation.',
      'The survey is training wheels for newer reps. An experienced rep can skip it and just talk; what counts is whether that information came out of the conversation.',
    ],
    door: [
      'At the front door. The homeowner stalls in character and agrees to the free inspection only if the rep handles the stall well.',
      'Graded on the 7 door points and on whether they left with a YES to the inspection.',
      'STAY ON SCRIPT: not word for word, but the door pitch’s ANGLE and POINTS (the mailer, the insurance risk, the free inspection, the 3 outcomes). A different angle or an improvised pitch is listed as “Off script” and costs points.',
    ],
    control: [
      'Five timed minutes on one slide. The homeowner fires relevant questions to take control of the conversation.',
      'Every exchange is marked KEPT (the rep answered briefly and took it back with a relevant question), GAVE UP (answered without leading back within their next two replies) or OFF-TOPIC (a question that went nowhere).',
      'The score is how often the rep kept control. Each hand-over is listed with the angle they could have taken to lead back — the approach, not a line to memorize.',
      'The rep’s answers also have to stay on the script’s angle for that slide; any that don’t are listed as “Off script” for you.',
    ],
  }[sectionKey] || [
    'Score out of 100: about HALF is the points landing, and HALF is who controlled the conversation.',
    'STAY ON SCRIPT: not word for word, but the script’s ANGLE and POINTS. Each point has to be made the way the script makes it (same argument, same reasoning, same kind of question). A point made from a different angle counts half at most, and anything improvised that isn’t in the script costs points. Both are listed as “Off script” on the report. Wrong facts are flagged.',
    'Control: whoever asks the questions is in control. A short, straight answer is fine as long as the rep leads back with a question within their next two replies.',
    'LET THEM SAY IT: a question that puts the point in the homeowner’s mouth (“It sounds like you’re trying to say experience matters?”) lands it strongest. If the homeowner says it, it’s gospel; if the rep says it, it’s up for interpretation.',
    'Objections are judged by the method: acknowledge, isolate, answer it only if it belongs on this slide (otherwise park it and get their OK), then confirm with a question. A parked concern has to be answered later.',
    'Using what the homeowner said in the survey (insurance cost, electric bill, forever home…) counts in the rep’s favor.',
    ...(sec.range && sec.range[1] >= 23 ? ['After asking for the business, the rep has to stay SILENT: the homeowner waits 5 seconds to see if they do.'] : []),
    'If the run stops early, only the slides the rep actually presented are graded.',
    ...(IMPULSE_SECTIONS.includes(sectionKey) ? ['IMPULSE FACTOR (FIGS): the homeowner is secretly driven by one of Fear of loss, Indifference, Greed or Sense of urgency. When the rep ends, they are asked which it was. The report shows whether they got it, where it showed, the questions that drew it out, and whether the close was tied to it.'] : []),
  ]

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="font-bold text-brand-navy">{picker && !slideN ? (sectionKey === 'control' ? 'Control drill' : 'One slide') : sec.label}: what it’s looking for</div>
      {picker && !slideN && <p className="mt-1 text-sm text-slate-600">Pick the slide above to see its points.</p>}
      {groups.length > 0 && (
        <div className={`mt-2 space-y-3 overflow-y-auto pr-1 ${groups.length > 4 ? 'max-h-72' : ''}`}>
          {groups.map(([label, pts]) => (
            <div key={label}>
              <div className="text-sm font-semibold text-slate-800">{label}</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-600">{pts.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          ))}
        </div>
      )}
      {sectionKey === 'control' && slideN && <p className="mt-2 text-sm text-slate-600">Not graded on the slide’s points: only on keeping control.</p>}
      <div className="mt-4 font-bold text-brand-navy">How it’s graded</div>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-600">{how.map((h) => <li key={h}>{h}</li>)}</ul>
      <p className="mt-3 text-xs text-slate-500">The rep sees encouragement and the points they missed, with no score. You see the full grade and a coaching plan. Slide points come from the Slide Points page; edit them there and the next grade follows.</p>
    </div>
  )
}

// FINDING THE IMPULSE — the class, by slide (Neal, 2026-10-01). Questions that fit what the
// rep is already saying on each slide, and what each answer says about the homeowner's
// button. Then, per button: what it sounds like, how to confirm it, how to sell to it.
export function ImpulseLesson({ sectionKey, all = false }) {
  const [open, setOpen] = useState(all)
  const steps = all ? IMPULSE_BY_STEP : impulseQuestionsFor(sectionKey)
  if (!steps.length) return null
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between text-left">
        <span className="font-bold text-brand-navy">🎯 Find their button (FIGS): questions to ask {all ? 'through the presentation' : 'here'}</span>
        <span className="text-sm font-semibold text-slate-500">{open ? '▴ Hide' : '▾ Show'}</span>
      </button>
      {open && (
        <div className="mt-2 text-sm text-slate-800">
          <p className="mb-2 text-slate-600">Every homeowner buys on one button: <b>F</b>ear of loss, <b>I</b>ndifference, <b>G</b>reed or <b>S</b>ense of urgency. Ask these as you go — they fit the slide — and listen to the answer.</p>
          {steps.map((st) => (
            <div key={st.step} className="mb-3">
              <div className="font-bold text-amber-900">{st.step}</div>
              {st.qs.map((x, i) => (
                <div key={i} className="mt-1 pl-3">
                  <div>❓ “{x.q}”</div>
                  <div className="text-[12.5px] text-slate-600">Listen for: {x.hear}</div>
                </div>
              ))}
              {st.note && <div className="mt-1 pl-3 text-[12.5px] font-semibold text-amber-900">{st.note}</div>}
            </div>
          ))}
          <PlaybookTabs sectionKey={all ? 'full' : sectionKey} />
          <div className="mt-3 font-bold text-brand-navy">The four buttons at a glance</div>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            {IMPULSES.map((imp) => {
              const g = IMPULSE_GUIDE[imp.key]
              return (
                <div key={imp.key} className="rounded-lg border border-amber-200 bg-white p-3">
                  <div className="font-bold text-brand-navy"><span className="mr-1 rounded bg-brand-navy px-1.5 text-xs text-white">{imp.short}</span>{imp.label}</div>
                  <ul className="mt-1 list-disc pl-5 text-[12.5px] text-slate-700">{g.listen.map((l, i) => <li key={i}>{l}</li>)}</ul>
                  <div className="mt-1 text-[12.5px]"><b>Confirm it:</b> {g.confirm}</div>
                  <div className="text-[12.5px]"><b>Sell to it:</b> {g.sell}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// PART 2 — once you know it, keep hitting it: pick the button, see the angle on each slide.
function PlaybookTabs({ sectionKey }) {
  const [k, setK] = useState('fear')
  const rows = playbookFor(k, sectionKey)
  return (
    <div className="mt-4 rounded-lg border border-amber-300 bg-white p-3">
      <div className="font-bold text-brand-navy">Found it? Keep hitting it on every slide</div>
      <p className="text-[12.5px] text-slate-600">Same slides, same points — lead with the part that hits their button, and tie it back to them every time.</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {IMPULSES.map((imp) => (
          <button key={imp.key} type="button" onClick={() => setK(imp.key)}
            className={`rounded-full px-3 py-1 text-xs font-bold ${k === imp.key ? 'bg-brand-navy text-white' : 'border border-slate-300 text-slate-700'}`}>{imp.short} · {imp.label}</button>
        ))}
      </div>
      <div className="mt-2 space-y-1.5">
        {rows.map((r) => (
          <div key={r.step} className="text-[13px]"><b className="text-amber-900">{r.step}:</b> {r.angle}</div>
        ))}
      </div>
    </div>
  )
}

export function ImpulseCard({ imp, read, forRep = false }) {
  if (!imp?.actual) return null
  const actual = impulseByKey(imp.actual), guess = impulseByKey(imp.guess)
  const right = guess && guess.key === actual?.key
  return (
    <div className={`rounded-xl border p-4 ${right ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
      <div className="font-bold text-brand-navy">🎯 The impulse factor (FIGS)</div>
      <div className="mt-1 text-slate-800">
        The homeowner was driven by <b>{actual?.label}</b>. {forRep ? 'You' : 'The rep'} said <b>{guess ? guess.label : 'not sure'}</b>{' '}
        {right ? <span className="font-bold text-emerald-700">✅ Got it</span> : <span className="font-bold text-amber-700">{forRep ? '· next time, listen for the clues below' : '❌ Missed it'}</span>}
      </div>
      {(read?.clues || []).length > 0 && (
        <div className="mt-2 text-sm text-slate-700"><b>Where it showed:</b><ul className="list-disc pl-5">{read.clues.map((c, i) => <li key={i}>{c}</li>)}</ul></div>
      )}
      {read?.uncovered && <p className="mt-1 text-sm text-slate-700"><b>Questions that drew it out:</b> {read.uncovered}</p>}
      {read?.used_in_close && <p className="mt-1 text-sm text-slate-700"><b>Used in the close:</b> {read.used_in_close}</p>}
      {read?.tip && <p className="mt-1 text-sm text-slate-700"><b>{forRep ? 'Try asking:' : 'Question to find it faster:'}</b> {read.tip}</p>}
      {/* Through the presentation, slide by slide: what they said, which button it pointed to (Neal, 2026-10-01). */}
      {(read?.moments || []).length > 0 && (
        <div className="mt-3">
          <div className="text-sm font-bold text-brand-navy">What {forRep ? 'they' : 'the homeowner'} said along the way</div>
          <div className="mt-1 space-y-1.5">
            {read.moments.map((m, i) => {
              const hit = m.points_to === actual?.short
              return (
                <div key={i} className="flex gap-2 text-sm">
                  <span className="w-28 flex-none text-[12px] font-semibold text-slate-500">{m.where}</span>
                  <span className={`flex-none rounded px-1.5 text-[12px] font-bold text-white ${hit ? 'bg-emerald-600' : 'bg-slate-400'}`} title={hit ? 'Pointed to the real button' : 'Pointed elsewhere'}>{m.points_to}</span>
                  <span className="text-slate-800">“{m.homeowner_said}”{m.rep_did ? <span className="text-slate-500"> — {m.rep_did}</span> : null}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
      {(read?.should_have_asked || []).length > 0 && (
        <div className="mt-3 text-sm">
          <div className="font-bold text-brand-navy">Questions that would have found it</div>
          <ul className="mt-1 list-disc pl-5 text-slate-700">{read.should_have_asked.map((q, i) => <li key={i}><b>{q.where}:</b> “{q.question}”</li>)}</ul>
        </div>
      )}
      {read?.keep_hitting && <p className="mt-2 text-sm text-slate-700"><b>Keep hitting it:</b> {read.keep_hitting}</p>}
      <a href="/find-the-button" target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-bold text-amber-800 underline">🎯 Find their button — the class</a>
    </div>
  )
}

export default function SalesPractice() {
  const [stage, setStage] = useState('setup') // setup | live | report
  const [classes, setClasses] = useState([])
  const [traineeId, setTraineeId] = useState('')
  const [personaKey, setPersonaKey] = useState('welcome') // start new reps on the very easy one
  const [sectionKey, setSectionKey] = useState('full')
  const [impulsePick, setImpulsePick] = useState('random') // 'random' or an IMPULSES key (Neal, 2026-10-07)
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
    const d = await api({ action: 'invite', invite: { ...linkForm, trainee_id: trainee?.id || null, class_id: trainee?.class_id || null, persona_key: personaKey, section: effectiveSection, ...(impulsePick !== 'random' && IMPULSE_SECTIONS.includes(effectiveSection) ? { impulse: impulsePick } : {}) } })
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
        impulseKey={impulsePick !== 'random' ? impulsePick : null}
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

      <Step n="2" title="What are they doing?">
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
        <GradingGuide sectionKey={sectionKey} slideN={slideN} slidePoints={slidePoints} />
      </Step>

      <Step n="3" title="Easy, medium or hard? Pick the homeowner">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[...PERSONAS].sort((x, y) => ({ 'Very easy': -1, Easy: 0, Medium: 1, Hard: 2, 'Very hard': 3 }[x.difficulty] - { 'Very easy': -1, Easy: 0, Medium: 1, Hard: 2, 'Very hard': 3 }[y.difficulty])).map((p) => (
            <button key={p.key} type="button" onClick={() => setPersonaKey(p.key)}
              className={`rounded-xl border p-4 text-left transition ${personaKey === p.key ? 'border-brand-navy bg-brand-navy-50 ring-2 ring-brand-navy' : 'border-slate-200 bg-white hover:border-slate-400'}`}>
              <div className="flex items-center justify-between">
                <span className="font-bold text-brand-navy">{p.tagline}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${p.difficulty === 'Very hard' ? 'bg-red-700 text-white' : p.difficulty === 'Hard' ? 'bg-red-50 text-red-700' : p.difficulty === 'Very easy' ? 'bg-emerald-600 text-white' : p.difficulty === 'Easy' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{p.difficulty}</span>
              </div>
              <div className="mt-0.5 text-xs text-slate-500">{p.name}</div>
              <div className="mt-2 text-sm text-slate-700">{p.blurb}</div>
            </button>
          ))}
        </div>
      </Step>

      {/* 4. THE IMPULSE FACTOR (Neal, 2026-10-07: "click the sales person, then what is he/she doing, then easy
          med hard, then impulse factor"). Pick the homeowner's hidden impulse (FIGS) or leave it a surprise.
          Only the parts that use an impulse offer it. */}
      <Step n="4" title="Impulse factor">
        {IMPULSE_SECTIONS.includes(effectiveSection) ? (
          <>
            <div className="flex flex-wrap gap-2">
              {[{ key: 'random', label: '🎲 Surprise me' }, ...IMPULSES].map((x) => (
                <button key={x.key} type="button" onClick={() => setImpulsePick(x.key)}
                  className={`rounded-lg border px-4 py-2 text-sm font-bold ${impulsePick === x.key ? 'border-brand-navy bg-brand-navy text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-500'}`}>
                  {x.short ? `${x.short} · ` : ''}{x.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-500">{impulsePick === 'random' ? 'The homeowner gets one of the four at random. Nobody knows which until the end.' : `The homeowner's hidden impulse will be ${impulseByKey(impulsePick).label}. Don't tell the rep; at the end they're asked which it was.`}</p>
            <div className="mt-3"><ImpulseLesson sectionKey={effectiveSection} /></div>
          </>
        ) : <p className="text-sm text-slate-500">This part doesn't use an impulse factor.</p>}
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

      <History sessions={history} onOpen={(id) => { setReportId(id); setStage('report') }}
        onDelete={async (s) => {
          if (!window.confirm(`Delete ${s.trainee_name}'s practice run from ${fmtWhen(s.started_at)}? This can't be undone.`)) return
          const d = await api({ action: 'delete', id: s.id })
          if (!d.ok) window.alert(d.error || 'Could not delete it.')
          loadHistory()
        }} />
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
export function LiveSession({ persona, section, trainee, onDone, fetchToken = trainerToken, saveSession = null, impulseKey = null }) {
  const [status, setStatus] = useState('starting')
  const [err, setErr] = useState('')
  const [entries, setEntries] = useState([])
  const [level, setLevel] = useState(0)
  const [micName, setMicName] = useState('')
  const [page, setPage] = useState(section.firstSlide) // 0 = no slide (intro + survey)
  const [closeSilence, setCloseSilence] = useState(null)
  const [saving, setSaving] = useState(false)
  const [muted, setMuted] = useState(false)
  // "IT STARTED TALKING AND THEN STOPPED" (Chad, 2026-10-01). The homeowner speaks first and
  // then waits for the rep. If the mic isn't reaching us it just sits there, which looks
  // broken. Track when we last heard the rep's voice; after 12s of waiting with nothing,
  // say so plainly.
  const lastVoiceRef = useRef(Date.now())
  const [cantHear, setCantHear] = useState(false)
  useEffect(() => { if (level > 0.02 || status === 'speaking') { lastVoiceRef.current = Date.now(); if (cantHear) setCantHear(false) } }, [level, status]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setInterval(() => setCantHear(status === 'listening' && !muted && Date.now() - lastVoiceRef.current > 12000), 1000)
    return () => clearInterval(t)
  }, [status, muted])
  // FIGS (Neal, 27 Sep): a full presentation secretly gives the homeowner one
  // impulse factor; at the end the rep is asked which it was.
  const [impulse] = useState(() => (IMPULSE_SECTIONS.includes(section.key) ? (impulseByKey(impulseKey)?.key || IMPULSES[Math.floor(Math.random() * IMPULSES.length)].key) : null))
  const [guessFor, setGuessFor] = useState(null) // the stopped session, waiting for the rep's answer
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
      systemPrompt: homeownerPrompt(persona, section.key, impulse),
      voice: persona.voice,
      getToken: fetchToken,
      on: { status: setStatus, transcript: setEntries, level: setLevel, error: setErr, closeSilence: setCloseSilence, mic: setMicName },
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
      if (!section.firstSlide) return // door / survey: no slides
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
    if (impulse) { setSaving(false); setGuessFor(out); return } // ask the rep first, then save
    await finish(out, null)
  }

  const finish = async (out, guess) => {
    setSaving(true)
    const session = {
      trainee_id: trainee?.id || null, trainee_name: trainee?.name || 'Trainer try-out', class_id: trainee?.class_id || null,
      persona_key: persona.key, section: section.key,
      started_at: out.startedAt, ended_at: out.endedAt, transcript: out.entries, close_silence: out.closeSilence, usage: out.usage,
      ...(impulse ? { impulse: { actual: impulse, guess: guess || 'unsure' } } : {}),
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

  if (guessFor) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <div className="text-4xl">🎯</div>
        <h2 className="mt-2 text-xl font-bold text-brand-navy">One last question</h2>
        <p className="mt-1 text-slate-600">What was {persona.speaker}&rsquo;s <b>impulse factor</b>? What was really driving them?</p>
        <div className="mt-4 grid gap-2">
          {IMPULSES.map((x) => (
            <button key={x.key} type="button" disabled={saving} onClick={() => finish(guessFor, x.key)}
              className="rounded-lg border-2 border-brand-navy px-4 py-3 text-lg font-bold text-brand-navy hover:bg-brand-navy-50 disabled:opacity-50">
              <span className="mr-2 rounded bg-brand-navy px-2 py-0.5 text-sm text-white">{x.short}</span>{x.label}
            </button>
          ))}
          <button type="button" disabled={saving} onClick={() => finish(guessFor, 'unsure')} className="mt-1 text-sm font-semibold text-slate-500 underline">I&rsquo;m not sure</button>
        </div>
        {saving && <p className="mt-3 text-sm text-slate-500">Saving and grading…</p>}
        {err && <p className="mt-3 text-sm font-semibold text-red-700">{err}</p>}
      </div>
    )
  }

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
          <button type="button" onClick={() => liveRef.current?.yourTurn()} title="Done talking? Tap so the homeowner answers now (handy in a noisy room)."
            className="rounded-md border-2 border-emerald-600 px-3 py-1.5 text-sm font-bold text-emerald-700 hover:bg-emerald-50">
            ✋ Your turn
          </button>
          <button type="button" onClick={() => { setMuted((m) => { liveRef.current?.setMuted(!m); return !m }) }}
            className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${muted ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-slate-300 text-slate-600'}`}>
            {muted ? '🔇 Mic paused' : 'Pause mic'}
          </button>
          <button type="button" onClick={end} disabled={saving} className="rounded-md bg-brand-navy px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
            {saving ? 'Saving…' : '⏹ End & grade'}
          </button>
        </div>
      </div>
      {micName && <div className="mt-1 text-xs text-slate-500">🎙️ Using: <b>{micName}</b> <span className="text-slate-400">(wrong one? pick it from the mic icon in Chrome&rsquo;s address bar, then restart)</span></div>}
      {cantHear && (
        <div className="mt-3 rounded-md border-2 border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="font-bold">🎙️ We can&rsquo;t hear you — {persona.speaker} is waiting for you to talk.</div>
          <div className="mt-1">The green bar next to “Listening” should move when you speak. If it doesn&rsquo;t:</div>
          <ul className="mt-1 list-disc pl-5">
            <li>Check the microphone it&rsquo;s using{micName ? <> (<b>{micName}</b>)</> : null} — pick the right one from the mic icon in the address bar, then restart.</li>
            <li>Make sure your computer or headset isn&rsquo;t muted, and that “Pause mic” above is off.</li>
            <li>Use Chrome on a laptop or desktop. Then press <b>⏹ End &amp; grade</b> to save, or start again.</li>
          </ul>
        </div>
      )}
      {err && <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{err}</div>}

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_360px]">
        <div>
          {page === 0 ? (
            section.door ? (
              <div className="flex aspect-video flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-8 text-center">
                <div className="text-5xl">🚪</div>
                <div className="mt-3 text-xl font-bold text-brand-navy">At the front door</div>
                <p className="mt-2 max-w-md text-sm text-slate-600">You just knocked. {persona.speaker} opens the door; they got our mailer about their roof but weren’t expecting you. Get them to say yes to the free roof inspection.</p>
              </div>
            ) : section.surveySheet ? (
              <div>
                <img src="/practice-slides/s-survey.jpg" alt="Customer Survey" className="w-full rounded-xl border border-slate-200 bg-white shadow-sm" />
                <p className="mt-2 text-sm text-slate-600">☕ <b>The warm-up.</b> You&rsquo;ve just walked in; you&rsquo;re not at the kitchen table yet. {persona.speaker} starts with one-word answers. Turn that into a real conversation (common ground, their wants and needs), and when they&rsquo;re talking freely, move to the kitchen table. The survey is here for your eyes only, as training wheels; if you&rsquo;re experienced, just talk.</p>
              </div>
            ) : (
            <div className="flex aspect-video flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-8 text-center">
              <div className="text-5xl">☕</div>
              <div className="mt-3 text-xl font-bold text-brand-navy">At the kitchen table</div>
              <p className="mt-2 max-w-md text-sm text-slate-600">Intro and customer survey: no slides yet. {persona.speaker} and their spouse are sitting across from you. Start whenever you’re ready.</p>
            </div>
            )
          ) : (
            <img src={slideSrc(page)} alt={`Slide ${page}`} className="w-full rounded-xl border border-slate-200 bg-white shadow-sm" />
          )}
          {section.firstSlide > 0 && <div className="mt-2 flex items-center justify-between text-sm">
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded-md border border-slate-300 px-3 py-1.5 font-semibold">← Back</button>
            <span className="text-slate-500">{page ? `Deck page ${page} of ${DECK.length} · ${DECK[page - 1]?.script}` : 'No slide'} · ← → keys work</span>
            <button type="button" onClick={() => setPage((p) => Math.min(DECK.length, p + 1))} className="rounded-md border border-slate-300 px-3 py-1.5 font-semibold">Next →</button>
          </div>}
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

export function Report({ id, onBack, load = trainerLoad, canRegrade = true, audioLoad = (rid) => api({ action: 'audio', id: rid }) }) {
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
      {s.grade_status === 'done' && audioLoad && (
        <PracticeAudio key={`au-${id}-${nonce}`} tone="navy" fileName={`${String(s.trainee_name || "Practice").replace(/[^A-Za-z0-9]+/g, "-")}-coaching-plan`} title="Listen: the coaching plan" sub="About a minute — the one thing to work on, what to assign, what to watch on a ride-along."
          fetchAudio={async () => { const d = await audioLoad(id); return d?.ok ? { ...d, url: d.manager } : d }} />
      )}

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

      {s.grade_status === 'done' && <CoachingPlan r={r} />}

      {s.grade_status === 'done' && r.drill && <DrillReport r={r} speaker={p.speaker} />}

      {s.grade_status === 'done' && !r.drill && (
        <>
          <Card title="📝 Summary and how it ended">
            <p className="text-slate-800">{r.summary}</p>
            {r.outcome && <p className="mt-2 text-sm text-slate-600"><span className="font-semibold">How it ended:</span> {r.outcome}</p>}
            {r.not_reached && <p className="mt-2 text-sm text-slate-500"><span className="font-semibold">Not reached (not graded):</span> {r.not_reached}</p>}
            {s.close_silence && (
              <p className={`mt-2 text-sm font-semibold ${s.close_silence.held ? 'text-emerald-700' : 'text-red-700'}`}>
                {s.close_silence.held ? `✓ Held the silence after asking for the business (${s.close_silence.seconds}s)` : `✗ Spoke again ${s.close_silence.seconds}s after asking for the business. The script says: do not speak until they do.`}
              </p>
            )}
          </Card>

          {(r.impulse || r.impulse_read) && <Card title="🧠 What was driving the homeowner (FIGS)"><ImpulseCard imp={r.impulse} read={r.impulse_read} /></Card>}
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
                  When the homeowner asked a question, the rep led back with a question within two turns{' '}
                  <span className="font-bold">{r.questions.answered_with_question} of {r.questions.answered_with_question + r.questions.just_answered}</span> times
                  {r.questions.just_answered ? <span className="text-amber-700"> · kept answering without leading {r.questions.just_answered} (control drifted)</span> : null}
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
                      <div className="text-slate-900"><span className="font-semibold">The angle to take</span> <span className="text-xs italic text-slate-500">(the approach, not these exact words)</span>: {m.take_it_back}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          <div>
            <Card title="🔧 Fix these first" tone="red"><ol className="list-decimal space-y-1 pl-5">{(r.top_fixes || []).map((x, i) => <li key={i}>{x}</li>)}</ol></Card>
            <Card title="💪 What went well" tone="green"><ul className="list-disc space-y-1 pl-5">{(r.strengths || []).map((x, i) => <li key={i}>{x}</li>)}</ul></Card>
          </div>

          {(r.objections || []).length > 0 && (
            <Card title="🛑 Objections">
              <div className="space-y-3">
                {r.objections.map((o, i) => (
                  <div key={i} className="border-b border-slate-100 pb-2 last:border-0">
                    <div className="font-semibold text-slate-800">“{o.objection}” <span className={`ml-1 rounded-full px-2 py-0.5 text-[11px] ${o.handled === 'well' ? 'bg-emerald-50 text-emerald-700' : o.handled === 'partly' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>{o.handled}</span>
                      {o.parked && <span className={`ml-1 rounded-full px-2 py-0.5 text-[11px] ${o.came_back === 'no' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'}`}>🅿️ parked{o.came_back === 'yes' ? ' · came back ✓' : o.came_back === 'no' ? ' · never came back' : o.came_back === 'not reached' ? ' · not reached yet' : ''}</span>}
                    </div>
                    <div className="text-sm text-slate-600"><span className="font-semibold">They said:</span> {o.what_rep_said}</div>
                    <div className="text-sm text-slate-800"><span className="font-semibold">The angle to take</span> <span className="text-xs italic text-slate-500">(the approach, not these exact words)</span>: {o.say_instead}</div>
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
                    {(x.off_script || []).length > 0 && <div className="text-sm text-amber-700">📜 Off script: {x.off_script.join(' · ')}</div>}
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

// FOR THE MANAGER: what this rep needs to work on and what to assign next, plus
// exactly what the rep was told (a link practice shows them only that, no grade).
function CoachingPlan({ r }) {
  const [showRep, setShowRep] = useState(false)
  const m = r.manager_plan, e = r.encouragement
  if (!m && !e) return null
  return (
    <section className="mt-4 rounded-xl border-2 border-brand-navy bg-white p-4">
      <h2 className="font-bold text-brand-navy">🧭 Coaching plan (manager view)</h2>
      {m?.focus && <p className="mt-1 text-slate-800"><b>Work on:</b> {m.focus}</p>}
      {(m?.assign || []).length > 0 && (
        <div className="mt-2">
          <div className="text-sm font-semibold text-slate-700">Assign next:</div>
          <ul className="list-disc pl-5 text-sm text-slate-800">{m.assign.map((a, i) => <li key={i}><b>{a.practice}</b>: {a.why}</li>)}</ul>
        </div>
      )}
      {m?.ride_along && <p className="mt-2 text-sm text-slate-700"><b>On a ride-along, watch for:</b> {m.ride_along}</p>}
      {e && (
        <div className="mt-3">
          <button type="button" onClick={() => setShowRep((v) => !v)} className="text-sm font-semibold text-brand-navy">{showRep ? 'Hide' : 'Show'} what the rep was told</button>
          {showRep && (
            <div className="mt-2 rounded-lg bg-emerald-50 p-3 text-sm text-slate-800">
              <p>{e.opening}</p>
              {(e.wins || []).length > 0 && <ul className="mt-1 list-disc pl-5">{e.wins.map((x, i) => <li key={i}>{x}</li>)}</ul>}
              {(e.level_up || []).length > 0 && <ul className="mt-1 list-disc pl-5">{e.level_up.map((x, i) => <li key={i}>{x}</li>)}</ul>}
              <p className="mt-1 font-semibold">{e.closing}</p>
            </div>
          )}
        </div>
      )}
    </section>
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
      {(r.off_script || []).length > 0 && (
        <Card title="📜 Off script (the angle, not the words)" tone="red"><ul className="list-disc space-y-1 pl-5">{r.off_script.map((x, i) => <li key={i}>{x}</li>)}</ul></Card>
      )}
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
              {x.better_question && <div className="text-slate-900"><span className="font-semibold">The angle to take</span> <span className="text-xs italic text-slate-500">(the approach, not these exact words)</span>: {x.better_question}</div>}
            </div>
          ))}
        </div>
      </Card>
    </>
  )
}

// COLLAPSIBLE (Neal, 2026-10-09: the report "just looks huge"): every section under the coaching plan starts
// closed — tap its title to read it.
function Card({ title, tone, children, open = false }) {
  const border = tone === 'red' ? 'border-red-200' : tone === 'green' ? 'border-emerald-200' : 'border-slate-200'
  return (
    <details open={open} className={`group mt-3 rounded-xl border ${border} bg-white`}>
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 font-bold text-brand-navy">
        <span>{title}</span><span className="text-slate-400 group-open:rotate-90">▸</span>
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  )
}

// ── Past sessions ────────────────────────────────────────────────────────────
function History({ sessions, onOpen, onDelete }) {
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
          <div key={s.id} role="button" tabIndex={0} onClick={() => onOpen(s.id)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(s.id) }}
            className="grid w-full cursor-pointer grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-slate-100 px-4 py-2 text-left last:border-0 hover:bg-slate-50">
            <span>
              <span className="font-semibold text-slate-800">{s.trainee_name}</span>
              <span className="text-slate-500"> → {personaByKey(s.persona_key).tagline} · {sectionByKey(s.section).label}</span>
              <span className="block text-xs text-slate-400">{fmtWhen(s.started_at)} · {fmtDur(s.duration_sec)}{s.trainer_name ? ` · ${s.trainer_name}` : ''}</span>
            </span>
            <span className="text-right">
              <span className={`block text-xl font-black ${scoreColor(s.score)}`}>{s.grade_status === 'done' ? (s.score ?? '—') : s.grade_status === 'pending' ? '…' : s.grade_status === 'invited' ? '📲' : '—'}</span>
              <span className="block text-[11px] text-slate-400" title="What Google charged for the conversation and the grading">{s.cost != null ? `$${Number(s.cost).toFixed(2)}` : 'cost n/a'}</span>
            </span>
            {onDelete && (
              <button type="button" title="Delete this practice run" onClick={(e) => { e.stopPropagation(); onDelete(s) }}
                className="rounded-md px-2 py-1 text-slate-400 hover:bg-red-50 hover:text-red-600">🗑</button>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

// The whole class on one page — /find-the-button (public, read-only): for a Zoom class or to
// send to reps (Neal, 2026-10-01).
export function FindTheButtonPage() {
  useEffect(() => { document.title = 'Find Their Button (FIGS) · U.S. Shingle' }, [])
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-bold tracking-tight text-brand-navy">🎯 Find their button</h1>
        <p className="mb-4 mt-1 text-sm text-slate-600">Every homeowner buys on one impulse: <b>Fear of loss, Indifference, Greed or Sense of urgency</b>. You find it with questions — asked as you go, on the slide you are already on — then you close on it.</p>
        <ImpulseLesson all />
      </div>
    </div>
  )
}
