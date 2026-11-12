// 🚫 Rep no-show charges (Neal, 2026-11-12): its own card under 💰 Pay reports. Was inside Harvester's Pay, which made
// no sense ("Why would it show rep no-show charges with William there?"). A charge is the REP's: $500 on their draw when
// a manager marks "🚫 Rep didn't go" on a harvester's appointment (Harvester's Pay); it comes off once the job is sold.
// The harvester's side (the sit they're paid) stays on Harvester's Pay. Data: CCG rep-noshow-override.
import { useState } from 'react'
import { OVR, ovrPost } from './HarvesterPayCard.jsx'

const money = (n) => `$${Number(n || 0).toLocaleString()}`
const when = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export default function RepNoShowChargesCard() {
  const [data, setData] = useState(null)
  const [shown, setShown] = useState(false)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  async function load() {
    setErr('')
    const d = await fetch(OVR).then((x) => x.json()).catch(() => ({ ok: false, error: 'Network error' }))
    if (!d.ok) { setErr(d.error || 'Could not load'); return }
    setData(d)
  }
  const toggle = () => { if (!shown && !data) load(); setShown((v) => !v) }
  async function undo(o) {
    if (!window.confirm(`Undo ${o.rep}'s charge for ${o.customer}? ${o.harvester || 'The harvester'} also loses that sit.`)) return
    setBusy(o.id)
    const d = await ovrPost({ action: 'remove', id: o.id })
    setBusy('')
    if (!d.ok) { window.alert(d.error || 'Could not undo'); return }
    load()
  }
  const list = data?.overrides || []
  const owed = list.reduce((t, o) => t + (Number(o.charge_now) || 0), 0)
  return (
    <div className="rounded-lg border border-slate-200">
      <button type="button" onClick={toggle} className="flex w-full items-center justify-between gap-2 rounded-t-lg bg-slate-50 px-3 py-2 text-left">
        <span className="font-bold text-slate-800">🚫 Rep no-show charges <span className="text-xs font-normal text-slate-500">($500 on the rep's draw; comes off when the job is sold)</span></span>
        <span className="text-xs text-slate-500">{shown ? '▾' : '▸'}{data ? ` ${list.length} · ${money(owed)} owed` : ''}</span>
      </button>
      {shown && (
        <div className="p-3">
          {err && <div className="text-sm font-semibold text-red-700">{err}</div>}
          {!data && !err && <div className="text-sm text-slate-500">Loading…</div>}
          {data && !list.length && <div className="text-sm text-slate-500">No charges. Mark one with "🚫 Rep didn't go" on Harvester's Pay.</div>}
          {list.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-slate-500"><th className="px-2 py-1">Rep charged</th><th className="pr-2">Appointment</th><th className="pr-2">Homeowner</th><th className="pr-2">Booked by</th><th className="pr-2">JobNimbus now</th><th className="pr-2">Charge</th><th></th></tr></thead>
                <tbody>
                  {list.map((o) => (
                    <tr key={o.id} className="border-t border-slate-100">
                      <td className="px-2 py-1 font-semibold">{o.rep || '—'}</td>
                      <td className="pr-2 whitespace-nowrap">{when(o.appt_iso)}</td>
                      <td className="pr-2">{o.customer}<div className="text-slate-400">{o.address}</div></td>
                      <td className="pr-2">{o.harvester}</td>
                      <td className="pr-2">{o.jn_status || '—'}</td>
                      <td className="pr-2 font-bold">{o.resold ? <span className="text-emerald-700">$0 (resold)</span> : <span className="text-red-700">{money(o.charge_now)}</span>}</td>
                      <td><button type="button" disabled={!!busy} onClick={() => undo(o)} className="text-[11px] text-slate-500 underline">undo</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-2 py-1 text-[11px] text-slate-500">Marked by {[...new Set(list.map((o) => o.by))].join(', ')}.</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
