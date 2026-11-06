// 📅 OPEN APPOINTMENT TIMES BY AREA (Neal, 2026-11-06: William in Bradenton said the times were filling up — "something
// I can pull to say, oh, okay, there's only one more appointment time in this area on Saturday … the only way I can do
// that is if I have my eyeballs on it"). Data: CCG appt-openings, which asks the same booking engine the Setter Portal,
// Zilla and the map use about one point in each town. A number = open rep slots that day (3 reps free at 9 AM = 3).
// Tap a number to see the times and who is free.
import { Fragment, useState } from 'react'

const CCG = 'https://free-roof-inspections.netlify.app/.netlify/functions/appt-openings'
const PIN_KEY = 'rm_admin_ok_pin'
const ZONES = ['All', 'Zone 1', 'Zone 2', 'Zone 3', 'Zone 4']
const tone = (n) => (n === 0 ? 'bg-red-100 text-red-800' : n <= 2 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-50 text-emerald-800')

export default function ApptOpenings() {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [shown, setShown] = useState(false)
  const [zone, setZone] = useState('All')
  const [cell, setCell] = useState(null)   // { town, date }
  const [pinInput, setPinInput] = useState('')
  const [needPin, setNeedPin] = useState(false)

  const load = async (p) => {
    const pin = p || (() => { try { return sessionStorage.getItem(PIN_KEY) || '' } catch { return '' } })()
    if (!pin) { setNeedPin(true); return }
    setBusy(true); setErr('')
    try {
      const j = await (await fetch(CCG, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) })).json()
      if (!j.ok) {
        if (/PIN/i.test(j.error || '')) { try { sessionStorage.removeItem(PIN_KEY) } catch { /* ignore */ } setNeedPin(true) }
        setErr(j.error || 'Could not load.')
      } else { setData(j); setShown(true); setNeedPin(false) }
    } catch { setErr('Could not reach CCG.') }
    setBusy(false)
  }
  const toggle = () => (data ? setShown((v) => !v) : load())
  const usePin = () => { const p = pinInput.trim(); if (!p) return; try { sessionStorage.setItem(PIN_KEY, p) } catch { /* ignore */ } setPinInput(''); load(p) }

  const towns = (data?.towns || []).filter((t) => zone === 'All' || t.zone === zone)
  const count = (t, d) => (t.days?.[d] || []).reduce((m, s) => m + s.reps.length, 0)
  const at = data ? new Date(data.at).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) : ''

  return (
    <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div onClick={toggle} className="cursor-pointer select-none text-lg font-bold text-brand-navy hover:opacity-80"><span className="mr-1 inline-block text-slate-400">{data && shown ? '▾' : '▸'}</span>📅 Open appointment times <span className="text-sm font-normal text-slate-500">(next 5 booking days, by area)</span></div>
          <div className="text-xs text-slate-500">What a setter would be offered for a house in each town right now: reps in the zone within range, minus blocks and what's already booked in JobNimbus.</div>
        </div>
        <div className="flex items-center gap-2">
          {data && shown && <button type="button" onClick={() => load()} disabled={busy} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60">↻ Refresh</button>}
          <button type="button" onClick={toggle} disabled={busy} className="rounded-md bg-brand-navy px-3 py-1.5 text-sm font-bold text-white disabled:opacity-60">{busy ? 'Loading…' : !data ? 'Load report' : shown ? '▴ Shrink' : '▾ Show'}</button>
        </div>
      </div>
      {needPin && (
        <div className="mt-3 flex items-center gap-2">
          <input type="password" inputMode="numeric" value={pinInput} onChange={(e) => setPinInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && usePin()} placeholder="Admin PIN" className="w-32 rounded-md border border-slate-300 px-2 py-1 text-sm" />
          <button type="button" onClick={usePin} className="rounded-md bg-brand-navy px-3 py-1 text-sm font-bold text-white">Go</button>
        </div>
      )}
      {err && <div className="mt-2 text-sm font-semibold text-red-700">{err}</div>}
      {data && shown && (
        <div className="mt-3">
          <div className="mb-2 flex flex-wrap items-center gap-1">
            {ZONES.map((z) => <button key={z} type="button" onClick={() => setZone(z)} className={`rounded-full px-3 py-1 text-xs font-bold ${zone === z ? 'bg-brand-navy text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{z}</button>)}
            <span className="ml-2 text-xs text-slate-400">as of {at} ET · tap a number for the times</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead><tr className="text-left text-xs text-slate-500">
                <th className="px-2 py-1">Town</th>
                {data.dates.map((d) => <th key={d.date} className="px-2 py-1 text-center">{d.label}</th>)}
                <th className="px-2 py-1 text-center">Total</th><th className="px-2 py-1">Reps in range</th>
              </tr></thead>
              <tbody>
                {towns.map((t, i) => (
                  <Fragment key={t.town}>
                    {(i === 0 || towns[i - 1].zone !== t.zone) && <tr><td colSpan={data.dates.length + 3} className="bg-slate-50 px-2 py-1 text-xs font-bold uppercase tracking-wide text-slate-500">{t.zone}</td></tr>}
                    <tr className="border-t border-slate-100">
                      <td className="px-2 py-1.5 font-semibold text-slate-800">{t.town}<span className="ml-1 text-xs font-normal text-slate-400">{t.county}</span></td>
                      {t.error || t.out_of_area || !t.reps?.length
                        ? <td colSpan={data.dates.length + 1} className="px-2 py-1.5 text-xs font-semibold text-red-700">{t.error ? `Couldn't check: ${t.error}` : 'No rep covers this area'}</td>
                        : <>
                          {data.dates.map((d) => { const n = count(t, d.date); const on = cell && cell.town === t.town && cell.date === d.date; return (
                            <td key={d.date} className="px-1 py-1 text-center">
                              <button type="button" onClick={() => setCell(on ? null : { town: t.town, date: d.date })} className={`min-w-[2.5rem] rounded px-2 py-0.5 font-bold ${tone(n)} ${on ? 'ring-2 ring-brand-navy' : ''}`}>{n}</button>
                            </td>) })}
                          <td className="px-2 py-1.5 text-center font-bold text-slate-700">{t.open}</td>
                        </>}
                      <td className="px-2 py-1.5 text-xs text-slate-500">{(t.reps || []).join(', ')}</td>
                    </tr>
                    {cell && cell.town === t.town && (
                      <tr><td colSpan={data.dates.length + 3} className="bg-slate-50 px-3 py-2 text-xs text-slate-700">
                        <b>{t.town} · {data.dates.find((d) => d.date === cell.date)?.label}:</b>{' '}
                        {(t.days?.[cell.date] || []).length ? (t.days[cell.date]).map((s) => `${s.label} (${s.reps.join(', ')})`).join(' · ') : 'no open times'}
                      </td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 text-xs text-slate-400">Red = nothing open, amber = 1–2 left. Each rep counts once per time slot. Sundays have no times.</div>
        </div>
      )}
    </section>
  )
}
