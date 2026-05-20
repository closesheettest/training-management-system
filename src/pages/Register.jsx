import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { US_STATES, formatAddress, ZIP_PATTERN, YEARS_IN_SALES_OPTIONS } from '../lib/locations.js'

export default function Register() {
  const { token } = useParams()
  const [status, setStatus] = useState('loading') // loading | not_found | form | submitting | done | declined | declining
  const [trainee, setTrainee] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [location, setLocation] = useState(null)
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    years_in_sales: '',
    street_address: '',
    city: '',
    state: '',
    zip: '',
  })
  const [errorMsg, setErrorMsg] = useState(null)
  const [showDeclineModal, setShowDeclineModal] = useState(false)
  const [declineReason, setDeclineReason] = useState('')

  useEffect(() => {
    if (!token) {
      setStatus('not_found')
      return
    }
    load()
  }, [token])

  async function load() {
    setStatus('loading')
    // Demo mode for the /messages preview page — no DB hit, fake data so
    // admins can see what the form looks like without a real token.
    if (token === 'demo') {
      const demoClass = {
        id: 'demo',
        week_start_date: '2026-05-11',
        week_end_date: '2026-05-15',
        schedule_details: null,
        locations: {
          name: 'U.S. Shingle and Metal LLC Corporate Office',
          street_address: '3845 Gateway Centre Blvd Ste 300',
          city: 'Pinellas Park',
          state: 'FL',
          zip: '33635',
          phone: null,
          contact_info: null,
          schedule_template: null,
        },
      }
      setTrainee({
        id: 'demo',
        first_name: 'Sample',
        last_name: 'Attendee',
        email: '',
        phone: '555-555-1234',
        years_in_sales: '',
        street_address: '',
        city: '',
        state: '',
        zip: '',
        registered: false,
        classes: demoClass,
      })
      setClassInfo(demoClass)
      setLocation(demoClass.locations)
      setForm({
        first_name: 'Sample',
        last_name: 'Attendee',
        email: '',
        years_in_sales: '',
        street_address: '',
        city: '',
        state: '',
        zip: '',
      })
      setStatus('form')
      return
    }
    const { data, error } = await supabase
      .from('trainees')
      .select(
        'id, first_name, last_name, email, phone, years_in_sales, street_address, city, state, zip, registered, declined_at, classes!class_id(id, week_start_date, week_end_date, schedule_details, locations(name, street_address, city, state, zip, phone, contact_info, schedule_template))',
      )
      .eq('registration_token', token)
      .maybeSingle()

    if (error || !data) {
      setStatus('not_found')
      return
    }

    setTrainee(data)
    setClassInfo(data.classes || null)
    setLocation(data.classes?.locations || null)
    setForm({
      first_name: data.first_name || '',
      last_name: data.last_name || '',
      email: data.email || '',
      years_in_sales: data.years_in_sales || '',
      street_address: data.street_address || '',
      city: data.city || '',
      state: data.state || '',
      zip: data.zip || '',
    })
    if (data.declined_at) {
      setStatus('declined')
    } else if (data.registered) {
      setStatus('done')
    } else {
      setStatus('form')
    }
  }

  async function submitDecline() {
    setStatus('declining')
    setErrorMsg(null)
    // Demo mode short-circuit
    if (token === 'demo') {
      setShowDeclineModal(false)
      setStatus('declined')
      return
    }
    try {
      const res = await fetch('/.netlify/functions/decline-registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registration_token: token,
          reason: declineReason.trim() || null,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) {
        setErrorMsg(json.error || 'Something went wrong. Please try again or call us.')
        setStatus('form')
        return
      }
      setShowDeclineModal(false)
      setStatus('declined')
    } catch (err) {
      setErrorMsg(err.message || 'Network error. Please try again or call us.')
      setStatus('form')
    }
  }

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function submit(e) {
    e.preventDefault()
    setErrorMsg(null)

    if (!form.first_name.trim() || !form.last_name.trim()) {
      setErrorMsg('Please confirm your first and last name.')
      return
    }
    if (!form.email.trim()) {
      setErrorMsg('Please enter your personal email address.')
      return
    }
    // Light shape check — real validation is the browser's type="email" + DB.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setErrorMsg('That email doesn\'t look right — please double-check it.')
      return
    }
    if (!form.years_in_sales) {
      setErrorMsg('Please pick your years in sales.')
      return
    }
    const requiredAddress = ['street_address', 'city', 'state', 'zip']
    for (const f of requiredAddress) {
      if (!form[f].trim()) {
        setErrorMsg('Please fill in your full home address.')
        return
      }
    }

    setStatus('submitting')
    // Demo mode short-circuit — show the "done" state without touching the DB.
    if (token === 'demo') {
      setStatus('done')
      return
    }
    const { error } = await supabase
      .from('trainees')
      .update({
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email: form.email.trim(),
        years_in_sales: form.years_in_sales,
        street_address: form.street_address.trim(),
        city: form.city.trim(),
        state: form.state.trim().toUpperCase(),
        zip: form.zip.trim(),
        registered: true,
        registered_at: new Date().toISOString(),
      })
      .eq('registration_token', token)

    if (error) {
      setErrorMsg(error.message)
      setStatus('form')
      return
    }
    setStatus('done')
  }

  if (status === 'loading') {
    return <Centered><p className="text-slate-500">Loading…</p></Centered>
  }

  if (status === 'not_found') {
    return (
      <Centered>
        <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center">
          <h1 className="text-2xl font-semibold text-red-900">Registration link not found</h1>
          <p className="mt-2 text-red-800">
            This link may have expired or been mistyped. Please check the text message you received,
            or contact your hiring manager.
          </p>
        </div>
      </Centered>
    )
  }

  return (
    <Centered>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Welcome{form.first_name ? `, ${form.first_name}` : ''}!
          </h1>
          <p className="mt-2 text-slate-600">
            {status === 'done'
              ? "You're all set. Here are your training details."
              : 'Please confirm a few details to complete your registration.'}
          </p>
        </div>

        {/* Class details card */}
        {classInfo && (
          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm space-y-3">
            <h2 className="text-lg font-semibold">Your training week</h2>
            <dl className="space-y-2 text-sm">
              <Row label="Location">
                <div className="font-medium text-slate-900">{location?.name}</div>
                {location && <div className="text-slate-600">{formatAddress(location)}</div>}
              </Row>
              <Row label="Dates">
                <span>
                  {formatDate(classInfo.week_start_date)} – {formatDate(classInfo.week_end_date)}
                </span>
              </Row>
              {(classInfo.schedule_details || location?.schedule_template) && (
                <Row label="Schedule">
                  <span className="whitespace-pre-line">{classInfo.schedule_details || location.schedule_template}</span>
                </Row>
              )}
              {location?.phone && <Row label="Phone">{location.phone}</Row>}
              {location?.contact_info && <Row label="Contact">{location.contact_info}</Row>}
            </dl>
          </div>
        )}

        {status === 'done' ? (
          <div className="rounded-lg border border-green-200 bg-green-50 p-6 text-center">
            <h2 className="text-lg font-semibold text-green-900">Registration confirmed</h2>
            <p className="mt-1 text-sm text-green-800">
              You'll receive a reminder text the morning of each training day.
            </p>
          </div>
        ) : status === 'declined' ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center">
            <h2 className="text-lg font-semibold text-slate-900">Thanks for letting us know.</h2>
            <p className="mt-2 text-sm text-slate-700">
              We've marked you as not attending and removed you from automated reminders. If you
              change your mind, please call us at <strong>(727) 761-5200</strong>.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            <h2 className="text-lg font-semibold">Your details</h2>

            <div className="grid gap-4 sm:grid-cols-6">
              <div className="sm:col-span-6">
                <h3 className="text-sm font-semibold text-slate-800">Confirm the spelling of your name</h3>
                <p className="mt-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <strong>Important:</strong> Your name will be used to set up your work email, CRM
                  access, and other company accounts. Please make sure it's spelled exactly the way you
                  want it to appear on official records.
                </p>
              </div>

              <Field label="First name" className="sm:col-span-3">
                <input
                  type="text"
                  required
                  value={form.first_name}
                  onChange={(e) => updateField('first_name', e.target.value)}
                  className={inputCls}
                  autoComplete="given-name"
                />
              </Field>
              <Field label="Last name" className="sm:col-span-3">
                <input
                  type="text"
                  required
                  value={form.last_name}
                  onChange={(e) => updateField('last_name', e.target.value)}
                  className={inputCls}
                  autoComplete="family-name"
                />
              </Field>

              <Field
                label="Personal email"
                className="sm:col-span-6"
                hint="We'll send your post-test review email here, plus class reminders. Use one you actually check."
              >
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => updateField('email', e.target.value)}
                  className={inputCls}
                  autoComplete="email"
                  placeholder="you@example.com"
                />
              </Field>

              <Field label="How many years have you been in sales?" className="sm:col-span-6">
                <select
                  required
                  value={form.years_in_sales}
                  onChange={(e) => updateField('years_in_sales', e.target.value)}
                  className={inputCls}
                >
                  <option value="">— Select —</option>
                  {YEARS_IN_SALES_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </Field>

              <div className="sm:col-span-6">
                <h3 className="text-sm font-semibold text-slate-800">Your home address</h3>
                <p className="text-xs text-slate-500">For training records and any mailed materials.</p>
              </div>

              <Field label="Street address" className="sm:col-span-6">
                <input
                  type="text"
                  required
                  value={form.street_address}
                  onChange={(e) => updateField('street_address', e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="City" className="sm:col-span-3">
                <input
                  type="text"
                  required
                  value={form.city}
                  onChange={(e) => updateField('city', e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="State" className="sm:col-span-2">
                <select
                  required
                  value={form.state}
                  onChange={(e) => updateField('state', e.target.value)}
                  className={inputCls}
                >
                  <option value="">— Select —</option>
                  {US_STATES.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.code} — {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Zip" className="sm:col-span-1">
                <input
                  type="text"
                  required
                  inputMode="numeric"
                  pattern={ZIP_PATTERN}
                  maxLength={10}
                  value={form.zip}
                  onChange={(e) => updateField('zip', e.target.value)}
                  className={inputCls}
                  title="5-digit zip, optionally followed by -4 digits"
                />
              </Field>
            </div>

            {errorMsg && (
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {errorMsg}
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={status === 'submitting'}
                className="rounded-md bg-brand-navy px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-navy-dark disabled:opacity-50"
              >
                {status === 'submitting' ? 'Submitting…' : 'Confirm registration'}
              </button>
            </div>
          </form>
        )}

        {/* Decline / can't-attend link. Intentionally placed below the form
            and styled small — visible to people who need it without
            tempting people who would otherwise register. */}
        {status === 'form' && (
          <div className="text-center">
            <button
              type="button"
              onClick={() => {
                setDeclineReason('')
                setShowDeclineModal(true)
              }}
              className="text-sm text-slate-500 underline hover:text-slate-700"
            >
              Can't make it? Let us know →
            </button>
          </div>
        )}
      </div>

      {showDeclineModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-2xl">
            <h2 className="text-lg font-semibold text-slate-900">
              Let us know if you can't attend
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              This will tell the team you're not taking this training. You won't get any more
              texts about it. If you change your mind, please call us at{' '}
              <strong>(727) 761-5200</strong>.
            </p>
            <label className="mt-4 block text-sm font-medium text-slate-700">
              Briefly tell us why? <span className="text-slate-400">(optional)</span>
              <textarea
                rows={3}
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                placeholder="e.g. got another job, schedule conflict, changed my mind…"
                maxLength={1000}
              />
            </label>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setShowDeclineModal(false)}
                disabled={status === 'declining'}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitDecline}
                disabled={status === 'declining'}
                className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
              >
                {status === 'declining' ? 'Saving…' : "Yes, I'm not attending"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Centered>
  )
}

function Centered({ children }) {
  return <div className="mx-auto max-w-2xl">{children}</div>
}

function Row({ label, children }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 text-slate-700">
      <dt className="font-medium text-slate-500">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function Field({ label, children, className = '', hint = null }) {
  return (
    <label className={`block text-sm font-medium text-slate-700 ${className}`}>
      {label}
      {children}
      {hint && <span className="mt-1 block text-xs font-normal text-slate-500">{hint}</span>}
    </label>
  )
}

function formatDate(iso) {
  if (!iso) return ''
  // iso is YYYY-MM-DD — parse as local date to avoid timezone shifts
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

const inputCls =
  'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500'
