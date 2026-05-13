import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { formatDateRange, parseLocalDate } from '../lib/dates.js'

// Default initial password assigned to every newly-provisioned company email.
// Trainees are prompted to change it on first login. Change here if your IT
// policy changes.
const DEFAULT_INITIAL_PASSWORD = 'BlueCat12!'

function addDaysIso(iso, days) {
  const base = parseLocalDate(iso)
  if (!base) return iso
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function Provision() {
  const { class_id } = useParams()
  const [cls, setCls] = useState(null)
  const [rows, setRows] = useState([]) // [{ trainee, email, password }]
  const [domain, setDomain] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data: clsData, error: clsErr } = await supabase
      .from('classes')
      .select(
        'id, region, week_start_date, week_end_date, locations(name, street_address, city, state, zip), trainees(*), attendance(trainee_id, attendance_date, confirmed)',
      )
      .eq('id', class_id)
      .maybeSingle()
    if (clsErr || !clsData) {
      setError(clsErr?.message || 'Class not found.')
      setLoading(false)
      return
    }
    setCls(clsData)

    // Anyone who's checked in on day 2 or later is eligible (day 1 is too early
    // to provision — they haven't completed enough training yet).
    // Already-provisioned trainees are included too so day-3+ revisits still show prior work.
    const day2Iso = addDaysIso(clsData.week_start_date, 1)
    const checkedInIds = new Set(
      (clsData.attendance || [])
        .filter((a) => a.confirmed && a.attendance_date >= day2Iso)
        .map((a) => a.trainee_id),
    )

    const eligible = (clsData.trainees || [])
      .filter(
        (t) =>
          t.enrolled !== false && (checkedInIds.has(t.id) || t.email_assigned_at),
      )
      .sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`))

    setRows(
      eligible.map((t) => ({
        trainee: t,
        email: t.company_email || '',
        // Auto-fill the standard initial password; IT can still override per row.
        password: t.company_email_password || DEFAULT_INITIAL_PASSWORD,
      })),
    )
    setLoading(false)
  }, [class_id])

  useEffect(() => {
    load()
  }, [load])

  function updateRow(traineeId, field, value) {
    setRows((prev) =>
      prev.map((r) => (r.trainee.id === traineeId ? { ...r, [field]: value } : r)),
    )
  }

  function autofillFromDomain() {
    if (!domain.trim()) return
    const cleanDomain = domain.trim().replace(/^@/, '').toLowerCase()
    setRows((prev) =>
      prev.map((r) =>
        r.email
          ? r
          : {
              ...r,
              email: `${slugify(r.trainee.first_name)}.${slugify(r.trainee.last_name)}@${cleanDomain}`,
            },
      ),
    )
  }

  async function unenrollFromHere(t) {
    const reason = prompt(
      `Unenroll ${t.first_name} ${t.last_name}? They'll be removed from this roster. Reason (optional):`,
      '',
    )
    if (reason === null) return
    const { error: err } = await supabase
      .from('trainees')
      .update({
        enrolled: false,
        unenrolled_at: new Date().toISOString(),
        unenrolled_reason: reason.trim() || null,
      })
      .eq('id', t.id)
    if (err) {
      setMessage({ type: 'error', text: err.message })
      return
    }
    setMessage({ type: 'success', text: `Unenrolled ${t.first_name} ${t.last_name}.` })
    load()
  }

  async function submit() {
    setMessage(null)

    const toProvision = rows.filter((r) => r.email.trim() && r.password.trim())
    if (toProvision.length === 0) {
      setMessage({
        type: 'error',
        text: 'Fill in at least one row (email + password) before submitting.',
      })
      return
    }

    setSubmitting(true)
    try {
      // 1. Save each trainee's credentials to Supabase
      for (const r of toProvision) {
        const { error: err } = await supabase
          .from('trainees')
          .update({
            company_email: r.email.trim(),
            company_email_password: r.password.trim(),
            email_assigned_at: new Date().toISOString(),
          })
          .eq('id', r.trainee.id)
        if (err) throw err
      }

      // 2. Call the Netlify function to send credentials SMS + admin notification
      const res = await fetch('/.netlify/functions/send-credentials-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          class_id,
          trainee_ids: toProvision.map((r) => r.trainee.id),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 404) {
          setMessage({
            type: 'error',
            text: 'Credentials saved, but the SMS endpoint is only available on the deployed Netlify site (not in npm run dev).',
          })
          return
        }
        throw new Error(body.error || `Request failed: ${res.status}`)
      }

      const failures = (body.results || []).filter((r) => !r.success)
      const successCount = (body.results || []).filter((r) => r.success).length
      if (failures.length === 0) {
        setMessage({
          type: 'success',
          text: `Saved credentials and sent ${successCount} text${successCount === 1 ? '' : 's'}. You should also receive a notification SMS.`,
        })
      } else {
        setMessage({
          type: 'error',
          text: `Saved credentials. Sent ${successCount}, failed ${failures.length}. First error: ${failures[0].error}`,
        })
      }
      load()
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Something went wrong.' })
    } finally {
      setSubmitting(false)
    }
  }

  const noonReminder = useMemo(() => {
    const now = new Date()
    const hour = now.getHours()
    return hour < 12
  }, [])

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>
  if (error) {
    return (
      <div className="space-y-4">
        <BackLink classId={class_id} />
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      </div>
    )
  }
  if (!cls) return null

  return (
    <div className="space-y-6">
      <BackLink classId={class_id} />

      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Provision company emails</h1>
        <p className="mt-2 text-slate-600">
          {cls.locations?.name || `${cls.region} — TBD`} ·{' '}
          {formatDateRange(cls.week_start_date, cls.week_end_date)}
        </p>
        <p className="text-sm text-slate-500">
          Shows enrolled trainees who've checked in on day 2 or later, plus anyone already
          provisioned. Fill in each one's company email, then submit to send their credentials via
          SMS.
        </p>
        <p className="mt-1 text-xs text-slate-500">
          🔑 Initial password auto-fills with{' '}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">{DEFAULT_INITIAL_PASSWORD}</code>.{' '}
          Override per row if needed.
        </p>
      </header>

      {noonReminder && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          ⏰ It's still morning. Best practice is to wait until <strong>noon</strong> on day 2 so
          there's time to unenroll anyone who hasn't tested well. Submit when you're ready.
        </div>
      )}

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

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-slate-600">No enrolled trainees have checked in from day 2 onward yet.</p>
          <p className="mt-1 text-sm text-slate-500">
            Trainees only appear here once they've signed in at the kiosk on day 2 or later. If
            you've unenrolled people, only the ones still enrolled show up.
          </p>
        </div>
      ) : (
        <>
          {/* Domain auto-fill helper */}
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <label className="block text-sm font-medium text-slate-700">
              Company email domain (optional helper)
              <div className="mt-1 flex gap-2">
                <input
                  type="text"
                  placeholder="usshingle.com"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  className={inputCls + ' max-w-xs'}
                />
                <button
                  type="button"
                  onClick={autofillFromDomain}
                  disabled={!domain.trim()}
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Auto-fill emails
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Fills empty email fields below with firstname.lastname@yourdomain (won't overwrite
                rows you've already typed).
              </p>
            </label>
          </div>

          {/* Trainee rows */}
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <ul className="divide-y divide-slate-200">
              {rows.map((r) => (
                <li key={r.trainee.id} className="p-4">
                  <div className="grid gap-3 sm:grid-cols-[1fr_2fr_1fr_auto] sm:items-end">
                    <div>
                      <div className="font-medium text-slate-900">
                        {r.trainee.first_name} {r.trainee.last_name}
                      </div>
                      <div className="text-xs text-slate-500">{r.trainee.phone}</div>
                      {r.trainee.email_assigned_at && (
                        <div className="mt-0.5 text-xs text-green-700">
                          ✓ Email assigned {new Date(r.trainee.email_assigned_at).toLocaleString()}
                        </div>
                      )}
                    </div>
                    <label className="block text-xs font-medium text-slate-700">
                      Company email
                      <input
                        type="email"
                        value={r.email}
                        onChange={(e) => updateRow(r.trainee.id, 'email', e.target.value)}
                        placeholder="firstname.lastname@usshingle.com"
                        className={inputCls}
                        autoComplete="off"
                      />
                    </label>
                    <label className="block text-xs font-medium text-slate-700">
                      Initial password
                      <input
                        type="text"
                        value={r.password}
                        onChange={(e) => updateRow(r.trainee.id, 'password', e.target.value)}
                        placeholder="TempPass2026!"
                        className={inputCls}
                        autoComplete="off"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => unenrollFromHere(r.trainee)}
                      className="self-start rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 sm:self-end sm:mb-1"
                      title="Remove from roster (didn't pass assessment, etc.)"
                    >
                      Unenroll
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-700">
              <strong>{rows.filter((r) => r.email.trim() && r.password.trim()).length}</strong>{' '}
              of {rows.length} ready to send.
            </p>
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="rounded-md bg-brand-navy px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-navy-dark disabled:opacity-50"
            >
              {submitting ? 'Saving + sending…' : 'Save & send credentials'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function BackLink({ classId }) {
  return (
    <Link to={`/class/${classId}`} className="inline-flex items-center text-sm text-slate-600 hover:text-slate-900">
      ← Back to class
    </Link>
  )
}

function slugify(s) {
  return (s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

const inputCls =
  'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500'
