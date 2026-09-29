// Inspection pay — what we owe reps for free inspections (and PA submits) for one
// Monday–Sunday week of inspections, labelled by the Friday it's paid. Read from CCG's commission-report, which applies the rates
// set on CCG's Commissions screen (Neal, 2026-09-28: one place for every pay report).
import { Fragment, useState } from 'react'

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
const etDay = (iso) => iso ? new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'numeric', day: 'numeric' }) : '—'
const RESULT = { damage: 'Damage', no_damage: 'No damage', retail: 'Retail' }
// PAID (Neal, 2026-09-29): read from JobNimbus's "INSP Paid Date" per job — some weeks are
// paid early, so the pay-day label alone doesn't say whether it went out.
const paidDay = (iso) => new Date(iso).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'numeric', day: 'numeric' })
const paidCell = (p) => {
  if (!p || !p.of) return <span className="text-slate-400">—</span>
  const d = p.dates.map((x) => paidDay(`${x}T12:00:00Z`)).join(', ')
  if (p.count === p.of) return <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">✓ Paid {d}</span>
  if (p.count === 0) return <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">Not paid</span>
  return <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">{p.count} of {p.of} paid · {d}</span>
}
const money = (n) => `$${Number(n || 0).toLocaleString()}`

export default function InspectionPayReport() {
  const [offset, setOffset] = useState(1) // last completed week
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  // MARK PAID (Neal, 2026-09-29): tick reps, "Mark paid" → JobNimbus INSP Paid Date on each
  // of their inspections + an email to the rep listing what was paid. No PIN — managers-only page.
  const [pick, setPick] = useState({})
  const [paidOn, setPaidOn] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }))
  const [marking, setMarking] = useState(false)
  const [markMsg, setMarkMsg] = useState('')
  const picked = Object.keys(pick).filter((k) => pick[k])
  const markPaid = async () => {
    if (!picked.length || !data) return
    if (!window.confirm(`Mark ${picked.length} rep${picked.length > 1 ? 's' : ''} paid on ${paidOn}?\n\n${picked.join(', ')}\n\nThis writes the paid date into JobNimbus and emails each rep.`)) return
    setMarking(true); setMarkMsg('')
    try {
      const r = await fetch('https://free-roof-inspections.netlify.app/.netlify/functions/inspection-pay-mark', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ start: data.week.start, end: data.week.end, reps: picked, paid_on: paidOn }) })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error || 'Could not mark paid')
      setMarkMsg(j.results.map((x) => x.error ? `${x.rep}: ${x.error}` : `${x.rep}: ${x.set} marked${x.already ? `, ${x.already} already paid` : ''}${x.failed ? `, ${x.failed} FAILED` : ''} · ${x.emailed ? `emailed ${x.email}` : x.email ? 'email not sent' : 'no email on file'}`).join('  |  '))
      setPick({})
      load()
    } catch (x) { setMarkMsg(`⚠ ${x.message}`) }
    setMarking(false)
  }
  const [err, setErr] = useState('')
  const [openRep, setOpenRep] = useState(null) // click a rep → the jobs behind their count
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
      // Named by PAY DAY (Neal, 2026-09-29): a Mon–Sun week of inspections is paid the
      // Friday after it ends — inspected Sep 21–27 → paid Fri, Oct 2.
      setData({ ...d, label: `Paid Fri, ${fmtDay(addDays(mon, 11))}`, sub: `inspected ${fmtDay(mon)} – ${fmtDay(addDays(mon, 6))}` })
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
            <span className="text-center leading-tight"><span className="block text-sm font-semibold text-slate-700">{data.label}</span><span className="block text-[11px] text-slate-500">{data.sub}</span></span>
            <button type="button" onClick={() => go(Math.max(0, offset - 1))} disabled={offset === 0} className="rounded-md border border-slate-300 px-2 py-1 text-sm disabled:opacity-40">▶</button>
          </>}
          {data && shown && <button type="button" onClick={() => load()} disabled={busy} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60">↻ Refresh</button>}
          <button type="button" onClick={toggle} disabled={busy} className="rounded-md bg-brand-navy px-3 py-1.5 text-sm font-bold text-white disabled:opacity-60">{busy ? 'Loading…' : !data ? 'Load report' : shown ? '▴ Shrink' : '▾ Show'}</button>
        </div>
      </div>
      {err && <div className="mt-2 text-sm font-semibold text-red-700">{err}</div>}
      {data && shown && (
        <div className="mt-3 overflow-x-auto">
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
            <span className="font-semibold text-emerald-900">{picked.length ? `${picked.length} checked` : 'Tick the reps you paid, then'}</span>
            <label className="flex items-center gap-1 text-slate-700">paid on <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className="rounded border border-slate-300 px-1.5 py-0.5" /></label>
            <button type="button" disabled={!picked.length || marking} onClick={markPaid} className="rounded-md bg-emerald-700 px-3 py-1 font-bold text-white disabled:opacity-50">{marking ? 'Marking…' : '💵 Mark paid'}</button>
            <span className="text-xs text-slate-500">Writes INSP Paid Date in JobNimbus and emails each rep their list.</span>
            {markMsg && <div className="w-full text-xs font-semibold text-slate-700">{markMsg}</div>}
          </div>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="w-6 py-1.5" /><th className="py-1.5 pr-2">Rep</th><th className="px-2 text-right">Inspections</th><th className="px-2 text-right">$/each</th>
              <th className="px-2 text-right">Inspection pay</th><th className="px-2 text-right">PA submits</th><th className="px-2 text-right">Submit pay</th><th className="px-2 text-right">Total owed</th><th className="px-2 text-right">Paid</th>
            </tr></thead>
            <tbody>
              {data.rows.length === 0 && <tr><td colSpan={9} className="py-4 text-center text-slate-400">No rep activity that week.</td></tr>}
              {data.rows.map((r) => (
                <Fragment key={r.rep}>
                <tr onClick={() => setOpenRep(openRep === r.rep ? null : r.rep)} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-1.5" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" title={r.paid && r.paid.of && r.paid.count === r.paid.of ? 'Already paid' : 'Tick to mark paid'} disabled={!!(r.paid && r.paid.of && r.paid.count === r.paid.of)}
                      checked={!!pick[r.rep]} onChange={(e) => setPick((p) => ({ ...p, [r.rep]: e.target.checked }))} />
                  </td>
                  <td className="py-1.5 pr-2 font-semibold text-slate-800"><span className="mr-1 text-slate-400">{openRep === r.rep ? '▾' : '▸'}</span>{r.rep}</td>
                  <td className="px-2 text-right">{r.inspections}</td>
                  <td className="px-2 text-right text-slate-500">{r.tier_kind === 'flat' ? 'flat' : r.rate_each != null ? money(r.rate_each) : '—'}</td>
                  <td className="px-2 text-right">{money(r.insp_pay)}</td>
                  <td className="px-2 text-right">{r.pa_submits}</td>
                  <td className="px-2 text-right">{money(r.submit_pay)}</td>
                  <td className="px-2 text-right font-bold text-emerald-700">{money(r.total)}</td>
                  <td className="whitespace-nowrap px-2 text-right">{paidCell(r.paid)}</td>
                </tr>
                {openRep === r.rep && (
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <td colSpan={9} className="px-3 py-2">
                      <table className="w-full text-xs">
                        <thead><tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                          <th className="py-1 pr-2">Homeowner</th><th className="px-2">Address</th><th className="px-2">Signed up</th><th className="px-2">Inspected</th><th className="px-2">Result</th><th className="px-2">Paid</th>
                        </tr></thead>
                        <tbody>
                          {(r.detail || []).map((d, i) => (
                            <tr key={i} className="border-t border-slate-200 text-slate-700">
                              <td className="py-1 pr-2 font-semibold">{d.client}</td>
                              <td className="px-2">{d.address}</td>
                              <td className="px-2">{etDay(d.signed_at)}</td>
                              <td className="px-2">{d.kind === 'pa_submit' ? <span className="text-slate-500">PA submitted {etDay(d.submitted_at)}</span> : etDay(d.inspected_at)}</td>
                              <td className="px-2">{d.kind === 'pa_submit' ? 'PA submit' : (RESULT[d.result] || d.result || '—')}</td>
                              <td className="px-2">{d.paid_at ? <span className="font-semibold text-emerald-700">✓ {paidDay(d.paid_at)}</span> : d.kind === 'inspection' ? <span className="text-slate-400">not yet</span> : ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
              {data.rows.length > 0 && (
                <tr className="font-bold">
                  <td /><td className="py-1.5 pr-2">Total</td><td className="px-2 text-right">{data.totals.inspections}</td><td />
                  <td className="px-2 text-right">{money(data.totals.insp_pay)}</td><td className="px-2 text-right">{data.totals.pa_submits}</td>
                  <td className="px-2 text-right">{money(data.totals.submit_pay)}</td><td className="px-2 text-right text-emerald-700">{money(data.totals.total)}</td><td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
