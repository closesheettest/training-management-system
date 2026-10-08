// REP ATTENDANCE (Neal, 2026-10-01): reps have a daily pin quota, and their personal
// dashboard (CCG ?mode=rep) is their Mon–Fri check-in. A weekday they weren't on it has to be
// given a reason (sick / personal / vacation / other) the next time they sign in, so a sick
// day isn't held against them. This lists every active rep × weekday: checked in (with doors
// worked on the map that day), the reason they gave, or ✗ no reason yet. Data: CCG
// rep-attendance (admin PIN). Roster: TMS active sales reps with a JobNimbus id.
import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

const CCG = 'https://free-roof-inspections.netlify.app/.netlify/functions/rep-attendance'
// Same people the comp-agreement audit leaves out — they carry the rep flag but aren't field reps.
const NOT_A_FIELD_REP = new Set(['neal scoppe', 'jennifer vongraupen', 'dewayne kohrn', 'nikki macella', 'william hernandez', 'dustin hunt'])
const REASON = {
  sick: ['🤒 Sick', 'bg-sky-100 text-sky-800'],
  personal: ['🏠 Personal', 'bg-violet-100 text-violet-800'],
  vacation: ['🌴 Vacation', 'bg-teal-100 text-teal-800'],
  other: ['✏️ Other', 'bg-amber-100 text-amber-800'],
}
const etTime = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) : '')
const etDay = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso))
const dayLabel = (ds) => new Date(`${ds}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'numeric', day: 'numeric' })
const PIN_KEY = 'rm_admin_ok_pin'
// Date ranges (Neal, 2026-10-02), in Eastern time. Weeks run Monday–Sunday.
const RANGES = [['today', 'Today'], ['yesterday', 'Yesterday'], ['this_week', 'This week'], ['last_week', 'Last week'], ['this_month', 'This month'], ['last_month', 'Last month']]
function rangeDates(k) {
  const today = etDay(Date.now())
  const d = (s, n) => { const t = new Date(`${s}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) }
  const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7 // 0 = Monday
  const monday = d(today, -dow)
  const [y, m] = today.split('-').map(Number)
  const first = `${y}-${String(m).padStart(2, '0')}-01`
  const prevFirst = m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`
  switch (k) {
    case 'today': return { from: today, to: today }
    case 'yesterday': return { from: d(today, -1), to: d(today, -1) }
    case 'last_week': return { from: d(monday, -7), to: d(monday, -1) }
    case 'this_month': return { from: first, to: today }
    case 'last_month': return { from: prevFirst, to: d(first, -1) }
    default: return { from: monday, to: today }
  }
}

// managerToken: on a regional manager's dashboard — no PIN; loads through
// regional-manager-api, which returns only that manager's team (and its roster).
export default function RepAttendance({ managerToken } = {}) {
  const [open, setOpen] = useState(false)
  const [pin, setPin] = useState(() => { if (managerToken) return 'manager'; try { return sessionStorage.getItem(PIN_KEY) || '' } catch { return '' } })
  const [pinInput, setPinInput] = useState('')
  const [range, setRange] = useState('this_week')
  const [data, setData] = useState(null)
  const [roster, setRoster] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [only, setOnly] = useState('all') // all | problems
  // 🌧 RAIN BY ZONE (Neal, 2026-10-08: "this week we've had rain … by area, when it rained"). ACTUAL rain, never a
  // forecast: for each zone, where its reps knocked this range (their average door GPS, from CCG), the hours of the
  // 9 AM–6 PM work day with a real shower (≥ 0.5 mm in the hour), from Open-Meteo's free hourly history. Today
  // counts only the hours already gone. Shown as "🌧 5 of 9 hrs" — NOT a %, which reads as a chance of rain.
  const [rain, setRain] = useState({}) // zone → { 'YYYY-MM-DD': { wet, of, mm } }
  useEffect(() => {
    if (!data?.places || !data?.days?.length) return
    const pts = {}
    for (const r of roster) { const p = data.places[r.jnid]; if (!p) continue; const z = r.zone || 'No zone'; (pts[z] = pts[z] || []).push(p) }
    let live = true
    const nowEt = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
    const todayEt = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
    Promise.all(Object.entries(pts).map(async ([z, ps]) => {
      const la = ps.reduce((t, p) => t + p[0], 0) / ps.length, lo = ps.reduce((t, p) => t + p[1], 0) / ps.length
      const j = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${la.toFixed(3)}&longitude=${lo.toFixed(3)}&hourly=precipitation&timezone=America%2FNew_York&start_date=${data.days[0]}&end_date=${data.days[data.days.length - 1]}`).then((x) => x.json()).catch(() => null)
      const out = {}
      ;(j?.hourly?.time || []).forEach((t, i) => {
        const d = t.slice(0, 10), h = +t.slice(11, 13), mm = j.hourly.precipitation[i] || 0
        if (h < 9 || h > 17 || d > todayEt) return
        if (d === todayEt && h >= nowEt.getHours()) return // not happened yet
        const o = (out[d] = out[d] || { wet: 0, of: 0, mm: 0 }); o.of += 1; o.mm += mm; if (mm >= 0.5) o.wet += 1
      })
      return [z, out]
    })).then((list) => { if (live) setRain(Object.fromEntries(list)) })
    return () => { live = false }
  }, [data, roster])

  async function load(p = pin, w = range) {
    if (!p) return
    setBusy(true); setErr('')
    try {
      const { from, to } = rangeDates(w)
      if (managerToken) {
        const res = await (await fetch('/.netlify/functions/regional-manager-api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'team_attendance', token: managerToken, from, to }) })).json()
        if (!res.ok) throw new Error(res.error || 'Could not load')
        setData(res)
        setRoster((res.team || []).slice().sort((a, b) => a.name.localeCompare(b.name)))
        setBusy(false)
        return
      }
      const [res, tr] = await Promise.all([
        fetch(CCG, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: p, from, to }) }).then((r) => r.json()),
        supabase.from('trainees').select('first_name, last_name, jobnimbus_id, rep_level, region').eq('is_active_sales_rep', true).not('jobnimbus_id', 'is', null),
      ])
      if (!res.ok) {
        if (/PIN/i.test(res.error || '')) { try { sessionStorage.removeItem(PIN_KEY) } catch { /* ignore */ } setPin('') }
        throw new Error(res.error || 'Could not load')
      }
      setData(res)
      // William's TMS record has no JobNimbus id; CCG names him (res.trainer) so he can be matched.
      const extra = res.trainer && !(tr.data || []).some((t) => t.jobnimbus_id === res.trainer.jnid)
        ? [{ first_name: res.trainer.name, last_name: '', jobnimbus_id: res.trainer.jnid, rep_level: null, region: 'Trainer' }] : []
      setRoster([...(tr.data || []), ...extra]
        .map((t) => ({ name: `${t.first_name || ''} ${t.last_name || ''}`.trim(), jnid: t.jobnimbus_id, level: t.rep_level, zone: t.region }))
        // William (the trainer) at the bottom in his own group (Neal, 2026-10-02).
        .map((t) => (t.name.toLowerCase() === 'william hernandez' ? { ...t, zone: 'Trainer' } : t))
        .filter((t) => t.zone === 'Trainer' || !NOT_A_FIELD_REP.has(t.name.toLowerCase()))
        .sort((a, b) => String(a.zone || '~').localeCompare(String(b.zone || '~')) || a.name.localeCompare(b.name)))
    } catch (x) { setErr(x.message || 'Could not load') }
    setBusy(false)
  }
  useEffect(() => { if (open && pin && !data && !busy) load() }, [open, pin]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveGoal = async (v) => {
    try {
      const j = await (await fetch(CCG, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin, daily_doors: v }) })).json()
      if (j.ok) setData((d) => ({ ...d, daily_doors: j.daily_doors }))
    } catch { /* ignore */ }
  }
  const usePin = () => {
    const p = pinInput.trim(); if (!p) return
    try { sessionStorage.setItem(PIN_KEY, p) } catch { /* ignore */ }
    setPin(p); setPinInput(''); load(p)
  }

  // One cell per rep per day (Saturday/Sunday too: counted when worked, 'off' otherwise).
  const cell = (r, ds) => {
    const a = data.reps[r.jnid] || {}
    const x = a.days?.[ds]
    const doors = data.doors[r.jnid]?.[ds] || 0
    const appts = data.appts?.[r.jnid]?.[ds] || 0
    // Hours out knocking = first door to last door on DoorDispatcher that day.
    const sp = data.door_span?.[r.jnid]?.[ds] || null
    const hrs = data.active_hrs?.[r.jnid]?.[ds] || 0 // active time: gaps over 30 min left out
    const span = sp ? `${etTime(sp[0])}–${etTime(sp[1])}` : ''
    const trained = !!data.training?.[r.jnid]?.[ds]
    // DoorDispatcher counts as signing in (Neal, 2026-10-01) — earliest of the two is "first on".
    const mapAt = data.map_first?.[r.jnid]?.[ds] || null
    if (data.off_days.includes(ds)) return { kind: 'off', doors, appts, hrs, span }
    if (x?.first || mapAt) {
      const first = [x?.first, mapAt].filter(Boolean).sort()[0]
      return { kind: 'in', x: { ...(x || {}), first, last: x?.last || mapAt }, via: x?.first && mapAt ? 'both' : x?.first ? 'dash' : 'map', doors, appts, hrs, span, trained }
    }
    if (trained) return { kind: 'training', doors, appts, hrs, span }
    // Saturday / Sunday they didn't work: just off — not missed, nothing to explain (Neal, 2026-10-05).
    if ((data.weekend_days || []).includes(ds)) return { kind: 'weekend', doors, appts, hrs, span }
    if (x?.reason) return { kind: 'reason', x, doors, appts, hrs, span }
    if (ds === data.today) return { kind: 'today', doors, appts, hrs, span }
    const mapStart = Object.keys(data.map_first?.[r.jnid] || {}).sort()[0]
    const startedOn = [a.started_on, mapStart].filter(Boolean).sort()[0]
    if (!startedOn) return { kind: a.pin_set_at ? 'notstarted' : 'nopin', doors, appts, hrs, span }
    if (startedOn > ds) return { kind: 'before', doors, appts, hrs, span }
    return { kind: 'missing', doors, appts, hrs, span }
  }
  // PIN DAYS (Neal, 2026-10-01: "not missed about pins"): only a normal working day counts
  // toward the daily door goal. Training with William, sick / personal / vacation / other,
  // holidays, days before their first check-in and today (not over yet) don't.
  const counts = (c) => (c.kind === 'in' && !c.trained) || c.kind === 'missing'
  const goal = data?.daily_doors || 0
  const rows = data ? roster.map((r) => {
    const cells = data.days.map((ds) => { const c = cell(r, ds); return { ...c, counts: counts(c) } })
    const pinDays = cells.filter((c) => c.counts)
    const pinDoors = pinDays.reduce((t, c) => t + (c.doors || 0), 0)
    r = { ...r, pinDays: pinDays.length, avg: pinDays.length ? Math.round(pinDoors / pinDays.length) : null, hit: goal ? pinDays.filter((c) => c.doors >= goal).length : null }
    return { ...r, cells, missing: cells.filter((c) => c.kind === 'missing').length, never: cells.some((c) => c.kind === 'nopin' || c.kind === 'notstarted'), excused: cells.filter((c) => c.kind === 'reason').length, present: cells.filter((c) => c.kind === 'in' || c.kind === 'training').length, doors: cells.reduce((t, c) => t + (c.doors || 0), 0), appts: cells.reduce((t, c) => t + (c.appts || 0), 0), hrs: Math.round(cells.reduce((t, c) => t + (c.hrs || 0), 0) * 10) / 10 }
  }) : []
  const shown = only === 'problems' ? rows.filter((r) => r.missing || r.excused || r.never) : rows
  const notStarted = data && data.today < data.start
  // BY ZONE (Neal, 2026-10-02): a header row per zone with its totals, then its reps.
  const zones = (() => {
    const m = new Map()
    for (const r of shown) { const z = r.zone || 'No zone'; (m.get(z) || m.set(z, []).get(z)).push(r) }
    const rank = (z) => (z === 'Trainer' ? 2 : z === 'No zone' ? 1 : 0)
    return [...m.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0], undefined, { numeric: true })).map(([zone, reps]) => {
      const sum = (f) => reps.reduce((t, r) => t + (f(r) || 0), 0)
      const pinDays = sum((r) => r.pinDays)
      const pinDoors = reps.reduce((t, r) => t + r.cells.filter((c) => c.counts).reduce((u, c) => u + (c.doors || 0), 0), 0)
      return {
        zone, reps, present: sum((r) => r.present), excused: sum((r) => r.excused), missing: sum((r) => r.missing),
        appts: sum((r) => r.appts), doors: sum((r) => r.doors), hrs: Math.round(sum((r) => r.hrs) * 10) / 10,
        avg: pinDays ? Math.round(pinDoors / pinDays) : null,
        byDay: (data?.days || []).map((_, i) => ({
          appts: reps.reduce((t, r) => t + (r.cells[i]?.appts || 0), 0),
          doors: reps.reduce((t, r) => t + (r.cells[i]?.doors || 0), 0),
          hrs: Math.round(reps.reduce((t, r) => t + (r.cells[i]?.hrs || 0), 0) * 10) / 10,
        })),
      }
    })
  })()

  return (
    <section className="mb-4 rounded-xl border-2 border-indigo-700 bg-white">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 rounded-t-lg bg-indigo-700 px-4 py-3 text-left text-white">
        <span className="text-lg font-bold">🗓️ Rep attendance</span>
        <span className="text-sm opacity-90">{open ? '▾ Hide' : '▸ Who checked in each day, and why not'}</span>
      </button>
      {open && (
        <div className="p-3">
          {!pin ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-700">Reasons can be private (sick days), so enter your admin PIN once more:</span>
              <input type="password" inputMode="numeric" value={pinInput} onChange={(e) => setPinInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && usePin()}
                className="w-28 rounded-md border border-slate-300 px-2 py-1" placeholder="PIN" />
              <button type="button" onClick={usePin} className="rounded-md bg-indigo-700 px-3 py-1 font-bold text-white">Open</button>
              {err && <span className="font-semibold text-red-700">{err}</span>}
            </div>
          ) : (
            <>
              <p className="mb-2 text-sm text-slate-600">
                A rep is <b>checked in</b> when they open their personal dashboard <b>or DoorDispatcher</b> that day (🗺️ = DoorDispatcher). It takes effect for each rep the first time they sign in after it began (days before that aren&rsquo;t counted; orange = hasn&rsquo;t signed in yet).
                {' '}A weekday they missed after that has to be given a reason the next time they sign in —
                {' '}<b>sick, personal, vacation or other</b> — so those days aren&rsquo;t held against their daily pins. A day William took them out shows <b>🎓 Training</b> and is never asked about.
                {' '}<b>Pin days:</b> only normal working days count toward the daily door goal — training, sick, personal, vacation, other and holidays say <i>not counted</i>. <b>📅 Appts</b> = sales appointments on their JobNimbus calendar that day. <b>⏱ Hrs</b> = active time knocking on DoorDispatcher (the time between doors, leaving out any gap over 30 minutes — an appointment, lunch, the drive). <b>🚪 Doors</b> = houses they knocked and statused on DoorDispatcher that day (each house counts once a day). <b>🌧 rained 5 of 9 hrs</b> (on each team's row) = it ACTUALLY rained in 5 of the 9 work hours (9 AM–6 PM) where that team knocked — measured rain, not a chance-of-rain forecast; today counts only the hours so far.
              </p>
              {notStarted && <div className="mb-2 rounded-md bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">Tracking starts {dayLabel(data.start)}. Days before that aren&rsquo;t counted.</div>}
              <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                {[['all', 'Everyone'], ['problems', 'Missed or excused days']].map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setOnly(k)} className={`rounded-full px-3 py-1 font-semibold ${only === k ? 'bg-indigo-700 text-white' : 'border border-slate-300 text-slate-700'}`}>{l}</button>
                ))}
                <div className="flex flex-wrap gap-1">
                  {RANGES.map(([k, l]) => (
                    <button key={k} type="button" onClick={() => { setRange(k); load(pin, k) }}
                      className={`rounded-md px-3 py-1 text-sm font-semibold ${range === k ? 'bg-indigo-700 text-white' : 'border border-slate-300 text-slate-700 hover:bg-slate-50'}`}>{l}</button>
                  ))}
                </div>
                {managerToken ? (data?.daily_doors ? <span className="ml-2 text-slate-700">Daily door goal: <b>{data.daily_doors}</b></span> : null) : <>
                <span className="ml-2 text-slate-700">Daily door goal:</span>
                <input type="number" min="0" defaultValue={data?.daily_doors || ''} key={data?.daily_doors || 'none'} placeholder="none"
                  onBlur={(e) => { const v = e.target.value; if (String(v) !== String(data?.daily_doors || '')) saveGoal(v) }}
                  className="w-20 rounded-md border border-slate-300 px-2 py-1" />
                </>}
                <button type="button" onClick={() => load()} disabled={busy} className="ml-auto rounded-md border border-slate-300 px-3 py-1 font-semibold text-slate-600 disabled:opacity-60">{busy ? 'Loading…' : '↻ Refresh'}</button>
              </div>
              {err && <div className="mb-2 text-sm font-semibold text-red-700">{err}</div>}
              {data && (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700">
                        <th className="sticky left-0 z-10 bg-slate-100 px-2 py-1.5 text-left">Rep</th>
                        <th className="px-2 py-1.5 text-center" title="Checked in / excused / missed with no reason">In · Exc · Miss</th>
                        <th className="px-2 py-1.5 text-center" title="Sales appointments on their JobNimbus calendar across these days (come-backs not counted; a rescheduled house counts once)">📅 Appts</th>
                        <th className="px-2 py-1.5 text-center" title="Doors worked on DoorDispatcher across these days">🚪 Doors</th>
                        <th className="px-2 py-1.5 text-center" title="Active hours knocking on DoorDispatcher (gaps over 30 min left out), added up over these days">⏱ Hrs</th>
                        <th className="px-2 py-1.5 text-center" title="Average doors on the days that count toward the daily goal (not training, sick, personal, vacation or holidays)">🎯 Avg / pin day</th>
                        {data.days.map((ds) => <th key={ds} className={`whitespace-nowrap px-2 py-1.5 text-center ${(data.weekend_days || []).includes(ds) ? 'bg-slate-100 text-slate-500' : ''}`}>{dayLabel(ds)}</th>)}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {zones.map((z) => (<Fragment key={z.zone}>
                        <tr className="bg-indigo-50">
                          <td className="sticky left-0 z-10 bg-indigo-50 px-2 py-1.5 text-sm font-extrabold text-indigo-900">{z.zone} <span className="text-[11px] font-semibold text-indigo-700">· {z.reps.length} rep{z.reps.length === 1 ? '' : 's'}</span></td>
                          <td className="px-2 py-1.5 text-center text-xs font-bold text-indigo-900">{z.present} · {z.excused} · {z.missing}</td>
                          <td className="px-2 py-1.5 text-center text-sm font-extrabold text-indigo-900">{z.appts}</td>
                          <td className="px-2 py-1.5 text-center text-sm font-extrabold text-indigo-900">{z.doors}</td>
                          <td className="px-2 py-1.5 text-center text-sm font-extrabold text-indigo-900">{z.hrs}</td>
                          <td className="px-2 py-1.5 text-center text-xs font-bold text-indigo-900">{z.avg == null ? '—' : `${z.avg} avg`}</td>
                          {data.days.map((ds, i) => (
                            <td key={ds} className="whitespace-nowrap px-2 py-1.5 text-center text-[11px] font-bold text-indigo-900">
                              {z.byDay[i].appts ? `📅 ${z.byDay[i].appts} · ` : ''}🚪 {z.byDay[i].doors} · ⏱ {z.byDay[i].hrs}h
                              {(() => { const w = rain[z.zone]?.[ds]; if (!w || !w.of) return null
                                const tip = `Actual rain where ${z.zone} knocked (not a forecast): it rained in ${w.wet} of the ${w.of} work hours (9 AM–6 PM)${w.of < 9 ? ' so far today' : ''}, ${(w.mm / 25.4).toFixed(2)} in total.`
                                return <div title={tip} className={`mt-0.5 text-[11px] font-extrabold ${w.wet ? 'text-sky-700' : 'text-slate-400'}`}>{w.wet ? `🌧 rained ${w.wet} of ${w.of} hrs` : `☀️ dry${w.of < 9 ? ' so far' : ''}`}</div> })()}
                            </td>
                          ))}
                        </tr>
                      {z.reps.map((r) => (
                        <tr key={r.jnid}>
                          <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-2 py-1.5 font-semibold text-slate-900">
                            {r.name}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-center font-semibold">
                            <span className="text-emerald-700">{r.present}</span> · <span className="text-sky-700">{r.excused}</span> · <span className={r.missing ? 'text-red-700' : 'text-slate-400'}>{r.missing}</span>
                          </td>
                          <td className="px-2 py-1.5 text-center text-sm font-bold text-slate-800">{r.appts}</td>
                          <td className="px-2 py-1.5 text-center text-sm font-bold text-slate-800">{r.doors}</td>
                          <td className="px-2 py-1.5 text-center text-sm font-bold text-slate-800">{r.hrs || 0}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-center">
                            {r.avg == null ? <span className="text-slate-300">—</span> : (
                              <>
                                <span className={`text-sm font-bold ${goal ? (r.avg >= goal ? 'text-emerald-700' : 'text-red-700') : 'text-slate-800'}`}>{r.avg}</span>
                                <div className="text-[10px] text-slate-500">{goal ? `${r.hit} of ${r.pinDays} days hit ${goal}` : `${r.pinDays} pin day${r.pinDays === 1 ? '' : 's'}`}</div>
                              </>
                            )}
                          </td>
                          {r.cells.map((c, i) => (
                            <td key={i} className="whitespace-nowrap px-2 py-1.5 text-center">
                              {c.kind === 'in' && <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-bold text-emerald-800" title={`${c.via === 'map' ? 'On DoorDispatcher' : c.via === 'both' ? 'On DoorDispatcher and the dashboard' : 'On the dashboard'} — first ${etTime(c.x.first)}`}>✓ {etTime(c.x.first)}{c.via !== 'dash' ? ' 🗺️' : ''}</span>}
                              {c.kind === 'training' && <span className="rounded bg-indigo-100 px-1.5 py-0.5 font-bold text-indigo-800" title="Out in the field with William (his ride-along picks)">🎓 Training</span>}
                              {c.kind === 'in' && c.trained && <div className="mt-0.5 text-[10px] font-bold text-indigo-700">🎓 with William</div>}
                              {c.kind === 'reason' && <span className={`rounded px-1.5 py-0.5 font-bold ${REASON[c.x.reason]?.[1] || ''}`} title={c.x.note || ''}>{REASON[c.x.reason]?.[0] || c.x.reason}{c.x.note ? ' 💬' : ''}</span>}
                              {c.kind === 'missing' && <span className="rounded bg-red-100 px-1.5 py-0.5 font-bold text-red-800" title="Not on the dashboard and no reason given yet">✗ no reason</span>}
                              {c.kind === 'nopin' && <span className="rounded bg-orange-100 px-1.5 py-0.5 font-bold text-orange-800" title="Has never set up their dashboard PIN, so their check-ins haven't started">no PIN yet</span>}
                              {c.kind === 'notstarted' && <span className="rounded bg-orange-100 px-1.5 py-0.5 font-bold text-orange-800" title="Hasn't signed in since check-ins began, so their clock hasn't started">not signed in yet</span>}
                              {c.kind === 'today' && <span className="text-slate-400">not yet</span>}
                              {c.kind === 'before' && <span className="text-slate-300" title="Before their first check-in — not counted">—</span>}
                              {c.kind === 'off' && <span className="text-slate-400">holiday</span>}
                              {c.kind === 'weekend' && <span className="text-slate-300">off</span>}
                              {c.hrs > 0 && <div className="mt-0.5 text-[11px] font-bold text-slate-700" title={`Active knocking time (gaps over 30 min left out). First door ${c.span}`}>⏱ {c.hrs}h</div>}
                              {c.appts > 0 && <div className="mt-0.5 text-[11px] font-bold text-indigo-700" title="Sales appointments that day">📅 {c.appts}</div>}
                              {c.kind !== 'before' && c.kind !== 'nopin' && c.kind !== 'notstarted' || c.doors > 0 ? (
                                <div className={`mt-0.5 text-[11px] font-bold ${c.counts && goal ? (c.doors >= goal ? 'text-emerald-700' : 'text-red-700') : c.doors ? 'text-slate-800' : 'text-slate-400'}`}
                                  title={c.counts ? 'Doors worked on DoorDispatcher — this day counts toward the daily goal' : 'Doors worked on DoorDispatcher — this day does NOT count toward the daily goal'}>
                                  🚪 {c.doors}{!c.counts && (c.kind === 'training' || c.kind === 'reason' || c.kind === 'off' || c.trained) ? <span className="ml-0.5 font-normal text-slate-400">· not counted</span> : null}
                                </div>
                              ) : null}
                            </td>
                          ))}
                        </tr>
                      ))}
                      </Fragment>))}
                      {!shown.length && <tr><td colSpan={data.days.length + 6} className="px-2 py-3 text-center text-slate-500">{data.days.length ? 'Nobody to show.' : 'No weekdays in this range since tracking began (Oct 1).'}</td></tr>}
                    </tbody>
                  </table>
                  <p className="mt-2 text-[11px] text-slate-500">On a computer, point at a reason with 💬 to read the note the rep typed, or at a ✓ to see whether they checked in on their dashboard or DoorDispatcher. The ✓ time is when they first checked in that day (Eastern).</p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}
