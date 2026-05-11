import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

const blankLocation = () => ({
  name: '',
  address: '',
  parking_info: '',
  contact_info: '',
  schedule_template: '',
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
    if (!error) setLocations(data || [])
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
      address: loc.address || '',
      parking_info: loc.parking_info || '',
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
    if (!form.name.trim() || !form.address.trim()) {
      setMessage({ type: 'error', text: 'Name and address are required.' })
      return
    }
    setSubmitting(true)
    try {
      const payload = {
        name: form.name.trim(),
        address: form.address.trim(),
        parking_info: form.parking_info.trim() || null,
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
      // Most likely cause: a class is using this location (foreign key restrict)
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
            Save your hotels and training sites once. When you create a class, pick from this list instead of re-typing.
          </p>
        </div>
        {editingId === null && (
          <button
            onClick={startAdd}
            className="shrink-0 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
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
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" className="sm:col-span-2">
              <input
                type="text"
                required
                placeholder="e.g. Hilton Hartford"
                value={form.name}
                onChange={(e) => updateForm('name', e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Address" className="sm:col-span-2">
              <input
                type="text"
                required
                placeholder="315 Trumbull St, Hartford, CT 06103"
                value={form.address}
                onChange={(e) => updateForm('address', e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Parking info (optional)">
              <input
                type="text"
                placeholder="Valet $25/day or self-park garage on 5th floor"
                value={form.parking_info}
                onChange={(e) => updateForm('parking_info', e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Contact info (optional)">
              <input
                type="text"
                placeholder="Sarah at front desk, 860-555-1234"
                value={form.contact_info}
                onChange={(e) => updateForm('contact_info', e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Default schedule (optional)" className="sm:col-span-2">
              <textarea
                rows={2}
                placeholder="Mon–Fri 9am–5pm. Lunch provided. Bring laptop and ID."
                value={form.schedule_template}
                onChange={(e) => updateForm('schedule_template', e.target.value)}
                className={inputCls}
              />
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
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
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
            Add your first hotel or training site to get started.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {locations.map((loc) => (
            <div key={loc.id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-base font-semibold text-slate-900">{loc.name}</h3>
                  <p className="mt-1 text-sm text-slate-600">{loc.address}</p>
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
              {(loc.parking_info || loc.contact_info || loc.schedule_template) && (
                <dl className="mt-4 space-y-1.5 border-t border-slate-100 pt-3 text-sm">
                  {loc.parking_info && (
                    <div>
                      <dt className="inline font-medium text-slate-700">Parking: </dt>
                      <dd className="inline text-slate-600">{loc.parking_info}</dd>
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
                      <dd className="inline text-slate-600">{loc.schedule_template}</dd>
                    </div>
                  )}
                </dl>
              )}
            </div>
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
