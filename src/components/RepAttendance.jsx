// REP ATTENDANCE (Neal, 2026-10-01): reps have a daily pin quota, and their personal
// dashboard (CCG ?mode=rep) is their Mon–Fri check-in. A weekday they weren't on it has to be
// given a reason (sick / personal / vacation / other) the next time they sign in, so a sick
// day isn't held against them. This lists every active rep × weekday: checked in (with doors
// worked on the map that day), the reason they gave, or ✗ no reason yet. Data: CCG
// rep-attendance (admin PIN). Roster: TMS active sales reps with a JobNimbus id.
import { useEffect, useState } from 'react'
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

// managerToken: on a regional manager's dashboard — no PIN; loads through
// regional-manager-api, which returns only that manager's team (and its roster).
export default function RepAttendance({ managerToken } = {}) {
  const [open, setOpen] = useState(false)
  const [pin, setPin] = useState(() => { if (managerToken) return 'manager'; try { return sessionStorage.getItem(PIN_KEY) || '' } catch { return '' } })
  const [pinInput, setPinInput] = useState('')
  const [weeks, setWeeks] = useState(2)
  const [data, setData] = useState(null)
  const [roster, setRoster] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [only, setOnly] = useState('all') // all | problems

  async function load(p = pin, w = weeks) {
    if (!p) return
    setBusy(true); setErr('')
    try {
      const from = etDay(Date.now() - (w * 7 - 1) * 864e5)
      if (managerToken) {
        const res = await (await fetch('/.netlify/functions/regional-manager-api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'team_attendance', token: managerToken, from }) })).json()
        if (!res.ok) throw new Error(res.error || 'Could not load')
        setData(res)
        setRoster((res.team || []).slice().sort((a, b) => a.name.localeCompare(b.name)))
        setBusy(false)
        return
      }
      const [res, tr] = await Promise.all([
        fetch(CCG, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: p, from }) }).then((r) => r.json()),
        supabase.from('trainees').select('first_name, last_name, jobnimbus_id, rep_level, region').eq('is_active_sales_rep', true).not('jobnimbus_id', 'is', null),
      ])
      if (!res.ok) {
        if (/PIN/i.test(res.error || '')) { try { sessionStorage.removeItem(PIN_KEY) } catch { /* ignore */ } setPin('') }
        throw new Error(res.error || 'Could not load')
      }
      setData(res)
      setRoster((tr.data || [])
        .map((t) => ({ name: `${t.first_name || ''} ${t.last_name || ''}`.trim(), jnid: t.jobnimbus_id, level: t.rep_level, zone: t.region }))
        .filter((t) => !NOT_A_FIELD_REP.has(t.name.toLowerCase()))
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

  // One cell per rep per weekday.
  const cell = (r, ds) => {
    const a = data.reps[r.jnid] || {}
    const x = a.days?.[ds]
    const doors = data.doors[r.jnid]?.[ds] || 0
    const appts = data.appts?.[r.jnid]?.[ds] || 0
    const trained = !!data.training?.[r.jnid]?.[ds]
    // DoorDispatcher counts as signing in (Neal, 2026-10-01) — earliest of the two is "first on".
    const mapAt = data.map_first?.[r.jnid]?.[ds] || null
    if (data.off_days.includes(ds)) return { kind: 'off', doors, appts }
    if (x?.first || mapAt) {
      const first = [x?.first, mapAt].filter(Boolean).sort()[0]
      return { kind: 'in', x: { ...(x || {}), first, last: x?.last || mapAt }, via: x?.first && mapAt ? 'both' : x?.first ? 'dash' : 'map', doors, appts, trained }
    }
    if (trained) return { kind: 'training', doors, appts }
    if (x?.reason) return { kind: 'reason', x, doors, appts }
    if (ds === data.today) return { kind: 'today', doors, appts }
    const mapStart = Object.keys(data.map_first?.[r.jnid] || {}).sort()[0]
    const startedOn = [a.started_on, mapStart].filter(Boolean).sort()[0]
    if (!startedOn) return { kind: a.pin_set_at ? 'notstarted' : 'nopin', doors, appts }
    if (startedOn > ds) return { kind: 'before', doors, appts }
    return { kind: 'missing', doors, appts }
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
    return { ...r, cells, missing: cells.filter((c) => c.kind === 'missing').length, never: cells.some((c) => c.kind === 'nopin' || c.kind === 'notstarted'), excused: cells.filter((c) => c.kind === 'reason').length, present: cells.filter((c) => c.kind === 'in' || c.kind === 'training').length, doors: cells.reduce((t, c) => t + (c.doors || 0), 0), appts: cells.reduce((t, c) => t + (c.appts || 0), 0) }
  }) : []
  const shown = only === 'problems' ? rows.filter((r) => r.missing || r.excused || r.never) : rows
  const notStarted = data && data.today < data.start

  return (
    <section className="mb-4 rounded-xl border-2 border-indigo-700 bg-white">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 rounded-t-lg bg-indigo-700 px-4 py-3 text-left text-white">
        <span className="text-lg font-bold">🗓️ Rep attendance</span>
        <span className="text-sm opacity-90">{open ? '▾ Hide' : '▸ Who checked in each weekday, and why not'}</span>
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
                {' '}<b>Pin days:</b> only normal working days count toward the daily door goal — training, sick, personal, vacation, other and holidays say <i>not counted</i>. <b>📅 Appts</b> = sales appointments on their JobNimbus calendar that day. <b>🚪 Doors</b> = houses they knocked and statused on DoorDispatcher that day (each house counts once a day).
              </p>
              {notStarted && <div className="mb-2 rounded-md bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">Tracking starts {dayLabel(data.start)}. Days before that aren&rsquo;t counted.</div>}
              <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                {[['all', 'Everyone'], ['problems', 'Missed or excused days']].map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setOnly(k)} className={`rounded-full px-3 py-1 font-semibold ${only === k ? 'bg-indigo-700 text-white' : 'border border-slate-300 text-slate-700'}`}>{l}</button>
                ))}
                <select value={weeks} onChange={(e) => { const w = Number(e.target.value); setWeeks(w); load(pin, w) }} className="rounded-md border border-slate-300 px-2 py-1">
                  <option value={1}>This week</option><option value={2}>Last 2 weeks</option><option value={4}>Last 4 weeks</option>
                </select>
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
                        <th className="px-2 py-1.5 text-center" title="Average doors on the days that count toward the daily goal (not training, sick, personal, vacation or holidays)">🎯 Avg / pin day</th>
                        {data.days.map((ds) => <th key={ds} className="whitespace-nowrap px-2 py-1.5 text-center">{dayLabel(ds)}</th>)}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {shown.map((r) => (
                        <tr key={r.jnid}>
                          <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-2 py-1.5 font-semibold text-slate-900">
                            {r.name}{r.zone && <span className="ml-1 text-[10px] font-normal text-slate-500">{r.zone}</span>}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-center font-semibold">
                            <span className="text-emerald-700">{r.present}</span> · <span className="text-sky-700">{r.excused}</span> · <span className={r.missing ? 'text-red-700' : 'text-slate-400'}>{r.missing}</span>
                          </td>
                          <td className="px-2 py-1.5 text-center text-sm font-bold text-slate-800">{r.appts}</td>
                          <td className="px-2 py-1.5 text-center text-sm font-bold text-slate-800">{r.doors}</td>
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
                      {!shown.length && <tr><td colSpan={data.days.length + 5} className="px-2 py-3 text-center text-slate-500">{data.days.length ? 'Nobody to show.' : 'No weekdays tracked yet.'}</td></tr>}
                    </tbody>
                  </table>
                  <p className="mt-2 text-[11px] text-slate-500">Hover a reason with 💬 to read the rep&rsquo;s note. Hover ✓ for first/last time on the dashboard (Eastern).</p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}
