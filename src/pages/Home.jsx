import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'

export default function Home() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-brand-navy">Welcome</h1>
        <p className="mt-2 text-slate-600">
          U.S. Shingle &amp; Metal Training Management. Pick where you want to go:
        </p>
      </div>
      <HotelAlert />
      <div className="grid gap-4 sm:grid-cols-2">
        <Tile to="/regional-managers" title="Regional Managers" desc="Open each zone's manager dashboard — rep reports, active leads, damage / no-damage assignments, and manager links." />
        <Tile to="/calendar" title="Schedule" desc="See every training week. Click a week to see who's coming and manage SMS." />
        <Tile to="/attendance" title="Daily Attendance" desc="HR view: who signed in today, every class, every region." />
        <Tile to="/manager" title="Hiring Manager Portal" desc="Create a new training class and add trainees." />
        <Tile to="/locations" title="Locations" desc="Manage your training locations — hotels, offices, training sites — by region." />
        <Tile to="/group-messages" title="Group Messages" desc="Broadcast SMS or email to every active sales rep, a region, or one class — for company meetings and ad-hoc blasts." />
        <Tile to="/active-reps" title="Active Sales Reps" desc="Master list of reps in the field. Promote, deactivate, and mark who's left the company." />
        <Tile to="/offboarding" title="Off Boarding" desc="Reps who left — check off each system (GoHighLevel, Google, JobNimbus, RoofR) to deactivate; auto-completes when all are done." />
      </div>
    </div>
  )
}

// Home-page nudge: "hotels need to be booked." Shows the count of trainees who
// need a room for the nearest upcoming week (Week A + Week B cohorts) and aren't
// booked yet. Silent when there's nothing to book.
function HotelAlert() {
  const [need, setNeed] = useState(null) // { count, weekMon }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: classes } = await supabase
        .from('classes')
        .select('id, week_start_date, week_end_date, cancelled_at')
      if (!classes) return
      const weekMon = defaultWeekMon(classes)
      const weekBStart = addDaysISO(weekMon, -7)
      const phaseByClass = {}
      for (const c of classes) {
        if (c.cancelled_at || !c.week_start_date) continue
        const start = mondayOf(c.week_start_date)
        if (start === weekMon) phaseByClass[c.id] = 'A'
        else if (start === weekBStart) phaseByClass[c.id] = 'B'
      }
      const ids = Object.keys(phaseByClass)
      if (ids.length === 0) { if (!cancelled) setNeed({ count: 0, weekMon }); return }
      const [tRes, sRes] = await Promise.all([
        supabase
          .from('trainees')
          .select('id, class_id, enrolled, left_company_at, declined_at, dropped_out_at, week_b_hold, needs_hotel, attendance(attendance_date, confirmed)')
          .in('class_id', ids)
          .eq('needs_hotel', true),
        supabase
          .from('trainee_hotel_stays')
          .select('trainee_id, phase, cancelled_at')
          .in('class_id', ids),
      ])
      const bookedKeys = new Set(
        (sRes.data || [])
          .filter((s) => !s.cancelled_at)
          .map((s) => `${s.trainee_id}:${s.phase || 'A'}`),
      )
      // Week B only counts people who actually attended Week A (the prior week).
      const waStart = addDaysISO(weekMon, -7)
      const waEnd = addDaysISO(weekMon, -1)
      const attendedWeekA = (t) =>
        (t.attendance || []).some((a) => a.confirmed && a.attendance_date >= waStart && a.attendance_date <= waEnd)
      const count = (tRes.data || []).filter(
        (t) =>
          t.enrolled !== false && !t.left_company_at &&
          !t.declined_at &&
          !t.dropped_out_at &&
          // Held out of Week B: not travelling, so not a room to book.
          t.week_b_hold !== true &&
          (phaseByClass[t.class_id] !== 'B' || attendedWeekA(t)) &&
          !bookedKeys.has(`${t.id}:${phaseByClass[t.class_id]}`),
      ).length
      if (!cancelled) setNeed({ count, weekMon })
    })()
    return () => { cancelled = true }
  }, [])

  if (!need || need.count === 0) return null
  return (
    <Link
      to="/hotels"
      className="flex items-center justify-between gap-4 rounded-lg border border-amber-300 bg-amber-50 p-5 shadow-sm transition hover:border-amber-400 hover:bg-amber-100"
    >
      <div className="flex items-center gap-3">
        <span className="text-2xl" aria-hidden="true">🏨</span>
        <div>
          <div className="font-semibold text-amber-900">
            {need.count} hotel room{need.count === 1 ? '' : 's'} need booking
          </div>
          <div className="text-sm text-amber-800">
            Trainees for the week of {formatDate(need.weekMon)} still need a room. Book them and send their info.
          </div>
        </div>
      </div>
      <span className="shrink-0 rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white">
        Book hotels →
      </span>
    </Link>
  )
}

// --- date helpers (match the Hotels page) ---
function addDaysISO(iso, n) {
  if (!iso) return iso
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}
function mondayOf(iso) {
  if (!iso) return iso
  const [y, m, d] = iso.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return addDaysISO(iso, -(dow === 0 ? 6 : dow - 1))
}
function todayISO() {
  const p = {}
  for (const part of new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())) p[part.type] = part.value
  return `${p.year}-${p.month}-${p.day}`
}
function defaultWeekMon(classes) {
  // The COMING week — nearest week whose Monday is today or later (a week already
  // underway is already booked, so skip to the next).
  const today = todayISO()
  const mondays = new Set()
  for (const c of classes || []) {
    if (c.cancelled_at || !c.week_start_date) continue
    const a = mondayOf(c.week_start_date)
    mondays.add(a)
    mondays.add(addDaysISO(a, 7))
  }
  const upcoming = [...mondays].filter((m) => m >= today).sort()
  return upcoming[0] || mondayOf(today)
}
function formatDate(iso) {
  if (!iso) return ''
  const [y, m, d] = String(iso).split('T')[0].split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}

function Tile({ to, title, desc }) {
  return (
    <Link
      to={to}
      className="group block rounded-lg border border-slate-200 bg-white p-6 shadow-sm transition hover:border-brand-navy hover:shadow-md"
    >
      <div className="flex items-start gap-3">
        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand-red transition group-hover:bg-brand-navy" aria-hidden="true" />
        <div>
          <h2 className="text-lg font-semibold text-brand-navy">{title}</h2>
          <p className="mt-1 text-sm text-slate-600">{desc}</p>
        </div>
      </div>
    </Link>
  )
}

function Disabled({ title, desc }) {
  return (
    <div className="block rounded-lg border border-dashed border-slate-200 bg-white p-6 opacity-60">
      <div className="flex items-start gap-3">
        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-slate-300" aria-hidden="true" />
        <div>
          <h2 className="text-lg font-semibold text-slate-700">{title}</h2>
          <p className="mt-1 text-sm text-slate-600">{desc}</p>
        </div>
      </div>
    </div>
  )
}
