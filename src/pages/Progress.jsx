import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { formatDateRange, parseLocalDate } from '../lib/dates.js'

// /progress — class lifecycle dashboard. Shows every active + recent
// training class with a horizontal progress strip across the 8 stages
// each class moves through, so admin can spot "stuck" at a glance.
//
// Stages:
//   1. 📅 Scheduled    — location assigned (not TBD)
//   2. ✉️ Registered   — % of enrolled trainees who clicked the
//                         registration link and confirmed
//   3. 🛏️ Hotels       — % of needs_hotel trainees who have a booked stay
//   4. ✈️ Itinerary    — % of trainees who got the itinerary email
//   5. 👋 Attendance   — % of enrolled trainees who signed in on day 1
//   6. 📧 Provisioned  — % of trainees with company_email + IT marked
//                         the whole class complete
//   7. 🔑 Credentials  — % of trainees texted their login info
//   8. 🎓 Graduated    — % of trainees who submitted the final test
//
// Each stage shows:
//   • Color/icon for state (done / partial / not started / stuck)
//   • A "stuck" indicator (⚠) when the stage SHOULD be complete by now
//     but isn't — based on which day of training we're on.
//
// Window: classes whose week_end_date is within the last 21 days OR
// in the future. That covers everything actively in flight plus
// recently-finished ones for forensic review.

const STAGES = [
  { key: 'scheduled', icon: '📅', label: 'Scheduled' },
  { key: 'registered', icon: '✉️', label: 'Registered' },
  { key: 'hotels', icon: '🛏️', label: 'Hotels' },
  { key: 'itinerary', icon: '✈️', label: 'Itinerary' },
  { key: 'attendance', icon: '👋', label: 'Attendance' },
  { key: 'provisioned', icon: '📧', label: 'Provisioned' },
  { key: 'credentials', icon: '🔑', label: 'Credentials' },
  { key: 'graduated', icon: '🎓', label: 'Graduated' },
]

export default function Progress() {
  const [classes, setClasses] = useState(null)
  const [error, setError] = useState(null)
  const [expandedId, setExpandedId] = useState(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    // 3 weeks back through future. Captures anything active or recent.
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 21)
    const cutoffIso = cutoff.toISOString().slice(0, 10)
    const { data, error: err } = await supabase
      .from('classes')
      .select(
        // Pulling every per-trainee timestamp we need to compute the
        // 8 stages, plus test_attempts + hotel_stays + sign_in_closures
        // as joined arrays. Big query but it's one round-trip per page
        // load and the tables are small.
        //
        // sign_in_closures is what tells us "Day X is officially over"
        // — see the dropout rule in computeStages(). Without it we'd
        // wait until the day after to mark a no-show as a dropout.
        `
        id, region, week_start_date, week_end_date, attendance_only,
        location_id, locations(name),
        day_2_it_notified_at, it_completed_at, graduation_report_sent_at, cancelled_at,
        sign_in_closures(attendance_date),
        trainees!class_id(
          id, first_name, last_name,
          enrolled, registered, declined_at, needs_hotel, dropout_notified_at,
          itinerary_email_sent_at, company_email, email_assigned_at,
          credentials_sent_at, credentials_viewed_at,
          repcard_setup_at, jobnimbus_setup_at, sales_academy_setup_at,
          test_attempts(submitted_at),
          trainee_hotel_stays(id),
          attendance(attendance_date, confirmed)
        )
        `,
      )
      .gte('week_end_date', cutoffIso)
      .is('cancelled_at', null)
      .eq('attendance_only', false)
      .order('week_start_date', { ascending: false })
    if (err) {
      setError(err.message)
      setClasses([])
      return
    }
    setClasses(data || [])
  }

  if (classes === null) return <p className="text-sm text-slate-500">Loading…</p>

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Class progress</h1>
        <p className="mt-2 text-slate-600">
          Pipeline view of every active + recent training class. Each row's progress strip shows
          where the class is in the 8-stage workflow — registration through graduation.
          A red <span className="font-semibold text-red-700">⚠</span> means the stage
          <em> should</em> be complete by now but isn't — that's where it's stuck.
        </p>
      </header>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {classes.length === 0 ? (
        <div className="rounded-md border-2 border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-600">
          No classes in flight or finished in the last 3 weeks.
        </div>
      ) : (
        <ul className="space-y-3">
          {classes.map((c) => (
            <ClassRow
              key={c.id}
              cls={c}
              expanded={expandedId === c.id}
              onToggle={() => setExpandedId(expandedId === c.id ? null : c.id)}
            />
          ))}
        </ul>
      )}

      <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
        <div className="font-semibold uppercase tracking-wide mb-1">Stage state legend</div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
          <span>🟢 Complete</span>
          <span>🟡 In progress</span>
          <span>⚪ Not yet started</span>
          <span><span className="text-red-700">⚠</span> Should be done — stuck</span>
        </div>
      </div>
    </div>
  )
}

