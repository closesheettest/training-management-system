// 📅 TODAY'S APPOINTMENTS (Neal, 2026-10-12: "on the regional manager's dashboard, let's have today's appointments …
// it would show Eli has three fives"). The team's full load for today, one line per rep with their times, and a red
// flag when a rep has more than one at the same time. Same data as the Assign board's Today view (app bookings +
// everything in JobNimbus for the team), via regional-manager-api list-appointments.
import { useEffect, useState } from 'react'

const timeOf = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })

export default function TodayAppts({ token }) {
  const [items, setItems] = useState(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState('')   // rep whose homeowners are showing

  useEffect(() => {
    let stop = false
    const load = () => fetch('/.netlify/functions/regional-manager-api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list-appointments', token, view: 'today' }) })
      .then((r) => r.json()).then((d) => { if (stop) return; if (d.ok) { setItems(d.items || []); setErr('') } else setErr(d.error || 'Could not load') })
      .catch(() => { if (!stop) setErr('Could not load') })
    load()
    const t = setInterval(load, 5 * 60 * 1000)   // a booking made during the day shows up on its own
    return () => { stop = true; clearInterval(t) }
  }, [token])

  if (err && !items) return null
  const byRep = new Map()
  for (const a of items || []) {
    const rep = a.sales_rep_name || a.owner_name || 'Unassigned'
    if (!byRep.has(rep)) byRep.set(rep, [])
    byRep.get(rep).push(a)
  }
  const reps = [...byRep.entries()].sort((a, b) => (a[0] === 'Unassigned') - (b[0] === 'Unassigned') || b[1].length - a[1].length || a[0].localeCompare(b[0]))
  const stacked = (list) => {
    const n = {}; for (const a of list) { const k = timeOf(a.appt_at); n[k] = (n[k] || 0) + 1 }
    return Object.entries(n).filter(([, c]) => c > 1)
  }
  const anyStack = reps.some(([r, l]) => r !== 'Unassigned' && stacked(l).length)

  return (
    <section className={`mb-5 rounded-xl border-2 ${anyStack ? 'border-red-500' : 'border-slate-600'} bg-slate-900/60 p-3`}>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-lg font-extrabold text-white">📅 Today's appointments{items ? ` · ${items.length}` : ''}</div>
        {anyStack && <div className="rounded bg-red-600 px-2 py-0.5 text-xs font-bold text-white">⚠ Stacked times</div>}
      </div>
      {!items ? <div className="text-sm text-slate-400">Loading…</div> : !items.length ? <div className="text-sm text-slate-400">No appointments today.</div> : (
        <div className="space-y-1.5">
          {reps.map(([rep, list]) => {
            const st = rep === 'Unassigned' ? [] : stacked(list)
            const stackedTimes = new Set(st.map(([t]) => t))
            return (
              <div key={rep} className={`rounded-lg px-3 py-2 ${rep === 'Unassigned' ? 'bg-amber-900/40' : st.length ? 'bg-red-900/40' : 'bg-slate-800/70'}`}>
                <button type="button" onClick={() => setOpen(open === rep ? '' : rep)} className="flex w-full flex-wrap items-center gap-2 text-left">
                  <span className={`min-w-[9rem] font-bold ${rep === 'Unassigned' ? 'text-amber-300' : 'text-white'}`}>{rep}</span>
                  <span className="text-xs text-slate-400">{list.length}</span>
                  {list.map((a, i) => (
                    <span key={i} className={`rounded px-1.5 py-0.5 text-xs font-bold ${stackedTimes.has(timeOf(a.appt_at)) ? 'bg-red-600 text-white' : 'bg-slate-700 text-slate-100'}`}>{timeOf(a.appt_at)}</span>
                  ))}
                  {st.map(([t, c]) => <span key={t} className="text-xs font-bold text-red-300">⚠ {c} at {t}</span>)}
                </button>
                {open === rep && (
                  <ul className="mt-1.5 space-y-0.5 pl-1 text-xs text-slate-300">
                    {list.map((a, i) => (
                      <li key={i}><b className="text-slate-100">{timeOf(a.appt_at)}</b> · {a.homeowner || 'Appointment'}{a.address ? ` · ${a.address}` : ''}{a.src ? <span className="text-slate-500"> · {a.src}</span> : null}</li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
