import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { US_STATES, formatAddress, ZIP_PATTERN, DEFAULT_SCHEDULE, FL_REGIONS, groupByRegion } from '../lib/locations.js'

const blankLocation = () => ({
  name: '',
  region: '',
  street_address: '',
  city: '',
  state: '',
  zip: '',
  phone: '',
  contact_info: '',
  schedule_template: DEFAULT_SCHEDULE,
})

export default function Locations() {
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState(null) // null = no form, 'new' = add form, uuid = edit form
  const [form, setForm] = useState(blankLocation())
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    loadLocations()
  }, [])

  async function loadLocations() {
    setLoading(true)
    const { data, error } = await supabase
      .from('locations')
      .select('*')
      .order('name', { ascending: true })
    if (error) {
      setMessage({ type: 'error', text: error.message })
    } else {
      setLocations(data || [])
    }
    setLoading(false)
  }

  function startAdd() {
    setForm(blankLocation())
    setEditingId('new')
    setMessage(null)
  }

  function startEdit(loc) {
    setForm({
      name: loc.name || '',
      region: loc.region || '',
      street_address: loc.street_address || '',
      city: loc.city || '',
      state: loc.state || '',
      zip: loc.zip || '',
      phone: loc.phone || '',
      contact_info: loc.contact_info || '',
      schedule_template: loc.schedule_template || '',
    })
    setEditingId(loc.id)
    setMessage(null)
  }

  function cancel() {
    setEditingId(null)
    setForm(blankLocation())
  }

  function updateForm(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function save(e) {
    e.preventDefault()
    setMessage(null)

    const required = ['name', 'region', 'street_address', 'city', 'state', 'zip', 'phone']
    for (const field of required) {
      if (!form[field].trim()) {
        setMessage({ type: 'error', text: 'Name, region, street, city, state, zip, and phone are required.' })
        return
      }
    }

    setSubmitting(true)
    try {
      const payload = {
        name: form.name.trim(),
        region: form.region.trim(),
        street_address: form.street_address.trim(),
        city: form.city.trim(),
        state: form.state.trim().toUpperCase(),
        zip: form.zip.trim(),
        phone: form.phone.trim(),
        contact_info: form.contact_info.trim() || null,
        schedule_template: form.schedule_template.trim() || null,
      }
      if (editingId === 'new') {
        const { error } = await supabase.from('locations').insert(payload)
        if (error) throw error
        setMessage({ type: 'success', text: `Added "${payload.name}".` })
      } else {
        const { error } = await supabase.from('locations').update(payload).eq('id', editingId)
        if (error) throw error
        setMessage({ type: 'success', text: `Updated "${payload.name}".` })
      }
      cancel()
      loadLocations()
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Something went wrong.' })
    } finally {
      setSubmitting(false)
    }
  }

  async function remove(loc) {
    if (!confirm(`Delete "${loc.name}"? This can't be undone.`)) return
    setMessage(null)
    const { error } = await supabase.from('locations').delete().eq('id', loc.id)
    if (error) {
      const text =
        error.code === '23503'
          ? `Can't delete "${loc.name}" — it's being used by an existing class. Delete those classes first.`
          : error.message
      setMessage({ type: 'error', text })
      return
    }
    setMessage({ type: 'success', text: `Deleted "${loc.name}".` })
    loadLocations()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Locations</h1>
          <p className="mt-2 text-slate-600">
            Save your training locations (hotels, offices, training sites) once. When you create a class, pick from this list instead of re-typing.
          </p>
        </div>
        {editingId === null && (
          <button
            onClick={startAdd}
            className="shrink-0 rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-navy-dark"
          >
            + Add location
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
        <form onSubmit={save} className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm space-y-4">
          <h2 className="text-lg font-semibold">
            {editingId === 'new' ? 'Add new location' : 'Edit location'}
          </h2>
          <div className="grid gap-4 sm:grid-cols-6">
            <Field label="Name" className="sm:col-span-6">
              <input
                type="text"
                required
                placeholder="e.g. Hilton Hartford"
                value={form.name}
                onChange={(e) => updateForm('name', e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Florida training region" className="sm:col-span-6">
              <select
                required
                value={form.region}
                onChange={(e) => updateForm('region', e.target.value)}
                className={inputCls}
              >
                <option value="">— Select a region —</option>
                {FL_REGIONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </Field>
            <Field label="Street address" className="sm:col-span-6">
              <input
                type="text"
                required
                placeholder="3845 Gateway Centre Blvd"
                value={form.street_address}
                onChange={(e) => updateForm('street_address', e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="City" className="sm:col-span-3">
              <input
                type="text"
                required
                placeholder="Saint Petersburg"
                value={form.city}
                onChange={(e) => updateForm('city', e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="State" className="sm:col-span-2">
              <select
                required
                value={form.state}
                onChange={(e) => updateForm('state', e.target.value)}
                className={inputCls}
              >
                <option value="">— Select —</option>
                {US_STATES.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Zip" className="sm:col-span-1">
              <input
                type="text"
                required
                inputMode="numeric"
                pattern={ZIP_PATTERN}
                maxLength={10}
                placeholder="33782"
                value={form.zip}
                onChange={(e) => updateForm('zip', e.target.value)}
                className={inputCls}
                title="5-digit zip, optionally followed by -4 digits"
              />
            </Field>
            <Field label="Phone" className="sm:col-span-3">
              <input
                type="tel"
                required
                placeholder="727-349-3584"
                value={form.phone}
                onChange={(e) => updateForm('phone', e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Contact info (optional)" className="sm:col-span-3">
              <input
                type="text"
                placeholder="Ask for Brent at the front desk"
                value={form.contact_info}
                onChange={(e) => updateForm('contact_info', e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Default schedule" className="sm:col-span-6">
              <textarea
                rows={4}
                value={form.schedule_template}
                onChange={(e) => updateForm('schedule_template', e.target.value)}
                className={inputCls}
              />
              <p className="mt-1 text-xs text-slate-500">
                Pre-filled with the standard training schedule. Edit if this location runs different
                hours.
              </p>
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={cancel}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-navy-dark disabled:opacity-50"
            >
              {submitting ? 'Saving…' : editingId === 'new' ? 'Add location' : 'Save changes'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : locations.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-slate-600">No locations yet.</p>
          <p className="mt-1 text-sm text-slate-500">
            Add your first training location (hotel, office, or other site) to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {groupByRegion(locations).map(([region, items]) => (
            <section key={region}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
                {region} <span className="ml-1 font-normal text-slate-400">({items.length})</span>
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {items.map((loc) => (
            <div key={loc.id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-base font-semibold text-slate-900">{loc.name}</h3>
                    {loc.region && (
                      <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">
                        {loc.region}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{formatAddress(loc)}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => startEdit(loc)}
                    className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => remove(loc)}
                    className="rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
              {(loc.phone || loc.contact_info || loc.schedule_template) && (
                <dl className="mt-4 space-y-1.5 border-t border-slate-100 pt-3 text-sm">
                  {loc.phone && (
                    <div>
                      <dt className="inline font-medium text-slate-700">Phone: </dt>
                      <dd className="inline text-slate-600">{loc.phone}</dd>
                    </div>
                  )}
                  {loc.contact_info && (
                    <div>
                      <dt className="inline font-medium text-slate-700">Contact: </dt>
                      <dd className="inline text-slate-600">{loc.contact_info}</dd>
                    </div>
                  )}
                  {loc.schedule_template && (
                    <div>
                      <dt className="inline font-medium text-slate-700">Schedule: </dt>
                      <dd className="inline whitespace-pre-line text-slate-600">{loc.schedule_template}</dd>
                    </div>
                  )}
                </dl>
              )}
            </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

const inputCls =
  'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500'

function Field({ label, children, className = '' }) {
  return (
    <label className={`block text-sm font-medium text-slate-700 ${className}`}>
      {label}
      {children}
    </label>
  )
}
