import { useState, Fragment } from 'react'
import { ZONE_COLORS } from '../lib/zones.js'

// CCG functions origin.
const LB_ORIGIN = 'https://free-roof-inspections.netlify.app/.netlify/functions/'
// Weekly contest prize for the winning team, split among its reps (the manager
// gets none) by each rep's share of the team's rep-only points.
const PRIZE_POOL = 2000

// Contest audit report — the checks-and-balance behind the Positive-Effort
// leaderboard.
//
// ONE definition, rendered on BOTH the company-admin page (RegionalManagers) and
// every regional manager's own dashboard (RegionalManager). It used to live only
// on the admin page; the managers got a cut-down board of coloured cards that
// looked nothing like it and, worse, scored a trailing 7 days instead of the
// Wed/Thu contest window (Neal, 2026-08-18). Sharing the component is what keeps
// the two from drifting again — a manager and the owner now read the same report
// off the same numbers.
//
// Collapsible: team → rep → day. Columns are the positive ATTRIBUTES
// showing COUNTS (how many each rep did), not points; the last column totals the
// points, and expanding a rep shows the per-day counts so the math reconciles.
// Data: CCG contest-report.
export default function ContestReport() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [win, setWin] = useState('active') // 'active' | '7' | '1'..'4'
  const [openTeam, setOpenTeam] = useState(null)
  const [openRep, setOpenRep] = useState(null)

  const load = async (w) => {
    setLoading(true); setErr('')
    try {
      const q = w === 'active' ? '' : w === '7' ? '?days=7' : `?week=${w}`
      const res = await fetch(LB_ORIGIN + 'contest-report' + q)
      const d = await res.json()
      if (d && d.ok) { setData(d); setOpenTeam(null); setOpenRep(null) }
      else setErr(d?.error || 'Could not load.')
    } catch { setErr('Network error.') }
    setLoading(false)
  }
  const pick = (w) => { setWin(w); load(w) }
  const fmtDay = (s) => { try { return new Date(s + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) } catch { return s } }

  const WINDOWS = [
    { k: 'active', label: 'Current week' }, { k: '7', label: 'Last 7 days' },
    { k: '1', label: 'Wk 1' }, { k: '2', label: 'Wk 2' }, { k: '3', label: 'Wk 3' }, { k: '4', label: 'Wk 4' },
  ]
  const attrs = (data && data.attributes) || []

  return (
    <section className="mb-6">
      <button type="button" onClick={() => { const willOpen = !open; setOpen(willOpen); if (willOpen && !data) load('active') }}
        className="w-full rounded-lg bg-[#b45309] px-4 py-3 text-left font-semibold text-white shadow hover:opacity-95">
        🏁 Contest report — points audit {open ? '▾' : '▸'}
        <div className="text-xs font-normal opacity-90">
          By team → rep → day. Counts of each positive attribute (not points), then the point total — so you can see where every point comes from and confirm the board is recording it all correctly.
        </div>
      </button>

      {open && (
        <div className="mt-3">
          <div className="mb-3 flex flex-wrap gap-2">
            {WINDOWS.map((w) => (
              <button key={w.k} type="button" onClick={() => pick(w.k)}
                className={'rounded-full px-3 py-1 text-xs font-semibold ' + (win === w.k ? 'bg-[#b45309] text-white' : 'bg-white text-slate-600 ring-1 ring-slate-300')}>
                {w.label}
              </button>
            ))}
            <span className="self-center text-xs text-slate-500">{loading ? 'Loading…' : data ? data.window.label : ''}</span>
          </div>
          {err && <div className="mb-2 text-xs text-red-600">{err}</div>}

          {data && (
            <div className="space-y-3">
              {data.teams.map((t) => {
                const tOpen = openTeam === t.zone
                // The top team (highest avg pts/rep) wins the $2,000. The manager
                // gets none; it's split among the reps by their share of the
                // team's REP-only points.
                const isWinner = data.teams[0] && t.zone === data.teams[0].zone
                const repPts = t.reps.filter((r) => !r.isManager).reduce((s, r) => s + (r.points || 0), 0)
                const prizeFor = (r) => (isWinner && !r.isManager && repPts > 0 ? (r.points / repPts) * PRIZE_POOL : 0)
                const pctFor = (r) => (isWinner && !r.isManager && repPts > 0 ? (r.points / repPts) * 100 : 0)
                return (
                  <div key={t.zone} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                    <button type="button" onClick={() => { setOpenTeam(tOpen ? null : t.zone); setOpenRep(null) }}
                      className="flex w-full items-center justify-between gap-3 p-3 text-left"
                      style={{ background: (ZONE_COLORS[t.zone]?.light) || '#f8fafc' }}>
                      <span className="flex items-center gap-2">
                        <span className="font-bold" style={{ color: (ZONE_COLORS[t.zone]?.deep) || '#0f172a' }}>{t.team}</span>
                        <span className="text-xs text-slate-500">{t.zone}</span>
                        {isWinner && (
                          <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-extrabold text-amber-950">🏆 Winner · ${PRIZE_POOL.toLocaleString()}</span>
                        )}
                      </span>
                      <span className="text-sm text-slate-700"><span className="font-bold">{t.avg}</span> pts/rep · {t.points} total · {t.activeReps} reps {tOpen ? '▾' : '▸'}</span>
                    </button>
                    {tOpen && (
                      <div className="overflow-x-auto border-t border-slate-100">
                        <table className="w-full min-w-[600px] text-sm">
                          <thead>
                            <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                              <th className="p-2 text-left font-semibold">Rep</th>
                              {attrs.map((a) => <th key={a.key} className="p-2 text-center font-semibold">{a.label}</th>)}
                              <th className="p-2 text-center font-semibold">Sold</th>
                              <th className="p-2 text-center font-semibold">Points</th>
                            </tr>
                          </thead>
                          <tbody>
                            {t.reps.map((r) => {
                              const rk = `${t.zone}|${r.name}`
                              const rOpen = openRep === rk
                              const has = r.points > 0 || r.sales > 0 || attrs.some((a) => (r.totals[a.key] || 0) > 0)
                              return (
                                <Fragment key={rk}>
                                  <tr className={'border-t border-slate-100 ' + (has ? 'cursor-pointer hover:bg-amber-50' : 'text-slate-300')}
                                    onClick={() => has && setOpenRep(rOpen ? null : rk)}>
                                    <td className="p-2 font-semibold text-slate-800">
                                      {r.name}{has ? <span className="ml-1 text-slate-400">{rOpen ? '▾' : '▸'}</span> : null}
                                      {isWinner && r.isManager && (
                                        <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">manager · not eligible</span>
                                      )}
                                      {isWinner && !r.isManager && (
                                        <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-bold text-emerald-800" title={`${pctFor(r).toFixed(1)}% of the team's rep points`}>
                                          ${Math.round(prizeFor(r)).toLocaleString()} <span className="font-normal text-emerald-600">({pctFor(r).toFixed(0)}%)</span>
                                        </span>
                                      )}
                                    </td>
                                    {attrs.map((a) => <td key={a.key} className="p-2 text-center tabular-nums">{r.totals[a.key] || <span className="text-slate-300">·</span>}</td>)}
                                    <td className="p-2 text-center tabular-nums">{r.sales || <span className="text-slate-300">·</span>}</td>
                                    <td className="p-2 text-center font-bold tabular-nums text-brand-navy">{r.points}</td>
                                  </tr>
                                  {rOpen && r.days.map((d) => (
                                    <tr key={d.day} className="bg-amber-50/60 text-xs text-slate-600">
                                      <td className="py-1 pl-5 pr-2 whitespace-nowrap">{fmtDay(d.day)}</td>
                                      {attrs.map((a) => <td key={a.key} className="py-1 text-center tabular-nums">{d.counts[a.key] || ''}</td>)}
                                      <td className="py-1 text-center tabular-nums">{d.sold || ''}</td>
                                      <td className="py-1 text-center font-semibold tabular-nums">{d.dayPoints}</td>
                                    </tr>
                                  ))}
                                </Fragment>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })}
              {(() => {
                const cPts = data.teams.reduce((s, t) => s + (t.points || 0), 0)
                const cReps = data.teams.reduce((s, t) => s + (t.activeReps || 0), 0)
                const cAvg = cReps ? Math.round((cPts / cReps) * 10) / 10 : 0
                return (
                  <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-900 px-4 py-3 text-white">
                    <span className="font-extrabold uppercase tracking-wide">🏢 Company total</span>
                    <span className="text-sm"><span className="font-bold">{cAvg}</span> pts/rep · {cPts} total · {cReps} reps</span>
                  </div>
                )
              })()}
              <div className="rounded-lg bg-slate-50 p-2.5 text-[11px] text-slate-500">
                Columns are <b>counts</b> of each attribute. The ramp runs <b>per attribute type</b>: the first 2 of a type each day are 1 pt each, the 3rd and on of that type are 2 pts — plus <b>6 per roof sold</b>. Tap a rep to see the per-day math.
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
