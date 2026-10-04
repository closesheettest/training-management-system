// 📊 PRESENT IN THE MEETING (Neal, 2026-10-04: "I don't think we need Keynote anymore… click
// Share Day 1 and it goes right in"). The trainer picks a deck; everyone's screen shows it (sharp —
// drawn on each device, not a video of a screen), the trainer moves it and everyone follows, with
// the trainer's camera as a circle in the corner. The recording films the same view.
//
// Two kinds of deck, both already in TMS:
//   reveal — the Week A day decks (/day-N-slides/, Reveal.js): synced by slide + step
//   images — the Week B virtual deck (s-01.jpg …): synced by slide number
import { useEffect, useRef } from 'react'
import { VideoTrack } from '@livekit/components-react'

// Only Week A Day 1 for now — the other days are being rebuilt (Neal, 2026-10-04). Add each day
// here when it's ready (the Week B image deck works the same way: type 'images', base, count, start).
export const DECKS = [
  { key: 'a1', label: 'Week A · Day 1', type: 'reveal', url: '/day-1-slides/' },
]
export const deckOf = (k) => DECKS.find((d) => d.key === k) || null
const img = (d, n) => `${d.base}${String(n).padStart(2, '0')}.jpg`

// The slide area. host=true: the trainer can click/arrow inside it and every move is reported
// (onMove); everyone else just follows `pos`.
export function DeckView({ deck: dk, pos, host, onMove, camTrack, apiRef }) {
  const d = deckOf(dk)
  const frame = useRef(null)
  const reveal = () => { try { return frame.current?.contentWindow?.Reveal || null } catch { return null } }
  // Follow the trainer.
  useEffect(() => {
    if (!d || d.type !== 'reveal') return
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
      next: () => { if (d?.type === 'reveal') reveal()?.next(); else onMove?.({ n: Math.min(d.count, (pos?.n || d.start) + 1) }) },
      prev: () => { if (d?.type === 'reveal') reveal()?.prev(); else onMove?.({ n: Math.max(1, (pos?.n || d.start) - 1) }) },
    }
  })
  if (!d) return null
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#000' }}>
      {d.type === 'reveal'
        ? <iframe ref={frame} title={d.label} src={d.url} onLoad={onLoad} style={{ width: '100%', height: '100%', border: 0, pointerEvents: host ? 'auto' : 'none' }} />
        : <img src={img(d, pos?.n || d.start)} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />}
      {camTrack && (
        <div style={{ position: 'absolute', right: '2.5%', bottom: '4%', width: 'min(20%, 230px)', aspectRatio: '1 / 1', borderRadius: '50%', overflow: 'hidden', border: '3px solid rgba(255,255,255,.85)', boxShadow: '0 6px 20px rgba(0,0,0,.5)', background: '#000', pointerEvents: 'none' }}>
          <VideoTrack trackRef={camTrack} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      )}
    </div>
  )
}
