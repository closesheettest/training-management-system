// /signing-docs — DOCUMENTS SENT FOR SIGNING (Neal, 2026-10-01).
//
// Grouped by document. Each rep: where they are (not opened / opened / partly signed /
// waiting on countersign / signed), the full trail with dates, the signed PDF, and a
// resend (one rep, or everyone still outstanding). Each document also shows — and lets
// you edit — where the signed copies are emailed. Behind the admin PIN (PinGate keepPin);
// every call is re-checked server-side (signing-docs).
import { useEffect, useState } from 'react'

const API = '/.netlify/functions/signing-docs'
const STATE = {
  not_sent: { label: 'Not sent yet', cls: 'bg-purple-100 text-purple-800' },
  not_opened: { label: 'Never opened', cls: 'bg-red-100 text-red-800' },
  opened: { label: 'Opened, not signed', cls: 'bg-amber-100 text-amber-800' },
  partial: { label: 'Partly signed', cls: 'bg-orange-100 text-orange-800' },
  countersign: { label: 'Signed — waiting on Jenn', cls: 'bg-sky-100 text-sky-800' },
  signed: { label: 'Signed', cls: 'bg-emerald-100 text-emerald-800' },
}
const fmtPhone = (p) => { const d = String(p || '').replace(/\D/g, '').slice(-10); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (p || '') }
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')

export default function SigningDocs() {
  const pin = (() => { try { return sessionStorage.getItem('sd_admin_ok_pin') || '' } catch { return '' } })()
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const call = async (body) => {
    const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin, ...body }) })
    const j = await r.json().catch(() => ({ ok: false, error: 'Could not reach the server' }))
    if (!j.ok) throw new Error(j.error || 'Something went wrong')
    return j
  }
  const load = async () => { setErr(''); try { setData(await call({ action: 'list' })) } catch (e) { setErr(e.message) } }
  useEffect(() => { document.title = 'Documents for Signing · U.S. Shingle'; load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-2xl font-bold text-brand-navy">✍️ Documents sent for signing</h1>
      <p className="mt-1 text-sm text-slate-600">Who has signed, who hasn&rsquo;t, and everything that happened on the way. Resend to anyone still outstanding.</p>
      {err && <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{err}</div>}
      {!data && !err && <p className="mt-6 text-slate-500">Loading…</p>}
      {data?.docs.map((d) => <DocCard key={d.key} d={d} call={call} reload={load} />)}
    </div>
  )
}

