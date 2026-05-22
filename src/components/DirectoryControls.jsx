import { useState } from 'react'

// Shared building blocks for managing who appears in the /directory page
// and what fields are exposed. Used by /active-reps (where directory
// controls live alongside field-rep workflow) and /manage-directory
// (the dedicated admin panel).

// Fields the /directory page can expose. Order = display order in the
// modals. Single source of truth — matches the keys the
// list-directory-reps Netlify function reads from directory_hidden.
export const DIRECTORY_FIELDS = [
  { key: 'phone', label: 'Personal phone' },
  { key: 'company_phone', label: 'Work phone' },
  { key: 'email', label: 'Company email' },
  { key: 'region', label: 'Region' },
  { key: 'department', label: 'Department' },
  { key: 'level', label: 'Junior / Senior / Non-field badge' },
  { key: 'company_number', label: 'Company number' },
]

// One-line summary of a rep's directory visibility — "all 5 shown",
// "3 of 5 shown", "name only", etc.
export function directoryHiddenLabel(hidden) {
  const h = hidden && typeof hidden === 'object' ? hidden : {}
  const shown = DIRECTORY_FIELDS.filter((f) => !h[f.key]).length
  const total = DIRECTORY_FIELDS.length
  if (shown === total) return `all ${total} fields shown`
  if (shown === 0) return 'name only'
  return `${shown} of ${total} fields shown`
}

// Modal for adding OR editing one person's directory record. Pass
// `initial` with the existing trainee row to put it in edit mode
// (prefills values, retitles, swaps the submit label). Otherwise it
// opens as the "Add staff / management" form for non-trainee additions.
// Either way the onSave callback receives the full payload — the
// parent decides whether to insert or update.
export function AddStaffModal({ regionNames, initial, onCancel, onSave }) {
  const isEdit = !!initial
  const [form, setForm] = useState(() => ({
    first_name: initial?.first_name || '',
    last_name: initial?.last_name || '',
    phone: initial?.phone || '',
    company_phone: initial?.company_phone || '',
    company_email: initial?.company_email || '',
    region: initial?.region || '',
    department: initial?.department || '',
    company_number: initial?.company_number || '',
    rep_level: initial?.rep_level || 'non_field',
    directory_note: initial?.directory_note || '',
  }))
  const [hidden, setHidden] = useState(() => ({ ...(initial?.directory_hidden || {}) }))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const canSave =
    form.first_name.trim().length > 0 && form.last_name.trim().length > 0 && !saving

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }
  function toggleHidden(key) {
    setHidden((h) => ({ ...h, [key]: !h[key] }))
  }
  async function submit() {
    setErr(null)
    if (!canSave) return
    setSaving(true)
    try {
      await onSave({ ...form, directory_hidden: hidden })
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-slate-900">
          {isEdit ? `Edit ${initial.first_name} ${initial.last_name}` : 'Add staff / management'}
        </h3>
        <p className="mt-1 text-sm text-slate-600">
          {isEdit
            ? 'Update contact info, department, level, directory visibility, and the "how to reach me" note.'
            : 'For people who aren\'t going through training (HR, ops, leadership) but should appear in the team directory. They skip the registration / class / test workflow.'}
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field label="First name *">
            <input
              type="text"
              value={form.first_name}
              onChange={(e) => update('first_name', e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              autoFocus
            />
          </Field>
          <Field label="Last name *">
            <input
              type="text"
              value={form.last_name}
              onChange={(e) => update('last_name', e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Personal phone">
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => update('phone', e.target.value)}
              placeholder="(555) 123-4567"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Work phone">
            <input
              type="tel"
              value={form.company_phone}
              onChange={(e) => update('company_phone', e.target.value)}
              placeholder="(555) 987-6543"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Company email">
            <input
              type="email"
              value={form.company_email}
              onChange={(e) => update('company_email', e.target.value)}
              placeholder="jenn@shingleusa.com"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Region">
            <select
              value={form.region}
              onChange={(e) => update('region', e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">— none —</option>
              {regionNames.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </Field>
          <Field label="Department">
            <input
              type="text"
              value={form.department}
              onChange={(e) => update('department', e.target.value)}
              placeholder="e.g. Production, HR, Sales"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Company number">
            <input
              type="text"
              value={form.company_number}
              onChange={(e) => update('company_number', e.target.value)}
              placeholder="e.g. 1042"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Level">
            <select
              value={form.rep_level}
              onChange={(e) => update('rep_level', e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="non_field">Non-field (default for staff)</option>
              <option value="junior">Junior</option>
              <option value="senior">Senior</option>
            </select>
          </Field>
        </div>

        <div className="mt-3">
          <Field label="How to reach me — note (optional)">
            <textarea
              value={form.directory_note}
              onChange={(e) => update('directory_note', e.target.value)}
              placeholder="e.g. For install issues, file in JobNimbus instead of email — installs aren't tracked through my inbox."
              rows={3}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <span className="mt-1 block text-[11px] text-slate-500">
              Free-text guidance shown to everyone on the directory page — tells people the right
              channel for different topics so they don't guess.
            </span>
          </Field>
        </div>

        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Hide in the /directory phone-book
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Check anything that should NOT appear in the shared directory. Name is always visible.
            Example: Jenn from HR — check Phone, Region, Level, and Company number to expose only her email.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-1 text-sm">
            {DIRECTORY_FIELDS.map((f) => (
              <label key={f.key} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!hidden[f.key]}
                  onChange={() => toggleHidden(f.key)}
                />
                <span>{f.label}</span>
              </label>
            ))}
          </div>
        </div>

        {err && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            {err}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSave}
            className="rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? (isEdit ? 'Saving…' : 'Adding…') : (isEdit ? 'Save changes' : 'Add to team')}
          </button>
        </div>
      </div>
    </div>
  )
}

// Modal that toggles which fields appear in /directory for one person.
export function DirectoryVisibilityModal({ trainee, hidden, setHidden, sending, onCancel, onConfirm }) {
  function toggle(key) {
    setHidden({ ...hidden, [key]: !hidden[key] })
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-slate-900">
          Directory visibility — {trainee.first_name} {trainee.last_name}
        </h3>
        <p className="mt-2 text-sm text-slate-600">
          Pick which fields appear on the shared <code>/directory</code> page. Check a field to
          HIDE it. Name is always visible.
        </p>
        <div className="mt-4 space-y-2">
          {DIRECTORY_FIELDS.map((f) => (
            <label key={f.key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!hidden[f.key]}
                onChange={() => toggle(f.key)}
                disabled={sending}
              />
              <span>Hide {f.label.toLowerCase()}</span>
            </label>
          ))}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={sending}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={sending}
            className="rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {sending ? 'Saving…' : 'Save visibility'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Tiny labeled field wrapper used inside AddStaffModal.
function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}
