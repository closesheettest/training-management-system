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
// Gross comes from the FROZEN week (CCG frozen-weeks) whenever that week has been
// captured, and only falls back to a live all-manager-pay recompute for a week not
// frozen yet. Both views used to disagree: the table read the frozen figure while
// this card always recomputed, so the week of 1 June showed $560,006 in the table
// and $505,300 on the card — the same week, valued two months apart, after sold
// deals had gone Lost (Neal, 2026-08-27). The frozen figure is what was paid on,
// so it is the one that gets shown; the drift is surfaced underneath rather than
// silently swapped in, because seeing it is the whole point of reconciling.

import { useEffect, useState } from 'react'

const LB_ORIGIN = 'https://free-roof-inspections.netlify.app/.netlify/functions/'

// Defaults only — the live schedule comes from neal-pay-config so a rate can be
// changed without a developer (Neal, 2026-08-25).
const DEFAULT_GUARANTEE = 3000
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
// "Jun 1 – 7". Built from the week's MONDAY, so the card, the dropdown and the table
// can never disagree. The API returns its range as instants — Monday 00:00 ET to
// Sunday 23:59:59 ET — and that end lands on Monday in UTC, so formatting it off the
// raw ISO string printed a Mon–Sun week as "Jun 1 – Jun 8" and made the card look
// like it had counted an extra day (Neal, 2026-08-27).
const weekName = (d) => {
  const end = new Date(d.getTime() + 6 * DAY)
  const f = (x, withMonth) => x.toLocaleDateString('en-US', withMonth ? { month: 'short', day: 'numeric' } : { day: 'numeric' })
  const sameMonth = d.getMonth() === end.getMonth()
  return `${f(d, true)} – ${f(end, !sameMonth)}`
}
// weeks_back the API understands, derived from the Monday chosen.
const weeksBackFor = (monday) => Math.round((latestReportMonday().getTime() - monday.getTime()) / (7 * DAY))

const money0 = (n) => (n >= 1000000 ? `${n / 1000000}mm` : `${Math.round(n / 1000)}k`)
const usd = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const pct = (r) => `${(r * 100).toFixed(2).replace(/\.?0+$/, '')}%`

