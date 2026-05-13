import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { formatDateRange } from '../lib/dates.js'

// Placeholder page — Commit B will replace this with:
//   - Email list (read-only, for HR)
//   - Per-trainee setup checklist for RepCard / JobNimbus / Sales Academy (for VAs)
//   - Copy-to-clipboard + share-to-VA buttons
//
// For now it shows the class info + the list of provisioned emails so HR can
// see what's ready, and VAs know what class they're being asked to set up.

export default function Setup() {
  const { class_id } = useParams()
  const [cls, setCls] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: err } = await supabase
      .from('classes')
      .select('id, region, week_start_date, week_end_date, locations(name), trainees(id, first_name, last_name, company_email, enrolled)')
      .eq('id', class_id)
      .maybeSingle()
    if (err || !data) {
      setError(err?.message || 'Class not found.')
      setLoading(false)
      return
    }
    setCls(data)
    setLoading(false)
  }, [class_id])

  useEffect(() => {
    if (!class_id) return
    load()
  }, [class_id, load])

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>
  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        {error}
      </div>
    )
  }
  if (!cls) return null

  const trainees = (cls.trainees || [])
    .filter((t) => t.enrolled !== false && t.company_email)
    .sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`))

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-brand-navy">
          {cls.region} · {cls.locations?.name || 'TBD'}
        </h1>
        <p className="mt-1 text-slate-600">
          Week of {formatDateRange(cls.week_start_date, cls.week_end_date)}
        </p>
      </header>

      <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
        <strong>Heads up:</strong> the full HR list view and VA setup checklist are arriving in the
        next deploy. For now you can see who's been provisioned below — copy the emails into your
        existing tools to set up RepCard, JobNimbus, and Sales Academy.
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">
          Provisioned trainees{' '}
          <span className="text-slate-500 font-normal">({trainees.length})</span>
        </h2>
        {trainees.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            No company emails on this class yet. IT needs to fill in the Provision page first.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-200 rounded-md border border-slate-200">
            {trainees.map((t) => (
              <li key={t.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="font-medium text-slate-900">
                  {t.first_name} {t.last_name}
                </span>
                <code className="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-700">
                  {t.company_email}
                </code>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div>
        <Link
          to={`/class/${class_id}`}
          className="text-sm text-slate-500 hover:text-slate-700 hover:underline"
        >
          ← Back to class
        </Link>
      </div>
    </div>
  )
}
