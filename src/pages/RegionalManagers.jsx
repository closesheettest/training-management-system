import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { teamLabel, ZONE_COLORS } from '../lib/zones.js'

// Admin hub for the regional-manager program. One place to grab any
// manager's private dashboard link ("where do I go again?") and to see,
// at a glance, every tool we build for them and whether each manager's
// configurable piece (Zone Zoom URL) is filled in.
//
// This page is read-only on purpose. The URLs themselves are edited on
// Active Reps → Edit Info (the manager record is the source of truth);
// here we just surface what's set and link out to fix what isn't.

// Everything a manager gets on their /regional-manager/:token dashboard.
// The three "configurable" tools map to admin-set URL columns; the rest
// are always on and need no setup.
const TOOLS = [
  { icon: '📹', name: 'Join Zone Zoom', field: 'manager_zoom_url',
    desc: "One tap into their zone's daily 9:30 AM sales-training room." },
  { icon: '👔', name: 'Managers Meeting', field: null,
    desc: 'One-tap join for the company managers meeting (Mon–Thu 8:30 AM ET). Same link for every manager. Always on.' },
  { icon: '✉️', name: 'Message your team', field: null,
    desc: 'Pick one, several, or all of their reps and text them; each reply lands in Team Replies. Always on.' },
  { icon: '📄', name: 'Roof Inspection Records', field: null,
    desc: 'Their deal board — Pending Signatures, per-deal status, Push to Job Nimbus. Auto-linked by zone (no setup). Always on.' },
  { icon: '🗺️', name: 'Zone Map', field: null,
    desc: 'Map of every rep in their zone, pinned by home address. Always on.' },
  { icon: '📣', name: 'Team Broadcast', field: null,
    desc: 'Text the whole zone. Reps can reply — replies land in Team Replies and the manager gets a heads-up text. Always on.' },
  { icon: '💬', name: 'Team Replies', field: null,
    desc: 'Inbox of rep replies, grouped per rep, with reply-from-here. Mirrored from GoHighLevel every minute. Always on.' },
  { icon: '👥', name: 'Roster + Edit info', field: null,
    desc: 'See their active reps, edit a rep’s phone / email / home address (office auto-texted the change), and mark anyone departed. Always on.' },
]

const CONFIG_TOOLS = TOOLS.filter((t) => t.field)

// CCG functions origin (same one the per-manager dashboard uses).
const LB_ORIGIN = 'https://free-roof-inspections.netlify.app/.netlify/functions/'

export default function RegionalManagers() {
  const [managers, setManagers] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    const { data, error } = await supabase
      .from('trainees')
      .select(
        'id, first_name, last_name, phone, managed_region, manager_access_token, manager_link_sent_at, manager_zoom_url',
      )
      .not('managed_region', 'is', null)
      .order('managed_region', { ascending: true })
    if (error) {
      setError(error.message)
      return
    }
    setManagers(data || [])
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-brand-navy">Regional Managers</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          The control center for the regional-manager program. Grab any manager's private
          dashboard link, and see every tool they have plus what still needs setting up. Edit the
          URLs themselves on{' '}
          <Link to="/active-reps" className="font-semibold text-brand-navy underline">
            Active sales reps
          </Link>{' '}
          → Edit Info.
        </p>
      </header>

      <AllDealsToFix />

      <AllBackToRetailConversions />

      <AllApptConversion />

      <AllNoSits />

      <ToolsetReference />

      {error && (
        <div className="mt-6 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {managers === null ? (
        <p className="mt-6 text-sm text-slate-400">Loading managers…</p>
      ) : managers.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">
          No regional managers yet. Assign one on Active sales reps.
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {managers.map((m) => (
            <ManagerCard key={m.id} m={m} />
          ))}
        </div>
      )}
    </div>
  )
}

