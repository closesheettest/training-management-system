import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { formatAddress, FL_REGIONS, US_STATES, ZIP_PATTERN, YEARS_IN_SALES_OPTIONS } from '../lib/locations.js'
import { formatDateRange } from '../lib/dates.js'

export default function ClassDetail() {
  const { id } = useParams()
  const [cls, setCls] = useState(null)
  const [trainees, setTrainees] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [sending, setSending] = useState(null) // null | 'all' | trainee_id
  const [editingLocation, setEditingLocation] = useState(false)
  const [locationDraft, setLocationDraft] = useState('')
  const [editingWeek, setEditingWeek] = useState(false)
  const [weekDraft, setWeekDraft] = useState({ start: '', end: '', schedule: '' })
  const [editingTraineeId, setEditingTraineeId] = useState(null)
  const [traineeDraft, setTraineeDraft] = useState(null)
  const [addingTrainee, setAddingTrainee] = useState(false)
  const [newTraineeDraft, setNewTraineeDraft] = useState(blankTrainee())
  const [startingTest, setStartingTest] = useState(false)

  useEffect(() => {
    load()
    loadLocations()
  }, [id])

  async function load() {
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('classes')
      .select(
        'id, region, week_start_date, week_end_date, location_id, schedule_details, day_2_it_notified_at, it_completed_at, locations(*), trainees(*, attendance(attendance_date, confirmed)), test_attempts(*)',
      )
      .eq('id', id)
      .maybeSingle()
    if (err) {
      setError(err.message)
    } else if (!data) {
      setError('Class not found.')
    } else {
      setCls(data)
      setTrainees((data.trainees || []).sort(byName))
      setLocationDraft(data.location_id || '')
    }
    setLoading(false)
  }

  async function loadLocations() {
    const { data } = await supabase
      .from('locations')
      .select('id, name, region, street_address, city, state, zip')
      .order('name', { ascending: true })
    setLocations(data || [])
  }

  async function saveLocation() {
    setMessage(null)
    const { error: err } = await supabase
      .from('classes')
      .update({ location_id: locationDraft || null })
      .eq('id', id)
    if (err) {
      setMessage({ type: 'error', text: err.message })
      return
    }
    setEditingLocation(false)
    load()
  }

  async function updateRegion(newRegion) {
    setMessage(null)
    const { error: err } = await supabase
      .from('classes')
      .update({ region: newRegion, location_id: null })
      .eq('id', id)
    if (err) {
      setMessage({ type: 'error', text: err.message })
      return
    }
    load()
  }

  function startEditWeek() {
    setWeekDraft({
      start: cls?.week_start_date || '',
      end: cls?.week_end_date || '',
      schedule: cls?.schedule_details || '',
    })
    setEditingWeek(true)
    setMessage(null)
  }

  function cancelEditWeek() {
    setEditingWeek(false)
  }

  async function saveWeek() {
    setMessage(null)
    if (!weekDraft.start || !weekDraft.end) {
      setMessage({ type: 'error', text: 'Both start and end dates are required.' })
      return
    }
    if (weekDraft.end < weekDraft.start) {
      setMessage({ type: 'error', text: 'End date must be on or after the start date.' })
      return
    }
    const { error: err } = await supabase
      .from('classes')
      .update({
        week_start_date: weekDraft.start,
        week_end_date: weekDraft.end,
        schedule_details: weekDraft.schedule.trim() || null,
      })
      .eq('id', id)
    if (err) {
      setMessage({ type: 'error', text: err.message })
      return
    }
    setEditingWeek(false)
    setMessage({ type: 'success', text: 'Class week updated.' })
    load()
  }

  function startEditTrainee(t) {
    setEditingTraineeId(t.id)
    setTraineeDraft({
      first_name: t.first_name || '',
      last_name: t.last_name || '',
      phone: t.phone || '',
      email: t.email || '',
      needs_hotel: !!t.needs_hotel,
      years_in_sales: t.years_in_sales || '',
      street_address: t.street_address || '',
      city: t.city || '',
      state: t.state || '',
      zip: t.zip || '',
    })
    setMessage(null)
  }

  function cancelEditTrainee() {
    setEditingTraineeId(null)
    setTraineeDraft(null)
  }

  async function saveEditTrainee() {
    if (!traineeDraft) return
    if (!traineeDraft.first_name.trim() || !traineeDraft.last_name.trim() || !traineeDraft.phone.trim()) {
      setMessage({ type: 'error', text: 'First name, last name, and phone are required.' })
      return
    }
    setMessage(null)
    const { error: err } = await supabase
      .from('trainees')
      .update({
        first_name: traineeDraft.first_name.trim(),
        last_name: traineeDraft.last_name.trim(),
        phone: traineeDraft.phone.trim(),
        email: traineeDraft.email.trim() || null,
        needs_hotel: !!traineeDraft.needs_hotel,
        years_in_sales: traineeDraft.years_in_sales || null,
        street_address: traineeDraft.street_address.trim() || null,
        city: traineeDraft.city.trim() || null,
        state: traineeDraft.state.trim().toUpperCase() || null,
        zip: traineeDraft.zip.trim() || null,
      })
      .eq('id', editingTraineeId)
    if (err) {
      setMessage({ type: 'error', text: err.message })
      return
    }
    setEditingTraineeId(null)
    setTraineeDraft(null)
    setMessage({
      type: 'success',
      text: 'Trainee updated. If you fixed the phone number, click Send / Resend text to deliver the link to the new number.',
    })
    load()
  }

  async function deleteTrainee(t) {
    if (!confirm(`Delete ${t.first_name} ${t.last_name}? This removes them from the class and any attendance history.`)) return
    setMessage(null)
    const { error: err } = await supabase.from('trainees').delete().eq('id', t.id)
    if (err) {
      setMessage({ type: 'error', text: err.message })
      return
    }
    setMessage({ type: 'success', text: `Removed ${t.first_name} ${t.last_name}.` })
    load()
  }

  async function unenrollTrainee(t) {
    const reason = prompt(
      `Unenroll ${t.first_name} ${t.last_name}? They'll be hidden from the active roster and won't receive further texts. Reason (optional):`,
      '',
    )
    if (reason === null) return // cancelled
    setMessage(null)
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

  async function reenrollTrainee(t) {
    if (!confirm(`Re-enroll ${t.first_name} ${t.last_name}?`)) return
    setMessage(null)
    const { error: err } = await supabase
      .from('trainees')
      .update({ enrolled: true, unenrolled_at: null, unenrolled_reason: null })
      .eq('id', t.id)
    if (err) {
      setMessage({ type: 'error', text: err.message })
      return
    }
    setMessage({ type: 'success', text: `${t.first_name} ${t.last_name} is back in the class.` })
    load()
  }

  function startAddTrainee() {
    setAddingTrainee(true)
    setNewTraineeDraft(blankTrainee())
    setMessage(null)
  }

  function cancelAddTrainee() {
    setAddingTrainee(false)
    setNewTraineeDraft(blankTrainee())
  }

  async function saveNewTrainee() {
    if (!newTraineeDraft.first_name.trim() || !newTraineeDraft.last_name.trim() || !newTraineeDraft.phone.trim()) {
      setMessage({ type: 'error', text: 'First name, last name, and phone are required.' })
      return
    }
    setMessage(null)
    const { error: err } = await supabase.from('trainees').insert({
      class_id: id,
      first_name: newTraineeDraft.first_name.trim(),
      last_name: newTraineeDraft.last_name.trim(),
      phone: newTraineeDraft.phone.trim(),
      email: newTraineeDraft.email.trim() || null,
      needs_hotel: !!newTraineeDraft.needs_hotel,
    })
    if (err) {
      setMessage({ type: 'error', text: err.message })
      return
    }
    setAddingTrainee(false)
    setNewTraineeDraft(blankTrainee())
    setMessage({ type: 'success', text: 'Trainee added. They appear under "Not sent yet" — send their text when ready.' })
    load()
  }

  async function sendDay2ItReminder() {
    if (
      !confirm(
        `Send the day-2 IT reminder text now?\n\n` +
          `This goes to every active recipient subscribed to "Day 2 reminder — IT, please create emails" in /notifications. ` +
          `The text includes a link to this class's Provision page.`,
      )
    ) {
      return
    }
    setMessage(null)
    try {
      const res = await fetch('/.netlify/functions/force-notify-it-provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ class_id: cls.id }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 404) {
          setMessage({
            type: 'error',
            text: 'SMS endpoint is only available on the deployed Netlify site — not in local npm run dev.',
          })
          return
        }
        throw new Error(body.error || `Request failed: ${res.status}`)
      }
      if (body.recipient_count === 0) {
        setMessage({
          type: 'error',
          text:
            body.warning ||
            'No IT subscribers found. Go to /notifications and subscribe at least one recipient to the day-2 event.',
        })
        return
      }
      setMessage({
        type: 'success',
        text: `Sent day-2 IT reminder to ${body.sent_count} of ${body.recipient_count} subscriber${body.recipient_count === 1 ? '' : 's'}.`,
      })
      load()
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Something went wrong.' })
    }
  }

  async function sendCredentialsToTrainees() {
    const today = todayLocalIso()
    const unsent = (cls?.trainees || []).filter((t) => {
      if (t.enrolled === false) return false
      if (!t.company_email) return false
      if (t.credentials_sent_at) return false
      // Must have a confirmed attendance record for today — no-shows are skipped.
      return (t.attendance || []).some((a) => a.confirmed && a.attendance_date === today)
    })
    if (unsent.length === 0) {
      setMessage({
        type: 'error',
        text:
          'Nobody to text right now. The button only sends to trainees who have a confirmed attendance for today AND are provisioned AND haven\'t already been texted.',
      })
      return
    }
    if (
      !confirm(
        `Send credentials text to ${unsent.length} trainee${unsent.length === 1 ? '' : 's'} who attended today?\n\n` +
          `Each trainee gets a personal link with their company email + password and step-by-step iPhone/Android setup. ` +
          `Anyone who didn't sign in today OR already received their text is skipped.`,
      )
    ) {
      return
    }
    setMessage(null)
    try {
      const res = await fetch('/.netlify/functions/send-credentials-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          class_id: cls.id,
          trainee_ids: unsent.map((t) => t.id),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 404) {
          setMessage({
            type: 'error',
            text: 'SMS endpoint is only available on the deployed Netlify site — not in local npm run dev.',
          })
          return
        }
        throw new Error(body.error || `Request failed: ${res.status}`)
      }
      const successes = (body.results || []).filter((r) => r.success).length
      const failures = (body.results || []).filter((r) => !r.success)
      if (failures.length === 0) {
        setMessage({
          type: 'success',
          text: `Sent credentials text to ${successes} trainee${successes === 1 ? '' : 's'}.`,
        })
      } else {
        setMessage({
          type: 'error',
          text: `Sent ${successes}, failed ${failures.length}. First error: ${failures[0].error}`,
        })
      }
      load()
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Something went wrong.' })
    }
  }

  async function startFinalTest() {
    if (!confirm('Send the final-test link via SMS to every enrolled, registered trainee in this class?')) return
    setMessage(null)
    setStartingTest(true)
    try {
      const res = await fetch('/.netlify/functions/send-final-test-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ class_id: cls.id }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        const errMsg =
          res.status === 404
            ? "SMS only works on the deployed Netlify site — not in local 'npm run dev'."
            : body.error || `Request failed: ${res.status}`
        setMessage({ type: 'error', text: errMsg })
        return
      }
      const failures = (body.results || []).filter((r) => !r.success)
      const successes = (body.results || []).filter((r) => r.success).length
      if (failures.length === 0) {
        setMessage({
          type: 'success',
          text: `Sent ${successes} final-test text${successes === 1 ? '' : 's'}.`,
        })
      } else {
        setMessage({
          type: 'error',
          text: `Sent ${successes}, failed ${failures.length}. First error: ${failures[0].error}`,
        })
      }
      load()
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Network error' })
    } finally {
      setStartingTest(false)
    }
  }

  async function sendSms(traineeIds, label) {
    setMessage(null)
    setSending(label)
    try {
      const res = await fetch('/.netlify/functions/send-registration-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trainee_ids: traineeIds }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        const errMsg =
          res.status === 404
            ? "SMS only works on the deployed Netlify site — not in local 'npm run dev'."
            : body.error || `Request failed: ${res.status}`
        setMessage({ type: 'error', text: errMsg })
        return
      }
      const failures = (body.results || []).filter((r) => !r.success)
      const successes = (body.results || []).filter((r) => r.success).length
      if (failures.length === 0) {
        setMessage({ type: 'success', text: `Sent ${successes} text${successes === 1 ? '' : 's'}.` })
      } else {
        setMessage({
          type: 'error',
          text: `Sent ${successes}, failed ${failures.length}. First error: ${failures[0].error}`,
        })
      }
      load() // refresh statuses (last_sms_sent_at from DB)
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Network error' })
    } finally {
      setSending(null)
    }
  }

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>
  if (error)
    return (
      <div className="space-y-4">
        <BackLink />
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      </div>
    )
  if (!cls) return null

  const enrolled = trainees.filter((t) => t.enrolled !== false)
  const unenrolled = trainees.filter((t) => t.enrolled === false)
  const registered = enrolled.filter((t) => t.registered)
  const sentNoResponse = enrolled.filter((t) => !t.registered && t.last_sms_sent_at)
  const notSent = enrolled.filter((t) => !t.registered && !t.last_sms_sent_at)
  const isTBD = !cls.locations
  const unsentIds = enrolled.filter((t) => !t.registered).map((t) => t.id)

  const attemptsByTrainee = Object.fromEntries(
    (cls.test_attempts || []).map((a) => [a.trainee_id, a]),
  )
  const summary = computeSummary(enrolled, attemptsByTrainee)

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackLink />
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={startFinalTest}
            disabled={startingTest}
            className="rounded-md border border-brand-red bg-white px-3 py-1.5 text-xs font-semibold text-brand-red hover:bg-brand-red hover:text-white disabled:opacity-50"
            title="Send the final assessment SMS to every enrolled, registered trainee"
          >
            {startingTest ? 'Sending…' : 'Start final test →'}
          </button>
          <Link
            to={`/provision/${cls.id}`}
            className="rounded-md border border-brand-navy bg-white px-3 py-1.5 text-xs font-semibold text-brand-navy hover:bg-brand-navy hover:text-white"
          >
            Provision emails →
          </Link>
          <Link
            to={`/kiosk/${cls.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-brand-navy bg-white px-3 py-1.5 text-xs font-semibold text-brand-navy hover:bg-brand-navy hover:text-white"
          >
            Open kiosk →
          </Link>
        </div>
      </div>

      {/* Header */}
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            {cls.locations?.name || `${cls.region || 'Region'} — TBD`}
          </h1>
          {cls.region && (
            <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-medium text-sky-800">
              {cls.region}
            </span>
          )}
          {isTBD && (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
              Location TBD
            </span>
          )}
        </div>
        <p className="mt-2 text-slate-600">
          {formatDateRange(cls.week_start_date, cls.week_end_date)}
          {cls.locations?.street_address && <> · {formatAddress(cls.locations)}</>}
        </p>
      </header>

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

      <ProvisioningWorkflowCard
        cls={cls}
        onSendDay2={sendDay2ItReminder}
        onSendCredentials={sendCredentialsToTrainees}
      />

      <RosterSummary summary={summary} />

      {summary.testSubmitted > 0 && (
        <TestResults trainees={enrolled} attemptsByTrainee={attemptsByTrainee} />
      )}

      {/* Class week (dates + schedule) — editable inline */}
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Class week</h2>
          {!editingWeek && (
            <button
              type="button"
              onClick={startEditWeek}
              className="text-xs font-medium text-slate-600 underline hover:text-slate-900"
            >
              Change dates / schedule
            </button>
          )}
        </div>
        {editingWeek ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-slate-700">
              Start date (day 1)
              <input
                type="date"
                value={weekDraft.start}
                onChange={(e) => setWeekDraft((d) => ({ ...d, start: e.target.value }))}
                className={inputCls}
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              End date (last day)
              <input
                type="date"
                value={weekDraft.end}
                onChange={(e) => setWeekDraft((d) => ({ ...d, end: e.target.value }))}
                className={inputCls}
              />
            </label>
            <label className="sm:col-span-2 block text-sm font-medium text-slate-700">
              Schedule details (optional)
              <textarea
                rows={3}
                value={weekDraft.schedule}
                onChange={(e) => setWeekDraft((d) => ({ ...d, schedule: e.target.value }))}
                placeholder="Daily schedule, agenda, hotel info, anything trainees should know."
                className={inputCls}
              />
            </label>
            <div className="sm:col-span-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={cancelEditWeek}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveWeek}
                className="rounded-md bg-brand-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-navy-dark"
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2 text-sm text-slate-700">
            <p className="font-medium">{formatDateRange(cls.week_start_date, cls.week_end_date)}</p>
            {cls.schedule_details ? (
              <pre className="whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 font-sans text-xs text-slate-600">
                {cls.schedule_details}
              </pre>
            ) : (
              <p className="text-xs text-slate-500 italic">
                No schedule details yet. Click "Change dates / schedule" to add hotel info, daily
                agenda, etc.
              </p>
            )}
          </div>
        )}
      </section>

      {/* Region + training location controls */}
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <h2 className="text-lg font-semibold">Location</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-sm font-medium text-slate-700">Region</label>
            <select
              value={cls.region || ''}
              onChange={(e) => updateRegion(e.target.value)}
              className={inputCls}
            >
              <option value="">— Select —</option>
              {FL_REGIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">Changing the region clears the training location.</p>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-slate-700">Training location</label>
              {!editingLocation && (
                <button
                  type="button"
                  onClick={() => setEditingLocation(true)}
                  className="text-xs font-medium text-slate-600 underline hover:text-slate-900"
                >
                  {isTBD ? 'Assign location' : 'Change'}
                </button>
              )}
            </div>
            {editingLocation ? (
              <div className="mt-1 space-y-2">
                <select
                  value={locationDraft}
                  onChange={(e) => setLocationDraft(e.target.value)}
                  className={inputCls}
                >
                  <option value="">TBD (location not assigned yet)</option>
                  {locations
                    .filter((l) => !cls.region || l.region === cls.region)
                    .map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name} — {formatAddress(loc)}
                      </option>
                    ))}
                </select>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingLocation(false)
                      setLocationDraft(cls.location_id || '')
                    }}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={saveLocation}
                    className="rounded-md bg-brand-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-navy-dark"
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-1 text-sm text-slate-600">
                {cls.locations?.name || <em className="text-amber-700">TBD — not assigned yet</em>}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Quick actions */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex-1 text-sm text-slate-700">
          {unsentIds.length > 0 ? (
            <><strong>{unsentIds.length}</strong> trainee{unsentIds.length === 1 ? '' : 's'} haven't registered yet.</>
          ) : (
            'All trainees have registered.'
          )}
        </div>
        <button
          onClick={startAddTrainee}
          disabled={addingTrainee}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          + Add trainee
        </button>
        {unsentIds.length > 0 && (
          <button
            onClick={() => sendSms(unsentIds, 'all')}
            disabled={sending !== null}
            className="rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-navy-dark disabled:opacity-50"
          >
            {sending === 'all' ? 'Sending…' : `Send / resend to all ${unsentIds.length}`}
          </button>
        )}
      </div>

      {addingTrainee && (
        <section className="rounded-lg border border-slate-200 bg-slate-50 p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Add trainee</h2>
          <TraineeForm
            value={newTraineeDraft}
            onChange={setNewTraineeDraft}
            onSave={saveNewTrainee}
            onCancel={cancelAddTrainee}
            saveLabel="Add trainee"
          />
        </section>
      )}

      {/* Trainee status groups */}
      {[
        { title: 'Registered', emoji: '✅', color: 'green', items: registered, empty: 'No trainees have completed registration yet.', showResend: true },
        { title: 'Sent, no response', emoji: '⚠️', color: 'amber', items: sentNoResponse, empty: 'No trainees in this state.' },
        { title: 'Not sent yet', emoji: '⚪', color: 'slate', items: notSent, empty: 'All trainees have been sent their link.' },
      ].map((group) => (
        <TraineeGroup
          key={group.title}
          title={group.title}
          emoji={group.emoji}
          color={group.color}
          trainees={group.items}
          empty={group.empty}
          sending={sending}
          showResend={group.showResend}
          onSend={(tid) => sendSms([tid], tid)}
          editingTraineeId={editingTraineeId}
          traineeDraft={traineeDraft}
          onStartEdit={startEditTrainee}
          onCancelEdit={cancelEditTrainee}
          onSaveEdit={saveEditTrainee}
          onDraftChange={setTraineeDraft}
          onDelete={deleteTrainee}
          onUnenroll={unenrollTrainee}
        />
      ))}

      {unenrolled.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-slate-50 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-700">
            🚫 Unenrolled <span className="font-normal text-slate-500">({unenrolled.length})</span>
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Removed from active roster — won't get further texts or appear on the provisioning page.
            Re-enroll if needed.
          </p>
          <ul className="mt-4 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
            {unenrolled.map((t) => (
              <li key={t.id} className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="font-medium text-slate-900 line-through opacity-70">
                    {t.first_name} {t.last_name}
                  </div>
                  <div className="text-slate-500">
                    {t.phone}
                    {t.email && ` · ${t.email}`}
                  </div>
                  {t.unenrolled_reason && (
                    <div className="mt-0.5 text-xs text-slate-600">Reason: {t.unenrolled_reason}</div>
                  )}
                  {t.unenrolled_at && (
                    <div className="mt-0.5 text-xs text-slate-400">
                      Unenrolled: {new Date(t.unenrolled_at).toLocaleString()}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => reenrollTrainee(t)}
                    className="rounded-md border border-green-300 bg-white px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-50"
                  >
                    Re-enroll
                  </button>
                  <button
                    onClick={() => deleteTrainee(t)}
                    className="rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function TraineeGroup({
  title,
  emoji,
  color,
  trainees,
  empty,
  sending,
  onSend,
  showResend = false,
  editingTraineeId,
  traineeDraft,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDraftChange,
  onDelete,
  onUnenroll,
}) {
  const palette = {
    green: 'border-green-200 bg-green-50',
    amber: 'border-amber-200 bg-amber-50',
    slate: 'border-slate-200 bg-white',
  }[color] || 'border-slate-200 bg-white'

  return (
    <section className={`rounded-lg border ${palette} p-6 shadow-sm`}>
      <h2 className="text-lg font-semibold">
        {emoji} {title} <span className="text-slate-500 font-normal">({trainees.length})</span>
      </h2>
      {trainees.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">{empty}</p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
          {trainees.map((t) => {
            const isEditing = editingTraineeId === t.id
            return (
              <li key={t.id} className="px-4 py-3 text-sm">
                {isEditing ? (
                  <TraineeForm
                    value={traineeDraft}
                    onChange={onDraftChange}
                    onSave={onSaveEdit}
                    onCancel={onCancelEdit}
                    saveLabel="Save changes"
                  />
                ) : (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900">
                        {t.first_name} {t.last_name}
                      </div>
                      <div className="text-slate-500">
                        {t.phone}
                        {t.email && ` · ${t.email}`}
                      </div>
                      {(t.street_address || t.city || t.state || t.zip) && (
                        <div className="mt-0.5 text-xs text-slate-500">
                          📍 {formatAddress(t)}
                        </div>
                      )}
                      {t.last_sms_sent_at && (
                        <div className="mt-0.5 text-xs text-slate-400">
                          Last text: {new Date(t.last_sms_sent_at).toLocaleString()}
                        </div>
                      )}
                      {t.registered_at && (
                        <div className="mt-0.5 text-xs text-green-700">
                          Registered: {new Date(t.registered_at).toLocaleString()}
                        </div>
                      )}
                      {t.confirmation_status === 'confirmed' && (
                        <div className="mt-0.5 text-xs font-semibold text-green-700">
                          ✅ Confirmed for tomorrow
                        </div>
                      )}
                      {t.confirmation_status === 'declined' && (
                        <div className="mt-0.5 text-xs font-semibold text-red-700">
                          ❌ Declined — can't make it
                        </div>
                      )}
                      {!t.confirmation_status && t.last_reminder_sent_at && (
                        <div className="mt-0.5 text-xs font-semibold text-amber-700">
                          ⏳ Confirmation reminder sent, awaiting reply
                        </div>
                      )}
                      {t.needs_hotel && (
                        <div className="mt-0.5 text-xs font-semibold text-sky-700">
                          🏨 Needs hotel accommodation
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <a
                        href={`${window.location.origin}/register/${t.registration_token}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-slate-500 hover:text-slate-700 hover:underline"
                      >
                        Preview
                      </a>
                      <button
                        onClick={() => onStartEdit(t)}
                        disabled={editingTraineeId !== null}
                        className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => onUnenroll(t)}
                        disabled={editingTraineeId !== null}
                        className="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                        title="Remove from active roster"
                      >
                        Unenroll
                      </button>
                      <button
                        onClick={() => onDelete(t)}
                        disabled={editingTraineeId !== null}
                        className="rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => onSend(t.id)}
                        disabled={sending !== null || editingTraineeId !== null}
                        className="rounded-md bg-brand-navy px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-navy-dark disabled:opacity-50"
                      >
                        {sending === t.id ? 'Sending…' : showResend ? 'Resend text' : 'Send text'}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function TraineeForm({ value, onChange, onSave, onCancel, saveLabel }) {
  if (!value) return null
  const set = (field) => (e) => onChange({ ...value, [field]: e.target.value })
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-slate-700">
          First name
          <input type="text" required value={value.first_name} onChange={set('first_name')} className={inputCls} autoComplete="off" />
        </label>
        <label className="block text-xs font-medium text-slate-700">
          Last name
          <input type="text" required value={value.last_name} onChange={set('last_name')} className={inputCls} autoComplete="off" />
        </label>
        <label className="block text-xs font-medium text-slate-700">
          Phone
          <input type="tel" required value={value.phone} onChange={set('phone')} placeholder="555-123-4567" className={inputCls} autoComplete="off" />
        </label>
        <label className="block text-xs font-medium text-slate-700">
          Email (optional)
          <input type="email" value={value.email} onChange={set('email')} className={inputCls} autoComplete="off" />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <input
          type="checkbox"
          checked={!!value.needs_hotel}
          onChange={(e) => onChange({ ...value, needs_hotel: e.target.checked })}
          className="h-4 w-4 rounded border-slate-300 text-brand-navy focus:ring-brand-navy"
        />
        🏨 Needs hotel accommodation (out-of-town)
      </label>
      <div className="border-t border-slate-200 pt-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Registration details
        </div>
        <p className="mt-0.5 text-xs text-slate-500">
          Fix anything the attendee mistyped during self-registration.
        </p>
      </div>
      <label className="block text-xs font-medium text-slate-700">
        Years in sales
        <select
          value={value.years_in_sales || ''}
          onChange={set('years_in_sales')}
          className={inputCls}
        >
          <option value="">— Select —</option>
          {YEARS_IN_SALES_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </label>
      <label className="block text-xs font-medium text-slate-700">
        Street address
        <input
          type="text"
          value={value.street_address || ''}
          onChange={set('street_address')}
          className={inputCls}
          autoComplete="off"
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-6">
        <label className="block text-xs font-medium text-slate-700 sm:col-span-3">
          City
          <input
            type="text"
            value={value.city || ''}
            onChange={set('city')}
            className={inputCls}
            autoComplete="off"
          />
        </label>
        <label className="block text-xs font-medium text-slate-700 sm:col-span-2">
          State
          <select
            value={value.state || ''}
            onChange={set('state')}
            className={inputCls}
          >
            <option value="">— Select —</option>
            {US_STATES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code} — {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-slate-700 sm:col-span-1">
          Zip
          <input
            type="text"
            inputMode="numeric"
            pattern={ZIP_PATTERN}
            maxLength={10}
            value={value.zip || ''}
            onChange={set('zip')}
            className={inputCls}
            autoComplete="off"
            title="5-digit zip, optionally followed by -4 digits"
          />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          className="rounded-md bg-brand-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-navy-dark"
        >
          {saveLabel}
        </button>
      </div>
    </div>
  )
}

function BackLink() {
  return (
    <Link to="/calendar" className="inline-flex items-center text-sm text-slate-600 hover:text-slate-900">
      ← Back to schedule
    </Link>
  )
}

function todayLocalIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function byName(a, b) {
  const an = `${a.first_name} ${a.last_name}`.toLowerCase()
  const bn = `${b.first_name} ${b.last_name}`.toLowerCase()
  return an < bn ? -1 : an > bn ? 1 : 0
}

function computeSummary(trainees, attemptsByTrainee = {}) {
  const total = trainees.length
  const registered = trainees.filter((t) => t.registered).length
  const confirmed = trainees.filter((t) => t.confirmation_status === 'confirmed').length
  const declined = trainees.filter((t) => t.confirmation_status === 'declined').length
  const reminderSentNoResponse = trainees.filter(
    (t) => t.last_reminder_sent_at && !t.confirmation_status,
  ).length
  const needsHotel = trainees.filter((t) => t.needs_hotel).length

  // Test stats
  const attempts = trainees.map((t) => attemptsByTrainee[t.id]).filter(Boolean)
  const submitted = attempts.filter((a) => a.submitted_at)
  const testSubmitted = submitted.length
  const testNotSubmitted = total - testSubmitted
  const retentionScores = submitted.filter((a) => a.retention_pct != null).map((a) => Number(a.retention_pct))
  const avgRetention =
    retentionScores.length > 0
      ? Math.round(retentionScores.reduce((a, b) => a + b, 0) / retentionScores.length)
      : null

  return {
    total,
    registered,
    confirmed,
    declined,
    reminderSentNoResponse,
    needsHotel,
    testSubmitted,
    testNotSubmitted,
    avgRetention,
  }
}

function pct(numerator, denominator) {
  if (!denominator) return null
  return Math.round((numerator / denominator) * 100)
}

function ProvisioningWorkflowCard({ cls, onSendDay2, onSendCredentials }) {
  const notifiedAt = cls.day_2_it_notified_at
  const completedAt = cls.it_completed_at
  const today = todayLocalIso()
  const provisioned = (cls.trainees || []).filter(
    (t) => t.enrolled !== false && t.company_email,
  )
  // Only trainees who actually attended today are eligible to receive credentials.
  const attendedToday = provisioned.filter((t) =>
    (t.attendance || []).some((a) => a.confirmed && a.attendance_date === today),
  )
  const sentCount = provisioned.filter((t) => t.credentials_sent_at).length
  const eligibleNow = attendedToday.filter((t) => !t.credentials_sent_at).length
  const lastSentAt = provisioned
    .map((t) => t.credentials_sent_at)
    .filter(Boolean)
    .sort()
    .pop()
  const canSendCredentials = !!completedAt && eligibleNow > 0

  let credentialsStatusText
  if (provisioned.length === 0) {
    credentialsStatusText = 'Waiting on IT to provision emails.'
  } else if (sentCount === 0) {
    credentialsStatusText = `${eligibleNow} of ${provisioned.length} attended today and are ready to receive their credentials text.`
  } else if (eligibleNow > 0) {
    credentialsStatusText = `${sentCount} texted so far · ${eligibleNow} more attended today and still need theirs.`
  } else if (sentCount === provisioned.length) {
    credentialsStatusText = `All ${sentCount} trainees received their credentials.`
  } else {
    credentialsStatusText = `${sentCount} texted · waiting on today's attendance for the rest.`
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Email provisioning workflow</h2>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onSendDay2}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            title="Manually send the day-2 reminder text to IT subscribers right now."
          >
            📨 Send day-2 IT reminder
          </button>
          <button
            type="button"
            onClick={onSendCredentials}
            disabled={!canSendCredentials}
            className="rounded-md bg-brand-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-navy-dark disabled:cursor-not-allowed disabled:opacity-50"
            title={
              !completedAt
                ? 'Available once IT marks provisioning complete.'
                : eligibleNow === 0
                  ? 'No eligible trainees right now — needs at least one provisioned attendee who has signed in today and not yet been texted.'
                  : `Texts ${eligibleNow} trainee${eligibleNow === 1 ? '' : 's'} who attended today their company email + password and setup link. No-shows are skipped.`
            }
          >
            📤 Send credentials to {eligibleNow > 0 ? `${eligibleNow} attendee${eligibleNow === 1 ? '' : 's'}` : 'attendees'}
          </button>
        </div>
      </div>
      <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
        <WorkflowStep
          label="Day-2 reminder sent to IT"
          stampedAt={notifiedAt}
          pendingText="Cron will fire it (or click the button to force)."
        />
        <WorkflowStep
          label="IT marked provisioning complete"
          stampedAt={completedAt}
          pendingText="Pending — IT clicks the button on the Provision page."
        />
        <WorkflowStep
          label="Credentials texted to trainees"
          stampedAt={provisioned.length > 0 && sentCount === provisioned.length ? lastSentAt : null}
          pendingText={credentialsStatusText}
        />
      </ul>
    </section>
  )
}

