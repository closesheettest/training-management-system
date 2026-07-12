import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { usePersona } from '../lib/PersonaContext.jsx'

// Ongoing Training — the structured sales-training curriculum.
//
// Two paths, by who's using it:
//   • ADMIN (DeWayne / Neal): add or edit a day → it goes LIVE immediately.
//     No pending, no review, no notification — admin IS the reviewer.
//   • MANAGER (hiring_manager / trainer): submit a new day → saves as
//     'pending' and texts + emails the reviewers a private link. It only
//     goes live once a reviewer activates it (on /review-training-day/:token).
//
// All writes are direct Supabase (anon key, open RLS) — same as the other
// admin CRUD pages. The reviewer link + notification exist only for the
// manager-submission path.

function parseScript(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (/^\(.*\)$/.test(l) ? { k: 'dir', t: l } : { k: 'say', t: l }))
}
function scriptToText(script) {
  return (Array.isArray(script) ? script : []).map((s) => s.t).join('\n')
}

const blankDraft = () => ({ title: '', subject: '', on_slide: '', point: '', scriptText: '', coach: '', drill: '' })

const STATUS_BADGE = {
  active: 'bg-emerald-100 text-emerald-800',
  pending: 'bg-amber-100 text-amber-800',
  archived: 'bg-slate-200 text-slate-600',
}

