// /bg-test — MEETING BACKGROUND, OLD vs NEW side by side (Neal, 2026-10-06: "I can be on a Zoom and it
// looks much better"). Your own camera, run through today's background (left) and the new HD one (right),
// same background on both. Compare against Zoom, then "Use HD in my meetings" switches this device over
// (localStorage meet_bg_engine). Nothing is sent anywhere — it's all on this computer.
import { useEffect, useRef, useState } from 'react'
import { SmartBackground } from '../lib/smartBackground.js'
import { SmartBackgroundHD, smartBackgroundHDSupported } from '../lib/smartBackgroundHD.js'
import { BACKGROUNDS } from '../components/BackgroundPicker.jsx'

const optsFor = (k) => k === 'blur' ? { mode: 'blur' } : { mode: 'image', imagePath: BACKGROUNDS.find((b) => b.key === k)?.img }

function Pane({ title, make, track, bgKey }) {
  const vref = useRef(null)
  const proc = useRef(null)
  const [fps, setFps] = useState(0)
  const [st, setSt] = useState('')
  useEffect(() => {
    const id = setInterval(() => { const x = proc.current?.stats; if (x?.frames) { setSt(`outline matched to its frame: ${Math.round((100 * x.matched) / x.frames)}% · ${Math.round(x.ms / Math.max(1, x.matched))} ms each`); x.frames = 0; x.matched = 0; x.ms = 0 } }, 2000)
    return () => clearInterval(id)
  }, [])
  useEffect(() => {
    if (!track) return
    let dead = false
    ;(async () => {
      const p = make(optsFor(bgKey))
      const own = track.clone() // each pane gets its own copy of the camera
      await p.init({ track: own })
      p._own = own
      if (dead) { p.destroy(); return }
      proc.current = p
      vref.current.srcObject = new MediaStream([p.processedTrack])
      vref.current.play().catch(() => {})
    })().catch((e) => console.warn(title, e))
    return () => { dead = true; const p = proc.current; p?.destroy(); try { p?._own?.stop() } catch { /* fine */ } proc.current = null }
  }, [track]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { proc.current?.setOptions(optsFor(bgKey)) }, [bgKey])
  useEffect(() => {
    const v = vref.current; if (!v?.requestVideoFrameCallback) return
    let n = 0, t0 = performance.now(), id
    const tick = () => { n++; const t = performance.now(); if (t - t0 >= 1000) { setFps(Math.round((n * 1000) / (t - t0))); n = 0; t0 = t } id = v.requestVideoFrameCallback(tick) }
    id = v.requestVideoFrameCallback(tick)
    return () => v.cancelVideoFrameCallback?.(id)
  }, [])
  return (
    <div className="flex-1 min-w-[280px]">
      <div className="mb-1 flex items-center justify-between text-sm font-bold text-white"><span>{title}</span><span className="text-xs font-semibold text-slate-400">{fps} fps</span></div>
      <video ref={vref} muted playsInline className="w-full rounded-xl bg-black" style={{ aspectRatio: '16 / 9', objectFit: 'contain' }} />
      {st && <div className="mt-1 text-xs font-semibold text-emerald-300">{st}</div>}
    </div>
  )
}