// One row per class. Shows the progress strip; clicking expands the
// detailed stage breakdown below.
function ClassRow({ cls, expanded, onToggle }) {
  const stages = useMemo(() => computeStages(cls), [cls])
  const overall = useMemo(() => {
    const done = stages.filter((s) => s.state === 'done').length
    return { done, total: stages.length, pct: Math.round((done / stages.length) * 100) }
  }, [stages])
  const stuckCount = stages.filter((s) => s.state === 'stuck').length
  // Enrolled = the planning-time roster. Active = applies the same
  // dropout rule used in computeStages — anyone who missed an
  // officially-over training day is a dropout. Show both numbers when
  // they diverge so the dropout count is visible at the row level.
  const enrolledTrainees = (cls.trainees || []).filter((t) => t.enrolled !== false && !t.declined_at)
  const traineeTotal = enrolledTrainees.length
  const overDates = getOfficiallyOverDates(cls)
  const activeCount = enrolledTrainees.filter((t) => isActiveTrainee(t, overDates)).length
  const dropoutCount = traineeTotal - activeCount
  return (
    <li className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left p-4 hover:bg-slate-50"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-semibold text-slate-900">
              {cls.region} · {formatDateRange(cls.week_start_date, cls.week_end_date)}
              {cls.locations?.name && (
                <span className="ml-2 text-sm font-normal text-slate-500">
                  · {cls.locations.name}
                </span>
              )}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {dropoutCount > 0 ? (
                <>
                  <span className="font-semibold text-slate-700">{activeCount} active</span>
                  <span className="text-slate-400"> · </span>
                  <span className="text-amber-700">
                    {dropoutCount} dropout{dropoutCount === 1 ? '' : 's'}
                  </span>
                  <span className="text-slate-400"> · </span>
                  <span>({traineeTotal} originally enrolled)</span>
                </>
              ) : (
                <>{traineeTotal} active trainee{traineeTotal === 1 ? '' : 's'}</>
              )}
              <span className="text-slate-400"> · </span>
              {overall.done}/{overall.total} stages complete ({overall.pct}%)
              {stuckCount > 0 && (
                <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-800">
                  ⚠ {stuckCount} stuck
                </span>
              )}
            </div>
          </div>
          <div className="text-xs text-slate-400">{expanded ? '▾ Hide details' : '▸ Details'}</div>
        </div>
        <div className="mt-3">
          <ProgressStrip stages={stages} />
        </div>
      </button>
      {expanded && (
        <div className="border-t border-slate-200 p-4 space-y-2">
          {stages.map((s) => (
            <StageDetail key={s.key} stage={s} cls={cls} />
          ))}
          <div className="mt-3 flex justify-end">
            <Link
              to={`/class/${cls.id}`}
              className="text-xs font-semibold text-sky-700 underline"
            >
              Open class detail →
            </Link>
          </div>
        </div>
      )}
    </li>
  )
}

