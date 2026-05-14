import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

// Handoff contacts page — the "team contacts" that get texted to each
// trainee as a .vcf right after they submit their final test. Tapping
// the link saves all matching contacts to their phone in one go.
//
// Region routing:
//   - Region blank   → goes to every trainee (use for helpline, support)
//   - Region matches → only trainees whose class.region matches get it
//     (use for regional sales managers — e.g. "St Pete", "Orlando")

const blank = () => ({
  display_name: '',
  title: '',
  organization: '',
  phone: '',
  email: '',
  region: '',
  active: true,
  display_order: 0,
})

export default function HandoffContacts() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [editingId, setEditingId] = useState(null) // null | 'new' | uuid
  const [draft, setDraft] = useState(blank())
  const [submitting, setSubmitting] = useState(false)
  const [classRegions, setClassRegions] = useState([])

  useEffect(() => {
    load()
    loadRegionHints()
  }, [])

  async function load() {
    setLoading(true)
    const { data, error: err } = await supabase
      .from('trainee_handoff_contacts')
      .select('*')
      .order('display_order', { ascending: true })
      .order('display_name', { ascending: true })
    if (err) setError(err.message)
    else setRows(data || [])
    setLoading(false)
  }

  async function loadRegionHints() {
    // Help the user pick a valid region by showing what's currently used.
    const { data } = await supabase.from('classes').select('region').not('region', 'is', null)
    const unique = Array.from(new Set((data || []).map((c) => c.region).filter(Boolean)))
    setClassRegions(unique.sort())
  }

  function startAdd() {
    setDraft(blank())
    setEditingId('new')
    setMessage(null)
    setTimeout(() => document.getElementById('contact-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  function startEdit(r) {
    setDraft({
      display_name: r.display_name || '',
      title: r.title || '',
      organization: r.organization || '',
      phone: r.phone || '',
      email: r.email || '',
      region: r.region || '',
      active: r.active !== false,
      display_order: r.display_order || 0,
    })
    setEditingId(r.id)
    setMessage(null)
    setTimeout(() => document.getElementById('contact-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  function cancel() {
    setEditingId(null)
    setDraft(blank())
  }

  async function save() {
    if (!draft.display_name.trim()) {
      setMessage({ kind: 'error', text: 'Name is required.' })
      return
    }
    if (!draft.phone.trim() && !draft.email.trim()) {
      setMessage({ kind: 'error', text: 'At least one of phone or email is required.' })
      return
    }
    setSubmitting(true)
    setMessage(null)
    const payload = {
      display_name: draft.display_name.trim(),
      title: draft.title.trim() || null,
      organization: draft.organization.trim() || null,
      phone: draft.phone.trim() || null,
      email: draft.email.trim() || null,
      region: draft.region.trim() || null,
      active: !!draft.active,
      display_order: Number(draft.display_order) || 0,
      updated_at: new Date().toISOString(),
    }
    const { error: err } =
      editingId === 'new'
        ? await supabase.from('trainee_handoff_contacts').insert(payload)
        : await supabase.from('trainee_handoff_contacts').update(payload).eq('id', editingId)
    setSubmitting(false)
    if (err) {
      setMessage({ kind: 'error', text: err.message })
      return
    }
    setMessage({ kind: 'success', text: editingId === 'new' ? 'Contact added.' : 'Contact saved.' })
    setEditingId(null)
    setDraft(blank())
    await load()
  }

  async function remove(r) {
    if (!confirm(`Delete "${r.display_name}"? This can't be undone.`)) return
    const { error: err } = await supabase.from('trainee_handoff_contacts').delete().eq('id', r.id)
    if (err) {
      setMessage({ kind: 'error', text: err.message })
      return
    }
    setMessage({ kind: 'success', text: 'Contact deleted.' })
    await load()
  }

  async function toggleActive(r) {
    const { error: err } = await supabase
      .from('trainee_handoff_contacts')
      .update({ active: !r.active, updated_at: new Date().toISOString() })
      .eq('id', r.id)
    if (err) {
      setMessage({ kind: 'error', text: err.message })
      return
    }
    await load()
  }

  const universals = rows.filter((r) => !r.region)
  const regional = rows.filter((r) => r.region)

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Trainee handoff contacts</h1>
        <p className="mt-2 text-slate-600">
          After every trainee submits their final test, they get a text with a link to a vCard
          containing these contacts — one tap saves them all to their phone (iPhone and Android).
          The same vCard is also attached to the review-request email that already fires.
        </p>
        <div className="mt-3 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
          <strong>Region routing:</strong> leave <em>Region</em> blank to send a contact to every
          trainee (use for helpline / support). Set <em>Region</em> to match a class region (e.g.
          "St Pete", "Orlando") to send a contact only to trainees in that region — perfect for
          regional sales managers.
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Error loading: {error}
        </div>
      )}
      {message && (
        <div
          className={
            'rounded-md border p-3 text-sm ' +
            (message.kind === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-800')
          }
        >
          {message.text}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          {rows.length === 0 ? 'No contacts yet' : `${rows.length} contact${rows.length === 1 ? '' : 's'}`}
        </h2>
        <button
          type="button"
          onClick={startAdd}
          className="rounded-md bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900"
        >
          + Add contact
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-md border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600">
          <p>You haven't added any handoff contacts yet.</p>
          <p className="mt-1 text-slate-500">
            Until at least one is added, the post-test handoff text is skipped silently.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {universals.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Universal — every trainee gets these
              </h3>
              <ul className="space-y-2">
                {universals.map((r) => (
                  <ContactRow key={r.id} r={r} onEdit={startEdit} onDelete={remove} onToggle={toggleActive} />
                ))}
              </ul>
            </section>
          )}
          {regional.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Regional — only trainees whose class matches the region
              </h3>
              <ul className="space-y-2">
                {regional.map((r) => (
                  <ContactRow key={r.id} r={r} onEdit={startEdit} onDelete={remove} onToggle={toggleActive} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {editingId && (
        <form
          id="contact-form"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
          className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm space-y-4"
        >
          <h3 className="text-lg font-semibold">
            {editingId === 'new' ? 'Add contact' : 'Edit contact'}
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name *">
              <input
                type="text"
                value={draft.display_name}
                onChange={(e) => setDraft({ ...draft, display_name: e.target.value })}
                placeholder="Joe Bloggs"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </Field>
            <Field label="Title">
              <input
                type="text"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="Sales Manager"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Organization">
              <input
                type="text"
                value={draft.organization}
                onChange={(e) => setDraft({ ...draft, organization: e.target.value })}
                placeholder="U.S. Shingle & Metal"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Phone">
              <input
                type="tel"
                value={draft.phone}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                placeholder="(555) 123-4567"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                placeholder="joe@shingleusa.com"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </Field>
            <Field
              label="Region (leave blank for every trainee)"
              hint={
                classRegions.length
                  ? `Existing regions in use: ${classRegions.join(', ')}`
                  : 'No regions set on any class yet.'
              }
            >
              <input
                type="text"
                value={draft.region}
                onChange={(e) => setDraft({ ...draft, region: e.target.value })}
                placeholder="St Pete"
                list="region-hints"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <datalist id="region-hints">
                {classRegions.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </Field>
            <Field label="Display order" hint="Lower numbers appear first.">
              <input
                type="number"
                value={draft.display_order}
                onChange={(e) => setDraft({ ...draft, display_order: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </Field>
            <div className="flex items-center gap-2 sm:pt-7">
              <input
                id="active-checkbox"
                type="checkbox"
                checked={draft.active}
                onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
                className="h-4 w-4"
              />
              <label htmlFor="active-checkbox" className="text-sm">
                Active (uncheck to disable without deleting)
              </label>
            </div>
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
            >
              {submitting ? 'Saving…' : editingId === 'new' ? 'Add contact' : 'Save changes'}
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={submitting}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <PreviewLinks classRegions={classRegions} />
    </div>
  )
}

function ContactRow({ r, onEdit, onDelete, onToggle }) {
  return (
    <li
      className={
        'flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between ' +
        (r.active ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50 opacity-70')
      }
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-semibold">{r.display_name}</span>
          {r.title && <span className="text-sm text-slate-500">· {r.title}</span>}
          {r.organization && <span className="text-sm text-slate-500">· {r.organization}</span>}
          {!r.active && (
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
              inactive
            </span>
          )}
          {r.region ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
              {r.region}
            </span>
          ) : (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
              All regions
            </span>
          )}
        </div>
        <div className="mt-1 text-xs text-slate-600">
          {r.phone || '—'} · {r.email || '—'}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={() => onToggle(r)}
          className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          {r.active ? 'Disable' : 'Enable'}
        </button>
        <button
          type="button"
          onClick={() => onEdit(r)}
          className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => onDelete(r)}
          className="rounded-md border border-red-300 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
        >
          Delete
        </button>
      </div>
    </li>
  )
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-slate-700">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

function PreviewLinks({ classRegions }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
      <h3 className="font-semibold">Preview the vCard</h3>
      <p className="mt-1 text-xs text-slate-600">
        Open these URLs in your phone's browser to see what a trainee will get when they tap the
        link. (Desktop browsers may just download the .vcf file.)
      </p>
      <ul className="mt-2 space-y-1 text-xs">
        <li>
          <strong>All contacts (no region filter):</strong>{' '}
          <a
            href="/.netlify/functions/trainee-contacts-vcard"
            className="text-sky-700 underline"
            target="_blank"
            rel="noreferrer"
          >
            /.netlify/functions/trainee-contacts-vcard
          </a>
        </li>
        {classRegions.map((r) => (
          <li key={r}>
            <strong>Region "{r}":</strong>{' '}
            <a
              href={`/.netlify/functions/trainee-contacts-vcard?region=${encodeURIComponent(r)}`}
              className="text-sky-700 underline"
              target="_blank"
              rel="noreferrer"
            >
              /.netlify/functions/trainee-contacts-vcard?region={r}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
