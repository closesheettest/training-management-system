// William Hernandez's pay, week by week. FIXED TERMS, set in CCG's william-pay
// function and not editable here (Neal, 2026-09-28: "like Neal's pay, not able to
// change the criteria"): $150 per inspection he SIGNS that week, plus 2% of every
// one of his inspections that SOLD that week.
import { Fragment, useState } from 'react'

const CCG = 'https://free-roof-inspections.netlify.app/.netlify/functions/william-pay'
const fmtDay = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const money = (n) => `$${Number(n || 0).toLocaleString()}`

export default function WilliamPayCard() {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [openWk, setOpenWk] = useState(null)
  // Click the title to load + open, click again to shrink (Neal, 2026-09-28).
  const [shown, setShown] = useState(true)
  const toggle = () => { if (!data) { setShown(true); if (!busy) load() } else setShown((v) => !v) }

  async function load() {
    setBusy(true); setErr('')
    try {
      const r = await fetch(`${CCG}?weeks_back=8`)
      const d = await r.json()
      if (!d.ok) throw new Error(d.error || 'Could not load')
      setData(d)
    } catch (x) { setErr(x.message || 'Could not load') }
    setBusy(false)
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div onClick={toggle} className="cursor-pointer select-none text-lg font-bold text-brand-navy hover:opacity-80"><span className="mr-1 inline-block text-slate-400">{data && shown ? '▾' : '▸'}</span>🧑‍🏫 William's pay <span className="text-sm font-normal text-slate-500">(William Hernandez, by week)</span></div>
          <div className="text-xs text-slate-500">Fixed terms: <b>$150</b> per inspection he signs up that week (paid at sign-up, not when inspected), plus <b>2%</b> of each of his inspections that sold that week.</div>
        </div>
        {data && shown && <button type="button" onClick={() => load()} disabled={busy} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60">↻ Refresh</button>}
          <button type="button" onClick={toggle} disabled={busy} className="rounded-md bg-brand-navy px-3 py-1.5 text-sm font-bold text-white disabled:opacity-60">{busy ? 'Loading…' : !data ? 'Load report' : shown ? '▴ Shrink' : '▾ Show'}</button>
      </div>
      {err && <div className="mt-2 text-sm font-semibold text-red-700">{err}</div>}
      {data && shown && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="py-1.5 pr-2">Week</th><th className="px-2 text-right">Signed up</th><th className="px-2 text-right">× $150</th>
              <th className="px-2 text-right">Sales</th><th className="px-2 text-right">Sold $</th><th className="px-2 text-right">2%</th><th className="px-2 text-right">Total owed</th>
            </tr></thead>
            <tbody>
              {data.weeks.map((w) => (
                <Fragment key={w.week_start}>
                  <tr key={w.week_start} onClick={() => setOpenWk(openWk === w.week_start ? null : w.week_start)} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-1.5 pr-2 font-semibold text-slate-800">{openWk === w.week_start ? '▾' : '▸'} {fmtDay(w.week_start)} – {fmtDay(w.week_end)}{w.in_progress && <span className="ml-1 text-xs font-normal text-amber-600">(in progress)</span>}</td>
                    <td className="px-2 text-right">{w.signed}</td>
                    <td className="px-2 text-right">{money(w.insp_pay)}</td>
                    <td className="px-2 text-right">{w.sales.length}</td>
                    <td className="px-2 text-right text-slate-500">{money(w.sales_total)}</td>
                    <td className="px-2 text-right">{money(w.override)}</td>
                    <td className="px-2 text-right font-bold text-emerald-700">{money(w.total)}</td>
                  </tr>
                  {openWk === w.week_start && (
                    <tr key={`${w.week_start}-d`} className="border-b border-slate-100 bg-slate-50">
                      <td colSpan={7} className="px-3 py-2 text-xs text-slate-700">
                        <div className="font-bold">Signed up ({w.signups.length})</div>
                        {w.signups.length === 0 ? <div className="text-slate-400">None</div> : w.signups.map((s, i) => <div key={i}>{s.signed} · {s.client} · {s.address}</div>)}
                        <div className="mt-2 font-bold">Sold ({w.sales.length})</div>
                        {w.sales.length === 0 ? <div className="text-slate-400">None</div> : w.sales.map((s, i) => <div key={i}>{s.sold} · {s.customer} · {s.address} · {money(s.amount)} → {money(s.pay)}</div>)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          <div className="mt-1 text-[11px] text-slate-400">Tap a week to see the signings and sales behind it.</div>
        </div>
      )}
    </section>
  )
}
