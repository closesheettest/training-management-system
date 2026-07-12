import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { usePersona } from '../lib/PersonaContext.jsx'

// Training Days — the structured sales-training curriculum.
//
// Managers submit a NEW day here → it saves as 'pending' and texts +
// emails the reviewers (DeWayne + Neal, whoever subscribes to the
// 'training_day_submitted' event). They open the private link, edit, and
// Activate it. Only then does it go live.
//
// The list is read-only for managers. Admins get a "Review & edit" link
// per row (opens the same reviewer page) so they can manage from here too.
// Activation always happens on the token-gated reviewer page — this page
// never flips a day live.

// One line per script line. A line wrapped in (parentheses) becomes a
// stage direction; everything else is spoken script. Matches the manual.
function parseScript(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (/^\(.*\)$/.test(l) ? { k: 'dir', t: l } : { k: 'say', t: l }))
}

const blankDraft = () => ({
  title: '',
  subject: '',
  on_slide: '',
  point: '',
  scriptText: '',
  coach: '',
  drill: '',
})

const STATUS_BADGE = {
  active: 'bg-emerald-100 text-emerald-800',
  pending: 'bg-amber-100 text-amber-800',
  archived: 'bg-slate-200 text-slate-600',
}

export default function TrainingDays() {
  const { persona } = usePersona()
  const isAdmin = persona?.role === 'admin' || persona?.role === 'test'

  const [rows, setRows] = useState(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState(blankDraft())
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState(null)
  const formRef = useRef(null)

  useEffect(() => { load() }, [])
  useEffect(() => {
    if (!adding) return
    const id = requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
    return () => cancelAnimationFrame(id)
  }, [adding])

  async function load() {
    const { data, error } = await supabase
      .from('training_days')
      .select('id, position, title, subject, status, source, submitted_by_name, review_token, created_at')
      .order('position', { ascending: true })
    if (error) { setFlash({ kind: 'error', text: error.message }); setRows([]); return }
    // active (by position) → pending (newest first) → archived
    const order = { active: 0, pending: 1, archived: 2 }
    const sorted = (data || []).slice().sort((a, b) => {
      const s = (order[a.status] ?? 3) - (order[b.status] ?? 3)
      if (s !== 0) return s
      if (a.status === 'active') return (a.position || 0) - (b.position || 0)
      return new Date(b.created_at) - new Date(a.created_at)
    })
    setRows(sorted)
  }

  function startAdd() { setDraft(blankDraft()); setAdding(true); setFlash(null) }
  function cancel() { setAdding(false); setDraft(blankDraft()) }

  async function submit() {
    if (!draft.title.trim() || !draft.point.trim() || !draft.scriptText.trim()) {
      setFlash({ kind: 'error', text: 'Please fill in Title, The point, and The script.' })
      return
    }
    setSaving(true)
    const token = (crypto?.randomUUID?.() || String(Math.random()).slice(2) + Date.now())
    const payload = {
      title: draft.title.trim(),
      subject: draft.subject.trim() || 'New',
      theme: draft.subject.trim() || 'Added Training',
      on_slide: draft.on_slide.trim() || null,
      point: draft.point.trim(),
      script: parseScript(draft.scriptText),
      coach: draft.coach.trim() || null,
      drill: draft.drill.trim() || null,
      status: 'pending',
      source: 'submission',
      review_token: token,
      submitted_by_name: persona?.name || 'A manager',
      submitted_by_recipient_id: persona?.id || null,
    }
    const { data, error } = await supabase.from('training_days').insert(payload).select('id').single()
    if (error) { setSaving(false); setFlash({ kind: 'error', text: error.message }); return }

    // Fire the reviewer notification (SMS + email). A failure here doesn't
    // lose the submission — it's saved as pending either way.
    let notifyNote = ''
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
    setFlash({ kind: 'success', text: `Submitted for review${notifyNote || ' — DeWayne & Neal have been notified.'}` })
    setAdding(false)
    setDraft(blankDraft())
    await load()
  }

  if (rows === null) return <p className="text-sm text-slate-500">Loading…</p>

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Training Days</h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          The sales-training curriculum — one slide-breakdown per day. Submit a new day below and it
          goes to <strong>DeWayne &amp; Neal</strong> for review; they edit and activate it before it
          goes live. Everyone stays on the same, consistent script.
        </p>
      </header>

      {flash && (
        <div className={'rounded-md border p-3 text-sm ' + (flash.kind === 'success'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
          : 'border-red-200 bg-red-50 text-red-800')}>
          {flash.text}
        </div>
      )}

      <div className="flex justify-end">
        <button type="button" onClick={startAdd}
          className="rounded-md bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900">
          + Submit a training day
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
                  {r.source === 'submission' && r.submitted_by_name ? <>Submitted by {r.submitted_by_name}</> : <>From the sales manual</>}
                </div>
              </div>
              {isAdmin && r.review_token && (
                <a href={`/review-training-day/${r.review_token}`} target="_blank" rel="noreferrer"
                  className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                  Review &amp; edit →
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <form ref={formRef} onSubmit={(e) => { e.preventDefault(); submit() }} noValidate
          className="space-y-4 rounded-lg border-2 border-brand-navy bg-white p-5 shadow-lg">
          <h3 className="text-lg font-semibold text-brand-navy">✏️ Submit a training day for review</h3>
          <p className="text-sm text-slate-600">
            This saves as <strong>pending</strong> and alerts the reviewers. It won't go live until they activate it.
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
            <Field label="On the slide (short description)" className="sm:col-span-6">
              <input type="text" value={draft.on_slide} onChange={(e) => setDraft({ ...draft, on_slide: e.target.value })}
                placeholder="What's on the slide, in a few words"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </Field>
            <Field label="The point *" className="sm:col-span-6">
              <textarea rows={2} value={draft.point} onChange={(e) => setDraft({ ...draft, point: e.target.value })}
                placeholder="A sentence or two on the objective of this day."
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
            </Field>
            <Field label="The script *" hint="One line per line. Wrap a line in (parentheses) to make it a stage direction." className="sm:col-span-6">
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
              {saving ? 'Submitting…' : 'Submit for review'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
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
