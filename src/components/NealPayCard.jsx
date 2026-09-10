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

import { Fragment, useEffect, useState } from 'react'

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
// THE PAY DATE for a sales week. Two-week lag (Neal, 2026-09-10): a week no longer
// pays on the first Friday after it closes but on the SECOND, so cancellations have
// a week to land before anyone is paid on the deal. Monday + 18 days = that Friday.
const PAY_LAG_DAYS = 18
const paydayFor = (monday) => new Date(monday.getTime() + PAY_LAG_DAYS * DAY)
const paydayName = (monday) => paydayFor(monday).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const isDue = (monday) => Date.now() >= paydayFor(monday).getTime()

// THE CHANGEOVER FRIDAY. Doubling the lag leaves one Friday with no sales week
// behind it: the week of 24 Aug paid early on 4 Sep under the old one-week rule,
// and the week of 31 Aug does not pay until 18 Sep under the new one. That Friday
// still owes the weekly guarantee — the base does not stop because the override
// timing changed (Neal, 2026-09-10). A single dated exception, not a rule.
const TRANSITION_PAYDAY = '2026-09-11'
const TRANSITION_VALUE = 'transition'


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
  // What was ACTUALLY paid each week (amount + date), keyed by the week's Monday.
  // Past weeks were paid the base $3,000 (accurate as-is); this is for recording
  // real payments from this week forward once they go out (Neal, 2026-08-31).
  const [payments, setPayments] = useState({})
  const [transition, setTransition] = useState(false)
  // Collapsed on arrival, and it does NOT fetch until opened (Neal, 2026-09-10).
  // The card sits on a page full of other reports; loading pay figures nobody
  // asked to see cost a JobNimbus round trip on every visit.
  const [open, setOpen] = useState(false)
  useEffect(() => {
    fetch(LB_ORIGIN + 'neal-pay-payments').then((r) => r.json())
      .then((d) => { if (d && d.ok) setPayments(d.payments || {}) }).catch(() => {})
  }, [])
  const mondays = reportableMondays()
  const [monday, setMonday] = useState(() => mondays[0] || latestReportMonday())
  const months = [...new Map(mondays.map((m) => [monthKey(m), m])).values()]
  const [month, setMonth] = useState(() => monthKey(mondays[0] || latestReportMonday()))
  const weeksInMonth = mondays.filter((m) => monthKey(m) === month)

  // Picking a month or a pay period loads THAT week straight away (Neal,
  // 2026-09-10). Driven off the selected Monday rather than the select handlers:
  // pickMonth/pickWeek set state, and calling load() from the handler would run
  // against the previous week. load() also takes a Date, not the option's string.
  useEffect(() => { if (open) load(monday) /* eslint-disable-next-line */ }, [open, monday])

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
  // One place that builds a week's <option>, so the sorted list and the old
  // inline map cannot drift.
  const renderWeekOption = (m) => {
    const rec = payments[m.toISOString().slice(0, 10)]
    const label = rec && rec.amount != null
      ? `Paid ${rec.date ? new Date(rec.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}`.trim()
      : `Pays ${paydayName(m)}`
    return <option key={m.toISOString()} value={m.toISOString().slice(0, 10)}>{label}</option>
  }

  const pickWeek = (iso) => {
    if (iso === TRANSITION_VALUE) { setTransition(true); return }
    setTransition(false)
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
  // A week that has ALREADY BEEN PAID keeps the figure it was paid on — you cannot
  // retroactively re-price a cheque that cleared, and the drift is surfaced below
  // instead. A week NOT yet paid values at CURRENT status, so a job that has gone
  // Lost since comes straight back out of the total before anyone is paid on it
  // (Neal, 2026-09-10). That is the whole point of the two-week lag.
  const alreadyPaid = !!(payments[weekStart] && payments[weekStart].amount != null)
  const gross = alreadyPaid && frozenRow ? Number(frozenRow.gross) || 0 : (data ? liveGross : (Number(frozenRow?.gross) || 0))
  const drift = frozenRow && data ? liveGross - (Number(frozenRow.gross) || 0) : 0
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
  // A week already paid is due by definition; otherwise it waits for its payday.
  const dueYet = alreadyPaid || isDue(monday)

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-brand-navy">
            <button type="button" onClick={() => setOpen((v) => !v)} className="text-left hover:opacity-80">
              <span className="mr-1 inline-block text-slate-400">{open ? '▾' : '▸'}</span>
              🧾 Neal's Pay <span className="text-sm font-normal text-slate-500">(guarantee vs. override on gross sales)</span>
            </button>
          </h2>
          <p className="text-xs text-slate-500">
            {usd(GUARANTEE)} a week guaranteed. Once the override beats it, the override is what gets paid — never both.
            Sales weeks run Monday–Sunday. Effective 1 June 2026.
          </p>
        </div>
        {open && <div className="flex items-center gap-2">
          {/* Pick a month, pick a pay period, and it loads that week — no separate
              Load press (Neal, 2026-09-10). */}
          <select value={month} onChange={(e) => pickMonth(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700">
            {months.map((m) => <option key={monthKey(m)} value={monthKey(m)}>{monthName(m)}</option>)}
          </select>
          {/* Pay periods are labelled by the FRIDAY THEY PAY, not the sales range —
              a period is chosen by its payment date (Neal, 2026-09-10). The card
              body still shows the sales range the figure covers. */}
          <select value={transition ? TRANSITION_VALUE : monday.toISOString().slice(0, 10)} onChange={(e) => pickWeek(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700">
            {/* Ordered by PAY DATE, newest first — the changeover Friday sits in its
                real chronological place (between 18 Sep and 4 Sep) instead of being
                pinned to the top, which read as out of order (Neal, 2026-09-10). */}
            {[...weeksInMonth.map((m) => {
                // Sort on the date the option ACTUALLY SHOWS. A paid week is
                // labelled by when it was paid, but was being sorted by its
                // computed payday — so the week of 24 Aug displayed "Paid Sep 4"
                // while sorting at Sep 11, and landed below the transition row
                // (Neal, 2026-09-10).
                const rec = payments[m.toISOString().slice(0, 10)]
                const shown = rec && rec.amount != null && rec.date
                  ? new Date(rec.date + 'T12:00:00')
                  : paydayFor(m)
                return { kind: 'week', m, pay: shown }
              }),
              ...(weeksInMonth.length ? [{ kind: 'transition', pay: new Date(TRANSITION_PAYDAY + 'T12:00:00') }] : [])]
              .sort((a, b) => b.pay - a.pay)
              .map((row) => {
                if (row.kind === 'transition') return (
                  <option key={TRANSITION_VALUE} value={TRANSITION_VALUE}>
                    Pays {row.pay.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · transition
                  </option>
                )
                return renderWeekOption(row.m)
              })}

          </select>
          <button onClick={() => load()} disabled={loading} className="rounded-md bg-brand-navy px-3 py-1 text-xs font-bold text-white disabled:opacity-60">
            {loading ? 'Loading…' : data ? 'Refresh' : 'Load'}
          </button>
          {/* "Every week since 1 June" hidden (Neal, 2026-09-10) — the card is now
              driven by picking a month and a pay period. loadAll() is left intact
              so it can be switched back on by restoring this button. */}
          {(data || all) && (
            <button onClick={() => { setData(null); setAll(null); setErr('') }} className="rounded-md border border-slate-300 px-3 py-1 text-xs font-bold text-slate-600 hover:bg-slate-50">
              ✕ Close
            </button>
          )}
          <button onClick={() => setRatesOpen((v) => !v)} className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">
            ⚙️ Rates
          </button>
        </div>}
      </div>
      {!open && (
        <p className="mt-1 text-xs text-slate-400">Click the title to open — it doesn't load until you do.</p>
      )}

      {/* The editor edits ONE schedule, so hand it the schedule in force — not the
          raw config. The config became a dated history ({schedules:[…]}) when each
          week started being valued by its own terms, but this still passed the whole
          config, so `cfg.guarantee` and `cfg.bands` were both undefined and the
          screen came up with an empty guarantee and no ladder at all (Neal,
          2026-08-27). `current` falls back to the built-in schedule, so it is never
          undefined. */}
      {open && ratesOpen && <RatesEditor cfg={current} onSaved={(c) => { setCfg(c); setRatesOpen(false) }} />}

      {open && err && <p className="mt-3 text-sm font-semibold text-red-600">{err}</p>}
      {!data && all && <AllWeeks rows={all} guarantee={GUARANTEE} payments={payments} onSaved={setPayments} />}

      {open && data && (
        <>
          {beforeEffective && (
            <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
              This week closed before 1 June 2026, when this schedule takes effect. Shown for reference only.
            </p>
          )}

          {/* NOT DUE YET → N/A, not a number. Under the two-week lag the figure for a
              week that has not reached its payday is still moving: cancellations are
              exactly what that extra week exists to catch. Showing $512,678 for a week
              that pays a fortnight out invites someone to treat it as owed (Neal,
              2026-09-10). The pay date is shown instead so it is clear WHEN it lands. */}
          {transition ? (
            <>
              <div className="mt-3 grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-4">
                <Cell label="Gross sales" value="N/A" sub="new override waiting period starting" />
                <Cell label="Band" value="—" sub="no override this week" />
                <Cell label="Override" value="—" sub="first override pays Sep 18" />
                <Cell label="Pays out" value={usd(GUARANTEE)} sub="the guarantee" strong />
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                Changeover Friday — the base guarantee is paid. The week of 24 Aug settled on 4 Sep under the
                old one-week rule, and the week of 31 Aug starts the new two-week wait and pays on 18 Sep.
                No override is calculated for this Friday.
              </p>
              <MarkPaid weekStart={TRANSITION_PAYDAY} amount={GUARANTEE} date={TRANSITION_PAYDAY}
                paid={!!(payments[TRANSITION_PAYDAY] && payments[TRANSITION_PAYDAY].amount != null)}
                onSaved={setPayments} />
            </>
          ) : alreadyPaid ? (
            /* SETTLED. This week's override was calculated and paid already; the
               figures are history, not something being worked out now. Re-running
               the band on it reads as a fresh amount owed, which is exactly what
               made tomorrow's pay show an override that had been paid a week
               earlier (Neal, 2026-09-10). */
            <div className="mt-3 grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-4">
              <Cell label="Gross sales" value="N/A" sub="already settled" />
              <Cell label="Band" value="—" sub="already settled" />
              <Cell label="Override" value="—" sub="already settled" />
              <Cell label="Paid" value={usd(payments[weekStart].amount)} sub={payments[weekStart].date ? `paid ${new Date(payments[weekStart].date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : 'paid'} strong />
            </div>
          ) : !dueYet ? (
            /* RUNNING, not hidden. N/A alone was too blunt — the figure is worth
               seeing, it just is not final until the two-week wait clears and
               cancellations have come out (Neal, 2026-09-10). So show where it
               stands and label it as running. */
            <div className="mt-3 grid gap-px overflow-hidden rounded-lg border border-amber-300 bg-amber-200 sm:grid-cols-4">
              <Cell label="Gross sales" value={usd(gross)} sub={`running · not final until ${paydayName(monday)}`} />
              <Cell label="Band" value={band ? pct(band.rate) : '—'} sub={band ? `${band.label} · running` : 'under 500k so far'} />
              <Cell label="Override" value={usd(override)} sub={band ? `${pct(band.rate)} of gross · running` : 'nothing earned yet'} />
              <Cell label="Would pay" value={usd(paid)} sub={`as it stands · pays ${paydayName(monday)}`} strong />
            </div>
          ) : (
          <div className="mt-3 grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-4">
            <Cell label="Gross sales" value={usd(gross)} sub={weekName(monday)} />
            <Cell label="Band" value={band ? pct(band.rate) : '—'} sub={band ? band.label : 'under 500k — no override'} />
            <Cell label="Override" value={usd(override)} sub={band ? `${pct(band.rate)} of gross` : 'nothing earned'} />
            <Cell label="Pays out" value={usd(paid)} sub={onGuarantee ? 'the guarantee' : 'the override'} strong />
          </div>
          )}
          {alreadyPaid && (
            <p className="mt-2 text-[11px] text-slate-500">
              Sales week {weekName(monday)} — settled. Nothing further is owed on it.
            </p>
          )}
          {!transition && (
            <MarkPaid weekStart={weekStart} amount={Math.round(paid * 100) / 100}
              date={paydayFor(monday).toISOString().slice(0, 10)}
              paid={alreadyPaid} onSaved={setPayments} />
          )}
          {!alreadyPaid && !dueYet && (
            <p className="mt-2 text-[11px] text-slate-500">
              Sales week {weekName(monday)} — <strong>running figures, not final.</strong> This week
              clears its two-week waiting period on {paydayName(monday)}; anything cancelled before
              then comes out of the total first.
            </p>
          )}

          {/* The "Frozen · N deals" / "Not frozen yet" note is gone (Neal,
              2026-09-10). Under the new structure the three states on the tiles —
              settled, not due yet, due — already say everything that matters, and
              whether the underlying week happens to be frozen is plumbing the
              reader does not act on. `drift` and `lateCapture` are still computed
              above if it ever needs to come back. */}

          {all && <AllWeeks rows={all} guarantee={GUARANTEE} payments={payments} onSaved={setPayments} />}

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

// Every week since the schedule took effect: what it should have paid against
// what was actually paid, and the running shortfall. Each week's payment can be
// recorded (amount + date); until it is, a PAST week assumes the $3,000 base was
// paid (accurate — those went out), while THIS week forward shows "pending" until
// its payday (the Friday after the week closes) or a real payment is entered.

// Mark the week ON SCREEN as paid, from the card itself (Neal, 2026-09-10) —
// rather than asking someone to go and record it elsewhere. Amount defaults to
// what the week owes and the date to its payday, so the common case is one tick
// and the PIN. Unticking clears the record, which is how a mistake gets undone.
function MarkPaid({ weekStart, amount, date, paid, onSaved }) {
  const [open, setOpen] = useState(false)
  const [pin, setPin] = useState('')
  const [amt, setAmt] = useState(String(amount ?? ''))
  const [when, setWhen] = useState(date || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const send = async (clear) => {
    setBusy(true); setErr('')
    try {
      const res = await fetch(LB_ORIGIN + 'neal-pay-payments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, week_start: weekStart, amount: clear ? '' : Number(amt), date: when || undefined }),
      })
      const d = await res.json()
      if (!d.ok) { setErr(d.error || 'Could not save.'); setBusy(false); return }
      setBusy(false); setOpen(false); setPin(''); onSaved(d.payments || {})
    } catch { setErr('Network error.'); setBusy(false) }
  }

  if (paid && !open) return (
    <label className="mt-2 flex items-center gap-2 text-xs font-semibold text-emerald-700">
      <input type="checkbox" checked readOnly onClick={() => setOpen(true)} className="h-4 w-4 accent-emerald-600" />
      Paid — tick to undo
    </label>
  )
  if (!open) return (
    <label className="mt-2 flex items-center gap-2 text-xs font-semibold text-slate-600">
      <input type="checkbox" checked={false} onChange={() => setOpen(true)} className="h-4 w-4" />
      Mark this week paid
    </label>
  )
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 rounded-md bg-slate-50 p-2">
      <div className="flex flex-col">
        <label className="text-[10px] font-semibold uppercase text-slate-400">Amount</label>
        <div className="flex items-center gap-1"><span className="text-slate-500">$</span>
          <input type="number" value={amt} onChange={(e) => setAmt(e.target.value)}
            className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm tabular-nums" /></div>
      </div>
      <div className="flex flex-col">
        <label className="text-[10px] font-semibold uppercase text-slate-400">Date paid</label>
        <input type="date" value={when} onChange={(e) => setWhen(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
      </div>
      <div className="flex flex-col">
        <label className="text-[10px] font-semibold uppercase text-slate-400">PIN</label>
        <input type="password" value={pin} onChange={(e) => setPin(e.target.value)}
          className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm" />
      </div>
      <button type="button" disabled={busy} onClick={() => send(false)}
        className="rounded-md bg-brand-navy px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60">
        {busy ? 'Saving…' : 'Save'}
      </button>
      {paid && (
        <button type="button" disabled={busy} onClick={() => send(true)}
          className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-bold text-red-600 disabled:opacity-60">
          Clear
        </button>
      )}
      <button type="button" onClick={() => { setOpen(false); setErr('') }}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600">Cancel</button>
      {err && <span className="w-full text-xs font-semibold text-red-600">{err}</span>}
    </div>
  )
}

function AllWeeks({ rows, guarantee, payments = {}, onSaved }) {
  const [editing, setEditing] = useState(null)  // week iso being edited
  const [showLedger, setShowLedger] = useState(false)  // standalone "record a payment" open
  const earning = rows.filter((r) => r.band)
  const paydayOf = paydayFor
  const isoOf = (r) => r.monday.toISOString().slice(0, 10)
  const fmtWeek = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const fmtDate = (iso) => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''

  // What each week paid: a recorded payment wins; else, once payday has passed, we
  // assume the base guarantee (past weeks); else it's pending (not paid yet).
  const stateOf = (r) => {
    const rec = payments[isoOf(r)]
    if (rec && rec.amount != null) return { kind: 'recorded', amount: rec.amount, date: rec.date }
    if (Date.now() >= paydayOf(r.monday).getTime()) return { kind: 'assumed', amount: r.guarantee ?? guarantee, date: null }
    return { kind: 'pending', amount: null, date: null }
  }
  // The full pay due for a week (the override once earned, else the guarantee).
  const owedOf = (r) => r.band ? r.override : (r.guarantee ?? guarantee)
  // What's still OWED for a week: a paid week is short by (should-be − paid); a
  // pending week has had nothing paid, so the whole amount due is outstanding
  // and belongs in the total (Neal, 2026-08-31).
  const shortOf = (r, st) => st.kind === 'pending'
    ? owedOf(r)
    : (st.amount != null && r.band) ? Math.max(0, r.override - st.amount) : 0
  const shortTotal = rows.reduce((n, r) => { const st = stateOf(r); return n + shortOf(r, st) }, 0)
  // Standalone payments (check register): lump sums paid against the balance, not tied
  // to a week. They reduce the total owed (Neal, 2026-09-04).
  const ledger = Array.isArray(payments._ledger) ? [...payments._ledger].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))) : []
  const ledgerTotal = ledger.reduce((n, e) => n + (Number(e.amount) || 0), 0)
  const remaining = Math.max(0, shortTotal - ledgerTotal)
  const fmtDate2 = (iso) => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'no date'

  return (
    <div className="mt-4 rounded-lg border border-slate-200">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 px-3 py-2">
        <h3 className="text-sm font-bold text-brand-navy">Every week since 1 June</h3>
        <p className="text-xs text-slate-500">
          {earning.length} of {rows.length} weeks cleared 500k · tap ✎ to record what was paid
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
              <th className="px-3 py-1.5 font-semibold">When</th>
              <th className="px-3 py-1.5 font-semibold">Short</th>
              <th className="px-3 py-1.5 text-right font-semibold">Record pay</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const iso = isoOf(r)
              const st = stateOf(r)
              const short = shortOf(r, st)
              return (
                <Fragment key={iso}>
                  <tr className={short > 0 ? 'border-t border-slate-100 font-semibold' : 'border-t border-slate-100 text-slate-500'}>
                    <td className="px-3 py-1.5">{fmtWeek(r.monday)}</td>
                    <td className="px-3 py-1.5 tabular-nums">{usd(r.gross)}</td>
                    <td className="px-3 py-1.5 tabular-nums">{r.band ? pct(r.band.rate) : '—'}</td>
                    <td className="px-3 py-1.5 tabular-nums">{r.band ? usd(r.override) : '—'}</td>
                    <td className="px-3 py-1.5 tabular-nums">
                      {st.kind === 'pending'
                        ? <span className="font-semibold text-amber-600">pending</span>
                        : st.kind === 'recorded'
                          ? <span className="font-bold text-emerald-700">{usd(st.amount)}<span className="ml-1 text-[10px] font-semibold text-emerald-600">✓ you recorded</span></span>
                          : <>{usd(st.amount)}<span className="ml-1 text-[10px] font-normal text-slate-400">base (assumed)</span></>}
                    </td>
                    <td className="px-3 py-1.5 text-[11px] text-slate-500">
                      {st.kind === 'recorded' ? <span className="font-semibold text-emerald-700">{st.date ? `paid ${fmtDate(st.date)}` : 'date not set'}</span>
                        : st.kind === 'pending' ? <span className="text-amber-600">pays {fmtDate(paydayOf(r.monday).toISOString().slice(0, 10))}</span>
                        : ''}
                    </td>
                    <td className={`px-3 py-1.5 tabular-nums ${st.kind === 'pending' ? 'font-semibold text-amber-600' : short > 0 ? 'text-red-700' : ''}`}>
                      {short > 0 ? usd(short) : '—'}{st.kind === 'pending' && <span className="ml-1 text-[10px] font-normal text-amber-500">not paid yet</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <button type="button" onClick={() => setEditing(editing === iso ? null : iso)}
                        title="Record what was paid and when"
                        className="whitespace-nowrap rounded-md border border-slate-300 px-2 py-0.5 text-[11px] font-semibold text-brand-navy hover:bg-slate-100">
                        {editing === iso ? 'Close' : st.kind === 'recorded' ? '✎ Edit' : '✎ Record'}
                      </button>
                    </td>
                  </tr>
                  {editing === iso && (
                    <tr className="bg-slate-50">
                      <td colSpan={8} className="px-3 py-2">
                        <PaymentEditor iso={iso} rec={payments[iso]} defaultAmount={r.band ? r.override : (r.guarantee ?? guarantee)}
                          defaultDate={paydayOf(r.monday).toISOString().slice(0, 10)} weekLabel={weekName(r.monday)}
                          onDone={(p) => { if (p) onSaved && onSaved(p); setEditing(null) }} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
          <tfoot>
            <tr className={ledgerTotal > 0 ? 'border-t-2 border-slate-300 font-semibold text-slate-600' : 'border-t-2 border-slate-300 font-extrabold text-brand-navy'}>
              <td className="px-3 py-2" colSpan={6}>Short in total <span className="text-[11px] font-normal text-slate-500">(shortfalls + weeks not paid yet)</span></td>
              <td className="px-3 py-2 tabular-nums text-red-700">{usd(shortTotal)}</td>
              <td />
            </tr>
            {ledgerTotal > 0 && (
              <>
                <tr className="font-semibold text-emerald-700">
                  <td className="px-3 py-1.5" colSpan={6}>Payments recorded <span className="text-[11px] font-normal text-slate-500">(check register)</span></td>
                  <td className="px-3 py-1.5 tabular-nums">− {usd(ledgerTotal)}</td>
                  <td />
                </tr>
                <tr className="border-t border-slate-300 font-extrabold text-brand-navy">
                  <td className="px-3 py-2" colSpan={6}>Remaining owed</td>
                  <td className="px-3 py-2 tabular-nums text-red-700">{usd(remaining)}</td>
                  <td />
                </tr>
              </>
            )}
          </tfoot>
        </table>
      </div>

      {/* Check register — standalone payments not tied to a week */}
      <div className="border-t border-slate-200 px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs font-bold text-brand-navy">Payment register <span className="font-normal text-slate-500">— record a payment received, any amount, any date</span></h4>
          <button type="button" onClick={() => setShowLedger((v) => !v)}
            className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100">
            {showLedger ? 'Close' : '＋ Record a payment'}
          </button>
        </div>
        {showLedger && <div className="mt-2"><LedgerEditor onDone={(p) => { if (p) onSaved && onSaved(p); setShowLedger(false) }} /></div>}
        {ledger.length > 0 && (
          <ul className="mt-2 divide-y divide-slate-100">
            {ledger.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 py-1 text-sm">
                <span className="tabular-nums font-semibold text-slate-700">{usd(Number(e.amount) || 0)}</span>
                <span className="text-xs text-slate-500">{fmtDate2(e.date)}{e.note ? ` · ${e.note}` : ''}</span>
                <LedgerDelete id={e.id} onDone={(p) => p && onSaved && onSaved(p)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// A standalone payment against the balance (check register): amount + date + note.
// PIN-gated, same gate as week payments. Not tied to any week (Neal, 2026-09-04).
function LedgerEditor({ onDone }) {
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [pin, setPin] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const save = async () => {
    setSaving(true); setErr('')
    try {
      const res = await fetch(LB_ORIGIN + 'neal-pay-payments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, ledger_add: { amount, date, note } }),
      })
      const d = await res.json()
      if (!d.ok) { setErr(d.error || 'Could not save.'); setSaving(false); return }
      setSaving(false); onDone(d.payments || {})
    } catch { setErr('Network error.'); setSaving(false) }
  }
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md bg-slate-50 p-2">
      <div className="flex flex-col">
        <label className="text-[10px] font-semibold uppercase text-slate-400">Amount</label>
        <div className="flex items-center gap-1"><span className="text-slate-500">$</span>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0"
            className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm tabular-nums" /></div>
      </div>
      <div className="flex flex-col">
        <label className="text-[10px] font-semibold uppercase text-slate-400">Date</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
      </div>
      <div className="flex flex-col">
        <label className="text-[10px] font-semibold uppercase text-slate-400">Note</label>
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional"
          className="w-40 rounded-md border border-slate-300 px-2 py-1 text-sm" />
      </div>
      <div className="flex flex-col">
        <label className="text-[10px] font-semibold uppercase text-slate-400">PIN</label>
        <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="PIN"
          className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm" />
      </div>
      <button type="button" onClick={save} disabled={saving || !pin || !(Number(amount) > 0)}
        className="rounded-md bg-brand-navy px-3 py-1 text-xs font-bold text-white disabled:opacity-60">
        {saving ? 'Saving…' : 'Save payment'}
      </button>
      {err && <span className="text-xs font-semibold text-red-600">{err}</span>}
    </div>
  )
}

function LedgerDelete({ id, onDone }) {
  const [confirming, setConfirming] = useState(false)
  const [pin, setPin] = useState('')
  const [saving, setSaving] = useState(false)
  const del = async () => {
    setSaving(true)
    try {
      const res = await fetch(LB_ORIGIN + 'neal-pay-payments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, ledger_remove: id }),
      })
      const d = await res.json()
      setSaving(false); setConfirming(false); setPin('')
      if (d.ok) onDone(d.payments || {})
    } catch { setSaving(false) }
  }
  if (!confirming) return (
    <button type="button" onClick={() => setConfirming(true)} className="text-xs font-semibold text-slate-400 hover:text-red-600">Delete</button>
  )
  return (
    <span className="flex items-center gap-1">
      <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="PIN"
        className="w-16 rounded border border-slate-300 px-1.5 py-0.5 text-xs" />
      <button type="button" onClick={del} disabled={saving || !pin} className="text-xs font-bold text-red-600 disabled:opacity-50">{saving ? '…' : 'Confirm'}</button>
      <button type="button" onClick={() => { setConfirming(false); setPin('') }} className="text-xs text-slate-400">✕</button>
    </span>
  )
}

// Record what a week actually paid, and when. PIN-gated (same gate the pay
// schedule uses). Saving overrides the assumed base; clearing reverts a week to
// the assumed/pending default.
function PaymentEditor({ iso, rec, defaultAmount, defaultDate, weekLabel, onDone }) {
  const [amount, setAmount] = useState(rec?.amount != null ? String(rec.amount) : String(Math.round(defaultAmount || 0)))
  const [date, setDate] = useState(rec?.date || defaultDate || '')
  const [pin, setPin] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const post = async (payload) => {
    setSaving(true); setErr('')
    try {
      const res = await fetch(LB_ORIGIN + 'neal-pay-payments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, week_start: iso, ...payload }),
      })
      const d = await res.json()
      if (!d.ok) { setErr(d.error || 'Could not save.'); setSaving(false); return }
      setSaving(false); onDone(d.payments || {})
    } catch { setErr('Network error.'); setSaving(false) }
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="text-xs font-bold text-brand-navy">Record payment · <span className="font-normal text-slate-500">{weekLabel}</span></div>
      <div className="flex flex-col">
        <label className="text-[10px] font-semibold uppercase text-slate-400">Amount paid</label>
        <div className="flex items-center gap-1"><span className="text-slate-500">$</span>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
            className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm tabular-nums" /></div>
      </div>
      <div className="flex flex-col">
        <label className="text-[10px] font-semibold uppercase text-slate-400">Date paid</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
      </div>
      <div className="flex flex-col">
        <label className="text-[10px] font-semibold uppercase text-slate-400">PIN</label>
        <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="PIN"
          className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm" />
      </div>
      <button type="button" onClick={() => post({ amount, date })} disabled={saving || !pin}
        className="rounded-md bg-brand-navy px-3 py-1 text-xs font-bold text-white disabled:opacity-60">
        {saving ? 'Saving…' : 'Save'}
      </button>
      {rec && (
        <button type="button" onClick={() => post({ amount: '' })} disabled={saving || !pin}
          className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-60">
          Clear
        </button>
      )}
      <button type="button" onClick={() => onDone(null)} className="text-xs font-semibold text-slate-400 hover:text-slate-600">Cancel</button>
      {err && <span className="text-xs font-semibold text-red-600">{err}</span>}
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
