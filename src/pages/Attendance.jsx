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
        'id, region, week_start_date, week_end_date, locations(name, street_address, city, state, zip), trainees!class_id(id, first_name, last_name, registered, confirmation_status, enrolled, dropout_notified_at, unenrolled_reason), attendance(trainee_id, attendance_date, confirmed, confirmed_at)',
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

  // Summary across all classes for the chosen date. Denominator excludes
  // dropouts (manually unenrolled or stamped by the dropout cron) so the
  // headcount reflects who's actually expected today.
  const summary = useMemo(() => {
    let expected = 0
    let dropouts = 0
    let present = 0
    for (const cls of classes) {
      for (const t of cls.trainees || []) {
        if (t.enrolled === false || t.dropout_notified_at) dropouts++
        else expected++
      }
      const attendanceForDay = (cls.attendance || []).filter((a) => a.attendance_date === date && a.confirmed)
      present += attendanceForDay.length
    }
    return { expected, dropouts, present }
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
              {summary.present}<span className="text-slate-400"> / {summary.expected}</span> signed in
              <span className="ml-2 text-sm font-normal text-slate-500">
                across {classes.length} class{classes.length === 1 ? '' : 'es'}
                {summary.dropouts > 0 && ` · ${summary.dropouts} dropped out`}
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
  const allTrainees = (cls.trainees || []).slice().sort(byName)
  const attendanceForDay = (cls.attendance || []).filter((a) => a.attendance_date === date)
  const attendanceMap = Object.fromEntries(attendanceForDay.map((a) => [a.trainee_id, a]))

  // Group everyone into 4 buckets — in display order:
  //   present     — signed in today
  //   notSignedIn — registered + enrolled + not a dropout, just absent today
  //                 (still expected to show)
  //   dropouts    — dropout cron stamped them, OR manually unenrolled
  //   unregistered — never completed the registration form
  // Order of checks matters: someone unregistered AND unenrolled is shown
  // under dropouts (the more severe state).
  const present = []
  const notSignedIn = []
  const dropouts = []
  const unregistered = []
  for (const t of allTrainees) {
    if (attendanceMap[t.id]?.confirmed) {
      present.push(t)
    } else if (t.enrolled === false || t.dropout_notified_at) {
      dropouts.push(t)
    } else if (!t.registered) {
      unregistered.push(t)
    } else {
      notSignedIn.push(t)
    }
  }
  present.sort((a, b) => {
    const ta = attendanceMap[a.id]?.confirmed_at || ''
    const tb = attendanceMap[b.id]?.confirmed_at || ''
    return ta.localeCompare(tb)
  })

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
            {present.length}
            <span className="text-slate-400">/{present.length + notSignedIn.length + unregistered.length}</span>
          </div>
          <div className="text-xs text-slate-500">
            signed in{dropouts.length > 0 && ` · ${dropouts.length} dropped out`}
          </div>
          <Link
            to={`/class/${cls.id}`}
            className="mt-1 inline-block text-xs text-slate-500 underline hover:text-slate-700"
          >
            Manage class
          </Link>
        </div>
      </header>

      {allTrainees.length === 0 ? (
        <p className="px-5 py-6 text-sm text-slate-500">
          No trainees in this class yet.{' '}
          <Link to={`/class/${cls.id}`} className="underline hover:text-slate-700">
            Add trainees
          </Link>
        </p>
      ) : (
        <>
          <Group
            label="✓ Present"
            count={present.length}
            tone="green"
            trainees={present}
            attendanceMap={attendanceMap}
            status="present"
          />
          <Group
            label="○ Not signed in"
            count={notSignedIn.length}
            tone="slate"
            trainees={notSignedIn}
            attendanceMap={attendanceMap}
            status="absent"
          />
          <Group
            label="🚪 Dropouts"
            count={dropouts.length}
            tone="red"
            trainees={dropouts}
            attendanceMap={attendanceMap}
            status="dropout"
          />
          <Group
            label="⚠ Not registered"
            count={unregistered.length}
            tone="amber"
            trainees={unregistered}
            attendanceMap={attendanceMap}
            status="unregistered"
          />
        </>
      )}
    </section>
  )
}

const GROUP_TONES = {
  green: 'bg-green-50 text-green-800',
  slate: 'border-t border-slate-100 bg-slate-50 text-slate-600',
  red: 'border-t border-slate-100 bg-red-50 text-red-800',
  amber: 'border-t border-slate-100 bg-amber-50 text-amber-800',
}

function Group({ label, count, tone, trainees, attendanceMap, status }) {
  if (count === 0) return null
  return (
    <div>
      <div className={`${GROUP_TONES[tone] || GROUP_TONES.slate} px-5 py-2 text-xs font-semibold uppercase tracking-wide`}>
        {label} ({count})
      </div>
      <ul className="divide-y divide-slate-100">
        {trainees.map((t) => (
          <AttendanceRow
            key={t.id}
            trainee={t}
            attendance={attendanceMap[t.id] || null}
            status={status}
          />
        ))}
      </ul>
    </div>
  )
}

function AttendanceRow({ trainee: t, attendance: att, status }) {
  const iconBy = {
    present: { glyph: '✓', cls: 'text-green-600 text-lg' },
    absent: { glyph: '○', cls: 'text-slate-300 text-lg' },
    dropout: { glyph: '🚪', cls: 'text-lg' },
    unregistered: { glyph: '⚠', cls: 'text-amber-600 text-lg' },
  }[status] || { glyph: '○', cls: 'text-slate-300 text-lg' }

  return (
    <li className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
      <div className="flex items-center gap-3">
        <span className={iconBy.cls}>{iconBy.glyph}</span>
        <div>
          <div className="font-medium text-slate-900">
            {t.first_name} {t.last_name}
          </div>
          {/* Don't repeat "Not registered" / dropout label inside the matching
              group — it's already in the section header. */}
          {status !== 'unregistered' && status !== 'dropout' && !t.registered && (
            <div className="text-xs text-amber-700">Not registered</div>
          )}
          {status === 'dropout' && t.unenrolled_reason && (
            <div className="text-xs text-red-700">Reason: {t.unenrolled_reason}</div>
          )}
          {status === 'dropout' && !t.unenrolled_reason && t.dropout_notified_at && (
            <div className="text-xs text-red-700">
              No-show flagged {new Date(t.dropout_notified_at).toLocaleDateString()}
            </div>
          )}
          {status !== 'dropout' && t.confirmation_status === 'confirmed' && (
            <div className="text-xs text-green-700">✓ Confirmed</div>
          )}
          {status !== 'dropout' && t.confirmation_status === 'declined' && (
            <div className="text-xs text-red-700">✗ Declined</div>
          )}
        </div>
      </div>
      <div className="text-right">
        {status === 'present' && (
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
        )}
        {status === 'absent' && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            Not signed in
          </span>
        )}
        {status === 'dropout' && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
            Dropped out
          </span>
        )}
        {status === 'unregistered' && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            Reg incomplete
          </span>
        )}
      </div>
    </li>
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