export default function TrainingDays() {
  const { persona } = usePersona()
  const isAdmin = persona?.role === 'admin' || persona?.role === 'test'
  const who = persona?.name || (isAdmin ? 'Admin' : 'A manager')

  const [rows, setRows] = useState(null)
  const [editingId, setEditingId] = useState(null) // null | 'new' | uuid
  const [draft, setDraft] = useState(blankDraft())
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState(null)
  const [sendOn, setSendOn] = useState(null)   // null=unknown, true/false
  const [togglingSend, setTogglingSend] = useState(false)
  const [usage, setUsage] = useState([])
  const formRef = useRef(null)

  useEffect(() => { load(); if (isAdmin) { loadSettings(); loadUsage() } }, [])

  async function loadSettings() {
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'ongoing_training_daily_send').maybeSingle()
    setSendOn(data ? data.value === 'on' : false)
  }

  async function toggleSend() {
    const next = sendOn ? 'off' : 'on'
    setTogglingSend(true)
    const { error } = await supabase.from('app_settings')
      .upsert({ key: 'ongoing_training_daily_send', value: next, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    setTogglingSend(false)
    if (error) { setFlash({ kind: 'error', text: `Couldn't change the toggle: ${error.message}` }); return }
    setSendOn(next === 'on')
    setFlash({ kind: 'success', text: next === 'on' ? 'Daily send is ON — managers get the 8 AM link Mon–Thu.' : 'Daily send is OFF — nothing goes out.' })
  }

  async function loadUsage() {
    const { data } = await supabase.from('training_views')
      .select('manager_id, manager_name, seconds, opened_at')
      .order('opened_at', { ascending: false }).limit(1000)
    const byMgr = new Map()
    for (const v of data || []) {
      const key = v.manager_id || v.manager_name
      if (!key) continue
      const cur = byMgr.get(key) || { name: v.manager_name || 'Manager', sessions: 0, seconds: 0, last: v.opened_at }
      cur.sessions += 1
      cur.seconds += v.seconds || 0
      if (new Date(v.opened_at) > new Date(cur.last)) cur.last = v.opened_at
      byMgr.set(key, cur)
    }
    setUsage([...byMgr.values()].sort((a, b) => new Date(b.last) - new Date(a.last)))
  }
  useEffect(() => {
    if (!editingId) return
    const id = requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
    return () => cancelAnimationFrame(id)
  }, [editingId])

  async function load() {
    const { data, error } = await supabase.from('training_days').select('*').order('position', { ascending: true })
    if (error) { setFlash({ kind: 'error', text: error.message }); setRows([]); return }
    const order = { active: 0, pending: 1, archived: 2 }
    const sorted = (data || []).slice().sort((a, b) => {
      const s = (order[a.status] ?? 3) - (order[b.status] ?? 3)
      if (s !== 0) return s
      if (a.status === 'active') return (a.position || 0) - (b.position || 0)
      return new Date(b.created_at) - new Date(a.created_at)
    })
    setRows(sorted)
  }

  function nextPosition() {
    return (rows || []).filter((r) => r.status === 'active').reduce((m, r) => Math.max(m, r.position || 0), 0) + 1
  }

  function startAdd() { setDraft(blankDraft()); setEditingId('new'); setFlash(null) }
  function startEdit(r) {
    setDraft({
      title: r.title || '', subject: r.subject || '', on_slide: r.on_slide || '',
      point: r.point || '', scriptText: scriptToText(r.script), coach: r.coach || '', drill: r.drill || '',
    })
    setEditingId(r.id); setFlash(null)
  }
  function cancel() { setEditingId(null); setDraft(blankDraft()) }

  function fieldsFromDraft() {
    return {
      title: draft.title.trim(),
      subject: draft.subject.trim() || 'New',
      theme: draft.subject.trim() || 'Added Training',
      on_slide: draft.on_slide.trim() || null,
      point: draft.point.trim(),
      script: parseScript(draft.scriptText),
      coach: draft.coach.trim() || null,
      drill: draft.drill.trim() || null,
    }
  }

  async function save() {
    if (!draft.title.trim() || !draft.point.trim() || !draft.scriptText.trim()) {
      setFlash({ kind: 'error', text: 'Please fill in Title, The point, and The script.' })
      return
    }
    setSaving(true)
    const now = new Date().toISOString()
    const token = (crypto?.randomUUID?.() || String(Math.random()).slice(2) + Date.now())
    const fields = fieldsFromDraft()

    // ── ADMIN: everything goes live immediately, no review ──────────────
    if (isAdmin) {
      let error
      if (editingId === 'new') {
        ;({ error } = await supabase.from('training_days').insert({
          ...fields, status: 'active', source: 'submission', review_token: token,
          position: nextPosition(), activated_at: now, activated_by: who,
          submitted_by_name: who, submitted_by_recipient_id: persona?.id || null,
        }))
      } else {
        const row = rows.find((r) => r.id === editingId)
        const patch = { ...fields, status: 'active', activated_by: who, updated_at: now }
        // First time it goes live (was pending/archived): append + stamp.
        if (row && row.status !== 'active') { patch.position = nextPosition(); patch.activated_at = now }
        ;({ error } = await supabase.from('training_days').update(patch).eq('id', editingId))
      }
      setSaving(false)
      if (error) { setFlash({ kind: 'error', text: error.message }); return }
      setFlash({ kind: 'success', text: editingId === 'new' ? 'Added and published live.' : 'Saved — live now.' })
      setEditingId(null); setDraft(blankDraft()); await load()
      return
    }

    // ── MANAGER: submit for review (pending + notify) ───────────────────
    const { data, error } = await supabase.from('training_days').insert({
      ...fields, status: 'pending', source: 'submission', review_token: token,
      submitted_by_name: who, submitted_by_recipient_id: persona?.id || null,
    }).select('id').single()
    if (error) { setSaving(false); setFlash({ kind: 'error', text: error.message }); return }

    let notifyNote = ' — DeWayne & Neal have been notified.'
    try {
      const res = await fetch('/.netlify/functions/notify-training-day-submitted', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submission_id: data.id }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.ok) notifyNote = ' (but the reviewer alert didn\'t send — check the Notifications page has DeWayne & Neal subscribed).'
      else if ((j.sms_sent || 0) + (j.email_sent || 0) === 0) notifyNote = ' — no reviewers are subscribed yet, so no alert went out. Add them on the Notifications page.'
    } catch {
      notifyNote = ' (but the reviewer alert couldn\'t send — try again).'
    }
    setSaving(false)
    setFlash({ kind: 'success', text: `Submitted for review${notifyNote}` })
    setEditingId(null); setDraft(blankDraft()); await load()
  }

  if (rows === null) return <p className="text-sm text-slate-500">Loading…</p>

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Ongoing Training</h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          The sales-training curriculum — one slide-breakdown per day. {isAdmin ? (
            <>As an admin, anything you add or edit here <strong>goes live immediately</strong>.</>
          ) : (
            <>Submit a new day below and it goes to <strong>DeWayne &amp; Neal</strong> to review and activate before it goes live.</>
          )} Keeps every rep on the same script.
        </p>
      </header>

      {flash && (
        <div className={'rounded-md border p-3 text-sm ' + (flash.kind === 'success'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
          : 'border-red-200 bg-red-50 text-red-800')}>
          {flash.text}
        </div>
      )}

      {isAdmin && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-900">Daily auto-send to managers</span>
                <span className={'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ' + (sendOn ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600')}>
                  {sendOn === null ? '…' : sendOn ? 'On' : 'Off'}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Texts + emails each regional manager that day's training link at <strong>8:00 AM ET, Mon–Thu</strong>. Keep it OFF until you're done reviewing.
              </p>
            </div>
            <button type="button" onClick={toggleSend} disabled={togglingSend || sendOn === null}
              role="switch" aria-checked={!!sendOn}
              className={'relative h-7 w-12 flex-none rounded-full transition-colors ' + (sendOn ? 'bg-emerald-500' : 'bg-slate-300') + (togglingSend ? ' opacity-60' : '')}>
              <span className={'absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ' + (sendOn ? 'left-[22px]' : 'left-0.5')} />
            </button>
          </div>
        </div>
      )}

      {isAdmin && usage.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-2 text-sm font-semibold text-slate-900">Who's using it</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-1 pr-4">Manager</th><th className="py-1 pr-4">Opens</th><th className="py-1 pr-4">Total time</th><th className="py-1">Last opened</th>
                </tr>
              </thead>
              <tbody>
                {usage.map((u, k) => (
                  <tr key={k} className="border-t border-slate-100">
                    <td className="py-1.5 pr-4 font-medium text-slate-800">{u.name}</td>
                    <td className="py-1.5 pr-4 tabular-nums">{u.sessions}</td>
                    <td className="py-1.5 pr-4 tabular-nums">{fmtMins(u.seconds)}</td>
                    <td className="py-1.5 text-slate-500">{fmtWhen(u.last)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button type="button" onClick={startAdd}
          className="rounded-md bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900">
          {isAdmin ? '+ Add a training day' : '+ Submit a training day'}
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-md border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600">
          No training days yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ' + (STATUS_BADGE[r.status] || 'bg-slate-100 text-slate-600')}>
                    {r.status}
                  </span>
                  <span className="font-semibold text-slate-900">{r.title}</span>
                  {r.subject && <span className="text-xs text-slate-400">· {r.subject}</span>}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {r.status === 'active' && <>Day {r.position} · </>}
                  {r.source === 'submission' && r.submitted_by_name ? <>By {r.submitted_by_name}</> : <>From the sales manual</>}
                </div>
              </div>
              {isAdmin && (
                <div className="flex gap-2">
                  <a href={`/ongoing-training/view/preview?id=${r.id}`} target="_blank" rel="noreferrer"
                    className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                    View
                  </a>
                  <button type="button" onClick={() => startEdit(r)}
                    className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                    Edit
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {editingId && (
        <form ref={formRef} onSubmit={(e) => { e.preventDefault(); save() }} noValidate
          className="space-y-4 rounded-lg border-2 border-brand-navy bg-white p-5 shadow-lg">
          <h3 className="text-lg font-semibold text-brand-navy">
            {editingId === 'new'
              ? (isAdmin ? '✏️ Add a training day' : '✏️ Submit a training day for review')
              : '✏️ Edit training day'}
          </h3>
          <p className="text-sm text-slate-600">
            {isAdmin
              ? 'Saving publishes this live right away.'
              : 'This saves as pending and alerts the reviewers. It won\'t go live until they activate it.'}
          </p>
          <div className="grid gap-3 sm:grid-cols-6">
            <Field label="Title *" className="sm:col-span-4">
              <input type="text" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder='e.g. Handling "I need to think about it"'
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </Field>
            <Field label="Subject / topic" className="sm:col-span-2">
              <input type="text" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                placeholder="Objection Handling"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </Field>
            <Field label="Overview (short description)" className="sm:col-span-6">
              <input type="text" value={draft.on_slide} onChange={(e) => setDraft({ ...draft, on_slide: e.target.value })}
                placeholder="What it covers, in a few words"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </Field>
            <Field label="The point *" className="sm:col-span-6">
              <textarea rows={2} value={draft.point} onChange={(e) => setDraft({ ...draft, point: e.target.value })}
                placeholder="A sentence or two on the objective of this day."
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </Field>
            <Field label="The script *" hint="One line per line. Wrap a line in (parentheses) for a note or aside." className="sm:col-span-6">
              <textarea rows={6} value={draft.scriptText} onChange={(e) => setDraft({ ...draft, scriptText: e.target.value })}
                placeholder={'Say this line to the homeowner...\n(then pause and point to the iPad)\nThen say this next line...'}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono" />
            </Field>
            <Field label="Coach your team" className="sm:col-span-3">
              <textarea rows={2} value={draft.coach} onChange={(e) => setDraft({ ...draft, coach: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </Field>
            <Field label="Run the drill" className="sm:col-span-3">
              <textarea rows={2} value={draft.drill} onChange={(e) => setDraft({ ...draft, drill: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={cancel} disabled={saving}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="rounded-md bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-50">
              {saving ? 'Saving…'
                : editingId === 'new'
                  ? (isAdmin ? 'Add & publish live' : 'Submit for review')
                  : 'Save changes (live)'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

function fmtMins(seconds) {
  const m = Math.round((seconds || 0) / 60)
  if (m < 1) return '<1 min'
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}
function fmtWhen(iso) {
  try {
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  } catch { return '' }
}

function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}