// Horizontal strip of 8 dots. Each dot:
//   • filled green when stage is done
//   • half-filled yellow when partial (counts > 0 but < total)
//   • red ring when stuck (should be done by now)
//   • empty grey when not yet started
function ProgressStrip({ stages }) {
  return (
    <div className="flex items-stretch gap-1">
      {stages.map((s, i) => (
        <div key={s.key} className="flex-1">
          <div
            className={
              'h-2 rounded-full ' +
              (s.state === 'done'
                ? 'bg-emerald-500'
                : s.state === 'partial'
                  ? 'bg-amber-400'
                  : s.state === 'stuck'
                    ? 'bg-red-400'
                    : 'bg-slate-200')
            }
            title={stripTitle(s)}
          />
          <div className="mt-1 flex items-center justify-center gap-0.5 text-[10px] text-slate-600">
            <span>{s.icon}</span>
            {s.state === 'stuck' && <span className="text-red-700">⚠</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

function stripTitle(s) {
  const stateWord = s.state === 'done' ? '✓ complete' : s.state === 'partial' ? `${s.done}/${s.total} done` : s.state === 'stuck' ? `⚠ stuck (${s.done}/${s.total})` : 'not yet started'
  return `${s.label}: ${stateWord}`
}

// Per-stage row inside the expanded view. Shows status, count, and
// where to go to advance it.
function StageDetail({ stage, cls }) {
  const stateLabel = stage.state === 'done'
    ? '🟢 Complete'
    : stage.state === 'partial'
      ? `🟡 ${stage.done}/${stage.total}`
      : stage.state === 'stuck'
        ? `⚠ Stuck (${stage.done}/${stage.total})`
        : '⚪ Not yet started'
  const stateColor = stage.state === 'done'
    ? 'text-emerald-800'
    : stage.state === 'stuck'
      ? 'text-red-800'
      : stage.state === 'partial'
        ? 'text-amber-800'
        : 'text-slate-600'
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-medium text-slate-800">
          {stage.icon} {stage.label}
        </span>
        <span className={`text-xs font-semibold ${stateColor}`}>{stateLabel}</span>
      </div>
      {stage.detail && (
        <div className="mt-1 text-xs text-slate-600">{stage.detail}</div>
      )}
      {stage.actionLink && (
        <div className="mt-1 text-xs">
          <Link to={stage.actionLink.to(cls)} className="text-sky-700 underline">
            {stage.actionLink.label} →
          </Link>
        </div>
      )}
      {stage.missingNames && stage.missingNames.length > 0 && (
        <details className="mt-1 text-xs">
          <summary className="cursor-pointer text-slate-500">
            {stage.missingNames.length} not yet:
          </summary>
          <div className="mt-1 text-slate-700">{stage.missingNames.join(', ')}</div>
        </details>
      )}
    </div>
  )
}

// Compute the 8 stages for one class. Each stage returns:
//   { key, icon, label, state, done, total, detail?, missingNames?,
//     actionLink? }
// state ∈ 'none' | 'partial' | 'done' | 'stuck'
// 'stuck' means: by the day-of-week we're on, this SHOULD be done.
function computeStages(cls) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = parseLocalDate(cls.week_start_date)
  const end = parseLocalDate(cls.week_end_date)
  const isPastDay1 = start && today >= start
  const isPastDay2 = start && today >= addDaysLocal(start, 1)
  const isPastClass = end && today > end
  // Full enrolled roster (excludes only manual unenroll + explicit decline).
  // Used for the Attendance stage so dropouts surface as missing.
  const trainees = (cls.trainees || []).filter((t) => t.enrolled !== false && !t.declined_at)
  // Active roster — Neal's strict policy: miss ANY officially-over
  // training day and you're a dropout. See getOfficiallyOverDates +
  // isActiveTrainee for the rule. Anyone the dropout cron has already
  // flagged (dropout_notified_at) drops out regardless.
  const day1Iso = cls.week_start_date
  const officiallyOverDates = getOfficiallyOverDates(cls)
  const activeTrainees = trainees.filter((t) => isActiveTrainee(t, officiallyOverDates))
  const total = trainees.length
  const activeTotal = activeTrainees.length
  const namesOf = (rows) => rows.slice(0, 6).map((t) => `${t.first_name || ''} ${t.last_name || ''}`.trim() || '—')

  // 1. Scheduled — location assigned
  const stage1 = (() => {
    const has = !!cls.location_id
    return {
      key: 'scheduled', icon: '📅', label: 'Scheduled',
      state: has ? 'done' : (start && today >= addDaysLocal(start, -7) ? 'stuck' : 'none'),
      done: has ? 1 : 0, total: 1,
      detail: has ? `Location: ${cls.locations?.name || 'set'}` : 'No location assigned',
      actionLink: has ? null : { label: 'Assign on Class detail', to: (c) => `/class/${c.id}` },
    }
  })()

  // 2. Registered. Once Day 1 has passed, the dropout(s) are out of the
  // active roster — switch to activeTrainees so the count says
  // "11/11 ✓" instead of "11/12 stuck because of the dropout".
  const stage2 = (() => {
    const roster = isPastDay1 ? activeTrainees : trainees
    const rosterTotal = isPastDay1 ? activeTotal : total
    const done = roster.filter((t) => t.registered).length
    const missing = roster.filter((t) => !t.registered)
    return {
      key: 'registered', icon: '✉️', label: 'Registered',
      state: stageState(done, rosterTotal, isPastDay1),
      done, total: rosterTotal,
      detail: `${done} of ${rosterTotal} trainees confirmed via /register/<token>`,
      missingNames: namesOf(missing),
    }
  })()

  // 3. Hotels — among trainees needing hotels (post-Day-1: active only)
  const stage3 = (() => {
    const roster = isPastDay1 ? activeTrainees : trainees
    const eligible = roster.filter((t) => t.needs_hotel)
    const done = eligible.filter((t) => Array.isArray(t.trainee_hotel_stays) && t.trainee_hotel_stays.length > 0).length
    const totalH = eligible.length
    if (totalH === 0) {
      return {
        key: 'hotels', icon: '🛏️', label: 'Hotels',
        state: 'done', done: 0, total: 0,
        detail: 'No trainees need hotels.',
      }
    }
    const missing = eligible.filter((t) => !Array.isArray(t.trainee_hotel_stays) || t.trainee_hotel_stays.length === 0)
    return {
      key: 'hotels', icon: '🛏️', label: 'Hotels',
      state: stageState(done, totalH, isPastDay1),
      done, total: totalH,
      detail: `${done} of ${totalH} needs-hotel trainees have stays booked`,
      missingNames: namesOf(missing),
      actionLink: { label: 'Open Hotels', to: () => '/hotels' },
    }
  })()

  // 4. Itinerary email sent (registered trainees only — itinerary cron
  //    only fires after registration). Post-Day-1: active roster only.
  const stage4 = (() => {
    const roster = isPastDay1 ? activeTrainees : trainees
    const eligible = roster.filter((t) => t.registered)
    const done = eligible.filter((t) => !!t.itinerary_email_sent_at).length
    const totalI = eligible.length
    if (totalI === 0) {
      return {
        key: 'itinerary', icon: '✈️', label: 'Itinerary',
        state: 'none', done: 0, total: 0,
        detail: 'Nobody registered yet — itinerary cron has nothing to send.',
      }
    }
    const missing = eligible.filter((t) => !t.itinerary_email_sent_at)
    return {
      key: 'itinerary', icon: '✈️', label: 'Itinerary',
      state: stageState(done, totalI, isPastDay1),
      done, total: totalI,
      detail: `${done} of ${totalI} registered trainees got the itinerary email`,
      missingNames: namesOf(missing),
    }
  })()

  // 5. Attendance — Day 1 sign-ins. Intentionally uses the full
  //    enrolled roster (not active) so dropouts surface as "missing".
  const stage5 = (() => {
    if (!isPastDay1) {
      return {
        key: 'attendance', icon: '👋', label: 'Attendance',
        state: 'none', done: 0, total,
        detail: 'Day 1 hasn\'t happened yet.',
      }
    }
    const done = trainees.filter((t) =>
      (t.attendance || []).some((a) => a.attendance_date === day1Iso && a.confirmed),
    ).length
    const missing = trainees.filter((t) =>
      !(t.attendance || []).some((a) => a.attendance_date === day1Iso && a.confirmed),
    )
    return {
      key: 'attendance', icon: '👋', label: 'Attendance',
      state: done === total ? 'done' : (done > 0 ? 'partial' : 'stuck'),
      done, total,
      detail: `${done} of ${total} signed in on Day 1 (${day1Iso}). Per strict policy, the ${total - done} no-show${total - done === 1 ? '' : 's'} ${total - done === 1 ? 'is a dropout' : 'are dropouts'} and ${total - done === 1 ? 'is' : 'are'} excluded from the stages below.`,
      missingNames: namesOf(missing),
      actionLink: { label: 'Open Attendance', to: () => '/attendance' },
    }
  })()

  // 6. Provisioned — every ACTIVE trainee (post-Day-1 dropouts excluded
  //    per the strict policy) has company_email AND IT marked done. The
  //    denominator drops automatically once a no-show is identified.
  const stage6 = (() => {
    const withEmail = activeTrainees.filter((t) => !!t.company_email).length
    const allEmails = withEmail === activeTotal && activeTotal > 0
    const itComplete = !!cls.it_completed_at
    const done = (allEmails && itComplete) ? 1 : 0
    const totalP = 1
    let state, detail
    if (done) {
      state = 'done'
      detail = `All ${activeTotal} active trainees' emails assigned, IT marked complete ${fmtDate(cls.it_completed_at)}`
    } else if (allEmails && !itComplete) {
      state = isPastDay2 ? 'stuck' : 'partial'
      detail = `${withEmail} of ${activeTotal} active emails assigned — IT hasn't clicked "Mark provisioning complete" yet.`
    } else if (withEmail > 0) {
      state = isPastDay2 ? 'stuck' : 'partial'
      detail = `${withEmail} of ${activeTotal} active emails assigned`
    } else {
      state = isPastDay2 ? 'stuck' : 'none'
      detail = cls.day_2_it_notified_at
        ? `IT was notified ${fmtDate(cls.day_2_it_notified_at)} but hasn't started yet.`
        : 'IT not yet notified.'
    }
    return {
      key: 'provisioned', icon: '📧', label: 'Provisioned',
      state, done, total: totalP, detail,
      actionLink: { label: 'Open Provisioning', to: (c) => `/provision/${c.id}` },
    }
  })()

  // 7. Credentials — texted login info to the active roster only.
  const stage7 = (() => {
    const eligible = activeTrainees
    const done = eligible.filter((t) => !!t.credentials_sent_at).length
    const totalC = eligible.length
    const missing = eligible.filter((t) => !t.credentials_sent_at)
    return {
      key: 'credentials', icon: '🔑', label: 'Credentials',
      state: stageState(done, totalC, isPastDay2),
      done, total: totalC,
      detail: `${done} of ${totalC} active trainees were texted their credentials`,
      missingNames: namesOf(missing),
      actionLink: { label: 'Open class detail', to: (c) => `/class/${c.id}` },
    }
  })()

  // 8. Graduated — final test submitted. Active roster only.
  const stage8 = (() => {
    const done = activeTrainees.filter((t) =>
      Array.isArray(t.test_attempts) && t.test_attempts.some((a) => a.submitted_at),
    ).length
    const missing = activeTrainees.filter(
      (t) => !(Array.isArray(t.test_attempts) && t.test_attempts.some((a) => a.submitted_at)),
    )
    return {
      key: 'graduated', icon: '🎓', label: 'Graduated',
      state: done === activeTotal && activeTotal > 0
        ? 'done'
        : (isPastClass ? 'stuck' : (done > 0 ? 'partial' : 'none')),
      done, total: activeTotal,
      detail: `${done} of ${activeTotal} active trainees submitted the final test`,
      missingNames: namesOf(missing),
    }
  })()

  return [stage1, stage2, stage3, stage4, stage5, stage6, stage7, stage8]
}

// Generic "where in done/total are we, and should we be done by now?"
// totalIs0 → 'done' (vacuous). isStuckIfIncomplete = true → red flag
// when not 100% yet.
function stageState(done, total, isStuckIfIncomplete) {
  if (total === 0) return 'done'
  if (done >= total) return 'done'
  if (done === 0) return isStuckIfIncomplete ? 'stuck' : 'none'
  return isStuckIfIncomplete ? 'stuck' : 'partial'
}

function addDaysLocal(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
  return x
}

// Every "officially over" training day for a class. A day counts as
// over if EITHER:
//   • the date is strictly before today (the day fully passed), OR
//   • admin clicked "Close sign-in" for that day at the kiosk
//     (sign_in_closures row exists).
//
// Today (in-progress) is intentionally NOT counted by default — a
// trainee who hasn't signed in by noon might just be late. Admin
// closes sign-in to commit "everyone who's getting in is in" and the
// no-shows immediately become dropouts.
//
// Returns an array of YYYY-MM-DD strings (matching attendance_date
// values from Postgres). Empty if class hasn't started.
export function getOfficiallyOverDates(cls) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = parseLocalDate(cls.week_start_date)
  const end = parseLocalDate(cls.week_end_date)
  if (!start) return []
  const todayIso = ymdLocal(today)
  const closedDates = new Set((cls.sign_in_closures || []).map((c) => c.attendance_date))
  const lastIso = end && today > end ? ymdLocal(end) : todayIso
  const out = []
  let cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  while (ymdLocal(cursor) <= lastIso) {
    const iso = ymdLocal(cursor)
    if (iso < todayIso || closedDates.has(iso)) out.push(iso)
    cursor = addDaysLocal(cursor, 1)
  }
  return out
}

// True if this trainee is still part of the active roster — i.e. they
// attended every officially-over day and the dropout cron hasn't
// flagged them. Decoupled from class state so the same predicate
// works for the header summary + the per-stage logic.
export function isActiveTrainee(t, officiallyOverDates) {
  if (t.dropout_notified_at) return false
  if (officiallyOverDates.length === 0) return true
  const dates = new Set(
    (t.attendance || []).filter((a) => a.confirmed).map((a) => a.attendance_date),
  )
  return officiallyOverDates.every((d) => dates.has(d))
}

// Local-timezone YYYY-MM-DD, matching the format Postgres `date` columns
// come back as. Used for cross-referencing attendance + sign_in_closures
// rows (both keyed by attendance_date as YYYY-MM-DD).
function ymdLocal(d) {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString()
}
