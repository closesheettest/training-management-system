import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { formatAddress } from '../lib/locations.js'

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
  const [lastCreated, setLastCreated] = useState(null) // { class, location, trainees: [] }

  useEffect(() => {
    loadLocations()
    loadRecentClasses()
  }, [])

  async function loadLocations() {
    const { data, error } = await supabase
      .from('locations')
      .select('id, name, street_address, city, state, zip, schedule_template')
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
      const { data: createdTrainees, error: traineeError } = await supabase
        .from('trainees')
        .insert(traineeRows)
        .select('id, first_name, last_name, phone, registration_token')
      if (traineeError) throw traineeError

      const chosenLocation = locations.find((l) => l.id === classData.location_id)
      setLastCreated({
        class: cls,
        location: chosenLocation,
        trainees: createdTrainees || [],
      })

      setMessage(null)
      setClassData({
        week_start_date: '',
        week_end_date: '',
        location_id: '',
        schedule_details: '',
      })
      setTrainees([blankTrainee()])
      loadRecentClasses()
      // Scroll the success card into view
      setTimeout(() => {
        document.getElementById('last-created')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 50)
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
          Create a new training class and add trainees. After saving, copy each trainee's personal
          registration link to send manually (automatic SMS coming next).
        </p>
      </div>

      {lastCreated && (
        <LastCreatedCard
          data={lastCreated}
          onDismiss={() => setLastCreated(null)}
        />
      )}

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
                        {loc.name} — {formatAddress(loc)}
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

function LastCreatedCard({ data, onDismiss }) {
  const { class: cls, location, trainees } = data
  const [sending, setSending] = useState(null) // null | 'all' | trainee_id
  const [statusByTrainee, setStatusByTrainee] = useState({}) // { [id]: { sent: bool, error?: string } }

  async function sendSms(traineeIds, label) {
    setSending(label)
    try {
      const res = await fetch('/.netlify/functions/send-registration-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trainee_ids: traineeIds }),
      })
      const body = await res.json().catch(() => ({}))

      if (!res.ok) {
        const message =
          res.status === 404
            ? "SMS endpoint not found. This only works on the deployed Netlify site — it won't work in 'npm run dev'."
            : body.error || `Request failed: ${res.status}`
        setStatusByTrainee((prev) => {
          const next = { ...prev }
          for (const id of traineeIds) next[id] = { sent: false, error: message }
          return next
        })
        return
      }

      const updates = {}
      for (const r of body.results || []) {
        updates[r.trainee_id] = { sent: r.success, error: r.success ? undefined : r.error }
      }
      setStatusByTrainee((prev) => ({ ...prev, ...updates }))
    } catch (err) {
      const message = err.message || 'Network error'
      setStatusByTrainee((prev) => {
        const next = { ...prev }
        for (const id of traineeIds) next[id] = { sent: false, error: message }
        return next
      })
    } finally {
      setSending(null)
    }
  }

  const unsentIds = trainees.filter((t) => !statusByTrainee[t.id]?.sent).map((t) => t.id)
  const anyUnsent = unsentIds.length > 0

  return (
    <section
      id="last-created"
      className="rounded-lg border border-green-200 bg-green-50 p-6 shadow-sm"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-green-900">
            Class created — {trainees.length} trainee{trainees.length === 1 ? '' : 's'} added
          </h2>
          <p className="mt-1 text-sm text-green-800">
            {location?.name} · Week of {cls.week_start_date}
          </p>
          <p className="mt-3 text-sm text-green-900">
            Send each trainee their personal registration link via SMS (GoHighLevel). You can also copy
            a link to share manually.
          </p>
        </div>
        <button
          onClick={onDismiss}
          className="shrink-0 rounded-md border border-green-300 bg-white px-3 py-1.5 text-xs font-medium text-green-800 hover:bg-green-100"
        >
          Dismiss
        </button>
      </div>

      {anyUnsent && (
        <div className="mt-4">
          <button
            onClick={() => sendSms(unsentIds, 'all')}
            disabled={sending !== null}
            className="rounded-md bg-green-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-800 disabled:opacity-50"
          >
            {sending === 'all' ? 'Sending…' : `Send text to ${unsentIds.length === trainees.length ? 'all' : 'remaining'} ${unsentIds.length}`}
          </button>
        </div>
      )}

      <ul className="mt-5 divide-y divide-green-200 rounded-md border border-green-200 bg-white">
        {trainees.map((t) => {
          const s = statusByTrainee[t.id]
          return (
            <li key={t.id} className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="font-medium text-slate-900">
                  {t.first_name} {t.last_name}
                </div>
                <div className="truncate text-slate-500">{t.phone}</div>
                {s?.sent && <div className="mt-0.5 text-xs text-green-700">✓ Text sent</div>}
                {s && !s.sent && s.error && (
                  <div className="mt-0.5 break-words text-xs text-red-700">✗ {s.error}</div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <a
                  href={`${window.location.origin}/register/${t.registration_token}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-slate-500 hover:text-slate-700 hover:underline"
                >
                  Preview
                </a>
                <CopyLinkButton token={t.registration_token} />
                <button
                  onClick={() => sendSms([t.id], t.id)}
                  disabled={sending !== null}
                  className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {sending === t.id ? 'Sending…' : s?.sent ? 'Resend text' : 'Send text'}
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function CopyLinkButton({ token }) {
  const [copied, setCopied] = useState(false)
  const url = `${window.location.origin}/register/${token}`

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      window.prompt('Copy this link:', url)
    }
  }

  return (
    <button
      onClick={copy}
      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
    >
      {copied ? 'Copied!' : 'Copy link'}
    </button>
  )
}