function DocCard({ d, call, reload }) {
  const [open, setOpen] = useState({})
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [filter, setFilter] = useState('out') // out | all | signed
  const [editing, setEditing] = useState(false)
  const [emails, setEmails] = useState((d.copy_to || []).join(', '))
  const outstanding = (d.reps || []).filter((r) => r.state !== 'signed' && r.state !== 'countersign')
  const counts = (d.reps || []).reduce((m, r) => ({ ...m, [r.state]: (m[r.state] || 0) + 1 }), {})
  const rows = (d.reps || []).filter((r) => filter === 'all' || (filter === 'signed' ? (r.state === 'signed' || r.state === 'countersign') : (r.state !== 'signed' && r.state !== 'countersign')))

  const resend = async (list) => {
    if (!list.length) return
    if (!window.confirm(`Resend "${d.title}" to ${list.length === 1 ? list[0].name : `${list.length} people`} by text and email?\n\n${list.map((r) => r.name).join(', ')}`)) return
    setBusy('send'); setMsg('')
    try {
      const j = await call({ action: 'resend', doc: d.key, ids: list.map((r) => r.id), first_ids: list.filter((r) => r.state === 'not_sent').map((r) => r.id) })
      setMsg(j.results.map((x) => `${x.name}: ${x.error ? x.error : [x.sms && 'text', x.email && 'email'].filter(Boolean).join(' + ') || 'failed'}`).join(' · '))
      reload()
    } catch (e) { setMsg(`⚠ ${e.message}`) }
    setBusy('')
  }
  const [edit, setEdit] = useState(null) // { id, phone, email }
  const [help, setHelp] = useState(null)  // "not getting texts" panel for one rep
  const smsHelp = async (r) => {
    if (help?.id === r.id) { setHelp(null); return }
    setHelp({ id: r.id, loading: true })
    try { const j = await call({ action: 'sms_help', id: r.id }); setHelp({ id: r.id, ...j }) }
    catch (e) { setHelp({ id: r.id, error: e.message }) }
  }
  const saveContact = async (r, andResend, clear = false) => {
    setBusy('edit'); setMsg('')
    try {
      await call({ action: 'contact', id: r.id, phone: clear ? '' : edit.phone, email: clear ? '' : edit.email })
      setEdit(null)
      if (andResend) {
        const j = await call({ action: 'resend', doc: d.key, ids: [r.id] })
        setMsg(j.results.map((x) => `${x.name}: ${x.error ? x.error : `sent — ${[x.sms && `text to ${x.to_phone}`, x.email && `email to ${x.to_email}`].filter(Boolean).join(' + ') || 'failed'}`}`).join(' · '))
      } else setMsg(clear ? `${r.name}: back to what's on file.` : `${r.name}: saved — the next send goes there.`)
      reload()
    } catch (e) { setMsg(`⚠ ${e.message}`) }
    setBusy('')
  }
  const saveCopyTo = async () => {
    setBusy('copy'); setMsg('')
    try {
      const j = await call({ action: 'copy_to', doc: d.key, emails: emails.split(/[,\s;]+/).filter(Boolean) })
      setEmails(j.copy_to.join(', ')); setEditing(false); setMsg(j.copy_to.length ? `Signed copies now go to ${j.copy_to.join(', ')}` : 'Back to the default recipients.')
    } catch (e) { setMsg(`⚠ ${e.message}`) }
    setBusy('')
  }

  return (
    <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold text-brand-navy">{d.title}</h2>
        <div className="flex flex-wrap gap-1.5 text-xs font-bold">
          {Object.entries(STATE).map(([k, v]) => counts[k] ? <span key={k} className={`rounded-full px-2 py-0.5 ${v.cls}`}>{counts[k]} {v.label.toLowerCase()}</span> : null)}
        </div>
      </div>
      {d.blurb && <p className="text-xs text-slate-500">{d.blurb}</p>}
      {d.error && <p className="mt-2 text-sm font-semibold text-red-700">{d.error}</p>}

      {/* Where signed copies go */}
      <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
        <span className="font-semibold text-slate-700">📧 Signed copies go to: </span>
        {!editing ? (
          <>
            <span className="text-slate-800">{(d.copy_to || []).length ? d.copy_to.join(', ') : (d.key === 'onboarding' ? 'the HR / admin notification list (default)' : 'Jenn (default)')}</span>
            <button type="button" onClick={() => setEditing(true)} className="ml-2 text-xs font-bold text-brand-navy underline">Edit</button>
          </>
        ) : (
          <span className="mt-1 flex flex-wrap items-center gap-2">
            <input value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="name@shingleusa.com, other@shingleusa.com" className="min-w-[280px] flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm" />
            <button type="button" onClick={saveCopyTo} disabled={busy === 'copy'} className="rounded-md bg-brand-navy px-3 py-1 text-xs font-bold text-white">Save</button>
            <button type="button" onClick={() => { setEditing(false); setEmails((d.copy_to || []).join(', ')) }} className="text-xs text-slate-500 underline">Cancel</button>
            <span className="w-full text-[11px] text-slate-500">Separate addresses with commas. Leave it empty to go back to the default.</span>
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {[['out', `Still outstanding (${outstanding.length})`], ['signed', 'Signed'], ['all', 'Everyone']].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} className={`rounded-full px-3 py-1 text-xs font-bold ${filter === k ? 'bg-brand-navy text-white' : 'border border-slate-300 text-slate-700'}`}>{l}</button>
        ))}
        <button type="button" disabled={!outstanding.length || busy === 'send'} onClick={() => resend(outstanding)}
          className="ml-auto rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-40">
          {busy === 'send' ? 'Sending…' : `📨 Resend to all outstanding (${outstanding.length})`}
        </button>
      </div>
      {msg && <div className="mt-2 text-xs font-semibold text-emerald-800">{msg}</div>}

      <div className="mt-3 divide-y divide-slate-100">
        {rows.map((r) => (
          <div key={r.id} className="py-2">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setOpen({ ...open, [r.id]: !open[r.id] })} className="text-left font-semibold text-slate-900">{open[r.id] ? '▾' : '▸'} {r.name}</button>
              <span className="text-xs text-slate-500">{r.group}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATE[r.state]?.cls || ''}`}>{STATE[r.state]?.label || r.state}</span>
              {r.pdf && <a href={r.pdf} target="_blank" rel="noreferrer" className="text-xs font-bold text-brand-navy underline">Signed PDF</a>}
              {r.pdf_error && <span className="text-xs font-bold text-red-700">⚠ PDF problem: {r.pdf_error}</span>}
              {r.state !== 'signed' && r.state !== 'countersign' && (
                <span className="ml-auto flex gap-1.5">
                  <button type="button" onClick={() => smsHelp(r)} className="rounded-md border border-amber-500 px-2 py-0.5 text-xs font-bold text-amber-700">📵 Not getting texts</button>
                  <button type="button" onClick={() => setEdit(edit?.id === r.id ? null : { id: r.id, phone: r.phone || '', email: r.email || '' })} className="rounded-md border border-slate-400 px-2 py-0.5 text-xs font-bold text-slate-700">✏️ Edit</button>
                  <button type="button" disabled={busy === 'send'} onClick={() => resend([r])} className="rounded-md border border-emerald-600 px-2 py-0.5 text-xs font-bold text-emerald-700">Resend</button>
                </span>
              )}
            </div>
            {r.override && <div className="pl-5 text-[11px] font-semibold text-violet-700">Sending to a different {[r.override.phone && 'phone', r.override.email && 'email'].filter(Boolean).join(' and ')} than on file</div>}
            {help?.id === r.id && (
              <div className="mt-2 rounded-lg border-2 border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                {help.loading ? 'Checking GoHighLevel…' : help.error ? <span className="font-semibold text-red-700">{help.error}</span> : !help.found ? (
                  <div>{help.reason} Use <b>✏️ Edit</b> if the number is wrong, then resend.</div>
                ) : (
                  <>
                    {help.blocked
                      ? <div className="font-bold">🚫 Their texts are blocked — at some point they replied STOP, so every text since has been dropped.</div>
                      : <div className="font-bold">Texts to {help.phone} aren&rsquo;t blocked on our side.</div>}
                    <div className="mt-1">Tell {r.name.split(' ')[0]}: <span className="rounded bg-white px-2 py-0.5 font-bold">text the word <u>START</u> to {fmtPhone(help.from_number)}</span>{help.from_is_default ? ' (our main line)' : ' — that’s the number our texts come from'}. They should start receiving texts again right away.</div>
                    {!help.blocked && <div className="mt-1 text-xs text-amber-900">Still nothing? The number on file may be wrong — use <b>✏️ Edit</b> to send it somewhere else.{help.last?.status ? ` Last text to them: ${help.last.status}${help.last.at ? `, ${when(help.last.at)}` : ''}.` : ''}</div>}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" disabled={busy === 'send'} onClick={() => { setHelp(null); resend([r]) }} className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-bold text-white">They texted START — resend now</button>
                      <button type="button" onClick={() => setHelp(null)} className="text-xs text-amber-900 underline">Close</button>
                    </div>
                  </>
                )}
              </div>
            )}
            {edit?.id === r.id && (
              <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                <div className="mb-2 text-xs text-slate-600">Not getting it? Send it somewhere else. This only changes where <b>signing links</b> go — their main record stays as is. On file: {r.on_file?.phone || 'no phone'} · {r.on_file?.email || 'no email'}</div>
                <div className="flex flex-wrap gap-2">
                  <input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} placeholder="Mobile number" className="w-44 rounded-md border border-slate-300 px-2 py-1" />
                  <input value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} placeholder="Email" className="min-w-[220px] flex-1 rounded-md border border-slate-300 px-2 py-1" />
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" disabled={busy === 'edit'} onClick={() => saveContact(r, false)} className="rounded-md border border-brand-navy px-3 py-1 text-xs font-bold text-brand-navy">Save</button>
                  <button type="button" disabled={busy === 'edit'} onClick={() => saveContact(r, true)} className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-bold text-white">Save &amp; resend</button>
                  {r.override && <button type="button" disabled={busy === 'edit'} onClick={() => { setEdit({ ...edit, phone: '', email: '' }); saveContact(r, false, true) }} className="text-xs text-slate-500 underline">Go back to what&rsquo;s on file</button>}
                  <button type="button" onClick={() => setEdit(null)} className="text-xs text-slate-500 underline">Cancel</button>
                </div>
              </div>
            )}
            {open[r.id] && (
              <div className="mt-1 pl-5 text-xs text-slate-600">
                <div className="mb-1">{r.phone || 'no phone'} · {r.email || 'no email'}</div>
                {(r.trail || []).length ? r.trail.map((t, i) => <div key={i}><span className="inline-block w-28 text-slate-400">{when(t.at)}</span>{t.what}</div>) : <div className="text-slate-400">Nothing yet — never opened.</div>}
              </div>
            )}
          </div>
        ))}
        {!rows.length && <p className="py-3 text-sm text-slate-500">Nobody here.</p>}
      </div>
    </section>
  )
}
