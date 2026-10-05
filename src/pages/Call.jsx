// /call — 📞 CALL SOMEONE (Neal, 2026-10-05: "pick somebody, let's say it's Brent Davidson. And then
// I press the button, it sends him a text with a link and we're both in a meeting room"). Signed in
// with your admin PIN. Pick anyone in TMS, office staff (GoHighLevel's user list), or type a name +
// cell. Call → a private room for right now, they get "join now" by text + email, and this tab goes
// straight into the room as host. Data: meet.js call_people / call_start.
import { useEffect, useState } from 'react'
import PinGate from '../components/PinGate.jsx'

const KEY = 'meet_admin_ok' // same sign-in as Meeting Room Setup / Your meetings
// Opened from My Tools: #mt=<name+passcode> (kept in this tab only, then wiped from the address bar).
const MT_KEY = 'call_mt'
const readMt = () => {
  try {
    const m = window.location.hash.match(/mt=([^&]+)/)
    if (m) { sessionStorage.setItem(MT_KEY, decodeURIComponent(atob(m[1]))); window.history.replaceState(null, '', window.location.pathname) }
    return JSON.parse(sessionStorage.getItem(MT_KEY) || 'null')
  } catch { return null }
}
const call = (body) => fetch('/.netlify/functions/meet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json())

function Dialer({ mt }) {
  const pin = (() => { try { return sessionStorage.getItem(`${KEY}_pin`) || '' } catch { return '' } })()
  const auth = mt ? { mt } : { pin }
  const [people, setPeople] = useState(null)
  const [q, setQ] = useState('')
  const [pick, setPick] = useState(null)
  const [other, setOther] = useState({ name: '', phone: '' })
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(null) // what went out, shown before you go into the room
  useEffect(() => { call({ action: 'call_people', ...auth }).then((j) => (j.ok ? setPeople(j.people) : setErr(j.error || 'Could not load people. Close this tab and sign in again.'))).catch(() => setErr('Network error')) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const list = (people || []).filter((p) => !q.trim() || `${p.name} ${p.tag}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 40)
  const go = async () => {
    const to = pick ? (pick.id ? { id: pick.id } : { name: pick.name, phone: pick.phone, email: pick.email }) : { name: other.name, phone: other.phone }
    setBusy(true); setErr('')
    const j = await call({ action: 'call_start', ...auth, to, note }).catch(() => ({ error: 'Network error. Try again.' }))
    setBusy(false)
    if (!j.ok) { setErr(j.error || 'Could not start the call.'); return }
    // Say what went out (Neal, 2026-10-05: he couldn't tell whether Nikki had a number). Nothing
    // went out → stop here with a warning instead of sitting in an empty room.
    try { if (pin) sessionStorage.setItem('meet_host_pin', pin) } catch { /* it will ask for the PIN */ }
    setDone(j)
    if (j.sms || j.email) setTimeout(() => { window.location.href = j.join || `/meet/${j.slug}` }, 2500)
  }
  const ready = pick || (other.name.trim() && other.phone.replace(/\D/g, '').length >= 10)
  if (done) return (
    <div className={`rounded-xl border-2 p-5 ${done.sms || done.email ? 'border-emerald-500 bg-emerald-50' : 'border-red-500 bg-red-50'}`}>
      <div className="text-lg font-extrabold">{done.sms || done.email ? `📞 Calling ${done.name}` : `⚠️ Nothing went out to ${done.name}`}</div>
      <div className="mt-2 text-base">{done.sms ? '✅' : '❌'} Text {done.cell ? `to ${done.cell}` : '(no cell on file)'}</div>
      <div className="text-base">{done.email ? '✅' : '❌'} Email</div>
      {done.sms || done.email
        ? <p className="mt-3 text-sm text-slate-600">Taking you into the room… <a href={done.join || `/meet/${done.slug}`} className="font-bold text-emerald-700 underline">go now</a></p>
        : <p className="mt-3 text-sm font-semibold text-red-700">They have no way to get the link. Add their cell in TMS, or call again with their name + cell under "Someone else".</p>}
      {!(done.sms || done.email) && <button onClick={() => setDone(null)} className="mt-3 rounded-lg bg-slate-700 px-4 py-2 text-sm font-bold text-white">Back</button>}
    </div>
  )
  if (busy) return <p className="py-10 text-center text-lg font-bold text-brand-navy">📞 Calling {pick?.name || other.name}… opening your room</p>
  return (
    <div>
      {err && <p className="mb-3 rounded bg-red-50 p-2 text-sm font-semibold text-red-700">{err}</p>}
      {pick ? (
        <div className="flex items-center gap-3 rounded-xl border-2 border-emerald-500 bg-emerald-50 p-4">
          <div className="flex-1"><div className="text-lg font-bold">{pick.name}</div><div className="text-sm text-slate-600">{pick.tag} · {pick.cell ? `📱 ${pick.cell.slice(0, 3)}-${pick.cell.slice(3, 6)}-${pick.cell.slice(6)}` : <b className="text-red-600">⚠️ no cell in TMS{pick.has_email ? ': email only' : ', nothing to send to'}</b>}</div></div>
          <button onClick={() => setPick(null)} className="text-sm font-semibold text-slate-500 underline">change</button>
        </div>
      ) : (
        <>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Who do you want to call? Type a name…" className="w-full rounded-lg border border-slate-300 px-4 py-3 text-base" />
          <div className="mt-2 max-h-80 overflow-auto rounded-lg border border-slate-200 bg-white">
            {!people ? <p className="p-3 text-sm text-slate-500">Loading people…</p> : list.length ? list.map((p) => (
              <button key={p.id || p.phone} onClick={() => setPick(p)} className="flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2.5 text-left last:border-0 hover:bg-slate-50">
                <span className="flex-1 font-semibold text-slate-900">{p.name}</span>
                <span className={`text-xs ${p.cell ? 'text-slate-500' : 'font-bold text-red-600'}`}>{p.cell ? `📱 …${p.cell.slice(-4)}` : '⚠️ no cell'}</span>
                <span className="text-xs text-slate-500">{p.tag}</span>
              </button>
            )) : <p className="p-3 text-sm text-slate-500">No one by that name. Type them in below.</p>}
          </div>
          <div className="mt-4 text-sm font-bold text-slate-700">Someone else</div>
          <div className="mt-1 flex gap-2">
            <input value={other.name} onChange={(e) => setOther({ ...other, name: e.target.value })} placeholder="Name" className="flex-1 rounded-lg border border-slate-300 px-3 py-2" />
            <input value={other.phone} onChange={(e) => setOther({ ...other, phone: e.target.value })} inputMode="tel" placeholder="Cell" className="w-40 rounded-lg border border-slate-300 px-3 py-2" />
          </div>
        </>
      )}
      <label className="mt-4 block text-sm font-bold text-slate-700">Your message <span className="font-normal text-slate-500">(optional: it goes in the text and email, the join link is added under it)</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={600} placeholder="e.g. Hey Brent, jump on a quick video call with me about the Pasco jobs." className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base font-normal" />
      </label>
      <button disabled={!ready} onClick={go} className={`mt-4 w-full rounded-xl py-4 text-xl font-extrabold text-white ${ready ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-slate-300'}`}>📞 Call{pick ? ` ${pick.name.split(' ')[0]}` : other.name.trim() ? ` ${other.name.trim().split(' ')[0]}` : ''}</button>
      <p className="mt-2 text-center text-xs text-slate-500">They get a text and an email with a "join now" link. You go straight into the room as host.</p>
    </div>
  )
}

export default function Call() {
  useEffect(() => { document.title = '📞 Call · Meetings' }, [])
  const [mt] = useState(readMt)
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-lg">
        <h1 className="text-2xl font-bold text-brand-navy">📞 Call someone</h1>
        <div className="mt-3">{mt ? <><p className="mb-3 text-sm text-slate-500">Calling as <b>{mt.name}</b></p><Dialer mt={mt} /></> : <PinGate title="Call" storageKey={KEY} keepPin><Dialer /></PinGate>}</div>
      </div>
    </div>
  )
}
