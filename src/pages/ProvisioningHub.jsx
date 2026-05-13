import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { formatDateRange, parseLocalDate } from '../lib/dates.js'

// Hub page for IT. Shows ONLY classes that are actually ready to be
// provisioned right now — past day 2 start, still in their training week,
// not yet marked complete. Empty state otherwise so IT isn't confused by
// stale classes.

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDaysIso(iso, days) {
  const base = parseLocalDate(iso)
  if (!base) return iso
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function ProvisioningHub() {
  const [classes, setClasses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const today = todayIso()
    // A class is "ready for provisioning" when:
    //  - today is on or after day 2 (week_start_date + 1)
    //  - today is on or before the last day of the class
    //  - IT hasn't already marked it complete
    const { data, error: err } = await supabase
      .from('classes')
      .select(
        'id, region, week_start_date, week_end_date, day_2_it_notified_at, it_completed_at, locations(name), trainees(id, enrolled, company_email, email_assigned_at, attendance(attendance_date, confirmed))',
      )
      .lte('week_start_date', addDaysIso(today, -1)) // class started by yesterday (so day 2 has begun)
      .gte('week_end_date', today) // class still active
      .is('it_completed_at', null) // not already done
      .order('week_start_date', { ascending: true })
    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }
    setClasses(data || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>
  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        {error}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Provisioning</h1>
        <p className="mt-2 text-slate-600">
          Classes ready for company-email provisioning right now. Pages disappear once IT marks
          provisioning complete.
        </p>
      </header>

      {classes.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="space-y-3">
          {classes.map((cls) => (
            <ClassCard key={cls.id} cls={cls} />
          ))}
        </ul>
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center">
      <div className="text-3xl">📭</div>
      <p className="mt-3 text-base font-medium text-slate-700">No classes ready for provisioning.</p>
      <p className="mt-1 text-sm text-slate-500">
        This page populates once a class reaches day 2 and trainees start checking in. Until then,
        nothing to do here.
      </p>
    </div>
  )
}

function ClassCard({ cls }) {
  const day2 = addDaysIso(cls.week_start_date, 1)
  const enrolled = (cls.trainees || []).filter((t) => t.enrolled !== false)
  const checkedInDay2OrLater = new Set(
    (cls.trainees || [])
      .flatMap((t) =>
        (t.attendance || []).some((a) => a.confirmed && a.attendance_date >= day2)
          ? [t.id]
          : [],
      ),
  )
  const eligible = enrolled.filter((t) => checkedInDay2OrLater.has(t.id) || t.email_assigned_at)
  const alreadyProvisioned = enrolled.filter((t) => t.company_email).length
  const itNotified = !!cls.day_2_it_notified_at

  return (
    <li className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <Link
        to={`/provision/${cls.id}`}
        className="block p-5 transition hover:bg-slate-50"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-brand-navy">
            {cls.region} · {cls.locations?.name || 'TBD'}
          </h2>
          <span className="text-sm text-slate-500">
            Week of {formatDateRange(cls.week_start_date, cls.week_end_date)}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-medium text-sky-800">
            {eligible.length} ready to provision
          </span>
          {alreadyProvisioned > 0 && (
            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800">
              {alreadyProvisioned} email{alreadyProvisioned === 1 ? '' : 's'} assigned
            </span>
          )}
          {itNotified && (
            <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700">
              IT reminder sent {new Date(cls.day_2_it_notified_at).toLocaleString()}
            </span>
          )}
        </div>
        <p className="mt-3 inline-flex items-center text-sm font-medium text-brand-navy">
          Open Provision page →
        </p>
      </Link>
    </li>
  )
}
