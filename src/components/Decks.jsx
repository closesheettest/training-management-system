// 📊 PRESENT IN THE MEETING (Neal, 2026-10-04: "I don't think we need Keynote anymore… click
// Share Day 1 and it goes right in"). The trainer picks a deck; everyone's screen shows it (sharp —
// drawn on each device, not a video of a screen), the trainer moves it and everyone follows, with
// the trainer's camera as a circle in the corner. The recording films the same view.
//
// Two kinds of deck, both already in TMS:
//   reveal — the Week A day decks (/day-N-slides/, Reveal.js): synced by slide + step
//   images — the Week B virtual deck (s-01.jpg …): synced by slide number
import { useEffect, useRef, useState } from 'react'
import { VideoTrack } from '@livekit/components-react'

// Only Week A Day 1 for now — the other days are being rebuilt (Neal, 2026-10-04). Add each day
// here when it's ready (the Week B image deck works the same way: type 'images', base, count, start).
export const DECKS = [
  { key: 'a1', week: 'A', label: 'Week A · Day 1', type: 'reveal', url: '/day-1-slides/' },
  { key: 'vf', label: 'Walkthrough: new virtual training flow', type: 'reveal', url: '/virtual-flow/' },
  // Week B Monday (Neal, 2026-10-04): the warm-up, then Find their button (FIGS), then
  // Question-based selling. Homework: learn slides 1–7, practice 1–7 that night.
  { key: 'b1w', week: 'B', label: 'Week B · Mon 1 · The Warm-Up', type: 'images', base: '/week-b-virtual/s-', count: 10, start: 1 },
  { key: 'b1f', week: 'B', label: 'Week B · Mon 2 · Find their button (FIGS)', type: 'images', base: '/find-their-button/s-', count: 24, start: 1 },
  { key: 'b1q', week: 'B', label: 'Week B · Mon 3 · Question-based selling', type: 'images', base: '/question-selling/s-', count: 19, start: 1 },
]
// A training room only offers its own week's decks (Neal, 2026-10-04: First Week Training shows
// Week A only). Other rooms (and a 'both' training room) get every deck.
export const decksFor = (room) => {
  const w = room?.kind === 'training' ? room.training_week : null
  return w === 'A' || w === 'B' ? DECKS.filter((d) => d.week === w) : DECKS
}
export const deckOf = (k) => DECKS.find((d) => d.key === k) || null
const img = (d, n) => `${d.base}${String(n).padStart(2, '0')}.jpg`

// The slide area. host=true: the trainer can click/arrow inside it and every move is reported
// (onMove); everyone else just follows `pos`.
export function DeckView({ deck: dk, pos, host, onMove, camTrack, apiRef }) {
  const d = deckOf(dk)
  const frame = useRef(null)
  const reveal = () => { try { return frame.current?.contentWindow?.Reveal || null } catch { return null } }
  // The presenter's own screen never follows the room's copy of the position: that copy arrives a
  // moment late, and following it yanked the deck back a slide when clicking quickly (Neal,
  // 2026-10-04: "it was bouncing back and forth"). For image decks the presenter keeps their own n.
  const [myN, setMyN] = useState(null)
  useEffect(() => { setMyN(null) }, [dk])
  const n = host && myN != null ? myN : (pos?.n || d?.start || 1)
  // Follow the trainer (everyone else).
  useEffect(() => {
    if (!d || d.type !== 'reveal' || host) return
    const R = reveal()
    if (R && R.isReady?.() && pos) { const c = R.getIndices(); if (c.h !== pos.h || c.v !== (pos.v || 0) || (c.f ?? -1) !== (pos.f ?? -1)) R.slide(pos.h || 0, pos.v || 0, pos.f ?? undefined) }
  }, [d, pos?.h, pos?.v, pos?.f]) // eslint-disable-line react-hooks/exhaustive-deps
  const onLoad = () => {
    const R = reveal(); if (!R) return
    const go = () => {
      if (pos) R.slide(pos.h || 0, pos.v || 0, pos.f ?? undefined)
      if (host) {
        const send = () => { const c = R.getIndices(); onMove?.({ h: c.h, v: c.v || 0, f: c.f ?? -1 }) }
        R.on('slidechanged', send); R.on('fragmentshown', send); R.on('fragmenthidden', send)
      } else R.configure({ keyboard: false, controls: false, touch: false })
    }
    if (R.isReady?.()) go(); else R.on('ready', go)
  }
  // The trainer's ◀ ▶ buttons and arrow keys drive the deck through this.
  useEffect(() => {
    if (!apiRef) return
    apiRef.current = {
      next: () => { if (d?.type === 'reveal') reveal()?.next(); else { const x = Math.min(d.count, n + 1); setMyN(x); onMove?.({ n: x }) } },
      prev: () => { if (d?.type === 'reveal') reveal()?.prev(); else { const x = Math.max(1, n - 1); setMyN(x); onMove?.({ n: x }) } },
      first: () => { if (d?.type === 'reveal') reveal()?.slide(0, 0, -1); else { setMyN(1); onMove?.({ n: 1 }) } },
    }
  })
  if (!d) return null
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#000' }}>
      {d.type === 'reveal'
        ? <iframe ref={frame} title={d.label} src={d.url} onLoad={onLoad} style={{ width: '100%', height: '100%', border: 0, pointerEvents: host ? 'auto' : 'none' }} />
        : <img src={img(d, n)} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />}
      {/* Always-on slide controls for the presenter (Neal, 2026-10-04: "I need a way that I can go
          back"). Bottom-left, clear of the camera circle; only the presenter sees them. */}
      {host && apiRef && <DeckControls d={d} pos={{ ...(pos || {}), n }} api={apiRef} reveal={reveal} />}
      {camTrack && (
        <div style={{ position: 'absolute', right: '2.5%', bottom: '4%', width: 'min(20%, 230px)', aspectRatio: '1 / 1', borderRadius: '50%', overflow: 'hidden', border: '3px solid rgba(255,255,255,.85)', boxShadow: '0 6px 20px rgba(0,0,0,.5)', background: '#000', pointerEvents: 'none' }}>
          <VideoTrack trackRef={camTrack} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      )}
    </div>
  )
}

function DeckControls({ d, pos, api, reveal }) {
  const R = d.type === 'reveal' ? reveal() : null
  const total = R?.getTotalSlides?.() || d.count || 0
  const at = R ? (R.getSlidePastCount?.() ?? pos?.h ?? 0) + 1 : (pos?.n || d.start)
  const b = (bg) => ({ padding: '8px 14px', borderRadius: 10, border: 'none', background: bg, color: '#fff', fontWeight: 800, fontSize: 15, cursor: 'pointer' })
  return (
    <div style={{ position: 'absolute', left: 12, bottom: 12, zIndex: 20, display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(15,23,42,.82)', padding: 6, borderRadius: 14, boxShadow: '0 6px 20px rgba(0,0,0,.4)' }}>
      <button title="Back to the first slide" onClick={() => api.current?.first()} style={b('#334155')}>⏮</button>
      <button onClick={() => api.current?.prev()} style={b('#334155')}>◀ Back</button>
      {total ? <span style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 14, minWidth: 54, textAlign: 'center' }}>{at} / {total}</span> : null}
      <button onClick={() => api.current?.next()} style={b('#2563eb')}>Next ▶</button>
    </div>
  )
}
