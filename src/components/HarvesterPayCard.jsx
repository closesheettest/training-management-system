// Harvester's Pay: the Harvester Comp Plan (Neal, 2026-11-04). $100 per harvested sit (an appointment the harvester
// booked that sat), plus $500 at each of 10, 15, 20 and 25 sits in a Monday–Sunday week, paid the Friday after.
// Was "William IQ Pay"; renamed and listed by rep (Neal, 2026-11-05: "It's going to be harvesting pay... listed by rep.
// Right now, William is the only harvester."). Numbers come from CCG harvester-pay.
// Knock priority: IQ, No Sit Need to Reschedule, BTR Go Backs, IQ Not Interested.
import { Fragment, useState } from 'react'

const CCG = 'https://free-roof-inspections.netlify.app/.netlify/functions/harvester-pay'
// 🚫 Rep no-show override (Neal, 2026-11-12: Rob Sexton never went to two of Mark's appointments. "the harvester needs to
// get paid on those, and we're going to charge that appointment to the sales rep"). A manager marks it here: the
// harvester gets it as a sit, the rep is charged $500, and the charge comes off by itself once that job is sold.
export const OVR = 'https://free-roof-inspections.netlify.app/.netlify/functions/rep-noshow-override'
function adminPin() {
  let pin = ''
  try { pin = sessionStorage.getItem('rm_admin_ok_pin') || '' } catch { /* */ }
  if (!pin) { pin = window.prompt('Admin PIN:') || ''; if (pin) { try { sessionStorage.setItem('rm_admin_ok_pin', pin) } catch { /* */ } } }
  return pin
}
export async function ovrPost(body) {
  const pin = adminPin(); if (!pin) return { ok: false, error: 'PIN needed' }
  const d = await fetch(OVR, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, pin }) }).then((x) => x.json()).catch(() => ({ ok: false, error: 'Network error' }))
  if (d && /PIN/i.test(d.error || '')) { try { sessionStorage.removeItem('rm_admin_ok_pin') } catch { /* */ } }
  return d
}
// 📝 Tap an appointment to read its JobNimbus notes (Neal, 2026-11-12: "click on each appointment, and then it would show
// the notes that were put in the system, if any, about the appointment"). CCG deal-notes = typed notes + status changes.
const NOTES = 'https://free-roof-inspections.netlify.app/.netlify/functions/deal-notes'
const fmtAt = (iso) => iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
const fmtDay = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const payday = (ymd) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 11); return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) }
const money = (n) => `$${Number(n || 0).toLocaleString()}`

