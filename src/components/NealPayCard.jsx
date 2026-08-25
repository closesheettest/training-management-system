// Neal's pay — weekly base guarantee vs. a tiered override on gross sales.
//
// Ladder and terms as supplied (Neal, 2026-08-25), effective 1 June 2026:
//
//     500k – 580k   0.75%        800k – 900k   1.50%
//     580k – 700k   1.00%        900k – 1mm    1.75%
//     700k – 800k   1.25%        1mm and over  2.00%
//
//   · $3,000 a week base guarantee.
//   · "The concept is we need to get to 30 sales a week — that's when your
//      income starts to surpass your current guarantee."
//   · No override for IRBADs: an IRBAD raises gross sales directly, so it is
//     already inside the number the percentage is taken on. Unlike the manager
//     report, there is no separate IRBAD override line here.
//
// The rate applies to the WHOLE week's gross, not marginally — that is what makes
// ~30 sales the point where the override passes the guarantee. Paid is the
// GREATER of the guarantee and the override, never both.
//
// Gross comes from CCG all-manager-pay (totals.contract) so this and the Managers
// Pay report below it are always reading the same week from the same source.

import { useState } from 'react'

const LB_ORIGIN = 'https://free-roof-inspections.netlify.app/.netlify/functions/'

const GUARANTEE = 3000
const EFFECTIVE_FROM = '2026-06-01'

// min is inclusive, max exclusive. Anything under 500k earns no override.
const BANDS = [
  { min: 500_000, max: 580_000, rate: 0.0075, label: '500k – 580k' },
  { min: 580_000, max: 700_000, rate: 0.0100, label: '580k – 700k' },
  { min: 700_000, max: 800_000, rate: 0.0125, label: '700k – 800k' },
  { min: 800_000, max: 900_000, rate: 0.0150, label: '800k – 900k' },
  { min: 900_000, max: 1_000_000, rate: 0.0175, label: '900k – 1mm' },
  { min: 1_000_000, max: Infinity, rate: 0.0200, label: '1mm and over' },
]


// ── Which week? ──────────────────────────────────────────────────────────────
// The sales week is Monday–Sunday, so a week is addressed by the MONTH it starts
// in and its position in that month — "August, week of the 24th" — not by a
// "3 weeks back" count nobody can hold in their head (Neal, 2026-08-25).
const DAY = 864e5

// Monday (ET) of the week containing `d`.
function mondayOf(d) {
  const et = new Date(new Date(d).toLocaleString('en-US', { timeZone: 'America/New_York' }))
  et.setHours(12, 0, 0, 0)
  const back = (et.getDay() + 6) % 7          // Mon=0 … Sun=6
  return new Date(et.getTime() - back * DAY)
}

// The most recent COMPLETED sales week — the one the report defaults to.
function latestReportMonday() {
  return new Date(mondayOf(new Date()).getTime() - 7 * DAY)
}

// Every Monday from the effective date up to the latest reportable week.
function reportableMondays() {
  const out = []
  const last = latestReportMonday()
  let m = mondayOf(new Date(EFFECTIVE_FROM + 'T12:00:00'))
  while (m.getTime() <= last.getTime()) { out.push(new Date(m)); m = new Date(m.getTime() + 7 * DAY) }
  return out.reverse()                        // newest first
}

const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const monthName = (d) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
const weekName = (d) => {
  const end = new Date(d.getTime() + 6 * DAY)
  const f = (x, withMonth) => x.toLocaleDateString('en-US', withMonth ? { month: 'short', day: 'numeric' } : { day: 'numeric' })
  const sameMonth = d.getMonth() === end.getMonth()
  return `${f(d, true)} – ${f(end, !sameMonth)}`
}
// weeks_back the API understands, derived from the Monday chosen.
const weeksBackFor = (monday) => Math.round((latestReportMonday().getTime() - monday.getTime()) / (7 * DAY))

