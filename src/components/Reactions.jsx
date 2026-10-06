// 🙏 FLOATING REACTIONS (Neal, 2026-10-06: "floating emojis, especially the 9:15 devotional — amen, heart,
// praying hands"). A "React" button in the meeting's bottom bar opens a row of choices; tapping one floats
// it up the right side of EVERYONE's screen with the sender's first name (LiveKit data, topic 'react').
// Devotional / prayer rooms get the faith set; every other room gets the everyday set.
import { useEffect, useRef, useState } from 'react'
import { useRoomContext } from '@livekit/components-react'
import { RoomEvent } from 'livekit-client'

const FAITH = ['🙏', '❤️', 'AMEN', '🙌', '✝️', '🕊️', '😊', '🔥']
const EVERYDAY = ['👍', '❤️', '👏', '😂', '🔥', '🎉', '🙌', '💯']
export const reactionsFor = (room) => (room?.kind === 'prayer' || /devotion|prayer/i.test(`${room?.slug || ''} ${room?.title || ''}`) ? FAITH : EVERYDAY)

let fire = null // the overlay's "show one" — set while a meeting is open

export function ReactionsOverlay() {
  const room = useRoomContext()
  const [items, setItems] = useState([])
  const n = useRef(0)
  useEffect(() => {
    fire = (emoji, who) => {
      const id = ++n.current
      const item = { id, emoji, who, left: 4 + Math.random() * 12, drift: (Math.random() - 0.5) * 60, dur: 3.6 + Math.random() * 1.2 }
      setItems((xs) => [...xs.slice(-40), item])
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), item.dur * 1000 + 200)
    }
    const onData = (payload, from, _k, topic) => {
      if (topic !== 'react') return
      let m = {}; try { m = JSON.parse(new TextDecoder().decode(payload)) } catch { return }
      if (typeof m.e === 'string' && m.e.length <= 8) fire(m.e, String(from?.name || '').split(' ')[0])
    }
    room.on(RoomEvent.DataReceived, onData)
    return () => { room.off(RoomEvent.DataReceived, onData); fire = null }
  }, [room])
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 60, overflow: 'hidden' }}>
      <style>{'@keyframes rxUp{0%{transform:translate(0,0) scale(.6);opacity:0}10%{opacity:1;transform:translate(0,-6vh) scale(1.1)}80%{opacity:1}100%{transform:translate(var(--dx),-78vh) scale(1);opacity:0}}'}</style>
      {items.map((x) => (
        <div key={x.id} style={{ position: 'absolute', bottom: 70, right: `${x.left}%`, '--dx': `${x.drift}px`, animation: `rxUp ${x.dur}s ease-out forwards`, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {x.emoji === 'AMEN'
            ? <span style={{ fontSize: 30, fontWeight: 900, color: '#fff', background: 'linear-gradient(135deg,#7c3aed,#c026d3)', padding: '4px 14px', borderRadius: 999, boxShadow: '0 4px 14px rgba(0,0,0,.45)' }}>AMEN</span>
            : <span style={{ fontSize: 46, filter: 'drop-shadow(0 3px 6px rgba(0,0,0,.45))' }}>{x.emoji}</span>}
          {x.who && <span style={{ marginTop: 2, fontSize: 12, fontWeight: 800, color: '#fff', background: 'rgba(15,23,42,.7)', padding: '1px 8px', borderRadius: 999 }}>{x.who}</span>}
        </div>
      ))}
    </div>
  )
}

export function ReactButton({ choices }) {
  const room = useRoomContext()
  const [open, setOpen] = useState(false)
  const last = useRef(0)
  const send = (e) => {
    if (Date.now() - last.current < 350) return
    last.current = Date.now()
    fire?.(e, 'You')
    room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ e })), { reliable: true, topic: 'react' }).catch(() => {})
  }
  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button type="button" className="lk-button" onClick={() => setOpen((o) => !o)}>{choices[0] === '🙏' ? '🙏' : '😊'} React</button>
      {open && (
        <div style={{ position: 'absolute', bottom: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 4, padding: 6, borderRadius: 14, background: 'rgba(15,23,42,.95)', boxShadow: '0 8px 24px rgba(0,0,0,.5)', zIndex: 70, whiteSpace: 'nowrap' }}>
          {choices.map((e) => (
            <button key={e} type="button" onClick={() => send(e)} title={e}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: e === 'AMEN' ? 15 : 28, fontWeight: 900, color: '#fff', padding: e === 'AMEN' ? '6px 10px' : '2px 6px', borderRadius: 10, ...(e === 'AMEN' ? { background: 'linear-gradient(135deg,#7c3aed,#c026d3)' } : {}) }}>{e}</button>
          ))}
        </div>
      )}
    </div>
  )
}
