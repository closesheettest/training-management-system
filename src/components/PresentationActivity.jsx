// IN-HOME PRESENTATION ACTIVITY (Neal, 2026-09-30): "click on reps that had an appt that
// day and it will tell us if they opened the presentation and how long per slide were
// they on it". Pick a day; every rep with a sales appointment is listed with whether the
// deck was opened. Tap a rep for time on each slide. Data: CCG presentation-activity (fed
// by the deck's own heartbeat, credited to the rep by their PIN sign-in).
import { useEffect, useState } from 'react'

const CCG = 'https://free-roof-inspections.netlify.app/.netlify/functions/presentation-activity'
const mins = (s) => (s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : s > 0 ? `${s}s` : '—')
const etTime = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) : '')
// The deck's own sections (rep dashboard presentation.html), so a slide number reads as something.
const SECTIONS = [
  ['Why U.S. Shingle', 1, 1], ['License', 2, 2], ['Insurance', 3, 3], ['Must Replace Your Roof', 4, 4],
  ['Chuck in the Truck', 5, 5], ['Why Replace Today', 6, 7], ['What We Offer', 8, 8], ['Our Installation Process', 9, 9],
  ['Shingles & Colors', 10, 22], ['Warranty', 23, 23], ['Energy Saver Package', 24, 28], ['How Can I Pay', 29, 29],
  ['The Big Reveal', 30, 30], ['More Estimates', 31, 31],
]
const N = 31
const section = (n) => (SECTIONS.find(([, a, b]) => n >= a && n <= b) || [''])[0]

