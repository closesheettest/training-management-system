import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { formatDateRange, parseLocalDate } from '../lib/dates.js'

// Default initial password assigned to every newly-provisioned company email.
// Trainees are prompted to change it on first login. Change here if your IT
// policy changes.
const DEFAULT_INITIAL_PASSWORD = 'BlueCat12!'

// Default company email domain. Each row's email auto-populates as
// firstname.lastname@<DEFAULT_DOMAIN> — IT can still override per row.
const DEFAULT_DOMAIN = 'shingleusa.com'

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
        // Auto-fill firstname.lastname@<DEFAULT_DOMAIN>; IT can still override per row.
        email: t.company_email || defaultEmailFor(t),
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

  function downloadCsv() {
    const toExport = rows.filter((r) => r.email.trim() && r.password.trim())
    if (toExport.length === 0) {
      setMessage({ type: 'error', text: 'No rows to export. Fill in at least one email + password.' })
      return
    }
    // Google Workspace bulk-upload format — exact columns from
    // admin.google.com user import template.
    const headers = [
      'First Name [Required]',
      'Last Name [Required]',
      'Email Address [Required]',
      'Password [Required]',
      'Password Hash Function [UPLOAD ONLY]',
      'Change Password at Next Sign-In',
      'New Status [UPLOAD ONLY]',
      'Advanced Protection Program enrollment',
    ]
    const dataRows = toExport.map((r) =>
      [
        titleCase(r.trainee.first_name),
        titleCase(r.trainee.last_name),
        r.email.trim(),
        r.password.trim(),
        '',
        'False',
        '',
        '',
      ]
        .map(csvEscape)
        .join(','),
    )
    const csv = [headers.join(','), ...dataRows, ''].join('\n')

    const safeRegion = (cls?.region || 'class').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    const filename = `${safeRegion}-${cls?.week_start_date || 'week'}-emails.csv`
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    setMessage({
      type: 'success',
      text: `Downloaded ${filename} — upload it to Google Workspace → Users → Bulk upload.`,
    })
  }

  async function markProvisioningComplete() {
    setMessage(null)
    const toProvision = rows.filter((r) => r.email.trim() && r.password.trim())
    if (toProvision.length === 0) {
      setMessage({
        type: 'error',
        text: 'Fill in at least one row (email + password) before marking complete.',
      })
      return
    }
    if (
      !confirm(
        `Mark provisioning complete for ${toProvision.length} trainee${toProvision.length === 1 ? '' : 's'}?\n\n` +
          `This will:\n` +
          `• Save any unsaved emails/passwords\n` +
          `• Text HR that the email list is ready\n` +
          `• Text the VA(s) to start RepCard / JobNimbus / Sales Academy setup\n\n` +
          `The trainees themselves are NOT texted yet — that happens when the corporate trainer is ready.`,
      )
    ) {
      return
    }
    setSubmitting(true)
    try {
      await saveCredentials(toProvision)
      const res = await fetch('/.netlify/functions/mark-provisioning-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ class_id }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 404) {
          setMessage({
            type: 'error',
            text: 'Credentials saved, but the notification endpoint is only available on the deployed Netlify site.',
          })
          return
        }
        throw new Error(body.error || `Request failed: ${res.status}`)
      }
      const hr = body.hr_notified || {}
      const va = body.va_notified || {}
      setMessage({
        type: 'success',
        text:
          `Marked complete. HR notified: ${hr.sent_count || 0}/${hr.recipient_count || 0}. ` +
          `VAs notified: ${va.sent_count || 0}/${va.recipient_count || 0}.` +
          (hr.recipient_count === 0 || va.recipient_count === 0
            ? ' (Subscribe people in /notifications if recipient counts are 0.)'
            : ''),
      })
      load()
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Something went wrong.' })
    } finally {
      setSubmitting(false)
    }
  }

  async function saveCredentials(toProvision) {
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
          ✉️ Each email auto-fills as{' '}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">firstname.lastname@{DEFAULT_DOMAIN}</code>.{' '}
          🔑 Password auto-fills with{' '}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">{DEFAULT_INITIAL_PASSWORD}</code>.{' '}
          Edit any row inline, then <strong>Download CSV</strong> to bulk-upload to Google Workspace, then{' '}
          <strong>Mark provisioning complete</strong>.
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
                        placeholder={`firstname.lastname@${DEFAULT_DOMAIN}`}
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
              of {rows.length} ready.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={downloadCsv}
                disabled={submitting}
                className="rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                title="Download a Google Workspace bulk-upload CSV (First Name, Last Name, Email, Password, etc.) — paste straight into admin.google.com → Users → Bulk upload."
              >
                ⬇ Download CSV
              </button>
              <button
                type="button"
                onClick={markProvisioningComplete}
                disabled={submitting}
                className="rounded-md bg-brand-navy px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-navy-dark disabled:opacity-50"
                title="Saves credentials and texts HR + the VA(s). Trainees themselves are NOT texted yet — the corporate trainer sends those once setup is finished."
              >
                {submitting ? 'Working…' : '✅ Mark provisioning complete'}
              </button>
            </div>
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

function defaultEmailFor(trainee) {
  const first = slugify(trainee.first_name)
  const last = slugify(trainee.last_name)
  if (!first && !last) return ''
  return `${first}.${last}@${DEFAULT_DOMAIN}`
}

function titleCase(s) {
  if (!s) return ''
  return s
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

// Wrap a value in quotes if it contains characters that need escaping per RFC 4180.
function csvEscape(value) {
  const s = String(value ?? '')
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

const inputCls =
  'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500'
