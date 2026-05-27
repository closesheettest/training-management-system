import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

// Admin page for editing the link cards that show up on the public
// /welcome page. Same pattern as Handoff Contacts — CRUD with inline
// editing. The cron-sent SMS isn't edited here; that lives on
// /message-templates under "welcome_drip."

const blank = () => ({
  display_order: 0,
  label: '',
  url: '',
  description: '',
  icon: '',
  requires_google_signin: false,
  mandatory: false,
  mandatory_note: '',
  active: true,
})

export default function WelcomeLinks() {
  const [rows, setRows] = useState(null)
  const [editingId, setEditingId] = useState(null) // null | 'new' | uuid
  const [draft, setDraft] = useState(blank())
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    const { data, error } = await supabase
      .from('welcome_resources')
      .select('*')
      .order('display_order', { ascending: true })
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      setRows([])
      return
    }
    setRows(data || [])
  }

  function startAdd() {
    setDraft({ ...blank(), display_order: (Math.max(0, ...(rows || []).map((r) => r.display_order)) || 0) + 10 })
    setEditingId('new')
    setFlash(null)
  }

  function startEdit(r) {
    setDraft({ ...r })
    setEditingId(r.id)
    setFlash(null)
  }

  function cancel() {
    setEditingId(null)
    setDraft(blank())
  }

  async function save() {
    if (!draft.label.trim() || !draft.url.trim()) {
      setFlash({ kind: 'error', text: 'Label and URL are both required.' })
      return
    }
    setSaving(true)
    // Light URL normalization — auto-prepend https:// if the user pasted
    // a bare hostname like "sites.google.com/...", which is how a lot of
    // copy-pastes from the address bar arrive. Anything starting with a
    // scheme (https://, http://, mailto:, tel:) is left alone.
    let urlClean = draft.url.trim()
    if (urlClean && !/^[a-z][a-z0-9+.-]*:/i.test(urlClean)) {
      urlClean = 'https://' + urlClean
    }
    const payload = {
      display_order: Number(draft.display_order) || 0,
      label: draft.label.trim(),
      url: urlClean,
      description: draft.description?.trim() || null,
      icon: draft.icon?.trim() || null,
      requires_google_signin: !!draft.requires_google_signin,
      mandatory: !!draft.mandatory,
      mandatory_note: draft.mandatory_note?.trim() || null,
      active: !!draft.active,
      updated_at: new Date().toISOString(),
    }
    const { error } =
      editingId === 'new'
        ? await supabase.from('welcome_resources').insert(payload)
        : await supabase.from('welcome_resources').update(payload).eq('id', editingId)
    setSaving(false)
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      return
    }
    setFlash({ kind: 'success', text: editingId === 'new' ? 'Link added.' : 'Link saved.' })
    setEditingId(null)
    setDraft(blank())
    await load()
  }

  async function remove(r) {
    if (!confirm(`Delete "${r.label}"? This can't be undone.`)) return
    const { error } = await supabase.from('welcome_resources').delete().eq('id', r.id)
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      return
    }
    setFlash({ kind: 'success', text: 'Deleted.' })
    await load()
  }

  // Up/down reordering. Swaps display_order with the adjacent row in
  // the currently-sorted list — no manual number-juggling needed.
  // Sequential since `rows` is already sorted by display_order on load.
  async function move(row, direction) {
    const idx = rows.findIndex((r) => r.id === row.id)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= rows.length) return
    const other = rows[swapIdx]
    const now = new Date().toISOString()
    // Two-step swap. There's no unique constraint on display_order so
    // ordering doesn't matter; if it ever gets one, we'd need to bounce
    // through a temporary value to avoid the conflict.
    const r1 = await supabase
      .from('welcome_resources')
      .update({ display_order: other.display_order, updated_at: now })
      .eq('id', row.id)
    const r2 = await supabase
      .from('welcome_resources')
      .update({ display_order: row.display_order, updated_at: now })
      .eq('id', other.id)
    if (r1.error || r2.error) {
      setFlash({ kind: 'error', text: (r1.error || r2.error).message })
      return
    }
    await load()
  }

  if (rows === null) return <p className="text-sm text-slate-500">Loading…</p>

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Welcome page links</h1>
        <p className="mt-2 text-slate-600">
          These are the link cards that show up on the public{' '}
          <a href="/welcome" target="_blank" rel="noreferrer" className="text-sky-700 underline">
            /welcome
          </a>{' '}
          page that new reps get texted every day for 7 days after they graduate.
        </p>
        <div className="mt-3 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
          To edit the <strong>SMS text</strong> that gets sent, go to{' '}
          <strong>Settings ▾ → Message templates</strong> and look for the "Welcome — daily
          new-rep quick-links text" card.
        </div>
      </header>

      {flash && (
        <div
          className={
            'rounded-md border p-3 text-sm ' +
            (flash.kind === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-800')
          }
        >
          {flash.text}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={startAdd}
          className="rounded-md bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900"
        >
          + Add link
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-md border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600">
          No links yet. Click "+ Add link" to start.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r, i) => (
            <li
              key={r.id}
              className={
                'rounded-lg border p-4 shadow-sm ' +
                (r.active ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50 opacity-70')
              }
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {r.icon && <span className="text-xl" aria-hidden="true">{r.icon}</span>}
                    <span className="font-semibold text-slate-900">{r.label}</span>
                    {r.requires_google_signin && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                        Google sign-in
                      </span>
                    )}
                    {r.mandatory && (
                      <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                        ⚠️ Mandatory
                      </span>
                    )}
                    {!r.active && (
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                        Inactive
                      </span>
                    )}
                  </div>
                  <div className="mt-1 break-all text-xs text-sky-700">
                    <a href={r.url} target="_blank" rel="noreferrer">{r.url}</a>
                  </div>
                  {r.description && (
                    <div className="mt-1 text-sm text-slate-600">{r.description}</div>
                  )}
                  <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">
                    Position {i + 1} of {rows.length}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => move(r, 'up')}
                      disabled={i === 0}
                      title="Move up"
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => move(r, 'down')}
                      disabled={i === rows.length - 1}
                      title="Move down"
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-30"
                    >
                      ↓
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => startEdit(r)}
                      className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(r)}
                      className="rounded-md border border-red-300 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editingId && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
          // noValidate disables HTML5 form validation (required, type=url
          // pattern check, etc.) so the form ALWAYS submits and our JS
          // handler in save() decides what's valid. Without this, a URL
          // input the browser dislikes (no scheme, weird chars from a
          // paste) silently blocks submission with no error shown.
          noValidate
          className="rounded-lg border-2 border-brand-navy bg-white p-5 shadow-lg space-y-4"
        >
          <h3 className="text-lg font-semibold text-brand-navy">
            {editingId === 'new' ? '✏️ Add link' : '✏️ Edit link'}
          </h3>
          <div className="grid gap-3 sm:grid-cols-6">
            <Field label="Label *" className="sm:col-span-5">
              <input
                type="text"
                value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                required
                placeholder="Sales Rep Dashboard"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Icon (emoji)" hint="Optional — shows next to the label." className="sm:col-span-1">
              <input
                type="text"
                value={draft.icon}
                onChange={(e) => setDraft({ ...draft, icon: e.target.value })}
                placeholder="📊"
                maxLength={4}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </Field>
            <Field label="URL *" className="sm:col-span-6">
              <input
                type="url"
                value={draft.url}
                onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                required
                placeholder="https://"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Description" className="sm:col-span-6">
              <textarea
                rows={2}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="Short context shown under the link label."
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.requires_google_signin}
                onChange={(e) =>
                  setDraft({ ...draft, requires_google_signin: e.target.checked })
                }
                className="h-4 w-4"
              />
              🔐 Requires Google company sign-in (shows extra callout on the card)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
                className="h-4 w-4"
              />
              Active (visible on /welcome)
            </label>
          </div>

          <div className="rounded-md border border-red-200 bg-red-50 p-3 space-y-2">
            <label className="flex items-center gap-2 text-sm font-semibold text-red-900">
              <input
                type="checkbox"
                checked={draft.mandatory}
                onChange={(e) => setDraft({ ...draft, mandatory: e.target.checked })}
                className="h-4 w-4"
              />
              ⚠️ Mandatory — render this card in red with a banner across the top
            </label>
            {draft.mandatory && (
              <Field
                label="Banner text"
                hint={'Shown in the red banner. Keep it short — e.g. "MANDATORY — DON\'T MISS · CAMERA MUST BE ON".'}
              >
                <input
                  type="text"
                  value={draft.mandatory_note}
                  onChange={(e) => setDraft({ ...draft, mandatory_note: e.target.value })}
                  placeholder="MANDATORY — YOU CAN NOT MISS ANY · CAMERA MUST BE ON"
                  maxLength={120}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </Field>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={cancel}
              disabled={saving}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
            >
              {saving ? 'Saving…' : editingId === 'new' ? 'Add link' : 'Save changes'}
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
