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
    const wasDeclined = !!t.declined_at
    const confirmMsg = wasDeclined
      ? `${t.first_name} ${t.last_name} previously declined this training. Re-enroll them and clear the decline?`
      : `Re-enroll ${t.first_name} ${t.last_name}?`
    if (!confirm(confirmMsg)) return
    setMessage(null)
    const { error: err } = await supabase
      .from('trainees')
      .update({
        enrolled: true,
        unenrolled_at: null,
        unenrolled_reason: null,
        // Clearing the decline stamps lets the system text them again. Only
        // wipe these if the row was actually declined — otherwise leave
        // historical data alone.
        ...(wasDeclined ? { declined_at: null, declined_reason: null } : {}),
      })
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
    if (newTraineeDraft.needs_hotel !== true && newTraineeDraft.needs_hotel !== false) {
      setMessage({ type: 'error', text: 'Please pick Yes or No on "Needs hotel".' })
      return
    }
    setMessage(null)
    const { error: err } = await supabase.from('trainees').insert({
      class_id: id,
      first_name: newTraineeDraft.first_name.trim(),
      last_name: newTraineeDraft.last_name.trim(),
      phone: newTraineeDraft.phone.trim(),
      email: newTraineeDraft.email.trim() || null,
      needs_hotel: newTraineeDraft.needs_hotel,
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
          `Each gets a personal link with their company email + password and iPhone/Android setup steps. ` +
          `Anyone who didn't sign in today OR already received their text is skipped.\n\n` +
          `Also fires dropout notifications for today's no-shows: IT gets a "delete the Google Workspace account" message and HR/VA get a "remove them from RepCard/JobNimbus/Sales Academy" message.`,
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

      // Right after credentials fire, kick the dropout flow for the same day
      // so any no-shows are reported to IT (delete email) + HR/VA (remove
      // from apps). Best-effort — credentials are the headline action; if
      // dropout fan-out hits a snag we still want the success banner to
      // surface what worked.
      let dropoutNote = ''
      try {
        const dRes = await fetch('/.netlify/functions/notify-trainee-dropout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ class_id: cls.id, date: today }),
        })
        const dBody = await dRes.json().catch(() => ({}))
        if (dRes.ok && dBody.candidate_count > 0) {
          const it = dBody.it_notified || {}
          const hr = dBody.hr_notified || {}
          dropoutNote =
            ` Dropouts flagged: ${dBody.candidate_count} no-show${dBody.candidate_count === 1 ? '' : 's'}` +
            ` — IT ${it.sms_sent || 0}/${it.recipient_count || 0}, HR/VA ${hr.sms_sent || 0}/${hr.recipient_count || 0}.`
        } else if (dRes.ok && dBody.candidate_count === 0) {
          dropoutNote = ' No dropouts to report for today.'
        }
      } catch {
        // best-effort — surface in console but don't block UI
      }

      if (failures.length === 0) {
        setMessage({
          type: 'success',
          text: `Sent credentials text to ${successes} trainee${successes === 1 ? '' : 's'}.${dropoutNote}`,
        })
      } else {
        setMessage({
          type: 'error',
          text: `Sent ${successes}, failed ${failures.length}. First error: ${failures[0].error}.${dropoutNote}`,
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

  // A trainee who declined gets marked enrolled=false by the decline flow,
  // so they naturally fall out of the "enrolled" list. We pull them into
  // their own "declined" bucket below so HR can see them separately from
  // ordinary unenrollments.
  const declined = trainees.filter((t) => t.declined_at)
  const enrolled = trainees.filter((t) => t.enrolled !== false)
  const unenrolled = trainees.filter((t) => t.enrolled === false && !t.declined_at)
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

      {cls.attendance_only && (
        <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4">
          <div className="flex items-start gap-2">
            <span className="text-2xl leading-none" aria-hidden="true">📋</span>
            <div>
              <div className="font-semibold text-amber-900">Attendance-only meeting</div>
              <p className="mt-1 text-sm text-amber-900">
                This class is flagged attendance-only. No automations will run — no
                registration texts, no provisioning, no final test, no graduation report, no
                hotels, no welcome drip. Add attendees below and use the kiosk on the day of
                the meeting to track who showed up.
              </p>
            </div>
          </div>
        </div>
      )}

      {!cls.attendance_only && (
        <ProvisioningWorkflowCard
          cls={cls}
          onSendDay2={sendDay2ItReminder}
          onSendCredentials={sendCredentialsToTrainees}
        />
      )}

      <RosterSummary summary={summary} />

      {!cls.attendance_only && summary.testSubmitted > 0 && (
        <TestResults trainees={enrolled} attemptsByTrainee={attemptsByTrainee} classId={id} />
      )}

      {!cls.attendance_only && summary.testSubmitted > 0 && (
        <GraduationReportCard cls={cls} onReload={load} />
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
          {cls.attendance_only ? (
            <><strong>{enrolled.length}</strong> attendee{enrolled.length === 1 ? '' : 's'} on the roster.</>
          ) : unsentIds.length > 0 ? (
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
        {cls.attendance_only && (
          <BulkImportButton classId={id} onImported={load} />
        )}
        {!cls.attendance_only && unsentIds.length > 0 && (
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

      {/* Trainee list — for attendance-only classes show ONE simple
          "Attendees" list (no registration concept). Otherwise show
          the normal 3-bucket grouping by registration status. */}
      {cls.attendance_only ? (
        <TraineeGroup
          title="Attendees"
          emoji="👥"
          color="slate"
          trainees={enrolled}
          empty="No attendees added yet. Click + Add trainee to add one."
          sending={sending}
          hideSend
          onSend={() => {}}
          editingTraineeId={editingTraineeId}
          traineeDraft={traineeDraft}
          onStartEdit={startEditTrainee}
          onCancelEdit={cancelEditTrainee}
          onSaveEdit={saveEditTrainee}
          onDraftChange={setTraineeDraft}
          onDelete={deleteTrainee}
          onUnenroll={unenrollTrainee}
        />
      ) : (
      [
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
      ))
      )}

      {declined.length > 0 && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-amber-900">
            🙅 Declined / withdrew <span className="font-normal text-amber-700">({declined.length})</span>
          </h2>
          <p className="mt-1 text-xs text-amber-800">
            These trainees clicked "Can't make it" on their registration page. They've been
            auto-unenrolled and the system will not send them any more texts. Reasons (when
            given) are below — useful for HR follow-up.
          </p>
          <ul className="mt-4 divide-y divide-amber-200 rounded-md border border-amber-200 bg-white">
            {declined.map((t) => (
              <li
                key={t.id}
                className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="font-medium text-slate-900">
                    {t.first_name} {t.last_name}
                  </div>
                  <div className="text-slate-500">
                    {t.phone}
                    {t.email && ` · ${t.email}`}
                  </div>
                  {t.declined_reason && (
                    <div className="mt-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs italic text-amber-900">
                      "{t.declined_reason}"
                    </div>
                  )}
                  {t.declined_at && (
                    <div className="mt-1 text-xs text-slate-400">
                      Declined: {new Date(t.declined_at).toLocaleString()}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => reenrollTrainee(t)}
                    className="rounded-md border border-green-300 bg-white px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-50"
                    title="If the trainee changed their mind back, re-enroll them and clear the decline"
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
  // hideSend = true → no "Send text" button on each row. Used by the
  // attendance-only class view, where there's no registration flow.
  hideSend = false,
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
                      {!hideSend && (
                      <button
                        onClick={() => onSend(t.id)}
                        disabled={sending !== null || editingTraineeId !== null}
                        className="rounded-md bg-brand-navy px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-navy-dark disabled:opacity-50"
                      >
                        {sending === t.id ? 'Sending…' : showResend ? 'Resend text' : 'Send text'}
                      </button>
                      )}
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
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-slate-700">
          🏨 Needs hotel accommodation?
        </span>
        <NeedsHotelToggle
          value={value.needs_hotel}
          onChange={(v) => onChange({ ...value, needs_hotel: v })}
        />
      </div>
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

function TestResults({ trainees, attemptsByTrainee, classId }) {
  const withAttempts = trainees
    .map((t) => ({ trainee: t, attempt: attemptsByTrainee[t.id] }))
    .sort((a, b) => `${a.trainee.first_name} ${a.trainee.last_name}`.localeCompare(`${b.trainee.first_name} ${b.trainee.last_name}`))

  const [expandedAttemptId, setExpandedAttemptId] = useState(null)
  const [sendingId, setSendingId] = useState(null)
  const [bulkSending, setBulkSending] = useState(false)
  const [flash, setFlash] = useState(null)

  const submitted = withAttempts.filter(({ attempt }) => attempt?.submitted_at)
  const unsentSubmitted = submitted.filter(({ trainee }) => !trainee.test_results_link_sent_at)

  async function sendResults(trainee) {
    if (!confirm(`Text ${trainee.first_name} ${trainee.last_name} a link to their results now?`)) return
    setSendingId(trainee.id)
    setFlash(null)
    try {
      const res = await fetch('/.netlify/functions/send-test-results-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trainee_ids: [trainee.id] }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || j.sent_count === 0) {
        const err = (j.results || []).find((r) => !r.ok)?.error || j.error || 'Send failed.'
        setFlash({ kind: 'error', text: err })
      } else {
        setFlash({ kind: 'success', text: `Sent results to ${trainee.first_name} ${trainee.last_name}.` })
        // Mutate locally so the badge updates without a full class reload.
        trainee.test_results_link_sent_at = new Date().toISOString()
      }
    } catch (err) {
      setFlash({ kind: 'error', text: err.message })
    } finally {
      setSendingId(null)
    }
  }

  async function sendToAllUnsent() {
    if (unsentSubmitted.length === 0) {
      setFlash({ kind: 'info', text: 'Nothing to send — every submitted trainee has already received their results link.' })
      return
    }
    if (
      !confirm(
        `Send results to ${unsentSubmitted.length} trainee${unsentSubmitted.length === 1 ? '' : 's'} who haven't received the link yet?`,
      )
    )
      return
    setBulkSending(true)
    setFlash(null)
    try {
      const res = await fetch('/.netlify/functions/send-test-results-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ class_id: classId, unsent_only: true }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFlash({ kind: 'error', text: j.error || 'Send failed.' })
      } else {
        const failNote = j.fail_count > 0 ? ` · ${j.fail_count} failed` : ''
        setFlash({
          kind: j.fail_count > 0 ? 'error' : 'success',
          text: `Sent ${j.sent_count} text${j.sent_count === 1 ? '' : 's'}${failNote}.`,
        })
        // Mark every unsent one as sent locally so the bulk count updates.
        for (const { trainee } of unsentSubmitted) {
          trainee.test_results_link_sent_at = new Date().toISOString()
        }
      }
    } catch (err) {
      setFlash({ kind: 'error', text: err.message })
    } finally {
      setBulkSending(false)
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">📝 Final test results</h2>
          <p className="text-xs text-slate-500">
            Retention scores from the multiple-choice section. Click <strong>View answers</strong>{' '}
            on any submitted trainee to see exactly which questions they got right or wrong, plus
            their essay responses. Use <strong>Send results</strong> to text the trainee a private
            link to the same view. Essay answers used for testimonials are also aggregated on the{' '}
            <Link to="/testimonials" className="underline">Testimonials page</Link>.
          </p>
        </div>
        {submitted.length > 0 && (
          <button
            type="button"
            onClick={sendToAllUnsent}
            disabled={bulkSending || unsentSubmitted.length === 0}
            className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-40"
          >
            {bulkSending
              ? 'Sending…'
              : unsentSubmitted.length === 0
                ? 'All results sent'
                : `Send to all submitted (${unsentSubmitted.length})`}
          </button>
        )}
      </div>
      {flash && (
        <div
          className={
            'mt-3 rounded-md border p-2 text-xs ' +
            (flash.kind === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : flash.kind === 'info'
                ? 'border-slate-200 bg-slate-50 text-slate-700'
                : 'border-red-200 bg-red-50 text-red-800')
          }
        >
          {flash.text}
        </div>
      )}
      <ul className="mt-4 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
        {withAttempts.map(({ trainee, attempt }) => {
          const isExpanded = attempt && expandedAttemptId === attempt.id
          return (
            <li key={trainee.id} className="text-sm">
              <div className="flex items-center justify-between gap-3 px-4 py-3">
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
                <div className="flex items-center gap-3">
                  {attempt?.submitted_at && attempt.total_mc > 0 ? (
                    <div className="text-right">
                      <div className="text-xl font-bold text-brand-navy">
                        {attempt.correct_count}<span className="text-slate-400">/{attempt.total_mc}</span>
                      </div>
                      {attempt.retention_pct != null && (
                        <div className="text-xs font-medium text-slate-600">{attempt.retention_pct}% retention</div>
                      )}
                    </div>
                  ) : attempt?.submitted_at ? (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                      Submitted
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                      —
                    </span>
                  )}
                  {attempt?.submitted_at && (
                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedAttemptId(isExpanded ? null : attempt.id)
                        }
                        className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        {isExpanded ? 'Hide answers' : 'View answers'}
                      </button>
                      <button
                        type="button"
                        onClick={() => sendResults(trainee)}
                        disabled={sendingId === trainee.id}
                        className="rounded-md bg-slate-800 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-40"
                        title={
                          trainee.test_results_link_sent_at
                            ? `Already sent ${new Date(trainee.test_results_link_sent_at).toLocaleString()} — clicking will resend`
                            : 'Text this trainee a private link to their results'
                        }
                      >
                        {sendingId === trainee.id
                          ? 'Sending…'
                          : trainee.test_results_link_sent_at
                            ? 'Re-send results'
                            : 'Send results'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {isExpanded && <AttemptDetail attemptId={attempt.id} />}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// Expands inline under a trainee row when "View answers" is clicked.
// Pulls every test_responses row for the attempt + the linked
// questions.correct_choice / choices so we can render right/wrong with
// the correct answer highlighted. Essay responses just show the text —
// no right or wrong on those.
function AttemptDetail({ attemptId }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setData(null)
      setError(null)
      const { data: rows, error: err } = await supabase
        .from('test_responses')
        .select(
          'id, question_prompt, question_type, selected_choice, is_correct, essay_response, use_for_testimonial, use_for_client_review, questions(correct_choice, choices, order_index)',
        )
        .eq('attempt_id', attemptId)
        .order('created_at', { ascending: true })
      if (cancelled) return
      if (err) {
        setError(err.message)
        return
      }
      // Sort by the original question order_index so the trainee's answers
      // show up in the same sequence they took the test.
      const sorted = (rows || []).slice().sort((a, b) => {
        const ai = a.questions?.order_index ?? 999
        const bi = b.questions?.order_index ?? 999
        return ai - bi
      })
      setData(sorted)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [attemptId])

  if (error) {
    return (
      <div className="border-t border-slate-200 bg-red-50 px-4 py-3 text-xs text-red-800">
        Couldn't load answers: {error}
      </div>
    )
  }
  if (data === null) {
    return (
      <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
        Loading answers…
      </div>
    )
  }
  if (data.length === 0) {
    return (
      <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
        No answers recorded for this attempt.
      </div>
    )
  }

  const mc = data.filter((r) => r.question_type === 'multiple_choice')
  const essays = data.filter((r) => r.question_type === 'essay')
  const correctCount = mc.filter((r) => r.is_correct === true).length
  const wrongCount = mc.filter((r) => r.is_correct === false).length

  return (
    <div className="border-t border-slate-200 bg-slate-50 px-4 py-4 space-y-4">
      {mc.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Multiple choice ({correctCount} right · {wrongCount} wrong)
          </div>
          <ol className="mt-2 space-y-2">
            {mc.map((r, i) => {
              const correct = r.questions?.correct_choice
              const choices = Array.isArray(r.questions?.choices) ? r.questions.choices : []
              const noKey = correct === null || correct === undefined || correct === ''
              return (
                <li
                  key={r.id}
                  className={
                    'rounded-md border p-3 text-sm shadow-sm ' +
                    (r.is_correct === true
                      ? 'border-emerald-200 bg-white'
                      : r.is_correct === false
                        ? 'border-red-200 bg-white'
                        : 'border-slate-200 bg-white')
                  }
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <span className="text-xs font-semibold text-slate-500">Q{i + 1}.</span>{' '}
                      <span className="font-medium text-slate-900">{r.question_prompt}</span>
                    </div>
                    {noKey ? (
                      <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
                        No correct answer set
                      </span>
                    ) : r.is_correct === true ? (
                      <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                        ✓ Correct
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-800">
                        ✗ Wrong
                      </span>
                    )}
                  </div>
                  <div className="mt-2 space-y-0.5 text-xs">
                    {choices.length > 0 ? (
                      choices.map((c) => {
                        const isSelected = c === r.selected_choice
                        const isCorrect = !noKey && c === correct
                        return (
                          <div
                            key={c}
                            className={
                              'rounded px-2 py-1 ' +
                              (isCorrect
                                ? 'bg-emerald-50 font-semibold text-emerald-900'
                                : isSelected
                                  ? 'bg-red-50 font-medium text-red-900'
                                  : 'text-slate-600')
                            }
                          >
                            {isCorrect && '✓ '}
                            {isSelected && !isCorrect && '✗ '}
                            {!isCorrect && !isSelected && '· '}
                            {c}
                            {isSelected && <span className="ml-1 text-[10px] uppercase tracking-wide">(their answer)</span>}
                          </div>
                        )
                      })
                    ) : (
                      <div className="text-slate-600">
                        Their answer: <strong>{r.selected_choice || '— blank —'}</strong>
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        </div>
      )}

      {essays.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Essay answers
          </div>
          <ol className="mt-2 space-y-2">
            {essays.map((r, i) => (
              <li key={r.id} className="rounded-md border border-slate-200 bg-white p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <span className="text-xs font-semibold text-slate-500">E{i + 1}.</span>{' '}
                    <span className="font-medium text-slate-900">{r.question_prompt}</span>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1">
                    {r.use_for_testimonial && (
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-800">
                        ⭐ Neal
                      </span>
                    )}
                    {r.use_for_client_review && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-800">
                        🏢 Client review
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-2 whitespace-pre-wrap rounded bg-slate-50 px-3 py-2 text-xs italic text-slate-700">
                  {r.essay_response?.trim() ? `"${r.essay_response.trim()}"` : '— left blank —'}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

function blankTrainee() {
  return {
    first_name: '',
    last_name: '',
    phone: '',
    email: '',
    // Tri-state: null until the hiring manager picks Yes or No. Save
    // handler refuses to insert with null so HR can't forget the answer.
    needs_hotel: null,
    years_in_sales: '',
    street_address: '',
    city: '',
    state: '',
    zip: '',
  }
}

const inputCls =
  'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500'

// Tri-state Yes/No toggle for needs_hotel. `value` can be null (undecided
// — both buttons inactive, amber outline nudges the user to choose),
// true (Yes lit green), or false (No lit slate).
// Bulk import — useful for attendance-only meetings where HR has a long
// list (e.g. 70-person company meeting). Accepts a CSV file OR a pasted
// list. Each line is "Full Name" or "Full Name, phone" (header optional).
// Names with a single word land entirely in first_name. No registration
// text is sent — these are attendance-only attendees.
function BulkImportButton({ classId, onImported }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        📋 Bulk import (CSV)
      </button>
      {open && (
        <BulkImportModal
          classId={classId}
          onClose={() => setOpen(false)}
          onImported={onImported}
        />
      )}
    </>
  )
}

function BulkImportModal({ classId, onClose, onImported }) {
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null) // { inserted, skipped }

  function onFile(e) {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => setText(String(reader.result || ''))
    reader.readAsText(f)
  }

  const parsed = parseAttendeeList(text)

  async function importAll() {
    setSaving(true)
    setError(null)
    // The trainees table requires phone (NOT NULL). For rows without a
    // phone (or where the CSV column was blank), substitute an empty
    // string to satisfy the constraint — attendance-only flow doesn't
    // text the trainee so the value is never actually used.
    // The email column (CSV "Company Email") lands in company_email
    // since the data is @shingleusa.com addresses.
    const payload = parsed.map((p) => ({
      class_id: classId,
      first_name: p.first_name,
      last_name: p.last_name,
      phone: p.phone || '',
      // If the CSV has a @shingleusa.com address, treat it as a
      // company_email. Otherwise it's a personal email.
      ...(p.email && /@shingleusa\.com$/i.test(p.email)
        ? { company_email: p.email }
        : p.email
          ? { email: p.email }
          : {}),
      // Attendance-only attendees come in already "enrolled" and (for
      // the attendance-only kiosk path) we don't require them to go
      // through registration. Setting registered=true here lets them
      // also appear if someone flips this class to a real training week
      // later — harmless either way.
      enrolled: true,
      needs_hotel: false,
    }))
    const { error: err } = await supabase.from('trainees').insert(payload)
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    setDone({ inserted: payload.length })
    if (onImported) await onImported()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/60 p-4 overflow-y-auto">
      <div className="my-8 w-full max-w-2xl rounded-lg border border-slate-200 bg-white p-6 shadow-2xl space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">📋 Bulk import attendees</h2>
            <p className="mt-1 text-xs text-slate-500">
              Upload a CSV file <strong>or</strong> paste the list below. Two formats work:
            </p>
            <p className="mt-2 text-xs font-semibold text-slate-600">
              Format 1 — simple (no header, one attendee per line):
            </p>
            <pre className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 whitespace-pre">{`John Doe
Jane Smith, 555-123-4567
Bob Johnson, (727) 555-0142`}</pre>
            <p className="mt-2 text-xs font-semibold text-slate-600">
              Format 2 — with header row (auto-detected, any column order):
            </p>
            <pre className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 whitespace-pre">{`First Name,Last Name,Company Number,Personal Number,Company Email
Aaron,Doster,,(305) 979-8248,aaron.doster@shingleusa.com
Anthony,Alongi,(904) 560-5717,(443) 797-3758,AnthonyAlongi@shingleusa.com`}</pre>
            <p className="mt-2 text-xs text-slate-500">
              Recognized columns: <code>First Name</code>, <code>Last Name</code>,{' '}
              <code>Phone</code>/<code>Personal Number</code>/<code>Cell</code>,{' '}
              <code>Company Number</code>, <code>Email</code>/<code>Company Email</code>.
              Personal Number is preferred when both are present; Company Number is the
              fallback. Empty rows are skipped automatically.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            ✕ Close
          </button>
        </div>

        {done ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            <p className="font-semibold">✓ Imported {done.inserted} attendees.</p>
            <p className="mt-1 text-xs">Close this dialog and you'll see them in the Attendees list.</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-3 rounded-md bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Upload CSV file
              </span>
              <input
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                onChange={onFile}
                className="mt-1 block w-full text-sm"
              />
            </label>
            <div className="text-xs text-slate-500">— or —</div>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Paste the list
              </span>
              <textarea
                rows={8}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="John Doe&#10;Jane Smith, 555-1234&#10;…"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
              />
            </label>

            {parsed.length > 0 && (
              <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
                <div className="font-semibold">
                  Preview: {parsed.length} attendee{parsed.length === 1 ? '' : 's'} ready to
                  import
                </div>
                <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto">
                  {parsed.slice(0, 20).map((p, i) => (
                    <li key={i}>
                      {i + 1}. {p.first_name} {p.last_name}
                      {p.phone && <span className="text-slate-500"> · {p.phone}</span>}
                      {p.email && <span className="text-slate-500"> · {p.email}</span>}
                    </li>
                  ))}
                  {parsed.length > 20 && (
                    <li className="italic text-slate-500">…and {parsed.length - 20} more</li>
                  )}
                </ul>
              </div>
            )}

            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={importAll}
                disabled={saving || parsed.length === 0}
                className="rounded-md bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
              >
                {saving ? 'Importing…' : `Import ${parsed.length} attendee${parsed.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// Parses a pasted/CSV list into [{first_name, last_name, phone}, ...].
// Tolerates: header row, empty lines, commas vs tabs, single-name lines,
// "First Last, 555-1234" or "First,Last,555-1234".
// Parses pasted text OR a CSV file into [{first_name, last_name, phone, email}, ...].
// Handles the rich case (5+ columns, header row, quoted fields with
// embedded commas/quotes like "James ""Jimmy""") AND the simple case
// (one name per line, no header).
//
// Header detection: if the first line contains tokens like
// "first name", "phone", "email" etc., we treat it as a header and
// map columns by name. Otherwise we assume a positional layout
// (Name, Phone) and split on the first space.
function parseAttendeeList(text) {
  if (!text) return []
  const rows = parseCsv(text)
  if (rows.length === 0) return []

  const headerCells = rows[0].map(normalizeHeader)
  const headerLooksReal = headerCells.some(
    (h) =>
      /name/.test(h) ||
      /phone|number/.test(h) ||
      /email/.test(h),
  )

  const out = []
  if (headerLooksReal) {
    // Build column index map. Each known field can have multiple
    // header aliases. First column matching wins.
    const idx = mapHeaderColumns(headerCells)
    for (let i = 1; i < rows.length; i++) {
      const cells = rows[i]
      if (!cells.some((c) => c && c.trim())) continue // empty row
      const fullName = (cells[idx.full_name] || '').trim()
      let first = (cells[idx.first_name] || '').trim()
      let last = (cells[idx.last_name] || '').trim()
      if (!first && !last && fullName) {
        const parts = fullName.split(/\s+/)
        first = parts[0] || ''
        last = parts.slice(1).join(' ')
      }
      if (!first) continue
      // Personal phone wins, fall back to company phone.
      const phone =
        (cells[idx.personal_phone] || '').trim() ||
        (cells[idx.phone] || '').trim() ||
        (cells[idx.company_phone] || '').trim()
      const email =
        (cells[idx.email] || '').trim() ||
        (cells[idx.company_email] || '').trim()
      out.push({
        first_name: first,
        last_name: last,
        phone: phone || '',
        email: email || '',
      })
    }
    return out
  }

  // No header → fall back to simple positional parsing.
  for (const cells of rows) {
    if (!cells.length || !cells[0]) continue
    let first_name = ''
    let last_name = ''
    let phone = ''
    if (cells.length === 1) {
      const parts = cells[0].split(/\s+/)
      first_name = parts[0]
      last_name = parts.slice(1).join(' ')
    } else if (cells.length === 2) {
      if (/[\d()+\- .]{7,}/.test(cells[1])) {
        const parts = cells[0].split(/\s+/)
        first_name = parts[0]
        last_name = parts.slice(1).join(' ')
        phone = cells[1]
      } else {
        first_name = cells[0]
        last_name = cells[1]
      }
    } else {
      first_name = cells[0]
      last_name = cells[1]
      phone = cells[2]
    }
    if (!first_name) continue
    out.push({
      first_name: first_name.trim(),
      last_name: (last_name || '').trim(),
      phone: phone ? phone.replace(/\s+/g, ' ').trim() : '',
      email: '',
    })
  }
  return out
}

// Minimal CSV parser — handles quoted fields with embedded commas and
// escaped quotes ("" inside a quoted field). Returns rows as arrays
// of trimmed strings.
function parseCsv(text) {
  const out = []
  let row = []
  let cell = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cell += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',' || ch === '\t') {
        row.push(cell.trim())
        cell = ''
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++
        row.push(cell.trim())
        cell = ''
        // Skip rows where every cell is empty.
        if (row.some((c) => c)) out.push(row)
        row = []
      } else {
        cell += ch
      }
    }
  }
  // Flush the final row if no trailing newline.
  if (cell || row.length) {
    row.push(cell.trim())
    if (row.some((c) => c)) out.push(row)
  }
  return out
}

function normalizeHeader(h) {
  return String(h || '').toLowerCase().replace(/[_\s-]+/g, ' ').trim()
}

function mapHeaderColumns(headerCells) {
  // For each known field, list the header aliases that should map to it.
  // Order matters within an alias group — first matching column wins.
  const aliasMap = {
    full_name: ['full name', 'name'],
    first_name: ['first name', 'firstname', 'first'],
    last_name: ['last name', 'lastname', 'last'],
    personal_phone: [
      'personal number',
      'personal phone',
      'cell',
      'cell phone',
      'mobile',
      'mobile phone',
    ],
    company_phone: ['company number', 'company phone', 'work phone', 'office phone'],
    phone: ['phone', 'phone number', 'number'],
    email: ['email', 'email address', 'personal email'],
    company_email: ['company email', 'work email'],
  }
  const idx = {
    full_name: -1, first_name: -1, last_name: -1,
    personal_phone: -1, company_phone: -1, phone: -1,
    email: -1, company_email: -1,
  }
  for (const [field, aliases] of Object.entries(aliasMap)) {
    for (let i = 0; i < headerCells.length; i++) {
      if (aliases.includes(headerCells[i])) {
        idx[field] = i
        break
      }
    }
  }
  return idx
}

// Manual "Send / re-send graduation report" button. The auto-cron fires
// once after every enrolled trainee submits the final test, but if that
// run errored (Resend outage, sender not verified, subscriber list
// empty, etc.) the report won't have actually delivered. This card lets
// admin force a re-send. Function POST mode bypasses the
// graduation_report_sent_at filter so it works even after the cron
// stamped a (failed) send.
function GraduationReportCard({ cls, onReload }) {
  const [sending, setSending] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [result, setResult] = useState(null)
  const stampedAt = cls.graduation_report_sent_at

  // Workaround for Resend testing-mode lockdown: pull the PDF and let
  // the admin email it manually from their own inbox. Bypasses Resend
  // entirely. Useful until shingleusa.com is domain-verified.
  async function download() {
    setDownloading(true)
    setResult(null)
    try {
      const res = await fetch('/.netlify/functions/download-graduation-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ class_id: cls.id }),
      })
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        setResult({ kind: 'error', text: `Download failed: ${txt || res.status}` })
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      // Pull the filename from the Content-Disposition header if present,
      // otherwise fall back to a sensible default.
      const cd = res.headers.get('Content-Disposition') || ''
      const match = cd.match(/filename="?([^"]+)"?/)
      const filename = match?.[1] || `graduating-class-${cls.region || 'class'}-${cls.week_start_date}.pdf`
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setResult({ kind: 'success', text: `Downloaded ${filename}.` })
    } catch (err) {
      setResult({ kind: 'error', text: err.message })
    } finally {
      setDownloading(false)
    }
  }
  async function fire() {
    const action = stampedAt ? 'Re-send' : 'Send'
    if (!confirm(`${action} the graduation report email to every subscriber now?`)) return
    setSending(true)
    setResult(null)
    // 40-second client timeout so the UI never hangs if Netlify kills
    // the function or the network drops. Surfaces a clear message
    // instead of "Sending…" forever.
    const ctrl = new AbortController()
    const timeoutId = setTimeout(() => ctrl.abort(), 40000)
    try {
      const res = await fetch('/.netlify/functions/send-graduation-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ class_id: cls.id }),
        signal: ctrl.signal,
      })
      const j = await res.json().catch(() => ({}))
      // Log full server response so it's visible in browser dev tools —
      // makes diagnosing weird states (missing env, unexpected shape,
      // etc.) much faster.
      console.log('[graduation report] response', { status: res.status, body: j })

      // Surface SOMETHING no matter what shape came back.
      if (!res.ok) {
        setResult({
          kind: 'error',
          text: `HTTP ${res.status}: ${j.error || JSON.stringify(j).slice(0, 200)}`,
        })
      } else if (j.warning) {
        // Most common: no subscribers configured for the event.
        const diag = (j.recipients_diagnostic || [])
          .map((r) => `${r.name} (email: ${r.has_email ? 'yes' : 'NO'}, channel: ${r.email_channel_on ? 'on' : 'OFF'})`)
          .join('; ')
        setResult({
          kind: 'error',
          text: diag ? `${j.warning}\nSubscribers found: ${diag}` : j.warning,
        })
      } else {
        const cls0 = (j.results || [])[0] || {}
        if (cls0.error) {
          setResult({ kind: 'error', text: cls0.error })
        } else if ((cls0.sent_count ?? 0) === 0) {
          const errSummary = (cls0.errors || [])
            .map((e) => `${e.recipient || e.email}: ${e.error}`)
            .join('; ')
          setResult({
            kind: 'error',
            text: errSummary
              ? `Nothing was delivered. ${errSummary}`
              : `No deliveries (no results in response). Full response logged to browser console.`,
          })
        } else {
          setResult({
            kind: 'success',
            text: `Sent to ${cls0.sent_count} of ${cls0.recipient_count} subscriber${cls0.recipient_count === 1 ? '' : 's'}.`,
          })
          if (onReload) await onReload()
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        setResult({
          kind: 'error',
          text: 'Request timed out after 40s. The function is probably stuck on PDFShift or Resend — check Netlify function logs.',
        })
      } else {
        setResult({ kind: 'error', text: err.message })
      }
    } finally {
      clearTimeout(timeoutId)
      setSending(false)
    }
  }
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">🎓 Graduation report email</h2>
          <p className="mt-1 text-xs text-slate-500">
            PDF roster (name, phone, home address — no test scores) sent to every subscriber of
            the <strong>graduation_class_report</strong> event on /notifications. Cron fires
            automatically when every enrolled trainee has submitted their final test. Use the
            button below if you need to manually fire or re-send it.
          </p>
          {stampedAt ? (
            <p className="mt-2 text-xs text-emerald-700">
              ✓ Previously sent {new Date(stampedAt).toLocaleString()}
            </p>
          ) : (
            <p className="mt-2 text-xs text-amber-700">
              ⏳ Not yet sent for this class.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={download}
            disabled={downloading || sending}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            title="Download the PDF so you can email it manually — useful if Resend isn't delivering yet."
          >
            {downloading ? 'Generating…' : '⬇ Download PDF'}
          </button>
          <button
            type="button"
            onClick={fire}
            disabled={sending || downloading}
            className="rounded-md bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
          >
            {sending ? 'Sending…' : stampedAt ? 'Re-send report' : 'Send report now'}
          </button>
        </div>
      </div>
      {result && (
        <div
          className={
            'mt-3 rounded-md border p-2 text-xs ' +
            (result.kind === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-800')
          }
        >
          {result.text}
        </div>
      )}
    </section>
  )
}

function NeedsHotelToggle({ value, onChange }) {
  const undecided = value !== true && value !== false
  const base = 'px-3 py-1 text-xs font-semibold transition'
  return (
    <div
      className={
        'inline-flex overflow-hidden rounded-md border ' +
        (undecided ? 'border-amber-400 ring-2 ring-amber-100' : 'border-slate-300')
      }
    >
      <button
        type="button"
        onClick={() => onChange(true)}
        className={
          base +
          ' border-r ' +
          (value === true
            ? 'bg-emerald-600 text-white border-emerald-600'
            : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50')
        }
      >
        Yes
      </button>
      <button
        type="button"
        onClick={() => onChange(false)}
        className={
          base +
          ' ' +
          (value === false
            ? 'bg-slate-700 text-white'
            : 'bg-white text-slate-700 hover:bg-slate-50')
        }
      >
        No
      </button>
    </div>
  )
}
