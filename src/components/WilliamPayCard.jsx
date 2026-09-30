// William Hernandez's pay, week by week (CCG william-pay): $ per inspection he SIGNS
// that week, plus a % of each of his inspections that SOLD that week — 2% retail,
// 5% on an insurance (PA) deal. Rates change under ⚙️ Rates with the Managers Pay PIN
// (Neal, 2026-09-28).
import { Fragment, useEffect, useState } from 'react'

const CCG = 'https://free-roof-inspections.netlify.app/.netlify/functions/william-pay'
const fmtDay = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const money = (n) => `$${Number(n || 0).toLocaleString()}`

export default function WilliamPayCard() {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [openWk, setOpenWk] = useState(null)
  // PICK A WEEK like Neal's pay (Neal, 2026-09-30): a month, then a week in it. Defaults
  // to the last completed week. "All weeks" shows the month as a table.
  const [month, setMonth] = useState('')
  const [pickWk, setPickWk] = useState('')
  const [ratesOpen, setRatesOpen] = useState(false)
  // Click the title to load + open, click again to shrink (Neal, 2026-09-28).
  const [shown, setShown] = useState(true)
  const toggle = () => { if (!data) { setShown(true); if (!busy) load() } else setShown((v) => !v) }

  async function load() {
    setBusy(true); setErr('')
    try {
      const r = await fetch(`${CCG}?weeks_back=16`)
      const d = await r.json()
      if (!d.ok) throw new Error(d.error || 'Could not load')
      setData(d)
      if (!pickWk) {
        const done = d.weeks.find((w) => !w.in_progress) || d.weeks[0]
        if (done) { setMonth(done.week_start.slice(0, 7)); setPickWk(done.week_start); setOpenWk(done.week_start) }
      }
    } catch (x) { setErr(x.message || 'Could not load') }
    setBusy(false)
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div onClick={toggle} className="cursor-pointer select-none text-lg font-bold text-brand-navy hover:opacity-80"><span className="mr-1 inline-block text-slate-400">{data && shown ? '▾' : '▸'}</span>🧑‍🏫 William's pay <span className="text-sm font-normal text-slate-500">(William Hernandez, by week)</span></div>
          <div className="text-xs text-slate-500">{data ? <><b>{money(data.terms.per_signup)}</b> per inspection he signs up that week (paid at sign-up, not when inspected), plus <b>{data.terms.retail_pct}%</b> of each retail sale and <b>{data.terms.pa_pct}%</b> of each insurance (PA) deal from his inspections that sold that week.</> : 'Per inspection he signs up, plus a % of his inspections that sold that week (retail and insurance/PA).'}</div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setRatesOpen((v) => !v)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">⚙️ Rates</button>
          {data && shown && <button type="button" onClick={() => load()} disabled={busy} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60">↻ Refresh</button>}
          <button type="button" onClick={toggle} disabled={busy} className="rounded-md bg-brand-navy px-3 py-1.5 text-sm font-bold text-white disabled:opacity-60">{busy ? 'Loading…' : !data ? 'Load report' : shown ? '▴ Shrink' : '▾ Show'}</button>
        </div>
      </div>
      {ratesOpen && <WilliamRates onSaved={() => { setRatesOpen(false); setShown(true); load() }} />}
      {err && <div className="mt-2 text-sm font-semibold text-red-700">{err}</div>}
      {data && shown && (() => {
        const monthLabel = (ym) => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
        const months = [...new Set(data.weeks.map((w) => w.week_start.slice(0, 7)))]
        const inMonth = data.weeks.filter((w) => w.week_start.slice(0, 7) === month)
        const shownWeeks = pickWk === 'all' ? inMonth : data.weeks.filter((w) => w.week_start === pickWk)
        const pickMonth = (ym) => { setMonth(ym); const first = data.weeks.find((w) => w.week_start.slice(0, 7) === ym); setPickWk(first ? first.week_start : 'all'); setOpenWk(first ? first.week_start : null) }
        return (
        <div className="mt-3 overflow-x-auto">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <select value={month} onChange={(e) => pickMonth(e.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700">
              {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
            <select value={pickWk} onChange={(e) => { setPickWk(e.target.value); setOpenWk(e.target.value === 'all' ? null : e.target.value) }} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700">
              {inMonth.map((w) => <option key={w.week_start} value={w.week_start}>Week of {fmtDay(w.week_start)} – {fmtDay(w.week_end)}{w.in_progress ? ' (in progress)' : ''}</option>)}
              <option value="all">All weeks in {monthLabel(month || months[0] || '2026-09')}</option>
            </select>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="py-1.5 pr-2">Week</th><th className="px-2 text-right">Signed up</th><th className="px-2 text-right">× $150</th>
              <th className="px-2 text-right">Sales</th><th className="px-2 text-right">Sold $</th><th className="px-2 text-right">2%</th><th className="px-2 text-right">Total owed</th>
            </tr></thead>
            <tbody>
              {shownWeeks.map((w) => (
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
                        {w.sales.length === 0 ? <div className="text-slate-400">None</div> : w.sales.map((s, i) => <div key={i}>{s.sold} · {s.customer} · {s.address} · {s.kind === 'pa' ? 'Insurance (PA)' : 'Retail'} · {money(s.amount)} × {s.pct}% → {money(s.pay)}</div>)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          <div className="mt-1 text-[11px] text-slate-400">Pick a month and week above; tap a week to see the signings and sales behind it.</div>
        </div>
        )
      })()}
    </section>
  )
}

// Rate editor — same PIN as Managers Pay. A change re-prices every week shown.
function WilliamRates({ onSaved }) {
  const [v, setV] = useState(null)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    fetch(`${CCG}?terms=1`).then((r) => r.json()).then((d) => { if (d.ok) setV({ per_signup: String(d.terms.per_signup), retail_pct: String(d.terms.retail_pct), pa_pct: String(d.terms.pa_pct) }) }).catch(() => setMsg('Could not load the rates.'))
  }, [])
  async function save() {
    setBusy(true); setMsg('')
    try {
      const r = await fetch(CCG, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin, config: v }) })
      const d = await r.json()
      if (!d.ok) throw new Error(d.error || 'Save failed')
      onSaved()
    } catch (x) { setMsg(x.message || 'Save failed') }
    setBusy(false)
  }
  if (!v) return <div className="mt-3 text-sm text-slate-500">{msg || 'Loading rates…'}</div>
  const field = (k, label, pre, post) => (
    <label className="flex flex-col text-xs font-semibold text-slate-600">{label}
      <span className="mt-1 flex items-center gap-1">{pre}<input value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} inputMode="decimal" className="w-20 rounded border border-slate-300 px-2 py-1 text-sm" />{post}</span>
    </label>
  )
  return (
    <div className="mt-3 flex flex-wrap items-end gap-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
      {field('per_signup', 'Per inspection signed', '$', '')}
      {field('retail_pct', 'Retail sale', '', '%')}
      {field('pa_pct', 'Insurance (PA) sale', '', '%')}
      <label className="flex flex-col text-xs font-semibold text-slate-600">PIN
        <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} className="mt-1 w-24 rounded border border-slate-300 px-2 py-1 text-sm" />
      </label>
      <button type="button" onClick={save} disabled={busy || !pin} className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save rates'}</button>
      {msg && <span className="text-sm font-semibold text-red-700">{msg}</span>}
      <div className="w-full text-[11px] text-slate-500">Same PIN as Managers Pay. Saving re-figures every week in the report with the new rates.</div>
    </div>
  )
}
