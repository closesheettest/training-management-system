// INVESTMENT CLOSE SHEET ACTIVITY (Neal, 2026-09-29): "we're trying to make sure everybody
// is using the investment close sheet". Every sales appointment in the last 7 days, by day
// and rep: was the close sheet opened, and for how long (time on screen, from the sheet's
// own heartbeat). Tap an appointment for each time it was opened. Data: CCG
// close-sheet-activity.
import { Fragment, useState } from 'react'

const CCG = 'https://free-roof-inspections.netlify.app/.netlify/functions/close-sheet-activity?all=1'
const mins = (s) => (s >= 60 ? `${Math.round(s / 60)} min` : s > 0 ? `${s} sec` : '—')
const etTime = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')

export default function CloseSheetActivity() {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('cs_activity_open') === '1' } catch { return false } })
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [openRow, setOpenRow] = useState(null)
  const [onlyMissed, setOnlyMissed] = useState(false)

  async function load() {
    setBusy(true); setErr('')
    try {
      const d = await (await fetch(CCG)).json()
      if (!d.ok) throw new Error(d.error || 'Could not load')
      setData(d)
    } catch (x) { setErr(x.message || 'Could not load') }
    setBusy(false)
  }
  const toggle = () => setOpen((o) => {
    try { localStorage.setItem('cs_activity_open', o ? '0' : '1') } catch { /* private */ }
    if (!o && !data && !busy) load()
    return !o
  })

  return (
    <section className="mb-4 rounded-xl border-2 border-sky-700 bg-white">
      <button type="button" onClick={toggle} className="flex w-full items-center justify-between gap-2 rounded-t-lg bg-sky-700 px-4 py-3 text-left text-white">
        <span className="text-lg font-bold">🧮 Investment Close Sheet activity <span className="text-sm font-normal opacity-90">(last 7 days)</span></span>
        <span className="text-sm opacity-90">{open ? '▾ Hide' : '▸ Was it opened on each appointment?'}</span>
      </button>
      {open && (
        <div className="p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-slate-600">
              {data ? <><b>{data.totals.opened}</b> of <b>{data.totals.appts}</b> sales appointments had the close sheet opened.</> : busy ? 'Loading…' : ''}
              {data?.table_missing && <span className="ml-2 font-semibold text-red-700">Tracking isn't switched on yet (run sql/close_sheet_sessions.sql in CCG).</span>}
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1 text-sm text-slate-700"><input type="checkbox" checked={onlyMissed} onChange={(e) => setOnlyMissed(e.target.checked)} /> Only not opened</label>
              <button type="button" onClick={load} disabled={busy} className="rounded-md border border-slate-300 px-3 py-1 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60">{busy ? 'Loading…' : '↻ Refresh'}</button>
            </div>
          </div>
          {err && <div className="mb-2 text-sm font-semibold text-red-700">{err}</div>}
          {data && data.days.map((d) => {
            const rows = d.appts.filter((a) => !onlyMissed || !a.cs.opened)
            if (!rows.length) return null
            const opened = d.appts.filter((a) => a.cs.opened).length
            return (
              <div key={d.date} className="mb-3">
                <div className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">{d.label}{d.is_today ? ' · today' : ''} <span className="font-normal normal-case">— {opened} of {d.appts.length} opened</span></div>
                <table className="w-full text-sm">
                  <tbody>
                    {rows.map((a, i) => {
                      const key = `${d.date}-${a.jn_job_id || i}`
                      return (
                        <Fragment key={key}>
                          <tr onClick={() => setOpenRow(openRow === key ? null : key)} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50">
                            <td className="w-20 py-1.5 pr-2 text-slate-500">{a.time}</td>
                            <td className="pr-2 font-semibold text-slate-800">{a.rep || '—'}</td>
                            <td className="pr-2 text-slate-700">{a.job_name}</td>
                            <td className="whitespace-nowrap pr-2 text-right">
                              {a.cs.opened
                                ? <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">✓ Opened · {mins(a.cs.seconds)}{a.cs.reached_sales ? ' · showed the close' : ''}</span>
                                : <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">✗ Not opened</span>}
                            </td>
                          </tr>
                          {openRow === key && (
                            <tr className="border-b border-slate-100 bg-slate-50">
                              <td colSpan={4} className="px-3 py-2 text-xs text-slate-700">
                                <div className="mb-1 text-slate-500">{a.address}{a.status ? ` · ${a.status}` : ''}</div>
                                {a.cs.sessions.length === 0
                                  ? <div>The close sheet was not opened for this appointment.</div>
                                  : a.cs.sessions.map((s, j) => (
                                    <div key={j}>Opened {etTime(s.opened_at)} by {s.by} · on screen {mins(s.seconds)}{s.reached_sales ? ' · reached the close pages' : ''}</div>
                                  ))}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          })}
          <div className="mt-1 text-[11px] text-slate-400">Time counts only while the close sheet is on screen. Matched to the appointment by the CRM job (or the job name). Tracking started 9/29.</div>
        </div>
      )}
    </section>
  )
}
