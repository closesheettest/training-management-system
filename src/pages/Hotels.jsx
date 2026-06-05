import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { US_STATES } from '../lib/locations.js'

// Hotels page — HR's workspace for room bookings.
//
// Design philosophy: the common case is "room booked under the trainee's
// name at the same hotel as the meeting venue." That's a ONE-CLICK
// operation. The exception is "different hotel" — that opens a form.
//
// Flow:
//   1. Pick a class week from the dropdown.
//   2. See every trainee flagged "needs hotel" for that class.
//   3. For each one, two buttons:
//        ✓ Booked (same hotel) — one click. Pre-fills hotel = meeting
//          venue, guest_name = trainee name. Done.
//        Different hotel — opens a form to enter different hotel details.
//   4. Already-booked trainees show as cards with their saved info and
//      Edit / Re-send / Delete buttons.
//   5. "Send notifications" at the top fires SMS to every booked-but-
//      not-yet-notified trainee in one click.

export default function Hotels() {
  const [classes, setClasses] = useState([])
  const [selectedClassId, setSelectedClassId] = useState('')
  const [trainees, setTrainees] = useState([])
  const [stays, setStays] = useState([])
  const [editingStayId, setEditingStayId] = useState(null) // id of stay being edited inline (or 'new-<trainee_id>')
  const [draft, setDraft] = useState(null)
  const [loadingTrainees, setLoadingTrainees] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busyTraineeId, setBusyTraineeId] = useState(null)
  const [sending, setSending] = useState(false)
  const [flash, setFlash] = useState(null)

  useEffect(() => {
    loadClasses()
  }, [])

  async function loadClasses() {
    const { data, error } = await supabase
      .from('classes')
      .select('id, region, week_start_date, week_end_date, location_id, locations(name, street_address, city, state, zip, phone)')
      .order('week_start_date', { ascending: true })
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
        .select('id, first_name, last_name, phone, email, street_address, city, state, zip, enrolled, declined_at, needs_hotel, attendance(attendance_date, confirmed)')
        .eq('class_id', selectedClassId)
        .eq('needs_hotel', true)
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
  const meetingVenue = selectedClass?.locations || null
  const stayByTraineeId = useMemo(() => {
    const m = {}
    for (const s of stays) m[s.trainee_id] = s
    return m
  }, [stays])

  // One-click "Booked" — creates a stay with hotel info copied from the
  // class's meeting venue and guest_name from the trainee. Defaults the
  // common case to zero friction.
  async function quickBook(trainee) {
    if (!meetingVenue) {
      setFlash({
        kind: 'error',
        text: 'This class doesn\'t have a meeting venue set yet — pick one on the Schedule page first, then come back.',
      })
      return
    }
    setBusyTraineeId(trainee.id)
    setFlash(null)
    const payload = {
      trainee_id: trainee.id,
      class_id: selectedClassId,
      hotel_name: meetingVenue.name || '',
      hotel_street_address: meetingVenue.street_address || null,
      hotel_city: meetingVenue.city || null,
      hotel_state: meetingVenue.state || null,
      hotel_zip: meetingVenue.zip || null,
      hotel_phone: meetingVenue.phone || null,
      guest_name: `${trainee.first_name || ''} ${trainee.last_name || ''}`.trim(),
    }
    const { error } = await supabase.from('trainee_hotel_stays').insert(payload)
    setBusyTraineeId(null)
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      return
    }
    setFlash({ kind: 'success', text: `Marked booked: ${trainee.first_name} ${trainee.last_name}` })
    await loadForClass()
  }

  // "Different hotel" — opens the inline form pre-filled with the same
  // defaults but everything is editable. HR overrides whatever's
  // different, hits Save.
  function startCustomBooking(trainee) {
    const existing = stayByTraineeId[trainee.id]
    if (existing) {
      setDraft({ ...existing })
      setEditingStayId(existing.id)
    } else {
      // Brand-new "different hotel" stay — start with EMPTY hotel fields
      // (HR is entering a non-default), but keep the guest defaults.
      setDraft({
        trainee_id: trainee.id,
        class_id: selectedClassId,
        hotel_name: '',
        hotel_street_address: '',
        hotel_city: '',
        hotel_state: '',
        hotel_zip: '',
        hotel_phone: '',
        check_in_date: '',
        check_out_date: '',
        confirmation_number: '',
        guest_name: `${trainee.first_name || ''} ${trainee.last_name || ''}`.trim(),
        room_number: '',
        notes: '',
      })
      setEditingStayId(`new-${trainee.id}`)
    }
    setFlash(null)
  }

  function cancelEdit() {
    setEditingStayId(null)
    setDraft(null)
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
      check_in_date: draft.check_in_date || null,
      check_out_date: draft.check_out_date || null,
    }
    delete payload.id
    let result
    if (editingStayId.startsWith('new-')) {
      result = await supabase.from('trainee_hotel_stays').insert(payload)
    } else {
      result = await supabase
        .from('trainee_hotel_stays')
        .update(payload)
        .eq('id', editingStayId)
    }
    setSaving(false)
    if (result.error) {
      setFlash({ kind: 'error', text: result.error.message })
      return
    }
    setFlash({ kind: 'success', text: 'Hotel info saved.' })
    setEditingStayId(null)
    setDraft(null)
    await loadForClass()
  }

  async function deleteStay(stay) {
    if (!confirm('Remove this booking? The trainee will be back to "not booked".')) return
    const { error } = await supabase.from('trainee_hotel_stays').delete().eq('id', stay.id)
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      return
    }
    setFlash({ kind: 'success', text: 'Booking removed.' })
    await loadForClass()
  }

  // "Cancelled Hotel" — the trainee no-showed and HR has cancelled the
  // unused room. Stamps cancelled_at, which is the OFF SWITCH for the
  // hourly "cancel this room" nag texts. The booking stays on record
  // (shown as cancelled) so HR can see it was handled.
  async function cancelStay(stay) {
    if (!confirm(`Mark ${stayLabel(stay)}'s room as cancelled? This stops the hourly "cancel the room" alert texts.`)) return
    setBusyTraineeId(stay.trainee_id)
    const { error } = await supabase
      .from('trainee_hotel_stays')
      .update({ cancelled_at: new Date().toISOString() })
      .eq('id', stay.id)
    setBusyTraineeId(null)
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      return
    }
    setFlash({ kind: 'success', text: `Hotel cancelled for ${stayLabel(stay)}. The hourly alerts will stop.` })
    await loadForClass()
  }

  // Undo a cancel (e.g. pressed by mistake, or the trainee showed up after
  // all). Clears cancelled_at so the booking is "open" again.
  async function uncancelStay(stay) {
    setBusyTraineeId(stay.trainee_id)
    const { error } = await supabase
      .from('trainee_hotel_stays')
      .update({ cancelled_at: null })
      .eq('id', stay.id)
    setBusyTraineeId(null)
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      return
    }
    setFlash({ kind: 'success', text: `Reopened booking for ${stayLabel(stay)}.` })
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
        setFlash({ kind: 'error', text: failures[0]?.error || 'Nothing was sent.' })
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
      setFlash({ kind: 'info', text: 'Nothing to send — every booking has already been sent.' })
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

  const totalBookings = stays.length
  const unsentCount = stays.filter((s) => !s.info_sent_at).length
  const sentCount = totalBookings - unsentCount
  const unbookedCount = trainees.filter((t) => !stayByTraineeId[t.id]).length

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Hotel rooms</h1>
        <p className="mt-2 text-slate-600">
          For trainees flagged "needs hotel" during enrollment, mark each one booked once
          you've reserved their room. Most rooms default to the same hotel as the meeting
          venue and are booked under the trainee's name — that's one click. Use{' '}
          <strong>Different hotel</strong> only when the sleeping hotel is different from
          the meeting venue.
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

      {selectedClassId && meetingVenue && (
        <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-sky-900">
            Meeting venue (default hotel for "Booked")
          </div>
          <div className="mt-1 text-slate-800">
            <strong>{meetingVenue.name}</strong>
            {(meetingVenue.street_address || meetingVenue.city) && (
              <span className="ml-2 text-slate-600">
                {[
                  meetingVenue.street_address,
                  [meetingVenue.city, [meetingVenue.state, meetingVenue.zip].filter(Boolean).join(' ')]
                    .filter(Boolean)
                    .join(', '),
                ]
                  .filter(Boolean)
                  .join(', ')}
              </span>
            )}
            {meetingVenue.phone && (
              <span className="ml-2 text-slate-500">· {meetingVenue.phone}</span>
            )}
          </div>
        </div>
      )}

      {selectedClassId && !meetingVenue && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          ⚠ This class doesn't have a meeting venue assigned yet. Add one on the Schedule
          page before booking rooms — "Hotel Booked" needs a venue to default from.
        </div>
      )}

      {selectedClassId && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
            <div className="text-slate-700">
              <strong>{trainees.length}</strong> trainee{trainees.length === 1 ? '' : 's'} need
              hotel ·{' '}
              <strong>{totalBookings}</strong> booked ·{' '}
              <strong>{unsentCount}</strong> ready to send ·{' '}
              <strong>{sentCount}</strong> notification{sentCount === 1 ? '' : 's'} sent
            </div>
            <button
              type="button"
              onClick={sendAllUnsent}
              disabled={sending || unsentCount === 0}
              className="rounded-md bg-slate-800 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-40"
            >
              {sending ? 'Sending…' : `Send notifications (${unsentCount})`}
            </button>
          </div>

          {loadingTrainees ? (
            <p className="text-sm text-slate-500">Loading trainees…</p>
          ) : trainees.length === 0 ? (
            <div className="rounded-md border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600">
              <p>No trainees in this class are flagged as needing a hotel.</p>
              <p className="mt-1 text-xs text-slate-500">
                Trainees only appear here when the hiring manager answered "Yes" to "Needs hotel"
                during enrollment.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {trainees.map((t) => {
                const stay = stayByTraineeId[t.id]
                const editing =
                  editingStayId === t.id ||
                  editingStayId === `new-${t.id}` ||
                  (stay && editingStayId === stay.id)
                return (
                  <li
                    key={t.id}
                    className={
                      'rounded-lg border p-4 shadow-sm ' +
                      (stay
                        ? stay.cancelled_at
                          ? 'border-slate-300 bg-slate-100'
                          : stay.info_sent_at
                            ? 'border-emerald-200 bg-emerald-50/30'
                            : 'border-sky-200 bg-sky-50/30'
                        : 'border-slate-200 bg-white')
                    }
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
                        {!stay && t.street_address && (
                          <div className="mt-1 text-xs text-slate-500">
                            Home: {t.street_address}, {t.city}, {t.state} {t.zip}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        {!stay ? (
                          <>
                            <button
                              type="button"
                              onClick={() => quickBook(t)}
                              disabled={busyTraineeId === t.id || !meetingVenue}
                              className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
                              title={
                                meetingVenue
                                  ? 'One-click: book this trainee at the meeting venue under their own name'
                                  : 'Add a meeting venue to the class first'
                              }
                            >
                              {busyTraineeId === t.id ? 'Saving…' : '🏨 Book Hotel'}
                            </button>
                            <button
                              type="button"
                              onClick={() => startCustomBooking(t)}
                              className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              Different hotel
                            </button>
                          </>
                        ) : stay.cancelled_at ? (
                          <button
                            type="button"
                            onClick={() => uncancelStay(stay)}
                            disabled={busyTraineeId === t.id}
                            className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                          >
                            {busyTraineeId === t.id ? 'Working…' : 'Undo cancel'}
                          </button>
                        ) : (
                          <>
                            <span className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                              ✓ Hotel booked
                            </span>
                            {!stay.info_sent_at && (
                              <button
                                type="button"
                                onClick={() => sendOne(stay)}
                                disabled={sending}
                                className="rounded-md bg-slate-800 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-40"
                              >
                                Send now
                              </button>
                            )}
                            {stay.info_sent_at && (
                              <button
                                type="button"
                                onClick={() => sendOne(stay)}
                                disabled={sending}
                                className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                              >
                                Re-send
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => startCustomBooking(t)}
                              className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              Edit
                            </button>
                            {(() => {
                              const noShow = isHotelNoShow(t, selectedClass)
                              return (
                                <button
                                  type="button"
                                  onClick={() => cancelStay(stay)}
                                  disabled={busyTraineeId === t.id || !noShow}
                                  className="rounded-md border border-amber-400 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-white disabled:text-slate-400"
                                  title={noShow
                                    ? 'The trainee no-showed — cancel their unused room and stop the hourly alert texts'
                                    : 'Only available once the trainee is a no-show (hasn\'t signed into class by class start)'}
                                >
                                  Cancel Hotel
                                </button>
                              )
                            })()}
                            <button
                              type="button"
                              onClick={() => deleteStay(stay)}
                              className="rounded-md border border-red-300 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                            >
                              Remove
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {stay && (
                      <div className="mt-3 rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-700 space-y-0.5">
                        <div className="font-semibold text-slate-900">{stay.hotel_name}</div>
                        {(stay.hotel_street_address || stay.hotel_city) && (
                          <div>
                            {[
                              stay.hotel_street_address,
                              [stay.hotel_city, [stay.hotel_state, stay.hotel_zip].filter(Boolean).join(' ')]
                                .filter(Boolean)
                                .join(', '),
                            ]
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
                          {stay.cancelled_at
                            ? `✕ Hotel cancelled ${new Date(stay.cancelled_at).toLocaleString()} — no-show alerts stopped`
                            : stay.info_sent_at
                              ? `✓ Notification sent ${new Date(stay.info_sent_at).toLocaleString()}`
                              : '⏳ Booked — notification ready to send'}
                        </div>
                      </div>
                    )}

                    {editing && (
                      <HotelForm
                        draft={draft}
                        setDraft={setDraft}
                        meetingVenue={meetingVenue}
                        onCopyVenue={() => {
                          if (!meetingVenue) return
                          setDraft({
                            ...draft,
                            hotel_name: meetingVenue.name || '',
                            hotel_street_address: meetingVenue.street_address || '',
                            hotel_city: meetingVenue.city || '',
                            hotel_state: meetingVenue.state || '',
                            hotel_zip: meetingVenue.zip || '',
                            hotel_phone: meetingVenue.phone || '',
                          })
                        }}
                        onUseName={() => {
                          setDraft({
                            ...draft,
                            guest_name: `${t.first_name || ''} ${t.last_name || ''}`.trim(),
                          })
                        }}
                        onCancel={cancelEdit}
                        onSave={saveStay}
                        saving={saving}
                      />
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          {unbookedCount === 0 && trainees.length > 0 && unsentCount > 0 && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              All {trainees.length} hotel-needing trainee{trainees.length === 1 ? ' is' : 's are'}{' '}
              booked. Click <strong>Send notifications ({unsentCount})</strong> above to fire the
              texts.
            </div>
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
            🏨 Copy meeting venue
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
              <option key={s.code} value={s.code}>{s.code}</option>
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

// Current date + hour in Florida (America/New_York), DST-safe — mirrors
// the clock logic in send-hotel-noshow-alert.js.
function floridaNowParts() {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', hour12: false,
  }).format(new Date()))
  return { today, hour }
}

// A booked trainee is a hotel "no-show" — and their room can be cancelled —
// when it's a class day, we're past the class-start grace (Day 1 noon /
// Day 2+ 10 AM, matching the cron), and they have no confirmed attendance
// today. Until then the Cancel Hotel button stays disabled.
function isHotelNoShow(trainee, cls) {
  if (!cls) return false
  const start = cls.week_start_date
  const end = cls.week_end_date
  if (!start || !end) return false
  const { today, hour } = floridaNowParts()
  if (today < start || today > end) return false
  const earliestHour = today === start ? 12.5 : 10.5
  if (hour < earliestHour) return false
  const checkedIn = (trainee.attendance || []).some(
    (a) => a.attendance_date === today && a.confirmed,
  )
  return !checkedIn
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
