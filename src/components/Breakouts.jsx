// 🚪 BREAKOUT ROOMS (Neal, 2026-10-08: "I have four people in training … you A and you B, I'm going to put you in a
// room and you work together on it; you C and you D in another room, for the next 45 minutes, and then we come back
// and go over it again" — what Zoom calls breakout rooms).
//
// The host picks how many rooms, taps people into them, sets the minutes and presses Start. The server keeps the
// assignments (meet.js breakout_start) and puts them on the main room's metadata; each assigned person's page sees
// that and moves itself into its own LiveKit room (<slug>__br<n>), mic open. A countdown bar shows in every room.
// When time runs out — or the host presses "Bring everyone back" — everyone rejoins the main room. The host can drop
// into any room and back. People in a breakout poll breakout_status (their room's metadata doesn't carry it).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useParticipants, useRoomContext, useRoomInfo } from '@livekit/components-react'
import { RoomEvent } from 'livekit-client'

const FN = '/.netlify/functions/meet'
const call = async (body) => (await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()
const metaOf = (p) => { try { return JSON.parse(p?.metadata || '{}') } catch { return {} } }
const stableId = (id) => (/^(host|g|a):/.test(String(id)) ? String(id).replace(/:[a-z0-9]{5}$/, '') : String(id))
const left = (endsAt, now) => Math.max(0, Math.round((Date.parse(endsAt) - now) / 1000))
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

// Runs inside the LiveKit room. breakout = { n, name, ends_at, people } when THIS page is in a breakout room.
export function BreakoutLayer({ slug, auth, isHost, breakout, me, onMove }) {
  const info = useRoomInfo()
  const rmeta = useMemo(() => { try { return JSON.parse(info.metadata || '{}') } catch { return {} } }, [info.metadata])
  const roomCtx = useRoomContext()
  const [now, setNow] = useState(Date.now())
  const [panel, setPanel] = useState(false)
  const [status, setStatus] = useState(null) // breakout_status while in a breakout, or for the host's panel
  const moved = useRef('')
  useEffect(() => { const iv = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(iv) }, [])

  // In the MAIN room: breakouts just started and I'm in one → go.
  const mainBo = !breakout ? rmeta.breakout : null
  useEffect(() => {
    if (!mainBo || isHost) return
    const mine = (mainBo.rooms || []).find((r) => (r.ids || []).includes(me))
    const tag = `${mainBo.ends_at}:${mine?.n || 0}`
    if (mine && moved.current !== tag && Date.parse(mainBo.ends_at) > Date.now()) { moved.current = tag; onMove(mine.n) }
  }, [mainBo, isHost, me, onMove])

  // In a BREAKOUT: follow the server — the host ended it, or time ran out → back to the main room.
  useEffect(() => {
    if (!breakout && !panel) return
    let live = true
    const look = () => call({ action: 'breakout_status', room: slug }).then((j) => {
      if (!live || !j.ok) return
      setStatus(j)
      if (breakout && !j.on) onMove(0)
    }).catch(() => {})
    look(); const iv = setInterval(look, 15000)
    return () => { live = false; clearInterval(iv) }
  }, [breakout, panel, slug, onMove])
  // …and the server's direct "come back" message (sent into every breakout room when the host ends it).
  useEffect(() => {
    if (!breakout) return
    const onData = (payload, from, _k, topic) => {
      if (topic !== 'breakout' || (from && !metaOf(from).host)) return
      let m = {}; try { m = JSON.parse(new TextDecoder().decode(payload)) } catch { return }
      if (m.type === 'back') onMove(0)
    }
    roomCtx.on(RoomEvent.DataReceived, onData)
    return () => { roomCtx.off(RoomEvent.DataReceived, onData) }
  }, [breakout, roomCtx, onMove])

  const endsAt = breakout?.ends_at || mainBo?.ends_at || (status?.on ? status.ends_at : null)
  const secs = endsAt ? left(endsAt, now) : null
  // Time's up → everyone back (the host also closes it on the server, so a late refresh lands in the main room).
  const timeUp = useRef('')
  useEffect(() => {
    if (!endsAt || secs > 0 || timeUp.current === endsAt) return
    timeUp.current = endsAt
    if (isHost) call({ action: 'breakout_end', room: slug, ...auth }).catch(() => {})
    if (breakout) onMove(0)
  }, [secs, endsAt, isHost, breakout, slug, auth, onMove])

  const bringBack = async () => {
    if (!window.confirm('Bring everyone back to the main room now?')) return
    await call({ action: 'breakout_end', room: slug, ...auth }).catch(() => {})
    setPanel(false)
    if (breakout) onMove(0)
  }
  const running = !!(breakout || mainBo || status?.on)
  const roomsNow = (status?.on && status.rooms) || (mainBo?.rooms || []).map((r) => ({ n: r.n, name: r.name, people: [] }))

  return (
    <>
      {/* The bar: in a breakout (everyone), or the host in the main room while breakouts run. */}
      {(breakout || (isHost && mainBo)) && secs != null && (
        <div style={{ position: 'fixed', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 60, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'center',
          background: secs <= 60 ? '#b91c1c' : '#4c1d95', color: '#fff', padding: '7px 14px', borderRadius: 999, fontWeight: 800, fontSize: 14, boxShadow: '0 4px 16px rgba(0,0,0,.35)', maxWidth: 'calc(100vw - 16px)' }}>
          <span>🚪 {breakout ? breakout.name : 'Breakout rooms running'}</span>
          {breakout && (breakout.people || []).length > 0 && <span style={{ fontWeight: 600, opacity: 0.9 }}>with {breakout.people.join(', ')}</span>}
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{secs <= 60 ? `⏰ ${clock(secs)} — back to the main room soon` : `${clock(secs)} left`}</span>
          {isHost && <button onClick={() => setPanel(true)} style={pill('#7c3aed')}>Rooms</button>}
          {isHost && breakout && <button onClick={() => onMove(0)} style={pill('#334155')}>⬅ Main room</button>}
          {isHost && <button onClick={bringBack} style={pill('#16a34a')}>Bring everyone back</button>}
        </div>
      )}
      {isHost && !running && <BreakoutButton onClick={() => setPanel(true)} />}
      {panel && isHost && (running
        ? <RunningPanel rooms={roomsNow} secs={secs} breakout={breakout} onGo={(n) => { setPanel(false); onMove(n) }} onMain={() => { setPanel(false); onMove(0) }} onEnd={bringBack} onClose={() => setPanel(false)} />
        : <SetupPanel slug={slug} auth={auth} onClose={() => setPanel(false)} onStarted={() => setPanel(false)} />)}
    </>
  )
}

const pill = (bg) => ({ background: bg, color: '#fff', border: 'none', borderRadius: 999, padding: '3px 10px', fontWeight: 800, fontSize: 12.5, cursor: 'pointer' })

// The host's way in: a floating button bottom-left (the toolbar is already full).
function BreakoutButton({ onClick }) {
  return <button onClick={onClick} title="Split people into breakout rooms"
    style={{ position: 'fixed', left: 10, bottom: 74, zIndex: 55, background: '#4c1d95', color: '#fff', border: '1px solid #a78bfa', borderRadius: 999, padding: '8px 14px', fontWeight: 800, fontSize: 13.5, cursor: 'pointer', boxShadow: '0 4px 14px rgba(0,0,0,.35)' }}>🚪 Breakout rooms</button>
}

function Modal({ title, onClose, children }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(2,6,23,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#0f172a', color: '#e2e8f0', border: '1px solid #475569', borderRadius: 14, width: 'min(560px, 100%)', maxHeight: '85vh', overflow: 'auto', padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ flex: 1, fontSize: 18, fontWeight: 900, color: '#fff' }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function SetupPanel({ slug, auth, onClose, onStarted }) {
  const all = useParticipants()
  // Everyone but hosts, the recorder and the AI homeowner.
  const people = all.filter((p) => !p.isLocal && !metaOf(p).host && !/^(egress|homeowner)/.test(p.identity))
  const [count, setCount] = useState(2)
  const [minutes, setMinutes] = useState(45)
  const [names, setNames] = useState({})
  const [as, setAs] = useState({}) // identity → room number (0 = stays in the main room)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // Split evenly the first time (and when the number of rooms changes): A,B → Room 1; C,D → Room 2…
  const split = (n) => { const m = {}; people.forEach((p, i) => { m[p.identity] = (i % n) + 1 }); setAs(m) }
  useEffect(() => { split(count) }, [count, people.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const nameOf = (n) => (names[n] || '').trim() || `Room ${n}`
  const start = async () => {
    const rooms = Array.from({ length: count }, (_, i) => i + 1).map((n) => {
      const ps = people.filter((p) => as[p.identity] === n)
      return { name: nameOf(n), ids: ps.map((p) => stableId(p.identity)), people: ps.map((p) => p.name || p.identity) }
    })
    if (!rooms.some((r) => r.ids.length)) { setErr('Put at least one person in a room.'); return }
    setBusy(true); setErr('')
    const j = await call({ action: 'breakout_start', room: slug, rooms, minutes, ...auth }).catch(() => ({ error: 'Network error' }))
    setBusy(false)
    if (!j.ok) { setErr(j.error || 'Could not start.'); return }
    onStarted()
  }
  return (
    <Modal title="🚪 Breakout rooms" onClose={onClose}>
      {!people.length ? <p style={{ color: '#94a3b8' }}>Nobody else is in the meeting yet.</p> : <>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ fontWeight: 700 }}>Rooms{' '}
            <select value={count} onChange={(e) => setCount(Number(e.target.value))} style={field}>{[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}</select>
          </label>
          <label style={{ fontWeight: 700 }}>For{' '}
            <input type="number" min={1} max={180} value={minutes} onChange={(e) => setMinutes(Number(e.target.value) || 1)} style={{ ...field, width: 70 }} /> minutes
          </label>
          <button onClick={() => split(count)} style={{ ...pill('#334155'), padding: '5px 12px' }}>↻ Split evenly</button>
        </div>
        {Array.from({ length: count }, (_, i) => i + 1).map((n) => (
          <div key={n} style={{ border: '1px solid #334155', borderRadius: 10, padding: 10, marginBottom: 8 }}>
            <input value={names[n] || ''} placeholder={`Room ${n}`} onChange={(e) => setNames({ ...names, [n]: e.target.value })} style={{ ...field, width: '100%', fontWeight: 800, marginBottom: 6 }} />
            {people.filter((p) => as[p.identity] === n).map((p) => <div key={p.identity} style={{ fontSize: 14, padding: '2px 0' }}>• {p.name || p.identity}</div>)}
            {!people.some((p) => as[p.identity] === n) && <div style={{ fontSize: 13, color: '#64748b' }}>Nobody yet</div>}
          </div>
        ))}
        <div style={{ fontWeight: 800, margin: '12px 0 6px' }}>Who goes where</div>
        {people.map((p) => (
          <div key={p.identity} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid #1e293b' }}>
            <span style={{ flex: 1 }}>{p.name || p.identity}</span>
            <select value={as[p.identity] || 0} onChange={(e) => setAs({ ...as, [p.identity]: Number(e.target.value) })} style={field}>
              {Array.from({ length: count }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{nameOf(n)}</option>)}
              <option value={0}>Stay in the main room</option>
            </select>
          </div>
        ))}
        {err && <p style={{ color: '#fca5a5', fontWeight: 700 }}>{err}</p>}
        <button disabled={busy} onClick={start} style={{ marginTop: 14, width: '100%', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 14px', fontWeight: 900, fontSize: 15, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Starting…' : `Start: send everyone to their room for ${minutes} min`}
        </button>
        <p style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 8 }}>Everyone moves on their own, mics on. A countdown shows in every room; at the end they all come back here. You can drop into any room.</p>
      </>}
    </Modal>
  )
}

function RunningPanel({ rooms, secs, breakout, onGo, onMain, onEnd, onClose }) {
  return (
    <Modal title={`🚪 Breakout rooms · ${secs != null ? `${clock(secs)} left` : 'running'}`} onClose={onClose}>
      {rooms.map((r) => (
        <div key={r.n} style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #334155', borderRadius: 10, padding: 10, marginBottom: 8, background: breakout?.n === r.n ? '#312e81' : 'transparent' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 900, color: '#fff' }}>{r.name}{breakout?.n === r.n ? ' (you are here)' : ''}</div>
            {(r.people || []).length > 0 && <div style={{ fontSize: 13, color: '#cbd5e1' }}>{r.people.join(', ')}</div>}
          </div>
          {breakout?.n !== r.n && <button onClick={() => onGo(r.n)} style={{ ...pill('#7c3aed'), padding: '6px 12px' }}>Go in</button>}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        {breakout && <button onClick={onMain} style={{ ...pill('#334155'), padding: '9px 14px', fontSize: 14 }}>⬅ Main room</button>}
        <button onClick={onEnd} style={{ ...pill('#16a34a'), padding: '9px 14px', fontSize: 14, flex: 1 }}>Bring everyone back now</button>
      </div>
    </Modal>
  )
}

const field = { background: '#1e293b', color: '#fff', border: '1px solid #475569', borderRadius: 8, padding: '5px 8px', fontSize: 14 }
