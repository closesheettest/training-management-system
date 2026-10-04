// 🖼 BACKGROUND (Neal, 2026-10-04: "I can have any background I want. Like right now, a white screen
// with the U.S. Shingle & Metal logo"). Replaces what's behind you on YOUR camera, so everyone in the
// meeting (and the recording) sees it. Runs in your browser (LiveKit track-processors: it finds the
// person in each frame and swaps the rest), nothing is uploaded. The choice is remembered on this
// device and put back on whenever the camera comes on.
import { useEffect, useRef, useState } from 'react'
import { Track } from 'livekit-client'
import { BackgroundProcessor, supportsBackgroundProcessors } from '@livekit/track-processors'

export const BACKGROUNDS = [
  { key: 'none', label: 'None' },
  { key: 'blur', label: 'Blur' },
  { key: 'uss-white', label: 'White · logo right', img: '/backgrounds/uss-white.jpg' },
  { key: 'uss-white-center', label: 'White · logo top', img: '/backgrounds/uss-white-center.jpg' },
  { key: 'uss-navy', label: 'Navy · logo', img: '/backgrounds/uss-navy.jpg' },
]
const KEY = 'meet_bg', CUSTOM = 'meet_bg_custom'
const read = (k) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch { /* private mode: still works this session */ } }

// Any photo the person picks, shrunk to 1280×720 so it stays light (and fits browser storage).
const shrink = (file) => new Promise((resolve, reject) => {
  const img = new Image()
  img.onload = () => {
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720
    const g = c.getContext('2d'), s = Math.max(1280 / img.width, 720 / img.height)
    const w = img.width * s, h = img.height * s
    g.drawImage(img, (1280 - w) / 2, (720 - h) / 2, w, h)
    resolve(c.toDataURL('image/jpeg', 0.85))
  }
  img.onerror = reject
  img.src = URL.createObjectURL(file)
})

const modeFor = (key, custom) => {
  if (key === 'blur') return { mode: 'background-blur', blurRadius: 12 }
  if (key === 'custom' && custom) return { mode: 'virtual-background', imagePath: custom }
  const b = BACKGROUNDS.find((x) => x.key === key && x.img)
  return b ? { mode: 'virtual-background', imagePath: b.img } : { mode: 'disabled' }
}

// Keeps the chosen background on the local camera. Mount once inside the LiveKit room.
export function useBackground(localParticipant) {
  const [choice, setChoice] = useState(() => read(KEY) || 'none')
  const [custom, setCustom] = useState(() => read(CUSTOM))
  const proc = useRef(null)
  const camTrack = localParticipant?.getTrackPublication(Track.Source.Camera)?.track || null
  useEffect(() => {
    if (!camTrack || !supportsBackgroundProcessors()) return
    const opts = modeFor(choice, custom)
    ;(async () => {
      try {
        if (opts.mode === 'disabled') { if (camTrack.getProcessor()) await camTrack.stopProcessor(); proc.current = null; return }
        if (proc.current && camTrack.getProcessor() === proc.current) { await proc.current.switchTo(opts); return }
        proc.current = BackgroundProcessor(opts)
        await camTrack.setProcessor(proc.current)
      } catch (e) { console.warn('background', e) }
    })()
  }, [camTrack, choice, custom])
  // With a picture behind you, your own view stops mirroring so the logo reads the right way round
  // (Neal, 2026-10-04: "the logo came out backwards"). Everyone else always sees it unmirrored.
  useEffect(() => {
    const on = choice !== 'none' && choice !== 'blur'
    document.documentElement.classList.toggle('bg-unmirror', on)
    return () => document.documentElement.classList.remove('bg-unmirror')
  }, [choice])
  const pick = (k) => { setChoice(k); write(KEY, k) }
  const upload = async (file) => { const url = await shrink(file); setCustom(url); write(CUSTOM, url); pick('custom') }
  return { choice, custom, pick, upload, supported: supportsBackgroundProcessors(), camOn: !!camTrack && !camTrack.isMuted }
}

export function BackgroundPanel({ bg, onClose }) {
  const file = useRef(null)
  const tile = (on) => ({ borderRadius: 10, border: on ? '3px solid #2563eb' : '2px solid #374151', overflow: 'hidden', cursor: 'pointer', background: '#0b1220', padding: 0, textAlign: 'left' })
  const all = [...BACKGROUNDS, ...(bg.custom ? [{ key: 'custom', label: 'My picture', img: bg.custom }] : [])]
  return (
    <div style={{ position: 'absolute', top: 8, right: 12, zIndex: 60, width: 330, maxHeight: '80vh', overflow: 'auto', background: '#111827', border: '1px solid #2563eb', borderRadius: 12, padding: 12, color: '#e5e7eb', fontSize: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}><b style={{ flex: 1 }}>🖼 My background</b><button onClick={onClose} style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: 18, cursor: 'pointer' }}>×</button></div>
      {!bg.supported ? <div style={{ color: '#fca5a5' }}>This browser can't do backgrounds. Try Chrome on a computer.</div> : (<>
        <div style={{ fontSize: 12.5, color: '#94a3b8', marginBottom: 8 }}>Everyone sees it behind you, and so does the recording.{!bg.camOn && ' Turn your camera on to see it.'}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {all.map((b) => (
            <button key={b.key} onClick={() => bg.pick(b.key)} style={tile(bg.choice === b.key)}>
              <div style={{ aspectRatio: '16 / 9', background: b.img ? `center / cover url(${b.img})` : b.key === 'blur' ? 'linear-gradient(135deg,#64748b,#cbd5e1,#64748b)' : '#1f2937', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, filter: b.key === 'blur' ? 'blur(.5px)' : 'none' }}>{!b.img && (b.key === 'blur' ? '≈' : '⦸')}</div>
              <div style={{ padding: '4px 7px', fontSize: 12, fontWeight: 700, color: '#e5e7eb' }}>{b.label}</div>
            </button>
          ))}
        </div>
        <button onClick={() => file.current?.click()} style={{ marginTop: 10, width: '100%', padding: '9px', borderRadius: 8, border: '1px dashed #64748b', background: 'transparent', color: '#e5e7eb', fontWeight: 800, cursor: 'pointer' }}>＋ Use my own picture…</button>
        <input ref={file} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) bg.upload(f); e.target.value = '' }} />
        <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 8 }}>Tip: the edges around you look cleanest with even light on your face and a plain wall behind you.</div>
      </>)}
    </div>
  )
}
