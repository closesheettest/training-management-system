// 🗓️ COMPANY CALENDAR (Neal, 2026-10-12): every active rep × day this week — working, off all day, or off for
// certain appointment times — from what each rep answered on their Personal Dashboard ("Taking any time off this
// week?"). Everyone is working unless they say otherwise; a rep who hasn't answered is marked so the manager can
// chase it. Data: CCG rep-timeoff (action "calendar", admin PIN). Roster: TMS active sales reps with a JobNimbus id.
// While the time-off card is still a demo on Neal's dashboard, every other rep shows "hasn't answered".
import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

const CCG = 'https://free-roof-inspections.netlify.app/.netlify/functions/rep-timeoff'
const PIN_KEY = 'rm_admin_ok_pin'
const hourLabel = (h) => `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`
const ZONE_ORDER = ['Tampa', 'Orlando', 'Fort Myers', 'Jacksonville']

export default function CompanyCalendar() {
  const [open, setOpen] = useState(false)
  const [pin, setPin] = useState(() => { try { return sessionStorage.getItem(PIN_KEY) || '' } catch { return '' } })
  const [pinInput, setPinInput] = useState('')
  const [week, setWeek] = useState('')
  const [data, setData] = useState(null)
  const [roster, setRoster] = useState([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async (w = week, p = pin) => {
    if (!p) return
    setBusy(true); setErr('')
    try {
      const [res, tr] = await Promise.all([
        fetch(CCG, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'calendar', pin: p, week: w }) }).then((r) => r.json()),
        supabase.from('trainees').select('first_name, last_name, jobnimbus_id, region, rep_level, created_at')
          .eq('is_active_sales_rep', true).not('jobnimbus_id', 'is', null).order('created_at', { ascending: false }),
      ])
      if (!res.ok) {
        if (/PIN/i.test(res.error || '')) { try { sessionStorage.removeItem(PIN_KEY) } catch { /* */ } setPin('') }
        throw new Error(res.error || 'Could not load')
      }
      // One row per rep (trainees has a row per enrollment — newest wins).
      const seen = new Set(), rows = []
      for (const t of tr.data || []) {
        const id = String(t.jobnimbus_id)
        if (seen.has(id)) continue
        seen.add(id)
        rows.push({ jnid: id, name: `${t.first_name || ''} ${t.last_name || ''}`.trim(), zone: t.region || 'No zone', level: t.rep_level || '' })
      }
      // Anyone who answered but isn't on the rep roster (office people trying it) still shows.
      for (const [id, e] of Object.entries(res.entries || {})) if (!seen.has(id)) rows.push({ jnid: id, name: e.name || id, zone: 'Office', level: '' })
      setRoster(rows); setData(res); setWeek(res.week)
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  useEffect(() => { if (open && pin && !data) load() }, [open, pin]) // eslint-disable-line react-hooks/exhaustive-deps

  const usePin = () => { const p = pinInput.trim(); if (!p) return; try { sessionStorage.setItem(PIN_KEY, p) } catch { /* */ } setPin(p); load(week, p) }

  const cell = (entry, d) => {
    // Everyone is working unless they said otherwise (Neal, 2026-10-12) — no answer shows as working.
    const v = entry?.off?.[d.date]
    if (v === 'all') return <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-bold text-red-800">Off</span>
    if (Array.isArray(v)) return <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-800" title={`Can't run ${v.map(hourLabel).join(', ')}`}>✕ {v.map(hourLabel).join(', ')}</span>
    if (d.optional) return <span className="text-slate-400 text-xs">—</span>
    return <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-bold text-emerald-800">✓</span>
  }

  const byZone = {}
  for (const r of roster) (byZone[r.zone] = byZone[r.zone] || []).push(r)
  const zones = Object.keys(byZone).sort((a, b) => {
    const ia = ZONE_ORDER.indexOf(a), ib = ZONE_ORDER.indexOf(b)
    return (ia === -1 ? 90 : ia) - (ib === -1 ? 90 : ib) || a.localeCompare(b)
  })
  const entries = data?.entries || {}
  const answered = roster.filter((r) => entries[r.jnid]).length

  return (
    <section className="mb-4 rounded-xl border-2 border-sky-700 bg-white">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 rounded-t-lg bg-sky-700 px-4 py-3 text-left text-white">
        <span className="text-lg font-bold">🗓️ Company calendar</span>
        <span className="text-sm opacity-90">{open ? '▾ Hide' : '▸ Who is working which days this week'}</span>
      </button>
      {open && (
        <div className="p-3">
          {!pin ? (
            <div className="flex items-center gap-2 text-sm">
              <span>Admin PIN:</span>
              <input type="password" inputMode="numeric" value={pinInput} onChange={(e) => setPinInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && usePin()} className="w-28 rounded border border-slate-300 px-2 py-1" />
              <button type="button" onClick={usePin} className="rounded-md bg-sky-700 px-3 py-1 font-bold text-white">Open</button>
            </div>
          ) : !data ? (
            <div className="text-sm text-slate-500">{err || (busy ? 'Loading…' : '')}</div>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                {data.weeks.map((w, i) => (
                  <button key={w} type="button" onClick={() => load(w)}
                    className={`rounded-md border px-3 py-1 font-semibold ${w === week ? 'border-sky-700 bg-sky-700 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>
                    {i === 0 ? 'This week' : 'Next week'} · {w.slice(5).replace('-', '/')}
                  </button>
                ))}
                <span className="ml-auto text-slate-600"><b>{roster.filter((r) => Object.keys(entries[r.jnid]?.off || {}).length).length}</b> taking time off · {answered} of {roster.length} answered</span>
              </div>
              <div className="mb-2 flex flex-wrap gap-3 text-xs text-slate-600">
                <span><span className="rounded bg-emerald-100 px-1.5 font-bold text-emerald-800">✓</span> working</span>
                <span><span className="rounded bg-red-100 px-1.5 font-bold text-red-800">Off</span> all day</span>
                <span><span className="rounded bg-amber-100 px-1.5 font-bold text-amber-800">✕ 12 PM</span> can't run those times</span>
                <span>No answer = working</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                      <th className="px-2 py-1.5">Rep</th>
                      {data.days.map((d) => <th key={d.date} className={`px-2 py-1.5 text-center ${d.past ? 'opacity-50' : ''}`}>{d.label.split(' ')[0].slice(0, 3)} {d.label.split(' ')[1]}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {zones.map((z) => (
                      <Fragment key={z}>
                        <tr><td colSpan={1 + data.days.length} className="bg-slate-100 px-2 py-1 text-xs font-bold uppercase tracking-wide text-slate-600">{z}</td></tr>
                        {byZone[z].sort((a, b) => a.name.localeCompare(b.name)).map((r) => {
                          const e = entries[r.jnid]
                          const offDays = e ? Object.keys(e.off || {}).length : 0
                          return (
                            <tr key={r.jnid} className="border-b border-slate-50">
                              <td className="px-2 py-1.5 font-semibold text-slate-800">
                                {r.name}{r.level === 'senior' ? <span className="ml-1 text-[10px] text-slate-400">SR</span> : null}
                                {offDays > 0 && <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-700">time off</span>}
                              </td>
                              {data.days.map((d) => <td key={d.date} className={`px-2 py-1.5 text-center ${d.past ? 'opacity-50' : ''}`}>{cell(e, d)}</td>)}
                            </tr>
                          )
                        })}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              {err && <div className="mt-2 text-sm text-red-700">{err}</div>}
            </>
          )}
        </div>
      )}
    </section>
  )
}
