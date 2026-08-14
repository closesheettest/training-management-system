import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
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
  // The screen shows ONE training week at a time (the Monday that week starts on,
  // YYYY-MM-DD). Prev/Next arrows step weeks. Each week splits into Week A (a
  // cohort in week 1 — 2 nights, Mon–Wed) and Week B (a cohort in week 2 — 4
  // nights, Mon–Fri). '' until classes load, then the nearest upcoming week.
  const [weekMon, setWeekMon] = useState('')
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

  // Once classes load, default the cursor to the nearest upcoming training week.
  useEffect(() => {
    if (weekMon || classes.length === 0) return
    setWeekMon(defaultWeekMon(classes))
  }, [classes, weekMon])

  const loadForClass = useCallback(async () => {
    if (!weekMon || classes.length === 0) {
      setTrainees([])
      setStays([])
      return
    }
    setLoadingTrainees(true)
    // For the selected Monday, a class is in its WEEK A if it starts that Monday,
    // or its WEEK B if it started the Monday before (start + 7 days). One class
    // (one cohort) is only ever in ONE phase for a given week.
    const weekBStart = addDaysISO(weekMon, -7)
    const phaseByClass = {}
    const clsById = {}
    for (const c of classes) {
      if (c.cancelled_at) continue
      const start = mondayOf(c.week_start_date)
      if (start === weekMon) { phaseByClass[c.id] = 'A'; clsById[c.id] = c }
      else if (start === weekBStart) { phaseByClass[c.id] = 'B'; clsById[c.id] = c }
    }
    const ids = Object.keys(clsById)
    if (ids.length === 0) {
      setTrainees([])
      setStays([])
      setLoadingTrainees(false)
      return
    }
    const [tRes, sRes] = await Promise.all([
      supabase
        .from('trainees')
        .select('id, class_id, first_name, last_name, phone, email, street_address, city, state, zip, enrolled, declined_at, needs_hotel, confirmation_status, attendance(attendance_date, confirmed)')
        .in('class_id', ids)
        .eq('needs_hotel', true),
      supabase
        .from('trainee_hotel_stays')
        .select('*')
        .in('class_id', ids),
    ])
    if (tRes.error || sRes.error) {
      setFlash({ kind: 'error', text: (tRes.error || sRes.error).message })
      setLoadingTrainees(false)
      return
    }
    // Tag each trainee with its phase for THIS week + the default room dates:
    //   Week A → check-in Mon, checkout Wed (2 nights)
    //   Week B → check-in Mon, checkout Fri (4 nights)
    const rows = (tRes.data || [])
      .filter((t) => t.enrolled !== false && !t.declined_at)
      .map((t) => {
        const phase = phaseByClass[t.class_id]
        const cls = clsById[t.class_id]
        const checkedIn = (t.attendance || []).some((a) => a.confirmed && a.attendance_date === weekMon)
        return {
          ...t,
          _cls: cls || null,
          _venue: cls?.locations || null,
          _phase: phase,
          _checkIn: weekMon,
          _checkOut: addDaysISO(weekMon, phase === 'B' ? 4 : 2),
          _checkedIn: checkedIn,
        }
      })
    rows.sort((a, b) => (a.last_name || '').localeCompare(b.last_name || ''))
    setTrainees(rows)
    setStays(sRes.data || [])
    setLoadingTrainees(false)
  }, [weekMon, classes])

  useEffect(() => {
    loadForClass()
  }, [loadForClass])

  // Rooms are now per (trainee, phase) so a trainee can hold an A room AND a B
  // room. Legacy rows (phase null) count as 'A'.
  const stayFor = useCallback(
    (t) => stays.find((s) => s.trainee_id === t.id && (s.phase || 'A') === (t._phase || 'A')) || null,
    [stays],
  )

  // "Book Hotel" — opens the inline form with the hotel fields BLANK (HR types
  // the hotel they actually reserved) but the phase, week dates, and guest name
  // pre-filled. Training is at a fixed office now, so there's no venue to copy.
  function startCustomBooking(trainee) {
    const existing = stayFor(trainee)
    if (existing) {
      setDraft({ ...existing })
      setEditingStayId(existing.id)
    } else {
      // Brand-new "different hotel" stay — start with EMPTY hotel fields
      // (HR is entering a non-default), but keep the guest + phase/date defaults.
      setDraft({
        trainee_id: trainee.id,
        class_id: trainee._cls?.id || null,
        phase: trainee._phase || 'A',
        hotel_name: '',
        hotel_street_address: '',
        hotel_city: '',
        hotel_state: '',
        hotel_zip: '',
        hotel_phone: '',
        check_in_date: trainee._checkIn || '',
        check_out_date: trainee._checkOut || '',
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
    // Every booked-but-unsent room across the whole view (all weeks in ALL
    // mode). Send by explicit stay_ids so one click covers every class at once.
    const unsent = stays.filter((s) => !s.info_sent_at && !s.cancelled_at)
    if (unsent.length === 0) {
      setFlash({ kind: 'info', text: 'Nothing to send — every booked room has already been sent.' })
      return
    }
    if (!confirm(`Send hotel info to ${unsent.length} trainee${unsent.length === 1 ? '' : 's'} now?`)) return
    setSending(true)
    setFlash(null)
    try {
      const res = await fetch('/.netlify/functions/send-hotel-info-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stay_ids: unsent.map((s) => s.id), notify_admin: true }),
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

  const totalBookings = stays.filter((s) => !s.cancelled_at).length
  const unsentCount = stays.filter((s) => !s.info_sent_at && !s.cancelled_at).length
  const sentCount = stays.filter((s) => s.info_sent_at && !s.cancelled_at).length
  const unbookedCount = trainees.filter((t) => !stayFor(t)).length

  // The two cohorts sharing this week — Week A (2 nights) then Week B (4 nights).
  const weekA = trainees.filter((t) => t._phase === 'A')
  const weekB = trainees.filter((t) => t._phase === 'B')
  const orderedTrainees = [...weekA, ...weekB]

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Hotel rooms</h1>
        <p className="mt-2 text-slate-600">
          One training week at a time, split into <strong>Week A</strong> (a cohort in week 1 —
          Mon &amp; Tue nights, checkout Wed) and <strong>Week B</strong> (a cohort in week 2 —
          Mon–Thu nights, checkout Fri). Book each room (one click uses their meeting venue and
          the right dates), then <strong>Send hotel info to everyone</strong> in one shot.
        </p>
      </header>

      {/* Week navigator */}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <button
          type="button"
          onClick={() => setWeekMon((w) => addDaysISO(w, -7))}
          disabled={!weekMon}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          ◀ Prev week
        </button>
        <div className="text-center">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Week of</div>
          <div className="text-sm font-semibold text-slate-800">
            {weekMon ? `${formatDate(weekMon)} – ${formatDate(addDaysISO(weekMon, 4))}` : '—'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setWeekMon((w) => addDaysISO(w, 7))}
          disabled={!weekMon}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          Next week ▶
        </button>
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

      {weekMon && (
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
              {sending ? 'Sending…' : `🏨 Send hotel info to everyone (${unsentCount})`}
            </button>
          </div>

          {loadingTrainees ? (
            <p className="text-sm text-slate-500">Loading trainees…</p>
          ) : orderedTrainees.length === 0 ? (
            <div className="rounded-md border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600">
              <p>Nobody needs a hotel for this week.</p>
              <p className="mt-1 text-xs text-slate-500">
                Trainees appear here when the hiring manager answered "Yes" to "Needs hotel," in
                the week their cohort is on-site. Use ◀ / ▶ to check another week.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {orderedTrainees.map((t, i) => {
                const stay = stayFor(t)
                const editing =
                  editingStayId === t.id ||
                  editingStayId === `new-${t.id}` ||
                  (stay && editingStayId === stay.id)
                const rowClass = t._cls
                // Phase section header before the first card of each group.
                const showHeader = i === 0 || orderedTrainees[i - 1]._phase !== t._phase
                const isB = t._phase === 'B'
                return (
                  <Fragment key={t.id}>
                  {showHeader && (
                    <li className="list-none border-0 bg-transparent p-0 shadow-none">
                      <div className={'mt-3 flex flex-wrap items-baseline gap-2 rounded-md px-3 py-2 ' + (isB ? 'bg-indigo-50 text-indigo-900' : 'bg-emerald-50 text-emerald-900')}>
                        <span className="text-sm font-bold uppercase tracking-wide">Week {isB ? 'B' : 'A'}</span>
                        <span className="text-xs font-medium">
                          {isB ? 'Mon–Thu nights · checkout Fri · 4 nights' : 'Mon & Tue nights · checkout Wed · 2 nights'}
                          {' · '}{formatDate(t._checkIn)} → {formatDate(t._checkOut)}
                        </span>
                        <span className="text-xs opacity-70">({isB ? weekB.length : weekA.length})</span>
                      </div>
                    </li>
                  )}
                  <li
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
                          {t._phase === 'A' && t._checkedIn && (
                            <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700">✓ checked in</span>
                          )}
                          {t._phase === 'B' && t.confirmation_status === 'confirmed' && (
                            <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700">✓ confirmed</span>
                          )}
                          {t._phase === 'B' && t.confirmation_status !== 'confirmed' && (
                            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">awaiting Fri confirm</span>
                          )}
                        </div>
                        {t._cls && (
                          <div className="mt-0.5 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                            {t._cls.region || 'Region TBD'}
                            {t._cls.locations?.name ? ` · ${t._cls.locations.name}` : ''}
                          </div>
                        )}
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
                          <button
                            type="button"
                            onClick={() => startCustomBooking(t)}
                            className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700"
                            title="Enter the hotel you booked (name, address, phone). Dates are pre-filled for this week."
                          >
                            🏨 Book Hotel
                          </button>
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
                              const noShow = isHotelNoShow(t, rowClass)
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
                  </Fragment>
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

function HotelForm({ draft, setDraft, onUseName, onCancel, onSave, saving }) {
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

// Today (America/New_York) as YYYY-MM-DD.
function todayISO() {
  const p = {}
  for (const part of new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())) p[part.type] = part.value
  return `${p.year}-${p.month}-${p.day}`
}

// Add n days to a YYYY-MM-DD (UTC math — no TZ drift on date-only values).
function addDaysISO(iso, n) {
  if (!iso) return iso
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}

// The Monday of the week containing a YYYY-MM-DD (training weeks start Monday).
function mondayOf(iso) {
  if (!iso) return iso
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  const dow = dt.getUTCDay() // 0=Sun..6=Sat
  const back = dow === 0 ? 6 : dow - 1
  return addDaysISO(iso, -back)
}

// Default the week cursor to the nearest upcoming training week: the smallest
// class-start Monday (or the following-week Monday for a class in its Week B)
// that is >= this week's Monday. Falls back to this week's Monday.
function defaultWeekMon(classes) {
  // Open on the COMING training week — the nearest week whose Monday is today or
  // later. Once a week is underway (mid-week), it's already booked, so we skip to
  // the next one; the ◀ arrow still goes back. On a Monday it shows that week.
  const today = todayISO()
  const mondays = new Set()
  for (const c of classes || []) {
    if (c.cancelled_at || !c.week_start_date) continue
    const a = mondayOf(c.week_start_date)
    mondays.add(a)
    mondays.add(addDaysISO(a, 7)) // that cohort's Week B
  }
  const upcoming = [...mondays].filter((m) => m >= today).sort()
  return upcoming[0] || mondayOf(today)
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
