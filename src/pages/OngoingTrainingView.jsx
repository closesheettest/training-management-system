import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'

// Manager-facing Ongoing Training viewer. Opened from the daily link
// (/ongoing-training/view/:token?day=N). Loads the live curriculum from the
// database and logs how long the manager keeps it open (heartbeat pings),
// so admins can see who's actually running it.

const API = '/.netlify/functions/ongoing-training-view-api'

export default function OngoingTrainingView() {
  const { token } = useParams()
  const [params] = useSearchParams()
  const wantDay = parseInt(params.get('day'), 10)
  const previewId = params.get('id')
  const isPreview = token === 'preview'

  const [days, setDays] = useState(null)
  const [i, setI] = useState(0)
  const [manager, setManager] = useState('')
  const [err, setErr] = useState(null)

  const viewIdRef = useRef(null)
  const secondsRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // Admin preview (View button on the Ongoing Training page): load the
        // day(s) directly, no manager token, and DON'T log a view.
        if (isPreview) {
          let list = []
          if (previewId) {
            const { data, error } = await supabase.from('training_days').select('*').eq('id', previewId).maybeSingle()
            if (error) throw new Error(error.message)
            if (!data) throw new Error('That training day was not found.')
            list = [data]
          } else {
            const { data, error } = await supabase.from('training_days').select('*').eq('status', 'active').order('position', { ascending: true })
            if (error) throw new Error(error.message)
            list = data || []
          }
          if (cancelled) return
          setManager('')
          setDays(list)
          const pIdx = Number.isFinite(wantDay) ? list.findIndex((d) => d.position === wantDay) : 0
          setI(pIdx > 0 ? pIdx : 0)
          return
        }

        const res = await fetch(API, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'open', token, day: wantDay }),
        })
        const j = await res.json().catch(() => ({}))
        if (!res.ok || !j.ok) throw new Error(j.error || 'Could not open your training.')
        if (cancelled) return
        setManager(j.manager_name || '')
        viewIdRef.current = j.view_id
        const list = j.days || []
        setDays(list)
        const startIdx = Number.isFinite(wantDay) ? Math.max(0, list.findIndex((d) => d.position === wantDay)) : 0
        setI(startIdx < 0 ? 0 : startIdx)
      } catch (e) {
        if (!cancelled) setErr(e.message)
      }
    })()
    return () => { cancelled = true }
  }, [token, wantDay, previewId, isPreview])

  // Heartbeat: count visible time, ping the server, and send a final beacon
  // on unload so partial sessions still get recorded.
  useEffect(() => {
    const ping = (secs) => {
      if (!viewIdRef.current) return
      fetch(API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ping', view_id: viewIdRef.current, seconds: secs }),
        keepalive: true,
      }).catch(() => {})
    }
    const iv = setInterval(() => {
      if (document.visibilityState === 'visible') {
        secondsRef.current += 20
        ping(secondsRef.current)
      }
    }, 20000)
    const flush = () => {
      if (!viewIdRef.current) return
      try {
        const blob = new Blob([JSON.stringify({ action: 'ping', view_id: viewIdRef.current, seconds: secondsRef.current })], { type: 'application/json' })
        navigator.sendBeacon(API, blob)
      } catch { ping(secondsRef.current) }
    }
    const onVis = () => { if (document.hidden) flush() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', flush)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('pagehide', flush) }
  }, [])

  if (err) {
    return (
      <Shell>
        <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-center text-red-800">{err}</div>
      </Shell>
    )
  }
  if (!days) return <Shell><p className="text-center text-sm text-slate-500">Loading…</p></Shell>
  if (!days.length) return <Shell><p className="text-center text-sm text-slate-500">No training days are active yet.</p></Shell>

  const d = days[i]
  const total = days.length

  return (
    <Shell>
      <div className="mb-4 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
        {isPreview
          ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">Preview · not logged</span>
          : <span>{manager ? `Hi ${manager}` : 'Ongoing Training'}</span>}
        <span>Day {i + 1} / {total}</span>
      </div>

      {/* Day strip */}
      <div className="mb-5 flex flex-wrap gap-1.5">
        {days.map((x, idx) => (
          <button key={x.id} type="button" onClick={() => setI(idx)}
            className={'h-8 w-8 rounded-md border text-xs font-bold ' + (idx === i
              ? 'border-brand-navy bg-brand-navy text-white'
              : 'border-slate-300 bg-white text-slate-600 hover:border-brand-navy')}>
            {idx + 1}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          {d.subject && <span className="rounded border border-slate-300 px-2 py-0.5 font-mono text-slate-500">{d.subject}</span>}
          {d.theme && <span>{d.theme}</span>}
        </div>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-brand-navy sm:text-3xl">{d.title}</h1>
        {d.on_slide && <p className="mt-1 text-sm italic text-slate-400">{d.on_slide}</p>}

        {d.point && (
          <Block label="The point"><p className="text-slate-800">{d.point}</p></Block>
        )}

        {Array.isArray(d.script) && d.script.length > 0 && (
          <div className="mt-6 rounded-r-xl border-l-4 border-brand-navy bg-slate-50 p-4">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">The script</p>
            {d.script.map((seg, k) => (
              seg.k === 'dir'
                ? <p key={k} className="mb-2 border-l-2 border-slate-300 pl-3 text-sm italic text-slate-500">{seg.t}</p>
                : <p key={k} className="mb-2 text-[15px] leading-relaxed text-slate-800">{seg.t}</p>
            ))}
          </div>
        )}

        {d.compare && (
          <div className="mt-6">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-red-600">The two options — what each includes</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <CompareCard cap={d.compare.leftCap} items={d.compare.left} />
              <CompareCard cap={d.compare.rightCap} plus={d.compare.rightPlus} items={d.compare.right} />
            </div>
          </div>
        )}

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {d.coach && <Mini label="Coach your team" color="text-red-600">{d.coach}</Mini>}
          {d.drill && <Mini label="Run the drill" color="text-emerald-700">{d.drill}</Mini>}
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between">
        <button type="button" disabled={i === 0} onClick={() => setI(i - 1)}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:border-brand-navy disabled:opacity-40">
          ← Prev
        </button>
        <button type="button" disabled={i === total - 1} onClick={() => setI(i + 1)}
          className="rounded-lg bg-brand-navy px-5 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-40">
          Next →
        </button>
      </div>
    </Shell>
  )
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="h-1 w-full bg-brand-navy" />
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <div className="mb-6 text-xs font-semibold uppercase tracking-[0.14em] text-red-600">
          U.S. Shingle &amp; Metal · Ongoing Training
        </div>
        {children}
      </div>
    </div>
  )
}

function Block({ label, children }) {
  return (
    <div className="mt-6">
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-red-600">{label}</p>
      {children}
    </div>
  )
}

function Mini({ label, color, children }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className={'mb-1 text-[11px] font-bold uppercase tracking-wide ' + color}>{label}</p>
      <p className="text-sm text-slate-600">{children}</p>
    </div>
  )
}

function CompareCard({ cap, plus, items }) {
  return (
    <div className="rounded-2xl bg-[#3730a3] p-5 text-white">
      {cap && <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.08em] text-indigo-200">{cap}</div>}
      <div className="mb-3 font-bold" style={{ fontSize: 18 }}>Service Includes</div>
      {plus && <div className="mb-2.5 font-bold text-[14px]">{plus}</div>}
      <ul className="space-y-2">
        {(items || []).map((x, k) => (
          <li key={k} className="relative pl-5 text-[14px] text-indigo-50">
            <span className="absolute left-0 top-2 h-1.5 w-1.5 rounded-full bg-indigo-300" />{x}
          </li>
        ))}
      </ul>
    </div>
  )
}