// managerToken: on a regional manager's dashboard — loads through regional-manager-api,
// which trims it to that manager's own team.
export default function PresentationActivity({ managerToken } = {}) {
  // Starts closed every visit and loads only when tapped (Neal, 2026-09-30: it auto-loaded).
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState('')
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [openRep, setOpenRep] = useState(null)

  async function load(d = date) {
    setBusy(true); setErr('')
    try {
      const j = managerToken
        ? await (await fetch('/.netlify/functions/regional-manager-api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'team_presentation', token: managerToken, date: d || undefined }) })).json()
        : await (await fetch(`${CCG}${d ? `?date=${d}` : ''}`)).json()
      if (!j.ok) throw new Error(j.error || 'Could not load')
      setData(j); setDate(j.date)
    } catch (x) { setErr(x.message || 'Could not load') }
    setBusy(false)
  }
  useEffect(() => { if (open && !data && !busy) load() }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = () => setOpen((o) => !o)

  const withAppt = data ? data.reps.filter((r) => r.appts.length) : []
  const opened = withAppt.filter((r) => r.sessions.length).length

  return (
    <section className="mb-4 rounded-xl border-2 border-red-700 bg-white">
      <button type="button" onClick={toggle} className="flex w-full items-center justify-between gap-2 rounded-t-lg bg-red-700 px-4 py-3 text-left text-white">
        <span className="text-lg font-bold">📽️ In-Home Presentation &amp; Close Sheet activity</span>
        <span className="text-sm opacity-90">{open ? '▾ Hide' : '▸ Did each rep show the deck — every slide, then the close sheet?'}</span>
      </button>
      {open && (
        <div className="p-3">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {(data?.days || []).map((d) => (
              <button key={d.date} type="button" onClick={() => { setOpenRep(null); load(d.date) }}
                className={`rounded-full px-3 py-1 text-sm font-semibold ${d.date === date ? 'bg-red-700 text-white' : 'border border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
                {d.label}{d.count ? ` · ${d.count}` : ''}
              </button>
            ))}
            <button type="button" onClick={() => load()} disabled={busy} className="ml-auto rounded-md border border-slate-300 px-3 py-1 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60">{busy ? 'Loading…' : '↻ Refresh'}</button>
          </div>
          {err && <div className="mb-2 text-sm font-semibold text-red-700">{err}</div>}
          {data?.table_missing && <div className="mb-2 text-sm font-semibold text-red-700">Tracking isn't switched on yet (run sql/presentation_sessions.sql in CCG).</div>}
          {data && (
            <div className="mb-2 text-sm text-slate-600"><b>{opened}</b> of <b>{withAppt.length}</b> reps with an appointment opened the presentation, and <b>{withAppt.filter((r) => r.cs).length}</b> opened the Investment Close Sheet. Tap a rep for time on each slide, then the close sheet.</div>
          )}
          {data && !data.reps.length && <div className="text-sm text-slate-500">No sales appointments this day.</div>}
          {data && data.reps.map((r) => {
            const key = r.rep_jnid || r.rep
            const isOpen = openRep === key
            const top = Math.max(1, ...Object.values(r.slides))
            return (
              <div key={key} className="mb-2 rounded-lg border border-slate-200">
                <button type="button" onClick={() => setOpenRep(isOpen ? null : key)} className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left hover:bg-slate-50">
                  <span className="font-semibold text-slate-800">{r.rep || '—'}</span>
                  <span className="text-xs text-slate-500">{r.appts.length ? `${r.appts.length} appt${r.appts.length > 1 ? 's' : ''} · ${r.appts.map((a) => a.time).join(', ')}` : 'no appointment'}</span>
                  <span className="ml-auto">
                    {r.sessions.length
                      ? <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">✓ Deck · {mins(r.seconds)} · {Object.keys(r.slides).length} of {N} slides</span>
                      : <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">✗ Deck not opened</span>}
                    {' '}
                    {r.cs
                      ? <span className="rounded bg-sky-100 px-2 py-0.5 text-xs font-bold text-sky-800">✓ Close sheet · {mins(r.cs.seconds)}{r.cs.reached_sales ? ' · showed the close' : ''}</span>
                      : <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">✗ No close sheet</span>}
                  </span>
                </button>
                {isOpen && (
                  <div className="border-t border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                    {r.appts.map((a, i) => <div key={i} className="text-slate-500">{a.time} · {a.job_name}{a.address ? ` — ${a.address}` : ''}{a.status ? ` · ${a.status}` : ''}</div>)}
                    {!r.sessions.length ? (
                      <div className="mt-1 font-semibold text-red-700">The presentation was not opened this day.</div>
                    ) : (
                      <>
                        <div className="mt-1">{r.sessions.map((s, i) => <div key={i}>Opened {etTime(s.opened_at)} → last seen {etTime(s.last_seen_at)} · on screen {mins(s.seconds)} · got to slide {s.max_slide}</div>)}</div>
                        <table className="mt-2 w-full">
                          <tbody>
                            {Array.from({ length: N }, (_, k) => k + 1).map((n) => {
                              const sec = r.slides[n] || 0
                              return (
                                <tr key={n} className={sec ? '' : 'text-slate-400'}>
                                  <td className="w-8 py-0.5 text-right font-semibold">{n}</td>
                                  <td className="w-44 truncate px-2">{section(n)}</td>
                                  <td className="px-2"><div className="h-2.5 rounded bg-red-600" style={{ width: `${Math.round((sec / top) * 100)}%`, minWidth: sec ? 3 : 0 }} /></td>
                                  <td className="w-16 text-right">{sec ? mins(sec) : 'skipped'}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </>
                    )}
                    {/* The last step of the presentation: the Investment Close Sheet. */}
                    <div className="mt-2 rounded-md border border-sky-200 bg-white px-2 py-1.5">
                      <div className="flex items-center gap-2">
                        <span className="w-8 text-right font-semibold">✓</span>
                        <span className="w-44 px-2 font-bold text-sky-800">Investment Close Sheet</span>
                        <span className="flex-1 px-2">{r.cs ? <div className="h-2.5 rounded bg-sky-600" style={{ width: `${Math.min(100, Math.round((r.cs.seconds / top) * 100))}%`, minWidth: 3 }} /> : null}</span>
                        <span className="w-16 text-right">{r.cs ? mins(r.cs.seconds) : <span className="font-bold text-red-700">not opened</span>}</span>
                      </div>
                      {r.cs && r.cs.sessions.map((c, i) => (
                        <div key={i} className="mt-0.5 pl-10 text-slate-500">Opened {etTime(c.opened_at)}{c.job_name ? ` · ${c.job_name}` : ''} · on screen {mins(c.seconds)}{c.reached_sales ? ' · reached the close pages' : ''}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
          <div className="mt-1 text-[11px] text-slate-400">Time counts only while the deck or close sheet is on screen. The deck is counted when the rep opens it from Your Personal Dashboard (signed in with their PIN); the close sheet whenever the rep opens it. Tracking started 9/29 (close sheet) and 9/30 (deck).</div>
        </div>
      )}
    </section>
  )
}
