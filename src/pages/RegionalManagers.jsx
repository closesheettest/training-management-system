import { useEffect, useState, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { teamLabel, ZONE_COLORS } from '../lib/zones.js'
import ManagerPayReport from '../components/ManagerPayReport.jsx'

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

      <div className="mb-4"><ManagerPayReport admin /></div>

      <ResultsFollowups />

      <AllDealsToFix />

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

// "Inspection done — go back to review results." When a rep signs a free
// inspection they ask the homeowner the best day/time to come back and go over
// the results (review_availability). Once inspected, this lists every deal the
// rep still needs to go back on, by zone → rep, with that day/time. Drops off
// once the rep has gone back and handled it. (CCG all-results-followups.)
function ResultsFollowups() {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null)
  const [openZone, setOpenZone] = useState(null)
  const [openRep, setOpenRep] = useState(null)
  const [err, setErr] = useState('')
  const load = async () => {
    setLoading(true); setErr('')
    try {
      const res = await fetch(LB_ORIGIN + 'all-results-followups')
      const d = await res.json()
      if (d && d.ok) { setData(d); setOpenZone(null); setOpenRep(null) }
      else setErr(d?.error || 'Could not load.')
    } catch { setErr('Network error.') }
    setLoading(false)
  }
  const BADGE = { damage: ['Damage', 'bg-rose-100 text-rose-700'], no_damage: ['No Damage', 'bg-emerald-100 text-emerald-700'], retail: ['Retail', 'bg-amber-100 text-amber-700'] }
  const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) } catch { return '' } }
  return (
    <section className="mb-6">
      <button type="button" onClick={load} disabled={loading}
        className="w-full rounded-lg bg-[#0e7490] px-4 py-3 text-left font-semibold text-white shadow hover:opacity-95 disabled:opacity-60">
        🔁 Go back to review results{data ? ` (${data.total})` : ''}
        <div className="text-xs font-normal opacity-90">
          {loading ? 'Loading…' : `Inspected deals whose homeowner picked a best day/time to go over results — the rep hasn't gone back yet. By zone → rep. Tap to ${data ? 'refresh' : 'load'}.`}
        </div>
      </button>
      {err && <div className="mt-2 text-xs text-red-600">{err}</div>}
      {data && (
        <div className="mt-3 space-y-3">
          {data.zones.length === 0 ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">✅ No pending result-review visits right now.</div>
          ) : data.zones.map((z) => {
            const zoneOpen = openZone === z.zone
            return (
              <div key={z.zone} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <button type="button" onClick={() => { setOpenZone(zoneOpen ? null : z.zone); setOpenRep(null) }}
                  className="flex w-full items-center justify-between gap-3 p-3 text-left"
                  style={{ background: (ZONE_COLORS[z.zone]?.light) || '#f8fafc' }}>
                  <span className="flex items-center gap-2">
                    <span className="font-bold" style={{ color: (ZONE_COLORS[z.zone]?.deep) || '#0f172a' }}>{teamLabel(z.zone) || z.zone}</span>
                    <span className="text-xs text-slate-500">{z.zone}</span>
                  </span>
                  <span className="text-sm text-slate-700"><span className="font-bold text-[#0e7490]">{z.count}</span> to visit {zoneOpen ? '▾' : '▸'}</span>
                </button>
                {zoneOpen && (
                  <div className="space-y-2 border-t border-slate-100 p-3">
                    {z.reps.map((r) => {
                      const key = `${z.zone}|${r.rep}`
                      const repOpen = openRep === key
                      return (
                        <div key={key} className="rounded-lg border border-slate-200">
                          <button type="button" onClick={() => setOpenRep(repOpen ? null : key)}
                            className="flex w-full items-center justify-between p-3 text-left">
                            <span className="font-semibold text-slate-800">{r.rep}</span>
                            <span className="text-sm text-slate-600"><span className="font-bold text-[#0e7490]">{r.deals.length}</span> to visit {repOpen ? '▾' : '▸'}</span>
                          </button>
                          {repOpen && (
                            <div className="space-y-2 border-t border-slate-100 p-3">
                              {r.deals.map((dl, i) => {
                                const [label, cls] = BADGE[dl.result] || [dl.result, 'bg-slate-100 text-slate-700']
                                return (
                                  <div key={i} className="rounded bg-slate-50 p-2.5">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="font-semibold text-slate-800">{dl.homeowner}</span>
                                      <span className={'rounded px-1.5 py-0.5 text-[10px] font-bold ' + cls}>{label}</span>
                                    </div>
                                    <div className="mt-1 text-sm font-bold text-[#0e7490]">🗓 Go over results: {dl.review_availability}</div>
                                    {dl.address && <div className="text-xs text-slate-500">📍 {dl.address}</div>}
                                    <div className="text-[11px] text-slate-400">Inspected {fmtDate(dl.inspected_at)}{dl.mobile ? ` · 📞 ${dl.mobile}` : ''}</div>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
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

// Company-wide "No-sits to re-book" — every team's no-sit backlog (JN jobs
// the homeowner didn't sit), grouped by region -> rep -> deal, PLUS a
// progress report. The office freezes "today's numbers" as a benchmark with
// one tap, then sees per team + company-wide how many they started with,
// how many moved off the list (re-booked), and how many were added since.
// Backed by the CCG all-no-sits function.
// Company-wide Appointments → Sales conversion, grouped zone → rep, with
// Radiant Barrier / Insulation attach rates. Period toggle (week/last/month).
// Drill-down: one row per DEAL (merging a deal that both had its appointment
// AND closed this period, so it doesn't look double-counted).
function mergeDeals(details) {
  const byDeal = new Map()
  for (const d of (details || [])) {
    const k = (d.customer || '') + '|' + (d.address || '')
    const e = byDeal.get(k) || { customer: d.customer, address: d.address, cat: d.cat, status: d.status, source: d.source, result: d.result, location: d.location, apptDate: d.apptDate, sold: d.sold, start: d.start, pitch: d.pitch, roofrStatus: d.roofrStatus, rb: d.rb, ins: d.ins, fromAssigned: d.fromAssigned, isReset: d.isReset, jnids: new Set(), appt: false, sale: false, amt: 0 }
    e.apptDate = d.apptDate || e.apptDate; e.sold = d.sold || e.sold; e.start = d.start || e.start; e.pitch = d.pitch || e.pitch; e.roofrStatus = d.roofrStatus || e.roofrStatus; e.rb = e.rb || d.rb; e.ins = e.ins || d.ins; e.source = d.source || e.source; e.result = d.result || e.result; e.location = (d.location != null ? d.location : e.location); e.fromAssigned = e.fromAssigned || d.fromAssigned; e.isReset = e.isReset || d.isReset
    if (d.jnid) e.jnids.add(d.jnid)
    if (d.kind === 'sale') { e.sale = true; e.amt = d.amt || 0; e.status = d.status; e.cat = d.cat }
    else { e.appt = true; if (!e.sale) { e.status = d.status; e.cat = d.cat } }
    byDeal.set(k, e)
  }
  const arr = [...byDeal.values()]
  arr.forEach((e) => { e.dupCount = e.jnids.size })   // >1 distinct JN job on same contact = duplicates to merge
  return arr.sort((a, b) => (a.sale === b.sale ? 0 : a.sale ? -1 : 1))
}
// JN data-hygiene checks behind the ⚠ flag (per merged deal).
const fixWeekStart = (s) => { const x = new Date(s); if (isNaN(x)) return null; x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.getTime() }  // Monday of that week
const fixStartBad = (e) => { if (!e.sale) return false; if (!e.apptDate) return false; if (!e.start) return true; if (e.isReset) return false; const a = fixWeekStart(e.apptDate), s = fixWeekStart(e.start); return a == null || s == null ? false : a !== s }  // Start Date only matters for SOLD deals (JN buckets sold by Start Date = Sold week). A sit/no-sale's date_start is meaningless, so never flag it. Then: blank start, or a DIFFERENT week than the sold week — but a RESET legitimately sits later, so don't flag those
const fixApptPast = (e) => { if (!e.apptDate) return false; const d = new Date(e.apptDate); if (isNaN(d)) return false; const t = new Date(); t.setHours(0, 0, 0, 0); return d < t }
const fixNotStatused = (e) => fixApptPast(e) && ['appointment scheduled', 'reset appointment'].includes(String(e.status || '').toLowerCase().trim())
// A Damage / No-Damage inspection that SOLD is almost certainly a retail roof
// sale still parked in the Insurance location (we don't auto-move those). Flag it
// so the rep moves the JN location to Retail — then it counts as BTR, not Co.
// ...unless the JN location is ALREADY Retail (1) — then it's been moved and is fine.
// (location 1 = Retail, 3 = Insurance; null/unset still flags so it gets set.)
const fixNeedsRetailLoc = (e) => !!(e.sale && (e.result === 'damage' || e.result === 'no_damage') && e.location !== 1)
const fixReasonsFor = (e) => [e.fromAssigned && 'no Sales Rep set (only Assigned)', fixStartBad(e) && (e.start ? 'Start date in a different week than the appt' : 'no Start date'), fixNotStatused(e) && 'appointment past but never statused', fixNeedsRetailLoc(e) && 'sold a Damage/No-Damage deal — if retail, change the JN location to Retail', e.dupCount > 1 && (e.dupCount + ' jobs on this contact — merge in JN')].filter(Boolean)
function repFixCount(details) { return mergeDeals(details).filter((e) => fixReasonsFor(e).length).length }
function ApptDetail({ details }) {
  const list = mergeDeals(details)
  if (!list.length) return <div className="text-[11px] text-slate-400">No detail for this period.</div>
  const c = (kind, cat) => list.filter((e) => e[kind] && e.cat === cat).length
  const nFix = list.filter((e) => fixReasonsFor(e).length).length
  const TH = 'px-2 py-1 text-left font-semibold text-[9px] uppercase tracking-wide text-slate-400'
  const TD = 'px-2 py-1 align-top whitespace-nowrap'
  return (
    <div className="space-y-1">
      <div className="text-[10px] text-slate-500">
        <b>Appts</b> H{c('appt', 'harv')} · C{c('appt', 'comp')} · B{c('appt', 'btr')} = {list.filter((e) => e.appt).length}
        &nbsp;&nbsp;|&nbsp;&nbsp;<b>Sales</b> H{c('sale', 'harv')} · C{c('sale', 'comp')} · B{c('sale', 'btr')} = {list.filter((e) => e.sale).length}
        {nFix > 0 && <span className="ml-1 font-semibold text-amber-600">· ⚠ {nFix} need fixing in JN</span>}
      </div>
      <div className="overflow-x-auto rounded border border-slate-200">
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="bg-slate-100">
              <th className={TH}>Type</th><th className={TH}>Bkt</th><th className={TH}>Customer</th><th className={TH}>Address</th>
              <th className={TH}>Source</th><th className={TH}>Status</th><th className={TH}>Appt</th><th className={TH}>Sold</th>
              <th className={TH}>Start</th><th className={TH + ' text-right'}>$</th><th className={TH}>Pitch</th>
              <th className={TH}>RB</th><th className={TH}>Insul</th><th className={TH}>Fix</th>
            </tr>
          </thead>
          <tbody>
            {list.map((e, i) => {
              const reasons = fixReasonsFor(e)
              return (
                <tr key={i} className={'border-t border-slate-100 ' + (reasons.length ? 'bg-amber-100' : '')}>
                  <td className={TD}>{e.appt && <span className="mr-1 rounded bg-slate-200 px-1 font-bold text-slate-600">APPT</span>}{e.sale && <span className="rounded bg-emerald-100 px-1 font-bold text-emerald-700">SALE</span>}</td>
                  <td className={TD + ' text-slate-500'}>{e.cat === 'comp' ? 'CO' : (e.cat || '').toUpperCase()}</td>
                  <td className={TD + ' font-medium text-slate-700'}>{e.customer}{e.dupCount > 1 && <span title="More than one JN job on this contact — merge them in JobNimbus" className="ml-1 rounded bg-red-100 px-1 text-[9px] font-bold text-red-700">{e.dupCount} jobs</span>}</td>
                  <td className="px-2 py-1 align-top text-slate-500">{e.address || '—'}</td>
                  <td className={TD + ' text-slate-500'}>{e.source || '—'}</td>
                  <td className={TD + (fixNotStatused(e) ? ' bg-red-100 font-semibold text-red-700' : ' text-slate-500')}>{e.status || '—'}</td>
                  <td className={TD + ' text-slate-500'}>{e.apptDate || '—'}</td>
                  <td className={TD + ' text-slate-500'}>{e.sale ? (e.sold || '—') : ''}</td>
                  <td className={TD + (fixStartBad(e) ? ' bg-red-100 font-semibold text-red-700' : ' text-slate-500')}>{e.start || '—'}</td>
                  <td className={TD + ' text-right font-medium text-slate-700'}>{e.sale ? '$' + (e.amt || 0).toLocaleString() : ''}</td>
                  <td className={TD}>{e.sale ? (e.pitch ? <span className="font-semibold text-slate-700">{e.pitch}</span> : (e.roofrStatus === 'no_pdf' ? <span className="font-semibold text-amber-600">NO ROOFR</span> : '—')) : ''}</td>
                  <td className={TD + ' text-center'}>{e.sale && e.rb ? <span className="font-bold text-sky-600">✓</span> : ''}</td>
                  <td className={TD + ' text-center'}>{e.sale && e.ins ? <span className="font-bold text-violet-600">✓</span> : ''}</td>
                  <td className={TD} title={reasons.join('; ')}>{reasons.length ? <span className="font-bold text-amber-600">⚠</span> : ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AllApptConversion() {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null)
  const [openZone, setOpenZone] = useState(null)
  const [openRep, setOpenRep] = useState(null)   // `${zone}|${rep}` — drill-down detail
  const [period, setPeriod] = useState('month')
  const [err, setErr] = useState('')

  const load = async (p = period) => {
    setLoading(true); setErr('')
    // This report pulls a lot from JobNimbus (~5-6s) so the first hit can time
    // out — auto-retry a couple times before showing an error.
    let lastErr = ''
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(LB_ORIGIN + 'all-appt-conversion?period=' + p)
        const d = await res.json()
        if (d && d.ok) { setData(d); setOpenZone(null); setLoading(false); return }
        lastErr = d?.error || 'Could not load.'
      } catch { lastErr = 'Network error.' }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1500))
    }
    setErr(lastErr); setLoading(false)
  }
  const setP = (p) => { setPeriod(p); if (data) load(p) }
  const periods = [['week', 'This week'], ['lastweek', 'Last week'], ['month', 'This month']]

  // Spreadsheet-friendly CSV of the whole report: every rep across all zones,
  // each zone total, then the company total. Amounts/percents as plain numbers.
  const downloadCsv = () => {
    if (!data) return
    const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
    const cols = ['Zone', 'Rep', 'Level', 'Harv Apt', 'Harv Sold', 'Co Apt', 'Co Sold', 'BTR Apt', 'BTR Sold', 'Total Apt', 'Sold', 'Harv $', 'Co $', 'BTR $', '$ Sold', 'Harv %', 'Co %', 'BTR %', 'Tot %', 'Avg $/Sale', 'RB', 'RB %', 'Insul', 'Insul %']
    const repRow = (zone, r) => [zone, r.rep, r.level || '', r.harvAp, r.harvSl, r.compAp, r.compSl, r.btrAp, r.btrSl, r.appts, r.sales, r.harvAmt, r.compAmt, r.btrAmt, r.amt, r.harvPct, r.compPct, r.btrPct, r.pct, r.avg, r.rb, r.rb_pct, r.ins, r.ins_pct]
    const totRow = (label, t) => [label, '', '', t.harvAp, t.harvSl, t.compAp, t.compSl, t.btrAp, t.btrSl, t.appts, t.sales, t.harvAmt, t.compAmt, t.btrAmt, t.amt, t.harvPct, t.compPct, t.btrPct, t.pct, t.avg, t.rb, t.rb_pct, t.ins, t.ins_pct]
    const rows = [cols]
    for (const z of data.zones) {
      for (const r of z.reps) rows.push(repRow(z.zone, r))
      rows.push(totRow(z.zone + ' TOTAL', z.totals))
    }
    rows.push(totRow('COMPANY TOTAL', data.totals))
    // Per-deal DETAIL — every appointment + sale behind the totals.
    const cat3 = (c) => c === 'comp' ? 'CO' : (c || '').toUpperCase()
    const detailRow = (z, rep, d) => [z, rep, d.kind === 'sale' ? 'SALE' : 'APPT', cat3(d.cat), d.customer || '', d.address || '', d.source || '', d.status || '', d.apptDate || '', d.sold || '', d.start || '', d.kind === 'sale' ? (d.amt || 0) : '', d.pitch || '', d.rb ? 'Y' : '', d.ins ? 'Y' : '']
    rows.push([])
    rows.push(['DETAIL — every appointment & sale behind the totals'])
    rows.push(['Zone', 'Rep', 'Type', 'Bucket', 'Customer', 'Address', 'Source', 'Status', 'Appt', 'Sold', 'Start', '$', 'Pitch', 'RB', 'Insul'])
    for (const z of data.zones) for (const r of z.reps) for (const d of (r.details || [])) rows.push(detailRow(z.zone, r.rep, d))
    const csv = rows.map((row) => row.map(esc).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url; a.download = `appt-to-sales-${data.period}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  // Pop the whole report into a borderless full-width window so the wide table
  // is readable without scrolling left/right on a tablet/desktop. Renders the
  // already-loaded `data` as a self-contained HTML doc (green bands preserved).
  const openExpanded = () => {
    if (!data) return
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    const money = (n) => '$' + (Math.round(Number(n) || 0)).toLocaleString()
    const pc = (apt, v) => apt ? v + '%' : '—'
    const HEAD = ['Rep', 'Harv Apt', 'Harv Sold', 'Co Apt', 'Co Sold', 'BTR Apt', 'BTR Sold', 'Total Apt', 'Sold', 'Harv $', 'Co $', 'BTR $', '$ Sold', 'Harv %', 'Co %', 'BTR %', 'Tot %', 'Avg $/Sale', 'RB', 'Insul']
    const greenSold = new Set([2, 4, 6, 8]), greenMoney = new Set([9, 10, 11, 12])
    const colgroup = '<colgroup>' + HEAD.map((_, i) => `<col${greenSold.has(i) ? ' class="g"' : greenMoney.has(i) ? ' class="g2"' : ''}/>`).join('') + '</colgroup>'
    const headRow = '<tr>' + HEAD.map((h, i) => `<th${i === 0 ? ' class="l"' : ''}>${esc(h)}</th>`).join('') + '</tr>'
    const cells = (r) => [
      esc(r.rep) + (r.level ? ` <span class="lvl">${esc(r.level)}</span>` : ''),
      r.harvAp, `<span class="s">${r.harvSl}</span>`, r.compAp, `<span class="s">${r.compSl}</span>`, r.btrAp, `<span class="s">${r.btrSl}</span>`, `<b>${r.appts}</b>`, `<span class="s"><b>${r.sales}</b></span>`,
      money(r.harvAmt), money(r.compAmt), money(r.btrAmt), `<b>${money(r.amt)}</b>`,
      pc(r.harvAp, r.harvPct), pc(r.compAp, r.compPct), pc(r.btrAp, r.btrPct), `<b>${pc(r.appts, r.pct)}</b>`,
      money(r.avg), `${r.rb} (${r.rb_pct}%)`, `${r.ins} (${r.ins_pct}%)`,
    ]
    const rowHtml = (r, cls = '') => `<tr class="${cls}">` + cells(r).map((c, i) => `<td${i === 0 ? ' class="l"' : ''}>${c}</td>`).join('') + '</tr>'
    const zoneBlock = (label, summary, bodyRows, co = false) =>
      `<div class="zone"><div class="zhdr${co ? ' co' : ''}"><span>${esc(label)}</span><span>${summary}</span></div>` +
      `<table>${colgroup}<thead>${headRow}</thead><tbody>${bodyRows}</tbody></table></div>`
    const sumLine = (t) => `Appts ${t.appts} · Sold ${t.sales} · ${t.pct}% · $ Sold ${money(t.amt)} · Avg ${money(t.avg)}`
    // Per-rep DETAIL — collapsible <details> with every appt & sale, mirroring the
    // on-screen drill-down (same merge + flag logic, red problem cells, ⚠ reasons).
    const DHEAD = ['Type', 'Bkt', 'Customer', 'Address', 'Source', 'Status', 'Appt', 'Sold', 'Start', '$', 'Pitch', 'RB', 'Insul', 'Fix']
    const dHead = '<tr>' + DHEAD.map((h) => `<th>${h}</th>`).join('') + '</tr>'
    const RED = 'background:#fee2e2;color:#b91c1c;font-weight:700'
    const detailRow = (e) => {
      const rs = fixReasonsFor(e)
      return `<tr${rs.length ? ' style="background:#fef9c3"' : ''}>`
        + `<td>${e.appt ? '<b>APPT</b>' : ''}${e.sale ? ' <b style="color:#047857">SALE</b>' : ''}</td>`
        + `<td>${e.cat === 'comp' ? 'CO' : esc((e.cat || '').toUpperCase())}</td>`
        + `<td>${esc(e.customer || '')}${e.dupCount > 1 ? ` <b style="color:#b91c1c">(${e.dupCount} jobs)</b>` : ''}</td>`
        + `<td>${esc(e.address || '')}</td><td>${esc(e.source || '')}</td>`
        + `<td${fixNotStatused(e) ? ` style="${RED}"` : ''}>${esc(e.status || '')}</td>`
        + `<td>${esc(e.apptDate || '')}</td><td>${e.sale ? esc(e.sold || '') : ''}</td>`
        + `<td${fixStartBad(e) ? ` style="${RED}"` : ''}>${esc(e.start || '—')}</td>`
        + `<td class="r">${e.sale ? money(e.amt) : ''}</td>`
        + `<td>${e.sale ? esc(e.pitch || '') : ''}</td><td>${e.sale && e.rb ? '✓' : ''}</td><td>${e.sale && e.ins ? '✓' : ''}</td>`
        + `<td class="fix" title="${esc(rs.join('; '))}">${rs.length ? '⚠ ' + esc(rs.join('; ')) : ''}</td></tr>`
    }
    const repDetail = (rep) => {
      const ld = mergeDeals(rep.details || [])
      if (!ld.length) return ''
      const nf = ld.filter((e) => fixReasonsFor(e).length).length
      return `<details class="det"><summary>${esc(rep.rep)} — ${rep.appts} appt · ${rep.sales} sold${nf ? ` · <span class="warn">⚠ ${nf} to fix</span>` : ''}</summary>`
        + `<div class="dwrap"><table class="dtl"><thead>${dHead}</thead><tbody>${ld.map(detailRow).join('')}</tbody></table></div></details>`
    }
    const zonesHtml = data.zones.map((z) =>
      zoneBlock(z.zone, sumLine(z.totals), z.reps.map((r) => rowHtml(r)).join('') + rowHtml({ ...z.totals, rep: 'Zone total', level: '' }, 'tot'))
      + `<div class="dets">${z.reps.map(repDetail).join('')}</div>`
    ).join('')
    const companyHtml = zoneBlock('🏢 Company total', sumLine(data.totals), rowHtml({ ...data.totals, rep: 'Company total', level: '' }, 'tot'), true)
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Appointments → Sales (${esc(data.period)})</title>
<style>
*{box-sizing:border-box}html,body{margin:0;padding:0}
body{padding:10px 12px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#0f172a;background:#fff}
h1{font-size:15px;margin:0 0 10px}
.zone{margin:0 0 16px}
.zhdr{display:flex;justify-content:space-between;align-items:center;gap:8px;background:#fee2e2;color:#b91c1c;font-weight:800;font-size:11px;padding:5px 8px;border-radius:6px 6px 0 0}
.zhdr.co{background:#312e81;color:#fff}
.zhdr span:last-child{font-weight:600;font-size:10px;opacity:.92}
table{width:100%;border-collapse:collapse;font-size:11px}
th,td{padding:3px 5px;text-align:right;border-bottom:1px solid #f1f5f9}
th{background:#f8fafc;color:#64748b;text-transform:uppercase;font-size:8.5px;letter-spacing:.03em;white-space:normal;vertical-align:bottom}
td{white-space:nowrap}
th.l,td.l{text-align:left}
col.g{background:#ecfdf5}col.g2{background:#d1fae5}
tr.tot td{font-weight:800;border-top:2px solid #cbd5e1;background:#f8fafc}
.s{color:#047857}.lvl{font-size:8px;background:#e2e8f0;color:#475569;border-radius:3px;padding:0 3px;font-weight:700}
.dets{margin:6px 0 0}
.det{margin:0 0 5px;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden}
.det>summary{cursor:pointer;list-style:none;padding:5px 8px;font-size:11px;font-weight:700;background:#f8fafc}
.det>summary::-webkit-details-marker{display:none}
.det>summary::before{content:'▸ ';color:#94a3b8}
.det[open]>summary::before{content:'▾ '}
.warn{color:#b45309}
.dwrap{overflow-x:auto}
.dtl{font-size:10px}
.dtl th{background:#fff;color:#94a3b8}
.dtl th,.dtl td{text-align:left;white-space:nowrap;padding:2px 5px;border-bottom:1px solid #f4f4f5}
.dtl td.r{text-align:right}
.dtl td.fix{white-space:normal;min-width:150px;color:#b45309}
.dtl tbody tr:hover{background:#f8fafc}
@media print{.zone{break-inside:avoid}.det{break-inside:avoid}}
</style></head>
<body><h1>📈 Appointments → Sales — ${esc(data.period)} <span style="font-weight:400;font-size:11px;color:#64748b">— click a rep below each zone for deal detail</span></h1>${zonesHtml}${companyHtml}</body></html>`
    const w = window.open('', '_blank')
    if (!w) { alert('Pop-up blocked — allow pop-ups for this site to open the expanded report.'); return }
    w.document.open(); w.document.write(html); w.document.close()
  }

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
        <div className="mt-2 flex items-center gap-1">
          {periods.map(([k, label]) => (
            <button key={k} type="button" onClick={() => setP(k)}
              className={'rounded-md px-2 py-1 text-[11px] font-semibold ' + (period === k ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-700')}>{label}</button>
          ))}
          <button type="button" onClick={openExpanded}
            className="ml-auto rounded-md bg-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-300">⛶ Expand</button>
          <button type="button" onClick={downloadCsv}
            className="rounded-md bg-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-300">⬇ CSV</button>
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
                      {/* Soft column bands: green = sold counts, blue = dollars,
                          so the eye finds outcomes vs plain appointments fast. */}
                      <colgroup>
                        <col />{/* Rep */}
                        <col />{/* Harv Apt */}
                        <col className="bg-emerald-50" />{/* Harv Sold */}
                        <col />{/* Co Apt */}
                        <col className="bg-emerald-50" />{/* Co Sold */}
                        <col />{/* BTR Apt */}
                        <col className="bg-emerald-50" />{/* BTR Sold */}
                        <col />{/* Total Apt */}
                        <col className="bg-emerald-50" />{/* Sold */}
                        <col className="bg-emerald-100" />{/* Harv $ */}
                        <col className="bg-emerald-100" />{/* Co $ */}
                        <col className="bg-emerald-100" />{/* BTR $ */}
                        <col className="bg-emerald-100" />{/* $ Sold */}
                        <col />{/* Harv % */}
                        <col />{/* Co % */}
                        <col />{/* BTR % */}
                        <col />{/* Tot % */}
                        <col />{/* Avg $/Sale */}
                        <col />{/* RB */}
                        <col />{/* Insul */}
                      </colgroup>
                      <thead>
                        <tr className="border-t border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                          <th className="px-3 py-1.5 text-left">Rep</th>
                          <th className="px-2 py-1.5 text-right">Harv Apt</th>
                          <th className="px-2 py-1.5 text-right">Harv Sold</th>
                          <th className="px-2 py-1.5 text-right">Co Apt</th>
                          <th className="px-2 py-1.5 text-right">Co Sold</th>
                          <th className="px-2 py-1.5 text-right">BTR Apt</th>
                          <th className="px-2 py-1.5 text-right">BTR Sold</th>
                          <th className="px-2 py-1.5 text-right">Total Apt</th>
                          <th className="px-2 py-1.5 text-right">Sold</th>
                          <th className="px-2 py-1.5 text-right">Harv $</th>
                          <th className="px-2 py-1.5 text-right">Co $</th>
                          <th className="px-2 py-1.5 text-right">BTR $</th>
                          <th className="px-2 py-1.5 text-right">$ Sold</th>
                          <th className="px-2 py-1.5 text-right">Harv %</th>
                          <th className="px-2 py-1.5 text-right">Co %</th>
                          <th className="px-2 py-1.5 text-right">BTR %</th>
                          <th className="px-2 py-1.5 text-right">Tot %</th>
                          <th className="px-2 py-1.5 text-right">Avg $/Sale</th>
                          <th className="px-2 py-1.5 text-right">RB</th>
                          <th className="px-2 py-1.5 text-right">Insul</th>
                        </tr>
                      </thead>
                      <tbody>
                        {z.reps.map((r) => {
                          const rk = z.zone + '|' + r.rep
                          const open = openRep === rk
                          return (
                          <Fragment key={rk}>
                          <tr className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => setOpenRep(open ? null : rk)}>
                            <td className="px-3 py-1.5"><span className="text-slate-400">{open ? '▾' : '▸'}</span> {r.rep}{r.level && <span className="ml-1.5 rounded bg-slate-200 px-1 py-0.5 text-[9px] font-bold text-slate-600">{r.level}</span>}{(() => { const n = repFixCount(r.details); return n > 0 ? <span title={n + ' deal(s) need fixing in JN'} className="ml-1.5 font-bold text-amber-600">⚠ {n}</span> : null })()}</td>
                            <td className="px-2 py-1.5 text-right text-slate-600">{r.harvAp}</td>
                            <td className="px-2 py-1.5 text-right text-emerald-700">{r.harvSl}</td>
                            <td className="px-2 py-1.5 text-right text-slate-600">{r.compAp}</td>
                            <td className="px-2 py-1.5 text-right text-emerald-700">{r.compSl}</td>
                            <td className="px-2 py-1.5 text-right text-slate-600">{r.btrAp}</td>
                            <td className="px-2 py-1.5 text-right text-emerald-700">{r.btrSl}</td>
                            <td className="px-2 py-1.5 text-right font-semibold">{r.appts}</td>
                            <td className="px-2 py-1.5 text-right font-semibold text-emerald-700">{r.sales}</td>
                            <td className="px-2 py-1.5 text-right text-slate-600">${(r.harvAmt || 0).toLocaleString()}</td>
                            <td className="px-2 py-1.5 text-right text-slate-600">${(r.compAmt || 0).toLocaleString()}</td>
                            <td className="px-2 py-1.5 text-right text-slate-600">${(r.btrAmt || 0).toLocaleString()}</td>
                            <td className="px-2 py-1.5 text-right font-semibold">${(r.amt || 0).toLocaleString()}</td>
                            <td className="px-2 py-1.5 text-right text-slate-500">{r.harvAp ? r.harvPct + '%' : '—'}</td>
                            <td className="px-2 py-1.5 text-right text-slate-500">{r.compAp ? r.compPct + '%' : '—'}</td>
                            <td className="px-2 py-1.5 text-right text-slate-500">{r.btrAp ? r.btrPct + '%' : '—'}</td>
                            <td className="px-2 py-1.5 text-right font-bold text-indigo-700">{r.appts ? r.pct + '%' : '—'}</td>
                            <td className="px-2 py-1.5 text-right">${(r.avg || 0).toLocaleString()}</td>
                            <td className="px-2 py-1.5 text-right text-slate-600">{r.rb}<span className="text-[10px] text-slate-400"> ({r.rb_pct}%)</span></td>
                            <td className="px-2 py-1.5 text-right text-slate-600">{r.ins}<span className="text-[10px] text-slate-400"> ({r.ins_pct}%)</span></td>
                          </tr>
                          {open && (
                            <tr><td colSpan={20} className="bg-slate-50 px-4 py-2">
                              <ApptDetail details={r.details} />
                            </td></tr>
                          )}
                          </Fragment>
                          )
                        })}
                        <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
                          <td className="px-3 py-1.5">Zone total</td>
                          <td className="px-2 py-1.5 text-right">{zt.harvAp}</td>
                          <td className="px-2 py-1.5 text-right text-emerald-700">{zt.harvSl}</td>
                          <td className="px-2 py-1.5 text-right">{zt.compAp}</td>
                          <td className="px-2 py-1.5 text-right text-emerald-700">{zt.compSl}</td>
                          <td className="px-2 py-1.5 text-right">{zt.btrAp}</td>
                          <td className="px-2 py-1.5 text-right text-emerald-700">{zt.btrSl}</td>
                          <td className="px-2 py-1.5 text-right">{zt.appts}</td>
                          <td className="px-2 py-1.5 text-right font-semibold text-emerald-700">{zt.sales}</td>
                          <td className="px-2 py-1.5 text-right">${(zt.harvAmt || 0).toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right">${(zt.compAmt || 0).toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right">${(zt.btrAmt || 0).toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right">${(zt.amt || 0).toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right">{zt.harvAp ? zt.harvPct + '%' : '—'}</td>
                          <td className="px-2 py-1.5 text-right">{zt.compAp ? zt.compPct + '%' : '—'}</td>
                          <td className="px-2 py-1.5 text-right">{zt.btrAp ? zt.btrPct + '%' : '—'}</td>
                          <td className="px-2 py-1.5 text-right text-indigo-700">{zt.appts ? zt.pct + '%' : '—'}</td>
                          <td className="px-2 py-1.5 text-right">${(zt.avg || 0).toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right">{zt.rb}<span className="text-[10px] text-slate-400"> ({zt.rb_pct}%)</span></td>
                          <td className="px-2 py-1.5 text-right">{zt.ins}<span className="text-[10px] text-slate-400"> ({zt.ins_pct}%)</span></td>
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
              <div className="mb-2 text-sm font-extrabold uppercase tracking-wide">🏢 Company total</div>
              <div className="grid gap-1 text-sm">
                {/* Per-bucket: every column header (Apt · Sold · % · $) for Harv, Co, BTR */}
                {[['Harv', 'harvAp', 'harvSl', 'harvPct', 'harvAmt'], ['Co', 'compAp', 'compSl', 'compPct', 'compAmt'], ['BTR', 'btrAp', 'btrSl', 'btrPct', 'btrAmt']].map(([lbl, ap, sl, pc, amt]) => (
                  <div key={lbl} className="flex flex-wrap items-center gap-x-4 gap-y-0.5">
                    <span className="w-12 font-bold">{lbl}</span>
                    <span><span className="text-[10px] uppercase opacity-70">Apt</span> <b>{data.totals[ap]}</b></span>
                    <span><span className="text-[10px] uppercase opacity-70">Sold</span> <b>{data.totals[sl]}</b></span>
                    <span><span className="text-[10px] uppercase opacity-70">%</span> <b>{data.totals[pc]}%</b></span>
                    <span><span className="text-[10px] uppercase opacity-70">$</span> <b>${(data.totals[amt] || 0).toLocaleString()}</b></span>
                  </div>
                ))}
                {/* Totals row: Total Apt · Sold · Tot % · $ Sold · Avg · RB · Insul */}
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 border-t border-white/15 pt-1.5">
                  <span className="w-12 font-extrabold">TOTAL</span>
                  <span><span className="text-[10px] uppercase opacity-70">Apt</span> <b>{data.totals.appts}</b></span>
                  <span><span className="text-[10px] uppercase opacity-70">Sold</span> <b>{data.totals.sales}</b></span>
                  <span className="text-base font-extrabold">{data.totals.pct}%</span>
                  <span><span className="text-[10px] uppercase opacity-70">$ Sold</span> <b>${(data.totals.amt || 0).toLocaleString()}</b></span>
                  <span><span className="text-[10px] uppercase opacity-70">Avg/Sale</span> <b>${(data.totals.avg || 0).toLocaleString()}</b></span>
                  <span><span className="text-[10px] uppercase opacity-70">RB</span> <b>{data.totals.rb}</b> <span className="text-[11px] opacity-70">({data.totals.rb_pct}%)</span></span>
                  <span><span className="text-[10px] uppercase opacity-70">Insul</span> <b>{data.totals.ins}</b> <span className="text-[11px] opacity-70">({data.totals.ins_pct}%)</span></span>
                </div>
              </div>
            </div>
          )}
          <div className="text-[11px] text-slate-500">Appts counted in the week they happen (free-inspection signings excluded); Sales in the week they close. Each category shows appointments then sales (count). Buckets: Harv = harvested (Sales Rep Harvested = Yes) · Co = company lead (IQ / AI Bot / FB…) · BTR = back-to-retail (from an inspection). Each %  = that bucket's sales ÷ appts (can top 100% when a prior-week appt closes this week). Avg $/Sale = approved estimate ÷ sales.</div>
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
