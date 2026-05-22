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
  { key: 'region', label: 'Territory' },
  { key: 'department', label: 'Department' },
  { key: 'level', label: 'Junior / Senior / Non-field badge' },
  { key: 'birthday', label: 'Birthday' },
]

// Department names get normalized on every write so casing/whitespace
// differences ("office" vs "Office" vs "  Office  ") all collapse to
// the same canonical Title Case ("Office"). Returns null for empty
// input so empty strings clear the field cleanly.
export function normalizeDepartment(raw) {
  if (raw == null) return null
  const trimmed = String(raw).trim().replace(/\s+/g, ' ')
  if (!trimmed) return null
  return trimmed
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ')
}

// Normalize the directory_note value coming from the DB into a
// plain object keyed by department (plus optional "_default" general
// note). Tolerates legacy string values (wraps as { _default: str }),
// null/undefined (returns {}), and stray non-string entries (dropped).
export function notesFromDb(raw) {
  if (raw == null) return {}
  if (typeof raw === 'string') {
    const t = raw.trim()
    return t ? { _default: t } : {}
  }
  if (typeof raw === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'string' && v.trim()) out[k] = v.trim()
    }
    return out
  }
  return {}
}

// Strip empties and return either a clean object (for storage) or
// null when nothing's left. Mirrors notesFromDb on the write path.
export function notesForDb(notes) {
  if (!notes || typeof notes !== 'object') return null
  const out = {}
  for (const [k, v] of Object.entries(notes)) {
    if (typeof v === 'string' && v.trim()) out[k] = v.trim()
  }
  return Object.keys(out).length ? out : null
}

// Editor for the per-department notes. When the person has 0 or 1
// departments, renders a single textarea (familiar single-note UX).
// With 2+ departments, renders one textarea per department plus a
// "general fallback" textarea — admin can leave dept-specific notes
// empty and just write the fallback if they want one note for everyone.
export function NoteEditor({ departments, notes, setNotes, disabled }) {
  const depts = Array.isArray(departments) ? departments.filter(Boolean) : []
  function setKey(key, text) {
    const next = { ...(notes || {}) }
    if (text && text.trim()) next[key] = text
    else delete next[key]
    setNotes(next)
  }
  if (depts.length <= 1) {
    return (
      <textarea
        value={notes?._default || ''}
        onChange={(e) => setKey('_default', e.target.value)}
        placeholder="e.g. If this is about an install for one of your customers, file it in JobNimbus instead of emailing."
        rows={4}
        disabled={disabled}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
    )
  }
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-slate-500">
        Per-department notes — leave any blank to skip that department, or fill in just the
        General one to show one note everywhere.
      </p>
      {depts.map((d) => (
        <label key={d} className="block">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            For {d}
          </span>
          <textarea
            value={notes?.[d] || ''}
            onChange={(e) => setKey(d, e.target.value)}
            rows={2}
            disabled={disabled}
            className="mt-0.5 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
      ))}
      <label className="block">
        <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          General (shown alongside the dept-specific ones)
        </span>
        <textarea
          value={notes?._default || ''}
          onChange={(e) => setKey('_default', e.target.value)}
          rows={2}
          disabled={disabled}
          className="mt-0.5 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </label>
    </div>
  )
}

// Comma-separated input → array of normalized, deduped department names.
// Each token runs through normalizeDepartment so "office, OFFICE" yields
// just ["Office"]. Returns [] for empty/whitespace input (the column is
// text[] not null, so callers should treat [] as "no departments set").
export function normalizeDepartments(raw) {
  if (raw == null) return []
  const parts = String(raw).split(',').map(normalizeDepartment).filter(Boolean)
  const seen = new Set()
  const out = []
  for (const p of parts) {
    if (seen.has(p)) continue
    seen.add(p)
    out.push(p)
  }
  return out
}

// Phones support sub-modes beyond simple show/hide: Call+Text, Call only,
// Text only, or fully hidden. State lives in directory_hidden using
// three keys per phone:
//   '<phoneKey>'       (true) — hide entirely (no actions)
//   '<phoneKey>_call'  (true) — block the Call action
//   '<phoneKey>_text'  (true) — block the Text action
// Missing keys = action enabled. So nothing set = Call+Text (default).
export function getPhoneMode(hidden, phoneKey) {
  if (hidden && hidden[phoneKey]) return 'hidden'
  const noCall = !!(hidden && hidden[`${phoneKey}_call`])
  const noText = !!(hidden && hidden[`${phoneKey}_text`])
  if (noCall && noText) return 'hidden'
  if (noCall) return 'text_only'
  if (noText) return 'call_only'
  return 'both'
}

export function setPhoneMode(hidden, phoneKey, mode) {
  const next = { ...(hidden || {}) }
  delete next[phoneKey]
  delete next[`${phoneKey}_call`]
  delete next[`${phoneKey}_text`]
  if (mode === 'hidden') next[phoneKey] = true
  else if (mode === 'call_only') next[`${phoneKey}_text`] = true
  else if (mode === 'text_only') next[`${phoneKey}_call`] = true
  // 'both' → leave all three keys absent
  return next
}

