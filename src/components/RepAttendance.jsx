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

export default function RepAttendance() {
  const [open, setOpen] = useState(false)
  const [pin, setPin] = useState(() => { try { return sessionStorage.getItem(PIN_KEY) || '' } catch { return '' } })
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
    if (data.off_days.includes(ds)) return { kind: 'off' }
    if (x?.first) return { kind: 'in', x, doors }
    if (x?.reason) return { kind: 'reason', x, doors }
    if (ds === data.today) return { kind: 'today', doors }
    if (!a.started_on) return { kind: a.pin_set_at ? 'notstarted' : 'nopin', doors }
    if (a.started_on > ds) return { kind: 'before', doors }
    return { kind: 'missing', doors }
  }
  const rows = data ? roster.map((r) => {
    const cells = data.days.map((ds) => cell(r, ds))
    return { ...r, cells, missing: cells.filter((c) => c.kind === 'missing').length, never: cells.some((c) => c.kind === 'nopin' || c.kind === 'notstarted'), excused: cells.filter((c) => c.kind === 'reason').length, present: cells.filter((c) => c.kind === 'in').length }
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
                A rep is <b>checked in</b> when they open their personal dashboard that day. It takes effect for each rep the first time they sign in after it began (days before that aren&rsquo;t counted; orange = hasn&rsquo;t signed in yet).
                {' '}A weekday they missed after that has to be given a reason the next time they sign in —
                {' '}<b>sick, personal, vacation or other</b> — so those days aren&rsquo;t held against their daily pins. <b>Doors</b> = houses they worked on the map that day.
              </p>
              {notStarted && <div className="mb-2 rounded-md bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">Tracking starts {dayLabel(data.start)}. Days before that aren&rsquo;t counted.</div>}
              <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                {[['all', 'Everyone'], ['problems', 'Missed or excused days']].map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setOnly(k)} className={`rounded-full px-3 py-1 font-semibold ${only === k ? 'bg-indigo-700 text-white' : 'border border-slate-300 text-slate-700'}`}>{l}</button>
                ))}
                <select value={weeks} onChange={(e) => { const w = Number(e.target.value); setWeeks(w); load(pin, w) }} className="rounded-md border border-slate-300 px-2 py-1">
                  <option value={1}>This week</option><option value={2}>Last 2 weeks</option><option value={4}>Last 4 weeks</option>
                </select>
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
                          {r.cells.map((c, i) => (
                            <td key={i} className="whitespace-nowrap px-2 py-1.5 text-center">
                              {c.kind === 'in' && <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-bold text-emerald-800" title={`First on ${etTime(c.x.first)}, last ${etTime(c.x.last)}`}>✓ {etTime(c.x.first)}</span>}
                              {c.kind === 'reason' && <span className={`rounded px-1.5 py-0.5 font-bold ${REASON[c.x.reason]?.[1] || ''}`} title={c.x.note || ''}>{REASON[c.x.reason]?.[0] || c.x.reason}{c.x.note ? ' 💬' : ''}</span>}
                              {c.kind === 'missing' && <span className="rounded bg-red-100 px-1.5 py-0.5 font-bold text-red-800" title="Not on the dashboard and no reason given yet">✗ no reason</span>}
                              {c.kind === 'nopin' && <span className="rounded bg-orange-100 px-1.5 py-0.5 font-bold text-orange-800" title="Has never set up their dashboard PIN, so their check-ins haven't started">no PIN yet</span>}
                              {c.kind === 'notstarted' && <span className="rounded bg-orange-100 px-1.5 py-0.5 font-bold text-orange-800" title="Hasn't signed in since check-ins began, so their clock hasn't started">not signed in yet</span>}
                              {c.kind === 'today' && <span className="text-slate-400">not yet</span>}
                              {c.kind === 'before' && <span className="text-slate-300" title="Before their first check-in — not counted">—</span>}
                              {c.kind === 'off' && <span className="text-slate-400">holiday</span>}
                              {c.doors > 0 && <div className="mt-0.5 text-[10px] text-slate-600">{c.doors} doors</div>}
                            </td>
                          ))}
                        </tr>
                      ))}
                      {!shown.length && <tr><td colSpan={data.days.length + 2} className="px-2 py-3 text-center text-slate-500">{data.days.length ? 'Nobody to show.' : 'No weekdays tracked yet.'}</td></tr>}
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
