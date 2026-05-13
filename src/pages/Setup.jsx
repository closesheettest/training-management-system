import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { formatDateRange } from '../lib/dates.js'

const PLATFORMS = [
  { key: 'repcard', label: 'RepCard', field: 'repcard_setup_at' },
  { key: 'jobnimbus', label: 'JobNimbus', field: 'jobnimbus_setup_at' },
  { key: 'sales_academy', label: 'Sales Academy', field: 'sales_academy_setup_at' },
]

export default function Setup() {
  const { class_id } = useParams()
  const [cls, setCls] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null) // `${traineeId}:${field}` while saving
  const [message, setMessage] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: err } = await supabase
      .from('classes')
      .select(
        'id, region, week_start_date, week_end_date, locations(name), trainees(id, first_name, last_name, company_email, enrolled, repcard_setup_at, jobnimbus_setup_at, sales_academy_setup_at)',
      )
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

  async function togglePlatform(trainee, field) {
    const tag = `${trainee.id}:${field}`
    setBusy(tag)
    setMessage(null)
    const next = trainee[field] ? null : new Date().toISOString()
    const { error: err } = await supabase
      .from('trainees')
      .update({ [field]: next })
      .eq('id', trainee.id)
    if (err) {
      setMessage({ type: 'error', text: err.message })
      setBusy(null)
      return
    }
    // Optimistic local update so the UI feels instant.
    setCls((prev) =>
      prev
        ? {
            ...prev,
            trainees: prev.trainees.map((t) =>
              t.id === trainee.id ? { ...t, [field]: next } : t,
            ),
          }
        : prev,
    )
    setBusy(null)
  }

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

  const platformDone = (field) => trainees.filter((t) => t[field]).length
  const totalSlots = trainees.length * PLATFORMS.length
  const doneSlots = trainees.reduce(
    (acc, t) => acc + PLATFORMS.filter((p) => t[p.field]).length,
    0,
  )
  const fullyDone =
    trainees.length > 0 &&
    trainees.every((t) => PLATFORMS.every((p) => t[p.field]))

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-brand-navy">
          Set up trainees on RepCard, JobNimbus &amp; Sales Academy
        </h1>
        <p className="mt-1 text-slate-600">
          {cls.region} · {cls.locations?.name || 'TBD'} · Week of{' '}
          {formatDateRange(cls.week_start_date, cls.week_end_date)}
        </p>
      </header>

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">Progress</h2>
          <span className="text-sm text-slate-500">
            {doneSlots} / {totalSlots} platforms complete
          </span>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {PLATFORMS.map((p) => (
            <div
              key={p.key}
              className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
            >
              <div className="font-medium text-slate-800">{p.label}</div>
              <div className="text-xs text-slate-500">
                {platformDone(p.field)} / {trainees.length} done
              </div>
            </div>
          ))}
        </div>
        {fullyDone && (
          <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            🎉 <strong>All trainees set up on every platform.</strong> The corporate trainer will be
            notified — they can send credentials texts when ready.
          </div>
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
          {message.text}
        </div>
      )}

      {trainees.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-slate-600">No company emails have been provisioned yet.</p>
          <p className="mt-1 text-sm text-slate-500">
            IT needs to complete the Provision page first — then trainees will show up here for VA
            setup.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <ul className="divide-y divide-slate-200">
            {trainees.map((t) => (
              <TraineeRow
                key={t.id}
                trainee={t}
                busy={busy}
                onToggle={togglePlatform}
              />
            ))}
          </ul>
        </div>
      )}

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

function TraineeRow({ trainee, busy, onToggle }) {
  const allDone = PLATFORMS.every((p) => trainee[p.field])
  return (
    <li className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-900">
              {trainee.first_name} {trainee.last_name}
            </span>
            {allDone && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                ✓ Fully set up
              </span>
            )}
          </div>
          <div className="mt-0.5 break-all text-xs text-slate-500">
            <CopyableEmail email={trainee.company_email} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {PLATFORMS.map((p) => {
            const done = !!trainee[p.field]
            const tag = `${trainee.id}:${p.field}`
            const isBusy = busy === tag
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => onToggle(trainee, p.field)}
                disabled={busy !== null}
                title={
                  done
                    ? `Marked done ${new Date(trainee[p.field]).toLocaleString()} — click to undo`
                    : `Mark ${p.label} set up for ${trainee.first_name}`
                }
                className={
                  (done
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50') +
                  ' rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50'
                }
              >
                {isBusy ? '…' : `${done ? '✓ ' : '☐ '}${p.label}`}
              </button>
            )
          })}
        </div>
      </div>
    </li>
  )
}

function CopyableEmail({ email }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(email)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      window.prompt('Email:', email)
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="font-mono text-slate-700 hover:text-slate-900 hover:underline"
      title="Click to copy"
    >
      {email} {copied && <span className="ml-1 text-emerald-700">copied!</span>}
    </button>
  )
}
