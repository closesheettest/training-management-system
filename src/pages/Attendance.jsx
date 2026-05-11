import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { formatDateLong, parseLocalDate } from '../lib/dates.js'
import { formatAddress } from '../lib/locations.js'

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function Attendance() {
  const [date, setDate] = useState(todayIso())
  const [classes, setClasses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    load()
  }, [date])

  async function load() {
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('classes')
      .select(
        'id, region, week_start_date, week_end_date, locations(name, street_address, city, state, zip), trainees(id, first_name, last_name, registered, confirmation_status), attendance(trainee_id, attendance_date, confirmed, confirmed_at)',
      )
      .lte('week_start_date', date)
      .gte('week_end_date', date)
      .order('region', { ascending: true })
    if (err) {
      setError(err.message)
    } else {
      setClasses(data || [])
    }
    setLoading(false)
  }

  // Summary across all classes for the chosen date
  const summary = useMemo(() => {
    let total = 0
    let present = 0
    for (const cls of classes) {
      total += cls.trainees?.length || 0
      const attendanceForDay = (cls.attendance || []).filter((a) => a.attendance_date === date && a.confirmed)
      present += attendanceForDay.length
    }
    return { total, present }
  }, [classes, date])

  function shiftDate(days) {
    const d = parseLocalDate(date)
    if (!d) return
    d.setDate(d.getDate() + days)
    setDate(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    )
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Daily Attendance</h1>
          <p className="mt-2 text-slate-600">
            For HR & corporate. Shows every class active on the selected day and who's signed in.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => shiftDate(-1)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            title="Previous day"
          >
            ←
          </button>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
          <button
            onClick={() => shiftDate(1)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            title="Next day"
          >
            →
          </button>
          {date !== todayIso() && (
            <button
              onClick={() => setDate(todayIso())}
              className="rounded-md bg-brand-navy px-3 py-2 text-sm font-semibold text-white hover:bg-brand-navy-dark"
            >
              Today
            </button>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-sm font-medium uppercase tracking-wide text-slate-500">
          {formatDateLong(date)}
        </div>
        <div className="mt-1 text-2xl font-semibold text-slate-900">
          {classes.length === 0 ? (
            'No classes scheduled this day'
          ) : (
            <>
              {summary.present}<span className="text-slate-400"> / {summary.total}</span> signed in
              <span className="ml-2 text-sm font-normal text-slate-500">
                across {classes.length} class{classes.length === 1 ? '' : 'es'}
              </span>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="space-y-6">
          {classes.map((cls) => (
            <ClassAttendanceCard key={cls.id} cls={cls} date={date} />
          ))}
        </div>
      )}
    </div>
  )
}

function ClassAttendanceCard({ cls, date }) {
  const trainees = (cls.trainees || []).slice().sort(byName)
  const attendanceForDay = (cls.attendance || []).filter((a) => a.attendance_date === date)
  const attendanceMap = Object.fromEntries(attendanceForDay.map((a) => [a.trainee_id, a]))
  const present = trainees.filter((t) => attendanceMap[t.id]?.confirmed)
  const dayNumber = computeDayNumber(date, cls.week_start_date, cls.week_end_date)

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900">
              {cls.locations?.name || `${cls.region} — Location TBD`}
            </h2>
            {cls.region && (
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">
                {cls.region}
              </span>
            )}
            {dayNumber && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                {dayNumber}
              </span>
            )}
          </div>
          {cls.locations && (
            <p className="mt-1 text-sm text-slate-500">{formatAddress(cls.locations)}</p>
          )}
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-slate-900">
            {present.length}<span className="text-slate-400">/{trainees.length}</span>
          </div>
          <div className="text-xs text-slate-500">signed in</div>
          <Link
            to={`/class/${cls.id}`}
            className="mt-1 inline-block text-xs text-slate-500 underline hover:text-slate-700"
          >
            Manage class
          </Link>
        </div>
      </header>

      {trainees.length === 0 ? (
        <p className="px-5 py-6 text-sm text-slate-500">
          No trainees in this class yet.{' '}
          <Link to={`/class/${cls.id}`} className="underline hover:text-slate-700">
            Add trainees
          </Link>
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {trainees.map((t) => {
            const att = attendanceMap[t.id]
            const checked = !!att?.confirmed
            return (
              <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <div className="flex items-center gap-3">
                  <span className={checked ? 'text-green-600 text-lg' : 'text-slate-300 text-lg'}>
                    {checked ? '✓' : '○'}
                  </span>
                  <div>
                    <div className="font-medium text-slate-900">
                      {t.first_name} {t.last_name}
                    </div>
                    {!t.registered && (
                      <div className="text-xs text-amber-700">Not registered</div>
                    )}
                    {t.confirmation_status === 'confirmed' && (
                      <div className="text-xs text-green-700">✓ Confirmed</div>
                    )}
                    {t.confirmation_status === 'declined' && (
                      <div className="text-xs text-red-700">✗ Declined</div>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  {checked ? (
                    <>
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                        Present
                      </span>
                      {att?.confirmed_at && (
                        <div className="mt-1 text-xs text-slate-500">
                          {new Date(att.confirmed_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                        </div>
                      )}
                    </>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                      Not signed in
                    </span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function byName(a, b) {
  const an = `${a.first_name} ${a.last_name}`.toLowerCase()
  const bn = `${b.first_name} ${b.last_name}`.toLowerCase()
  return an < bn ? -1 : an > bn ? 1 : 0
}

// Returns "Day N of M" if the given date falls within the class week, else null.
function computeDayNumber(date, weekStart, weekEnd) {
  const d = parseLocalDate(date)
  const start = parseLocalDate(weekStart)
  const end = parseLocalDate(weekEnd)
  if (!d || !start || !end) return null
  const dayMs = 1000 * 60 * 60 * 24
  const totalDays = Math.round((end - start) / dayMs) + 1
  const offset = Math.round((d - start) / dayMs) + 1
  if (offset < 1 || offset > totalDays) return null
  return `Day ${offset} of ${totalDays}`
}
