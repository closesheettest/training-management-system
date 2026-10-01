// BTR sale commission — every back-to-retail deal sold in a Monday–Sunday week:
// squares, roof price, $/square, product, tier and the commission. Figured by CCG's
// btr-commission from the rep dashboard's Commission Sheet (Self Generated column,
// highest tier price met, on Roof Price ONLY). Neal, 2026-09-28.
import { Fragment, useState } from 'react'

const CCG = 'https://free-roof-inspections.netlify.app/.netlify/functions/btr-commission'

function mondayYmd(offset) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const d = new Date(`${today}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - 7 * offset)
  return d.toISOString().slice(0, 10)
}
const addDays = (ymd, n) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
function etMidnight(ymd) {
  const est = new Date(`${ymd}T05:00:00Z`)
  const h = Number(est.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }))
  return new Date(est.getTime() - (h === 1 ? 3600_000 : 0))
}
const fmtDay = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const money = (n) => `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`

export default function BtrCommissionReport() {
  const [offset, setOffset] = useState(1) // last completed week
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [shown, setShown] = useState(true)

  async function load(off = offset) {
    setBusy(true); setErr('')
    const mon = mondayYmd(off)
    const start = etMidnight(mon), end = new Date(etMidnight(addDays(mon, 7)).getTime() - 1)
    try {
      const r = await fetch(`${CCG}?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`)
      const d = await r.json()
      if (!d.ok) throw new Error(d.error || 'Could not load')
      // Named by the week it's PAID (Neal, 2026-10-01): sold last week is paid this week.
      setData({ ...d, label: `Paid week of ${fmtDay(addDays(mon, 7))} – ${fmtDay(addDays(mon, 13))}`, sub: `sold ${fmtDay(mon)} – ${fmtDay(addDays(mon, 6))}` })
    } catch (x) { setErr(x.message || 'Could not load') }
    setBusy(false)
  }
  const go = (n) => { setOffset(n); load(n) }
  // Click the title / button to load + open, click again to shrink.
  const toggle = () => { if (!data) { setShown(true); if (!busy) load() } else setShown((v) => !v) }

  const byRep = data ? data.reps.map((r) => ({ ...r, list: data.deals.filter((d) => d.rep === r.rep) })) : []

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div onClick={toggle} className="cursor-pointer select-none text-lg font-bold text-brand-navy hover:opacity-80"><span className="mr-1 inline-block text-slate-400">{data && shown ? '▾' : '▸'}</span>🏠 BTR sale commission <span className="text-sm font-normal text-slate-500">(back-to-retail deals sold, by week)</span></div>
          <div className="text-xs text-slate-500">From the Commission Sheet: Self Generated column, the highest tier price the deal met ($/sq = Roof Price ONLY ÷ squares), paid on Roof Price ONLY. Palm Beach / Broward / Miami-Dade are +$100/sq.</div>
        </div>
        <div className="flex items-center gap-2">
          {data && shown && <>
            <button type="button" onClick={() => go(offset + 1)} className="rounded-md border border-slate-300 px-2 py-1 text-sm">◀</button>
            <span className="text-center leading-tight"><span className="block text-sm font-semibold text-slate-700">{data.label}</span>{data.sub && <span className="block text-[11px] text-slate-500">{data.sub}</span>}</span>
            <button type="button" onClick={() => go(Math.max(0, offset - 1))} disabled={offset === 0} className="rounded-md border border-slate-300 px-2 py-1 text-sm disabled:opacity-40">▶</button>
            <button type="button" onClick={() => load()} disabled={busy} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60">↻ Refresh</button>
          </>}
          <button type="button" onClick={toggle} disabled={busy} className="rounded-md bg-brand-navy px-3 py-1.5 text-sm font-bold text-white disabled:opacity-60">{busy ? 'Loading…' : !data ? 'Load report' : shown ? '▴ Shrink' : '▾ Show'}</button>
        </div>
      </div>
      {err && <div className="mt-2 text-sm font-semibold text-red-700">{err}</div>}
      {data && shown && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="py-1.5 pr-2">Rep / customer</th><th className="px-2">Sold</th><th className="px-2">Product</th>
              <th className="px-2 text-right">Squares</th><th className="px-2 text-right">Roof price</th><th className="px-2 text-right">$/sq</th>
              <th className="px-2 text-right">Tier</th><th className="px-2 text-right">Comm %</th><th className="px-2 text-right">Commission</th>
            </tr></thead>
            <tbody>
              {byRep.length === 0 && <tr><td colSpan={9} className="py-4 text-center text-slate-400">No BTR sales that week.</td></tr>}
              {byRep.map((r) => (
                <Fragment key={r.rep}>
                  <tr className="border-b border-slate-200 bg-slate-50 font-bold">
                    <td className="py-1.5 pr-2 text-slate-800">{r.rep}</td><td className="px-2 text-xs font-normal text-slate-500">{r.deals} deal{r.deals !== 1 ? 's' : ''}{r.flagged ? ` · ${r.flagged} to fix` : ''}</td><td />
                    <td className="px-2 text-right">{r.squares}</td><td className="px-2 text-right">{money(r.roof_total)}</td><td /><td /><td />
                    <td className="px-2 text-right text-emerald-700">{money(r.commission)}</td>
                  </tr>
                  {r.list.map((d) => (
                    <Fragment key={d.jnid}>
                      <tr className="border-b border-slate-100">
                        <td className="py-1 pl-4 pr-2 text-slate-700">{d.customer}<div className="text-[11px] text-slate-400">{d.address}{d.county ? ` · ${d.county}` : ''}</div></td>
                        <td className="px-2 text-slate-600">{d.sold}</td>
                        <td className="px-2 text-slate-600">{d.product}</td>
                        <td className="px-2 text-right">{d.squares || '—'}</td>
                        <td className="px-2 text-right">{d.roof_price ? money(d.roof_price) : '—'}</td>
                        <td className="px-2 text-right">{d.per_sq ? money(d.per_sq) : '—'}</td>
                        <td className="px-2 text-right">{d.tier ? `T${d.tier}` : '—'}</td>
                        <td className="px-2 text-right">{d.tier ? `${d.pct}%` : '—'}</td>
                        <td className="px-2 text-right font-semibold">{d.tier ? money(d.commission) : '—'}</td>
                      </tr>
                      {d.flags.length > 0 && (
                        <tr className="border-b border-slate-100"><td colSpan={9} className={`pb-1.5 pl-4 text-[11px] font-semibold ${d.tier ? 'text-amber-600' : 'text-red-600'}`}>⚠ {d.flags.join(' · ')}</td></tr>
                      )}
                    </Fragment>
                  ))}
                </Fragment>
              ))}
              {byRep.length > 0 && (
                <tr className="font-bold">
                  <td className="py-2 pr-2">Total</td><td className="px-2 text-xs font-normal text-slate-500">{data.totals.deals} deals{data.totals.flagged ? ` · ${data.totals.flagged} not paid until fixed` : ''}</td><td />
                  <td className="px-2 text-right">{data.totals.squares}</td><td className="px-2 text-right">{money(data.totals.roof_total)}</td><td /><td /><td />
                  <td className="px-2 text-right text-emerald-700">{money(data.totals.commission)}</td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="mt-1 text-[11px] text-slate-400">Red = can't be paid until the JN job is fixed (left out of the totals). Rates are the Commission Sheet's standard numbers; tell Claude if the sheet has been edited.</div>
        </div>
      )}
    </section>
  )
}
