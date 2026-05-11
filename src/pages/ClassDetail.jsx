import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { formatAddress, FL_REGIONS } from '../lib/locations.js'
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
  const [editingTraineeId, setEditingTraineeId] = useState(null)
  const [traineeDraft, setTraineeDraft] = useState(null)
  const [addingTrainee, setAddingTrainee] = useState(false)
  const [newTraineeDraft, setNewTraineeDraft] = useState(blankTrainee())

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
        'id, region, week_start_date, week_end_date, location_id, schedule_details, locations(*), trainees(*)',
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

  function startEditTrainee(t) {
    setEditingTraineeId(t.id)
    setTraineeDraft({
      first_name: t.first_name || '',
      last_name: t.last_name || '',
      phone: t.phone || '',
      email: t.email || '',
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

  const registered = trainees.filter((t) => t.registered)
  const sentNoResponse = trainees.filter((t) => !t.registered && t.last_sms_sent_at)
  const notSent = trainees.filter((t) => !t.registered && !t.last_sms_sent_at)
  const isTBD = !cls.locations
  const unsentIds = trainees.filter((t) => !t.registered).map((t) => t.id)

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackLink />
        <Link
          to={`/kiosk/${cls.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md border border-brand-navy bg-white px-3 py-1.5 text-xs font-semibold text-brand-navy hover:bg-brand-navy hover:text-white"
        >
          Open kiosk →
        </Link>
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
        />
      ))}
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

function byName(a, b) {
  const an = `${a.first_name} ${a.last_name}`.toLowerCase()
  const bn = `${b.first_name} ${b.last_name}`.toLowerCase()
  return an < bn ? -1 : an > bn ? 1 : 0
}

function blankTrainee() {
  return { first_name: '', last_name: '', phone: '', email: '' }
}

const inputCls =
  'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500'