export default function BgTest() {
  const [track, setTrack] = useState(null)
  const [err, setErr] = useState('')
  const [bgKey, setBgKey] = useState('blur')
  const [model, setModel] = useState('landscape')
  const [hd, setHd] = useState(() => { try { return localStorage.getItem('meet_bg_engine') !== 'old' } catch { return true } })
  useEffect(() => { document.title = 'Background test — HD vs today' }, [])
  useEffect(() => {
    let tr
    // ?fake=1 — a moving test picture instead of the camera (for checking the pipeline without a webcam).
    if (new URLSearchParams(window.location.search).get('fake') === '1') {
      // ?img=<url> — a real photo (e.g. Google's MediaPipe test portrait) drifting slowly, instead of the cartoon.
      const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const g = c.getContext('2d'); let t = 0
      const src = new URLSearchParams(window.location.search).get('img'); let pic = null
      if (src) { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => { pic = im }; im.src = src }
      const id = setInterval(() => {
        t++
        if (pic) { g.fillStyle = '#000'; g.fillRect(0, 0, 1280, 720); const s = Math.max(1280 / pic.width, 720 / pic.height) * 1.05, w = pic.width * s, h = pic.height * s; g.drawImage(pic, (1280 - w) / 2 + Math.sin(t / 30) * 25, (720 - h) / 2, w, h); return }
        g.fillStyle = '#6b7280'; g.fillRect(0, 0, 1280, 720); g.fillStyle = '#e0b090'; g.beginPath(); g.ellipse(640 + Math.sin(t / 20) * 150, 300, 110, 140, 0, 0, 7); g.fill(); g.fillStyle = '#1e3a8a'; g.fillRect(470 + Math.sin(t / 20) * 150, 430, 340, 290)
      }, 33)
      tr = c.captureStream(30).getVideoTracks()[0]; setTrack(tr)
      return () => { clearInterval(id); try { tr.stop() } catch { /* fine */ } }
    }
    navigator.mediaDevices?.getUserMedia({ video: { width: 1280, height: 720 } })
      .then((s) => { tr = s.getVideoTracks()[0]; setTrack(tr) })
      .catch((e) => setErr(e.message || 'Camera blocked'))
    return () => { try { tr?.stop() } catch { /* fine */ } }
  }, [])
  const setEngine = (on) => { try { localStorage.setItem('meet_bg_engine', on ? 'hd' : 'old') } catch { /* private mode */ } setHd(on) }
  const choices = BACKGROUNDS.filter((b) => b.key !== 'none')
  return (
    <div className="min-h-screen bg-slate-900 p-4 text-slate-100">
      <h1 className="text-xl font-extrabold">Meeting background: today vs the new HD one</h1>
      <p className="mt-1 text-sm text-slate-300">Same camera, same background, side by side. Move around, turn your head, run a hand through your hair — then compare with Zoom.</p>
      {!smartBackgroundHDSupported() && <p className="mt-2 font-bold text-amber-300">This browser can't run the HD version (needs Chrome or Edge).</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {choices.map((b) => <button key={b.key} onClick={() => setBgKey(b.key)} className={`rounded-lg px-3 py-1.5 text-sm font-bold ${bgKey === b.key ? 'bg-blue-600' : 'bg-slate-700'}`}>{b.label}</button>)}
        <span className="mx-2 self-center text-xs text-slate-400">HD model:</span>
        {['landscape', 'multiclass'].map((m) => <button key={m} onClick={() => setModel(m)} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${model === m ? 'bg-emerald-600' : 'bg-slate-700'}`}>{m === 'landscape' ? 'Wide (video-call)' : 'Detailed (hair/clothes)'}</button>)}
      </div>
      {err && <p className="mt-3 font-bold text-red-300">Camera: {err}</p>}
      <div className="mt-4 flex flex-wrap gap-4">
        <Pane key={`old-${bgKey === 'x'}`} title="Today's background" make={(o) => new SmartBackground(o)} track={track} bgKey={bgKey} />
        <Pane key={`hd-${model}`} title={`🆕 HD background (${model === 'landscape' ? 'wide model' : 'detailed model'})`} make={(o) => new SmartBackgroundHD(o, model)} track={track} bgKey={bgKey} />
      </div>
      <div className="mt-5 rounded-xl border border-slate-700 bg-slate-800 p-4">
        <div className="font-bold">Use the HD background in my meetings (this computer)</div>
        <div className="mt-1 text-sm text-slate-300">Right now: <b>{hd ? '🆕 HD' : "today's"}</b>. HD is on for everyone now; this only changes this device.</div>
        <button onClick={() => setEngine(!hd)} className={`mt-2 rounded-lg px-4 py-2 font-extrabold ${hd ? 'bg-slate-600' : 'bg-emerald-600'}`}>{hd ? "Go back to today's" : '🆕 Use HD in my meetings'}</button>
      </div>
    </div>
  )
}
