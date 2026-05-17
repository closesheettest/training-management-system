import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { US_STATES, ZIP_PATTERN, FL_REGIONS } from '../lib/locations.js'

// Public self-service page for sales reps to update their personal
// email + home address. Reached via a tap-friendly link texted from
// the Group Messages page (and editable as a template at
// /message-templates).
//
// Token-gated like the other trainee-facing pages — each rep has a
// unique registration_token. Pre-fills with whatever's already on
// file so they just confirm or correct.
//
// Doesn't ask for phone or name (those came in via the CSV import
// and we trust them). Only the fields that are commonly stale or
// missing for a freshly-imported rep.

export default function UpdateInfo() {
  const { token } = useParams()
  const [status, setStatus] = useState('loading') // loading | not_found | form | submitting | done
  const [errorMsg, setErrorMsg] = useState(null)
  const [trainee, setTrainee] = useState(null)
  const [form, setForm] = useState({
    email: '',
    region: '',
    street_address: '',
    city: '',
    state: '',
    zip: '',
  })

  useEffect(() => {
    if (!token) {
      setStatus('not_found')
      return
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  async function load() {
    setStatus('loading')
    if (token === 'demo') {
      setTrainee({ first_name: 'Sample', last_name: 'Attendee' })
      setForm({
        email: '',
        region: '',
        street_address: '',
        city: 'St. Petersburg',
        state: 'FL',
        zip: '33701',
      })
      setStatus('form')
      return
    }
    const { data, error } = await supabase
      .from('trainees')
      .select('id, first_name, last_name, email, region, street_address, city, state, zip')
      .eq('registration_token', token)
      .maybeSingle()
    if (error || !data) {
      setStatus('not_found')
      return
    }
    setTrainee(data)
    setForm({
      email: data.email || '',
      region: data.region || '',
      street_address: data.street_address || '',
      city: data.city || '',
      state: data.state || '',
      zip: data.zip || '',
    })
    setStatus('form')
  }

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function submit(e) {
    e.preventDefault()
    setErrorMsg(null)

    if (!form.email.trim()) {
      setErrorMsg('Please enter your personal email address.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setErrorMsg("That email doesn't look right — please double-check it.")
      return
    }
    if (!form.region) {
      setErrorMsg('Please pick the region closest to where you live.')
      return
    }
    const addressFields = ['street_address', 'city', 'state', 'zip']
    for (const f of addressFields) {
      if (!form[f].trim()) {
        setErrorMsg('Please fill in your full home address.')
        return
      }
    }

    setStatus('submitting')
    if (token === 'demo') {
      setStatus('done')
      return
    }
    const patch = {
      email: form.email.trim(),
      region: form.region,
      street_address: form.street_address.trim(),
      city: form.city.trim(),
      state: form.state.trim().toUpperCase(),
      zip: form.zip.trim(),
      // Stamps the "responded to update-info blast" timestamp so
      // /active-reps can show "Updated X days ago" and filter out
      // people who still haven't filled in the form. Re-submissions
      // refresh the timestamp, which is what we want — most recent
      // self-served update wins.
      info_updated_at: new Date().toISOString(),
    }
    // Step 1 — update the row matching the token (the canonical record).
    const { error } = await supabase
      .from('trainees')
      .update(patch)
      .eq('registration_token', token)
    if (error) {
      setErrorMsg(error.message)
      setStatus('form')
      return
    }
    // Step 2 — dedup sync. If this trainee has duplicate rows in the
    // system (same person showed up in multiple imports / classes),
    // they share a phone number. Find every OTHER trainee row with
    // the same normalized phone and apply the same patch — that way
    // one form submit marks all of the person's records as updated,
    // not just the one tied to the SMS link they happened to tap.
    // Best-effort: if it fails, the canonical row update above
    // already succeeded so we don't surface an error to the trainee.
    if (trainee?.id) {
      const me = await supabase
        .from('trainees')
        .select('phone')
        .eq('id', trainee.id)
        .maybeSingle()
      const myPhoneDigits = (me?.data?.phone || '').replace(/\D/g, '')
      if (myPhoneDigits.length >= 7) {
        const { data: dupes } = await supabase
          .from('trainees')
          .select('id, phone')
          .neq('id', trainee.id)
        const matchingIds = (dupes || [])
          .filter((d) => (d.phone || '').replace(/\D/g, '') === myPhoneDigits)
          .map((d) => d.id)
        if (matchingIds.length > 0) {
          // Don't overwrite the dupe's email if it already has a
          // company_email — but DO refresh info_updated_at + address
          // + region so all rows reflect the rep's latest info.
          await supabase
            .from('trainees')
            .update(patch)
            .in('id', matchingIds)
        }
      }
    }
    // Step 3 — fire-and-forget geocode call so the Sales Team Map shows
    // this rep at their actual home. Best-effort: if Nominatim is down
    // or the address doesn't match cleanly, the rep still falls back to
    // their region's metro center on the map. Doesn't block the form's
    // success transition.
    if (trainee?.id) {
      fetch('/.netlify/functions/geocode-trainee', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trainee_id: trainee.id }),
      }).catch(() => {})
    }
    setStatus('done')
  }

  if (status === 'loading') return <p className="text-sm text-slate-500">Loading…</p>
  if (status === 'not_found') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center">
        <h1 className="text-2xl font-semibold text-red-900">Link not found</h1>
        <p className="mt-2 text-red-800">
          This update link may have expired or been mistyped. Please check the text message you
          received, or contact your trainer.
        </p>
      </div>
    )
  }
  if (status === 'done') {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-8 text-center">
        <h1 className="text-2xl font-semibold text-green-900">Got it — thanks!</h1>
        <p className="mt-2 text-green-800">
          Your info is updated. You can close this page.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">
          Update your info{trainee?.first_name ? `, ${trainee.first_name}` : ''}
        </h1>
        <p className="mt-2 text-slate-600">
          We're keeping our records current in the new training system. Take 30 seconds to
          confirm or correct your personal email, region, and home address below.
        </p>
      </header>

      <form
        onSubmit={submit}
        className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm space-y-4"
      >
        <label className="block text-sm font-medium text-slate-700">
          Personal email
          <input
            type="email"
            value={form.email}
            onChange={(e) => update('email', e.target.value)}
            required
            placeholder="you@example.com"
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            autoComplete="email"
          />
          <span className="mt-1 block text-xs text-slate-500">
            Your personal address — not your @shingleusa.com one. We use this for things like
            review-request emails and class reminders.
          </span>
        </label>

        <div className="border-t border-slate-200 pt-4">
          <label className="block text-sm font-medium text-slate-700">
            Region closest to where you live
            <select
              value={form.region}
              onChange={(e) => update('region', e.target.value)}
              required
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">— Pick your region —</option>
              {FL_REGIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-slate-500">
              Pick the area you live or work closest to. This is how we route regional manager
              messages and meeting reminders — pick the wrong one and you'll miss texts about
              your area's meetings.
            </span>
          </label>
        </div>

        <div className="border-t border-slate-200 pt-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Home address
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-6">
            <label className="sm:col-span-6 block text-sm font-medium text-slate-700">
              Street address
              <input
                type="text"
                value={form.street_address}
                onChange={(e) => update('street_address', e.target.value)}
                required
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                autoComplete="street-address"
              />
            </label>
            <label className="sm:col-span-3 block text-sm font-medium text-slate-700">
              City
              <input
                type="text"
                value={form.city}
                onChange={(e) => update('city', e.target.value)}
                required
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                autoComplete="address-level2"
              />
            </label>
            <label className="sm:col-span-1 block text-sm font-medium text-slate-700">
              State
              <select
                value={form.state}
                onChange={(e) => update('state', e.target.value)}
                required
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">—</option>
                {US_STATES.map((s) => (
                  <option key={s.code} value={s.code}>{s.code}</option>
                ))}
              </select>
            </label>
            <label className="sm:col-span-2 block text-sm font-medium text-slate-700">
              Zip
              <input
                type="text"
                value={form.zip}
                onChange={(e) => update('zip', e.target.value)}
                required
                pattern={ZIP_PATTERN}
                title="5-digit zip, optionally followed by -4 digits"
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                autoComplete="postal-code"
              />
            </label>
          </div>
        </div>

        {errorMsg && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {errorMsg}
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={status === 'submitting'}
            className="rounded-md bg-brand-navy px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-navy-dark disabled:opacity-50"
          >
            {status === 'submitting' ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      </form>
    </div>
  )
}
