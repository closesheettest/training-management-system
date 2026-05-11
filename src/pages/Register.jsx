import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { US_STATES, formatAddress, ZIP_PATTERN } from '../lib/locations.js'

export default function Register() {
  const { token } = useParams()
  const [status, setStatus] = useState('loading') // loading | not_found | form | submitting | done
  const [trainee, setTrainee] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [location, setLocation] = useState(null)
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    street_address: '',
    city: '',
    state: '',
    zip: '',
  })
  const [errorMsg, setErrorMsg] = useState(null)

  useEffect(() => {
    if (!token) {
      setStatus('not_found')
      return
    }
    load()
  }, [token])

  async function load() {
    setStatus('loading')
    const { data, error } = await supabase
      .from('trainees')
      .select(
        'id, first_name, last_name, email, phone, street_address, city, state, zip, registered, classes(id, week_start_date, week_end_date, schedule_details, locations(name, street_address, city, state, zip, phone, contact_info, schedule_template))',
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
      street_address: data.street_address || '',
      city: data.city || '',
      state: data.state || '',
      zip: data.zip || '',
    })
    setStatus(data.registered ? 'done' : 'form')
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
    const requiredAddress = ['street_address', 'city', 'state', 'zip']
    for (const f of requiredAddress) {
      if (!form[f].trim()) {
        setErrorMsg('Please fill in your full home address.')
        return
      }
    }

    setStatus('submitting')
    const { error } = await supabase
      .from('trainees')
      .update({
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email: form.email.trim() || null,
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

              <Field label="Email (optional but recommended)" className="sm:col-span-6">
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => updateField('email', e.target.value)}
                  className={inputCls}
                  autoComplete="email"
                />
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
                className="rounded-md bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
              >
                {status === 'submitting' ? 'Submitting…' : 'Confirm registration'}
              </button>
            </div>
          </form>
        )}
      </div>
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

function Field({ label, children, className = '' }) {
  return (
    <label className={`block text-sm font-medium text-slate-700 ${className}`}>
      {label}
      {children}
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