const bandFor = (gross) => BANDS.find((b) => gross >= b.min && gross < b.max) || null
const usd = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const pct = (r) => `${(r * 100).toFixed(2).replace(/\.?0+$/, '')}%`

export default function NealPayCard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [all, setAll] = useState(null)          // every week since the effective date
  const [allLoading, setAllLoading] = useState(false)
  const mondays = reportableMondays()
  const [monday, setMonday] = useState(() => mondays[0] || latestReportMonday())
  const months = [...new Map(mondays.map((m) => [monthKey(m), m])).values()]
  const [month, setMonth] = useState(() => monthKey(mondays[0] || latestReportMonday()))
  const weeksInMonth = mondays.filter((m) => monthKey(m) === month)

  const load = async (mon = monday) => {
    const weeksBack = weeksBackFor(mon)
    setLoading(true); setErr('')
    try {
      const res = await fetch(LB_ORIGIN + 'all-manager-pay?weeks_back=' + weeksBack)
      const d = await res.json()
      if (d && d.ok) setData(d)
      else setErr(d?.error || 'Could not load.')
    } catch { setErr('Network error.') }
    setLoading(false)
  }
  // EVERY week since the schedule started, and what each one actually paid.
  // A single week answers "what did I earn"; only the full run answers "what am I
  // owed", which is the question that matters when the guarantee was paid on a
  // week the override had already beaten (Neal, 2026-08-25).
  const loadAll = async () => {
    setAllLoading(true); setErr('')
    const rows = []
    try {
      for (const m of [...mondays].reverse()) {           // oldest first
        const res = await fetch(LB_ORIGIN + 'all-manager-pay?weeks_back=' + weeksBackFor(m))
        const d = await res.json()
        if (!d || !d.ok) continue
        const g = Number(d?.totals?.contract) || 0
        const b = bandFor(g)
        const o = b ? g * b.rate : 0
        rows.push({ monday: m, gross: g, band: b, override: o, short: Math.max(0, o - GUARANTEE) })
      }
      setAll(rows)
    } catch { setErr('Could not load every week.') }
    setAllLoading(false)
  }

  const pickMonth = (k) => {
    setMonth(k)
    const first = mondays.find((m) => monthKey(m) === k)
    if (first) { setMonday(first); load(first) }
  }
  const pickWeek = (iso) => {
    const m = mondays.find((x) => x.toISOString().slice(0, 10) === iso)
    if (m) { setMonday(m); load(m) }
  }

  const gross = Number(data?.totals?.contract) || 0
  const band = bandFor(gross)
  const override = band ? gross * band.rate : 0
  const paid = Math.max(GUARANTEE, override)
  const onGuarantee = paid === GUARANTEE && override < GUARANTEE
  // A week that closed before the schedule started is not covered by it.
  const weekStart = data?.range?.start ? String(data.range.start).slice(0, 10) : null
  const beforeEffective = weekStart && weekStart < EFFECTIVE_FROM

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-brand-navy">
            🧾 Neal's Pay <span className="text-sm font-normal text-slate-500">(guarantee vs. override on gross sales)</span>
          </h2>
          <p className="text-xs text-slate-500">
            {usd(GUARANTEE)} a week guaranteed. Once the override beats it, the override is what gets paid — never both.
            Sales weeks run Monday–Sunday. Effective 1 June 2026.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={month} onChange={(e) => pickMonth(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700">
            {months.map((m) => <option key={monthKey(m)} value={monthKey(m)}>{monthName(m)}</option>)}
          </select>
          <select value={monday.toISOString().slice(0, 10)} onChange={(e) => pickWeek(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700">
            {weeksInMonth.map((m) => (
              <option key={m.toISOString()} value={m.toISOString().slice(0, 10)}>{weekName(m)}</option>
            ))}
          </select>
          <button onClick={() => load()} disabled={loading} className="rounded-md bg-brand-navy px-3 py-1 text-xs font-bold text-white disabled:opacity-60">
            {loading ? 'Loading…' : data ? 'Refresh' : 'Load'}
          </button>
          <button onClick={loadAll} disabled={allLoading} className="rounded-md border border-brand-navy px-3 py-1 text-xs font-bold text-brand-navy disabled:opacity-60">
            {allLoading ? 'Adding it up…' : 'Every week since 1 June'}
          </button>
        </div>
      </div>

      {err && <p className="mt-3 text-sm font-semibold text-red-600">{err}</p>}
      {!data && all && <AllWeeks rows={all} />}

      {data && (
        <>
          {beforeEffective && (
            <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
              This week closed before 1 June 2026, when this schedule takes effect. Shown for reference only.
            </p>
          )}

          <div className="mt-3 grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-4">
            <Cell label="Gross sales" value={usd(gross)} sub={data.range ? weekLabel(data.range) : ''} />
            <Cell label="Band" value={band ? pct(band.rate) : '—'} sub={band ? band.label : 'under 500k — no override'} />
            <Cell label="Override" value={usd(override)} sub={band ? `${pct(band.rate)} of gross` : 'nothing earned'} />
            <Cell label="Pays out" value={usd(paid)} sub={onGuarantee ? 'the guarantee' : 'the override'} strong />
          </div>



          {all && <AllWeeks rows={all} />}

        </>
      )}
    </div>
  )
}

function Cell({ label, value, sub, strong }) {
  return (
    <div className="bg-white px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`tabular-nums ${strong ? 'text-xl font-extrabold text-brand-navy' : 'text-lg font-bold text-slate-800'}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  )
}

function weekLabel(range) {
  if (!range?.start) return ''
  const f = (s) => new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${f(String(range.start).slice(0, 10))} – ${f(String(range.end || range.start).slice(0, 10))}`
}

// Every week since the schedule took effect: what it should have paid against the
// $3,000 that was actually paid, and the running shortfall.
function AllWeeks({ rows }) {
  const earning = rows.filter((r) => r.band)
  const shortTotal = rows.reduce((n, r) => n + r.short, 0)
  const fmtWeek = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return (
    <div className="mt-4 rounded-lg border border-slate-200">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 px-3 py-2">
        <h3 className="text-sm font-bold text-brand-navy">Every week since 1 June</h3>
        <p className="text-xs text-slate-500">
          {earning.length} of {rows.length} weeks cleared 500k
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
              <th className="px-3 py-1.5 font-semibold">Week</th>
              <th className="px-3 py-1.5 font-semibold">Gross sales</th>
              <th className="px-3 py-1.5 font-semibold">Rate</th>
              <th className="px-3 py-1.5 font-semibold">Should be</th>
              <th className="px-3 py-1.5 font-semibold">Paid</th>
              <th className="px-3 py-1.5 font-semibold">Short</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.monday.toISOString()} className={r.short > 0 ? 'border-t border-slate-100 font-semibold' : 'border-t border-slate-100 text-slate-500'}>
                <td className="px-3 py-1.5">{fmtWeek(r.monday)}</td>
                <td className="px-3 py-1.5 tabular-nums">{usd(r.gross)}</td>
                <td className="px-3 py-1.5 tabular-nums">{r.band ? pct(r.band.rate) : '—'}</td>
                <td className="px-3 py-1.5 tabular-nums">{r.band ? usd(r.override) : '—'}</td>
                <td className="px-3 py-1.5 tabular-nums">{usd(GUARANTEE)}</td>
                <td className={`px-3 py-1.5 tabular-nums ${r.short > 0 ? 'text-red-700' : ''}`}>{r.short > 0 ? usd(r.short) : '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-300 font-extrabold text-brand-navy">
              <td className="px-3 py-2" colSpan={5}>Short in total</td>
              <td className="px-3 py-2 tabular-nums text-red-700">{usd(shortTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="px-3 pb-2 pt-1 text-[11px] text-slate-500">
        &ldquo;Paid&rdquo; assumes the {usd(GUARANTEE)} guarantee was what actually went out each week. Any week already
        settled at the override rate should be struck from the total.
      </p>
    </div>
  )
}
