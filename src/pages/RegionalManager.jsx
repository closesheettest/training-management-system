import { useCallback, useEffect, useState, Fragment } from 'react'
import { useParams } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { teamLabel } from '../lib/zones.js'

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

      {/* Hidden until the Appointments → Sales report is verified correct. Re-enable: <ApptConversion zone={manager.region} /> */}

      <WeeklyReport token={token} />

      <DealsToFix zone={manager.region} />

      <NoSits zone={manager.region} />

      <BackToRetail zone={manager.region} />

      <BackToRetailWins zone={manager.region} />

      <NoDamage zone={manager.region} />

      <QuickActions manager={manager} />

      <ZoneMap reps={reps} zoneName={manager.region} token={token} />

      <RepsTable token={token} reps={reps} onChanged={reload} />

      <footer className="mt-8 text-center text-xs text-slate-200/60">
        Need help? Reply to the text you got with this link.
      </footer>
    </ShellFrame>
  )
}

// ── Shell ──────────────────────────────────────────────────────────
// Wraps everything in a navy / gold themed page so the manager doesn't
// see the admin app's chrome. Self-contained styling — no shared layout.

function ShellFrame({ children }) {
  return (
    <div className="min-h-screen bg-[#0a1730] text-white">
      <div className="h-1 bg-[#b8324f]" />
      <div className="mx-auto max-w-3xl px-4 py-8">{children}</div>
    </div>
  )
}

// ── Leaderboard ────────────────────────────────────────────────────
// Same team standings as the Sales Rep Dashboard (inspections + sales),
// fed by the CCG zone-leaderboard / zone-sales-leaderboard functions, with
// a This Week / This Month toggle. The manager's own zone is gold-outlined.
const LB_ORIGIN = 'https://free-roof-inspections.netlify.app/.netlify/functions/'
const LB_ZONE_COLOR = { 'Zone 1': '#dc2626', 'Zone 2': '#2563eb', 'Zone 3': '#16a34a', 'Zone 4': '#ea580c' }
const LB_MEDALS = ['🥇', '🥈', '🥉', '']
function lbOrdinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]) }

// Appointments → Sales conversion per rep (this zone), with Radiant Barrier /
// Insulation attach rates. Appointments = JN jobs by appointment date; sales =
// those now in a sold status. Period toggle: this week / last week / month.
// Drill-down detail (dark theme) — one row per DEAL (a deal that both had its
// appointment AND closed this period is merged, so it doesn't look doubled).
function ApptDetail({ details }) {
  const byDeal = new Map()
  for (const d of (details || [])) {
    const k = (d.customer || '') + '|' + (d.address || '')
    const e = byDeal.get(k) || { customer: d.customer, address: d.address, cat: d.cat, status: d.status, appt: false, sale: false, amt: 0 }
    if (d.kind === 'sale') { e.sale = true; e.amt = d.amt || 0; e.status = d.status; e.cat = d.cat }
    else { e.appt = true; if (!e.sale) { e.status = d.status; e.cat = d.cat } }
    byDeal.set(k, e)
  }
  const list = [...byDeal.values()].sort((a, b) => (a.sale === b.sale ? 0 : a.sale ? -1 : 1))
  if (!list.length) return <div className="text-[11px] text-slate-400">No detail for this period.</div>
  return (
    <div className="space-y-0.5">
      {list.map((e, i) => (
        <div key={i} className="flex items-center justify-between gap-3 border-b border-white/10 py-0.5 text-[11px]">
          <span className="truncate">
            <span className={'mr-1 rounded px-1 font-bold ' + (e.sale ? 'bg-emerald-500/30 text-emerald-200' : 'bg-white/15 text-slate-200')}>{e.sale ? 'SALE' : 'APPT'}</span>
            <span className="text-slate-400">{(e.cat || '').toUpperCase()}</span> · {e.customer}{e.address ? <span className="text-slate-400"> · {e.address}</span> : ''}
            {e.sale && e.appt && <span className="ml-1 text-slate-400">· appt this wk</span>}
          </span>
          <span className="whitespace-nowrap text-slate-300">{e.status}{e.sale ? ' · $' + (e.amt || 0).toLocaleString() : ''}</span>
        </div>
      ))}
    </div>
  )
}

