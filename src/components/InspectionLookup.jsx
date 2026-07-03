// Look up an inspection — search an address or homeowner name and see where the
// deal is in the process (signed → inspected → result → PA / released /
// cancelled), the timeline, PA notes, and live JobNimbus status. Data comes from
// the CCG `inspection-lookup` function (cross-origin, same as ManagerPayReport).
import { useState } from 'react'

const ENDPOINT = 'https://free-roof-inspections.netlify.app/.netlify/functions/inspection-lookup'

const stageClasses = (stage) => {
  const s = String(stage || '').toLowerCase()
  if (s.includes('cancel')) return 'bg-slate-500'
  if (s.includes('released') || s.includes('needs a pa') || s.includes('opened, not signed')) return 'bg-red-600'
  if (s.includes('awaiting inspection') || s.includes('waiting')) return 'bg-amber-600'
  if (s.includes('working the claim') || s.includes('no damage')) return 'bg-emerald-700'
  return 'bg-cyan-700'
}
const fmt = (s) => (s ? new Date(s).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric', year: '2-digit', hour: 'numeric', minute: '2-digit' }) : '—')

export default function InspectionLookup() {
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [res, setRes] = useState(null)
  const [err, setErr] = useState('')

  const run = async (e) => {
    if (e) e.preventDefault()
    const term = q.trim()
    if (term.length < 2) { setErr('Type an address or homeowner name (2+ characters).'); return }
    setLoading(true); setErr(''); setRes(null)
    try {
      const r = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q: term }) })
      const j = await r.json()
      if (!j.ok) setErr(j.error || 'Lookup failed.')
      else setRes(j.results || [])
    } catch { setErr('Network error — try again.') }
    setLoading(false)
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-bold text-brand-navy">🔎 Look up an inspection</h2>
      <p className="text-xs text-slate-500">Search an address or homeowner name to see exactly where it is in the process.</p>

      <form onSubmit={run} className="mt-3 flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="e.g. 217 Cobalt Dr  or  Shannon Stewart"
          className="min-w-[240px] flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800"
        />
        <button type="submit" disabled={loading} className="rounded-md bg-brand-navy px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
          {loading ? 'Searching…' : 'Look up'}
        </button>
      </form>

      {err && <div className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
      {res && res.length === 0 && <div className="mt-3 text-sm text-slate-500">No inspection found for “{q}”.</div>}

      {res && res.map((d) => (
        <div key={d.inspection_id} className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-base font-extrabold text-slate-900">{d.client_name}</div>
            <span className={`rounded-full px-3 py-0.5 text-xs font-bold text-white ${stageClasses(d.stage)}`}>{d.stage}</span>
          </div>
          <div className="mt-0.5 text-[13px] text-slate-500">{d.address} · Rep: {d.rep}{d.mobile ? ` · ${d.mobile}` : ''}</div>
          {d.stage_detail && <div className="mt-2 text-sm font-semibold text-slate-700">{d.stage_detail}</div>}
          {d.jn_status_stale && <div className="mt-1.5 text-[12.5px] font-bold text-amber-700">⚠ JobNimbus still says “{d.jn_status}” — stale (the deal was released).</div>}

          {d.timeline?.length > 0 && (
            <div className="mt-2.5 border-t border-slate-200 pt-2.5">
              {d.timeline.map((t, i) => (
                <div key={i} className={`mb-0.5 text-[12.5px] ${t.note ? 'italic text-slate-500' : 'text-slate-900'}`}>
                  <span className="text-slate-400">{fmt(t.at)}</span>  ·  {t.label}
                </div>
              ))}
            </div>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-slate-500">
            <span>JN status: <b className="text-slate-700">{d.jn_status || '—'}</b></span>
            {d.start_date && <span>Start: <b className="text-slate-700">{d.start_date}</b></span>}
            {d.sold_date && <span>Sold: <b className="text-slate-700">{d.sold_date}</b></span>}
            {d.jn_url && <a href={d.jn_url} target="_blank" rel="noreferrer" className="font-bold text-cyan-700 underline">Open in JobNimbus ↗</a>}
          </div>
        </div>
      ))}
    </div>
  )
}
