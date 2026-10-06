// 🎭 PRACTICE IN THE MEETING (Neal, 2026-10-04): "now I could select their name and hit start…
// it will use their speaker and their microphone." The trainer picks the trainee who is up, a
// homeowner and a section; the AI homeowner joins the meeting as its own tile, listens ONLY to
// that trainee's microphone, and answers out loud so the whole class hears it. Same homeowners,
// sections and grading as the Sales Training Customer page; the report lands there.
//
// It runs in the trainer's browser: the trainee's meeting audio → Gemini Live (geminiLive.js
// with inputStream) → the homeowner's voice → published into the room from a second, homeowner-
// only connection (meet.js homeowner_token). Trainer PIN only (it spends Gemini money).
import { useEffect, useRef, useState } from 'react'
import { useParticipants, useRoomContext } from '@livekit/components-react'
import { Room, Track } from 'livekit-client'
import { LiveHomeowner } from '../lib/geminiLive.js'
import { supabase } from '../lib/supabase.js'
import { PERSONAS, SECTIONS, DECK, IMPULSES, IMPULSE_SECTIONS, personaByKey, sectionByKey, homeownerPrompt } from '../lib/salesPractice.js'

const ORDER = { 'Very easy': -1, Easy: 0, Medium: 1, Hard: 2, 'Very hard': 3 }
const post = async (fn, body) => (await fetch(`/.netlify/functions/${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json().catch(() => ({ ok: false, error: 'Network error' }))

export default function MeetPractice({ roomSlug, pin, onClose }) {
  const people = useParticipants()
  const ctx = useRoomContext()
  // Put the practice on everyone's screen (and mute everyone but the presenter when it starts).
  const stage = (patch, mute) => post('meet', { action: 'set_practice', room: roomSlug, pin, mute: !!mute, practice: patch })
  // Anyone in the meeting can present — trainees, reps, managers, outside guests (Neal, 2026-10-04:
  // Chad joined from a one-time invite and wasn't in the list) — and YOU, to demo it for the class
  // (Neal, 2026-10-06: "I did the practice with the trainer to show them slides 1–5, no way to pick me").
  const trainees = [...people.filter((p) => p.isLocal), ...people.filter((p) => !p.isLocal && !/^(homeowner|egress)/.test(p.identity))]
  const [who, setWho] = useState('')
  const [personaKey, setPersonaKey] = useState('welcome')
  const [sectionKey, setSectionKey] = useState('full')
  // ONE SLIDE (and the 5-minute control drill) — pick which slide, same list as the Sales Training
  // Customer page (training_days "Slide N" rows) (Neal, 2026-10-04).
  const [slideN, setSlideN] = useState('')
  const [slideList, setSlideList] = useState([])
  useEffect(() => {
    supabase.from('training_days').select('subject, title').order('position')
      .then(({ data }) => setSlideList((data || []).filter((d) => /^Slides?\s*\d/.test(String(d.subject || '').trim()))))
  }, [])
  const picker = sectionKey === 'slide' || sectionKey === 'control'
  const [status, setStatus] = useState('setup') // setup → starting → listening/speaking → saving → done
  const [err, setErr] = useState('')
  const [entries, setEntries] = useState([])
  const [page, setPage] = useState(0)
  const [impulse, setImpulse] = useState(null)
  const [guessFor, setGuessFor] = useState(null)
  const [savedId, setSavedId] = useState(null)
  const live = useRef(null)
  const hoRoom = useRef(null)
  const audioEl = useRef(null)
  const presenter = trainees.find((p) => p.identity === who)
  const persona = personaByKey(personaKey)
  const section = sectionByKey(picker ? (slideN ? `${sectionKey}:${slideN}` : 'full') : sectionKey)

  const cleanup = () => {
    try { hoRoom.current?.disconnect() } catch { /* gone */ }
    hoRoom.current = null
    try { audioEl.current?.pause() } catch { /* gone */ }
  }
  useEffect(() => () => { try { live.current?.stop() } catch { /* gone */ } cleanup() }, [])

  const start = async () => {
    setErr('')
    if (!presenter) { setErr('Pick who is presenting.'); return }
    const mic = presenter.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack
    if (!mic) { setErr(`${presenter.name}'s microphone is off. Ask them to unmute, then press Start.`); return }
    setStatus('starting')
    try {
      // The trainee's voice. Chrome only feeds a remote WebRTC stream into Web Audio while
      // something is playing it, so a muted <audio> keeps it flowing.
      const inStream = new MediaStream([mic])
      audioEl.current = new Audio(); audioEl.current.muted = true; audioEl.current.srcObject = inStream; audioEl.current.play().catch(() => {})
      const imp = IMPULSE_SECTIONS.includes(section.key) ? IMPULSES[Math.floor(Math.random() * IMPULSES.length)].key : null
      setImpulse(imp)
      const h = new LiveHomeowner({
        systemPrompt: homeownerPrompt(persona, section.key, imp), voice: persona.voice, inputStream: inStream, routeOut: true,
        getToken: async () => { const d = await post('practice-token', { pin }); if (!d.ok) throw new Error(d.error || 'Could not start'); return d },
        on: { status: setStatus, transcript: setEntries, error: setErr },
      })
      live.current = h
      // The homeowner's own seat in the meeting, so everyone sees a tile and hears the voice.
      const tok = await post('meet', { action: 'homeowner_token', room: roomSlug, pin, name: persona.speaker })
      if (!tok.ok) throw new Error(tok.error || 'No seat for the homeowner')
      const room = new Room()
      await room.connect(tok.url, tok.token)
      hoRoom.current = room
      await h.start()
      await room.localParticipant.publishTrack(h.outStream.getAudioTracks()[0], { name: 'homeowner', source: Track.Source.Microphone })
      if (section.firstSlide) setPage(section.firstSlide)
      // ON STAGE: everyone muted but the presenter, everyone sees the slide, the presenter gets
      // "say hi to start", and their mic is switched on (Neal, 2026-10-04).
      await stage({ showing: true, presenter: presenter.identity, presenterName: presenter.name || '', homeowner: persona.name, section: section.label, door: section.key === 'door', page: section.firstSlide || 0 }, true)
      if (!presenter.isLocal) { try { await ctx.localParticipant.setMicrophoneEnabled(false) } catch { /* fine */ } }
      try { await ctx.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ type: 'unmute' })), { reliable: true, topic: 'host', destinationIdentities: [presenter.identity] }) } catch { /* they can unmute */ }
    } catch (e) {
      setErr(e.message || String(e)); setStatus('setup'); try { live.current?.stop() } catch { /* gone */ } live.current = null; cleanup()
    }
  }

  // Tell the homeowner which slide is up (the trainer shares the deck; these arrows keep the
  // homeowner in step, like the arrow keys on the Sales Training Customer page).
  useEffect(() => {
    if (!page || !live.current) return
    const d = DECK.find((x) => x.page === page)
    stage({ showing: true, presenter: presenter?.identity, presenterName: presenter?.name || '', homeowner: persona.name, section: section.label, door: section.key === 'door', page })
    live.current.showSlide(`Slide on screen: deck page ${page} (${d?.script || ''})`, d?.seen || '', page >= 29)
  }, [page])

  const finish = async (out, guess) => {
    setStatus('saving')
    const session = {
      trainee_id: /^t:/.test(presenter?.identity || who) ? (presenter?.identity || who).slice(2) : null, trainee_name: presenter?.name || 'Trainee', class_id: null,
      persona_key: persona.key, section: section.key, started_at: out.startedAt, ended_at: out.endedAt,
      transcript: out.entries, close_silence: out.closeSilence, usage: out.usage, via: 'meeting',
      ...(impulse ? { impulse: { actual: impulse, guess: guess || 'unsure' } } : {}),
    }
    const d = await post('practice-api', { pin, action: 'save', session })
    if (!d.ok) { setErr(`Could not save: ${d.error}`); setStatus('done'); return }
    setSavedId(d.id); setStatus('done')
  }
  const end = async () => {
    if (!live.current) return
    const out = live.current.stop(); live.current = null; cleanup()
    stage(null)
    if (!out.entries.some((e) => e.who === 'rep')) { if (!window.confirm('Nothing the trainee said was picked up. Save it anyway?')) { setStatus('setup'); return } }
    if (impulse) { setGuessFor(out); setStatus('guess'); return }
    await finish(out, null)
  }

  // The control drill is timed (5 minutes): end and grade on its own.
  const endRef = useRef(null); endRef.current = end
  const isRunning = ['listening', 'speaking', 'silence'].includes(status)
  useEffect(() => { if (!isRunning || !section.seconds) return; const t = setTimeout(() => endRef.current?.(), section.seconds * 1000); return () => clearTimeout(t) }, [isRunning, section.seconds]) // eslint-disable-line react-hooks/exhaustive-deps
  const box = { position: 'absolute', top: 8, left: 12, zIndex: 60, width: 340, maxHeight: '78vh', overflow: 'auto', background: '#111827', border: '1px solid #7c3aed', borderRadius: 12, padding: 12, color: '#e5e7eb', fontSize: 14 }
  const sel = { width: '100%', padding: '7px 8px', borderRadius: 8, border: '1px solid #374151', background: '#0b1220', color: '#fff', fontSize: 14, marginTop: 4, marginBottom: 8 }
  const running = ['starting', 'connecting', 'listening', 'speaking', 'silence'].includes(status)
  return (
    <div style={box}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <b style={{ flex: 1 }}>🎭 Practice with a homeowner</b>
        {!running && <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: 18, cursor: 'pointer' }}>×</button>}
      </div>
      {status === 'setup' && (
        <>
          <label>Who's presenting<select value={who} onChange={(e) => setWho(e.target.value)} style={sel}>
            <option value="">{trainees.length ? '— pick who is presenting —' : '— nobody else in the meeting yet —'}</option>
            {trainees.map((p) => <option key={p.identity} value={p.identity}>{p.isLocal ? `Me (${p.name || 'you'}) — demo it` : p.name}{p.isMicrophoneEnabled ? '' : ' (muted)'}</option>)}
          </select></label>
          <label>Homeowner<select value={personaKey} onChange={(e) => setPersonaKey(e.target.value)} style={sel}>
            {[...PERSONAS].sort((a, b) => ORDER[a.difficulty] - ORDER[b.difficulty]).map((p) => <option key={p.key} value={p.key}>{p.difficulty}: {p.name}</option>)}
          </select></label>
          <label>Section<select value={sectionKey} onChange={(e) => setSectionKey(e.target.value)} style={sel}>
            {SECTIONS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select></label>
          {picker && (
            <label>Which slide<select value={slideN} onChange={(e) => setSlideN(e.target.value)} style={sel}>
              <option value="">— pick the slide —</option>
              {slideList.map((d) => { const n = parseInt(String(d.subject).match(/\d+/)[0], 10); return <option key={d.subject} value={n}>{d.subject}: {d.title}</option> })}
            </select></label>
          )}
          <p style={{ fontSize: 12.5, color: '#94a3b8', margin: '0 0 8px' }}>The homeowner joins as its own tile and hears only the presenter. Share the slides as usual and use ◀ ▶ here so the homeowner knows which slide is up. Ask everyone else to mute.</p>
          <button onClick={start} disabled={!who || (picker && !slideN)} style={{ width: '100%', padding: '9px', borderRadius: 8, border: 'none', background: who && !(picker && !slideN) ? '#16a34a' : '#374151', color: '#fff', fontWeight: 900, cursor: who ? 'pointer' : 'default' }}>▶ Start</button>
          {!who && <div style={{ fontSize: 12, color: '#fca5a5', marginTop: 6 }}>Pick who's presenting first.</div>}
          {who && picker && !slideN && <div style={{ fontSize: 12, color: '#fca5a5', marginTop: 6 }}>Pick the slide.</div>}
        </>
      )}
      {running && (
        <>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>{presenter?.name || 'Trainee'} → {persona.name}</div>
          <div style={{ fontSize: 13, color: '#fcd34d', marginBottom: 8 }}>{{ starting: 'Starting…', connecting: 'Connecting…', listening: '🎙️ Listening to the presenter', speaking: `🗣️ ${persona.speaker} is talking`, silence: '🤫 Silence after the ask…' }[status]}</div>
          {section.firstSlide ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <button onClick={() => setPage((x) => Math.max(1, x - 1))} style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #475569', background: '#1f2937', color: '#fff', cursor: 'pointer' }}>◀</button>
              <span style={{ flex: 1, textAlign: 'center' }}>Slide {page}</span>
              <button onClick={() => setPage((x) => Math.min(DECK.length, x + 1))} style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #475569', background: '#1f2937', color: '#fff', cursor: 'pointer' }}>▶</button>
            </div>
          ) : null}
          <div style={{ maxHeight: 180, overflow: 'auto', fontSize: 12.5, background: '#0b1220', borderRadius: 8, padding: 8, marginBottom: 8 }}>
            {entries.slice(-12).map((e, i) => <div key={i} style={{ marginBottom: 4 }}><b style={{ color: e.who === 'rep' ? '#93c5fd' : '#fca5a5' }}>{e.who === 'rep' ? (presenter?.name || 'Rep').split(' ')[0] : persona.speaker}:</b> {e.text}</div>)}
            {!entries.length && <span style={{ color: '#64748b' }}>The conversation shows here.</span>}
          </div>
          <button onClick={end} style={{ width: '100%', padding: '9px', borderRadius: 8, border: 'none', background: '#b91c1c', color: '#fff', fontWeight: 900, cursor: 'pointer' }}>⏹ End and grade</button>
        </>
      )}
      {status === 'guess' && (
        <>
          <p style={{ marginBottom: 8 }}>Ask {presenter?.name?.split(' ')[0] || 'them'}: what was {persona.speaker}'s <b>impulse factor</b>?</p>
          {IMPULSES.map((x) => <button key={x.key} onClick={() => finish(guessFor, x.key)} style={{ display: 'block', width: '100%', marginBottom: 6, padding: '8px', borderRadius: 8, border: '1px solid #475569', background: '#1f2937', color: '#fff', fontWeight: 800, cursor: 'pointer', textAlign: 'left' }}>{x.short} · {x.label}</button>)}
          <button onClick={() => finish(guessFor, 'unsure')} style={{ background: 'none', border: 'none', color: '#94a3b8', textDecoration: 'underline', cursor: 'pointer' }}>Not sure</button>
        </>
      )}
      {status === 'saving' && <p>Saving and grading…</p>}
      {status === 'done' && (
        <>
          {savedId && <p style={{ marginBottom: 8 }}>✅ Saved. The report is grading now (a few minutes for a long one). It will be on <a href="/sales-practice" target="_blank" rel="noreferrer" style={{ color: '#93c5fd' }}>Sales Training Customer</a> under {presenter?.name || 'the trainee'}.</p>}
          <button onClick={() => { setStatus('setup'); setEntries([]); setSavedId(null); setErr('') }} style={{ width: '100%', padding: '8px', borderRadius: 8, border: '1px solid #475569', background: '#1f2937', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>Next presenter</button>
        </>
      )}
      {err && <p style={{ color: '#fca5a5', marginTop: 8, fontSize: 13 }}>{err}</p>}
    </div>
  )
}
