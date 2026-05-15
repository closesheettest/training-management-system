import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { US_STATES } from '../lib/locations.js'

// Hotels page — HR's workspace for capturing hotel-room details per
// trainee and texting each one their room info.
//
// Flow:
//   1. Pick a class week from the dropdown
//   2. See every enrolled trainee for that class
//   3. For each one that needs a hotel, click "Add hotel" → form opens
//      - "Same as meeting venue" autofills from the class's location
//      - "Use trainee's name" autofills guest_name from the trainee
//   4. Save the stay (independent of sending; HR can come back later)
//   5. When everyone's set, click "Send all unsent" to text them all
//      (each stay also has its own Send/Re-send button)

const blankStay = (traineeId, classId, trainee) => ({
  trainee_id: traineeId,
  class_id: classId,
  hotel_name: '',
  hotel_street_address: '',
  hotel_city: '',
  hotel_state: '',
  hotel_zip: '',
  hotel_phone: '',
  check_in_date: '',
  check_out_date: '',
  confirmation_number: '',
  guest_name: trainee ? `${trainee.first_name || ''} ${trainee.last_name || ''}`.trim() : '',
  room_number: '',
  notes: '',
})

export default function Hotels() {
  const [classes, setClasses] = useState([])
  const [selectedClassId, setSelectedClassId] = useState('')
  const [trainees, setTrainees] = useState([])
  const [stays, setStays] = useState([]) // existing rows from DB
  const [editing, setEditing] = useState(null) // trainee_id of the row being edited (or 'new-<id>')
  const [draft, setDraft] = useState(null)
  const [loadingTrainees, setLoadingTrainees] = useState(false)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [flash, setFlash] = useState(null)

  // Load the class list once.
  useEffect(() => {
    loadClasses()
  }, [])

  async function loadClasses() {
    const { data, error } = await supabase
      .from('classes')
      .select('id, region, week_start_date, week_end_date, location_id, locations(name, street_address, city, state, zip)')
      .order('week_start_date', { ascending: false })
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      return
    }
    setClasses(data || [])
  }

  const loadForClass = useCallback(async () => {
    if (!selectedClassId) {
      setTrainees([])
      setStays([])
      return
    }
    setLoadingTrainees(true)
    const [tRes, sRes] = await Promise.all([
      supabase
        .from('trainees')
        .select('id, first_name, last_name, phone, email, street_address, city, state, zip, enrolled, declined_at')
        .eq('class_id', selectedClassId)
        .order('last_name', { ascending: true }),
      supabase
        .from('trainee_hotel_stays')
        .select('*')
        .eq('class_id', selectedClassId),
    ])
    if (tRes.error || sRes.error) {
      setFlash({ kind: 'error', text: (tRes.error || sRes.error).message })
      setLoadingTrainees(false)
      return
    }
    setTrainees((tRes.data || []).filter((t) => t.enrolled !== false && !t.declined_at))
    setStays(sRes.data || [])
    setLoadingTrainees(false)
  }, [selectedClassId])

  useEffect(() => {
    loadForClass()
  }, [loadForClass])

  const selectedClass = useMemo(
    () => classes.find((c) => c.id === selectedClassId) || null,
    [classes, selectedClassId],
  )
  const stayByTraineeId = useMemo(() => {
    const m = {}
    for (const s of stays) m[s.trainee_id] = s
    return m
  }, [stays])

  function startEdit(trainee) {
    const existing = stayByTraineeId[trainee.id]
    if (existing) {
      setDraft({ ...existing })
      setEditing(trainee.id)
    } else {
      setDraft(blankStay(trainee.id, selectedClassId, trainee))
      setEditing(`new-${trainee.id}`)
    }
    setFlash(null)
  }

  function cancelEdit() {
    setEditing(null)
    setDraft(null)
  }

  function copyFromMeetingVenue() {
    if (!selectedClass?.locations) return
    const l = selectedClass.locations
    setDraft({
      ...draft,
      hotel_name: l.name || '',
      hotel_street_address: l.street_address || '',
      hotel_city: l.city || '',
      hotel_state: l.state || '',
      hotel_zip: l.zip || '',
    })
  }

  function useTraineesName() {
    const t = trainees.find((x) => x.id === draft.trainee_id)
    if (!t) return
    setDraft({
      ...draft,
      guest_name: `${t.first_name || ''} ${t.last_name || ''}`.trim(),
    })
  }

  async function saveStay() {
    if (!draft.hotel_name.trim()) {
      setFlash({ kind: 'error', text: 'Hotel name is required.' })
      return
    }
    setSaving(true)
    const payload = {
      ...draft,
      updated_at: new Date().toISOString(),
      // Empty strings → null so PostgreSQL date columns don't error.
      check_in_date: draft.check_in_date || null,
      check_out_date: draft.check_out_date || null,
    }
    delete payload.id // let DB assign on insert; ignore on update via .eq
    let result
    if (editing.startsWith('new-')) {
      result = await supabase.from('trainee_hotel_stays').insert(payload).select().single()
    } else {
      result = await supabase
        .from('trainee_hotel_stays')
        .update(payload)
        .eq('id', draft.id)
        .select()
        .single()
    }
    setSaving(false)
    if (result.error) {
      setFlash({ kind: 'error', text: result.error.message })
      return
    }
    setFlash({ kind: 'success', text: 'Hotel info saved.' })
    setEditing(null)
    setDraft(null)
    await loadForClass()
  }

  async function deleteStay(stay) {
    if (!confirm('Delete this hotel stay? The trainee won\'t be notified.')) return
    const { error } = await supabase.from('trainee_hotel_stays').delete().eq('id', stay.id)
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      return
    }
    setFlash({ kind: 'success', text: 'Stay deleted.' })
    await loadForClass()
  }

  async function sendOne(stay) {
    if (!confirm(`Text ${stayLabel(stay)} their hotel info now?`)) return
    setSending(true)
    setFlash(null)
    try {
      const res = await fetch('/.netlify/functions/send-hotel-info-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stay_ids: [stay.id] }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.ok) {
        setFlash({ kind: 'error', text: j.error || 'Send failed.' })
      } else if (j.sent_count === 0) {
        const failures = (j.results || []).filter((r) => !r.ok)
        setFlash({
          kind: 'error',
          text: failures[0]?.error || 'Nothing was sent.',
        })
      } else {
        setFlash({ kind: 'success', text: `Sent to ${stayLabel(stay)}.` })
        await loadForClass()
      }
    } catch (err) {
      setFlash({ kind: 'error', text: err.message })
    } finally {
      setSending(false)
    }
  }

  async function sendAllUnsent() {
    const unsent = stays.filter((s) => !s.info_sent_at)
    if (unsent.length === 0) {
      setFlash({ kind: 'info', text: 'Nothing to send — every stay has already been sent.' })
      return
    }
    if (!confirm(`Send hotel info to ${unsent.length} trainee${unsent.length === 1 ? '' : 's'} now?`)) return
    setSending(true)
    setFlash(null)
    try {
      const res = await fetch('/.netlify/functions/send-hotel-info-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ class_id: selectedClassId, unsent_only: true }),
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
        await loadForClass()
      }
    } catch (err) {
      setFlash({ kind: 'error', text: err.message })
    } finally {
      setSending(false)
    }
  }

  function stayLabel(stay) {
    const t = trainees.find((x) => x.id === stay.trainee_id)
    return t ? `${t.first_name} ${t.last_name}` : 'this trainee'
  }

  const unsentCount = stays.filter((s) => !s.info_sent_at).length
  const sentCount = stays.length - unsentCount

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Hotel rooms</h1>
        <p className="mt-2 text-slate-600">
          For trainees who need a hotel during their training week, HR captures the room info
          here and texts each trainee their specific details. Separate from the meeting-venue
          address — sometimes the sleeping hotel and the meeting hotel are the same, sometimes
          different.
        </p>
      </header>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <label className="block text-sm font-medium text-slate-700">
          Week of training
          <select
            value={selectedClassId}
            onChange={(e) => setSelectedClassId(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">— Pick a class week —</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {formatDate(c.week_start_date)} — {c.region || 'Region TBD'}
                {c.locations?.name ? ` · ${c.locations.name}` : ' · Location TBD'}
              </option>
            ))}
          </select>
        </label>
      </div>

      {flash && (
        <div
          className={
            'rounded-md border p-3 text-sm ' +
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

      {selectedClassId && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
            <div className="text-slate-700">
              <strong>{stays.length}</strong> hotel stay{stays.length === 1 ? '' : 's'} captured
              · <strong>{sentCount}</strong> sent · <strong>{unsentCount}</strong> unsent
            </div>
            <button
              type="button"
              onClick={sendAllUnsent}
              disabled={sending || unsentCount === 0}
              className="rounded-md bg-slate-800 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-40"
            >
              {sending ? 'Sending…' : `Send all unsent (${unsentCount})`}
            </button>
          </div>

          {loadingTrainees ? (
            <p className="text-sm text-slate-500">Loading trainees…</p>
          ) : trainees.length === 0 ? (
            <p className="text-sm text-slate-500">No enrolled trainees in this class yet.</p>
          ) : (
            <ul className="space-y-3">
              {trainees.map((t) => {
                const stay = stayByTraineeId[t.id]
                return (
                  <li
                    key={t.id}
                    className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-slate-900">
                          {t.first_name} {t.last_name}
                        </div>
                        <div className="text-xs text-slate-500">
                          {t.phone || '— no phone —'}
                          {t.email && ` · ${t.email}`}
                        </div>
                        {t.street_address && (
                          <div className="mt-1 text-xs text-slate-500">
                            Home: {t.street_address}, {t.city}, {t.state} {t.zip}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 gap-2">
                        {stay ? (
                          <>
                            <button
                              type="button"
                              onClick={() => startEdit(t)}
                              className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => sendOne(stay)}
                              disabled={sending}
                              className="rounded-md bg-slate-800 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-40"
                            >
                              {stay.info_sent_at ? 'Re-send' : 'Send'}
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteStay(stay)}
                              className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                            >
                              Delete
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => startEdit(t)}
                            className="rounded-md bg-slate-800 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-900"
                          >
                            + Add hotel
                          </button>
                        )}
                      </div>
                    </div>

                    {stay && (
                      <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 space-y-0.5">
                        <div className="font-semibold text-slate-900">{stay.hotel_name}</div>
                        {(stay.hotel_street_address || stay.hotel_city) && (
                          <div>
                            {[stay.hotel_street_address, [stay.hotel_city, [stay.hotel_state, stay.hotel_zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')]
                              .filter(Boolean)
                              .join(', ')}
                          </div>
                        )}
                        {stay.hotel_phone && <div>Phone: {stay.hotel_phone}</div>}
                        {(stay.check_in_date || stay.check_out_date) && (
                          <div>
                            {stay.check_in_date && `Check-in: ${formatDate(stay.check_in_date)}`}
                            {stay.check_in_date && stay.check_out_date && ' · '}
                            {stay.check_out_date && `Check-out: ${formatDate(stay.check_out_date)}`}
                          </div>
                        )}
                        {stay.guest_name && <div>Booked under: {stay.guest_name}</div>}
                        {stay.confirmation_number && <div>Confirmation #: {stay.confirmation_number}</div>}
                        {stay.room_number && <div>Room: {stay.room_number}</div>}
                        {stay.notes && <div className="italic text-slate-600">"{stay.notes}"</div>}
                        <div className="mt-2 text-[10px] uppercase tracking-wide text-slate-400">
                          {stay.info_sent_at
                            ? `✓ Sent ${new Date(stay.info_sent_at).toLocaleString()}`
                            : '⏳ Not sent yet'}
                        </div>
                      </div>
                    )}

                    {editing === t.id || editing === `new-${t.id}` ? (
                      <HotelForm
                        draft={draft}
                        setDraft={setDraft}
                        meetingVenue={selectedClass?.locations}
                        onCopyVenue={copyFromMeetingVenue}
                        onUseName={useTraineesName}
                        onCancel={cancelEdit}
                        onSave={saveStay}
                        saving={saving}
                      />
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

function HotelForm({ draft, setDraft, meetingVenue, onCopyVenue, onUseName, onCancel, onSave, saving }) {
  const update = (field, value) => setDraft({ ...draft, [field]: value })
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSave()
      }}
      className="mt-4 rounded-md border border-slate-300 bg-white p-4 space-y-3"
    >
      <div className="flex flex-wrap gap-2">
        {meetingVenue && (
          <button
            type="button"
            onClick={onCopyVenue}
            className="rounded-md border border-sky-300 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-800 hover:bg-sky-100"
          >
            🏨 Same as meeting venue
          </button>
        )}
        <button
          type="button"
          onClick={onUseName}
          className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          👤 Use trainee's name as guest
        </button>
      </div>

      <Field label="Hotel name *">
        <input
          type="text"
          required
          value={draft.hotel_name}
          onChange={(e) => update('hotel_name', e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          placeholder="Hilton Garden Inn Orlando Airport"
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-6">
        <Field label="Street address" className="sm:col-span-6">
          <input
            type="text"
            value={draft.hotel_street_address}
            onChange={(e) => update('hotel_street_address', e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </Field>
        <Field label="City" className="sm:col-span-3">
          <input
            type="text"
            value={draft.hotel_city}
            onChange={(e) => update('hotel_city', e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </Field>
        <Field label="State" className="sm:col-span-1">
          <select
            value={draft.hotel_state}
            onChange={(e) => update('hotel_state', e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">—</option>
            {US_STATES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Zip" className="sm:col-span-2">
          <input
            type="text"
            value={draft.hotel_zip}
            onChange={(e) => update('hotel_zip', e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Hotel phone" className="sm:col-span-3">
          <input
            type="tel"
            value={draft.hotel_phone}
            onChange={(e) => update('hotel_phone', e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="(407) 555-1234"
          />
        </Field>
        <Field label="Confirmation #" className="sm:col-span-3">
          <input
            type="text"
            value={draft.confirmation_number}
            onChange={(e) => update('confirmation_number', e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Check-in date" className="sm:col-span-3">
          <input
            type="date"
            value={draft.check_in_date || ''}
            onChange={(e) => update('check_in_date', e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Check-out date" className="sm:col-span-3">
          <input
            type="date"
            value={draft.check_out_date || ''}
            onChange={(e) => update('check_out_date', e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Booked under (guest name)" className="sm:col-span-4">
          <input
            type="text"
            value={draft.guest_name}
            onChange={(e) => update('guest_name', e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Room # (if known)" className="sm:col-span-2">
          <input
            type="text"
            value={draft.room_number}
            onChange={(e) => update('room_number', e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Notes (optional)" className="sm:col-span-6">
          <textarea
            rows={2}
            value={draft.notes}
            onChange={(e) => update('notes', e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Breakfast included until 9 AM, free parking, etc."
          />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save hotel info'}
        </button>
      </div>
    </form>
  )
}

function Field({ label, children, className = '' }) {
  return (
    <label className={`block text-sm font-medium text-slate-700 ${className}`}>
      {label}
      <div className="mt-1">{children}</div>
    </label>
  )
}

function formatDate(iso) {
  if (!iso) return ''
  const [y, m, d] = String(iso).split('T')[0].split('-').map(Number)
  if (!y || !m || !d) return iso
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}