export default function NealPayCard() {
  const [cfg, setCfg] = useState(null)
  const [ratesOpen, setRatesOpen] = useState(false)
  useEffect(() => {
    fetch(LB_ORIGIN + 'neal-pay-config').then((r) => r.json())
      .then((d) => { if (d && d.ok) setCfg(d.config) }).catch(() => {})
  }, [])

  // EACH WEEK USES THE SCHEDULE THAT APPLIED TO IT. Raising a rate today must not
  // rewrite what June was paid, so the config is a dated history and a week looks
  // up the one in force when it closed (Neal, 2026-08-25).
  const schedules = (cfg?.schedules || []).slice().sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))
  const scheduleFor = (weekStart) =>
    schedules.find((s) => !weekStart || s.effective_from <= weekStart)
    || schedules[schedules.length - 1]
    || { guarantee: DEFAULT_GUARANTEE, bands: BANDS, effective_from: EFFECTIVE_FROM }
  const ladderOf = (sch) => (sch.bands || BANDS).map((b) => ({
    ...b, max: b.max == null ? Infinity : Number(b.max),
    label: b.max == null ? `${money0(b.min)}+` : `${money0(b.min)} – ${money0(b.max)}`,
  }))
  const bandIn = (sch, g) => ladderOf(sch).find((b) => g >= b.min && g < b.max) || null

  const current = scheduleFor(null)
  const GUARANTEE = Number(current.guarantee) || DEFAULT_GUARANTEE
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [all, setAll] = useState(null)          // every week since the effective date
  const [allLoading, setAllLoading] = useState(false)
  // week_start → frozen row, so ONE week can be valued off the freeze too. Loaded up
  // front: the card must not depend on somebody having pressed "Every week since".
  const [frozen, setFrozen] = useState({})
  useEffect(() => {
    fetch(LB_ORIGIN + 'frozen-weeks?since=' + EFFECTIVE_FROM).then((r) => r.json())
      .then((d) => {
        if (!d || !d.ok) return
        setFrozen(Object.fromEntries((d.weeks || []).map((w) => [w.week_start, w])))
      }).catch(() => {})
  }, [])
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
  // FROZEN weeks, not a live recompute. Recomputing gave a different answer every
  // time it was asked: the week of 10 Aug read $514,028 when it was paid and
  // $467,468 a week later, because three sold deals had gone Lost in between. A
  // week captured when it closed is the only figure that can be reconciled
  // against what was actually paid (Neal, 2026-08-25).
  const loadAll = async () => {
    setAllLoading(true); setErr('')
    try {
      const res = await fetch(LB_ORIGIN + 'frozen-weeks?since=' + EFFECTIVE_FROM)
      const d = await res.json()
      if (!d || !d.ok) { setErr(d?.error || 'Could not load the frozen weeks.'); setAllLoading(false); return }
      const weeks = d.weeks || []
      const frozenStarts = new Set(weeks.map((w) => w.week_start))
      const rowFor = (weekStart, gross, extra) => {
        const g = Number(gross) || 0
        const sch = scheduleFor(weekStart)             // the terms in force THAT week
        const b = bandIn(sch, g)
        const o = b ? g * b.rate : 0
        const gtee = Number(sch.guarantee) || DEFAULT_GUARANTEE
        return { monday: new Date(weekStart + 'T12:00:00'), gross: g, band: b, override: o,
                 guarantee: gtee, short: Math.max(0, o - gtee), ...extra }
      }
      const rows = weeks.slice().reverse().map((w) => rowFor(w.week_start, w.gross))
      // The just-completed week isn't frozen until the Monday 6:05am ET run — and a
      // missed run would leave it off entirely. Show it LIVE so last week never
      // vanishes from the ladder; it settles to the frozen figure once captured.
      const latestMon = latestReportMonday()
      const latestIso = latestMon.toISOString().slice(0, 10)
      if (!frozenStarts.has(latestIso)) {
        try {
          const r2 = await fetch(LB_ORIGIN + 'all-manager-pay?weeks_back=' + weeksBackFor(latestMon))
          const d2 = await r2.json()
          const g = Number(d2?.totals?.contract) || 0
          if (g > 0) rows.push(rowFor(latestIso, g, { preliminary: true }))
        } catch { /* live fetch failed — just show the frozen weeks */ }
      }
      if (!rows.length) setErr('No weeks frozen yet — run the backfill.')
      setAll(rows)
    } catch { setErr('Could not load the frozen weeks.') }
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

  // The week on screen, addressed by its Monday.
  const weekStart = monday.toISOString().slice(0, 10)
  // THE TERMS THAT APPLIED TO THIS WEEK, not today's. The table below already did
  // this per row; the card was reading the newest schedule, so the first time a rate
  // changed it would have re-priced every past week on screen.
  const weekSchedule = scheduleFor(weekStart)
  const weekGuarantee = Number(weekSchedule.guarantee) || DEFAULT_GUARANTEE
  const bandForWeek = (g) => ladderOf(weekSchedule).find((b) => g >= b.min && g < b.max) || null

  // THE FROZEN FIGURE WINS. A frozen week is what the week was worth when it closed
  // and what the override was paid on; recomputing it today just re-reads JobNimbus
  // as it stands now, which drops every deal that has gone Lost since.
  const frozenRow = frozen[weekStart] || null
  const liveGross = Number(data?.totals?.contract) || 0
  const gross = frozenRow ? Number(frozenRow.gross) || 0 : liveGross
  const drift = frozenRow && data ? liveGross - gross : 0
  // How long AFTER the week ended it was captured. A same-week freeze is the figure
  // that was paid on; one taken two months later is a recompute wearing a freeze's
  // clothes, and can sit below what was actually paid.
  const lateCapture = frozenRow?.captured_at && frozenRow?.week_end
    ? Math.round((new Date(frozenRow.captured_at) - new Date(frozenRow.week_end + 'T23:59:59Z')) / 864e5)
    : 0

  const band = bandForWeek(gross)
  const override = band ? gross * band.rate : 0
  const paid = Math.max(weekGuarantee, override)
  const onGuarantee = paid === weekGuarantee && override < weekGuarantee
  // A week that closed before the schedule started is not covered by it.
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
          <button onClick={() => setRatesOpen((v) => !v)} className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">
            ⚙️ Rates
          </button>
        </div>
      </div>

      {/* The editor edits ONE schedule, so hand it the schedule in force — not the
          raw config. The config became a dated history ({schedules:[…]}) when each
          week started being valued by its own terms, but this still passed the whole
          config, so `cfg.guarantee` and `cfg.bands` were both undefined and the
          screen came up with an empty guarantee and no ladder at all (Neal,
          2026-08-27). `current` falls back to the built-in schedule, so it is never
          undefined. */}
      {ratesOpen && <RatesEditor cfg={current} onSaved={(c) => { setCfg(c); setRatesOpen(false) }} />}

      {err && <p className="mt-3 text-sm font-semibold text-red-600">{err}</p>}
      {!data && all && <AllWeeks rows={all} guarantee={GUARANTEE} />}

      {data && (
        <>
          {beforeEffective && (
            <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
              This week closed before 1 June 2026, when this schedule takes effect. Shown for reference only.
            </p>
          )}

          <div className="mt-3 grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-4">
            <Cell label="Gross sales" value={usd(gross)} sub={weekName(monday)} />
            <Cell label="Band" value={band ? pct(band.rate) : '—'} sub={band ? band.label : 'under 500k — no override'} />
            <Cell label="Override" value={usd(override)} sub={band ? `${pct(band.rate)} of gross` : 'nothing earned'} />
            <Cell label="Pays out" value={usd(paid)} sub={onGuarantee ? 'the guarantee' : 'the override'} strong />
          </div>

          {/* Which figure is on screen, and how far JobNimbus has moved since. */}
          {frozenRow ? (
            <p className="mt-2 text-[11px] text-slate-500">
              Frozen{frozenRow.deals ? ` · ${frozenRow.deals} deals` : ''} — this is the figure the override is paid on.
              {/* A week captured LATE was recomputed after deals had already moved, so the
                  freeze may have locked in a number below what was actually paid on. That
                  is not a rounding detail: it is the difference between clearing the 500k
                  floor and earning nothing (Neal, 2026-08-27). */}
              {lateCapture > 10 && (
                <> <span className="font-semibold text-amber-700">Captured {lateCapture} days after the week closed</span>, so it may already have drifted below the figure that was reported at payout — worth checking against the report you were paid on.</>
              )}
              {Math.abs(drift) >= 1 && (
                <>
                  {' '}JobNimbus now recomputes this week at <strong className="tabular-nums">{usd(liveGross)}</strong>{' '}
                  ({drift < 0 ? `${usd(Math.abs(drift))} lower` : `${usd(drift)} higher`}) because deals have changed status since. That drift does not change the pay.
                </>
              )}
            </p>
          ) : (
            <p className="mt-2 text-[11px] text-amber-700">
              Not frozen yet — this is a live recompute and it will move as deals change status. Freeze the week to lock it.
            </p>
          )}



          {all && <AllWeeks rows={all} guarantee={GUARANTEE} />}

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

// Every week since the schedule took effect: what it should have paid against the
// $3,000 that was actually paid, and the running shortfall.
function AllWeeks({ rows, guarantee }) {
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
                <td className="px-3 py-1.5">{fmtWeek(r.monday)}{r.preliminary ? <span className="ml-1 text-[10px] font-semibold text-amber-600">· live (freezes Mon)</span> : ''}</td>
                <td className="px-3 py-1.5 tabular-nums">{usd(r.gross)}</td>
                <td className="px-3 py-1.5 tabular-nums">{r.band ? pct(r.band.rate) : '—'}</td>
                <td className="px-3 py-1.5 tabular-nums">{r.band ? usd(r.override) : '—'}</td>
                <td className="px-3 py-1.5 tabular-nums">{usd(r.guarantee ?? guarantee)}</td>
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
    </div>
  )
}

// Change the guarantee or any band's rate. PIN-gated, same gate the manager
// rates use — this is what somebody gets paid, so it should not be a free edit.
function RatesEditor({ cfg, onSaved }) {
  const [pin, setPin] = useState('')
  const [guarantee, setGuarantee] = useState(cfg.guarantee)
  const [bands, setBands] = useState((cfg.bands || []).map((b) => ({ ...b })))
  // Defaults to the Monday of this week: a change applies from here forward and
  // every week before it keeps the terms it was paid under.
  const [from, setFrom] = useState(() => {
    const d = new Date(); d.setHours(12, 0, 0, 0)
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    return d.toISOString().slice(0, 10)
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const setBand = (i, k, v) => setBands((bs) => bs.map((b, j) => (j === i ? { ...b, [k]: v } : b)))

  const save = async () => {
    setSaving(true); setErr('')
    try {
      const res = await fetch(LB_ORIGIN + 'neal-pay-config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, config: { guarantee: Number(guarantee), effective_from: from, bands } }),
      })
      const d = await res.json()
      if (!d.ok) { setErr(d.error || 'Could not save.'); setSaving(false); return }
      onSaved(d.config)
    } catch { setErr('Network error.') }
    setSaving(false)
  }

  return (
    <div className="mt-3 rounded-lg border border-slate-300 bg-slate-50 p-3">
      <h3 className="text-sm font-bold text-brand-navy">Pay schedule</h3>
      <p className="mt-0.5 text-xs text-slate-500">
        The rate applies to the whole week&rsquo;s gross. The guarantee is paid only when it beats the override, never both.
      </p>

      <label className="mt-3 block text-xs font-semibold text-slate-600">Applies from (Monday)</label>
      <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
        className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
      <p className="mt-1 text-[11px] text-slate-500">Weeks before this date keep the rates they were paid under.</p>

      <label className="mt-3 block text-xs font-semibold text-slate-600">Weekly guarantee</label>
      <div className="flex items-center gap-1">
        <span className="text-slate-500">$</span>
        <input type="number" value={guarantee} onChange={(e) => setGuarantee(e.target.value)}
          className="w-32 rounded-md border border-slate-300 px-2 py-1 text-sm tabular-nums" />
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
              <th className="py-1 pr-3 font-semibold">Gross from</th>
              <th className="py-1 pr-3 font-semibold">up to</th>
              <th className="py-1 font-semibold">Rate %</th>
            </tr>
          </thead>
          <tbody>
            {bands.map((b, i) => (
              <tr key={i}>
                <td className="py-0.5 pr-3">
                  <input type="number" value={b.min} onChange={(e) => setBand(i, 'min', e.target.value)}
                    className="w-28 rounded-md border border-slate-300 px-2 py-1 tabular-nums" />
                </td>
                <td className="py-0.5 pr-3">
                  <input type="number" value={b.max ?? ''} placeholder="no limit"
                    onChange={(e) => setBand(i, 'max', e.target.value === '' ? null : e.target.value)}
                    className="w-28 rounded-md border border-slate-300 px-2 py-1 tabular-nums" />
                </td>
                <td className="py-0.5">
                  <input type="number" step="0.01" value={(Number(b.rate) * 100).toFixed(2)}
                    onChange={(e) => setBand(i, 'rate', Number(e.target.value) / 100)}
                    className="w-24 rounded-md border border-slate-300 px-2 py-1 tabular-nums" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="PIN"
          className="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm" />
        <button onClick={save} disabled={saving || !pin}
          className="rounded-md bg-brand-navy px-3 py-1 text-xs font-bold text-white disabled:opacity-60">
          {saving ? 'Saving…' : 'Save rates'}
        </button>
        {err && <span className="text-xs font-semibold text-red-600">{err}</span>}
      </div>
    </div>
  )
}
