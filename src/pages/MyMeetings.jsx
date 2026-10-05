// /my-meetings — YOUR MEETINGS (Neal, 2026-10-04: "a button that says your meetings. And when he
// clicks on it, it brings him to a page that he has the link for every meeting that he is a part
// of"). Signed in with your PIN (the one you host with); lists only the rooms you belong in, LIVE
// first, then by next meeting, each with Join. On My Tools as "Your meetings". Data: meet.js
// mine_by_pin.
import { useEffect, useState } from 'react'
import PinGate from '../components/PinGate.jsx'

const KEY = 'meet_admin_ok' // same sign-in as Meeting Room Setup
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')

function List() {
  const [d, setD] = useState(null)
  const pin = (() => { try { return sessionStorage.getItem(`${KEY}_pin`) || '' } catch { return '' } })()
  const load = () => fetch('/.netlify/functions/meet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'mine_by_pin', pin }) })
    .then((r) => r.json()).then(setD).catch(() => setD({ ok: false, error: 'Network error' }))
  useEffect(() => { document.title = 'Your meetings · TMS'; load(); const iv = setInterval(load, 60000); return () => clearInterval(iv) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <p className="text-slate-500">Loading your meetings…</p>
  if (!d.ok) return <p className="text-red-700">{d.error || 'Could not load.'} Close this tab and open it again to sign in.</p>
  return (
    <>
      <p className="text-sm text-slate-600">{d.name}: {d.rooms.length ? 'every meeting you are part of. Tap Join, then "I\'m the host" if you are hosting.' : 'no meetings yet.'}</p>
      <div className="mt-4 space-y-3">
        {d.rooms.map((r) => (
          <div key={r.slug} className={`flex flex-wrap items-center gap-3 rounded-lg border bg-white p-4 shadow-sm ${r.live ? 'border-emerald-400' : 'border-slate-200'}`}>
            {r.badge ? <img src={r.badge} alt="" className="h-10 w-14 rounded bg-white object-contain p-0.5" /> : r.banner_url ? <img src={r.banner_url} alt="" className="h-10 w-16 rounded object-cover" /> : null}
            <div className="min-w-0 flex-1">
              <div className="font-bold text-slate-900">{r.team && <span className="mr-1" style={{ color: r.color || undefined }}>{r.team}</span>}{r.title}</div>
              {(r.host_names || []).length > 0 && <div className="text-sm font-semibold text-slate-700">👤 Host: {r.host_names.join(' & ')}</div>}
              <div className="text-sm text-slate-600">
                {r.live ? <span className="font-bold text-emerald-700">● LIVE now</span> : r.next_at ? <>Next: <b>{when(r.next_at)}</b> (Eastern)</> : r.schedule || 'Open any time'}
                {r.schedule && !r.live && r.next_at ? <span className="text-slate-400"> · {r.schedule}</span> : null}
              </div>
            </div>
            <a href={r.link} target="_blank" rel="noreferrer" className={`rounded-md px-4 py-2 text-sm font-bold text-white ${r.live || (r.open && r.scheduled) ? 'bg-emerald-600' : 'bg-brand-navy'}`}>{r.live || (r.open && r.scheduled) ? '▶ Join now' : 'Open'}</a>
          </div>
        ))}
      </div>
    </>
  )
}

export default function MyMeetings() {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-bold text-brand-navy">📅 Your meetings</h1>
        <div className="mt-3"><PinGate title="Your meetings" storageKey={KEY} keepPin><List /></PinGate></div>
      </div>
    </div>
  )
}
