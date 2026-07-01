import { useCallback, useEffect, useMemo, useState, Fragment } from 'react'
import { useParams } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Popup, Tooltip } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { teamLabel, ZONE_COLORS } from '../lib/zones.js'
import ManagerPayReport from '../components/ManagerPayReport.jsx'

// Public regional-manager page — the ONLY thing the regional sales
// manager sees. No navigation, no admin chrome, no menus. They get a
// link in a text and land here. From here they can:
//   1. See the active field reps in their region (with contact info
//      AND home address so the manager knows where they live).
//   2. See a Leaflet map of their team — pins for each geocoded rep,
//      hover for name + address.
//   3. Mark someone as departed (fired / quit) — that flips
//      is_active_sales_rep off and stamps left_company_at so the
//      regular admin cleanup workflow can take it from there.
//
// Texting/emailing reps from this dashboard was removed — messaging the
// team is handled elsewhere, not from the manager view.
//
// All actions go through /.netlify/functions/regional-manager-api
// which gates every request by the token in the URL. The manager can't
// reach reps outside their own region — that's enforced server-side.
//
// Route: /regional-manager/:token (registered in App.jsx, gated route
// excluded — public).

const LEVEL_LABEL = {
  junior: 'Junior',
  senior: 'Senior',
  non_field: 'Non-field',
}

// Centroids for each Zone — used to drop a sensible map center if all
// reps in the zone are missing lat/lng (rare but worth handling). Same
// values seeded by the 2026-05-31-zones.sql migration so admin doesn't
// see a Florida-wide pan when the zone has zero geocoded reps yet.
const ZONE_CENTERS = {
  'Zone 1': [29.6516, -82.3248],
  'Zone 2': [28.0395, -81.9498],
  'Zone 3': [27.3364, -82.5307],
  'Zone 4': [26.1224, -80.1373],
}

// Build a small leaflet pin colored to match the rep-map's "active"
// status. SVG via divIcon so we don't have to ship raster assets.
const REP_PIN = L.divIcon({
  html: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="24" height="32">
      <path d="M16 0C8.27 0 2 6.27 2 14c0 9.5 14 18 14 18s14-8.5 14-18c0-7.73-6.27-14-14-14z" fill="#10b981" stroke="white" stroke-width="2"/>
      <circle cx="16" cy="13" r="5" fill="white"/>
    </svg>
  `.trim(),
  className: '',
  iconSize: [24, 32],
  iconAnchor: [12, 32],
  popupAnchor: [0, -28],
})

// Colored teardrop pins for the Assign-Appointments map: RED = senior sales
// reps, BLUE = appointments that still need assigning.
const mkPin = (fill) => L.divIcon({
  html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="24" height="32"><path d="M16 0C8.27 0 2 6.27 2 14c0 9.5 14 18 14 18s14-8.5 14-18c0-7.73-6.27-14-14-14z" fill="${fill}" stroke="white" stroke-width="2"/><circle cx="16" cy="13" r="5" fill="white"/></svg>`,
  className: '', iconSize: [24, 32], iconAnchor: [12, 32], popupAnchor: [0, -28],
})
const RED_PIN = mkPin('#dc2626')
const BLUE_PIN = mkPin('#2563eb')

// Best-effort client-side geocode (OpenStreetMap Nominatim — no key). Used to
// pin appointment addresses on the Assign map. Returns [lat,lng] or null.
async function geocodeAddress(address) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(address)}`, { headers: { Accept: 'application/json' } })
    const j = await r.json()
    if (Array.isArray(j) && j[0]) return [parseFloat(j[0].lat), parseFloat(j[0].lon)]
  } catch { /* skip */ }
  return null
}

// Single-line address joiner — skips empty parts so a partial address
// (just street, no zip) doesn't render with awkward "—, —, —" gaps.
function fmtAddress(t) {
  return [
    t.street_address,
    t.city,
    [t.state, t.zip].filter(Boolean).join(' '),
  ]
    .filter((s) => s && String(s).trim())
    .join(', ')
}

export default function RegionalManager() {
  const { token } = useParams()
  // null while loading; { manager, reps } when loaded; { error } on bad
  // token / network failure. Lets the render branch on a single value.
  const [state, setState] = useState({ status: 'loading' })

  const reload = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const res = await fetch('/.netlify/functions/regional-manager-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'whoami', token }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setState({ status: 'error', error: data?.error || 'Could not load.' })
        return
      }
      setState({ status: 'ready', manager: data.manager, reps: data.reps })
    } catch (e) {
      setState({ status: 'error', error: e?.message || 'Network error.' })
    }
  }, [token])

  useEffect(() => {
    reload()
  }, [reload])

  if (state.status === 'loading') {
    return <ShellFrame><p>Loading your dashboard…</p></ShellFrame>
  }
  if (state.status === 'error') {
    return (
      <ShellFrame>
        <p className="text-red-200">{state.error}</p>
        <p className="mt-3 text-sm text-slate-200/70">
          If you got this link in a text and it's not working, ask the office to re-send it.
        </p>
      </ShellFrame>
    )
  }

  const { manager } = state
  // Roster sorted alphabetically by first name — easiest for a manager
  // scanning for someone by the name they actually call them.
  const reps = [...state.reps].sort((a, b) =>
    (a.first_name || '').localeCompare(b.first_name || '', undefined, { sensitivity: 'base' }),
  )
  return (
    <ShellFrame>
      <header className="mb-6">
        <div className="text-sm text-slate-200/70">Welcome —</div>
        <h1 className="mt-1 text-3xl font-semibold">
          {manager.first_name} {manager.last_name}
        </h1>
        <div className="mt-1 text-sm text-amber-200/90">
          You're managing the <strong>{teamLabel(manager.region)}</strong> region.
        </div>
      </header>

      <Leaderboard myZone={manager.region} />

      {/* Appointments → Sales — pinned just under the leaderboard, set apart. */}
      <div className="mb-5 mt-4 border-t border-slate-700/50 pt-4">
        <p className="mb-2 text-sm text-slate-200/85">📋 Tap the report below to <strong>break down each rep's appointment-to-sale conversion</strong> — it shows you exactly what needs fixing, if anything.</p>
        <ApptConversion zone={manager.region} />
      </div>

      <Group title="⭐ Today's work" defaultOpen>
        <AssignAppointments token={token} />
        <DealsToFix zone={manager.region} />
        <DamageNeedsRep zone={manager.region} />
      </Group>

      <Group title="📊 My team's numbers">
        <section className="mb-6">
          <h2 className="mb-2 text-lg font-semibold text-white">Managers Pay — all regions</h2>
          <p className="mb-2 text-xs text-slate-200/70">Last week's override pay for every region's manager (yours and the others). Read-only.</p>
          <ManagerPayReport />
        </section>
        <BackToRetailWins zone={manager.region} />
      </Group>

      <Group title="🎯 Leads to work">
        <ActiveLeads zone={manager.region} />
        <DamageRestore zone={manager.region} />
      </Group>

      <Group title="📋 Roster & tools">
        <WeeklyReport token={token} />
        <RepsTable token={token} reps={reps} onChanged={reload} />
        <ZoneMap reps={reps} zoneName={manager.region} token={token} />
        <WhatsAppGroups token={token} reps={reps} zone={manager.region} />
        <QuickActions manager={manager} />
      </Group>

      <footer className="mt-8 text-center text-xs text-slate-200/60">
        Need help? Reply to the text you got with this link.
      </footer>
    </ShellFrame>
  )
}

// Collapsible group — wraps a set of sections under one tappable header so the
// dashboard opens calm instead of a wall of cards. Daily group opens by default.
function Group({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="mb-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-lg bg-slate-800/70 px-4 py-3 text-left hover:bg-slate-800"
      >
        <span className="text-base font-bold text-white">{title}</span>
        <span className={`text-lg text-slate-300 transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  )
}

// ── Shell ──────────────────────────────────────────────────────────
// Wraps everything in a navy / gold themed page so the manager doesn't
// see the admin app's chrome. Self-contained styling — no shared layout.

function ShellFrame({ children }) {
  return (
    <div className="min-h-screen bg-[#0a1730] text-white">
      <div className="h-1 bg-[#b8324f]" />
      <div className="mx-auto max-w-3xl px-4 py-8 lg:max-w-7xl">{children}</div>
    </div>
  )
}

// ── Leaderboard ────────────────────────────────────────────────────
// Same team standings as the Sales Rep Dashboard (inspections + sales),
// fed by the CCG zone-leaderboard / zone-sales-leaderboard functions, with
// a This Week / This Month toggle. The manager's own zone is gold-outlined.
const LB_ORIGIN = 'https://free-roof-inspections.netlify.app/.netlify/functions/'

// Human date range from a report's { start, end } (end is exclusive — formats
// to the last included day in ET).
const fmtRange = (range) => {
  if (!range) return ''
  const f = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })
  return `${f(range.start)} – ${f(range.end)}`
}
const LB_ZONE_COLOR = { 'Zone 1': '#dc2626', 'Zone 2': '#2563eb', 'Zone 3': '#16a34a', 'Zone 4': '#ea580c' }
const LB_MEDALS = ['🥇', '🥈', '🥉', '']
function lbOrdinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]) }

