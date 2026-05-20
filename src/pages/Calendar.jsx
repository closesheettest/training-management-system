import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { formatDateRange, formatMonth, groupByMonth, parseLocalDate } from '../lib/dates.js'
import { formatAddress, FL_REGIONS } from '../lib/locations.js'

export default function Calendar() {
  const [classes, setClasses] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [adding, setAdding] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    load()
    loadLocations()
  }, [])

  async function load() {
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('classes')
      .select(
        'id, region, week_start_date, week_end_date, attendance_only, locations(name), trainees!class_id(id, registered, last_sms_sent_at, enrolled, test_attempts(submitted_at))',
      )
      .order('week_start_date', { ascending: true })
    if (err) setError(err.message)
    else setClasses(data || [])
    setLoading(false)
  }

  async function loadLocations() {
    const { data } = await supabase
      .from('locations')
      .select('id, name, region, street_address, city, state, zip, schedule_template')
      .order('name', { ascending: true })
    setLocations(data || [])
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const upcoming = classes.filter((c) => {
    const end = parseLocalDate(c.week_end_date)
    return end ? end >= today : true
  })
  const past = classes.filter((c) => {
    const end = parseLocalDate(c.week_end_date)
    return end ? end < today : false
  })

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Schedule</h1>
          <p className="mt-2 text-slate-600">
            All training weeks, grouped by month. Click any week to see who's coming and manage texts.
          </p>
        </div>
        {!adding && (
          <button
            onClick={() => {
              setMessage(null)
              setAdding(true)
            }}
            className="shrink-0 rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-navy-dark"
          >
            + Add training week
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
          {message.text}{' '}
          {message.classId && (
            <Link to={`/class/${message.classId}`} className="font-semibold underline">
              Open class
            </Link>
          )}
        </div>
      )}

      {adding && (
        <AddWeekForm
          locations={locations}
          onCancel={() => setAdding(false)}
          onSaved={(newClass) => {
            setAdding(false)
            setMessage({
              type: 'success',
              text: `Week of ${newClass.week_start_date} added.`,
              classId: newClass.id,
            })
            load()
          }}
        />
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : classes.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <Section title="Upcoming" classes={upcoming} emptyText="No upcoming weeks scheduled." />
          {past.length > 0 && (
            <Section
              title={`Past weeks (${past.length})`}
              classes={past}
              emptyText=""
              subtitle="Past classes — click any to view test results, re-send the graduation report, or browse attendance."
              isPast
            />
          )}
        </>
      )}
    </div>
  )
}

