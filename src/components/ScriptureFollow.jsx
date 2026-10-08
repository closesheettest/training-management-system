// 📖 DONE WITH THE SCRIPTURE? (Neal, 2026-10-08: "it knows you're done reading the scripture … a pop-up in front of you
// over the scripture … then it goes back to you, but it's still on my screen, up in the corner"). VOICE ONLY — no timer:
// "I might not start reading the scripture for 30 seconds."
//
// While the host who put the scripture up has it on screen, their browser listens (Chrome's built-in speech-to-text,
// the host's own mic, nothing sent to us). It waits until it hears them START the passage (a few of its opening words),
// then until it hears the LAST words — in verse-by-verse mode, the last words of the last verse. Then a pop-up over
// their screen only: "Done with the scripture? → Back to you". Back to you = the room sees the host again, and the
// passage stays on the host's own screen in a small card in the corner (drag it, shrink it, ✕ to close).
import { useEffect, useRef, useState } from 'react'

const words = (t) => String(t || '').toLowerCase().replace(/[’'`]/g, '').replace(/[^a-z0-9\s]+/g, ' ').split(/\s+/).filter(Boolean)

export function ScriptureFollow({ sc, active, onBack }) {
  const [ask, setAsk] = useState(false)
  const [listening, setListening] = useState(false)
  const st = useRef({ heard: [], started: false, key: '', snoozeAt: 0 })
  const all = sc && sc.mode === 'all'
  const verses = sc?.verses || []
  const idx = Math.min(sc?.idx || 0, Math.max(0, verses.length - 1))
  const isLast = !!sc && (all || idx >= verses.length - 1)
  const target = sc ? words(all ? verses.map((v) => v.text).join(' ') : verses.map((v) => v.text).join(' ')) : []
  const tail = sc ? words((all ? verses.map((v) => v.text).join(' ') : verses[idx]?.text) || '').slice(-6) : []
  const key = sc ? `${sc.ref}|${sc.version}|${all ? 'all' : idx}` : ''
  const tgt = useRef({ target, tail, isLast, key })
  tgt.current = { target, tail, isLast, key }

  // A new passage (or a new verse) starts the "is he reading yet / at the end yet" check fresh.
  useEffect(() => {
    if (st.current.key === key) return
    const samePassage = st.current.key.split('|')[0] === key.split('|')[0] // moving verse to verse keeps "he's reading"
    st.current = { heard: samePassage ? st.current.heard : [], started: samePassage && st.current.started, key, snoozeAt: 0 }
    setAsk(false)
  }, [key])

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!active || !SR) { setListening(false); return }
    let alive = true, rec = null
    const check = () => {
      const t = tgt.current, s = st.current
      const recent = s.heard.slice(-40)
      if (!s.started) {
        const opening = new Set(t.target.slice(0, 14).filter((w) => w.length > 2))
        const hits = new Set(recent.filter((w) => opening.has(w)))
        if (hits.size >= 3) s.started = true
      }
      if (s.started && t.isLast && t.tail.length) {
        const last = new Set(recent.slice(-20))
        const need = Math.min(4, Math.max(2, t.tail.length - 2))
        const got = t.tail.filter((w) => last.has(w)).length
        if (got >= need && Date.now() - s.snoozeAt > 15000) setAsk(true)
      }
    }
    const start = () => {
      if (!alive) return
      rec = new SR(); rec.continuous = true; rec.interimResults = true; rec.lang = 'en-US'
      rec.onresult = (e) => {
        let txt = ''
        for (let i = e.resultIndex; i < e.results.length; i++) txt += ` ${e.results[i][0].transcript}`
        const w = words(txt)
        if (!w.length) return
        // interim results repeat; keep a rolling window of what's been said lately
        st.current.heard = [...st.current.heard, ...w].slice(-80)
        check()
      }
      rec.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { alive = false; setListening(false) } }
      rec.onend = () => { if (alive) setTimeout(start, 300) } // Chrome stops after a silence — keep listening
      try { rec.start(); setListening(true) } catch { /* already started */ }
    }
    start()
    return () => { alive = false; try { rec && rec.abort() } catch { /* gone */ } setListening(false) }
  }, [active])

  if (!active) return null
  return (
    <>
      {listening && !ask && (
        <div title="Listening for you to finish reading — when you read the last words, you'll be asked if you're done." style={{ position: 'fixed', left: 12, bottom: 78, zIndex: 58, background: 'rgba(15,23,42,.85)', color: '#fde68a', borderRadius: 999, padding: '4px 10px', fontSize: 12, fontWeight: 700 }}>
          🎙 {st.current.started ? (isLast ? 'Following along — listening for the last words' : 'Following along') : 'Waiting for you to start reading'}
        </div>
      )}
      {ask && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.35)' }}>
          <div style={{ background: '#fff', color: '#111827', borderRadius: 16, padding: '20px 22px', width: 'min(420px, 92vw)', boxShadow: '0 20px 50px rgba(0,0,0,.4)', textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 900 }}>📖 Done with the scripture?</div>
            <div style={{ fontSize: 13.5, color: '#475569', margin: '6px 0 14px' }}>Everyone sees you again. {sc?.ref} stays on your screen in the corner.</div>
            <button autoFocus onClick={() => { setAsk(false); onBack(sc) }} style={{ width: '100%', padding: '13px', borderRadius: 12, border: 'none', background: '#16a34a', color: '#fff', fontSize: 17, fontWeight: 900, cursor: 'pointer' }}>✅ Yes — back to me</button>
            <button onClick={() => { st.current.snoozeAt = Date.now(); setAsk(false) }} style={{ marginTop: 8, width: '100%', padding: '10px', borderRadius: 12, border: '1px solid #cbd5e1', background: '#fff', color: '#334155', fontSize: 15, fontWeight: 800, cursor: 'pointer' }}>Not yet — keep it up</button>
          </div>
        </div>
      )}
    </>
  )
}

