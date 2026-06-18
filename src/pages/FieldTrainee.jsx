import { useEffect, useState } from 'react'

// /field-trainee — field trainees (someone a regional manager is training in
// the field, not in a class). Add them here, then run the provisioning chain:
//   Send homework (→ trainee + manager, fires IT email provisioning)
//   → Email provisioned (fires app setup) → Apps set up (sends trainee
//   instructions) → Send final test (multiple-choice only).
// All backed by /field-trainee-api.

export default function FieldTrainee() {
  const [list, setList] = useState([])
  const [managers, setManagers] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null)       // `${id}:${action}` | 'add'
  const [flash, setFlash] = useState(null)
  const [form, setForm] = useState({ first_name: '', last_name: '', phone: '', email: '', region: '', manager_id: '' })
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searchMgr, setSearchMgr] = useState('')

  async function api(action, extra) {
    const res = await fetch('/.netlify/functions/field-trainee-api', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...(extra || {}) }),
    })
    return res.json()
  }
  async function load() {
    setLoading(true)
    const [l, m] = await Promise.all([api('list'), api('managers')])
    if (l.ok) setList(l.trainees || [])
    if (m.ok) setManagers(m.managers || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  // Debounced search for existing trainees to flag.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setResults([]); return }
    const id = setTimeout(async () => {
      const o = await api('search', { q })
      if (o.ok) setResults(o.results || [])
    }, 300)
    return () => clearTimeout(id)
  }, [query])

  async function markExisting(trainee_id) {
    setBusy(`mark:${trainee_id}`); setFlash(null)
    const o = await api('mark_existing', { trainee_id, manager_id: searchMgr || null })
    setBusy(null)
    if (!o.ok) { setFlash({ k: 'error', t: o.error }); return }
    setQuery(''); setResults([])
    setFlash({ k: 'success', t: 'Added to field trainees.' })
    load()
  }

  async function addTrainee(e) {
    e.preventDefault()
    if (!form.first_name.trim()) { setFlash({ k: 'error', t: 'First name required' }); return }
    if (!form.phone.trim() && !form.email.trim()) { setFlash({ k: 'error', t: 'Add a phone or email' }); return }
    setBusy('add'); setFlash(null)
    const o = await api('add', form)
    setBusy(null)
    if (!o.ok) { setFlash({ k: 'error', t: o.error }); return }
    setForm({ first_name: '', last_name: '', phone: '', email: '', region: '', manager_id: '' })
    setFlash({ k: 'success', t: 'Field trainee added.' })
    load()
  }
  async function step(id, action, confirmMsg) {
    if (confirmMsg && !confirm(confirmMsg)) return
    setBusy(`${id}:${action}`); setFlash(null)
    const o = await api(action, { id })
    setBusy(null)
    if (!o.ok) { setFlash({ k: 'error', t: o.error }); return }
    const done = {
      send_homework: `Homework sent (${(o.channels || []).join(', ') || 'no channel'}); IT notified to provision email.`,
      email_done: 'Marked email provisioned; app-setup team notified.',
      apps_done: `Trainee sent their setup instructions (${(o.channels || []).join(', ') || 'no channel'}).`,
      send_test: `Final test sent (${(o.channels || []).join(', ') || 'no channel'}).`,
    }[action] || 'Done.'
    setFlash({ k: 'success', t: done })
    load()
  }

  const full = (t) => `${t.first_name || ''} ${t.last_name || ''}`.trim()
  const dot = (on) => (on ? 'text-emerald-600' : 'text-slate-300')

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Field Trainee</h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          For someone trained in the field by a regional manager (not in a class). Add them, send the
          week of homework (looping in their manager), run them through provisioning, then send the
          final test once their manager says they're ready.
        </p>
      </header>

      {flash && (
        <div className={`rounded-md border p-3 text-sm ${flash.k === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>{flash.t}</div>
      )}

      {/* Flag an existing trainee */}
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-600">Already in the system?</h2>
        <p className="mb-3 text-xs text-slate-500">Search for someone who's already a trainee (e.g. from a cancelled class) and flag them as a field trainee — no duplicate created.</p>
        <div className="flex flex-wrap gap-2">
          <input className="min-w-[200px] flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Type a first or last name…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" value={searchMgr} onChange={(e) => setSearchMgr(e.target.value)}>
            <option value="">— Regional manager —</option>
            {managers.map((m) => <option key={m.id} value={m.id}>{m.name}{m.region ? ` · ${m.region}` : ''}</option>)}
          </select>
        </div>
        {results.length > 0 && (
          <ul className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-200">
            {results.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span><span className="font-semibold text-slate-900">{r.name}</span> <span className="text-slate-500">{r.phone || 'no phone'} · {r.email || 'no email'}{r.region ? ` · ${r.region}` : ''}</span></span>
                <button type="button" disabled={busy === `mark:${r.id}`} onClick={() => markExisting(r.id)}
                  className="shrink-0 rounded-md bg-brand-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-navy-dark disabled:opacity-50">
                  {busy === `mark:${r.id}` ? 'Adding…' : 'Make field trainee'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Add brand-new */}
      <form onSubmit={addTrainee} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-600">Or add a brand-new field trainee</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <input className="rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="First name" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
          <input className="rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Last name" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
          <input className="rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Cell phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <input className="rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Personal email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input className="rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Region (e.g. St Pete)" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} />
          <select className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" value={form.manager_id} onChange={(e) => setForm({ ...form, manager_id: e.target.value })}>
            <option value="">— Regional manager —</option>
            {managers.map((m) => <option key={m.id} value={m.id}>{m.name}{m.region ? ` · ${m.region}` : ''}</option>)}
          </select>
        </div>
        <div className="mt-4">
          <button type="submit" disabled={busy === 'add'} className="rounded-md bg-brand-navy px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-navy-dark disabled:opacity-50">
            {busy === 'add' ? 'Adding…' : '+ Add field trainee'}
          </button>
        </div>
      </form>

      {/* List */}
      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : list.length === 0 ? (
        <p className="rounded-md border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600">No field trainees yet — add one above.</p>
      ) : (
        <div className="space-y-4">
          {list.map((t) => {
            const hw = !!t.field_homework_sent_at, em = !!t.field_email_provisioned_at, ap = !!t.field_apps_done_at
            const B = (action, label, enabled, confirmMsg) => (
              <button type="button" disabled={!enabled || busy === `${t.id}:${action}`}
                onClick={() => step(t.id, action, confirmMsg)}
                className={`rounded-md px-3.5 py-2 text-sm font-semibold shadow-sm disabled:opacity-40 ${enabled ? 'bg-brand-navy text-white hover:bg-brand-navy-dark' : 'bg-slate-200 text-slate-500'}`}>
                {busy === `${t.id}:${action}` ? 'Working…' : label}
              </button>
            )
            return (
              <div key={t.id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-lg font-semibold text-slate-900">{full(t)}</h3>
                  <span className="text-xs text-slate-500">{t.phone || 'no phone'} · {t.email || 'no email'}{t.manager_name ? ` · mgr: ${t.manager_name}` : ''}</span>
                </div>

                {/* Status line */}
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span className={dot(hw)}>{hw ? '✓' : '○'} Homework</span>
                  <span className={dot(em)}>{em ? '✓' : '○'} Email provisioned</span>
                  <span className={dot(ap)}>{ap ? '✓' : '○'} Apps + instructions</span>
                  <span className={dot(!!t.field_instructions_sent_at)}>{t.field_instructions_sent_at ? '✓' : '○'} Trainee notified</span>
                </div>

                {/* Step buttons */}
                <div className="mt-4 flex flex-wrap gap-2">
                  {B('send_homework', hw ? '↻ Resend homework' : '① Send week homework', true)}
                  {B('email_done', em ? '✓ Email provisioned' : '② Email provisioned', hw && !em)}
                  {B('apps_done', ap ? '✓ Apps + instructions sent' : '③ Apps set up → send instructions', em && !ap)}
                  <span className="mx-1 self-center text-slate-300">|</span>
                  {B('send_test', '📝 Send final test (no essays)', true, `Send the FINAL TEST (no essays) to ${full(t)}? Only when their manager says they're ready.`)}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
