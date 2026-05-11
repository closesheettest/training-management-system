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
  const [editingHotel, setEditingHotel] = useState(false)
  const [hotelDraft, setHotelDraft] = useState('')

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
      setHotelDraft(data.location_id || '')
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

  async function saveHotel() {
    setMessage(null)
    const { error: err } = await supabase
      .from('classes')
      .update({ location_id: hotelDraft || null })
      .eq('id', id)
    if (err) {
      setMessage({ type: 'error', text: err.message })
      return
    }
    setEditingHotel(false)
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
      <BackLink />

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
              Hotel TBD
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

      {/* Region + hotel controls */}
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
            <p className="mt-1 text-xs text-slate-500">Changing the region clears the hotel.</p>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-slate-700">Hotel</label>
              {!editingHotel && (
                <button
                  type="button"
                  onClick={() => setEditingHotel(true)}
                  className="text-xs font-medium text-slate-600 underline hover:text-slate-900"
                >
                  {isTBD ? 'Assign hotel' : 'Change'}
                </button>
              )}
            </div>
            {editingHotel ? (
              <div className="mt-1 space-y-2">
                <select
                  value={hotelDraft}
                  onChange={(e) => setHotelDraft(e.target.value)}
                  className={inputCls}
                >
                  <option value="">TBD (no specific hotel yet)</option>
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
                      setEditingHotel(false)
                      setHotelDraft(cls.location_id || '')
                    }}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={saveHotel}
                    className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
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
      {unsentIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex-1 text-sm text-slate-700">
            <strong>{unsentIds.length}</strong> trainee{unsentIds.length === 1 ? '' : 's'} haven't registered yet.
          </div>
          <button
            onClick={() => sendSms(unsentIds, 'all')}
            disabled={sending !== null}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
          >
            {sending === 'all' ? 'Sending…' : `Send / resend to all ${unsentIds.length}`}
          </button>
        </div>
      )}

      {/* Trainee status groups */}
      <TraineeGroup
        title="Registered"
        emoji="✅"
        color="green"
        trainees={registered}
        empty="No trainees have completed registration yet."
        sending={sending}
        onSend={(id) => sendSms([id], id)}
        showResend
      />
      <TraineeGroup
        title="Sent, no response"
        emoji="⚠️"
        color="amber"
        trainees={sentNoResponse}
        empty="No trainees in this state."
        sending={sending}
        onSend={(id) => sendSms([id], id)}
      />
      <TraineeGroup
        title="Not sent yet"
        emoji="⚪"
        color="slate"
        trainees={notSent}
        empty="All trainees have been sent their link."
        sending={sending}
        onSend={(id) => sendSms([id], id)}
      />
    </div>
  )
}

function TraineeGroup({ title, emoji, color, trainees, empty, sending, onSend, showResend = false }) {
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
          {trainees.map((t) => (
            <li key={t.id} className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
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
              <div className="flex shrink-0 items-center gap-2">
                <a
                  href={`${window.location.origin}/register/${t.registration_token}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-slate-500 hover:text-slate-700 hover:underline"
                >
                  Preview
                </a>
                <button
                  onClick={() => onSend(t.id)}
                  disabled={sending !== null}
                  className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {sending === t.id ? 'Sending…' : showResend ? 'Resend text' : 'Send text'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
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

const inputCls =
  'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500'
