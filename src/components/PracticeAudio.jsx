// 🎧 THE AUDIO REPORT (Neal, 2026-10-09: "no sales rep and no manager is going to read that very long report").
// A minute-long spoken summary, made right after grading (practice-audio-background). `fetchAudio()` returns
// { ok, status: 'making'|'ready'|'error', url }; while it's being made this keeps checking for a few minutes.
import { useEffect, useState } from 'react'

export default function PracticeAudio({ fetchAudio, title, sub, tone = 'emerald', fileName = 'practice-feedback' }) {
  const [a, setA] = useState({ status: 'making' })
  const [shareMsg, setShareMsg] = useState('')
  // SHARE (Neal, 2026-10-09: "send it to Dwayne"): the phone/computer's own share sheet with the audio FILE attached
  // (text, email, AirDrop…), so it never depends on a link that expires. No share sheet → it downloads instead.
  // The file is fetched as soon as the audio is ready: phones (Safari especially) only open the share sheet if it's
  // called right away from the tap, not after waiting on a download.
  const [blobP, setBlobP] = useState(null)
  useEffect(() => { if (a.status === 'ready' && a.url) setBlobP(fetch(a.url).then((r) => r.blob()).catch(() => null)) }, [a.status, a.url])
  const share = async () => {
    setShareMsg('')
    try {
      const blob = (await blobP) || (await (await fetch(a.url)).blob())
      const file = new File([blob], `${fileName}.wav`, { type: 'audio/wav' })
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title, text: title })
        return
      }
      const u = URL.createObjectURL(blob), el = document.createElement('a')
      el.href = u; el.download = file.name; document.body.appendChild(el); el.click(); el.remove()
      setTimeout(() => URL.revokeObjectURL(u), 30000)
      setShareMsg('Downloaded — attach it to a text or email.')
    } catch (e) {
      if (e?.name !== 'AbortError') setShareMsg('Could not share it from this device. Try your phone.')
    }
  }
  useEffect(() => {
    let stop = false, timer, tries = 0
    const tick = async () => {
      let d
      try { d = await fetchAudio() } catch { d = { ok: false } }
      if (stop) return
      if (d?.ok && d.status !== 'making') { setA(d); return }
      if (++tries < 40) timer = setTimeout(tick, 5000); else setA({ status: 'error' })
    }
    tick()
    return () => { stop = true; clearTimeout(timer) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const ring = tone === 'navy' ? 'border-slate-300 bg-slate-50' : 'border-emerald-200 bg-emerald-50'
  return (
    <section className={`mt-4 rounded-2xl border-2 p-4 ${ring}`}>
      <div className="font-bold text-slate-900">🎧 {title}</div>
      {sub && <div className="text-sm text-slate-600">{sub}</div>}
      {a.status === 'ready' && a.url && (
        <div className="mt-2 flex items-center gap-2">
          <audio controls preload="none" src={a.url} className="min-w-0 flex-1" />
          <button type="button" onClick={share} className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-800">📤 Share</button>
        </div>
      )}
      {shareMsg && <div className="mt-1 text-xs text-slate-600">{shareMsg}</div>}
      {a.status === 'making' && <div className="mt-2 text-sm text-slate-600">Recording it now… (about a minute)</div>}
      {a.status === 'error' && <div className="mt-2 text-sm text-slate-500">The audio isn’t available for this one. The written feedback below has everything.</div>}
    </section>
  )
}