// Company-wide "needs to be fixed" — every flagged JN sale across ALL
// zones, grouped by region → rep → deal. Same scan + checklist as the
// per-manager "Deals need to be fixed" button and the morning audit
// (CCG all-deals-to-fix → _sales-audit.js). Admin-only view at the top of
// this hub so the whole company's data-hygiene backlog is one tap away.
function AllDealsToFix() {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null) // { zones, total_flagged } | null
  const [openZone, setOpenZone] = useState(null)
  const [openRep, setOpenRep] = useState(null) // `${zone}|${rep}`
  const [err, setErr] = useState('')

  const load = async () => {
    setLoading(true); setErr('')
    try {
      const res = await fetch(LB_ORIGIN + 'all-deals-to-fix')
      const d = await res.json()
      if (d && d.ok) { setData(d); setOpenZone(null); setOpenRep(null) }
      else setErr(d?.error || 'Could not load.')
    } catch { setErr('Network error.') }
    setLoading(false)
  }

  return (
    <section className="mb-6">
      <button
        type="button"
        onClick={load}
        disabled={loading}
        className="w-full rounded-lg bg-[#b8324f] px-4 py-3 text-left font-semibold text-white shadow hover:opacity-95 disabled:opacity-60"
      >
        🛠 All JN sales that need to be fixed{data ? ` (${data.total_flagged})` : ''}
        <div className="text-xs font-normal opacity-90">
          {loading
            ? 'Checking JobNimbus…'
            : `Every zone's sales (since June 1) with missing/wrong info, grouped by region — stays until fixed. Tap to ${data ? 'refresh' : 'load'}.`}
        </div>
      </button>

      {err && <div className="mt-2 text-xs text-red-600">{err}</div>}

      {data && (
        <div className="mt-3 space-y-3">
          {data.zones.length === 0 ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
              ✅ All clean — nothing to fix company-wide since June 1.
            </div>
          ) : (
            data.zones.map((z) => {
              const zoneOpen = openZone === z.zone
              return (
                <div key={z.zone} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                  <button
                    type="button"
                    onClick={() => { setOpenZone(zoneOpen ? null : z.zone); setOpenRep(null) }}
                    className="flex w-full items-center justify-between gap-3 p-3 text-left"
                    style={{ background: (ZONE_COLORS[z.zone]?.light) || '#f8fafc' }}
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-bold" style={{ color: (ZONE_COLORS[z.zone]?.deep) || '#0f172a' }}>
                        {teamLabel(z.zone) || z.zone}
                      </span>
                      <span className="text-xs text-slate-500">{z.zone}</span>
                    </span>
                    <span className="text-sm text-slate-700">
                      <span className="font-bold text-[#b8324f]">{z.count}</span> deal{z.count === 1 ? '' : 's'} {zoneOpen ? '▾' : '▸'}
                    </span>
                  </button>

                  {zoneOpen && (
                    <div className="space-y-2 border-t border-slate-100 p-3">
                      {z.reps.map((r) => {
                        const key = `${z.zone}|${r.rep}`
                        const repOpen = openRep === key
                        return (
                          <div key={key} className="rounded-lg border border-slate-200">
                            <button
                              type="button"
                              onClick={() => setOpenRep(repOpen ? null : key)}
                              className="flex w-full items-center justify-between p-3 text-left"
                            >
                              <span className="font-semibold text-slate-800">{r.rep}</span>
                              <span className="text-sm text-slate-600">
                                <span className="font-bold text-amber-600">{r.count}</span> deal{r.count === 1 ? '' : 's'} {repOpen ? '▾' : '▸'}
                              </span>
                            </button>
                            {repOpen && (
                              <div className="space-y-2 border-t border-slate-100 p-3">
                                {r.deals.map((dl, i) => (
                                  <div key={i} className="rounded bg-slate-50 p-2">
                                    <div className="text-sm font-bold text-slate-900">{dl.customer}</div>
                                    <div className="text-[11px] text-slate-500">
                                      {dl.address}{dl.sold ? ` · sold ${dl.sold}` : ''}
                                    </div>
                                    {dl.missing.map((m, j) => (
                                      <div key={'m' + j} className="text-xs text-amber-700">• Missing: {m}</div>
                                    ))}
                                    {dl.errors.map((e, j) => (
                                      <div key={'e' + j} className="text-xs text-red-600">• Wrong: {e}</div>
                                    ))}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}
    </section>
  )
}

// Company-wide back-to-retail CONVERSIONS — the wins the live back-to-retail
// list can't show (a deal drops off the moment it leaves "Sit Sold Insp").
// cron-track-retail-status snapshots those moves; this reads them across every
// zone (all-retail-conversions), grouped zone → rep → deal, appointments first.
function AllBackToRetailConversions() {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null) // { zones, total, appointments } | null
  const [openZone, setOpenZone] = useState(null)
  const [openRep, setOpenRep] = useState(null) // `${zone}|${rep}`
  const [err, setErr] = useState('')

  const load = async () => {
    setLoading(true); setErr('')
    try {
      const res = await fetch(LB_ORIGIN + 'all-retail-conversions')
      const d = await res.json()
      if (d && d.ok) { setData(d); setOpenZone(null); setOpenRep(null) }
      else setErr(d?.error || 'Could not load.')
    } catch { setErr('Network error.') }
    setLoading(false)
  }

  return (
    <section className="mb-6">
      <button
        type="button"
        onClick={load}
        disabled={loading}
        className="w-full rounded-lg bg-emerald-700 px-4 py-3 text-left font-semibold text-white shadow hover:opacity-95 disabled:opacity-60"
      >
        ✅ Back-to-retail conversions{data ? ` (${data.total})` : ''}{data && data.appointments ? ` · 📅 ${data.appointments} appts` : ''}
        <div className="text-xs font-normal opacity-90">
          {loading
            ? 'Loading…'
            : `Back-to-retail leads moved off "Sit Sold Insp" — 📅 = an appointment was booked. Last 90 days, by region. Tap to ${data ? 'refresh' : 'load'}.`}
        </div>
      </button>

      {err && <div className="mt-2 text-xs text-red-600">{err}</div>}

      {data && (
        <div className="mt-3 space-y-3">
          {data.zones.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-600">
              No conversions tracked yet — they'll appear here as reps move back-to-retail leads off "Sit Sold Insp."
            </div>
          ) : (
            data.zones.map((z) => {
              const zoneOpen = openZone === z.zone
              return (
                <div key={z.zone} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                  <button
                    type="button"
                    onClick={() => { setOpenZone(zoneOpen ? null : z.zone); setOpenRep(null) }}
                    className="flex w-full items-center justify-between gap-3 p-3 text-left"
                    style={{ background: (ZONE_COLORS[z.zone]?.light) || '#f8fafc' }}
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-bold" style={{ color: (ZONE_COLORS[z.zone]?.deep) || '#0f172a' }}>
                        {teamLabel(z.zone) || z.zone}
                      </span>
                      <span className="text-xs text-slate-500">{z.zone}</span>
                    </span>
                    <span className="text-sm text-slate-700">
                      {z.appt_count > 0 && <span className="font-bold text-emerald-600">{z.appt_count} appt{z.appt_count === 1 ? '' : 's'}</span>}
                      <span className="ml-2 text-slate-500">{z.count} total</span> {zoneOpen ? '▾' : '▸'}
                    </span>
                  </button>

                  {zoneOpen && (
                    <div className="space-y-2 border-t border-slate-100 p-3">
                      {z.reps.map((r) => {
                        const key = `${z.zone}|${r.rep}`
                        const repOpen = openRep === key
                        return (
                          <div key={key} className="rounded-lg border border-slate-200">
                            <button
                              type="button"
                              onClick={() => setOpenRep(repOpen ? null : key)}
                              className="flex w-full items-center justify-between p-3 text-left"
                            >
                              <span className="font-semibold text-slate-800">{r.rep}</span>
                              <span className="text-sm text-slate-600">
                                {r.appt_count > 0 && <span className="font-bold text-emerald-600">{r.appt_count} appt{r.appt_count === 1 ? '' : 's'}</span>}
                                <span className="ml-2 text-slate-500">{r.count} total</span> {repOpen ? '▾' : '▸'}
                              </span>
                            </button>
                            {repOpen && (
                              <div className="space-y-2 border-t border-slate-100 p-3">
                                {r.deals.map((dl, i) => (
                                  <div key={i} className="rounded bg-slate-50 p-2">
                                    <div className="text-sm font-bold text-slate-900">
                                      {dl.customer} {dl.appointment && <span className="text-emerald-600">📅</span>}
                                    </div>
                                    <div className="text-[11px] text-slate-500">{dl.address}</div>
                                    <div className="text-xs text-sky-700">→ {dl.converted_to} · {dl.converted_label}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}
    </section>
  )
}

// Company-wide "No-sits to re-book" — every team's no-sit backlog (JN jobs
// the homeowner didn't sit), grouped by region -> rep -> deal, PLUS a
// progress report. The office freezes "today's numbers" as a benchmark with
// one tap, then sees per team + company-wide how many they started with,
// how many moved off the list (re-booked), and how many were added since.
// Backed by the CCG all-no-sits function.
// Company-wide Appointments → Sales conversion, grouped zone → rep, with
// Radiant Barrier / Insulation attach rates. Period toggle (week/last/month).
function AllApptConversion() {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null)
  const [openZone, setOpenZone] = useState(null)
  const [period, setPeriod] = useState('month')
  const [err, setErr] = useState('')

  const load = async (p = period) => {
    setLoading(true); setErr('')
    try {
      const res = await fetch(LB_ORIGIN + 'all-appt-conversion?period=' + p)
      const d = await res.json()
      if (d && d.ok) { setData(d); setOpenZone(null) }
      else setErr(d?.error || 'Could not load.')
    } catch { setErr('Network error.') }
    setLoading(false)
  }
  const setP = (p) => { setPeriod(p); if (data) load(p) }
  const periods = [['week', 'This week'], ['lastweek', 'Last week'], ['month', 'This month']]

  return (
    <section className="mb-6">
      <button type="button" onClick={() => load()} disabled={loading}
        className="w-full rounded-lg bg-indigo-700 px-4 py-3 text-left font-semibold text-white shadow hover:opacity-95 disabled:opacity-60">
        📈 Appointments → Sales{data ? ` (${data.totals.pct}% · ${data.totals.sales}/${data.totals.appts})` : ''}
        <div className="text-xs font-normal opacity-90">
          {loading ? 'Loading…' : `Per-rep conversion + Radiant Barrier / Insulation attach rate, by region. Tap to ${data ? 'refresh' : 'load'}.`}
        </div>
      </button>

      {data && (
        <div className="mt-2 flex gap-1">
          {periods.map(([k, label]) => (
            <button key={k} type="button" onClick={() => setP(k)}
              className={'rounded-md px-2 py-1 text-[11px] font-semibold ' + (period === k ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-700')}>{label}</button>
          ))}
        </div>
      )}
      {err && <div className="mt-2 text-xs text-red-600">{err}</div>}

      {data && (
        <div className="mt-3 space-y-3">
          {data.zones.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-600">No appointments in this period.</div>
          ) : data.zones.map((z) => {
            const zoneOpen = openZone === z.zone
            const zt = z.totals
            return (
              <div key={z.zone} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <button type="button" onClick={() => setOpenZone(zoneOpen ? null : z.zone)}
                  className="flex w-full items-center justify-between gap-3 p-3 text-left"
                  style={{ background: (ZONE_COLORS[z.zone]?.light) || '#f8fafc' }}>
                  <span className="flex items-center gap-2">
                    <span className="font-bold" style={{ color: (ZONE_COLORS[z.zone]?.deep) || '#0f172a' }}>{teamLabel(z.zone) || z.zone}</span>
                    <span className="text-xs text-slate-500">{z.zone}</span>
                  </span>
                  <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-sm text-slate-700">
                    <span><span className="text-[10px] uppercase text-slate-400">Appts</span> <b>{zt.appts}</b></span>
                    <span><span className="text-[10px] uppercase text-slate-400">Sold</span> <b>{zt.sales}</b></span>
                    <span className="font-bold text-indigo-700">{zt.pct}%</span>
                    <span><span className="text-[10px] uppercase text-slate-400">Avg/Sale</span> <b>${(zt.avg || 0).toLocaleString()}</b></span>
                    <span>{zoneOpen ? '▾' : '▸'}</span>
                  </span>
                </button>
                {zoneOpen && (
                  <div className="overflow-x-auto">
                    <table className="w-full whitespace-nowrap text-sm">
                      <thead>
                        <tr className="border-t border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                          <th className="px-3 py-1.5 text-left">Rep</th>
                          <th className="px-2 py-1.5 text-right">Harv Apt</th>
                          <th className="px-2 py-1.5 text-right">Comp Apt</th>
                          <th className="px-2 py-1.5 text-right">BTR Apt</th>
                          <th className="px-2 py-1.5 text-right">Total Apt</th>
                          <th className="px-2 py-1.5 text-right">Harv $</th>
                          <th className="px-2 py-1.5 text-right">Comp $</th>
                          <th className="px-2 py-1.5 text-right">BTR $</th>
                          <th className="px-2 py-1.5 text-right">$ Sold</th>
                          <th className="px-2 py-1.5 text-right">Harv %</th>
                          <th className="px-2 py-1.5 text-right">Comp %</th>
                          <th className="px-2 py-1.5 text-right">BTR %</th>
                          <th className="px-2 py-1.5 text-right">Tot %</th>
                          <th className="px-2 py-1.5 text-right">Avg $/Sale</th>
                        </tr>
                      </thead>
                      <tbody>
                        {z.reps.map((r) => (
                          <tr key={r.rep} className="border-t border-slate-100">
                            <td className="px-3 py-1.5">{r.rep}{r.level && <span className="ml-1.5 rounded bg-slate-200 px-1 py-0.5 text-[9px] font-bold text-slate-600">{r.level}</span>}</td>
                            <td className="px-2 py-1.5 text-right text-slate-600">{r.harvAp}</td>
                            <td className="px-2 py-1.5 text-right text-slate-600">{r.compAp}</td>
                            <td className="px-2 py-1.5 text-right text-slate-600">{r.btrAp}</td>
                            <td className="px-2 py-1.5 text-right font-semibold">{r.appts}</td>
                            <td className="px-2 py-1.5 text-right text-slate-600">${(r.harvAmt || 0).toLocaleString()}</td>
                            <td className="px-2 py-1.5 text-right text-slate-600">${(r.compAmt || 0).toLocaleString()}</td>
                            <td className="px-2 py-1.5 text-right text-slate-600">${(r.btrAmt || 0).toLocaleString()}</td>
                            <td className="px-2 py-1.5 text-right font-semibold">${(r.amt || 0).toLocaleString()}</td>
                            <td className="px-2 py-1.5 text-right text-slate-500">{r.harvPct}%</td>
                            <td className="px-2 py-1.5 text-right text-slate-500">{r.compPct}%</td>
                            <td className="px-2 py-1.5 text-right text-slate-500">{r.btrPct}%</td>
                            <td className="px-2 py-1.5 text-right font-bold text-indigo-700">{r.pct}%</td>
                            <td className="px-2 py-1.5 text-right">${(r.avg || 0).toLocaleString()}</td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
                          <td className="px-3 py-1.5">Zone total</td>
                          <td className="px-2 py-1.5 text-right">{zt.harvAp}</td>
                          <td className="px-2 py-1.5 text-right">{zt.compAp}</td>
                          <td className="px-2 py-1.5 text-right">{zt.btrAp}</td>
                          <td className="px-2 py-1.5 text-right">{zt.appts}</td>
                          <td className="px-2 py-1.5 text-right">${(zt.harvAmt || 0).toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right">${(zt.compAmt || 0).toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right">${(zt.btrAmt || 0).toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right">${(zt.amt || 0).toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right">{zt.harvPct}%</td>
                          <td className="px-2 py-1.5 text-right">{zt.compPct}%</td>
                          <td className="px-2 py-1.5 text-right">{zt.btrPct}%</td>
                          <td className="px-2 py-1.5 text-right text-indigo-700">{zt.pct}%</td>
                          <td className="px-2 py-1.5 text-right">${(zt.avg || 0).toLocaleString()}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
          {data.totals && (
            <div className="rounded-lg px-4 py-3 text-white shadow" style={{ background: '#1e1b4b' }}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm font-extrabold uppercase tracking-wide">🏢 Company total</span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span><span className="text-[10px] uppercase opacity-70">Appts</span> <b>{data.totals.appts}</b> <span className="text-[11px] opacity-70">(H{data.totals.harvAp}·C{data.totals.compAp}·B{data.totals.btrAp})</span></span>
                  <span><span className="text-[10px] uppercase opacity-70">Sold</span> <b>{data.totals.sales}</b> <span className="text-[11px] opacity-70">(H{data.totals.harvSl}·C{data.totals.compSl}·B{data.totals.btrSl})</span></span>
                  <span className="text-base font-extrabold">{data.totals.pct}%</span>
                  <span><span className="text-[10px] uppercase opacity-70">Avg/Sale</span> <b>${(data.totals.avg || 0).toLocaleString()}</b></span>
                </span>
              </div>
            </div>
          )}
          <div className="text-[11px] text-slate-500">Appts counted in the week they happen (free-inspection signings excluded); Sales in the week they close. Buckets: Harv = harvested (Sales Rep Harvested = Yes) · Comp = company lead (IQ / AI Bot / FB…) · BTR = back-to-retail (from an inspection). Each %  = that bucket's sales ÷ appts (can top 100% when a prior-week appt closes this week). Avg $/Sale = approved estimate ÷ sales.</div>
        </div>
      )}
    </section>
  )
}

function AllNoSits() {
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false) // benchmark set/reset in flight
  const [data, setData] = useState(null) // { total, zones, benchmark_at, progress } | null
  const [openZone, setOpenZone] = useState(null)
  const [openRep, setOpenRep] = useState(null) // `${zone}|${rep}`
  const [err, setErr] = useState('')

  const load = async () => {
    setLoading(true); setErr('')
    try {
      const res = await fetch(LB_ORIGIN + 'all-no-sits')
      const d = await res.json()
      if (d && d.ok) { setData(d); setOpenZone(null); setOpenRep(null) }
      else setErr(d?.error || 'Could not load.')
    } catch { setErr('Network error.') }
    setLoading(false)
  }

  const runBenchmark = async (action) => {
    if (action === 'clear-benchmark' && !window.confirm('Clear the benchmark? Progress tracking will reset.')) return
    setBusy(true); setErr('')
    try {
      const res = await fetch(LB_ORIGIN + 'all-no-sits?action=' + action)
      const d = await res.json()
      if (!d || !d.ok) { setErr(d?.error || 'Could not update benchmark.'); setBusy(false); return }
    } catch { setErr('Network error.'); setBusy(false); return }
    setBusy(false)
    await load()
  }

  const benchDate = data?.benchmark_at
    ? new Date(data.benchmark_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null

  return (
    <section className="mb-6">
      <button
        type="button"
        onClick={load}
        disabled={loading}
        className="w-full rounded-lg bg-[#475569] px-4 py-3 text-left font-semibold text-white shadow hover:opacity-95 disabled:opacity-60"
      >
        📵 No-sits to re-book — all teams{data ? ` (${data.total})` : ''}
        <div className="text-xs font-normal opacity-90">
          {loading
            ? 'Checking JobNimbus…'
            : `Every team's no-sit backlog, grouped by region — chase them back onto the calendar. Tap to ${data ? 'refresh' : 'load'}.`}
        </div>
      </button>

      {err && <div className="mt-2 text-xs text-red-600">{err}</div>}

      {data && (
        <div className="mt-3 space-y-3">
          {/* ── Progress report ── */}
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-slate-800">📈 Progress report</div>
              <div className="flex items-center gap-2">
                {data.benchmark_at ? (
                  <>
                    <button type="button" onClick={() => runBenchmark('set-benchmark')} disabled={busy}
                      className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                      Re-set to now
                    </button>
                    <button type="button" onClick={() => runBenchmark('clear-benchmark')} disabled={busy}
                      className="rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60">
                      Clear
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => runBenchmark('set-benchmark')} disabled={busy}
                    className="rounded-md bg-brand-navy px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60">
                    {busy ? 'Setting…' : 'Set today as benchmark'}
                  </button>
                )}
              </div>
            </div>

            {!data.progress ? (
              <p className="mt-2 text-xs text-slate-500">
                No benchmark set yet. Tap <strong>Set today as benchmark</strong> to freeze the current list as your
                baseline — then this report tracks how many move off vs. get added.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                <div className="text-[11px] text-slate-400">Benchmark set {benchDate}</div>
                <ProgressRow label="Company total" zone={null} p={data.progress.total} bold />
                {data.progress.zones.map((z) => (
                  <ProgressRow key={z.zone} label={teamLabel(z.zone) || z.zone} zone={z.zone} p={z} />
                ))}
                <div className="pt-1 text-[11px] text-slate-400">
                  <span className="font-semibold">Started</span> = no-sits frozen at benchmark ·{' '}
                  <span className="font-semibold text-emerald-600">Converted</span> = flipped back to an appointment ·{' '}
                  <span className="font-semibold">Still</span> = still a no-sit ·{' '}
                  <span className="font-semibold text-[#b8324f]">Added</span> = new no-sits since ·{' '}
                  <span className="font-semibold">Now</span> = on the list right now
                </div>
              </div>
            )}
          </div>

          {/* ── The list (zone -> rep -> deal) ── */}
          {data.zones.length === 0 ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
              ✅ No no-sits to re-book right now — every team is clear.
            </div>
          ) : (
            data.zones.map((z) => {
              const zoneOpen = openZone === z.zone
              return (
                <div key={z.zone} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                  <button
                    type="button"
                    onClick={() => { setOpenZone(zoneOpen ? null : z.zone); setOpenRep(null) }}
                    className="flex w-full items-center justify-between gap-3 p-3 text-left"
                    style={{ background: (ZONE_COLORS[z.zone]?.light) || '#f8fafc' }}
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-bold" style={{ color: (ZONE_COLORS[z.zone]?.deep) || '#0f172a' }}>
                        {teamLabel(z.zone) || z.zone}
                      </span>
                      <span className="text-xs text-slate-500">{z.zone}</span>
                    </span>
                    <span className="text-sm text-slate-700">
                      <span className="font-bold text-[#475569]">{z.count}</span> no-sit{z.count === 1 ? '' : 's'} {zoneOpen ? '▾' : '▸'}
                    </span>
                  </button>

                  {zoneOpen && (
                    <div className="space-y-2 border-t border-slate-100 p-3">
                      {z.reps.map((r) => {
                        const key = `${z.zone}|${r.rep}`
                        const repOpen = openRep === key
                        return (
                          <div key={key} className="rounded-lg border border-slate-200">
                            <button
                              type="button"
                              onClick={() => setOpenRep(repOpen ? null : key)}
                              className="flex w-full items-center justify-between p-3 text-left"
                            >
                              <span className="font-semibold text-slate-800">{r.rep}</span>
                              <span className="text-sm text-slate-600">
                                <span className="font-bold text-amber-600">{r.count}</span> no-sit{r.count === 1 ? '' : 's'} {repOpen ? '▾' : '▸'}
                              </span>
                            </button>
                            {repOpen && (
                              <div className="space-y-2 border-t border-slate-100 p-3">
                                {r.deals.map((dl, i) => (
                                  <div key={i} className="rounded bg-slate-50 p-2">
                                    <div className="text-sm font-bold text-slate-900">{dl.customer}</div>
                                    <div className="text-[11px] text-slate-500">{dl.address}</div>
                                    <div className="text-xs text-slate-600">🗓 Appt was for: {dl.appt_label}</div>
                                    {dl.scheduled_label && <div className="text-xs text-slate-600">📅 Scheduled: {dl.scheduled_label}</div>}
                                    {dl.status && <div className="text-[11px] text-slate-400">{dl.status}</div>}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}
    </section>
  )
}

// One row of the progress report: Started / Moved off / Added / Now.
function ProgressRow({ label, zone, p, bold }) {
  const color = zone && ZONE_COLORS[zone] ? ZONE_COLORS[zone].deep : '#0f172a'
  return (
    <div className={`flex items-center justify-between gap-2 rounded-md px-2.5 py-2 ${bold ? 'bg-slate-100' : 'bg-slate-50'}`}>
      <span className={`min-w-0 truncate ${bold ? 'text-sm font-bold' : 'text-sm font-semibold'}`} style={{ color: bold ? '#0f172a' : color }}>
        {label}
      </span>
      <span className="flex shrink-0 items-center gap-2 text-xs">
        <Stat n={p.started} l="started" />
        <Stat n={p.converted} l="converted" tone="emerald" />
        <Stat n={p.still} l="still" />
        <Stat n={p.added} l="added" tone="rose" />
        <Stat n={p.now} l="now" tone="slate-strong" />
      </span>
    </div>
  )
}

function Stat({ n, l, tone }) {
  const toneCls =
    tone === 'emerald' ? 'text-emerald-600' :
    tone === 'rose' ? 'text-[#b8324f]' :
    tone === 'slate-strong' ? 'text-slate-900' : 'text-slate-700'
  return (
    <span className="inline-flex flex-col items-center leading-tight">
      <span className={`font-bold ${toneCls}`}>{n}</span>
      <span className="text-[9px] uppercase tracking-wide text-slate-400">{l}</span>
    </span>
  )
}

// Top reference block — the "every tool we're building for them" catalog,
// independent of any one manager.
function ToolsetReference() {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        What every manager gets
      </h2>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {TOOLS.map((t) => (
          <div key={t.name} className="flex gap-3 rounded-md bg-slate-50 p-3">
            <span className="text-2xl leading-none" aria-hidden="true">
              {t.icon}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-800">{t.name}</span>
                {t.soon ? (
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                    Coming soon
                  </span>
                ) : t.field ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                    Needs URL
                  </span>
                ) : (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                    Always on
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-slate-600">{t.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function ManagerCard({ m }) {
  const colors = ZONE_COLORS[m.managed_region] || { deep: '#64748b', light: '#f1f5f9' }
  const dashUrl = `${window.location.origin}/regional-manager/${m.manager_access_token}`

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-base font-bold text-slate-900">
            {m.first_name} {m.last_name}
          </div>
          <div className="text-xs text-slate-500">{m.phone || 'No phone on file'}</div>
        </div>
        <span
          className="rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide"
          style={{ background: colors.light, color: colors.deep }}
        >
          {teamLabel(m.managed_region)}
        </span>
      </div>

      {/* Private dashboard link — the "where do I go again?" answer. */}
      <div className="mt-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Private dashboard link
        </div>
        {m.manager_access_token ? (
          <>
            <div className="mt-1 break-all rounded-md bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">
              {dashUrl}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <a
                href={dashUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md bg-brand-navy px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
              >
                Open ↗
              </a>
              <CopyButton value={dashUrl} label="Copy link" />
            </div>
            <div className="mt-1.5 text-[11px] text-slate-400">
              {m.manager_link_sent_at
                ? `Texted to them ${new Date(m.manager_link_sent_at).toLocaleDateString()}`
                : 'Not yet texted to them'}{' '}
              · treat like a password
            </div>
          </>
        ) : (
          <div className="mt-1 text-xs text-amber-700">
            No access token — re-assign this manager on Active sales reps to generate one.
          </div>
        )}
      </div>

      {/* Per-tool setup status for the three configurable tools. */}
      <div className="mt-4 grid grid-cols-1 gap-1.5">
        {CONFIG_TOOLS.map((t) => {
          const val = m[t.field]
          const set = !!(val && String(val).trim())
          return (
            <div key={t.field} className="flex items-center gap-2 text-xs">
              <span aria-hidden="true">{t.icon}</span>
              <span className="font-medium text-slate-700">{t.name}</span>
              {set ? (
                <span className="ml-auto font-semibold text-emerald-600">Set ✓</span>
              ) : (
                <span className="ml-auto font-semibold text-amber-600">Missing</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CopyButton({ value, label = 'Copy' }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          /* clipboard blocked — no-op */
        }
      }}
      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
    >
      {copied ? 'Copied!' : label}
    </button>
  )
}
