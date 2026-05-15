import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

// Message templates editor. Each row is one editable SMS body — the
// netlify functions load by key and substitute {placeholders} at send
// time. Saving is live; no redeploy needed.
//
// To add a new editable template:
//   1. Insert a row in the message_templates table with a unique `key`,
//      a human `label`, a `body`, and `placeholders` array.
//   2. In the relevant netlify function, call:
//        renderTemplate(supabase, '<key>', { <placeholders> })
//   3. The new template will appear on this page automatically.

export default function MessageTemplates() {
  const [rows, setRows] = useState(null)
  // Each draft is { body, subject } — subject is undefined for SMS templates.
  const [drafts, setDrafts] = useState({})
  const [savingKey, setSavingKey] = useState(null)
  const [flash, setFlash] = useState(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    const { data, error } = await supabase
      .from('message_templates')
      .select('*')
      .order('key', { ascending: true })
    if (error) {
      setRows([])
      setFlash({ kind: 'error', text: error.message })
      return
    }
    setRows(data || [])
    const initialDrafts = {}
    for (const r of data || []) {
      initialDrafts[r.key] = {
        body: r.body || '',
        // subject is undefined for SMS templates — keep it undefined so
        // we don't overwrite null with empty string on save.
        subject: r.subject !== null && r.subject !== undefined ? r.subject : undefined,
      }
    }
    setDrafts(initialDrafts)
  }

  async function save(row) {
    setSavingKey(row.key)
    setFlash(null)
    const draft = drafts[row.key] || {}
    const payload = {
      body: draft.body ?? '',
      updated_at: new Date().toISOString(),
    }
    // Only include subject if the row supports it (i.e. it had a non-null
    // subject in the DB). Avoids accidentally setting empty string on
    // SMS-only templates.
    if (row.subject !== null && row.subject !== undefined) {
      payload.subject = draft.subject ?? ''
    }
    const { error } = await supabase
      .from('message_templates')
      .update(payload)
      .eq('id', row.id)
    setSavingKey(null)
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      return
    }
    setFlash({ kind: 'success', text: `Saved "${row.label}".` })
    await load()
  }

  function resetDraft(row) {
    setDrafts({
      ...drafts,
      [row.key]: {
        body: row.body || '',
        subject: row.subject !== null && row.subject !== undefined ? row.subject : undefined,
      },
    })
  }

  function updateDraft(key, field, value) {
    setDrafts({
      ...drafts,
      [key]: { ...(drafts[key] || {}), [field]: value },
    })
  }

  if (rows === null) {
    return <p className="text-sm text-slate-500">Loading templates…</p>
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Message templates</h1>
        <p className="mt-2 text-slate-600">
          Edit the wording of the automated texts and emails the system sends. Changes are
          live — the next text uses your new wording, no redeploy needed.
        </p>
        <div className="mt-3 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
          <strong>Placeholders:</strong> wrap variable names in curly braces, e.g.{' '}
          <code className="rounded bg-white px-1">{'{firstName}'}</code>. Each template lists
          which placeholders it supports. Unknown placeholders are left as-is so you can spot
          typos — they show up in the text the trainee receives.
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

      {rows.length === 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          No templates in the database yet. Run the migration that seeds the
          <code className="mx-1">message_templates</code> table.
        </div>
      ) : (
        <ul className="space-y-4">
          {rows.map((r) => {
            const draft = drafts[r.key] || {}
            const isEmail = r.subject !== null && r.subject !== undefined
            const bodyChanged = (draft.body ?? '') !== (r.body ?? '')
            const subjectChanged = isEmail && (draft.subject ?? '') !== (r.subject ?? '')
            const isDirty = bodyChanged || subjectChanged
            return (
              <li
                key={r.id}
                className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm space-y-3"
              >
                <div>
                  <h3 className="font-semibold text-slate-900">
                    {r.label}
                    <span className={
                      'ml-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ' +
                      (isEmail ? 'bg-sky-100 text-sky-800' : 'bg-emerald-100 text-emerald-800')
                    }>
                      {isEmail ? '✉️ Email' : '📱 SMS'}
                    </span>
                  </h3>
                  {r.description && (
                    <p className="mt-1 text-xs text-slate-500">{r.description}</p>
                  )}
                </div>
                {isEmail && (
                  <label className="block">
                    <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Subject line
                    </span>
                    <input
                      type="text"
                      value={draft.subject ?? ''}
                      onChange={(e) => updateDraft(r.key, 'subject', e.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
                    />
                  </label>
                )}
                <label className="block">
                  <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {isEmail ? 'Email body' : 'Text body'}
                  </span>
                  <textarea
                    rows={isEmail ? 14 : 4}
                    value={draft.body ?? ''}
                    onChange={(e) => updateDraft(r.key, 'body', e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
                  />
                </label>
                {r.placeholders && r.placeholders.length > 0 && (
                  <p className="text-xs text-slate-500">
                    <strong>Available placeholders:</strong>{' '}
                    {r.placeholders.map((p) => (
                      <code
                        key={p}
                        className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.9em]"
                      >
                        {'{' + p + '}'}
                      </code>
                    ))}
                  </p>
                )}
                <div className="flex items-center justify-between">
                  <div className="text-xs text-slate-400">
                    Last saved {r.updated_at ? new Date(r.updated_at).toLocaleString() : '—'}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => resetDraft(r)}
                      disabled={!isDirty || savingKey === r.key}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                    >
                      Reset
                    </button>
                    <button
                      type="button"
                      onClick={() => save(r)}
                      disabled={!isDirty || savingKey === r.key}
                      className="rounded-md bg-slate-800 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-40"
                    >
                      {savingKey === r.key ? 'Saving…' : 'Save changes'}
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
