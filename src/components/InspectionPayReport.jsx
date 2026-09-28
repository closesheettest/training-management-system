// Inspection pay — what we owe reps for free inspections (and PA submits) for one
// Monday–Sunday week. Read from CCG's commission-report, which applies the rates
// set on CCG's Commissions screen (Neal, 2026-09-28: one place for every pay report).
import { useState } from 'react'

const CCG = 'https://free-roof-inspections.netlify.app/.netlify/functions/commission-report'

// The ET Monday (YYYY-MM-DD) of the week `offset` weeks back from this one.
function mondayYmd(offset) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const d = new Date(`${today}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - 7 * offset)
  return d.toISOString().slice(0, 10)
}
const addDays = (ymd, n) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
// Midnight ET on a date, as a real instant (handles EDT/EST).
function etMidnight(ymd) {
  const est = new Date(`${ymd}T05:00:00Z`) // midnight if EST
  const h = Number(est.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }))
  return new Date(est.getTime() - (h === 1 ? 3600_000 : 0)) // EDT: 04:00Z
}
const fmtDay = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const money = (n) => `$${Number(n || 0).toLocaleString()}`

export default function InspectionPayReport() {
  const [offset, setOffset] = useState(1) // last completed week
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // Click the title to load + open, click again to shrink (Neal, 2026-09-28).
  const [shown, setShown] = useState(true)
  const toggle = () => { if (!data) { setShown(true); if (!busy) load() } else setShown((v) => !v) }

  async function load(off = offset) {
    setBusy(true); setErr('')
    const mon = mondayYmd(off)
    const start = etMidnight(mon), end = new Date(etMidnight(addDays(mon, 7)).getTime() - 1)
    try {
      const r = await fetch(`${CCG}?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`)
      const d = await r.json()
      if (!d.ok) throw new Error(d.error || 'Could not load')
      setData({ ...d, label: `${fmtDay(mon)} – ${fmtDay(addDays(mon, 6))}` })
    } catch (x) { setErr(x.message || 'Could not load') }
    setBusy(false)
  }
  const go = (n) => { setOffset(n); load(n) }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div onClick={toggle} className="cursor-pointer select-none text-lg font-bold text-brand-navy hover:opacity-80"><span className="mr-1 inline-block text-slate-400">{data && shown ? '▾' : '▸'}</span>🔍 Inspection pay <span className="text-sm font-normal text-slate-500">(free inspections + PA submits, by week)</span></div>
          <div className="text-xs text-slate-500">Rates come from the Commissions screen in DoorDispatcher. The at-close % of a PA contract is not included yet.</div>
        </div>
        <div className="flex items-center gap-2">
          {data && shown && <>
            <button type="button" onClick={() => go(offset + 1)} className="rounded-md border border-slate-300 px-2 py-1 text-sm">◀</button>
            <span className="text-sm font-semibold text-slate-700">{data.label}</span>
            <button type="button" onClick={() => go(Math.max(0, offset - 1))} disabled={offset === 0} className="rounded-md border border-slate-300 px-2 py-1 text-sm disabled:opacity-40">▶</button>
          </>}
          {data && shown && <button type="button" onClick={() => load()} disabled={busy} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60">↻ Refresh</button>}
          <button type="button" onClick={toggle} disabled={busy} className="rounded-md bg-brand-navy px-3 py-1.5 text-sm font-bold text-white disabled:opacity-60">{busy ? 'Loading…' : !data ? 'Load report' : shown ? '▴ Shrink' : '▾ Show'}</button>
        </div>
      </div>
      {err && <div className="mt-2 text-sm font-semibold text-red-700">{err}</div>}
      {data && shown && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="py-1.5 pr-2">Rep</th><th className="px-2 text-right">Inspections</th><th className="px-2 text-right">$/each</th>
              <th className="px-2 text-right">Inspection pay</th><th className="px-2 text-right">PA submits</th><th className="px-2 text-right">Submit pay</th><th className="px-2 text-right">Total owed</th>
            </tr></thead>
            <tbody>
              {data.rows.length === 0 && <tr><td colSpan={7} className="py-4 text-center text-slate-400">No rep activity that week.</td></tr>}
              {data.rows.map((r) => (
                <tr key={r.rep} className="border-b border-slate-100">
                  <td className="py-1.5 pr-2 font-semibold text-slate-800">{r.rep}</td>
                  <td className="px-2 text-right">{r.inspections}</td>
                  <td className="px-2 text-right text-slate-500">{r.tier_kind === 'flat' ? 'flat' : r.rate_each != null ? money(r.rate_each) : '—'}</td>
                  <td className="px-2 text-right">{money(r.insp_pay)}</td>
                  <td className="px-2 text-right">{r.pa_submits}</td>
                  <td className="px-2 text-right">{money(r.submit_pay)}</td>
                  <td className="px-2 text-right font-bold text-emerald-700">{money(r.total)}</td>
                </tr>
              ))}
              {data.rows.length > 0 && (
                <tr className="font-bold">
                  <td className="py-1.5 pr-2">Total</td><td className="px-2 text-right">{data.totals.inspections}</td><td />
                  <td className="px-2 text-right">{money(data.totals.insp_pay)}</td><td className="px-2 text-right">{data.totals.pa_submits}</td>
                  <td className="px-2 text-right">{money(data.totals.submit_pay)}</td><td className="px-2 text-right text-emerald-700">{money(data.totals.total)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