// Renders the 4-option radio group for one phone's visibility.
export function PhoneVisibilityChoice({ phoneKey, label, hidden, setHidden, disabled }) {
  const mode = getPhoneMode(hidden, phoneKey)
  const opts = [
    { value: 'both', label: '📞 Call + 💬 Text' },
    { value: 'call_only', label: '📞 Call only' },
    { value: 'text_only', label: '💬 Text only' },
    { value: 'hidden', label: 'Hidden' },
  ]
  return (
    <div>
      <div className="text-xs font-semibold text-slate-700">{label}</div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        {opts.map((o) => (
          <label key={o.value} className="flex items-center gap-1 text-sm">
            <input
              type="radio"
              name={`vis-${phoneKey}`}
              checked={mode === o.value}
              onChange={() => setHidden(setPhoneMode(hidden, phoneKey, o.value))}
              disabled={disabled}
            />
            {o.label}
          </label>
        ))}
      </div>
    </div>
  )
}

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
export function AddStaffModal({ regionNames, existingDepartments = [], initial, onCancel, onSave }) {
  const isEdit = !!initial
  const [form, setForm] = useState(() => ({
    first_name: initial?.first_name || '',
    last_name: initial?.last_name || '',
    phone: initial?.phone || '',
    company_phone: initial?.company_phone || '',
    company_email: initial?.company_email || '',
    region: initial?.region || '',
    departments: Array.isArray(initial?.departments) ? initial.departments.join(', ') : '',
    rep_level: initial?.rep_level || 'non_field',
    birthday: initial?.birthday ? String(initial.birthday).slice(0, 10) : '',
  }))
  const [notes, setNotes] = useState(() => notesFromDb(initial?.directory_note))
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
      await onSave({
        ...form,
        departments: normalizeDepartments(form.departments),
        directory_hidden: hidden,
        directory_note: notesForDb(notes),
      })
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center">
      <div className="my-8 w-full max-w-3xl rounded-lg border border-slate-200 bg-white p-6 shadow-xl sm:my-0">
        <h3 className="text-xl font-semibold text-slate-900">
          {isEdit ? `Edit ${initial.first_name} ${initial.last_name}` : 'Add staff / management'}
        </h3>
        <p className="mt-1 text-sm text-slate-600">
          {isEdit
            ? 'Update contact info, department, level, directory visibility, and the "how to reach me" note.'
            : 'For people who aren\'t going through training (HR, ops, leadership) but should appear in the team directory. They skip the registration / class / test workflow.'}
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
          <Field label="Territory">
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
          <Field label="Departments">
            <input
              type="text"
              value={form.departments}
              onChange={(e) => update('departments', e.target.value)}
              onBlur={(e) => {
                const norm = normalizeDepartments(e.target.value).join(', ')
                if (norm !== e.target.value) update('departments', norm)
              }}
              list="dept-options"
              placeholder="e.g. Sales, HR"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <datalist id="dept-options">
              {existingDepartments.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
            <span className="mt-1 block text-[11px] text-slate-500">
              Comma-separated for multiple. Casing auto-normalizes ("office" → "Office"); duplicates collapse.
            </span>
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
          <Field label="Birthday">
            <input
              type="date"
              value={form.birthday}
              onChange={(e) => update('birthday', e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <span className="mt-1 block text-[11px] text-slate-500">
              Public directory shows month + day only (year stays private).
            </span>
          </Field>
        </div>

        <div className="mt-3">
          <Field label="How to reach me — note (optional)">
            <NoteEditor
              departments={normalizeDepartments(form.departments)}
              notes={notes}
              setNotes={setNotes}
            />
            <span className="mt-1 block text-[11px] text-slate-500">
              Free-text guidance shown on the directory card. With multiple departments you get
              one box per department so you can give different instructions per context.
            </span>
          </Field>
        </div>

        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Visibility in the /directory phone-book
          </div>
          <p className="mt-1 text-xs text-slate-500">
            For phones, pick which actions are shown. Check any other field to HIDE it. Name is
            always visible.
          </p>
          <div className="mt-3 space-y-2">
            <PhoneVisibilityChoice
              phoneKey="phone"
              label="Personal phone"
              hidden={hidden}
              setHidden={setHidden}
            />
            <PhoneVisibilityChoice
              phoneKey="company_phone"
              label="Work phone"
              hidden={hidden}
              setHidden={setHidden}
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-1 text-sm">
            {DIRECTORY_FIELDS.filter((f) => f.key !== 'phone' && f.key !== 'company_phone').map((f) => (
              <label key={f.key} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!hidden[f.key]}
                  onChange={() => toggleHidden(f.key)}
                />
                <span>Hide {f.label.toLowerCase()}</span>
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
        <div className="mt-4 space-y-3">
          <PhoneVisibilityChoice
            phoneKey="phone"
            label="Personal phone"
            hidden={hidden}
            setHidden={setHidden}
            disabled={sending}
          />
          <PhoneVisibilityChoice
            phoneKey="company_phone"
            label="Work phone"
            hidden={hidden}
            setHidden={setHidden}
            disabled={sending}
          />
          <div className="space-y-1 border-t border-slate-200 pt-2">
            {DIRECTORY_FIELDS.filter((f) => f.key !== 'phone' && f.key !== 'company_phone').map((f) => (
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
