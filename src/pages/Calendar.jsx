import { useEffect, useState, useMemo } from 'react'
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
        'id, region, week_start_date, week_end_date, attendance_only, location_id, locations(name), trainees!class_id(id, registered, last_sms_sent_at, enrolled, declined_at, dropped_out_at, confirmation_status, attendance(attendance_date, confirmed), test_attempts(submitted_at))',
      )
      .order('week_start_date', { ascending: true })
    if (err) setError(err.message)
    else setClasses(data || [])
    setLoading(false)
  }

  // Each region's USUAL training venue = the location its most recent class used.
  // Neal: "training is always the training center unless manually changed", and a
  // class with no location silently blocks itinerary emails — so a new week should
  // arrive pre-filled rather than TBD. Derived from real usage, not hardcoded, so
  // if a region moves venue the next class inherits the new one.
  const defaultLocationByRegion = useMemo(() => {
    const byRegion = {}
    for (const c of [...classes].sort((a, b) => (a.week_start_date < b.week_start_date ? 1 : -1))) {
      if (!c.region || !c.location_id || c.attendance_only) continue
      if (!byRegion[c.region]) byRegion[c.region] = c.location_id
    }
    return byRegion
  }, [classes])

  async function loadLocations() {
    const { data } = await supabase
      .from('locations')
      .select('id, name, region, street_address, city, state, zip, schedule_template')
      .order('name', { ascending: true })
    setLocations(data || [])
  }

  // Delete a training week. Guard: refuse if any trainees are still attached
  // (their class_id points here) — deleting would orphan or lose their
  // records. The admin must move/remove the trainees on the class page first.
  // Empty weeks (created by mistake, or a meeting that never filled) delete
  // freely after a confirm.
  async function deleteWeek(cls) {
    const attached = cls.trainees?.length || 0
    if (attached > 0) {
      setMessage({
        type: 'error',
        text: `Can't delete the week of ${cls.week_start_date} — it still has ${attached} trainee${attached === 1 ? '' : 's'} attached. Open the class and remove or move them first.`,
        classId: cls.id,
      })
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    if (!window.confirm(`Delete the week of ${cls.week_start_date}? This can't be undone.`)) return
    setMessage(null)
    const { error: err } = await supabase.from('classes').delete().eq('id', cls.id)
    if (err) {
      setMessage({ type: 'error', text: `Couldn't delete: ${err.message}` })
      return
    }
    setMessage({ type: 'success', text: `Week of ${cls.week_start_date} deleted.` })
    load()
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  // ── Weeks, not cohorts ────────────────────────────────────────────────────
  // Every Monday TWO cohorts are in the building: one starting Week A, and last
  // week's cohort starting Week B. The old list was one card per cohort showing
  // its two future dates, so answering "who's here this week" meant reading one
  // row's Week B against the next row's Week A — and a cohort's Week B was
  // effectively invisible. This flips it: one card per calendar week, listing
  // the cohorts actually in the room.
  const weeksUpcoming = useMemo(() => {
    const byMonday = {}
    const put = (monday, phase, cls) => {
      if (!byMonday[monday]) byMonday[monday] = { monday, A: null, B: null }
      byMonday[monday][phase] = cls
    }
    for (const c of classes) {
      if (c.attendance_only) { put(c.week_start_date, 'A', c); continue }
      put(c.week_start_date, 'A', c)
      if (isTwoWeekClass(c)) put(addDaysIso(c.week_start_date, 7), 'B', c)
    }
    return Object.values(byMonday)
      .filter((w) => {
        const fri = parseLocalDate(addDaysIso(w.monday, 4))
        return fri ? fri >= today : true
      })
      .sort((a, b) => (a.monday < b.monday ? -1 : 1))
  }, [classes, today])

  const todayIso = toIsoDate(today)
  // On a Sunday the week that just ended is gone from this list, so point
  // "This week" at the Monday about to start — that's what a Sunday reader means.
  const thisMonday = today.getDay() === 0 ? addDaysIso(todayIso, 1) : mondayOfIso(todayIso)

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
            Each week shows the cohorts actually in the room — Week A starting, Week B continuing. Click a row to open that cohort.
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
          defaultLocationByRegion={defaultLocationByRegion}
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
          <WeekSections weeks={weeksUpcoming} thisMonday={thisMonday} onDelete={deleteWeek} todayIso={todayIso} />
          {past.length > 0 && (
            <Section
              title={`Past weeks (${past.length})`}
              classes={past}
              emptyText=""
              subtitle="Past classes — click any to view test results, re-send the graduation report, or browse attendance."
              isPast
              onDelete={deleteWeek}
            />
          )}
        </>
      )}
    </div>
  )
}

