import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { formatAddress } from '../lib/locations.js'
import { formatDateRange, parseLocalDate } from '../lib/dates.js'

// needs_hotel starts as null (not chosen). The submit handler refuses to
// save until every trainee has an explicit Yes or No — forces the hiring
// manager to make the call up front instead of forgetting.
const blankTrainee = () => ({ first_name: '', last_name: '', phone: '', email: '', needs_hotel: null })

export default function HiringManager() {
  const [selectedClassId, setSelectedClassId] = useState('')
  const [trainees, setTrainees] = useState([blankTrainee()])
  const [availableClasses, setAvailableClasses] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState(null)
  const [lastCreated, setLastCreated] = useState(null) // { class, trainees: [] }

  useEffect(() => {
    loadClasses()
  }, [])

  async function loadClasses() {
    // Show all weeks that haven't ended yet (today or in the future)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const isoToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

    const { data, error } = await supabase
      .from('classes')
      .select(
        'id, region, week_start_date, week_end_date, schedule_details, locations(name, street_address, city, state, zip, schedule_template, phone), trainees(id, first_name, last_name)',
      )
      .gte('week_end_date', isoToday)
      .order('week_start_date', { ascending: true })
    if (!error) setAvailableClasses(data || [])
  }

  function updateTrainee(index, field, value) {
    setTrainees((prev) => prev.map((t, i) => (i === index ? { ...t, [field]: value } : t)))
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

    if (!selectedClassId) {
      setMessage({ type: 'error', text: 'Pick a training week first.' })
      return
    }

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
    if (validTrainees.length === 0) {
      setMessage({ type: 'error', text: 'Add at least one trainee with first name, last name, and phone.' })
      return
    }
    // Force an explicit Yes/No on hotel — left null = the hiring manager
    // hasn't decided yet and they shouldn't be allowed to forget.
    const undecidedHotel = validTrainees.some(
      (t) => t.needs_hotel !== true && t.needs_hotel !== false,
    )
    if (undecidedHotel) {
      setMessage({
        type: 'error',
        text: 'Please pick Yes or No on "Needs hotel" for every trainee.',
      })
      return
    }

    setSubmitting(true)
    try {
      const traineeRows = validTrainees.map((t) => ({
        class_id: selectedClassId,
        first_name: t.first_name.trim(),
        last_name: t.last_name.trim(),
        phone: t.phone.trim(),
        email: t.email.trim() || null,
        needs_hotel: !!t.needs_hotel,
      }))
      const { data: createdTrainees, error: traineeError } = await supabase
        .from('trainees')
        .insert(traineeRows)
        .select('id, first_name, last_name, phone, registration_token')
      if (traineeError) throw traineeError

      const chosenClass = availableClasses.find((c) => c.id === selectedClassId)
      setLastCreated({
        class: chosenClass,
        trainees: createdTrainees || [],
      })

      setMessage(null)
      setSelectedClassId('')
      setTrainees([blankTrainee()])
      loadClasses() // refresh trainee counts
      setTimeout(() => {
        document.getElementById('last-created')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 50)
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Something went wrong.' })
    } finally {
      setSubmitting(false)
    }
  }

  const selectedClass = availableClasses.find((c) => c.id === selectedClassId)

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Hiring Manager Portal</h1>
        <p className="mt-2 text-slate-600">
          Add trainees to an already-scheduled training week. Need to block a new week first?{' '}
          <Link to="/calendar" className="font-semibold text-brand-navy underline">
            Add it on the Schedule
          </Link>
          .
        </p>
      </div>

      {lastCreated && (
        <LastCreatedCard data={lastCreated} onDismiss={() => setLastCreated(null)} />
      )}

      {availableClasses.length === 0 ? (
        <EmptyState />
      ) : (
        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Pick a week */}
          <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold">Pick a training week</h2>
            <p className="text-xs text-slate-500">
              Only upcoming weeks are listed. To create a new week, head to the{' '}
              <Link to="/calendar" className="underline hover:text-slate-700">
                Schedule
              </Link>
              .
            </p>
            <div className="mt-4">
              <select
                required
                value={selectedClassId}
                onChange={(e) => setSelectedClassId(e.target.value)}
                className={inputCls}
              >
                <option value="">— Select a week —</option>
                {availableClasses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {formatDateRange(c.week_start_date, c.week_end_date)} ·{' '}
                    {c.locations?.name || `${c.region || 'Region'} — TBD`}
                    {' · '}
                    {c.region || 'No region'}
                    {' · '}
                    {c.trainees?.length || 0} trainee{(c.trainees?.length || 0) === 1 ? '' : 's'} already
                  </option>
                ))}
              </select>
            </div>

            {selectedClass && <SelectedClassSummary cls={selectedClass} />}
          </section>

          {/* Trainees */}
          <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">New trainees to add</h2>
                <p className="text-xs text-slate-500">
                  These get added to the selected week. Existing trainees on this week are shown above
                  and aren't affected.
                </p>
              </div>
              <button
                type="button"
                onClick={addTrainee}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                + Add another
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
                  <div className="sm:col-span-12 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-700">
                        🏨 Needs hotel accommodation?
                      </span>
                      <NeedsHotelToggle
                        value={t.needs_hotel}
                        onChange={(v) => updateTrainee(i, 'needs_hotel', v)}
                      />
                    </div>
                    {trainees.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeTrainee(i)}
                        className="text-xs text-red-600 hover:text-red-800"
                      >
                        Remove
                      </button>
                    )}
                  </div>
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
              {submitting ? 'Saving…' : 'Add trainees to week'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

function SelectedClassSummary({ cls }) {
  const schedule = cls.schedule_details || cls.locations?.schedule_template
  const existingNames = (cls.trainees || []).map((t) => `${t.first_name} ${t.last_name}`)
  return (
    <div className="mt-4 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm">
      <Row label="Dates">
        {formatDateRange(cls.week_start_date, cls.week_end_date)}
      </Row>
      <Row label="Location">
        {cls.locations ? (
          <>
            <span className="font-medium text-slate-900">{cls.locations.name}</span>
            <span className="text-slate-500"> · {formatAddress(cls.locations)}</span>
          </>
        ) : (
          <span className="italic text-amber-700">TBD — assign on the class detail page</span>
        )}
      </Row>
      {cls.region && <Row label="Region">{cls.region}</Row>}
      {schedule && (
        <Row label="Schedule">
          <span className="whitespace-pre-line">{schedule}</span>
        </Row>
      )}
      <Row label={`Already in class (${existingNames.length})`}>
        {existingNames.length > 0 ? existingNames.join(', ') : <span className="italic text-slate-500">none yet</span>}
      </Row>
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 text-slate-700">
      <dt className="font-medium text-slate-500">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
      <p className="text-slate-600">No training weeks scheduled yet.</p>
      <p className="mt-1 text-sm text-slate-500">
        Before adding trainees, you need to block a week on the Schedule.
      </p>
      <Link
        to="/calendar"
        className="mt-4 inline-block rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-navy-dark"
      >
        Go to Schedule →
      </Link>
    </div>
  )
}

function LastCreatedCard({ data, onDismiss }) {
  const { class: cls, trainees } = data
  const [sending, setSending] = useState(null)
  const [statusByTrainee, setStatusByTrainee] = useState({})

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
    <section id="last-created" className="rounded-lg border border-green-200 bg-green-50 p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-green-900">
            Added {trainees.length} trainee{trainees.length === 1 ? '' : 's'}
          </h2>
          <p className="mt-1 text-sm text-green-800">
            {cls?.locations?.name || `${cls?.region || 'Region'} — TBD`} ·{' '}
            {cls ? formatDateRange(cls.week_start_date, cls.week_end_date) : ''}
          </p>
          <p className="mt-3 text-sm text-green-900">
            Send each new trainee their personal registration link via SMS, or{' '}
            <Link to={`/class/${cls?.id}`} className="font-semibold underline">
              open the class
            </Link>{' '}
            to manage the full roster.
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

// Tri-state Yes/No toggle for needs_hotel. `value` can be null (undecided
// — the buttons are both inactive and outlined in amber to nudge the user),
// true (Yes lit up green), or false (No lit up slate).
function NeedsHotelToggle({ value, onChange }) {
  const undecided = value !== true && value !== false
  const base = 'rounded-md border px-3 py-1 text-xs font-semibold transition'
  return (
    <div
      className={
        'inline-flex overflow-hidden rounded-md border ' +
        (undecided ? 'border-amber-400 ring-2 ring-amber-100' : 'border-slate-300')
      }
    >
      <button
        type="button"
        onClick={() => onChange(true)}
        className={
          base +
          ' rounded-r-none border-r ' +
          (value === true
            ? 'bg-emerald-600 text-white border-emerald-600'
            : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50')
        }
      >
        Yes
      </button>
      <button
        type="button"
        onClick={() => onChange(false)}
        className={
          base +
          ' rounded-l-none border-l-0 ' +
          (value === false
            ? 'bg-slate-700 text-white border-slate-700'
            : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50')
        }
      >
        No
      </button>
    </div>
  )
}
