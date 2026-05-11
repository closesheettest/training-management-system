import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { formatAddress, FL_REGIONS } from '../lib/locations.js'

const blankTrainee = () => ({ first_name: '', last_name: '', phone: '', email: '' })

export default function HiringManager() {
  const [classData, setClassData] = useState({
    week_start_date: '',
    week_end_date: '',
    region: '',
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
      .select('id, name, region, street_address, city, state, zip, schedule_template')
      .order('name', { ascending: true })
    if (!error) setLocations(data || [])
  }

  async function loadRecentClasses() {
    const { data, error } = await supabase
      .from('classes')
      .select('id, week_start_date, region, locations(name), trainees(count)')
      .order('week_start_date', { ascending: false })
      .limit(5)
    if (!error) setRecentClasses(data || [])
  }

  function updateClass(field, value) {
    setClassData((prev) => {
      const next = { ...prev, [field]: value }
      // When location changes, pre-fill schedule from its template (only if user hasn't typed anything yet)
      if (field === 'location_id' && value && !prev.schedule_details) {
        const loc = locations.find((l) => l.id === value)
        if (loc?.schedule_template) next.schedule_details = loc.schedule_template
      }
      // When region changes, clear location_id if the previously-selected hotel isn't in this region
      if (field === 'region') {
        const currentLoc = locations.find((l) => l.id === prev.location_id)
        if (currentLoc && currentLoc.region !== value) next.location_id = ''
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

    if (!classData.region) {
      setMessage({ type: 'error', text: 'Pick a region for this class.' })
      return
    }

    // Trainees are optional — user can block a week first and add people later.
    // Any partially-filled trainee rows are silently dropped if they don't have a complete name + phone.
    const validTrainees = trainees.filter(
      (t) => t.first_name.trim() && t.last_name.trim() && t.phone.trim(),
    )
    const hasPartialTrainee = trainees.some(
      (t) =>
        (t.first_name.trim() || t.last_name.trim() || t.phone.trim() || t.email.trim()) &&
        !(t.first_name.trim() && t.last_name.trim() && t.phone.trim()),
    )
    if (hasPartialTrainee) {
      setMessage({
        type: 'error',
        text: 'Each trainee needs first name, last name, and phone. Fill them in or clear the row to continue.',
      })
      return
    }

    setSubmitting(true)
    try {
      const { data: cls, error: classError } = await supabase
        .from('classes')
        .insert({
          week_start_date: classData.week_start_date,
          week_end_date: classData.week_end_date,
          region: classData.region,
          location_id: classData.location_id || null,
          schedule_details: classData.schedule_details || null,
        })
        .select()
        .single()
      if (classError) throw classError

      let createdTrainees = []
      if (validTrainees.length > 0) {
        const traineeRows = validTrainees.map((t) => ({
          class_id: cls.id,
          first_name: t.first_name.trim(),
          last_name: t.last_name.trim(),
          phone: t.phone.trim(),
          email: t.email.trim() || null,
        }))
        const { data, error: traineeError } = await supabase
          .from('trainees')
          .insert(traineeRows)
          .select('id, first_name, last_name, phone, registration_token')
        if (traineeError) throw traineeError
        createdTrainees = data || []
      }

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
        region: '',
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

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Hiring Manager Portal</h1>
        <p className="mt-2 text-slate-600">
          Create a new training class. You can add trainees now, or save the week first and add
          people later from the class detail page.
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
            <Field label="Region" className="sm:col-span-2">
              <select
                required
                value={classData.region}
                onChange={(e) => updateClass('region', e.target.value)}
                className={inputCls}
              >
                <option value="">— Select a region —</option>
                {FL_REGIONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </Field>
            <Field label="Hotel (optional — leave blank for TBD)" className="sm:col-span-2">
              {(() => {
                const filtered = classData.region
                  ? locations.filter((l) => l.region === classData.region)
                  : []
                return (
                  <>
                    <select
                      value={classData.location_id}
                      onChange={(e) => updateClass('location_id', e.target.value)}
                      disabled={!classData.region}
                      className={inputCls}
                    >
                      <option value="">
                        {!classData.region
                          ? 'Pick a region first'
                          : filtered.length === 0
                            ? `No saved hotels in ${classData.region} yet — leave blank for TBD`
                            : `${classData.region} — TBD (no specific hotel yet)`}
                      </option>
                      {filtered.map((loc) => (
                        <option key={loc.id} value={loc.id}>
                          {loc.name} — {formatAddress(loc)}
                        </option>
                      ))}
                    </select>
                    <div className="mt-1 text-xs text-slate-500">
                      <Link to="/locations" className="underline hover:text-slate-700">
                        Manage hotels
                      </Link>
                      {' · '}You can leave this blank and assign a hotel later.
                    </div>
                  </>
                )
              })()}
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
            <div>
              <h2 className="text-lg font-semibold">Trainees</h2>
              <p className="text-xs text-slate-500">Optional — leave blank to just block the week.</p>
            </div>
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
            disabled={submitting}
            className="rounded-md bg-brand-navy px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-navy-dark disabled:opacity-50"
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
              <li key={c.id} className="text-sm">
                <Link to={`/class/${c.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
                  <div>
                    <div className="font-medium text-slate-900">
                      {c.locations?.name ?? `${c.region || 'Region'} — TBD`}
                    </div>
                    <div className="text-slate-500">Week of {c.week_start_date}</div>
                  </div>
                  <div className="text-slate-500">
                    {c.trainees?.[0]?.count ?? 0} trainee{(c.trainees?.[0]?.count ?? 0) === 1 ? '' : 's'}
                  </div>
                </Link>
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
  const hasTrainees = trainees.length > 0
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
            {hasTrainees
              ? `Class created — ${trainees.length} trainee${trainees.length === 1 ? '' : 's'} added`
              : 'Week blocked on the schedule'}
          </h2>
          <p className="mt-1 text-sm text-green-800">
            {location?.name || `${cls.region || 'Region'} — TBD`} · Week of {cls.week_start_date}
          </p>
          <p className="mt-3 text-sm text-green-900">
            {hasTrainees ? (
              <>Send each trainee their personal registration link via SMS (GoHighLevel). You can also copy a link to share manually.</>
            ) : (
              <>
                No trainees added yet — that's fine. {' '}
                <Link to={`/class/${cls.id}`} className="font-semibold underline">
                  Open this class
                </Link>{' '}
                anytime to add people, or use the form on this page again.
              </>
            )}
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
                  className="rounded-md bg-brand-navy px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-navy-dark disabled:opacity-50"
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
