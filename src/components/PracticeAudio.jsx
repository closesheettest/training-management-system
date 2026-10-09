// 🎧 THE AUDIO REPORT (Neal, 2026-10-09: "no sales rep and no manager is going to read that very long report").
// A minute-long spoken summary, made right after grading (practice-audio-background). `fetchAudio()` returns
// { ok, status: 'making'|'ready'|'error', url }; while it's being made this keeps checking for a few minutes.
import { useEffect, useState } from 'react'

export default function PracticeAudio({ fetchAudio, title, sub, tone = 'emerald' }) {
  const [a, setA] = useState({ status: 'making' })
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
      {a.status === 'ready' && a.url && <audio controls preload="none" src={a.url} className="mt-2 w-full" />}
      {a.status === 'making' && <div className="mt-2 text-sm text-slate-600">Recording it now… (about a minute)</div>}
      {a.status === 'error' && <div className="mt-2 text-sm text-slate-500">The audio isn’t available for this one. The written feedback below has everything.</div>}
    </section>
  )
}
