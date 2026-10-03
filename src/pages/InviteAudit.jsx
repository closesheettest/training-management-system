// /invite-audit/:tag — who got a class notice, who opened their link, who confirmed
// (Neal, 2026-10-03, Week A going virtual). Admin PIN; data from invite-audit.js.
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

const when = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')

export default function InviteAudit() {
  const { tag } = useParams()
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const pin = (() => { try { return sessionStorage.getItem('ia_admin_ok_pin') || '' } catch { return '' } })()
  const load = async () => {
    setErr('')
    try {
      const j = await (await fetch('/.netlify/functions/invite-audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'report', pin, tag }) })).json()
      if (!j.ok) throw new Error(j.error || 'Could not load')
      setD(j)
    } catch (e) { setErr(e.message) }
  }
  useEffect(() => { document.title = 'Notice tracker · U.S. Shingle'; load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const rows = d?.rows || []
  const n = (f) => rows.filter(f).length
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-2xl font-bold text-brand-navy">📨 {d?.title || 'Notice tracker'}</h1>
      {d && <p className="mt-1 text-sm text-slate-600">Sent {when(d.sent_at)} · <b>{rows.length}</b> people · <b>{n((r) => r.opens)}</b> opened · <b className="text-emerald-700">{n((r) => r.confirmation === 'confirmed')}</b> confirmed · <b className="text-red-700">{n((r) => r.confirmation === 'declined')}</b> can't make it · <b>{n((r) => !r.opens)}</b> haven't opened yet</p>}
      <button type="button" onClick={load} className="mt-2 rounded-md border border-slate-300 px-3 py-1 text-sm font-semibold text-slate-700">↻ Refresh</button>
      {err && <div className="mt-3 text-sm font-semibold text-red-700">{err}</div>}
      {d && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-left text-slate-700">
              <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Sent</th><th className="px-3 py-2">Opened the link</th><th className="px-3 py-2">Answer</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.name + r.phone}>
                  <td className="px-3 py-2 font-semibold text-slate-900">{r.name}<div className="text-xs font-normal text-slate-500">{r.phone}</div></td>
                  <td className="px-3 py-2 text-xs">{when(r.sent_at)}<div className={r.sms ? 'text-emerald-700' : 'text-red-700'}>{r.sms ? '✓ text' : '✗ text failed'}</div><div className={r.email_ok ? 'text-emerald-700' : 'text-red-700'}>{r.email_ok ? '✓ email' : '✗ email failed'}</div></td>
                  <td className="px-3 py-2 text-xs">{r.opens ? <><b className="text-emerald-700">✓ Opened</b> {r.opens > 1 ? `(${r.opens} times)` : ''}<div>first {when(r.opened_first)}</div>{r.opens > 1 && <div>last {when(r.opened_last)}</div>}</> : <span className="font-bold text-amber-700">Not opened yet</span>}</td>
                  <td className="px-3 py-2">{r.confirmation === 'confirmed' ? <span className="rounded bg-emerald-100 px-2 py-0.5 font-bold text-emerald-800">✅ Coming</span> : r.confirmation === 'declined' ? <span className="rounded bg-red-100 px-2 py-0.5 font-bold text-red-800">❌ Can't make it</span> : <span className="text-slate-400">No answer yet</span>}{r.confirmed_at && <div className="text-xs text-slate-500">{when(r.confirmed_at)}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
