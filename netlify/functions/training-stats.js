// Read-only training stats for consumption by other apps (today: the CCG
// Claims Admin Dashboard's Smart Q&A, so "how many people graduated this
// week" / "who's in this week's class" can be answered there).
//
// Same posture as rep-zones.js: no auth, CORS-open, aggregate-only payload
// (names + counts), keeps TMS's Supabase keys inside TMS.
//
// Request:
//   GET /.netlify/functions/training-stats?range=this_week | last_week
//     (default this_week)
//
// Response:
//   {
//     ok: true,
//     range: 'this_week',
//     week: { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' },   // Mon..Sun (ET)
//     graduates: { count, names: [...], byRegion: { 'Zone 1': n, ... } },
//     inClass:   { count, names: [...], byRegion: { ... } },
//   }
//
// Definitions (mirror send-graduation-report.js / graduation-handoff.js):
//   • graduate  = trainee.enrolled !== false AND has a test_attempt with
//                 submitted_at, in a class whose week_end_date falls in the
//                 window (and not attendance_only / cancelled).
//   • in class  = enrolled trainee in a class overlapping the window.

import { createClient } from '@supabase/supabase-js'

const SB_URL = process.env.SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SECRET_KEY

const TZ = 'America/New_York'

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return cors(200, '')
  if (event.httpMethod && event.httpMethod !== 'GET') {
    return cors(405, JSON.stringify({ ok: false, error: 'Method not allowed' }))
  }
  if (!SB_URL || !SB_KEY) {
    return cors(500, JSON.stringify({ ok: false, error: 'Server misconfigured (missing Supabase env)' }))
  }

  const range = (event.queryStringParameters?.range || 'this_week').trim()
  const { startDate, endDate } = weekBounds(range)

  const supabase = createClient(SB_URL, SB_KEY)
  const { data: classes, error } = await supabase
    .from('classes')
    .select('id, region, week_start_date, week_end_date, attendance_only, cancelled_at, trainees!class_id(id, first_name, last_name, enrolled, region, test_attempts(submitted_at))')
    .gte('week_end_date', startDate)
    .lte('week_start_date', endDate)

  if (error) {
    return cors(500, JSON.stringify({ ok: false, error: error.message }))
  }

  const fullName = (t) => `${t.first_name || ''} ${t.last_name || ''}`.trim()
  const isGraduate = (t) => t.enrolled !== false && (t.test_attempts || []).some((a) => a.submitted_at)

  const gradNames = []
  const gradByRegion = {}
  const rosterNames = []
  const rosterByRegion = {}

  for (const c of classes || []) {
    if (c.cancelled_at) continue
    const trainees = c.trainees || []
    // Graduates: class GRADUATES (week_end_date) within the window.
    const gradWeek = c.week_end_date >= startDate && c.week_end_date <= endDate && !c.attendance_only
    // Roster: class overlaps the window at all.
    const overlaps = c.week_start_date <= endDate && c.week_end_date >= startDate

    for (const t of trainees) {
      const zone = t.region || c.region || '—'
      if (gradWeek && isGraduate(t)) {
        gradNames.push(fullName(t))
        gradByRegion[zone] = (gradByRegion[zone] || 0) + 1
      }
      if (overlaps && t.enrolled !== false) {
        rosterNames.push(fullName(t))
        rosterByRegion[zone] = (rosterByRegion[zone] || 0) + 1
      }
    }
  }

  return cors(200, JSON.stringify({
    ok: true,
    range,
    week: { start: startDate, end: endDate },
    graduates: { count: gradNames.length, names: gradNames.sort(), byRegion: gradByRegion },
    inClass: { count: rosterNames.length, names: rosterNames.sort(), byRegion: rosterByRegion },
  }))
}

// Monday..Sunday (ET) date strings for the requested week.
function weekBounds(range) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  })
  const p = {}
  for (const part of dtf.formatToParts(new Date())) p[part.type] = part.value
  const DOW = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }
  const dow = DOW[p.weekday] ?? 0
  const monday = new Date(Date.UTC(+p.year, +p.month - 1, +p.day))
  monday.setUTCDate(monday.getUTCDate() - dow)
  if (range === 'last_week') monday.setUTCDate(monday.getUTCDate() - 7)
  const sunday = new Date(monday)
  sunday.setUTCDate(sunday.getUTCDate() + 6)
  const fmt = (d) => d.toISOString().slice(0, 10)
  return { startDate: fmt(monday), endDate: fmt(sunday) }
}

function cors(status, body) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
    },
    body,
  }
}
