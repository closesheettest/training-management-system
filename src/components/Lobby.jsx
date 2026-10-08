// ⏰ THE LOBBY — the devotional (Neal, 2026-10-08: "the waiting, the lobby where everybody can talk … it starts at 9:15
// and then everybody's in the same room. It acts like a breakaway room that comes together"). Hosts set up in the
// main room; people who arrive from 15 minutes early are in <slug>__lobby with each other. At the start time — or when
// a host presses "Let everyone in" — every lobby page moves itself into the main room (meet.js openState/lobby_open).
import { useEffect, useRef, useState } from 'react'
import { useRoomContext } from '@livekit/components-react'
import { RoomEvent } from 'livekit-client'

const FN = '/.netlify/functions/meet'
const call = async (body) => (await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const pill = { position: 'fixed', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 60, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'center', color: '#fff', padding: '8px 16px', borderRadius: 999, fontWeight: 800, fontSize: 14, boxShadow: '0 4px 16px rgba(0,0,0,.35)', maxWidth: 'calc(100vw - 16px)' }

export function LobbyLayer({ slug, auth, isHost, onTime, lobby, onMove }) {
  const roomCtx = useRoomContext()
  const [now, setNow] = useState(Date.now())
  const [st, setSt] = useState(null)
  const moved = useRef(false)
  useEffect(() => { const iv = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(iv) }, [])
  const go = () => { if (moved.current) return; moved.current = true; onMove(0); setTimeout(() => { moved.current = false }, 8000) }

  // In the lobby: watch for the start (status every 10 s, the host's "let everyone in" message, or the clock).
  useEffect(() => {
    if (!lobby && !(isHost && onTime)) return
    let live = true
    const look = () => call({ action: 'lobby_status', room: slug }).then((j) => { if (!live || !j.ok) return; setSt(j); if (lobby && j.open) go() }).catch(() => {})
    look(); const iv = setInterval(look, lobby ? 10000 : 15000)
    return () => { live = false; clearInterval(iv) }
  }, [lobby, isHost, onTime, slug]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!lobby) return
    const onData = (payload, _from, _k, topic) => { if (topic === 'lobby') go() }
    roomCtx.on(RoomEvent.DataReceived, onData)
    return () => { roomCtx.off(RoomEvent.DataReceived, onData) }
  }, [lobby, roomCtx]) // eslint-disable-line react-hooks/exhaustive-deps
  const startsAt = Date.parse(lobby?.starts_at || st?.starts_at || '')
  const left = Number.isFinite(startsAt) ? Math.max(0, Math.round((startsAt - now) / 1000)) : null
  useEffect(() => { if (lobby && left === 0) go() }, [lobby, left]) // eslint-disable-line react-hooks/exhaustive-deps
  const time = Number.isFinite(startsAt) ? new Date(startsAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) : ''

  if (lobby) return (
    <div style={{ ...pill, background: '#1e3a8a' }}>
      <span>⏰ Lobby — we start promptly at {time}</span>
      {left != null && <span style={{ fontVariantNumeric: 'tabular-nums' }}>{left > 0 ? clock(left) : 'moving you in…'}</span>}
      <span style={{ fontWeight: 600, opacity: 0.9 }}>You'll be moved in automatically.</span>
    </div>
  )
  // The host in the main room, before the start: who's waiting, and the button to bring them in now.
  if (isHost && onTime && st && !st.open && st.waiting > 0) return (
    <div style={{ ...pill, background: '#1e3a8a' }}>
      <span>👥 {st.waiting} waiting in the lobby{left ? ` · starts in ${clock(left)}` : ''}</span>
      <button onClick={async () => { await call({ action: 'lobby_open', room: slug, ...auth }).catch(() => {}); setSt({ ...st, open: true }) }}
        style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 999, padding: '5px 14px', fontWeight: 900, cursor: 'pointer' }}>Let everyone in now</button>
    </div>
  )
  return null
}