function WorkflowStep({ label, stampedAt, pendingText }) {
  return (
    <li className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="font-medium text-slate-800">{label}</div>
      {stampedAt ? (
        <div className="mt-0.5 text-xs text-emerald-700">
          ✓ {new Date(stampedAt).toLocaleString()}
        </div>
      ) : (
        <div className="mt-0.5 text-xs text-slate-500">{pendingText}</div>
      )}
    </li>
  )
}

function RosterSummary({ summary }) {
  if (summary.total === 0) return null
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold">Roster summary</h2>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Scheduled" value={summary.total} />
        <Stat
          label="Registered"
          value={summary.registered}
          pct={pct(summary.registered, summary.total)}
          tone="green"
        />
        <Stat
          label="Confirmed"
          value={summary.confirmed}
          pct={pct(summary.confirmed, summary.total)}
          tone="green"
        />
        <Stat
          label="Declined"
          value={summary.declined}
          tone={summary.declined > 0 ? 'red' : 'slate'}
        />
      </div>
      {summary.reminderSentNoResponse > 0 && (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          ⏳ <strong>{summary.reminderSentNoResponse}</strong>{' '}
          trainee{summary.reminderSentNoResponse === 1 ? '' : 's'} got the 24-hour confirmation link
          but hasn't tapped it yet.
        </p>
      )}
      {summary.needsHotel > 0 && (
        <p className="mt-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
          🏨 <strong>{summary.needsHotel}</strong> of {summary.total} trainee{summary.needsHotel === 1 ? '' : 's'}{' '}
          need{summary.needsHotel === 1 ? 's' : ''} hotel accommodation — book that many rooms.
        </p>
      )}
      {summary.testSubmitted > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat
            label="Test submitted"
            value={summary.testSubmitted}
            pct={pct(summary.testSubmitted, summary.total)}
            tone="green"
          />
          <Stat label="Not submitted" value={summary.testNotSubmitted} tone={summary.testNotSubmitted > 0 ? 'amber' : 'slate'} />
          {summary.avgRetention != null && (
            <Stat label="Avg retention" value={`${summary.avgRetention}%`} tone="navy" />
          )}
        </div>
      )}
    </section>
  )
}

