// Harvester's Pay: the Harvester Comp Plan (Neal, 2026-11-04). $100 per harvested sit (an appointment the harvester
// booked that sat), plus $500 at each of 10, 15, 20 and 25 sits in a Monday–Sunday week, paid the Friday after.
// Was "William IQ Pay"; renamed and listed by rep (Neal, 2026-11-05: "It's going to be harvesting pay... listed by rep.
// Right now, William is the only harvester."). Numbers come from CCG harvester-pay.
// Knock priority: IQ, No Sit Need to Reschedule, BTR Go Backs, IQ Not Interested.
import { Fragment, useState } from 'react'

const CCG = 'https://free-roof-inspections.netlify.app/.netlify/functions/harvester-pay'
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
  const toggle = () => { if (!data) { setShown(true); if (!busy) load() } else setShown((v) => !v) }

  async function load() {
    setBusy(true); setErr('')
    try {
      const d = await (await fetch(`${CCG}?weeks_back=12`)).json()
      if (!d.ok) throw new Error(d.error || 'Could not load')
      setData(d)
      const first = d.reps?.[0]
      if (first && !who) setWho(first.name)
      if (first && !wk) { const done = first.weeks.find((w) => !w.in_progress) || first.weeks[0]; if (done) setWk(done.week_start) }
    } catch (x) { setErr(x.message || 'Could not load') }
    setBusy(false)
  }
  const rep = data?.reps?.find((r) => r.name === who) || data?.reps?.[0]
  const weeks = rep?.weeks || []
  const w = weeks.find((x) => x.week_start === wk) || weeks.find((x) => !x.in_progress) || weeks[0]
  const repFirst = (rep?.name || '').split(' ')[0]

  return (
    <div className="rounded-lg border border-slate-200">
      <button type="button" onClick={toggle} className="flex w-full items-center justify-between gap-2 rounded-t-lg bg-slate-50 px-3 py-2 text-left">
        <span className="font-bold text-slate-800">🌾 Harvester's Pay <span className="text-xs font-normal text-slate-500">(Harvester Comp Plan)</span></span>
        <span className="text-xs text-slate-500">{busy ? 'Loading…' : data ? (shown ? '▾' : '▸') : 'Tap to load'}</span>
      </button>
      {err && <div className="px-3 py-2 text-sm text-red-700">{err}</div>}
      {data && shown && (
        <div className="space-y-3 p-3 text-sm">
          <div className="rounded bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
            {money(data.plan.per_sit)} per harvested sit, plus {money(data.plan.bonus)} at each of {data.plan.tiers.join(', ')} sits in a week. Weeks run Monday–Sunday and are paid the Friday after.
            <div className="mt-1 text-emerald-800">Knock priority: IQ → No Sit Need to Reschedule → BTR Go Backs → IQ Not Interested.</div>
            {rep?.starts && <div className="mt-1 text-emerald-800">{repFirst}: counts bookings made from {fmtDay(rep.starts)}, {rep.starts.slice(0, 4)} on. Earlier bookings are on the regular commission report.</div>}
          </div>
          <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">Harvester
            <select value={rep?.name || ''} onChange={(e) => setWho(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-sm">
              {(data.reps || []).map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">Week
            <select value={w?.week_start || ''} onChange={(e) => setWk(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-sm">
              {weeks.map((x) => <option key={x.week_start} value={x.week_start}>{fmtDay(x.week_start)} – {fmtDay(x.week_end)}{x.in_progress ? ' (this week, so far)' : ''} · {x.sits} sit{x.sits === 1 ? '' : 's'} · {money(x.total)}</option>)}
            </select>
          </label>
          </div>
          {w && (
            <Fragment>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Booked" v={w.booked} />
                <Stat label="Sits" v={w.sits} />
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
                    <thead><tr className="text-left text-slate-500"><th className="py-1 pr-2">Appointment</th><th className="pr-2">Homeowner</th><th className="pr-2">Type</th><th className="pr-2">JobNimbus status</th><th>Sit?</th></tr></thead>
                    <tbody>
                      {w.appts.map((a, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          <td className="py-1 pr-2 whitespace-nowrap">{a.when}</td>
                          <td className="pr-2">{a.customer}<div className="text-slate-400">{a.address}</div></td>
                          <td className="pr-2">{a.source}</td>
                          <td className="pr-2">{a.status}</td>
                          <td>{a.upcoming ? <span className="text-slate-400">upcoming</span> : a.sat ? <span className="font-bold text-emerald-700">✓ Sat</span> : <span className="text-red-600">No</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Fragment>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ label, v }) {
  return <div className="rounded border border-slate-200 px-2 py-1.5"><div className="text-[11px] text-slate-500">{label}</div><div className="text-base font-bold text-slate-800">{v}</div></div>
}
