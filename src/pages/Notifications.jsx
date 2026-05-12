import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

const ROLES = [
  { value: 'admin', label: 'Admin', desc: 'Owner / operations. Gets the day-2 email-provisioning notification.' },
  { value: 'it', label: 'IT', desc: 'IT department contact. Reserved for future IT-routed events.' },
  { value: 'hr', label: 'HR', desc: 'HR / corporate. Reserved for future HR-routed events.' },
  { value: 'test', label: 'Test', desc: 'Your own test phone — used by the "Send test SMS" button below.' },
  { value: 'custom', label: 'Custom', desc: 'Other contacts. Won\'t automatically receive any events.' },
]

const EVENT_ROUTING = [
  { event: 'Day-2 email provisioning complete', roles: ['admin'] },
  // Future events will be added here as we wire them up:
  // { event: 'New class scheduled', roles: ['hr'] },
  // { event: 'Final test submitted', roles: ['admin'] },
]

const blank = () => ({
  name: '',
  role: 'admin',
  phone: '',
  email: '',
  active: true,
  notes: '',
})

export default function Notifications() {
  const [recipients, setRecipients] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [editingId, setEditingId] = useState(null) // null | 'new' | uuid
  const [draft, setDraft] = useState(blank())
  const [submitting, setSubmitting] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const { data, error: err } = await supabase
      .from('notification_recipients')
      .select('*')
      .order('role', { ascending: true })
      .order('name', { ascending: true })
    if (err) setError(err.message)
    else setRecipients(data || [])
    setLoading(false)
  }

  function startAdd() {
    setDraft(blank())
    setEditingId('new')
    setMessage(null)
    setTimeout(() => document.getElementById('recipient-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  function startEdit(r) {
    setDraft({
      name: r.name || '',
      role: r.role || 'admin',
      phone: r.phone || '',
      email: r.email || '',
      active: r.active !== false,
      notes: r.notes || '',
    })
    setEditingId(r.id)
    setMessage(null)
    setTimeout(() => document.getElementById('recipient-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  function cancel() {
    setEditingId(null)
    setDraft(blank())
  }

  function update(field, value) {
    setDraft((prev) => ({ ...prev, [field]: value }))
  }

  async function save() {
    setMessage(null)
    if (!draft.name.trim()) {
      setMessage({ type: 'error', text: 'Name is required.' })
      return
    }
    if (!draft.phone.trim() && !draft.email.trim()) {
      setMessage({ type: 'error', text: 'Provide at least a phone number or email.' })
      return
    }
    setSubmitting(true)
    try {
      const payload = {
        name: draft.name.trim(),
        role: draft.role,
        phone: draft.phone.trim() || null,
        email: draft.email.trim() || null,
        active: !!draft.active,
        notes: draft.notes.trim() || null,
        updated_at: new Date().toISOString(),
      }
      if (editingId === 'new') {
        const { error: err } = await supabase.from('notification_recipients').insert(payload)
        if (err) throw err
        setMessage({ type: 'success', text: `Added ${payload.name}.` })
      } else {
        const { error: err } = await supabase.from('notification_recipients').update(payload).eq('id', editingId)
        if (err) throw err
        setMessage({ type: 'success', text: `Updated ${payload.name}.` })
      }
      cancel()
      load()
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Something went wrong.' })
    } finally {
      setSubmitting(false)
    }
  }

  async function remove(r) {
    if (!confirm(`Delete "${r.name}"? They'll no longer receive any notifications.`)) return
    const { error: err } = await supabase.from('notification_recipients').delete().eq('id', r.id)
    if (err) {
      setMessage({ type: 'error', text: err.message })
      return
    }
    setMessage({ type: 'success', text: `Deleted ${r.name}.` })
    load()
  }

  async function toggleActive(r) {
    const { error: err } = await supabase
      .from('notification_recipients')
      .update({ active: !r.active, updated_at: new Date().toISOString() })
      .eq('id', r.id)
    if (err) setMessage({ type: 'error', text: err.message })
    else load()
  }

  async function sendTestSms() {
    const testRecipients = recipients.filter((r) => r.role === 'test' && r.active && r.phone)
    if (testRecipients.length === 0) {
      setMessage({
        type: 'error',
        text: 'No active "Test" recipients with a phone number. Add at least one above first.',
      })
      return
    }
    setMessage(null)
    setTesting(true)
    try {
      const res = await fetch('/.netlify/functions/send-test-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        const errMsg =
          res.status === 404
            ? "SMS only works on the deployed Netlify site — not in local 'npm run dev'."
            : body.error || `Request failed: ${res.status}`
        setMessage({ type: 'error', text: errMsg })
        return
      }
      const successes = (body.results || []).filter((r) => r.success).length
      const failures = (body.results || []).filter((r) => !r.success)
      if (failures.length === 0) {
        setMessage({ type: 'success', text: `Test SMS sent to ${successes} recipient${successes === 1 ? '' : 's'}.` })
      } else {
        setMessage({
          type: 'error',
          text: `Sent ${successes}, failed ${failures.length}. First error: ${failures[0].error}`,
        })
      }
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Network error' })
    } finally {
      setTesting(false)
    }
  }

  const byRole = ROLES.map((role) => ({
    role,
    items: recipients.filter((r) => r.role === role.value),
  }))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Notifications</h1>
          <p className="mt-2 text-slate-600">
            Manage who receives SMS notifications when training events happen. Roles map to events
            (see the routing reference below) — so if a person changes jobs, you only update them
            in one place.
          </p>
        </div>
        {editingId === null && (
          <button
            onClick={startAdd}
            className="shrink-0 rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-navy-dark"
          >
            + Add recipient
          </button>
        )}
      </div>

      {message && (
        <div
          className={
            message.type === 'success'
              ? 'rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800'
              : 'rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800'
          }
        >
          {message.text}
        </div>
      )}

      {editingId !== null && (
        <RecipientForm
          value={draft}
          onChange={update}
          onSave={save}
          onCancel={cancel}
          submitting={submitting}
          isNew={editingId === 'new'}
        />
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="space-y-6">
          {byRole.map(({ role, items }) => (
            <RoleSection
              key={role.value}
              role={role}
              items={items}
              onEdit={startEdit}
              onRemove={remove}
              onToggle={toggleActive}
            />
          ))}
        </div>
      )}

      {/* Event routing reference */}
      <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
        <h2 className="text-lg font-semibold">Event routing reference</h2>
        <p className="mt-1 text-xs text-slate-500">
          When these events fire, the system sends SMS to all active recipients of the listed
          role(s).
        </p>
        <ul className="mt-3 divide-y divide-slate-200 overflow-hidden rounded-md border border-slate-200 bg-white">
          {EVENT_ROUTING.map((e) => (
            <li key={e.event} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className="text-slate-800">{e.event}</span>
              <span className="flex gap-1">
                {e.roles.map((r) => (
                  <RoleTag key={r} role={r} />
                ))}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Test SMS */}
      <section className="rounded-lg border-2 border-dashed border-amber-300 bg-amber-50 p-6">
        <h2 className="text-lg font-semibold text-amber-900">🧪 Send a test SMS</h2>
        <p className="mt-1 text-sm text-amber-900">
          Sends a test message to every active recipient with role <strong>Test</strong>. Useful for
          confirming your phone number works before going live with real trainees.
        </p>
        <div className="mt-3">
          <button
            onClick={sendTestSms}
            disabled={testing}
            className="rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-700 disabled:opacity-50"
          >
            {testing ? 'Sending…' : 'Send test SMS now'}
          </button>
        </div>
      </section>
    </div>
  )
}

function RoleSection({ role, items, onEdit, onRemove, onToggle }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {role.label}
        </h2>
        <span className="text-xs text-slate-400">{role.desc}</span>
      </div>
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 bg-white px-4 py-3 text-sm text-slate-500">
          No recipients in this role.
        </p>
      ) : (
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          {items.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-900">{r.name}</span>
                  {!r.active && (
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
                      Inactive
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {r.phone && <span>📱 {r.phone}</span>}
                  {r.phone && r.email && <span> · </span>}
                  {r.email && <span>✉️ {r.email}</span>}
                </div>
                {r.notes && <div className="mt-1 text-xs text-slate-500 italic">{r.notes}</div>}
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={() => onEdit(r)}
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Edit
                </button>
                <button
                  onClick={() => onToggle(r)}
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  {r.active ? 'Deactivate' : 'Activate'}
                </button>
                <button
                  onClick={() => onRemove(r)}
                  className="rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function RecipientForm({ value, onChange, onSave, onCancel, submitting, isNew }) {
  return (
    <section id="recipient-form" className="scroll-mt-4 rounded-lg border-2 border-brand-navy bg-white p-6 shadow-lg space-y-4">
      <h2 className="text-lg font-semibold text-brand-navy">
        {isNew ? '✏️ Add notification recipient' : '✏️ Edit recipient'}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-700">
          Name
          <input
            type="text"
            required
            value={value.name}
            onChange={(e) => onChange('name', e.target.value)}
            className={inputCls}
            placeholder="Neal Scoppettuolo"
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Role
          <select
            value={value.role}
            onChange={(e) => onChange('role', e.target.value)}
            className={inputCls}
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Phone (for SMS)
          <input
            type="tel"
            value={value.phone}
            onChange={(e) => onChange('phone', e.target.value)}
            className={inputCls}
            placeholder="727-555-1234"
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Email (future use)
          <input
            type="email"
            value={value.email}
            onChange={(e) => onChange('email', e.target.value)}
            className={inputCls}
            placeholder="neal@usshingle.com"
          />
        </label>
        <label className="sm:col-span-2 block text-sm font-medium text-slate-700">
          Notes (optional)
          <input
            type="text"
            value={value.notes}
            onChange={(e) => onChange('notes', e.target.value)}
            className={inputCls}
            placeholder="e.g. backup contact for evenings"
          />
        </label>
        <label className="sm:col-span-2 flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={!!value.active}
            onChange={(e) => onChange('active', e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-brand-navy focus:ring-brand-navy"
          />
          Active (will receive notifications for their role)
        </label>
      </div>
      <p className="text-xs text-slate-500">
        At least one of <strong>Phone</strong> or <strong>Email</strong> is required. SMS-based
        notifications need phone; future email-based notifications will need email.
      </p>
      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={submitting}
          className="rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-navy-dark disabled:opacity-50"
        >
          {submitting ? 'Saving…' : isNew ? 'Add recipient' : 'Save changes'}
        </button>
      </div>
    </section>
  )
}

function RoleTag({ role }) {
  const palette = {
    admin: 'bg-brand-navy text-white',
    it: 'bg-sky-100 text-sky-800',
    hr: 'bg-purple-100 text-purple-800',
    test: 'bg-amber-100 text-amber-800',
    custom: 'bg-slate-100 text-slate-700',
  }[role] || 'bg-slate-100 text-slate-700'
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium uppercase tracking-wide ${palette}`}>
      {role}
    </span>
  )
}

const inputCls =
  'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500'