function ApptConversion({ zone }) {
  const [period, setPeriod] = useState('week')
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [openRep, setOpenRep] = useState(null)   // rep name — drill-down detail
  useEffect(() => {
    let cancelled = false
    setLoading(true); setErr(''); setData(null)
    ;(async () => {
      // Heavy JobNimbus pull (~5-6s) — auto-retry a couple times so a transient
      // timeout doesn't flash "Network error."
      let lastErr = ''
      for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
        try {
          const res = await fetch(LB_ORIGIN + 'zone-appt-conversion?zone=' + encodeURIComponent(zone) + '&period=' + period)
          const d = await res.json()
          if (cancelled) return
          if (d && d.ok) { setData(d); setLoading(false); return }
          lastErr = (d && d.error) || 'Could not load.'
        } catch { lastErr = 'Network error.' }
        if (attempt < 2) await new Promise((r) => setTimeout(r, 1500))
      }
      if (!cancelled) { setErr(lastErr); setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [zone, period])

  const periods = [['week', 'This week'], ['lastweek', 'Last week'], ['month', 'This month']]
  const t = data?.totals
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-amber-300">📈 Appointments → Sales</h2>
        <div className="flex gap-1">
          {periods.map(([k, label]) => (
            <button key={k} type="button" onClick={() => setPeriod(k)}
              className={'rounded-md px-2 py-1 text-[11px] font-semibold ' + (period === k ? 'bg-amber-400 text-black' : 'bg-white/10 text-slate-200')}>{label}</button>
          ))}
        </div>
      </div>
      {loading && <div className="text-xs text-slate-400">Checking JobNimbus…</div>}
      {err && <div className="text-xs text-red-300">{err}</div>}
      {data && (
        <div className="overflow-x-auto rounded-lg border border-white/15">
          <table className="w-full whitespace-nowrap text-sm">
            <thead>
              <tr className="bg-white/10 text-[10px] uppercase tracking-wide text-slate-300">
                <th className="px-3 py-2 text-left">Rep</th>
                <th className="px-2 py-2 text-right">Harv Apt</th>
                <th className="px-2 py-2 text-right">Comp Apt</th>
                <th className="px-2 py-2 text-right">BTR Apt</th>
                <th className="px-2 py-2 text-right">Total Apt</th>
                <th className="px-2 py-2 text-right">Harv $</th>
                <th className="px-2 py-2 text-right">Comp $</th>
                <th className="px-2 py-2 text-right">BTR $</th>
                <th className="px-2 py-2 text-right">$ Sold</th>
                <th className="px-2 py-2 text-right">Harv %</th>
                <th className="px-2 py-2 text-right">Comp %</th>
                <th className="px-2 py-2 text-right">BTR %</th>
                <th className="px-2 py-2 text-right">Tot %</th>
                <th className="px-2 py-2 text-right">Avg $/Sale</th>
                <th className="px-2 py-2 text-right">RB</th>
                <th className="px-2 py-2 text-right">Insul</th>
              </tr>
            </thead>
            <tbody>
              {data.reps.length === 0 ? (
                <tr><td colSpan={16} className="px-3 py-3 text-xs text-slate-400">No appointments in this period.</td></tr>
              ) : data.reps.map((r) => {
                const open = openRep === r.rep
                return (
                <Fragment key={r.rep}>
                <tr className="cursor-pointer border-t border-white/10 hover:bg-white/5" onClick={() => setOpenRep(open ? null : r.rep)}>
                  <td className="px-3 py-1.5"><span className="text-slate-400">{open ? '▾' : '▸'}</span> {r.rep}{r.level && <span className="ml-1.5 rounded bg-white/15 px-1 py-0.5 text-[9px] font-bold text-slate-200">{r.level}</span>}</td>
                  <td className="px-2 py-1.5 text-right text-slate-300">{r.harvAp}</td>
                  <td className="px-2 py-1.5 text-right text-slate-300">{r.compAp}</td>
                  <td className="px-2 py-1.5 text-right text-slate-300">{r.btrAp}</td>
                  <td className="px-2 py-1.5 text-right font-semibold">{r.appts}</td>
                  <td className="px-2 py-1.5 text-right text-slate-300">${(r.harvAmt || 0).toLocaleString()}</td>
                  <td className="px-2 py-1.5 text-right text-slate-300">${(r.compAmt || 0).toLocaleString()}</td>
                  <td className="px-2 py-1.5 text-right text-slate-300">${(r.btrAmt || 0).toLocaleString()}</td>
                  <td className="px-2 py-1.5 text-right font-semibold">${(r.amt || 0).toLocaleString()}</td>
                  <td className="px-2 py-1.5 text-right text-slate-400">{r.harvAp ? r.harvPct + '%' : '—'}</td>
                  <td className="px-2 py-1.5 text-right text-slate-400">{r.compAp ? r.compPct + '%' : '—'}</td>
                  <td className="px-2 py-1.5 text-right text-slate-400">{r.btrAp ? r.btrPct + '%' : '—'}</td>
                  <td className="px-2 py-1.5 text-right font-bold text-amber-200">{r.appts ? r.pct + '%' : '—'}</td>
                  <td className="px-2 py-1.5 text-right">${(r.avg || 0).toLocaleString()}</td>
                  <td className="px-2 py-1.5 text-right text-slate-300">{r.rb}<span className="text-[10px] text-slate-400"> ({r.rb_pct}%)</span></td>
                  <td className="px-2 py-1.5 text-right text-slate-300">{r.ins}<span className="text-[10px] text-slate-400"> ({r.ins_pct}%)</span></td>
                </tr>
                {open && (
                  <tr><td colSpan={16} className="bg-white/5 px-4 py-2"><ApptDetail details={r.details} /></td></tr>
                )}
                </Fragment>
                )
              })}
              {t && (
                <tr className="border-t-2 border-white/20 bg-white/5 font-bold">
                  <td className="px-3 py-1.5">Zone total</td>
                  <td className="px-2 py-1.5 text-right">{t.harvAp}</td>
                  <td className="px-2 py-1.5 text-right">{t.compAp}</td>
                  <td className="px-2 py-1.5 text-right">{t.btrAp}</td>
                  <td className="px-2 py-1.5 text-right">{t.appts}</td>
                  <td className="px-2 py-1.5 text-right">${(t.harvAmt || 0).toLocaleString()}</td>
                  <td className="px-2 py-1.5 text-right">${(t.compAmt || 0).toLocaleString()}</td>
                  <td className="px-2 py-1.5 text-right">${(t.btrAmt || 0).toLocaleString()}</td>
                  <td className="px-2 py-1.5 text-right">${(t.amt || 0).toLocaleString()}</td>
                  <td className="px-2 py-1.5 text-right">{t.harvAp ? t.harvPct + '%' : '—'}</td>
                  <td className="px-2 py-1.5 text-right">{t.compAp ? t.compPct + '%' : '—'}</td>
                  <td className="px-2 py-1.5 text-right">{t.btrAp ? t.btrPct + '%' : '—'}</td>
                  <td className="px-2 py-1.5 text-right text-amber-200">{t.appts ? t.pct + '%' : '—'}</td>
                  <td className="px-2 py-1.5 text-right">${(t.avg || 0).toLocaleString()}</td>
                  <td className="px-2 py-1.5 text-right">{t.rb}<span className="text-[10px] text-slate-400"> ({t.rb_pct}%)</span></td>
                  <td className="px-2 py-1.5 text-right">{t.ins}<span className="text-[10px] text-slate-400"> ({t.ins_pct}%)</span></td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="px-3 py-2 text-[10px] text-slate-400">
            Appts counted in the week they happen (inspection signings excluded); sales in the week they close. Harv = harvested · Comp = company lead (IQ/AI Bot/FB…) · BTR = back-to-retail (from an inspection). Each % = that bucket's sales ÷ appts. Avg $/Sale = approved estimate ÷ sales.
          </div>
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
function ZoneApptReport({ zone, fn, emoji, title, blurb, unit, color, emptyMsg, dateLabel = 'Appt was for', statusLabel }) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null)   // { reps, inactive_reps, total } | null
  const [openRep, setOpenRep] = useState(null)
  const [err, setErr] = useState('')
  const [reps, setReps] = useState([])     // active roster for the reassign dropdowns

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
                  kind={fn === 'zone-back-to-retail' ? 'back_to_retail' : fn === 'zone-no-damage' ? 'no_damage' : fn === 'zone-no-sits' ? 'no_sit' : ''}
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
    <section className="mt-6">
      <button type="button" onClick={load} disabled={loading}
        className="w-full rounded-lg px-4 py-3 text-left font-semibold text-white shadow disabled:opacity-60"
        style={{ backgroundColor: color }}>
        {emoji} {title}{data ? ` (${data.total})` : ''}
        <div className="text-xs font-normal opacity-90">
          {loading ? 'Checking JobNimbus…' : `${blurb} Tap to ${data ? 'refresh' : 'load'}`}
        </div>
      </button>
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

function NoSits({ zone }) {
  return <ZoneApptReport zone={zone} fn="zone-no-sits" emoji="📵" title="No-sits to re-book" unit="no-sit" color="#475569" statusLabel="Status"
    blurb="Appointments in your zone that didn't sit — chase them back onto the calendar." emptyMsg="✅ No no-sits to re-book right now." />
}
function BackToRetail({ zone }) {
  return <ZoneApptReport zone={zone} fn="zone-back-to-retail" emoji="🏠" title="Back to retail" unit="deal" color="#0f766e" dateLabel="Inspected"
    blurb="Inspections in your zone that came back retail — work them as retail roof sales. Deals from a rep who's left show under Non-active rep." emptyMsg="✅ Nothing back-to-retail right now." />
}
function NoDamage({ zone }) {
  return <ZoneApptReport zone={zone} fn="zone-no-damage" emoji="🚫" title="No damage" unit="deal" color="#6d28d9" dateLabel="Inspected"
    blurb="Inspections in your zone that came back no-damage. Deals from a rep who's left show under Non-active rep." emptyMsg="✅ No no-damage inspections right now." />
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
  const hasRecords = !!(manager.ccg_records_url && String(manager.ccg_records_url).trim())
  return (
    <section className="mt-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ActionTile
          icon="📄"
          title="Roof Inspection Records"
          subtitle="Your team's deals · pending signatures · status"
          href={hasRecords ? manager.ccg_records_url : null}
          comingSoonNote="Deal board coming soon — admin is finalizing."
        />
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