function AddWeekForm({ locations, defaultLocationByRegion = {}, onCancel, onSaved }) {
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
      // A cohort runs TWO weeks (Week A then Week B). The hiring manager only
      // picks the Week A start Monday — Week B is the next week, so the class end
      // is Week A start + 11 days (Week B Friday). Auto-set it (unless it's an
      // attendance-only one-off).
      if (field === 'week_start_date' && value && !prev.attendance_only) {
        next.week_end_date = addDaysIso(value, 11)
      }
      // When region changes, drop a location that doesn't belong to it, then
      // pre-fill that region's usual venue so a new week is never created as TBD
      // (a TBD class sends no itinerary emails at all — trainees never learn
      // where to go). Still a plain dropdown, so it's one click to change.
      if (field === 'region') {
        const currentLoc = locations.find((l) => l.id === prev.location_id)
        if (currentLoc && currentLoc.region !== value) next.location_id = ''
        if (!next.location_id) next.location_id = defaultLocationByRegion[value] || ''
        const picked = locations.find((l) => l.id === next.location_id)
        if (picked?.schedule_template && !prev.schedule_details) {
          next.schedule_details = picked.schedule_template
        }
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
          {form.attendance_only ? 'Start date' : 'Week A start (Monday)'}
          <input
            type="date"
            required
            value={form.week_start_date}
            onChange={(e) => update('week_start_date', e.target.value)}
            className={inputCls}
          />
          <span className="mt-1 block text-xs text-slate-500">
            {form.attendance_only
              ? 'One-off meeting date.'
              : 'New hires start here. Week B is auto-set to the following week.'}
          </span>
        </label>
        {form.attendance_only ? (
          <label className="block text-sm font-medium text-slate-700">
            End date
            <input
              type="date"
              required
              value={form.week_end_date}
              onChange={(e) => update('week_end_date', e.target.value)}
              className={inputCls}
            />
          </label>
        ) : (
          <div className="block text-sm font-medium text-slate-700">
            This cohort's two weeks
            <div className="mt-1 space-y-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-normal">
              {form.week_start_date ? (
                <>
                  <div><span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-emerald-800">Week A</span> <span className="text-slate-600">{formatDateRange(form.week_start_date, addDaysIso(form.week_start_date, 4))}</span></div>
                  <div><span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-indigo-800">Week B</span> <span className="text-slate-600">{formatDateRange(addDaysIso(form.week_start_date, 7), addDaysIso(form.week_start_date, 11))}</span></div>
                </>
              ) : (
                <span className="text-slate-400">Pick a Week A start date above.</span>
              )}
            </div>
          </div>
        )}
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


// ── Week-centric rendering ──────────────────────────────────────────────────
function toIsoDate(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function mondayOfIso(iso) {
  const d = parseLocalDate(iso)
  if (!d) return iso
  const dow = d.getDay() // 0 Sun … 1 Mon
  d.setDate(d.getDate() - ((dow + 6) % 7))
  return toIsoDate(d)
}

// Who is ACTUALLY in the room for a Week B? Only trainees who attended their
// Week A — the 7 days before this Monday. Someone who enrolled and never showed
// isn't continuing, and counting them made a roster of 22 read as 22 when 7 were
// coming. Same rule the Hotels page and the Week B confirmation already use.
function liveTrainees(cls) {
  return (cls?.trainees || []).filter((t) => t.enrolled !== false && !t.declined_at && !t.dropped_out_at)
}
// Trust attendance from the moment their Week A STARTS (the Monday 7 days
// before), not after it ends — otherwise the week about to begin still reports
// its full roster. On Sun 8/16 the 8/17 Week B must already read 7 continuing,
// not 20 expected: their Week A ran 8/10–8/14 and 15 never showed.
function weekAHasHappened(monday, todayIso) {
  return todayIso >= addDaysIso(monday, -7)
}
// Continuing = still there at the END of Week A, not "showed up once". Of the
// Aug-10 cohort 7 attended a day but 3 came Monday and vanished — Neal: "the
// others are dead to us". The final day is read from the data (a Week A doesn't
// always record a Friday), so it self-calibrates. Mirrors _week-a.js.
function continuingForWeekB(cls, monday, todayIso) {
  const live = liveTrainees(cls)
  // Week A still to come → nobody could have attended yet; show who's expected.
  if (!weekAHasHappened(monday, todayIso)) return live.filter((t) => t.registered)
  const waStart = addDaysIso(monday, -7)
  const waEnd = addDaysIso(monday, -1)
  const inWeekA = (a) => a.confirmed && a.attendance_date >= waStart && a.attendance_date <= waEnd
  let lastDay = null
  for (const t of live) {
    for (const a of t.attendance || []) {
      if (inWeekA(a) && (!lastDay || a.attendance_date > lastDay)) lastDay = a.attendance_date
    }
  }
  if (!lastDay) return []
  return live.filter((t) => (t.attendance || []).some((a) => a.confirmed && a.attendance_date === lastDay))
}

function PhaseRow({ phase, cls, monday, todayIso }) {
  if (!cls) return null
  const isB = phase === 'B'
  const settled = isB && weekAHasHappened(monday, todayIso)
  const people = isB ? continuingForWeekB(cls, monday, todayIso) : liveTrainees(cls)
  const registered = people.filter((t) => t.registered).length
  const pending = people.filter((t) => !t.registered && t.last_sms_sent_at).length
  const confirmed = people.filter((t) => /^(yes|confirmed|attending)$/i.test(t.confirmation_status || '')).length
  const chip = isB
    ? 'bg-indigo-100 text-indigo-800'
    : cls.attendance_only
      ? 'bg-amber-200 text-amber-900'
      : 'bg-emerald-100 text-emerald-800'
  return (
    <Link
      to={`/class/${cls.id}`}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 px-4 py-2.5 text-sm transition hover:bg-slate-50"
    >
      <span className={`w-16 shrink-0 rounded px-1.5 py-0.5 text-center text-[11px] font-bold uppercase tracking-wide ${chip}`}>
        {cls.attendance_only ? 'One-off' : isB ? 'Week B' : 'Week A'}
      </span>
      <span className="flex-1 text-slate-700">
        {cls.attendance_only ? 'Attendance only' : isB ? 'Continuing' : 'New intake'}
        <span className="ml-1.5 text-xs text-slate-400">
          {isB ? `· from ${formatShort(cls.week_start_date)}` : '· hiring / intake'}
        </span>
      </span>
      {isB ? (
        <span className="text-xs text-slate-600">
          {people.length} {settled ? 'continuing' : 'expected'}
        </span>
      ) : (
        <span className="text-xs text-slate-600">{registered} registered</span>
      )}
      {isB && confirmed > 0 && <Badge color="green" label={`${confirmed} confirmed`} />}
      {!isB && pending > 0 && <Badge color="amber" label={`${pending} pending`} />}
      {people.length === 0 && <Badge color="slate" label="nobody yet" />}
    </Link>
  )
}

function WeekCard({ week, isThisWeek, onDelete, todayIso }) {
  const { monday, A, B } = week
  const venue = A?.locations?.name || B?.locations?.name
  const region = A?.region || B?.region
  const headcount = liveTrainees(A).length + continuingForWeekB(B, monday, todayIso).length
  const tbd = !venue
  return (
    <div className={`overflow-hidden rounded-lg border bg-white ${isThisWeek ? 'border-brand-navy shadow-sm' : 'border-slate-200'}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-semibold text-slate-900">{formatDateRange(monday, addDaysIso(monday, 4))}</span>
          <span className="text-sm text-slate-500">{venue || `${region || 'Region'} — TBD`}</span>
          {region && (
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">{region}</span>
          )}
          {tbd && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Location TBD</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-500">
            {headcount} {headcount === 1 ? 'person' : 'people'}
          </span>
          {onDelete && A && (
            <button
              type="button"
              onClick={() => onDelete(A)}
              title="Delete this training week"
              className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-600"
            >
              🗑
            </button>
          )}
        </div>
      </div>
      <PhaseRow phase="A" cls={A} monday={monday} todayIso={todayIso} />
      <PhaseRow phase="B" cls={B} monday={monday} todayIso={todayIso} />
    </div>
  )
}

function WeekSections({ weeks, thisMonday, onDelete, todayIso }) {
  if (weeks.length === 0) {
    return (
      <section>
        <h2 className="text-lg font-semibold">Upcoming</h2>
        <p className="mt-2 text-sm text-slate-500">No upcoming weeks scheduled.</p>
      </section>
    )
  }
  const current = weeks.filter((w) => w.monday === thisMonday)
  const later = weeks.filter((w) => w.monday !== thisMonday)
  return (
    <div className="space-y-8">
      {current.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">This week</h2>
          {current.map((w) => (
            <WeekCard key={w.monday} week={w} isThisWeek onDelete={onDelete} todayIso={todayIso} />
          ))}
        </section>
      )}
      {later.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">{current.length > 0 ? 'Coming up' : 'Upcoming'}</h2>
          {groupWeeksByMonth(later).map(([key, items]) => (
            <div key={key} className="space-y-3">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                {formatMonth(key)}
              </h3>
              {items.map((w) => (
                <WeekCard key={w.monday} week={w} onDelete={onDelete} todayIso={todayIso} />
              ))}
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

function groupWeeksByMonth(weeks) {
  const out = {}
  for (const w of weeks) {
    const key = (w.monday || '').slice(0, 7)
    if (!out[key]) out[key] = []
    out[key].push(w)
  }
  return Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1))
}

function formatShort(iso) {
  const d = parseLocalDate(iso)
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : iso
}

function Section({ title, classes, emptyText, subtitle, isPast = false, onDelete }) {
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
              <ClassRow key={cls.id} cls={cls} isPast={isPast} onDelete={onDelete} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

function ClassRow({ cls, isPast = false, onDelete }) {
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
    <li className="flex items-stretch">
      <Link
        to={`/class/${cls.id}`}
        className="grid flex-1 gap-3 px-4 py-4 transition hover:bg-slate-50 sm:grid-cols-[1fr_auto] sm:items-center"
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
          {isTwoWeekClass(cls) ? (
            <div className="mt-1 space-y-0.5 text-sm">
              <div className="flex items-center gap-2">
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-emerald-800">Week A</span>
                <span className="text-slate-600">{formatDateRange(cls.week_start_date, addDaysIso(cls.week_start_date, 4))}</span>
                <span className="text-[11px] text-slate-400">· hiring / intake</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-indigo-800">Week B</span>
                <span className="text-slate-600">{formatDateRange(addDaysIso(cls.week_start_date, 7), addDaysIso(cls.week_start_date, 11))}</span>
              </div>
            </div>
          ) : (
            <div className="mt-1 text-sm text-slate-500">
              {formatDateRange(cls.week_start_date, cls.week_end_date)}
            </div>
          )}
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
      {onDelete && (
        <button
          type="button"
          onClick={() => onDelete(cls)}
          title="Delete this week"
          aria-label={`Delete the week of ${cls.week_start_date}`}
          className="shrink-0 border-l border-slate-100 px-4 text-slate-300 transition hover:bg-red-50 hover:text-red-600"
        >
          🗑
        </button>
      )}
    </li>
  )
}

// A cohort now runs TWO weeks back-to-back (Week A then Week B). Detect it by a
// span of ~2 weeks; attendance-only one-offs and legacy single-week classes show
// a plain date range instead.
function isTwoWeekClass(cls) {
  if (cls.attendance_only) return false
  const a = parseLocalDate(cls.week_start_date)
  const b = parseLocalDate(cls.week_end_date)
  if (!a || !b) return false
  const days = Math.round((b.getTime() - a.getTime()) / 86400000)
  return days >= 9 // Week A Mon → Week B Fri ≈ 11 days
}
function addDaysIso(iso, n) {
  if (!iso) return iso
  const [y, m, d] = String(iso).split('T')[0].split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
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
