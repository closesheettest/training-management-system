import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'

const blankTrainee = () => ({ first_name: '', last_name: '', phone: '', email: '' })

export default function HiringManager() {
  const [classData, setClassData] = useState({
    week_start_date: '',
    week_end_date: '',
    location_id: '',
    schedule_details: '',
  })
  const [trainees, setTrainees] = useState([blankTrainee()])
  const [locations, setLocations] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState(null)
  const [recentClasses, setRecentClasses] = useState([])

  useEffect(() => {
    loadLocations()
    loadRecentClasses()
  }, [])

  async function loadLocations() {
    const { data, error } = await supabase
      .from('locations')
      .select('id, name, address, schedule_template')
      .order('name', { ascending: true })
    if (!error) setLocations(data || [])
  }

  async function loadRecentClasses() {
    const { data, error } = await supabase
      .from('classes')
      .select('id, week_start_date, locations(name), trainees(count)')
      .order('week_start_date', { ascending: false })
      .limit(5)
    if (!error) setRecentClasses(data || [])
  }

  function updateClass(field, value) {
    setClassData((prev) => {
      const next = { ...prev, [field]: value }
      // When location changes, pre-fill schedule from its template (only if user hasn't typed anything yet)
      if (field === 'location_id' && !prev.schedule_details) {
        const loc = locations.find((l) => l.id === value)
        if (loc?.schedule_template) next.schedule_details = loc.schedule_template
      }
      return next
    })
  }

  function updateTrainee(index, field, value) {
    setTrainees((prev) =>
      prev.map((t, i) => (i === index ? { ...t, [field]: value } : t)),
    )
  }

  function addTrainee() {
    setTrainees((prev) => [...prev, blankTrainee()])
  }

  function removeTrainee(index) {
    setTrainees((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setMessage(null)

    if (!classData.location_id) {
      setMessage({ type: 'error', text: 'Pick a location for this class.' })
      return
    }

    const validTrainees = trainees.filter(
      (t) => t.first_name.trim() && t.last_name.trim() && t.phone.trim(),
    )
    if (validTrainees.length === 0) {
      setMessage({ type: 'error', text: 'Add at least one trainee with name + phone.' })
      return
    }

    setSubmitting(true)
    try {
      const { data: cls, error: classError } = await supabase
        .from('classes')
        .insert({
          week_start_date: classData.week_start_date,
          week_end_date: classData.week_end_date,
          location_id: classData.location_id,
          schedule_details: classData.schedule_details || null,
        })
        .select()
        .single()
      if (classError) throw classError

      const traineeRows = validTrainees.map((t) => ({
        class_id: cls.id,
        first_name: t.first_name.trim(),
        last_name: t.last_name.trim(),
        phone: t.phone.trim(),
        email: t.email.trim() || null,
      }))
      const { error: traineeError } = await supabase.from('trainees').insert(traineeRows)
      if (traineeError) throw traineeError

      setMessage({
        type: 'success',
        text: `Class created with ${traineeRows.length} trainee${traineeRows.length === 1 ? '' : 's'}.`,
      })
      setClassData({
        week_start_date: '',
        week_end_date: '',
        location_id: '',
        schedule_details: '',
      })
      setTrainees([blankTrainee()])
      loadRecentClasses()
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Something went wrong.' })
    } finally {
      setSubmitting(false)
    }
  }

  const noLocations = locations.length === 0

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Hiring Manager Portal</h1>
        <p className="mt-2 text-slate-600">
          Create a new training class and add trainees. They'll get a registration link via text in Stage 2.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Class details */}
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Class details</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Week start date">
              <input
                type="date"
                required
                value={classData.week_start_date}
                onChange={(e) => updateClass('week_start_date', e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Week end date">
              <input
                type="date"
                required
                value={classData.week_end_date}
                onChange={(e) => updateClass('week_end_date', e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Location" className="sm:col-span-2">
              {noLocations ? (
                <div className="mt-1 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  No locations saved yet.{' '}
                  <Link to="/locations" className="font-semibold underline">
                    Add your first location
                  </Link>{' '}
                  before creating a class.
                </div>
              ) : (
                <>
                  <select
                    required
                    value={classData.location_id}
                    onChange={(e) => updateClass('location_id', e.target.value)}
                    className={inputCls}
                  >
                    <option value="">— Select a location —</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name} — {loc.address}
                      </option>
                    ))}
                  </select>
                  <div className="mt-1 text-xs text-slate-500">
                    Need a new one?{' '}
                    <Link to="/locations" className="underline hover:text-slate-700">
                      Manage locations
                    </Link>
                  </div>
                </>
              )}
            </Field>
            <Field label="Schedule details (optional)" className="sm:col-span-2">
              <textarea
                rows={3}
                placeholder="Mon–Fri 9:00am–5:00pm. Bring laptop and ID."
                value={classData.schedule_details}
                onChange={(e) => updateClass('schedule_details', e.target.value)}
                className={inputCls}
              />
              <p className="mt-1 text-xs text-slate-500">
                Auto-fills from the location's default schedule, but you can override per class.
              </p>
            </Field>
          </div>
        </section>

        {/* Trainees */}
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Trainees</h2>
            <button
              type="button"
              onClick={addTrainee}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              + Add trainee
            </button>
          </div>
          <div className="mt-4 space-y-4">
            {trainees.map((t, i) => (
              <div key={i} className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 sm:grid-cols-12">
                <Field label="First name" className="sm:col-span-3">
                  <input
                    type="text"
                    value={t.first_name}
                    onChange={(e) => updateTrainee(i, 'first_name', e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="Last name" className="sm:col-span-3">
                  <input
                    type="text"
                    value={t.last_name}
                    onChange={(e) => updateTrainee(i, 'last_name', e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="Phone" className="sm:col-span-3">
                  <input
                    type="tel"
                    placeholder="555-123-4567"
                    value={t.phone}
                    onChange={(e) => updateTrainee(i, 'phone', e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="Email (optional)" className="sm:col-span-3">
                  <input
                    type="email"
                    value={t.email}
                    onChange={(e) => updateTrainee(i, 'email', e.target.value)}
                    className={inputCls}
                  />
                </Field>
                {trainees.length > 1 && (
                  <div className="sm:col-span-12 flex justify-end">
                    <button
                      type="button"
                      onClick={() => removeTrainee(i)}
                      className="text-xs text-red-600 hover:text-red-800"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

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

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting || noLocations}
            className="rounded-md bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Create class'}
          </button>
        </div>
      </form>

      {/* Recent classes */}
      <section>
        <h2 className="text-lg font-semibold">Recent classes</h2>
        {recentClasses.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No classes yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
            {recentClasses.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <div className="font-medium text-slate-900">{c.locations?.name ?? 'Unknown location'}</div>
                  <div className="text-slate-500">Week of {c.week_start_date}</div>
                </div>
                <div className="text-slate-500">
                  {c.trainees?.[0]?.count ?? 0} trainee{(c.trainees?.[0]?.count ?? 0) === 1 ? '' : 's'}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
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
