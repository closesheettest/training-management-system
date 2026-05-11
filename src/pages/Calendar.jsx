import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { formatDateRange, formatMonth, groupByMonth, parseLocalDate } from '../lib/dates.js'

export default function Calendar() {
  const [classes, setClasses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    load()
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
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Schedule</h1>
        <p className="mt-2 text-slate-600">
          All training weeks, grouped by month. Click any week to see who's coming and manage texts.
        </p>
      </div>

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
          <Badge color="slate" label={`${total} total`} hide={total > 0} />
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
      <Link to="/manager" className="mt-2 inline-block text-sm font-semibold text-slate-900 underline">
        Create your first class →
      </Link>
    </div>
  )
}