// Appointments → Sales conversion per rep (this zone), with Radiant Barrier /
// Insulation attach rates. Appointments = JN jobs by appointment date; sales =
// those now in a sold status. Period toggle: this week / last week / month.
// Drill-down detail (dark theme) — one row per DEAL (a deal that both had its
// appointment AND closed this period is merged, so it doesn't look doubled).
function mergeDeals(details) {
  const byDeal = new Map()
  for (const d of (details || [])) {
    const k = (d.customer || '') + '|' + (d.address || '')
    const e = byDeal.get(k) || { customer: d.customer, address: d.address, cat: d.cat, status: d.status, source: d.source, result: d.result, apptDate: d.apptDate, sold: d.sold, start: d.start, pitch: d.pitch, roofrStatus: d.roofrStatus, rb: d.rb, ins: d.ins, fromAssigned: d.fromAssigned, isReset: d.isReset, jnids: new Set(), appt: false, sale: false, amt: 0 }
    e.apptDate = d.apptDate || e.apptDate; e.sold = d.sold || e.sold; e.start = d.start || e.start; e.pitch = d.pitch || e.pitch; e.roofrStatus = d.roofrStatus || e.roofrStatus; e.rb = e.rb || d.rb; e.ins = e.ins || d.ins; e.source = d.source || e.source; e.result = d.result || e.result; e.fromAssigned = e.fromAssigned || d.fromAssigned; e.isReset = e.isReset || d.isReset
    if (d.jnid) e.jnids.add(d.jnid)
    if (d.kind === 'sale') { e.sale = true; e.amt = d.amt || 0; e.status = d.status; e.cat = d.cat }
    else { e.appt = true; if (!e.sale) { e.status = d.status; e.cat = d.cat } }
    byDeal.set(k, e)
  }
  const arr = [...byDeal.values()]
  arr.forEach((e) => { e.dupCount = e.jnids.size })
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
const fixNeedsRetailLoc = (e) => !!(e.sale && (e.result === 'damage' || e.result === 'no_damage'))
// A back-to-retail deal (inspections.result = retail) still sitting at the
// "Sit Sold Insp" JN status never got re-statused after the revert — flag it.
const fixStuckSitSold = (e) => e.result === 'retail' && String(e.status || '').toLowerCase().trim() === 'sit sold insp'
// A back-to-retail deal IS a first retail appointment (not a reset), so its JN
// Start Date must be set = the appointment date — same as any retail sale. Flag
// a blank/mismatched Start Date on these even though they aren't "sold" yet.
const fixBtrNeedsStart = (e) => fixStuckSitSold(e) && !!e.apptDate && (!e.start || fixWeekStart(e.apptDate) !== fixWeekStart(e.start))
const fixReasonsFor = (e) => [e.fromAssigned && 'no Sales Rep set (only Assigned)', fixStartBad(e) && (e.start ? 'Start date in a different week than the appt' : 'no Start date'), fixBtrNeedsStart(e) && (e.start ? 'Start date must match the appointment date' : 'no Start date — set it to the appointment date'), fixNotStatused(e) && 'appointment past but never statused', fixStuckSitSold(e) && 'sent back to retail but still “Sit Sold Insp” — re-status it in JN', fixNeedsRetailLoc(e) && 'sold a Damage/No-Damage deal — if retail, change the JN location to Retail', e.dupCount > 1 && (e.dupCount + ' jobs on this contact — merge in JN')].filter(Boolean)
function repFixCount(details) { return mergeDeals(details).filter((e) => fixReasonsFor(e).length).length }
function ApptDetail({ details }) {
  const [openFix, setOpenFix] = useState(null) // row index whose fix-reasons are expanded (tap the ⚠ — works on iPad/touch)
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
                <Fragment key={i}>
                <tr className={'border-t border-slate-100 ' + (reasons.length ? 'bg-amber-100' : '')}>
                  <td className={TD}>{e.appt && <span className="mr-1 rounded bg-slate-200 px-1 font-bold text-slate-600">APPT</span>}{e.sale && <span className="rounded bg-emerald-100 px-1 font-bold text-emerald-700">SALE</span>}</td>
                  <td className={TD + ' text-slate-500'}>{e.cat === 'comp' ? 'CO' : (e.cat || '').toUpperCase()}</td>
                  <td className={TD + ' font-medium text-slate-700'}>{e.customer}{e.dupCount > 1 && <span title="More than one JN job on this contact — merge them in JobNimbus" className="ml-1 rounded bg-red-100 px-1 text-[9px] font-bold text-red-700">{e.dupCount} jobs</span>}</td>
                  <td className="px-2 py-1 align-top text-slate-500">{e.address || '—'}</td>
                  <td className={TD + ' text-slate-500'}>{e.source || '—'}</td>
                  <td className={TD + ((fixNotStatused(e) || fixStuckSitSold(e)) ? ' bg-red-100 font-semibold text-red-700' : ' text-slate-500')}>{e.status || '—'}</td>
                  <td className={TD + ' text-slate-500'}>{e.apptDate || '—'}</td>
                  <td className={TD + ' text-slate-500'}>{e.sale ? (e.sold || '—') : ''}</td>
                  <td className={TD + (fixStartBad(e) ? ' bg-red-100 font-semibold text-red-700' : ' text-slate-500')}>{e.start || '—'}</td>
                  <td className={TD + ' text-right font-medium text-slate-700'}>{e.sale ? '$' + (e.amt || 0).toLocaleString() : ''}</td>
                  <td className={TD}>{e.sale ? (e.pitch ? <span className="font-semibold text-slate-700">{e.pitch}</span> : (e.roofrStatus === 'no_pdf' ? <span className="font-semibold text-amber-600">NO ROOFR</span> : '—')) : ''}</td>
                  <td className={TD + ' text-center'}>{e.sale && e.rb ? <span className="font-bold text-sky-600">✓</span> : ''}</td>
                  <td className={TD + ' text-center'}>{e.sale && e.ins ? <span className="font-bold text-violet-600">✓</span> : ''}</td>
                  <td className={TD + ' text-center'} title={reasons.join('; ')}>{reasons.length ? <button type="button" onClick={() => setOpenFix(openFix === i ? null : i)} className="cursor-pointer text-base font-bold text-amber-600">⚠</button> : ''}</td>
                </tr>
                {openFix === i && reasons.length > 0 && (
                  <tr className="bg-amber-50">
                    <td colSpan={14} className="px-3 py-2">
                      <div className="flex items-center justify-between">
                        <div className="text-[11px] font-bold text-amber-700">Needs fixing in JobNimbus:</div>
                        <button type="button" onClick={() => setOpenFix(null)} className="text-[11px] font-bold text-slate-400">✕ close</button>
                      </div>
                      <ul className="mt-1 list-disc pl-5 text-[11.5px] leading-relaxed text-slate-700">
                        {reasons.map((r, ri) => <li key={ri}>{r}</li>)}
                      </ul>
                    </td>
                  </tr>
                )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Single-zone Appointments → Sales — renders with the EXACT same look as the
// company-wide admin report (AllApptConversion in RegionalManagers.jsx), just
// scoped to this manager's one zone via zone-appt-conversion (same data shape
// as one of the admin's zones[] entries).
function ApptConversion({ zone }) {
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)   // collapsed by default — click to open/close
  const [data, setData] = useState(null)
  const [openRep, setOpenRep] = useState(null)   // rep name — drill-down detail
  const [period, setPeriod] = useState('month')
  const [err, setErr] = useState('')

  const load = async (p = period) => {
    setLoading(true); setErr('')
    // Heavy JobNimbus pull (~5-6s) — auto-retry a couple times before erroring.
    let lastErr = ''
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(LB_ORIGIN + 'zone-appt-conversion?zone=' + encodeURIComponent(zone) + '&period=' + p)
        const d = await res.json()
        if (d && d.ok) { setData(d); setLoading(false); return }
        lastErr = d?.error || 'Could not load.'
      } catch { lastErr = 'Network error.' }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1500))
    }
    setErr(lastErr); setLoading(false)
  }
  const setP = (p) => { setPeriod(p); if (data) load(p) }
  const periods = [['week', 'This week'], ['lastweek', 'Last week'], ['month', 'This month'], ['lastmonth', 'Last month']]

  const downloadCsv = () => {
    if (!data) return
    const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
    const cols = ['Zone', 'Rep', 'Level', 'Harv Apt', 'Harv Sold', 'Co Apt', 'Co Sold', 'BTR Apt', 'BTR Sold', 'Total Apt', 'Sold', 'Harv $', 'Co $', 'BTR $', '$ Sold', 'Harv %', 'Co %', 'BTR %', 'Tot %', 'Avg $/Sale', 'RB', 'RB %', 'Insul', 'Insul %']
    const repRow = (z, r) => [z, r.rep, r.level || '', r.harvAp, r.harvSl, r.compAp, r.compSl, r.btrAp, r.btrSl, r.appts, r.sales, r.harvAmt, r.compAmt, r.btrAmt, r.amt, r.harvPct, r.compPct, r.btrPct, r.pct, r.avg, r.rb, r.rb_pct, r.ins, r.ins_pct]
    const totRow = (label, t) => [label, '', '', t.harvAp, t.harvSl, t.compAp, t.compSl, t.btrAp, t.btrSl, t.appts, t.sales, t.harvAmt, t.compAmt, t.btrAmt, t.amt, t.harvPct, t.compPct, t.btrPct, t.pct, t.avg, t.rb, t.rb_pct, t.ins, t.ins_pct]
    const rows = [cols]
    for (const r of data.reps) rows.push(repRow(data.zone, r))
    rows.push(totRow(data.zone + ' TOTAL', data.totals))
    // Per-deal DETAIL — every appointment + sale behind the totals.
    const cat3 = (c) => c === 'comp' ? 'CO' : (c || '').toUpperCase()
    const detailRow = (z, rep, d) => [z, rep, d.kind === 'sale' ? 'SALE' : 'APPT', cat3(d.cat), d.customer || '', d.address || '', d.source || '', d.status || '', d.apptDate || '', d.sold || '', d.start || '', d.kind === 'sale' ? (d.amt || 0) : '', d.pitch || '', d.rb ? 'Y' : '', d.ins ? 'Y' : '']
    rows.push([])
    rows.push(['DETAIL — every appointment & sale behind the totals'])
    rows.push(['Zone', 'Rep', 'Type', 'Bucket', 'Customer', 'Address', 'Source', 'Status', 'Appt', 'Sold', 'Start', '$', 'Pitch', 'RB', 'Insul'])
    for (const r of data.reps) for (const d of (r.details || [])) rows.push(detailRow(data.zone, r.rep, d))
    const csv = rows.map((row) => row.map(esc).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url; a.download = `appt-to-sales-${data.period}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  // Pop the report into a borderless full-width window so the wide table is
  // readable without scrolling left/right on tablet/desktop (single zone).
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
    const sumLine = (t) => `Appts ${t.appts} · Sold ${t.sales} · ${t.pct}% · $ Sold ${money(t.amt)} · Avg ${money(t.avg)}`
    // Per-rep DETAIL — collapsible <details> with every appt & sale (same merge +
    // flag logic as the on-screen drill-down, red problem cells, ⚠ reasons).
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
        + `<td${(fixNotStatused(e) || fixStuckSitSold(e)) ? ` style="${RED}"` : ''}>${esc(e.status || '')}</td>`
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
    const detailsHtml = `<div class="dets">${data.reps.map(repDetail).join('')}</div>`
    const body = data.reps.map((r) => rowHtml(r)).join('') + rowHtml({ ...data.totals, rep: 'Zone total', level: '' }, 'tot')
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Appointments → Sales — ${esc(data.zone)} (${esc(data.period)})</title>
<style>
*{box-sizing:border-box}html,body{margin:0;padding:0}
body{padding:10px 12px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#0f172a;background:#fff}
h1{font-size:15px;margin:0 0 10px}
.zone{margin:0 0 16px}
.zhdr{display:flex;justify-content:space-between;align-items:center;gap:8px;background:#fee2e2;color:#b91c1c;font-weight:800;font-size:11px;padding:5px 8px;border-radius:6px 6px 0 0}
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
<body><h1>📈 Appointments → Sales — ${esc(data.zone)} — ${esc(data.period)}</h1>
<div class="zone"><div class="zhdr"><span>${esc(data.zone)}</span><span>${sumLine(data.totals)}</span></div>
<table>${colgroup}<thead>${headRow}</thead><tbody>${body}</tbody></table></div>${detailsHtml}</body></html>`
    const w = window.open('', '_blank')
    if (!w) { alert('Pop-up blocked — allow pop-ups for this site to open the expanded report.'); return }
    w.document.open(); w.document.write(html); w.document.close()
  }

  const zt = data?.totals
  return (
    <section className="mb-6">
      <button type="button" onClick={() => { const n = !open; setOpen(n); if (n && !data) load() }} disabled={loading}
        className="w-full rounded-lg bg-indigo-700 px-4 py-3 text-left font-semibold text-white shadow hover:opacity-95 disabled:opacity-60">
        <span className="flex items-center justify-between gap-2">
          <span>📈 Appointments → Sales{data ? ` (${data.totals.pct}% · ${data.totals.sales}/${data.totals.appts})` : ''}</span>
          <span className="text-sm">{open ? '▲' : '▼'}</span>
        </span>
        <div className="text-xs font-normal opacity-90">
          {loading ? 'Loading…' : (open ? 'Tap to close' : `Per-rep conversion + Radiant Barrier / Insulation attach. Tap to ${data ? 'open' : 'load'}.`)}
        </div>
      </button>

      {open && data && (
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
      {open && data && <div className="mt-1 text-[11px] font-semibold text-slate-300">📅 {fmtRange(data.range)}</div>}
      {open && err && <div className="mt-2 text-xs text-red-600">{err}</div>}

      {open && data && (
        <div className="mt-3">
          {data.reps.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-600">No appointments in this period.</div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-800">
              <div className="flex w-full items-center justify-between gap-3 p-3 text-left"
                style={{ background: (ZONE_COLORS[data.zone]?.light) || '#f8fafc' }}>
                <span className="flex items-center gap-2">
                  <span className="font-bold" style={{ color: (ZONE_COLORS[data.zone]?.deep) || '#0f172a' }}>{teamLabel(data.zone) || data.zone}</span>
                  <span className="text-xs text-slate-500">{data.zone}</span>
                </span>
                <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-sm text-slate-700">
                  <span><span className="text-[10px] uppercase text-slate-400">Appts</span> <b>{zt.appts}</b></span>
                  <span><span className="text-[10px] uppercase text-slate-400">Sold</span> <b>{zt.sales}</b></span>
                  <span className="font-bold text-indigo-700">{zt.pct}%</span>
                  <span><span className="text-[10px] uppercase text-slate-400">Avg/Sale</span> <b>${(zt.avg || 0).toLocaleString()}</b></span>
                </span>
              </div>
              <div className="hidden overflow-x-auto lg:block">
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
                    {data.reps.map((r) => {
                      const open = openRep === r.rep
                      return (
                      <Fragment key={r.rep}>
                      <tr className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => setOpenRep(open ? null : r.rep)}>
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
                        <tr><td colSpan={20} className="bg-slate-50 px-4 py-2"><ApptDetail details={r.details} /></td></tr>
                      )}
                      </Fragment>
                      )
                    })}
                    {zt && (
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
                    )}
                  </tbody>
                </table>
              </div>
              {/* Mobile/tablet: stacked per-rep cards (the 20-col table only fits on a wide desktop). */}
              <div className="divide-y divide-slate-100 lg:hidden">
                {data.reps.map((r) => {
                  const open = openRep === r.rep
                  return (
                    <div key={r.rep} className="p-3">
                      <button type="button" onClick={() => setOpenRep(open ? null : r.rep)} className="flex w-full items-center justify-between gap-2 text-left">
                        <span className="font-semibold text-slate-800">{r.rep}{r.level && <span className="ml-1.5 rounded bg-slate-200 px-1 py-0.5 text-[9px] font-bold text-slate-600">{r.level}</span>}{(() => { const n = repFixCount(r.details); return n > 0 ? <span title={n + ' deal(s) need fixing in JN'} className="ml-1.5 font-bold text-amber-600">⚠ {n}</span> : null })()}</span>
                        <span className="text-slate-400">{open ? '▾' : '▸'}</span>
                      </button>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                        <div className="rounded bg-slate-50 py-1.5"><div className="text-[10px] uppercase text-slate-400">Appts</div><div className="font-bold">{r.appts}</div></div>
                        <div className="rounded bg-slate-50 py-1.5"><div className="text-[10px] uppercase text-slate-400">Sold</div><div className="font-bold text-emerald-700">{r.sales}</div></div>
                        <div className="rounded bg-slate-50 py-1.5"><div className="text-[10px] uppercase text-slate-400">Conv</div><div className="font-bold text-indigo-700">{r.appts ? r.pct + '%' : '—'}</div></div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
                        <span><b className="text-slate-800">${(r.amt || 0).toLocaleString()}</b> sold</span>
                        <span>Avg <b className="text-slate-800">${(r.avg || 0).toLocaleString()}</b></span>
                        <span>RB {r.rb} <span className="text-slate-400">({r.rb_pct}%)</span></span>
                        <span>Insul {r.ins} <span className="text-slate-400">({r.ins_pct}%)</span></span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-slate-500">
                        <span>Harv {r.harvAp} apt · <b className="text-emerald-700">{r.harvSl}</b> sold{r.harvAp ? ` · ${r.harvPct}%` : ''}</span>
                        <span>Co {r.compAp} apt · <b className="text-emerald-700">{r.compSl}</b> sold{r.compAp ? ` · ${r.compPct}%` : ''}</span>
                        <span>BTR {r.btrAp} apt · <b className="text-emerald-700">{r.btrSl}</b> sold{r.btrAp ? ` · ${r.btrPct}%` : ''}</span>
                      </div>
                      {open && <div className="mt-2"><ApptDetail details={r.details} /></div>}
                    </div>
                  )
                })}
                {zt && (
                  <div className="bg-slate-50 p-3">
                    <div className="flex items-center justify-between"><span className="font-bold text-slate-800">Zone total</span><span className="font-bold text-indigo-700">{zt.appts ? zt.pct + '%' : '—'}</span></div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
                      <span>Appts <b>{zt.appts}</b></span><span>Sold <b className="text-emerald-700">{zt.sales}</b></span>
                      <span><b>${(zt.amt || 0).toLocaleString()}</b> sold</span><span>Avg <b>${(zt.avg || 0).toLocaleString()}</b></span>
                      <span>RB {zt.rb} ({zt.rb_pct}%)</span><span>Insul {zt.ins} ({zt.ins_pct}%)</span>
                    </div>
                  </div>
                )}
              </div>
              <div className="px-3 py-2 text-[10px] text-slate-400">
                Appts counted in the week they happen (inspection signings excluded); sales in the week they close. Each category shows appointments then sales (count). Harv = harvested · Co = company lead (IQ/AI Bot/FB…) · BTR = back-to-retail (from an inspection). Each % = that bucket's sales ÷ appts. Avg $/Sale = approved estimate ÷ sales.
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function Leaderboard({ myZone }) {
  const [period, setPeriod] = useState('week')
  const [insp, setInsp] = useState(null)
  const [sales, setSales] = useState(null)
  const [openInsp, setOpenInsp] = useState(null)   // zone string | null
  const [openSales, setOpenSales] = useState(null)
  useEffect(() => {
    let cancelled = false
    setInsp(null); setSales(null); setOpenInsp(null); setOpenSales(null)
    fetch(LB_ORIGIN + 'zone-leaderboard?period=' + period).then((r) => r.ok ? r.json() : null)
      .then((d) => { if (!cancelled && d && d.ok) setInsp(d.zones) }).catch(() => {})
    fetch(LB_ORIGIN + 'zone-sales-leaderboard?period=' + period).then((r) => r.ok ? r.json() : null)
      .then((d) => { if (!cancelled && d && d.ok) setSales(d.zones) }).catch(() => {})
    return () => { cancelled = true }
  }, [period])

  const card = (z, i, kind, openZone, setOpen, rankByZone) => {
    const mine = z.zone === myZone
    const isOpen = openZone === z.zone
    // Tie-aware standing: teams level on count share the place ("Tied for
    // 1st") until one pulls ahead. Computed from counts so it's correct
    // even if two zones are level. Medal follows the real rank (both
    // leaders get 🥇). Zero-count teams just show the plain ordinal.
    const ri = (rankByZone && rankByZone[z.zone]) || { rank: z.rank, tied: false }
    const medal = LB_MEDALS[ri.rank - 1] || ''
    const placeLabel = (ri.tied && (z.count || 0) > 0) ? `Tied for ${lbOrdinal(ri.rank)}` : `${lbOrdinal(ri.rank)} Place`
    return (
      <button type="button" key={z.zone} onClick={() => setOpen(isOpen ? null : z.zone)}
        className="rounded-lg p-3 text-left text-white transition active:scale-[.98]"
        style={{ background: LB_ZONE_COLOR[z.zone] || '#334155', outline: mine ? '3px solid #f5b50a' : 'none' }}>
        <div className="text-[10px] font-bold uppercase tracking-wide opacity-90">{medal ? medal + ' ' : ''}{placeLabel}</div>
        <div className="text-base font-extrabold leading-tight">{z.team}</div>
        <div className="text-[10px] opacity-90">{z.zone}{mine ? ' · YOU' : ''}</div>
        <div className="mt-1 text-xs font-bold">
          <span className="text-lg font-extrabold">{z.count}</span> {kind === 'sales' ? 'sold' : 'signed'}
          {kind === 'sales' && z.total_amount ? <span className="opacity-90"> · ${z.total_amount.toLocaleString()}</span> : null}
        </div>
        <div className="mt-1 text-[10px] underline opacity-90">{isOpen ? '▾ Hide' : '▸ Details'}</div>
      </button>
    )
  }

  // Inspections detail: reps + their signed counts.
  const inspDetail = (z) => {
    const reps = z.reps || []
    if (!reps.length) return <div className="text-xs text-slate-300/70">No inspections logged yet.</div>
    return (
      <div className="divide-y divide-white/10">
        {reps.map((r) => (
          <div key={r.name} className="flex items-center justify-between py-1.5 text-sm">
            <span className="truncate">{r.name}</span>
            <span className="font-bold">{r.count}</span>
          </div>
        ))}
      </div>
    )
  }
  // Sales detail: group deals by rep (ranked by $), customers nested.
  const salesDetail = (z) => {
    const deals = z.deals || []
    if (!deals.length) return <div className="text-xs text-slate-300/70">No sales logged yet.</div>
    const byRep = {}, order = []
    deals.forEach((d) => {
      const k = d.rep || '—'
      if (!byRep[k]) { byRep[k] = { rep: k, total: 0, deals: [] }; order.push(k) }
      byRep[k].total += Number(d.amount) || 0
      byRep[k].deals.push(d)
    })
    const groups = order.map((k) => byRep[k]).sort((a, b) => b.total - a.total)
    return (
      <div className="space-y-2">
        {groups.map((g) => (
          <div key={g.rep}>
            <div className="flex items-center justify-between text-sm font-bold">
              <span className="truncate">{g.rep}</span>
              <span>${g.total.toLocaleString()}</span>
            </div>
            {g.deals.sort((a, b) => b.amount - a.amount).map((d, j) => (
              <div key={j} className="flex items-center justify-between pl-3 text-xs opacity-90">
                <span className="truncate">🏠 {d.customer}</span>
                <span>${(Number(d.amount) || 0).toLocaleString()}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    )
  }

  const board = (zones, kind, openZone, setOpen, detailFn) => {
    if (zones === null) return <div className="text-xs text-slate-300/70">Loading…</div>
    const openZ = zones.find((z) => z.zone === openZone)
    // Standard competition ranking by count (1,1,3,4 on a tie at the top).
    const rankByZone = {}
    zones.forEach((z) => {
      const c = z.count || 0
      const rank = 1 + zones.filter((o) => (o.count || 0) > c).length
      const tied = zones.filter((o) => (o.count || 0) === c).length > 1
      rankByZone[z.zone] = { rank, tied }
    })
    return (
      <>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{zones.map((z, i) => card(z, i, kind, openZone, setOpen, rankByZone))}</div>
        {openZ && (
          <div className="mt-2 rounded-lg border border-white/15 bg-white/5 p-3">
            <div className="mb-1 text-xs font-bold text-amber-200">{openZ.team} · {openZ.zone}</div>
            {detailFn(openZ)}
          </div>
        )}
      </>
    )
  }

  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-semibold">🏆 Team Standings</h2>
        <div className="flex overflow-hidden rounded-md border border-white/20 text-xs font-semibold">
          <button onClick={() => setPeriod('week')} className={'px-3 py-1 ' + (period === 'week' ? 'bg-amber-400 text-black' : 'text-slate-200')}>This Week</button>
          <button onClick={() => setPeriod('month')} className={'px-3 py-1 ' + (period === 'month' ? 'bg-amber-400 text-black' : 'text-slate-200')}>This Month</button>
        </div>
      </div>
      <div className="mb-1 text-xs font-semibold text-slate-200/70">🔍 Inspections signed — tap a team for reps</div>
      {board(insp, 'inspections', openInsp, setOpenInsp, inspDetail)}
      <div className="mb-1 mt-3 text-xs font-semibold text-slate-200/70">💰 Sales — tap a team for the deals</div>
      {board(sales, 'sales', openSales, setOpenSales, salesDetail)}
    </section>
  )
}

// ── Weekly Rep Report ──────────────────────────────────────────────
// The manager's Thursday-evening weekly write-up on each active rep. All
// numbers are typed by hand (signed / back-to-retail appts / total appts /
// sales), plus "did you ride with them?" + the manager's take, and a weekly
// summation. Save keeps a draft; Submit also emails + texts a summary to
// ownership. Past weeks are viewable below. Backed by weekly-report-api.
function WeeklyReport({ token }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [weekStart, setWeekStart] = useState('')
  const [rowsById, setRowsById] = useState({})   // rep_id → row
  const [order, setOrder] = useState([])         // rep_id[] in display order
  const [summary, setSummary] = useState('')
  const [status, setStatus] = useState('')       // '' | 'draft' | 'submitted'
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory] = useState(null)

  const api = async (action, extra = {}) => {
    const res = await fetch('/.netlify/functions/weekly-report-api', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, token, ...extra }),
    })
    const d = await res.json()
    if (!res.ok || !d.ok) throw new Error(d?.error || 'Request failed')
    return d
  }

  const load = async () => {
    setLoading(true); setErr(''); setMsg(null)
    try {
      const d = await api('init')
      setWeekStart(d.week_start)
      setStatus(d.report?.status || '')
      setSummary(d.report?.summary || '')
      // Merge active roster with any saved rows (saved values win; new reps
      // get blank rows; reps who left since saving just drop off).
      const saved = {}
      for (const r of (d.report?.rows || [])) if (r.rep_id) saved[String(r.rep_id)] = r
      const ord = [], map = {}
      for (const rep of (d.reps || [])) {
        const id = String(rep.id)
        const s = saved[id] || {}
        ord.push(id)
        map[id] = {
          rep_id: id, rep_name: rep.name,
          insp_signed: s.insp_signed ?? '', back_to_retail: s.back_to_retail ?? '',
          appts: s.appts ?? '', sales: s.sales ?? '',
          rode: !!s.rode, take: s.take || '',
        }
      }
      setOrder(ord); setRowsById(map)
    } catch (e) { setErr(e.message || 'Could not load.') }
    setLoading(false)
  }

  const openPanel = () => { setOpen(true); load() }
  const setField = (id, field, val) => setRowsById((m) => ({ ...m, [id]: { ...m[id], [field]: val } }))

  const submitOrSave = async (action) => {
    if (action === 'submit' && !window.confirm('Submit this week’s report? It will be saved and a summary emailed + texted to the office.')) return
    setSaving(true); setMsg(null)
    try {
      const rows = order.map((id) => rowsById[id])
      const d = await api(action, { week_start: weekStart, rows, summary })
      setStatus(d.status)
      setMsg({ ok: true, text: action === 'submit' ? '✓ Submitted — summary sent to the office.' : '✓ Draft saved.' })
    } catch (e) { setMsg({ ok: false, text: e.message || 'Failed to save.' }) }
    setSaving(false)
  }

  const loadHistory = async () => {
    setShowHistory(true)
    if (history) return
    try { const d = await api('history'); setHistory(d.reports || []) }
    catch { setHistory([]) }
  }

  const numInput = 'w-14 rounded bg-slate-800 text-white text-sm px-2 py-1 border border-white/15 text-center'

  if (!open) {
    return (
      <section className="mt-6">
        <button type="button" onClick={openPanel}
          className="w-full rounded-xl border border-amber-400/40 bg-amber-500/10 p-4 text-left transition active:scale-[.99]">
          <div className="flex items-center justify-between">
            <span className="text-lg font-semibold">📋 Weekly Rep Report</span>
            <span className="text-xs font-bold text-amber-200">Open ▸</span>
          </div>
          <div className="mt-1 text-xs text-slate-200/70">Fill out each rep's week — due Friday morning. Saved + summary sent to the office.</div>
        </button>
      </section>
    )
  }

  return (
    <section className="mt-6 rounded-xl border border-amber-400/40 bg-amber-500/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">📋 Weekly Rep Report</h2>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-200/70 underline">Close ▾</button>
      </div>

      {loading && <div className="text-sm text-slate-200/70">Loading…</div>}
      {err && <div className="text-sm text-red-300">{err}</div>}

      {!loading && !err && (
        <>
          <div className="mb-3 text-xs text-slate-200/80">
            Week of <strong>{weekStart}</strong> (Fri–Thu){status === 'submitted' ? ' · ✅ submitted (you can update and re-submit)' : status === 'draft' ? ' · draft saved' : ''}
          </div>

          {order.length === 0 && <div className="text-sm text-slate-200/70">No active reps in your zone.</div>}

          <div className="space-y-3">
            {order.map((id) => {
              const r = rowsById[id]
              return (
                <div key={id} className="rounded-lg border border-white/15 bg-black/20 p-3">
                  <div className="mb-2 font-bold">{r.rep_name}</div>
                  <div className="flex flex-wrap gap-3">
                    <label className="text-xs text-slate-200/80">Insp signed<br />
                      <input type="number" min="0" inputMode="numeric" value={r.insp_signed} onChange={(e) => setField(id, 'insp_signed', e.target.value)} className={numInput} /></label>
                    <label className="text-xs text-slate-200/80">Back-to-retail appts<br />
                      <input type="number" min="0" inputMode="numeric" value={r.back_to_retail} onChange={(e) => setField(id, 'back_to_retail', e.target.value)} className={numInput} /></label>
                    <label className="text-xs text-slate-200/80">Total appts<br />
                      <input type="number" min="0" inputMode="numeric" value={r.appts} onChange={(e) => setField(id, 'appts', e.target.value)} className={numInput} /></label>
                    <label className="text-xs text-slate-200/80">Sales<br />
                      <input type="number" min="0" inputMode="numeric" value={r.sales} onChange={(e) => setField(id, 'sales', e.target.value)} className={numInput} /></label>
                  </div>
                  <div className="mt-2">
                    <div className="text-sm">Did you ride with them this week?</div>
                    <div className="mt-1 inline-flex overflow-hidden rounded-md border border-white/20 text-sm font-semibold">
                      <button type="button" onClick={() => setField(id, 'rode', true)}
                        className={'px-4 py-1 ' + (r.rode ? 'bg-emerald-500 text-black' : 'text-slate-200')}>Yes</button>
                      <button type="button" onClick={() => setField(id, 'rode', false)}
                        className={'px-4 py-1 ' + (!r.rode ? 'bg-rose-500 text-black' : 'text-slate-200')}>No</button>
                    </div>
                    <textarea value={r.take} onChange={(e) => setField(id, 'take', e.target.value)} rows={2}
                      placeholder={r.rode ? "What was your takeaway? How'd they do, what to work on…" : "Notes on how you helped them or what they need to improve?"}
                      className="mt-2 w-full rounded bg-slate-800 text-white text-sm px-2 py-1 border border-white/15" />
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-3">
            <div className="mb-1 text-xs font-semibold text-slate-200/80">Weekly summation</div>
            <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3}
              placeholder="Overall: how was the week for the zone? Wins, concerns, plan for next week…"
              className="w-full rounded bg-slate-800 text-white text-sm px-2 py-1 border border-white/15" />
          </div>

          {msg && <div className={`mt-2 text-sm ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</div>}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => submitOrSave('save')} disabled={saving}
              className="rounded border border-white/25 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
              {saving ? 'Saving…' : 'Save draft'}
            </button>
            <button type="button" onClick={() => submitOrSave('submit')} disabled={saving || order.length === 0}
              className="rounded bg-amber-500 px-4 py-1.5 text-sm font-bold text-black disabled:opacity-50">
              {saving ? 'Sending…' : 'Submit & send'}
            </button>
            <button type="button" onClick={loadHistory} className="ml-auto text-xs text-slate-200/70 underline">Past reports</button>
          </div>

          {showHistory && (
            <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="mb-2 text-xs font-bold text-amber-200">Past weekly reports</div>
              {history === null ? <div className="text-xs text-slate-300/70">Loading…</div>
                : history.length === 0 ? <div className="text-xs text-slate-300/70">None yet.</div>
                  : <div className="space-y-1">
                      {history.map((h) => (
                        <div key={h.week_start} className="flex items-center justify-between text-xs">
                          <span>Week of {h.week_start}</span>
                          <span className="opacity-80">{(h.rows || []).length} reps · {h.status === 'submitted' ? '✅ submitted' : 'draft'}</span>
                        </div>
                      ))}
                    </div>}
            </div>
          )}
        </>
      )}
    </section>
  )
}

// ── Deals need to be fixed ─────────────────────────────────────────
// On-demand scan of the last 14 days of sales in THIS manager's zone
// (CCG zone-deals-to-fix, same checklist as the morning audit), grouped
// by rep. Tap a rep → every deal + exactly what's missing/wrong.
// Setter-booked appointments in this zone that landed on the manager with NO
// sales rep. Manager picks an Owner + a Sales Rep → writes both to the JN job.
// Proxied through regional-manager-api → CCG manager-records-api.
// Split-view map for Assign Appointments: RED = the manager's senior sales reps
// (home pins), BLUE = appointments that still need assigning (geocoded from
// their address). Helps the manager assign the nearest rep.
function AssignMap({ srReps, items, zoneName }) {
  const [coords, setCoords] = useState({})   // item.key -> [lat,lng]
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      for (const it of items) {
        if (!it.address || coords[it.key]) continue
        const c = await geocodeAddress(it.address)
        if (cancelled) return
        if (c) setCoords((p) => ({ ...p, [it.key]: c }))
        await new Promise((r) => setTimeout(r, 1100))   // Nominatim: ~1 req/sec
      }
    })()
    return () => { cancelled = true }
  }, [items]) // eslint-disable-line react-hooks/exhaustive-deps
  const repPts = srReps.filter((r) => typeof r.latitude === 'number' && typeof r.longitude === 'number')
  const apptPts = items.map((it) => ({ ...it, c: coords[it.key] })).filter((x) => x.c)
  const pts = [...repPts.map((r) => [r.latitude, r.longitude]), ...apptPts.map((x) => x.c)]
  let center = ZONE_CENTERS[zoneName] || [27.99, -81.76], zoom = 9
  if (pts.length) {
    const lats = pts.map((p) => p[0]), lngs = pts.map((p) => p[1])
    center = [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lngs) + Math.max(...lngs)) / 2]
    const span = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lngs) - Math.min(...lngs))
    zoom = span > 2 ? 7 : span > 1 ? 8 : span > 0.4 ? 9 : 10
  }
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-3 text-[11px] font-semibold text-slate-600">
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: '#dc2626' }} /> Senior reps ({repPts.length})</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: '#2563eb' }} /> Appts to assign ({apptPts.length}/{items.length})</span>
      </div>
      <div className="overflow-hidden rounded-md border border-slate-200" style={{ height: 460 }}>
        <MapContainer center={center} zoom={zoom} style={{ height: '100%', width: '100%' }} scrollWheelZoom={true}>
          <TileLayer attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {repPts.map((r) => (
            <Marker key={'r' + r.jobnimbus_id} position={[r.latitude, r.longitude]} icon={RED_PIN}>
              <Tooltip direction="top" offset={[0, -28]} opacity={1}>
                <div style={{ fontSize: 12.5, lineHeight: 1.35 }}>
                  <b>{r.name}</b> <span style={{ color: '#dc2626', fontWeight: 700 }}>· Senior rep</span>
                  {r.phone && <div style={{ color: '#475569' }}>{r.phone}</div>}
                  {fmtAddress(r) && <div style={{ color: '#475569' }}>{fmtAddress(r)}</div>}
                </div>
              </Tooltip>
            </Marker>
          ))}
          {apptPts.map((x) => (
            <Marker key={'a' + x.key} position={x.c} icon={BLUE_PIN}>
              <Tooltip direction="top" offset={[0, -28]} opacity={1}>
                <div style={{ fontSize: 12.5, lineHeight: 1.35 }}>
                  <b>{x.homeowner || 'Appointment'}</b> <span style={{ color: '#2563eb', fontWeight: 700 }}>· needs a rep</span>
                  <div style={{ color: '#475569' }}>{x.address}</div>
                </div>
              </Tooltip>
            </Marker>
          ))}
        </MapContainer>
      </div>
      {apptPts.length < items.length && <div className="mt-1 text-[10.5px] text-slate-400">{items.length - apptPts.length} appt(s) still geocoding or without a mappable address.</div>}
    </div>
  )
}

function AssignAppointments({ token }) {
  const [view, setView] = useState('needs') // 'needs' | 'today' | 'tomorrow'
  const [d, setD] = useState(null)
  const [sel, setSel] = useState({})
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [allReps, setAllReps] = useState([])
  useEffect(() => {
    fetch('/.netlify/functions/rep-zones?include_inactive=1').then((r) => r.json()).then((j) => setAllReps(j.reps || [])).catch(() => {})
  }, [])
  // The manager's SENIOR reps in this zone that have home coordinates → red pins.
  const srReps = useMemo(() => allReps.filter((r) => d && r.zone === d.zone && String(r.rep_level || '').toLowerCase() === 'senior' && typeof r.latitude === 'number' && typeof r.longitude === 'number'), [allReps, d])
  // Appointments still needing a rep (with an address to geocode) → blue pins.
  const needItems = useMemo(() => {
    // Backlog rows carry their address inside the JN job name (e.g. "123 Main St
    // - 12741"); strip the trailing job number + add FL so it geocodes.
    const clean = (s) => String(s || '').replace(/\s*-\s*\d+\s*$/, '').trim()
    const u = (d?.unassigned || []).map((a) => ({ key: 'need:' + a.id, homeowner: a.homeowner_name, address: a.address }))
    const b = (d?.backlog || d?.viviana || []).map((it) => ({ key: it.key, homeowner: it.homeowner, address: it.address || (clean(it.homeowner) ? clean(it.homeowner) + ', FL' : null) }))
    return [...u, ...b].filter((x) => x.address)
  }, [d])

  const load = useCallback(async (v) => {
    setLoading(true)
    try {
      const res = await fetch('/.netlify/functions/regional-manager-api', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list-appointments', token, view: v }),
      })
      const j = await res.json().catch(() => ({}))
      if (!j.ok) { setErr(j.error || 'Could not load.'); setLoading(false); return }
      setErr(''); setD(j)
    } catch { setErr('Network error.') }
    setLoading(false)
  }, [token])
  useEffect(() => { load(view) }, [load, view])

  const pick = (key, f, v) => setSel((p) => ({ ...p, [key]: { ...(p[key] || {}), [f]: v } }))

  // target: { key, appt_id?, jn_job_id?, curOwner?, curRep? }. Sends the chosen
  // (or unchanged current) owner + sales rep to JobNimbus.
  const submit = async (target) => {
    const s = sel[target.key] || {}
    const ownerId = s.owner != null ? s.owner : (target.curOwner || '')
    const repId = s.rep != null ? s.rep : (target.curRep || '')
    if (!ownerId || !repId) { alert('Pick both an Owner and a Sales Rep.'); return }
    const reps = (d && d.reps) || []
    const owner = reps.find((x) => x.jobnimbus_id === ownerId)
    const rep = reps.find((x) => x.jobnimbus_id === repId)
    const payload = { action: 'assign-appointment', token, owner_jn_id: ownerId, owner_name: owner ? owner.name : '', sales_rep_jn_id: repId, sales_rep_name: rep ? rep.name : '' }
    if (target.appt_id) payload.appt_id = target.appt_id
    else if (target.jn_job_id) payload.jn_job_id = target.jn_job_id
    else { alert('This row has no linked JobNimbus job.'); return }
    setBusy(target.key)
    try {
      const res = await fetch('/.netlify/functions/regional-manager-api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const j = await res.json().catch(() => ({}))
      if (!j.ok) { alert(j.error || 'Assign failed.'); setBusy(null); return }
      await load(view)
    } catch { alert('Network error.') }
    setBusy(null)
  }

  const reps = (d && d.reps) || []
  const fmt = (iso) => { try { return new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) } catch { return iso } }
  const timeOnly = (iso) => { try { return new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) } catch { return iso } }

  // Editable Owner + Sales Rep dropdowns (pre-filled with current) + Save.
  // item: { key, source, id, jn_job_id, owner_id, sales_rep_id }.
  const editRow = (item, saveLabel) => {
    const s = sel[item.key] || {}
    const ownerVal = s.owner != null ? s.owner : (item.owner_id || '')
    const repVal = s.rep != null ? s.rep : (item.sales_rep_id || '')
    const ready = ownerVal && repVal
    const target = { key: item.key, appt_id: item.source === 'app' ? item.id : null, jn_job_id: item.jn_job_id, curOwner: item.owner_id, curRep: item.sales_rep_id }
    return (
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-600">Assigned to (owner)
          <select value={ownerVal} onChange={(e) => pick(item.key, 'owner', e.target.value)} className="mt-0.5 block min-w-[140px] rounded border border-slate-300 px-2 py-1.5 text-sm">
            <option value="">Select…</option>
            {reps.map((r) => <option key={r.jobnimbus_id} value={r.jobnimbus_id}>{r.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-600">Sales Rep
          <select value={repVal} onChange={(e) => pick(item.key, 'rep', e.target.value)} className="mt-0.5 block min-w-[140px] rounded border border-slate-300 px-2 py-1.5 text-sm">
            <option value="">Select…</option>
            {reps.map((r) => <option key={r.jobnimbus_id} value={r.jobnimbus_id}>{r.name}</option>)}
          </select>
        </label>
        <button onClick={() => submit(target)} disabled={busy === item.key || !ready} className="ml-auto whitespace-nowrap rounded bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy === item.key ? 'Saving…' : (saveLabel || 'Save')}</button>
      </div>
    )
  }

  const Tab = ({ v, label }) => (
    <button onClick={() => setView(v)} className={`rounded-md px-3 py-1 text-xs font-bold ${view === v ? 'bg-brand-navy text-white' : 'bg-slate-100 text-slate-700'}`}>{label}</button>
  )

  return (
    <section className="mb-6">
      <div className="rounded-lg border-2 border-amber-400 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-amber-700">📅 Assign Appointments</h2>
            <p className="text-xs text-slate-500">Setter-booked + your team's JobNimbus appointments. Set or change the Owner + Sales Rep on any row — writes both to JobNimbus.</p>
          </div>
          <div className="flex gap-1.5">
            <Tab v="needs" label="Needs assignment" />
            <Tab v="today" label="Today" />
            <Tab v="tomorrow" label="Tomorrow" />
          </div>
        </div>
        {err && <div className="mt-2 text-sm text-red-600">{err}</div>}
        {loading && <div className="mt-3 text-sm text-slate-500">Loading…</div>}

        {!loading && view === 'needs' && d && (() => {
          const un = d.unassigned || []
          const viv = d.backlog || d.viviana || []
          if (un.length === 0 && viv.length === 0) return <div className="mt-3 text-sm text-emerald-700">No appointments waiting to be assigned. 🎉</div>
          return (
            <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-start">
              {/* Left half — the assignment list */}
              <div className="lg:w-1/2">
                {un.map((a) => (
                  <div key={a.id} className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
                    <div className="font-bold text-slate-800">{a.homeowner_name || 'Homeowner'}</div>
                    <div className="text-[13px] text-slate-600">📍 {a.address || '—'}</div>
                    <div className="text-[12.5px] font-bold text-amber-700">🕒 {fmt(a.appt_at)}{a.source ? ` · ${a.source}` : ''}</div>
                    {editRow({ key: 'need:' + a.id, source: 'app', id: a.id, jn_job_id: a.jn_job_id, owner_id: null, sales_rep_id: null }, 'Submit')}
                  </div>
                ))}
                {viv.length > 0 && (
                  <div className="mt-4">
                    <div className="mb-1 text-xs font-bold text-slate-600">🗂️ Need a rep — currently on Viviana / inactive reps ({viv.length})</div>
                    {viv.map((it) => (
                      <div key={it.key} className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
                        <div className="font-bold text-slate-800">{it.homeowner || 'Appointment'}</div>
                        <div className="text-[12.5px] font-bold text-amber-700">🕒 {fmt(it.appt_at)} · owned by {it.owner_name || 'Viviana'}</div>
                        {editRow(it, 'Assign')}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {/* Right half — map: RED senior reps · BLUE appointments to assign */}
              <div className="lg:w-1/2">
                <AssignMap srReps={srReps} items={needItems} zoneName={d.zone} />
              </div>
            </div>
          )
        })()}

        {!loading && (view === 'today' || view === 'tomorrow') && d && (() => {
          const items = d.items || []
          if (items.length === 0) return <div className="mt-3 text-sm text-slate-500">No appointments {view} for your team.</div>
          return <div className="mt-3">{items.map((it) => (
            <div key={it.key} className={`mt-2 rounded-lg border p-3 ${it.needs_assignment ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="font-bold text-slate-800">{it.homeowner || 'Appointment'}</div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${it.source === 'jn' ? 'bg-slate-200 text-slate-600' : 'bg-blue-100 text-blue-700'}`}>{it.source === 'jn' ? 'JobNimbus' : 'App'}</span>
              </div>
              {it.address && <div className="text-[13px] text-slate-600">📍 {it.address}</div>}
              <div className="text-[12.5px] font-bold text-amber-700">🕒 {timeOnly(it.appt_at)}</div>
              <div className="text-[12px] text-slate-600">Owner: <b>{it.owner_name || '—'}</b> · Sales Rep: <b>{it.sales_rep_name || (it.needs_assignment ? '⚠️ none' : '—')}</b></div>
              {editRow(it, 'Save')}
            </div>
          ))}</div>
        })()}
      </div>
    </section>
  )
}

// Damage deals in this zone whose rep isn't active (or has none) — they show for
// nobody until a manager assigns them to an active rep (then they land in that
// rep's Damage visit list + JobNimbus). Backed by CCG manager-damage-queue.
// Restore damage deals wrongly marked "BTR - NI" (Not Interested) back onto the
// rep's Damage-visit list — flips the JN status to "Sit Sold Insp" + clears the
// stale copy (manager-damage-queue btr_load / btr_restore). Sibling of DamageNeedsRep.
function DamageRestore({ zone }) {
  const [loading, setLoading] = useState(false)
  const [deals, setDeals] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [doneIds, setDoneIds] = useState({})

  const load = async () => {
    setLoading(true); setErr('')
    try {
      const res = await fetch(LB_ORIGIN + 'manager-damage-queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'btr_load', zone }) })
      const d = await res.json()
      if (!d.ok) { setErr(d.error || 'Could not load.'); setLoading(false); return }
      setDeals(d.deals || [])
    } catch { setErr('Network error.') }
    setLoading(false)
  }
  const restore = async (dl) => {
    setBusy(dl.inspection_id)
    try {
      const res = await fetch(LB_ORIGIN + 'manager-damage-queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'btr_restore', inspection_id: dl.inspection_id }) })
      const d = await res.json()
      if (!d.ok) { setErr(d.error || 'Restore failed.'); setBusy(''); return }
      setDoneIds((x) => ({ ...x, [dl.inspection_id]: true }))
    } catch { setErr('Network error.') }
    setBusy('')
  }
  const remaining = (deals || []).filter((d) => !doneIds[d.inspection_id])

  return (
    <section className="mb-6">
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-brand-navy">↩️ Restore to Damage list</h2>
            <p className="text-xs text-slate-500">Damage deals in your zone wrongly marked “BTR – NI” (Not Interested) — that removes them from the rep’s Damage visit list. Restore puts the JN status back to “Sit Sold Insp” and returns it to the list.</p>
          </div>
          <button onClick={load} disabled={loading} className="rounded-md bg-brand-navy px-3 py-1 text-xs font-bold text-white disabled:opacity-60">{loading ? 'Loading…' : deals ? 'Refresh' : 'Load'}</button>
        </div>
        {err && <div className="mt-2 text-sm text-red-600">{err}</div>}
        {deals && (
          <div className="mt-3">
            {remaining.length === 0 ? <div className="text-sm text-slate-500">No damage deals marked Not Interested. 🎉</div> : remaining.map((dl) => (
              <div key={dl.inspection_id} className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-3">
                <div>
                  <div className="font-bold text-slate-800">{dl.client_name}</div>
                  <div className="text-[13px] text-slate-600">📍 {[dl.address, dl.city].filter(Boolean).join(', ')}{dl.county ? ` · ${dl.county}` : ''}</div>
                  <div className="text-[12px] text-slate-400">rep: {dl.rep || 'none'}{dl.mobile ? ` · ${dl.mobile}` : ''}</div>
                </div>
                <button onClick={() => restore(dl)} disabled={busy === dl.inspection_id} className="whitespace-nowrap rounded bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50">{busy === dl.inspection_id ? '…' : 'Restore'}</button>
              </div>
            ))}
            {Object.keys(doneIds).length > 0 && (
              <div className="mt-3 text-xs font-semibold text-emerald-700">
                {Object.entries(doneIds).map(([id]) => {
                  const dl = (deals || []).find((x) => x.inspection_id === id)
                  return <div key={id}>✓ {dl?.client_name} restored to Damage list</div>
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function DamageNeedsRep({ zone }) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null)   // { deals, reps }
  const [err, setErr] = useState('')
  const [sel, setSel] = useState({})       // inspection_id -> rep_jobnimbus_id
  const [busy, setBusy] = useState('')
  const [doneIds, setDoneIds] = useState({})

  const load = async () => {
    setLoading(true); setErr('')
    try {
      const res = await fetch(LB_ORIGIN + 'manager-damage-queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'load', zone }) })
      const d = await res.json()
      if (!d.ok) { setErr(d.error || 'Could not load.'); setLoading(false); return }
      setData(d)
      const s = {}; for (const dl of d.deals) s[dl.inspection_id] = d.reps[0]?.jobnimbus_id || ''
      setSel(s)
    } catch { setErr('Network error.') }
    setLoading(false)
  }
  const assign = async (dl) => {
    const repId = sel[dl.inspection_id]; if (!repId) return
    const rep = data.reps.find((r) => r.jobnimbus_id === repId)
    setBusy(dl.inspection_id)
    try {
      const res = await fetch(LB_ORIGIN + 'manager-damage-queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'assign', inspection_id: dl.inspection_id, rep_jobnimbus_id: repId, rep_name: rep?.name || '' }) })
      const d = await res.json()
      if (!d.ok) { setErr(d.error || 'Assign failed.'); setBusy(''); return }
      setDoneIds((x) => ({ ...x, [dl.inspection_id]: rep?.name || 'rep' }))
    } catch { setErr('Network error.') }
    setBusy('')
  }
  const remaining = (data?.deals || []).filter((d) => !doneIds[d.inspection_id])

  return (
    <section className="mb-6">
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-brand-navy">🏚️ Damage deals needing a rep</h2>
            <p className="text-xs text-slate-500">Damage deals in your zone whose rep isn't active (or has none). Assign each to an active rep — it lands in their Damage visit list.</p>
          </div>
          <button onClick={load} disabled={loading} className="rounded-md bg-brand-navy px-3 py-1 text-xs font-bold text-white disabled:opacity-60">{loading ? 'Loading…' : data ? 'Refresh' : 'Load'}</button>
        </div>
        {err && <div className="mt-2 text-sm text-red-600">{err}</div>}
        {data && (
          <div className="mt-3">
            {remaining.length === 0 ? <div className="text-sm text-slate-500">No damage deals waiting for a rep. 🎉</div> : remaining.map((dl) => (
              <div key={dl.inspection_id} className="mt-2 rounded-lg border border-slate-200 p-3">
                <div className="font-bold text-slate-800">{dl.client_name}</div>
                <div className="text-[13px] text-slate-600">📍 {[dl.address, dl.city].filter(Boolean).join(', ')}{dl.county ? ` · ${dl.county}` : ''}</div>
                <div className="text-[12px] text-slate-400">was: {dl.current_rep || 'no rep'}{dl.mobile ? ` · ${dl.mobile}` : ' · no phone'}</div>
                <div className="mt-2 flex gap-2">
                  <select value={sel[dl.inspection_id] || ''} onChange={(e) => setSel((s) => ({ ...s, [dl.inspection_id]: e.target.value }))} className="flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm">
                    {(data.reps || []).map((r) => <option key={r.jobnimbus_id} value={r.jobnimbus_id}>{r.name}</option>)}
                    {(!data.reps || !data.reps.length) && <option value="">No active reps in zone</option>}
                  </select>
                  <button onClick={() => assign(dl)} disabled={busy === dl.inspection_id || !sel[dl.inspection_id]} className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50">{busy === dl.inspection_id ? '…' : 'Assign'}</button>
                </div>
              </div>
            ))}
            {Object.keys(doneIds).length > 0 && (
              <div className="mt-3 text-xs font-semibold text-emerald-700">
                {Object.entries(doneIds).map(([id, name]) => {
                  const dl = data.deals.find((x) => x.inspection_id === id)
                  return <div key={id}>✓ {dl?.client_name} → {name}</div>
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function DealsToFix({ zone }) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null)   // { reps, total_flagged } | null
  const [openRep, setOpenRep] = useState(null)
  const [err, setErr] = useState('')

  const load = async () => {
    setLoading(true); setErr('')
    try {
      const res = await fetch(LB_ORIGIN + 'zone-deals-to-fix?zone=' + encodeURIComponent(zone))
      const d = await res.json()
      if (d && d.ok) { setData(d); setOpenRep(null) }
      else setErr(d?.error || 'Could not load.')
    } catch { setErr('Network error.') }
    setLoading(false)
  }

  return (
    <section className="mt-6">
      <button type="button" onClick={load} disabled={loading}
        className="w-full rounded-lg bg-[#b8324f] px-4 py-3 text-left font-semibold text-white shadow disabled:opacity-60">
        🛠 Deals need to be fixed{data ? ` (${data.total_flagged})` : ''}
        <div className="text-xs font-normal opacity-90">
          {loading ? 'Checking JobNimbus…' : `Sales in your zone (since June 1) with missing/wrong info — stays until fixed. Tap to ${data ? 'refresh' : 'load'}`}
        </div>
      </button>
      {err && <div className="mt-2 text-xs text-red-300">{err}</div>}
      {data && (
        <div className="mt-2 space-y-2">
          {data.reps.length === 0 ? (
            <div className="rounded-lg border border-emerald-400/30 bg-emerald-50/5 p-3 text-sm text-emerald-200">✅ All clean — nothing to fix in the last 14 days.</div>
          ) : data.reps.map((r) => (
            <div key={r.rep} className="rounded-lg border border-white/15 bg-white/5">
              <button type="button" onClick={() => setOpenRep(openRep === r.rep ? null : r.rep)}
                className="flex w-full items-center justify-between p-3 text-left">
                <span className="font-semibold">{r.rep}</span>
                <span className="text-sm"><span className="font-bold text-amber-200">{r.count}</span> deal{r.count === 1 ? '' : 's'} {openRep === r.rep ? '▾' : '▸'}</span>
              </button>
              {openRep === r.rep && (
                <div className="space-y-2 border-t border-white/10 p-3">
                  {r.deals.map((dl, i) => (
                    <div key={i} className="rounded bg-black/20 p-2">
                      <div className="text-sm font-bold">{dl.customer}</div>
                      <div className="text-[11px] text-slate-300/70">{dl.address}{dl.sold ? ` · sold ${dl.sold}` : ''}</div>
                      {dl.missing.map((m, j) => <div key={'m' + j} className="text-xs text-amber-200">• Missing: {m}</div>)}
                      {dl.errors.map((e, j) => <div key={'e' + j} className="text-xs text-red-300">• Wrong: {e}</div>)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// Inline reassigner shown on a departed rep's deal: pick an Assign Rep
// (added to the JN "Assigned To" / owners — JN allows more than one) and a
// Sales Rep (replaces the sales rep). Apply writes both to JobNimbus via
// manager-reassign-deal.
function DealReassign({ jnid, reps, kind, zone, customer, address, onReassigned }) {
  const [assignee, setAssignee] = useState('')
  const [salesRep, setSalesRep] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  if (!jnid) return null
  const apply = async () => {
    if (!assignee && !salesRep) return
    setSaving(true); setMsg(null)
    try {
      const res = await fetch(LB_ORIGIN + 'manager-reassign-deal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jnid, assigneeId: assignee, salesRepId: salesRep, kind, zone, customer, address }),
      })
      const d = await res.json()
      if (res.ok && d.ok) {
        const bits = []
        if (d.owners) bits.push('assigned ' + d.owners.join(', '))
        if (d.sales_rep) bits.push('sales rep → ' + d.sales_rep)
        if (d.texted) bits.push('texted ' + (d.textedRep || 'the rep'))
        setMsg({ ok: true, text: '✓ Synced to JobNimbus — moving to ' + (d.sales_rep || 'the rep') + '…' })
        // Re-load the report so this deal drops out of the "Non-active rep"
        // section and reappears under the now-active sales rep. Small delay so
        // the JN write + our inspections-row sync are reflected on re-fetch.
        if (onReassigned) setTimeout(() => onReassigned(), 1200)
      } else setMsg({ ok: false, text: d.error || 'Failed to sync' })
    } catch { setMsg({ ok: false, text: 'Network error' }) }
    setSaving(false)
  }
  const sel = 'rounded bg-slate-800 text-white text-xs px-2 py-1 border border-white/15'
  return (
    <div className="mt-2 rounded border border-amber-400/30 bg-black/30 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={sel}>
          <option value="">Assign rep…</option>
          {reps.map((r) => <option key={r.jobnimbus_id} value={r.jobnimbus_id}>{r.name}</option>)}
        </select>
        <select value={salesRep} onChange={(e) => setSalesRep(e.target.value)} className={sel}>
          <option value="">Sales rep…</option>
          {reps.map((r) => <option key={r.jobnimbus_id} value={r.jobnimbus_id}>{r.name}</option>)}
        </select>
        <button type="button" onClick={apply} disabled={saving || (!assignee && !salesRep)}
          className="rounded bg-amber-500 px-3 py-1 text-xs font-bold text-black disabled:opacity-50">
          {saving ? 'Syncing…' : 'Apply to JobNimbus'}
        </button>
      </div>
      {msg && <div className={`mt-1 text-[11px] ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</div>}
    </div>
  )
}

// Generic JN-appt-status report for a regional manager: pulls jobs in
// one status family for this zone, grouped by rep and showing when the
// appointment was for. Any deal whose rep is NO LONGER ACTIVE is listed
// in a separate "Non-active rep" section (data.inactive_reps) so the
// manager knows to pass those leads out to an active rep.
function ZoneApptReport({ zone, fn, emoji, title, blurb, unit, color, emptyMsg, dateLabel = 'Appt was for', statusLabel, headless = false, autoLoad = false }) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null)   // { reps, inactive_reps, total } | null
  const [openRep, setOpenRep] = useState(null)
  const [err, setErr] = useState('')
  const [reps, setReps] = useState([])     // active roster for the reassign dropdowns

  // Headless tiles (Active leads grid) load on mount — the square IS the toggle.
  useEffect(() => { if (autoLoad && !data && !loading) load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const load = async () => {
    setLoading(true); setErr('')
    try {
      const res = await fetch(LB_ORIGIN + fn + '?zone=' + encodeURIComponent(zone))
      const d = await res.json()
      if (d && d.ok) { setData(d); setOpenRep(null) }
      else setErr(d?.error || 'Could not load.')
    } catch { setErr('Network error.') }
    // Active reps (with their JN id) for the Assign Rep / Sales Rep pickers.
    if (!reps.length) {
      try {
        const rr = await fetch('/.netlify/functions/rep-zones')
        const rd = await rr.json()
        setReps((rd.reps || []).filter((x) => x.jobnimbus_id && (x.name || '').trim())
          .sort((a, b) => (a.name || '').localeCompare(b.name || '')))
      } catch { /* dropdowns just stay empty */ }
    }
    setLoading(false)
  }

  const RepGroup = ({ r, keyPrefix }) => {
    const k = keyPrefix + r.rep
    return (
      <div className="rounded-lg border border-white/15 bg-white/5">
        <button type="button" onClick={() => setOpenRep(openRep === k ? null : k)}
          className="flex w-full items-center justify-between p-3 text-left">
          <span className="font-semibold">{r.rep}</span>
          <span className="text-sm"><span className="font-bold text-amber-200">{r.count}</span> {unit}{r.count === 1 ? '' : 's'} {openRep === k ? '▾' : '▸'}</span>
        </button>
        {openRep === k && (
          <div className="space-y-2 border-t border-white/10 p-3">
            {r.deals.map((dl, i) => (
              <div key={i} className="rounded bg-black/20 p-2">
                <div className="text-sm font-bold">{dl.customer}</div>
                <div className="text-[11px] text-slate-300/70">{dl.address}</div>
                <div className="text-xs text-sky-200">🗓 {dateLabel}: {dl.appt_label}</div>
                {dl.scheduled_label && <div className="text-xs text-sky-200/80">📅 Scheduled: {dl.scheduled_label}</div>}
                {dl.status && (statusLabel
                  ? <div className="text-xs text-amber-200/90">📋 {statusLabel}: {dl.status}</div>
                  : <div className="text-[11px] text-slate-400">{dl.status}</div>)}
                {r.inactive && dl.jnid && <DealReassign jnid={dl.jnid} reps={reps} zone={zone} customer={dl.customer} address={dl.address}
                  kind={fn === 'zone-back-to-retail' ? 'back_to_retail' : fn === 'zone-damage' ? 'damage' : fn === 'zone-no-damage' ? 'no_damage' : fn === 'zone-no-sits' ? 'no_sit' : ''}
                  onReassigned={load} />}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const inactive = data?.inactive_reps || []
  const notInterested = data?.not_interested || []  // BTR - NI (worked, homeowner declined) — back-to-retail only
  const nothing = data && data.reps.length === 0 && inactive.length === 0 && notInterested.length === 0

  return (
    <section className={headless ? 'mt-3' : 'mt-6'}>
      {headless ? (
        // Inside the Active-leads grid: the square tile is the toggle, so just
        // a slim title row + a refresh link here.
        <div className="mb-2 flex items-center justify-between border-l-2 pl-2" style={{ borderColor: color }}>
          <div className="text-sm font-bold text-white">{emoji} {title}{data ? ` (${data.total})` : ''}</div>
          <button type="button" onClick={load} disabled={loading} className="text-xs text-sky-300 disabled:opacity-50">
            {loading ? 'Loading…' : (data ? '↻ refresh' : 'load')}
          </button>
        </div>
      ) : (
        <button type="button" onClick={load} disabled={loading}
          className="w-full rounded-lg px-4 py-3 text-left font-semibold text-white shadow disabled:opacity-60"
          style={{ backgroundColor: color }}>
          {emoji} {title}{data ? ` (${data.total})` : ''}
          <div className="text-xs font-normal opacity-90">
            {loading ? 'Checking JobNimbus…' : `${blurb} Tap to ${data ? 'refresh' : 'load'}`}
          </div>
        </button>
      )}
      {headless && loading && !data && <div className="text-xs text-slate-300/70">Checking JobNimbus…</div>}
      {err && <div className="mt-2 text-xs text-red-300">{err}</div>}
      {data && (
        <div className="mt-2 space-y-2">
          {nothing ? (
            <div className="rounded-lg border border-emerald-400/30 bg-emerald-50/5 p-3 text-sm text-emerald-200">{emptyMsg}</div>
          ) : (
            <>
              {data.reps.map((r) => <RepGroup key={'a' + r.rep} r={r} keyPrefix="a" />)}
              {inactive.length > 0 && (
                <div className="mt-3">
                  <div className="mb-1 rounded-md bg-rose-900/40 px-3 py-2 text-xs font-bold uppercase tracking-wide text-rose-200">
                    ⚠️ Non-active rep — reassign these leads
                  </div>
                  <div className="space-y-2">
                    {inactive.map((r) => <RepGroup key={'i' + r.rep} r={r} keyPrefix="i" />)}
                  </div>
                </div>
              )}
              {notInterested.length > 0 && (
                <div className="mt-3">
                  <div className="mb-1 rounded-md bg-slate-700/50 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-200">
                    🚫 Not interested — worked, homeowner declined an appointment
                  </div>
                  <div className="space-y-2">
                    {notInterested.map((r) => <RepGroup key={'n' + r.rep} r={r} keyPrefix="n" />)}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}

// Active leads needing to be worked — compact 2×2 grid of square tiles. Tap a
// tile to load that report inline below; tap it again (or another) to hide.
function ActiveLeads({ zone }) {
  const [open, setOpen] = useState(null) // 'btr' | 'damage' | 'no_damage' | 'no_sits' | null
  const TILES = [
    { key: 'btr', emoji: '🏠', label: 'Back to retail', color: '#0f766e' },
    { key: 'damage', emoji: '⚠️', label: 'Damage', color: '#b45309' },
    { key: 'no_damage', emoji: '🚫', label: 'No damage', color: '#6d28d9' },
    { key: 'no_sits', emoji: '📵', label: 'No-sits to re-book', color: '#475569' },
  ]
  const report = (k) => {
    if (k === 'btr') return <ZoneApptReport zone={zone} fn="zone-back-to-retail" emoji="🏠" title="Back to retail" unit="deal" color="#0f766e" dateLabel="Inspected" blurb="" emptyMsg="✅ Nothing back-to-retail right now." headless autoLoad />
    if (k === 'damage') return <ZoneApptReport zone={zone} fn="zone-damage" emoji="⚠️" title="Damage" unit="deal" color="#b45309" dateLabel="Inspected" blurb="" emptyMsg="✅ No damage inspections right now." headless autoLoad />
    if (k === 'no_damage') return <ZoneApptReport zone={zone} fn="zone-no-damage" emoji="🚫" title="No damage" unit="deal" color="#6d28d9" dateLabel="Inspected" blurb="" emptyMsg="✅ No no-damage inspections right now." headless autoLoad />
    if (k === 'no_sits') return <ZoneApptReport zone={zone} fn="zone-no-sits" emoji="📵" title="No-sits to re-book" unit="no-sit" color="#475569" statusLabel="Status" blurb="" emptyMsg="✅ No no-sits to re-book right now." headless autoLoad />
    return null
  }
  return (
    <section className="mt-6">
      <div className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-300">📋 Active leads needing to be worked</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {TILES.map((t) => {
          const active = open === t.key
          return (
            <button key={t.key} type="button" onClick={() => setOpen(active ? null : t.key)}
              className="flex flex-col items-center justify-center gap-1 rounded-lg px-2 py-3 text-center text-white shadow transition"
              style={{ backgroundColor: t.color, opacity: active ? 1 : 0.82, outline: active ? '2px solid #fff' : 'none', outlineOffset: '-2px' }}>
              <span className="text-2xl leading-none">{t.emoji}</span>
              <span className="text-xs font-bold leading-tight">{t.label}</span>
              <span className="text-[10px] opacity-80">{active ? 'tap to hide ▾' : 'tap to load ▸'}</span>
            </button>
          )
        })}
      </div>
      {open && <div className="mt-1">{report(open)}</div>}
    </section>
  )
}

// ── Back-to-retail conversions ─────────────────────────────────────
// The wins the live "Back to retail" list can't show — a deal drops off
// that list the moment its JN status leaves "Sit Sold Insp". The hourly
// cron-track-retail-status snapshots those transitions; this reads them
// (zone-retail-conversions) grouped by rep, appointments-booked first.
// Load-on-demand to keep the dashboard light.
function BackToRetailWins({ zone }) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null)
  const [openRep, setOpenRep] = useState(null)
  const [err, setErr] = useState('')

  const load = async () => {
    setLoading(true); setErr('')
    try {
      const res = await fetch(LB_ORIGIN + 'zone-retail-conversions?zone=' + encodeURIComponent(zone))
      const d = await res.json()
      if (d && d.ok) { setData(d); setOpenRep(null) } else setErr(d?.error || 'Could not load.')
    } catch { setErr('Network error.') }
    setLoading(false)
  }

  return (
    <section className="mt-6">
      <button type="button" onClick={() => (data ? setData(null) : load())}
        className="w-full rounded-xl border border-emerald-400/40 bg-emerald-500/10 p-4 text-left transition active:scale-[.99]">
        <div className="flex items-center justify-between">
          <span className="text-lg font-semibold">✅ Back-to-retail conversions{data ? ` (${data.total})` : ''}</span>
          <span className="text-xs font-bold text-emerald-200">{loading ? 'Loading…' : data ? 'Hide ▾' : 'Load ▸'}</span>
        </div>
        <div className="mt-1 text-xs text-slate-200/70">Back-to-retail leads your reps moved off "Sit Sold Insp" — 📅 = an appointment was booked. Last 90 days. Tap to load.</div>
      </button>

      {err && <div className="mt-2 text-sm text-red-300">{err}</div>}

      {data && (
        <div className="mt-2 space-y-2">
          {data.appointments > 0 && (
            <div className="text-xs font-semibold text-emerald-200">📅 {data.appointments} got an appointment ({data.total} total status changes)</div>
          )}
          {data.reps.length === 0 && (
            <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-slate-200/70">No conversions tracked yet — they'll appear here as reps move back-to-retail leads off "Sit Sold Insp."</div>
          )}
          {data.reps.map((r) => {
            const k = r.rep
            return (
              <div key={k} className="rounded-lg border border-white/15 bg-white/5">
                <button type="button" onClick={() => setOpenRep(openRep === k ? null : k)}
                  className="flex w-full items-center justify-between p-3 text-left">
                  <span className="font-semibold">{r.rep}</span>
                  <span className="text-sm">
                    {r.appt_count > 0 && <span className="font-bold text-emerald-300">{r.appt_count} appt{r.appt_count === 1 ? '' : 's'}</span>}
                    <span className="ml-2 text-slate-300/80">{r.count} total</span> {openRep === k ? '▾' : '▸'}
                  </span>
                </button>
                {openRep === k && (
                  <div className="space-y-2 border-t border-white/10 p-3">
                    {r.deals.map((d, i) => (
                      <div key={i} className="rounded bg-black/20 p-2">
                        <div className="text-sm font-bold">{d.customer} {d.appointment && <span className="text-emerald-300">📅</span>}</div>
                        <div className="text-[11px] text-slate-300/70">{d.address}</div>
                        <div className="text-xs text-sky-200">→ {d.converted_to} · {d.converted_label}</div>
                      </div>
                    ))}
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

// ── Reps Table ─────────────────────────────────────────────────────
// One row per active rep in the manager's region. Each row has a
// "Mark as departed" button that opens a small inline confirm with an
// optional reason field.

// ── Quick Actions ──────────────────────────────────────────────────
// Touch-friendly tiles at the top of the page: Roof Inspection Records
// (auto-resolved by zone), Join Zone Zoom (admin-set URL, falls back to
// a "Coming soon" pill when null), the fixed Managers Meeting link, and
// Message a rep (opens the inline composer below).
// Company-wide regional-managers meeting — same link for every manager
// (Mon–Thu 8:30 AM ET). Passcode is embedded in the pwd param, so tapping
// joins directly. If the room changes, update this one line.
const MANAGERS_MEETING_URL =
  'https://us06web.zoom.us/j/3462393037?pwd=wSzImr09UTv0imz9h6b6nYi6Hc2yM5.1'

function QuickActions({ manager }) {
  const hasZoom = !!(manager.zoom_url && String(manager.zoom_url).trim())
  return (
    <section className="mt-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ActionTile
          icon="📹"
          title="Join Zone Zoom"
          subtitle="Daily sales training · 9:30 AM Eastern"
          href={hasZoom ? manager.zoom_url : null}
          comingSoonNote="Zoom link coming soon — admin is finalizing."
        />
        <ActionTile
          icon="👔"
          title="Managers Meeting"
          subtitle="Mon–Thu · 8:30 AM Eastern"
          href={MANAGERS_MEETING_URL}
        />
      </div>
    </section>
  )
}

function ActionTile({ icon, title, subtitle, href, comingSoonNote, onClick, active }) {
  const interactive = !!href || !!onClick
  const inner = (
    <div className="flex items-center gap-3 p-4">
      <span className="text-3xl leading-none" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`text-base font-semibold ${interactive ? 'text-white' : 'text-slate-300'}`}>
            {title}
          </span>
          {!interactive && (
            <span className="rounded-full bg-amber-300/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900">
              Coming soon
            </span>
          )}
        </div>
        <div className={`mt-0.5 text-xs ${interactive ? 'text-white/70' : 'text-slate-400'}`}>
          {interactive ? subtitle : comingSoonNote}
        </div>
      </div>
      {href && <span className="text-2xl text-white/70">↗</span>}
      {onClick && <span className="text-2xl text-white/70">{active ? '×' : '✏️'}</span>}
    </div>
  )
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="block rounded-lg border border-amber-300/40 bg-amber-500/15 shadow-sm hover:bg-amber-500/25"
      >
        {inner}
      </a>
    )
  }
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`block w-full rounded-lg border text-left shadow-sm ${
          active
            ? 'border-amber-300/70 bg-amber-500/25'
            : 'border-amber-300/40 bg-amber-500/15 hover:bg-amber-500/25'
        }`}
      >
        {inner}
      </button>
    )
  }
  return (
    <div
      className="block cursor-default rounded-lg border border-dashed border-white/15 bg-white/5"
      aria-disabled="true"
    >
      {inner}
    </div>
  )
}

// ── WhatsApp groups ────────────────────────────────────────────────
// Pick which reps to invite; sends all 3 group links (Sales Team, Say
// Anything, + this manager's zone group) by BOTH text and email. The
// links are fixed server-side; the manager only chooses recipients.
function WhatsAppGroups({ token, reps, zone }) {
  const reachable = (reps || []).filter((r) => r.phone || r.email)
  const [selected, setSelected] = useState(() => new Set(reachable.map((r) => r.id)))
  const [sending, setSending] = useState(false)
  const [msg, setMsg] = useState(null)
  const allSel = reachable.length > 0 && selected.size === reachable.length
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleAll = () => setSelected(allSel ? new Set() : new Set(reachable.map((r) => r.id)))

  const send = async () => {
    const ids = [...selected]
    if (!ids.length) return
    setSending(true); setMsg(null)
    try {
      const res = await fetch('/.netlify/functions/regional-manager-api', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send_whatsapp_invite', token, trainee_ids: ids }),
      })
      const d = await res.json()
      if (res.ok && d.ok) {
        const c = d.counts || {}
        const smsS = c.sms_sent || 0, smsF = c.sms_failed || 0
        const emS = c.email_sent || 0, emF = c.email_failed || 0
        const parts = [
          `${smsS} text${smsS === 1 ? '' : 's'}${smsF ? ` (${smsF} failed)` : ''}`,
          `${emS} email${emS === 1 ? '' : 's'}${emF ? ` (${emF} failed)` : ''}`,
        ]
        if (smsS === 0 && emS === 0) {
          setMsg({ level: 'fail', text: '❌ Nothing went out (0 texts, 0 emails). Check the selected reps have a valid phone/email.' })
        } else {
          const anyFail = smsF > 0 || emF > 0
          setMsg({ level: anyFail ? 'partial' : 'ok', text: `${anyFail ? '⚠️ Sent, some failed' : '✅ Sent'} — ${c.recipients ?? ids.length} rep(s): ${parts.join(', ')}.` })
        }
      } else setMsg({ level: 'fail', text: `❌ ${d.error || 'Failed to send.'}` })
    } catch { setMsg({ level: 'fail', text: '❌ Network error — nothing sent. Try again.' }) }
    setSending(false)
  }

  return (
    <section className="mt-6">
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-900/25 p-4">
        <div className="text-sm font-bold uppercase tracking-wide text-emerald-200">💬 Invite reps to WhatsApp</div>
        <p className="mt-1 text-xs text-slate-300/80">
          Sends all 3 group links — <strong>Sales Team</strong>, <strong>Say Anything</strong>, and your <strong>{zone}</strong> group — to the reps you pick, by text <strong>and</strong> email.
        </p>
        <div className="mt-3 mb-1 flex items-center justify-between">
          <div className="text-xs font-semibold text-slate-200">Send to ({selected.size}/{reachable.length})</div>
          <button type="button" onClick={toggleAll} className="text-xs text-sky-300">{allSel ? 'Clear all' : 'Select all'}</button>
        </div>
        <div className="max-h-56 divide-y divide-white/5 overflow-y-auto rounded border border-white/10 bg-black/20">
          {reachable.map((r) => (
            <label key={r.id} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-slate-100">
              <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
              <span className="font-medium">{`${r.first_name || ''} ${r.last_name || ''}`.trim()}</span>
              <span className="ml-auto text-[10px] text-slate-400">{[r.phone && '📱', r.email && '✉️'].filter(Boolean).join(' ')}</span>
            </label>
          ))}
          {!reachable.length && <div className="px-3 py-2 text-xs text-slate-400">No reps with a phone or email on file.</div>}
        </div>
        <button type="button" onClick={send} disabled={sending || !selected.size}
          className="mt-3 w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow disabled:opacity-50">
          {sending ? 'Sending…' : `Send all 3 links to ${selected.size} rep${selected.size === 1 ? '' : 's'} (text + email)`}
        </button>
        {msg && (
          <div className={`mt-3 rounded-lg border px-3 py-2 text-sm font-semibold ${
            msg.level === 'ok' ? 'border-emerald-400/40 bg-emerald-600/30 text-emerald-100'
              : msg.level === 'partial' ? 'border-amber-400/40 bg-amber-600/30 text-amber-100'
                : 'border-red-400/40 bg-red-600/30 text-red-100'
          }`}>{msg.text}</div>
        )}
      </div>
    </section>
  )
}

// ── Zone Map ───────────────────────────────────────────────────────
// Embedded Leaflet map showing every rep in the zone with a pin at
// their geocoded home address. Hover/tap shows name + address. Reps
// without lat/lng (haven't run /update-info or geocoding failed) are
// skipped from the map but still appear in the rep table below.
function ZoneMap({ reps, zoneName, token }) {
  const pinned = reps.filter(
    (r) => typeof r.latitude === 'number' && typeof r.longitude === 'number',
  )
  // Compute a sensible center: bounding box of pinned reps when there
  // are any, otherwise the zone centroid as a soft default.
  let center = ZONE_CENTERS[zoneName] || [27.9944, -81.7603]
  let zoom = 9
  if (pinned.length > 0) {
    const lats = pinned.map((r) => r.latitude)
    const lngs = pinned.map((r) => r.longitude)
    center = [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lngs) + Math.max(...lngs)) / 2]
    // Tighter zoom when reps cluster, wider when spread. Heuristic
    // based on the bbox diagonal.
    const span = Math.max(
      Math.max(...lats) - Math.min(...lats),
      Math.max(...lngs) - Math.min(...lngs),
    )
    zoom = span > 2 ? 7 : span > 1 ? 8 : span > 0.4 ? 9 : 10
  }

  return (
    <section className="mt-8 rounded-lg border border-white/10 bg-white/5 p-5">
      <h2 className="text-lg font-semibold text-amber-200">
        Map · {zoneName}
      </h2>
      <p className="mt-1 text-xs text-slate-200/70">
        {pinned.length} of {reps.length} rep{reps.length === 1 ? '' : 's'} pinned by home address.
        {pinned.length < reps.length && (
          <span className="ml-1 text-amber-200/80">
            The {reps.length - pinned.length} not shown haven't filled in / update-info yet.
          </span>
        )}
      </p>
      <div className="mt-3 overflow-hidden rounded-md border border-white/10" style={{ height: 420 }}>
        <MapContainer center={center} zoom={zoom} style={{ height: '100%', width: '100%' }} scrollWheelZoom={true}>
          <TileLayer
            attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {pinned.map((r) => (
            <Marker key={r.id} position={[r.latitude, r.longitude]} icon={REP_PIN}>
              <Popup closeButton={false} autoPan={false}>
                <div style={{ fontSize: 13, lineHeight: 1.4 }}>
                  <div style={{ fontWeight: 700 }}>
                    {r.first_name} {r.last_name}
                  </div>
                  <div style={{ color: '#475569', fontSize: 12 }}>
                    {r.phone || '—'}
                  </div>
                  {fmtAddress(r) && (
                    <div style={{ color: '#475569', fontSize: 12, marginTop: 4 }}>
                      {fmtAddress(r)}
                    </div>
                  )}
                  <a
                    href={vcardUrlFor(token, r.id)}
                    download
                    style={{
                      display: 'inline-block',
                      marginTop: 8,
                      padding: '4px 10px',
                      background: '#13294b',
                      color: '#fff',
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 600,
                      textDecoration: 'none',
                    }}
                  >
                    💾 Save to phone
                  </a>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </section>
  )
}

// Returns the URL for a single rep's vCard, scoped to the manager's
// token so the server can validate before serving. Used by the
// "Save to phone" button on each rep row.
function vcardUrlFor(token, repId) {
  return `/.netlify/functions/regional-manager-rep-vcard?token=${encodeURIComponent(token)}&trainee_id=${encodeURIComponent(repId)}`
}

function RepsTable({ token, reps, onChanged }) {
  const [confirming, setConfirming] = useState(null) // {rep, reason}
  const [submitting, setSubmitting] = useState(false)
  const [flash, setFlash] = useState(null)
  const [editing, setEditing] = useState(null) // {rep, phone, email}
  const [savingEdit, setSavingEdit] = useState(false)

  async function submitEdit() {
    if (!editing) return
    setSavingEdit(true)
    try {
      const repId = editing.rep.id
      const res = await fetch('/.netlify/functions/regional-manager-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_rep',
          token,
          trainee_id: repId,
          phone: editing.phone,
          email: editing.email,
          street_address: editing.street_address,
          city: editing.city,
          state: editing.state,
          zip: editing.zip,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setFlash({ kind: 'error', text: data?.error || 'Could not save.' })
      } else if (data.no_change) {
        setFlash({ kind: 'success', text: 'No changes to save.' })
        setEditing(null)
      } else {
        // Address changed → re-pin the map. Fire-and-forget, same as the
        // rep's own /update-info form; we don't block the save on it.
        if (data.address_changed) {
          fetch('/.netlify/functions/geocode-trainee', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trainee_id: repId, force: true }),
          }).catch(() => {})
        }
        setFlash({
          kind: 'success',
          text: `Saved. The office has been texted to update ${editing.rep.first_name}'s record.`,
        })
        setEditing(null)
        await onChanged()
      }
    } catch (e) {
      setFlash({ kind: 'error', text: e?.message || 'Network error.' })
    } finally {
      setSavingEdit(false)
    }
  }

  async function submitDeactivate() {
    if (!confirming) return
    setSubmitting(true)
    try {
      const res = await fetch('/.netlify/functions/regional-manager-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'deactivate_rep',
          token,
          trainee_id: confirming.rep.id,
          reason: confirming.reason,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setFlash({ kind: 'error', text: data?.error || 'Could not deactivate.' })
      } else {
        setFlash({
          kind: 'success',
          text: `${confirming.rep.first_name} ${confirming.rep.last_name} marked as Quit / Fired.`,
        })
        setConfirming(null)
        await onChanged()
      }
    } catch (e) {
      setFlash({ kind: 'error', text: e?.message || 'Network error.' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="mt-8 rounded-lg border border-white/10 bg-white/5 p-5">
      <h2 className="text-lg font-semibold text-amber-200">
        Your reps ({reps.length})
      </h2>

      {flash && (
        <div
          className={`mt-3 rounded-md px-3 py-2 text-sm ${
            flash.kind === 'error'
              ? 'bg-red-500/20 text-red-100'
              : 'bg-emerald-500/20 text-emerald-100'
          }`}
        >
          {flash.text}
        </div>
      )}

      {reps.length === 0 ? (
        <p className="mt-3 text-sm text-slate-300">
          No active reps in your region yet.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-white/10">
          {reps.map((r) => {
            const level = !r.rep_level || !r.rep_level_confirmed_at
              ? 'Unassigned'
              : LEVEL_LABEL[r.rep_level] || r.rep_level
            return (
              <li key={r.id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <div className="text-base font-semibold">
                      {r.first_name} {r.last_name}
                    </div>
                    <div className="text-xs text-slate-300">
                      {r.phone || '—'}
                      {r.company_email && (
                        <span className="ml-2 opacity-80">· {r.company_email}</span>
                      )}
                      {r.company_number && (
                        <span className="ml-2 opacity-80">· #{r.company_number}</span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-amber-200/80">{level}</div>
                    {/* Home address — single-line, only renders if any
                        component is set. Blank rows skip the line entirely
                        rather than show "—" placeholders, which looks
                        broken on a public dashboard. */}
                    {fmtAddress(r) && (
                      <div className="mt-0.5 text-xs text-slate-200/70">
                        🏠 {fmtAddress(r)}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <a
                      href={vcardUrlFor(token, r.id)}
                      download
                      className="rounded-md border border-amber-300/40 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-100 hover:bg-amber-500/20"
                      title="Download this rep's contact card to your phone."
                    >
                      💾 Save to phone
                    </a>
                    <button
                      type="button"
                      onClick={() =>
                        setEditing({
                          rep: r,
                          phone: r.phone || '',
                          email: r.email || '',
                          street_address: r.street_address || '',
                          city: r.city || '',
                          state: r.state || '',
                          zip: r.zip || '',
                        })
                      }
                      className="rounded-md border border-sky-300/40 bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-100 hover:bg-sky-500/20"
                      title="Update this rep's phone, email, or home address. The office is texted the change."
                    >
                      ✏️ Edit info
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setConfirming((c) =>
                          c?.rep.id === r.id ? null : { rep: r, reason: '' },
                        )
                      }
                      className="rounded-md border border-red-300/40 bg-red-500/10 px-3 py-1 text-xs font-semibold text-red-100 hover:bg-red-500/20"
                    >
                      Quit / Fired
                    </button>
                  </div>
                </div>

                {/* Inline edit — opens directly under THIS rep so the panel is
                    always in view next to the button that was clicked. */}
                {editing?.rep.id === r.id && (
                  <div className="mt-3 rounded-md border border-sky-400/50 bg-sky-950/40 p-4">
                    <div className="text-sm font-semibold">
                      Edit {editing.rep.first_name} {editing.rep.last_name}
                    </div>
                    <p className="mt-1 text-xs text-slate-200/80">
                      Update their phone, personal email, or home address. When you save,
                      the office is automatically texted exactly what changed so they can
                      update their other records (GHL, JobNimbus, RepCard).
                    </p>
                    <label className="mt-3 block text-xs font-medium text-slate-200/80">
                      Phone
                    </label>
                    <input
                      type="tel"
                      value={editing.phone}
                      onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
                      placeholder="(555) 123-4567"
                      className="mt-1 w-full rounded-md border border-white/20 bg-white/10 px-2 py-1.5 text-sm text-white placeholder:text-slate-400"
                    />
                    <label className="mt-3 block text-xs font-medium text-slate-200/80">
                      Personal email
                    </label>
                    <input
                      type="email"
                      value={editing.email}
                      onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                      placeholder="name@email.com"
                      className="mt-1 w-full rounded-md border border-white/20 bg-white/10 px-2 py-1.5 text-sm text-white placeholder:text-slate-400"
                    />
                    <label className="mt-3 block text-xs font-medium text-slate-200/80">
                      Street address
                    </label>
                    <input
                      type="text"
                      value={editing.street_address}
                      onChange={(e) =>
                        setEditing({ ...editing, street_address: e.target.value })
                      }
                      placeholder="123 Main St"
                      className="mt-1 w-full rounded-md border border-white/20 bg-white/10 px-2 py-1.5 text-sm text-white placeholder:text-slate-400"
                    />
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto]">
                      <div>
                        <label className="block text-xs font-medium text-slate-200/80">
                          City
                        </label>
                        <input
                          type="text"
                          value={editing.city}
                          onChange={(e) => setEditing({ ...editing, city: e.target.value })}
                          placeholder="Tampa"
                          className="mt-1 w-full rounded-md border border-white/20 bg-white/10 px-2 py-1.5 text-sm text-white placeholder:text-slate-400"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-200/80">
                          State
                        </label>
                        <input
                          type="text"
                          value={editing.state}
                          onChange={(e) => setEditing({ ...editing, state: e.target.value })}
                          placeholder="FL"
                          className="mt-1 w-full rounded-md border border-white/20 bg-white/10 px-2 py-1.5 text-sm text-white placeholder:text-slate-400 sm:w-20"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-200/80">
                          Zip
                        </label>
                        <input
                          type="text"
                          value={editing.zip}
                          onChange={(e) => setEditing({ ...editing, zip: e.target.value })}
                          placeholder="33601"
                          className="mt-1 w-full rounded-md border border-white/20 bg-white/10 px-2 py-1.5 text-sm text-white placeholder:text-slate-400 sm:w-28"
                        />
                      </div>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={submitEdit}
                        disabled={savingEdit}
                        className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
                      >
                        {savingEdit ? 'Saving…' : 'Save changes'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        disabled={savingEdit}
                        className="rounded-md border border-white/30 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Inline confirm — opens directly under THIS rep. */}
                {confirming?.rep.id === r.id && (
                  <div className="mt-3 rounded-md border border-red-400/50 bg-red-950/40 p-4">
                    <div className="text-sm font-semibold">
                      Mark {confirming.rep.first_name} {confirming.rep.last_name} as Quit / Fired?
                    </div>
                    <p className="mt-1 text-xs text-slate-200/80">
                      This removes them from your team list and flags them for cleanup in the
                      office systems (GHL, RepCard, etc.). The office will see who you marked.
                    </p>
                    <label className="mt-3 block text-xs font-medium text-slate-200/80">
                      Reason (optional)
                    </label>
                    <input
                      type="text"
                      value={confirming.reason}
                      onChange={(e) =>
                        setConfirming({ ...confirming, reason: e.target.value })
                      }
                      placeholder="e.g. No-show 3 days in a row"
                      className="mt-1 w-full rounded-md border border-white/20 bg-white/10 px-2 py-1.5 text-sm text-white placeholder:text-slate-400"
                    />
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={submitDeactivate}
                        disabled={submitting}
                        className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        {submitting ? 'Saving…' : 'Yes — Quit / Fired'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming(null)}
                        disabled={submitting}
                        className="rounded-md border border-white/30 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}


