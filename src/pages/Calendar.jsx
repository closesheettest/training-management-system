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
        'id, region, week_start_date, week_end_date, locations(name), trainees(id, registered, last_sms_sent_at)',
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
            <details className="group">
              <summary className="cursor-pointer text-sm font-medium text-slate-500 hover:text-slate-700">
                Past weeks ({past.length}) — click to expand
              </summary>
              <div className="mt-4">
                <Section title="" classes={past} emptyText="" />
              </div>
            </details>
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
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  function update(field, value) {
    setForm((prev) => {
      const next = { ...prev, [field]: value }
      // When region changes, clear hotel if it doesn't belong to that region
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
          Block a week on the schedule. Hotel and trainees are optional — you can add them later.
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
          Hotel (optional)
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
                  ? `No saved hotels in ${form.region} — leave blank for TBD`
                  : `${form.region} — TBD (no specific hotel yet)`}
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
            placeholder="Auto-fills from the hotel's default schedule if one is set."
            value={form.schedule_details}
            onChange={(e) => update('schedule_details', e.target.value)}
            className={inputCls}
          />
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

function Section({ title, classes, emptyText }) {
  if (classes.length === 0) {
    return emptyText ? (
      <section>
        {title && <h2 className="text-lg font-semibold">{title}</h2>}
        <p className="mt-2 text-sm text-slate-500">{emptyText}</p>
      </section>
    ) : null
  }
  return (
    <section className="space-y-6">
      {title && <h2 className="text-lg font-semibold">{title}</h2>}
      {groupByMonth(classes).map(([key, items]) => (
        <div key={key}>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            {formatMonth(key)}
          </h3>
          <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
            {items.map((cls) => (
              <ClassRow key={cls.id} cls={cls} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

function ClassRow({ cls }) {
  const total = cls.trainees?.length ?? 0
  const registered = cls.trainees?.filter((t) => t.registered).length ?? 0
  const sent = cls.trainees?.filter((t) => !t.registered && t.last_sms_sent_at).length ?? 0
  const notSent = cls.trainees?.filter((t) => !t.registered && !t.last_sms_sent_at).length ?? 0
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
            {isTBD && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                Hotel TBD
              </span>
            )}
          </div>
          <div className="mt-1 text-sm text-slate-500">
            {formatDateRange(cls.week_start_date, cls.week_end_date)}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs sm:justify-end">
          <Badge color="green" label={`${registered} registered`} hide={registered === 0} />
          <Badge color="amber" label={`${sent} pending`} hide={sent === 0} />
          <Badge color="slate" label={`${notSent} not sent`} hide={notSent === 0} />
          <Badge color="slate" label="No trainees yet" hide={total > 0} />
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