function AddWeekForm({ locations, onCancel, onSaved }) {
  const [form, setForm] = useState({
    week_start_date: '',
    week_end_date: '',
    region: '',
    location_id: '',
    schedule_details: '',
    attendance_only: false,
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  function update(field, value) {
    setForm((prev) => {
      const next = { ...prev, [field]: value }
      // When region changes, clear training location if it doesn't belong to that region
      if (field === 'region') {
        const currentLoc = locations.find((l) => l.id === prev.location_id)
        if (currentLoc && currentLoc.region !== value) next.location_id = ''
      }
      // When location is picked, prefill schedule from its template (only if empty)
      if (field === 'location_id' && value && !prev.schedule_details) {
        const loc = locations.find((l) => l.id === value)
        if (loc?.schedule_template) next.schedule_details = loc.schedule_template
      }
      return next
    })
  }

  async function submit(e) {
    e.preventDefault()
    setError(null)
    if (!form.region) {
      setError('Pick a region.')
      return
    }
    setSubmitting(true)
    const { data, error: err } = await supabase
      .from('classes')
      .insert({
        week_start_date: form.week_start_date,
        week_end_date: form.week_end_date,
        region: form.region,
        location_id: form.location_id || null,
        schedule_details: form.schedule_details || null,
        attendance_only: !!form.attendance_only,
      })
      .select()
      .single()
    setSubmitting(false)
    if (err) {
      setError(err.message)
      return
    }
    onSaved(data)
  }

  const filteredLocations = form.region
    ? locations.filter((l) => l.region === form.region)
    : []

  return (
    <form
      onSubmit={submit}
      className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm space-y-4"
    >
      <div>
        <h2 className="text-lg font-semibold">Add a training week</h2>
        <p className="text-xs text-slate-500">
          Block a week on the schedule. Training location and trainees are optional — you can add them later.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-700">
          Week start date
          <input
            type="date"
            required
            value={form.week_start_date}
            onChange={(e) => update('week_start_date', e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Week end date
          <input
            type="date"
            required
            value={form.week_end_date}
            onChange={(e) => update('week_end_date', e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Region
          <select
            required
            value={form.region}
            onChange={(e) => update('region', e.target.value)}
            className={inputCls}
          >
            <option value="">— Select a region —</option>
            {FL_REGIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Training location (optional)
          <select
            value={form.location_id}
            onChange={(e) => update('location_id', e.target.value)}
            disabled={!form.region}
            className={inputCls}
          >
            <option value="">
              {!form.region
                ? 'Pick a region first'
                : filteredLocations.length === 0
                  ? `No saved locations in ${form.region} — leave blank for TBD`
                  : `${form.region} — TBD (location not assigned yet)`}
            </option>
            {filteredLocations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name} — {formatAddress(loc)}
              </option>
            ))}
          </select>
        </label>
        <label className="sm:col-span-2 block text-sm font-medium text-slate-700">
          Schedule details (optional)
          <textarea
            rows={3}
            placeholder="Auto-fills from the location's default schedule if one is set."
            value={form.schedule_details}
            onChange={(e) => update('schedule_details', e.target.value)}
            className={inputCls}
          />
        </label>
      </div>

      <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
        <label className="flex items-start gap-2 text-sm font-semibold text-amber-900">
          <input
            type="checkbox"
            checked={!!form.attendance_only}
            onChange={(e) => update('attendance_only', e.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            📋 One-off meeting — attendance only
            <span className="mt-1 block text-xs font-normal text-amber-800">
              Pick this for company meetings or one-day events that need headcount tracking
              but aren't real training weeks. Skips registration texts, provisioning, final
              test, graduation report, hotels, the welcome drip, and every other automated
              flow. Trainees just check in at the kiosk.
            </span>
          </span>
        </label>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-navy-dark disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'Add to schedule'}
        </button>
      </div>
    </form>
  )
}

function Section({ title, classes, emptyText, subtitle, isPast = false }) {
  if (classes.length === 0) {
    return emptyText ? (
      <section>
        {title && <h2 className="text-lg font-semibold">{title}</h2>}
        <p className="mt-2 text-sm text-slate-500">{emptyText}</p>
      </section>
    ) : null
  }
  return (
    <section className="space-y-4">
      {title && (
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}
        </div>
      )}
      {groupByMonth(classes).map(([key, items]) => (
        <div key={key}>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            {formatMonth(key)}
          </h3>
          <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
            {items.map((cls) => (
              <ClassRow key={cls.id} cls={cls} isPast={isPast} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

function ClassRow({ cls, isPast = false }) {
  // Match ClassDetail: only count enrolled trainees (unenrolled people are hidden there too).
  const enrolledTrainees = cls.trainees?.filter((t) => t.enrolled !== false) ?? []
  const total = enrolledTrainees.length
  const registered = enrolledTrainees.filter((t) => t.registered).length
  const sent = enrolledTrainees.filter((t) => !t.registered && t.last_sms_sent_at).length
  const notSent = enrolledTrainees.filter((t) => !t.registered && !t.last_sms_sent_at).length
  // For past classes we surface the full funnel: how many were
  // scheduled, how many registered, how many actually graduated
  // (= submitted the final test). Tells the success story at a glance.
  const graduated = enrolledTrainees.filter((t) =>
    (t.test_attempts || []).some((a) => a.submitted_at),
  ).length
  const locationLabel = cls.locations?.name || `${cls.region || 'Region'} — TBD`
  const isTBD = !cls.locations?.name

  return (
    <li>
      <Link
        to={`/class/${cls.id}`}
        className="grid gap-3 px-4 py-4 transition hover:bg-slate-50 sm:grid-cols-[1fr_auto] sm:items-center"
      >
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-900">{locationLabel}</span>
            {cls.region && (
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">
                {cls.region}
              </span>
            )}
            {isTBD && !isPast && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                Location TBD
              </span>
            )}
            {cls.attendance_only && (
              <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-900">
                📋 Attendance only
              </span>
            )}
          </div>
          <div className="mt-1 text-sm text-slate-500">
            {formatDateRange(cls.week_start_date, cls.week_end_date)}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs sm:justify-end">
          {isPast ? (
            <>
              <Badge color="slate" label={`${total} scheduled`} hide={total === 0} />
              <Badge color="sky" label={`${registered} registered`} hide={total === 0} />
              {/* For attendance-only classes there's no final test, so
                  "graduated" isn't meaningful — hide that badge. */}
              {!cls.attendance_only && (
                <Badge color="green" label={`${graduated} graduated`} hide={total === 0} />
              )}
              <Badge color="slate" label="No trainees" hide={total > 0} />
            </>
          ) : (
            <>
              <Badge color="green" label={`${registered} registered`} hide={registered === 0} />
              <Badge color="amber" label={`${sent} pending`} hide={sent === 0} />
              <Badge color="slate" label={`${notSent} not sent`} hide={notSent === 0} />
              <Badge color="slate" label="No trainees yet" hide={total > 0} />
            </>
          )}
        </div>
      </Link>
    </li>
  )
}

function Badge({ color, label, hide }) {
  if (hide) return null
  const palette = {
    green: 'bg-green-100 text-green-800',
    amber: 'bg-amber-100 text-amber-800',
    sky: 'bg-sky-100 text-sky-800',
    slate: 'bg-slate-100 text-slate-700',
  }[color] || 'bg-slate-100 text-slate-700'
  return <span className={`rounded-full px-2 py-0.5 font-medium ${palette}`}>{label}</span>
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
      <p className="text-slate-600">No training weeks scheduled yet.</p>
      <p className="mt-1 text-sm text-slate-500">
        Click <strong>+ Add training week</strong> above to block your first week.
      </p>
    </div>
  )
}

const inputCls =
  'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500'