export default function HarvesterPayCard() {
  const [data, setData] = useState(null)
  const [who, setWho] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [wk, setWk] = useState('')
  const [shown, setShown] = useState(true)
  const [ovBusy, setOvBusy] = useState('')
  const [openRow, setOpenRow] = useState('')
  const [notes, setNotes] = useState({})   // jn_job_id → { busy, list, err }
  async function openNotes(key, jnid) {
    if (openRow === key) { setOpenRow(''); return }
    setOpenRow(key)
    if (!jnid || (notes[jnid] && !notes[jnid].err)) return
    setNotes((m) => ({ ...m, [jnid]: { busy: true } }))
    const d = await fetch(`${NOTES}?jnid=${encodeURIComponent(jnid)}`).then((x) => x.json()).catch(() => ({ ok: false, error: 'Network error' }))
    setNotes((m) => ({ ...m, [jnid]: d.ok ? { list: d.notes || [] } : { err: d.error || 'Could not load notes' } }))
  }
  const toggle = () => { if (!data) { setShown(true); if (!busy) load() } else setShown((v) => !v) }

  async function load() {
    setBusy(true); setErr('')
    try {
      const d = await fetch(`${CCG}?weeks_back=12`).then((x) => x.json())
      if (!d.ok) throw new Error(d.error || 'Could not load')
      setData(d)
    } catch (x) { setErr(x.message || 'Could not load') }
    setBusy(false)
  }
  async function markNoShow(a) {
    if (!window.confirm(`${a.rep} didn't go to ${a.customer} (${a.when})?\n\n${rep?.name || 'The harvester'} gets paid it as a sit, and ${a.rep} is charged $500. The charge comes off if the job is sold.`)) return
    setOvBusy(a.jn_job_id)
    const d = await ovrPost({ action: 'add', jn_job_id: a.jn_job_id, appt_iso: a.appt_iso, harvester: rep?.name, customer: a.customer, address: a.address, rep: a.rep, rep_jn: a.rep_jn })
    setOvBusy('')
    if (!d.ok) { window.alert(d.error || 'Could not save'); return }
    load()
  }
  async function undoNoShow(id) {
    if (!window.confirm('Undo this? The harvester loses the sit and the rep\'s $500 charge is removed.')) return
    setOvBusy(id)
    const d = await ovrPost({ action: 'remove', id })
    setOvBusy('')
    if (!d.ok) { window.alert(d.error || 'Could not undo'); return }
    load()
  }
  // Harvesters listed by name like the leaderboard; tap a name to open their pay below it (Neal, 2026-11-12: "instead of
  // having the drop-down where you pick the harvester, just have the harvester's name in the report... when you click on
  // the harvester's name, then the details drop down below it").
  function openRep(r) {
    if (who === r.name) { setWho(''); return }
    setWho(r.name); setOpenRow('')
    const done = (r.weeks || []).find((x) => !x.in_progress && !x.upcoming) || r.weeks?.[0]
    setWk(done?.week_start || '')
  }
  const rep = data?.reps?.find((r) => r.name === who) || null
  const weeks = rep?.weeks || []
  const w = weeks.find((x) => x.week_start === wk) || weeks.find((x) => !x.in_progress) || weeks[0]
  const repFirst = (rep?.name || '').split(' ')[0]

  return (
    <div className="rounded-lg border border-slate-200">
      <button type="button" onClick={toggle} className="flex w-full items-center justify-between gap-2 rounded-t-lg bg-slate-50 px-3 py-2 text-left">
        <span className="font-bold text-slate-800">🌾 Harvester's Pay <span className="text-xs font-normal text-slate-500">(Harvester Comp Plan)</span></span>
        {/* "Load report" on the right, like the other pay reports (Neal, 2026-11-07). */}
        {data && !busy
          ? <span className="text-xs text-slate-500">{shown ? '▾' : '▸'}</span>
          : <span className="rounded-md bg-brand-navy px-3 py-1.5 text-sm font-bold text-white">{busy ? 'Loading…' : 'Load report'}</span>}
      </button>
      {err && <div className="px-3 py-2 text-sm text-red-700">{err}</div>}
      {data && shown && (
        <div className="space-y-3 p-3 text-sm">
          <div className="rounded bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
            {money(data.plan.per_sit)} per harvested sit, plus {money(data.plan.bonus)} at each of {data.plan.tiers.join(', ')} sits in a week. Weeks run Monday–Sunday and are paid the Friday after.
            <div className="mt-1 text-emerald-800">Knock priority: IQ → No Sit Need to Reschedule → BTR Go Backs → IQ Not Interested.</div>
          </div>
          {(data.reps || []).length === 0 && <div className="text-slate-500">No harvesters yet.</div>}
          {(data.reps || []).map((r) => { const open = who === r.name
            const cur = (r.weeks || []).find((x) => x.in_progress), last = (r.weeks || []).find((x) => !x.in_progress && !x.upcoming)
            return (
            <div key={r.name} className={`rounded-lg border ${open ? 'border-brand-navy' : 'border-slate-200'}`}>
              <button type="button" onClick={() => openRep(r)} className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left hover:bg-slate-50">
                <span className="font-bold text-slate-800">{open ? '▾' : '▸'} {r.name}</span>
                <span className="flex flex-wrap gap-3 text-xs text-slate-600">
                  <span>This week: <b>{cur?.sits ?? 0}</b> sit{(cur?.sits ?? 0) === 1 ? '' : 's'} · <b>{money(cur?.total)}</b></span>
                  {last && <span>Last week: <b>{last.sits}</b> sit{last.sits === 1 ? '' : 's'} · <b>{money(last.total)}</b> (paid {payday(last.week_start)})</span>}
                </span>
              </button>
              {open && rep && (
              <div className="space-y-3 border-t border-slate-200 p-3">
          {rep.starts && <div className="text-xs text-slate-500">{repFirst}: counts bookings made from {fmtDay(rep.starts)}, {rep.starts.slice(0, 4)} on. Earlier bookings are on the regular commission report.</div>}
          <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">Week
            <select value={w?.week_start || ''} onChange={(e) => setWk(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-sm">
              {weeks.map((x) => <option key={x.week_start} value={x.week_start}>{fmtDay(x.week_start)} – {fmtDay(x.week_end)}{x.upcoming ? ' (next week)' : x.in_progress ? ' (this week, so far)' : ''} · {x.sits} sit{x.sits === 1 ? '' : 's'} · {money(x.total)}</option>)}
            </select>
          </label>
          </div>
          {w && (
            <Fragment>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <Stat label="Booked" v={w.booked} />
                <Stat label="Sits" v={w.sits} />
                {/* SIT % (Neal, 2026-11-12): sits ÷ appointments that have already happened this week. Upcoming ones and
                    ones moved to another week don't count against it. */}
                {(() => { const ran = (w.appts || []).filter((a) => !a.upcoming && !a.rescheduled_to).length
                  return <Stat label={`Sit % (${w.sits} of ${ran} so far)`} v={ran ? `${Math.round((100 * w.sits) / ran)}%` : '—'} /> })()}
                <Stat label={`Sits × ${money(data.plan.per_sit)}`} v={money(w.per_sit_pay)} />
                <Stat label={`Bonuses (${w.bonuses})`} v={money(w.bonus_pay)} />
              </div>
              <div className="flex items-center justify-between rounded bg-slate-800 px-3 py-2 text-white">
                <span className="font-semibold">Total{w.in_progress ? ' so far' : ''} · paid {payday(w.week_start)}</span>
                <span className="text-lg font-bold">{money(w.total)}</span>
              </div>
              {w.appts.length === 0 ? <div className="text-slate-500">No appointments booked by {repFirst || 'them'} this week.</div> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="text-left text-slate-500"><th className="py-1 pr-2">Booked</th><th className="pr-2">Appointment</th><th className="pr-2">Homeowner</th><th className="pr-2">Assigned to</th><th className="pr-2">Type</th><th className="pr-2">JobNimbus status</th><th>Sit?</th></tr></thead>
                    <tbody>
                      {w.appts.map((a, i) => { const key = `${w.week_start}_${i}`, nn = notes[a.jn_job_id]; return (
                        <Fragment key={i}>
                        <tr onClick={(e) => { if (!e.target.closest('button')) openNotes(key, a.jn_job_id) }} title="Tap to see the JobNimbus notes" className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${openRow === key ? 'bg-slate-50' : ''}`}>
                          {/* Booked + Assigned to (Neal, 2026-11-07): when William made it, and which rep runs it. */}
                          <td className="py-1 pr-2 whitespace-nowrap">{a.booked_when || '—'}</td>
                          <td className="pr-2 whitespace-nowrap">{a.when}{a.rescheduled_to && <div className="text-amber-700">rescheduled → {a.rescheduled_to}</div>}{a.rescheduled_from && <div className="text-slate-400">rescheduled from {a.rescheduled_from}</div>}</td>
                          <td className="pr-2">{a.customer}<div className="text-slate-400">{a.address}</div></td>
                          <td className="pr-2 whitespace-nowrap">{a.rep || <span className="font-semibold text-amber-700">Not assigned</span>}</td>
                          <td className="pr-2">{a.source}</td>
                          <td className="pr-2">{a.status}</td>
                          <td>{a.upcoming ? <span className="text-slate-400">upcoming</span>
                            : a.override ? <div><span className="font-bold text-emerald-700">✓ Paid</span><div className="text-[11px] text-red-700">rep no-show: $500 to {a.override.rep || 'rep'}</div><button type="button" disabled={!!ovBusy} onClick={() => undoNoShow(a.override.id)} className="text-[11px] text-slate-500 underline">undo</button></div>
                            : a.sat ? <span className="font-bold text-emerald-700">✓ Sat</span>
                            : a.paid_on_override ? <span className="text-slate-400">paid earlier (rep no-show)</span>
                            : <div><span className="text-red-600">No</span>{a.jn_job_id && a.rep && <div><button type="button" disabled={!!ovBusy} onClick={() => markNoShow(a)} className="mt-0.5 whitespace-nowrap rounded border border-red-300 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">{ovBusy === a.jn_job_id ? 'Saving…' : '🚫 Rep didn\'t go'}</button></div>}</div>}</td>
                        </tr>
                        {openRow === key && (
                          <tr className="bg-slate-50"><td colSpan={7} className="px-3 pb-2 pt-1">
                            <div className="mb-1 font-semibold text-slate-700">📝 JobNimbus notes: {a.customer}</div>
                            {!a.jn_job_id ? <div className="text-slate-500">No JobNimbus job linked to this appointment.</div>
                              : !nn || nn.busy ? <div className="text-slate-500">Loading notes…</div>
                              : nn.err ? <div className="text-red-600">{nn.err}</div>
                              : nn.list.length === 0 ? <div className="text-slate-500">No notes on this job in JobNimbus.</div>
                              : <ul className="space-y-1">{nn.list.map((n, j) => (
                                  <li key={j} className={n.type === 'status' ? 'text-slate-500' : 'text-slate-800'}>
                                    <span className="whitespace-nowrap text-slate-400">{fmtAt(n.at)} · {n.by}: </span>
                                    {n.type === 'status' ? <i>status → {n.text}</i> : n.text}
                                  </li>))}</ul>}
                          </td></tr>
                        )}
                        </Fragment>
                      ) })}
                    </tbody>
                  </table>
                </div>
              )}
            </Fragment>
          )}
              </div>
              )}
            </div>
          ) })}
          {/* Rep no-show CHARGES moved to their own card (RepNoShowChargesCard) (Neal, 2026-11-12: "Why would it show rep
              no-show charges with William there?"). Here a harvester only sees the sit it paid them. */}
        </div>
      )}
    </div>
  )
}

function Stat({ label, v }) {
  return <div className="rounded border border-slate-200 px-2 py-1.5"><div className="text-[11px] text-slate-500">{label}</div><div className="text-base font-bold text-slate-800">{v}</div></div>
}