function Stat({ label, value, pct: pctValue, tone = 'slate' }) {
  const valueColor = {
    green: 'text-green-700',
    red: 'text-red-700',
    amber: 'text-amber-700',
    navy: 'text-brand-navy',
    slate: 'text-slate-900',
  }[tone] || 'text-slate-900'
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50 p-3">
      <div className={`text-2xl font-bold ${valueColor}`}>
        {value}
        {pctValue !== null && pctValue !== undefined && (
          <span className="ml-1 text-sm font-medium text-slate-500">({pctValue}%)</span>
        )}
      </div>
      <div className="mt-0.5 text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  )
}

function TestResults({ trainees, attemptsByTrainee }) {
  const withAttempts = trainees
    .map((t) => ({ trainee: t, attempt: attemptsByTrainee[t.id] }))
    .sort((a, b) => `${a.trainee.first_name} ${a.trainee.last_name}`.localeCompare(`${b.trainee.first_name} ${b.trainee.last_name}`))

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold">📝 Final test results</h2>
      <p className="text-xs text-slate-500">
        Retention scores from the multiple-choice section. Essay answers (used for testimonials)
        are aggregated on the <Link to="/testimonials" className="underline">Testimonials page</Link>.
      </p>
      <ul className="mt-4 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
        {withAttempts.map(({ trainee, attempt }) => (
          <li key={trainee.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <div className="min-w-0">
              <div className="font-medium text-slate-900">
                {trainee.first_name} {trainee.last_name}
              </div>
              {attempt?.submitted_at ? (
                <div className="text-xs text-slate-500">
                  Submitted {new Date(attempt.submitted_at).toLocaleString()}
                </div>
              ) : (
                <div className="text-xs text-amber-700">Not submitted yet</div>
              )}
            </div>
            <div className="text-right">
              {attempt?.submitted_at && attempt.total_mc > 0 ? (
                <>
                  <div className="text-xl font-bold text-brand-navy">
                    {attempt.correct_count}<span className="text-slate-400">/{attempt.total_mc}</span>
                  </div>
                  {attempt.retention_pct != null && (
                    <div className="text-xs font-medium text-slate-600">{attempt.retention_pct}% retention</div>
                  )}
                </>
              ) : attempt?.submitted_at ? (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                  Submitted
                </span>
              ) : (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                  —
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function blankTrainee() {
  return {
    first_name: '',
    last_name: '',
    phone: '',
    email: '',
    needs_hotel: false,
    years_in_sales: '',
    street_address: '',
    city: '',
    state: '',
    zip: '',
  }
}

const inputCls =
  'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500'