// The passage on the HOST's screen only, after "back to me" — a small card in the corner to teach from.
export function ScriptureCard({ sc, onClose }) {
  const [pos, setPos] = useState({ x: null, y: null })
  const [small, setSmall] = useState(false)
  const drag = useRef(null)
  const onDown = (e) => { const r = e.currentTarget.parentElement.getBoundingClientRect(); drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top }; e.currentTarget.setPointerCapture(e.pointerId) }
  const onMove = (e) => { if (!drag.current) return; setPos({ x: Math.max(0, Math.min(window.innerWidth - 120, e.clientX - drag.current.dx)), y: Math.max(0, Math.min(window.innerHeight - 60, e.clientY - drag.current.dy)) }) }
  const onUp = () => { drag.current = null }
  const place = pos.x == null ? { right: 14, top: 60 } : { left: pos.x, top: pos.y }
  return (
    <div style={{ position: 'fixed', ...place, zIndex: 57, width: small ? 240 : 'min(760px, 92vw)', // big (Neal + DeWayne, 2026-10-08: "double the size … I want to see the scripture") background: '#0b0b0b', color: '#fff', border: '1px solid #3f3f46', borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,.45)' }}>
      <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', cursor: 'move', borderBottom: small ? 'none' : '1px solid #27272a', userSelect: 'none' }}>
        <span style={{ flex: 1, fontWeight: 800, fontSize: small ? 13 : 17, color: '#fbbf24' }}>📖 {sc.ref} · {sc.version}</span>
        <button onClick={() => setSmall((x) => !x)} title={small ? 'Show the text' : 'Shrink'} style={{ background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', fontSize: 14 }}>{small ? '▢' : '–'}</button>
        <button onClick={onClose} title="Close" style={{ background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', fontSize: 16 }}>✕</button>
      </div>
      {!small && (
        <div style={{ maxHeight: '78vh', overflow: 'auto', padding: '14px 18px', fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 'clamp(22px, 2.6vw, 34px)', lineHeight: 1.4 }}>
          {(sc.verses || []).map((v, i) => <span key={i}>{v.n != null ? <sup style={{ color: '#fbbf24', fontSize: '.6em', marginRight: 3 }}>{v.n}</sup> : null}{v.text} </span>)}
        </div>
      )}
      <div style={{ fontSize: 10.5, color: '#71717a', padding: '0 12px 6px' }}>Only you see this.</div>
    </div>
  )
}
