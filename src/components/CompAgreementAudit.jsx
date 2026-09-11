import { useEffect, useState } from 'react'

// Who has signed the pay documents and who has not.
//
// The Draw Program and the Compensation Plan carry SEPARATE signatures, so
// "Started, not finished" is its own row colour — a rep who signed one and
// stopped is invisible in a signed/unsigned split, and needs a different
// follow-up from someone who never opened the text (Neal, 2026-09-11).
//
// The nudge reuses send-group-message with explicit trainee_ids, the same path
// the original blast went out on — a second send mechanism is a second thing to
// keep in step with the first.
const AUDIT = '/.netlify/functions/comp-agreement-audit'
const SEND = '/.netlify/functions/send-group-message'

const STATE = {
  partial:    { label: 'Started, not finished', cls: 'bg-amber-100 text-amber-900' },
  opened:     { label: 'Opened, not signed',    cls: 'bg-orange-50 text-orange-800' },
  not_opened: { label: 'Not opened',            cls: 'bg-slate-100 text-slate-600' },
  signed:     { label: 'Signed',                cls: 'bg-green-100 text-green-800' },
}
const when = (t) => (t ? new Date(t).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—')

export default function CompAgreementAudit() {
  const [open, setOpen] = useState(false)
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState('')

  const load = () => {
    setD(null); setErr('')
    fetch(AUDIT).then((r) => r.json())
      .then((j) => { if (!j.ok) throw new Error(j.error || 'Could not load'); setD(j) })
      .catch((e) => setErr(e.message))
  }
  useEffect(() => { if (open && !d) load() }, [open])

  const chase = async () => {
    const targets = (d.reps || []).filter((r) => r.state !== 'signed')
    if (!targets.length) return
    if (!window.confirm(`Text and email ${targets.length} rep${targets.length > 1 ? 's' : ''} who haven't finished signing?`)) return
    setBusy(true); setSent(''); setErr('')
    try {
      let off = 0, total = 0
      while (off !== null) {
        const res = await fetch(SEND, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trainee_ids: targets.map((r) => r.id),
            channels: { sms: true, email: true },
            sms_body: "{firstName} — reminder: the new pay and draw still needs your signature. Both documents: {signlink}",
            email_subject: 'Reminder — your pay and draw plan still needs signing',
            email_body: '{firstName},\n\nThis is a reminder that the new pay and draw still needs your signature.\n\n{signlink}\n\nThere are two documents and each is signed separately — the form will not submit until both are done.\n\nU.S. Shingle & Metal',
            offset: off,
          }),
        })
        const j = await res.json()
        if (!j.ok) throw new Error(j.error || 'Send failed')
        total += (j.counts && j.counts.recipients) || 0
        off = j.next_offset
      }
      setSent(`Reminder sent to ${total}.`)
      load()
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  const c = (d && d.counts) || {}
  const outstanding = d ? (d.reps || []).filter((r) => r.state !== 'signed').length : 0

  return (
    <section className="mb-6">
      <button type="button" onClick={() => setOpen(!open)}
        className="w-full rounded-lg bg-[#0f766e] px-4 py-3 text-left font-semibold text-white shadow hover:opacity-95">
        ✍️ Pay &amp; draw signatures {open ? '▾' : '▸'}
        <div className="text-xs font-normal opacity-90">
          Who has signed the Draw Program and the Inspection Compensation Plan, and who still needs chasing.
          Each document is signed separately, so “started, not finished” is its own state.
        </div>
      </button>

      {open && (
        <div className="mt-3">
          {err && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div>}
          {sent && <div className="mb-3 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">✓ {sent}</div>}
          {!d && !err && <div className="py-6 text-center text-sm text-slate-400">Loading…</div>}

          {d && (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold text-slate-700">{d.sent_to} sent</span>
                {['signed', 'partial', 'opened', 'not_opened'].filter((k) => c[k]).map((k) => (
                  <span key={k} className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATE[k].cls}`}>{c[k]} {STATE[k].label.toLowerCase()}</span>
                ))}
                <button type="button" onClick={load} className="ml-auto rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold">Refresh</button>
                <button type="button" onClick={chase} disabled={busy || !outstanding}
                  className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40">
                  {busy ? 'Sending…' : `Nudge the ${outstanding} outstanding`}
                </button>
              </div>

              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="px-2 py-1.5 text-left font-semibold">Rep</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Status</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Draw</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Comp plan</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Signed copy</th>
                  </tr>
                </thead>
                <tbody>
                  {d.reps.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100">
                      <td className="px-2 py-1.5 font-semibold text-slate-800">{r.name}</td>
                      <td className="px-2 py-1.5">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATE[r.state].cls}`}>{STATE[r.state].label}</span>
                      </td>
                      <td className="px-2 py-1.5 text-slate-600">{when(r.draw_signed_at)}</td>
                      <td className="px-2 py-1.5 text-slate-600">{when(r.plan_signed_at)}</td>
                      <td className="px-2 py-1.5">
                        {r.pdf ? <a href={r.pdf} target="_blank" rel="noreferrer" className="font-semibold text-teal-700 underline">Open PDF</a>
                          : r.pdf_error ? <span className="text-xs font-semibold text-red-600">signed, no document — {r.pdf_error}</span>
                          : <span className="text-slate-300">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-slate-400">
                Signed copies also go to Jenn by email as they come in. PDF links expire after an hour.
              </p>
            </>
          )}
        </div>
      )}
    </section>
  )
}
