// Public-ish endpoint: THIS WEEK's field trainees who are NOT yet active reps —
// for CCG's field-training picker (William takes trainees out Thu/Fri before
// they graduate). A trainee is "this week" when today falls inside their class's
// week_start_date..week_end_date, and "in training" when is_active_sales_rep is
// not true. When they pass and flip to active, they drop off this list and join
// the normal rep rotation (their ride history is re-linked CCG-side by phone).
//
//   GET /.netlify/functions/trainees-this-week
//     → { ok, count, trainees:[{ id, name, first_name, last_name, phone }] }
//
// CORS: open (same as rep-zones — names + phones only).

import { createClient } from '@supabase/supabase-js'

const SB_URL = process.env.SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SECRET_KEY

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return cors(200, '')
  if (event.httpMethod !== 'GET') return cors(405, JSON.stringify({ ok: false, error: 'Method Not Allowed' }))
  if (!SB_URL || !SB_KEY) return cors(500, JSON.stringify({ ok: false, error: 'Missing SUPABASE env vars' }))

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) // YYYY-MM-DD ET
  const supabase = createClient(SB_URL, SB_KEY)

  // 1) In-training (not yet active), non-declined, STILL-ENROLLED trainees who
  //    have a class. The enrolled filter matters: un-enrolling a no-show (here or
  //    via mark-class-dropouts) has to actually drop them from this feed, or they
  //    keep showing up as someone to hand a map link to. `not.is.false` keeps
  //    enrolled=true AND enrolled=null (older rows), and drops only the explicitly
  //    un-enrolled.
  const { data: ts, error: e1 } = await supabase
    .from('trainees')
    .select('id, first_name, last_name, phone, is_active_sales_rep, declined_at, class_id')
    .is('declined_at', null)
    .not('enrolled', 'is', false)
    .order('last_name', { ascending: true })
  if (e1) return cors(500, JSON.stringify({ ok: false, error: e1.message }))
  const inTraining = (ts || []).filter((t) => t.is_active_sales_rep !== true && t.class_id)

  // 2) Keep only those whose class's week window contains today; capture the
  //    training LOCATION so William knows where to go.
  const currentClassIds = new Set()
  const classLoc = {}
  // The class's week start, so the caller can tell WHICH DAY of the week it is.
  // William's picker needs "day 2 of Week A", and a weekday number cannot answer
  // that on its own — a class that starts late, or on any day but Monday, would
  // put day 2 on a different weekday (Neal, 2026-08-25).
  const classStart = {}
  const classIds = [...new Set(inTraining.map((t) => t.class_id))]
  if (classIds.length) {
    const { data: cs } = await supabase
      .from('classes')
      .select('id, week_start_date, week_end_date, locations(name, street_address, city, state, zip)')
      .in('id', classIds)
      .lte('week_start_date', today)
      .gte('week_end_date', today)
    for (const c of cs || []) {
      currentClassIds.add(c.id)
      classStart[c.id] = c.week_start_date || null
      const l = Array.isArray(c.locations) ? c.locations[0] : c.locations
      if (l) classLoc[c.id] = { name: l.name || null, address: [l.street_address, l.city, l.state, l.zip].filter(Boolean).join(', ') || null }
    }
  }

  const weekTrainees = inTraining.filter((t) => currentClassIds.has(t.class_id))

  // 3) Keep only trainees STILL ACTIVE — those who signed in (attendance) on the
  //    MOST RECENT day this week. Mirrors the kiosk's carry-forward and drops
  //    no-shows/dropouts. If there's no attendance yet this week, show all.
  let activeIds = null
  const traineeIds = weekTrainees.map((t) => t.id)
  if (traineeIds.length) {
    const weekAgo = new Date(Date.now() - 8 * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
    const { data: att } = await supabase
      .from('attendance')
      .select('trainee_id, attendance_date')
      .in('trainee_id', traineeIds)
      .gte('attendance_date', weekAgo)
      .lte('attendance_date', today)
      .order('attendance_date', { ascending: false })
    if (att && att.length) {
      // ONCE ANYONE HAS SIGNED IN TODAY, TODAY IS THE ANSWER.
      //
      // This used to always use the most recent COMPLETED day, reasoning that
      // today's sign-ins are still trickling in and today alone would
      // under-count. That holds at 7 AM and is wrong by mid-morning: on the
      // Tuesday of Week A it listed all five of Monday's trainees when Kelvin
      // Rainwater had not turned up, and William would have been handed a name
      // who was not there (Neal, 2026-08-25).
      //
      // So: if the room has started signing in today, today's list is the live
      // one. Before the first sign-in there is nothing to go on, and the last
      // completed day is still the better guess than an empty room.
      const todayIds = att.filter((a) => a.attendance_date === today).map((a) => a.trainee_id)
      if (todayIds.length) {
        activeIds = new Set(todayIds)
      } else {
        const priorDates = att.map((a) => a.attendance_date).filter((dt) => dt < today)
        const activeDate = priorDates.length ? priorDates[0] : att[0].attendance_date
        activeIds = new Set(att.filter((a) => a.attendance_date === activeDate).map((a) => a.trainee_id))
      }
    }
  }

  const trainees = weekTrainees
    .filter((t) => (activeIds ? activeIds.has(t.id) : true))
    .map((t) => ({
      id: t.id,
      name: `${t.first_name || ''} ${t.last_name || ''}`.trim(),
      first_name: t.first_name || '',
      last_name: t.last_name || '',
      phone: t.phone || null,
      location: classLoc[t.class_id] || null,
      week_start_date: classStart[t.class_id] || null,
      // 1-based day of the class week: day 1 is week_start_date itself.
      class_day: dayOfWeekA(classStart[t.class_id], today),
    }))

  return cors(200, JSON.stringify({ ok: true, generated_at: new Date().toISOString(), count: trainees.length, trainees }))
}

function cors(status, body) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
    body,
  }
}

// Which day of the class week is `today`? 1 = the first day. Null when we cannot
// tell. Date-only strings, compared as UTC midnights so no timezone drift.
function dayOfWeekA(startDate, today) {
  if (!startDate || !today) return null
  const a = Date.parse(`${startDate}T00:00:00Z`)
  const b = Date.parse(`${today}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.floor((b - a) / 864e5) + 1
}
