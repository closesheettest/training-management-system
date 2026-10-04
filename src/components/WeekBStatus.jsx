// WEEK B STATUS on the class page (Neal, 2026-10-04): what's going on with each trainee's Week B —
// link sent / opened, Week A effort (30 doors a day over Thu–Sat, William days left out), in or
// turned away, 🔥 committed to prove it, and doors so far this week. Data: meet.js class_week_b.
import { useEffect, useState } from 'react'

const when = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '')

export default function WeekBStatus({ classId }) {
  const [d, setD] = useState(null)
  const load = () => fetch('/.netlify/functions/meet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'class_week_b', class_id: classId }) }).then((r) => r.json()).then(setD).catch(() => setD({ ok: false }))
  useEffect(() => { load() }, [classId]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <section className="mt-6 rounded-lg border border-indigo-200 bg-white p-5 text-sm text-slate-500">Loading Week B status…</section>
  if (!d.ok) return null
  // People who didn't finish Week A aren't part of Week B — leave them off (Neal, 2026-10-04).
  const P = d.people.filter((x) => !x.missed_last_day)
  const outN = d.people.length - P.length
  return (
    <section className="mt-6 rounded-lg border-2 border-indigo-300 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold text-indigo-900">🎥 Week B: virtual + effort check</h2>
        <span className="flex-1" />
        {d.room && <a href={`/meet/${d.room.slug}`} target="_blank" rel="noreferrer" className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-bold text-white">Join {d.room.title} as host</a>}
        <button onClick={load} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold">↻ Refresh</button>
      </div>
      <p className="mt-1 text-sm text-slate-600">
        Week B needs an average of <b>{d.needed} doors a day</b> on DoorDispatcher over Week A Thu–Sat (days with William don't count).
        {d.room && !d.room.effort_gate && <b className="text-amber-700"> The effort rule is OFF on the Week B room.</b>}
        {' '}<b>{P.filter((x) => x.qualified).length}</b> qualified · <b>{P.filter((x) => !x.qualified && !x.missed_last_day).length}</b> on the second chance · <b>{P.filter((x) => x.committed).length}</b> 🔥 committed · {outN ? <span className="text-slate-400">({outN} who didn't finish Week A not shown)</span> : null}
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-left text-slate-500"><tr><th className="py-1 pr-3">Trainee</th><th className="pr-3">Week A doors/day</th><th className="pr-3">Status</th><th className="pr-3">Week B link</th><th className="pr-3">Committed</th><th>This week so far</th></tr></thead>
          <tbody>{P.map((x) => (
            <tr key={x.name} className="border-t border-slate-100">
              <td className="py-1.5 pr-3 font-semibold">{x.name}</td>
              <td className="pr-3" title={Object.entries(x.week_a_perDay || {}).map(([k, v]) => `${k}: ${v}`).join(' · ')}>{x.week_a_avg === null ? 'all days with William' : x.week_a_avg}{x.william_days?.length ? ` (${x.william_days.length} William day${x.william_days.length > 1 ? 's' : ''} not counted)` : ''}{!x.map ? <span className="text-xs text-slate-400"> · no map access</span> : null}</td>
              <td className="pr-3">{x.missed_last_day ? <span className="rounded bg-red-100 px-1.5 text-xs font-bold text-red-800">Out: missed last class day</span> : x.override ? <span className="rounded bg-slate-200 px-1.5 text-xs font-bold">Let in (override)</span> : x.qualified ? <span className="rounded bg-emerald-100 px-1.5 text-xs font-bold text-emerald-800">Qualified</span> : x.result === 'enrolled' ? <span className="rounded bg-emerald-100 px-1.5 text-xs font-bold text-emerald-800">Proved it: enrolled</span> : x.declined ? <span className="rounded bg-slate-200 px-1.5 text-xs font-bold text-slate-700">Said no: training isn't for them</span> : <span className="rounded bg-amber-100 px-1.5 text-xs font-bold text-amber-800">Turned away: second chance</span>}</td>
              <td className="pr-3 text-xs">{x.link_sent ? `sent ${when(x.link_sent)}` : <span className="text-slate-400">not sent</span>}{x.opened ? <div className="text-emerald-700">👀 opened {when(x.opened)}</div> : x.link_sent ? <div className="text-slate-400">not opened yet</div> : null}</td>
              <td className="pr-3 text-xs">{x.committed ? <span className="font-bold text-orange-700">🔥 {when(x.committed)}</span> : x.declined ? <span className="text-slate-500">✋ said no {when(x.declined)}</span> : x.opened ? <span className="font-semibold text-amber-700">saw it, didn't answer</span> : x.qualified || x.missed_last_day ? '' : <span className="text-slate-400">not yet</span>}</td>
              <td className="text-xs">{x.so_far != null ? <span className={x.so_far >= d.needed ? 'font-bold text-emerald-700' : 'font-bold text-amber-700'}>{x.so_far}/day {x.so_far >= d.needed ? '✓ on track' : `(needs ${d.needed})`}</span> : ''}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  )
}
