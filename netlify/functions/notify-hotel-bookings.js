// notify-hotel-bookings.js
//
// Fired when the KIOSK sign-in is CLOSED for the day (Kiosk.jsx → closeSignIn).
// That's the "everyone who's coming is here" moment — so HR (Jen) gets ONE
// notification listing every trainee who checked in that day and still needs a
// hotel room (and isn't booked yet), plus a one-tap link to the hotel screen.
//
// No more ciphering class-by-class and no more "who needs a room?" guesswork —
// Jen books the rooms, then hits Send-all on the hotel screen.
//
// Request:
//   POST { class_id: '<uuid>', attendance_date?: 'YYYY-MM-DD' }
//     attendance_date defaults to today (ET). The kiosk passes its own `today`.
//
// Response:
//   { ok:true, notified:true,  count, names, recipients }   — fired
//   { ok:true, notified:false, reason:'nobody_unbooked' }   — nothing to do
//
// Fires on EVERY kiosk close, but only actually notifies when there are
// checked-in, hotel-needing trainees who aren't booked yet — so Day 1 lights it
// up and later days (everyone already booked) stay quiet automatically.
//
// Event key: 'hotel_bookings_needed' (Jen / HR is subscribed). Legacy role: hr.
//
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN, GHL_LOCATION_ID,
//      optional PUBLIC_SITE_URL / URL.

import { createClient } from '@supabase/supabase-js'
import { recipientsForEvent } from './_recipients.js'
import { notifyAll } from './_notify.js'

const SB_URL = process.env.SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SECRET_KEY

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method Not Allowed' })
  if (!SB_URL || !SB_KEY) return json(500, { ok: false, error: 'Missing SUPABASE env vars' })

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return json(400, { ok: false, error: 'Invalid JSON body' })
  }
  const classId = String(body.class_id || '').trim()
  if (!classId) return json(400, { ok: false, error: 'class_id required' })
  const date = String(body.attendance_date || '').trim() || todayET()

  const supabase = createClient(SB_URL, SB_KEY)

  const { data: cls, error: clsErr } = await supabase
    .from('classes')
    .select('id, region, week_start_date, week_end_date, locations(name, city)')
    .eq('id', classId)
    .maybeSingle()
  if (clsErr) return json(500, { ok: false, error: clsErr.message })
  if (!cls) return json(404, { ok: false, error: 'Class not found' })

  // Trainees in this class who need a hotel and checked in on `date`.
  const { data: trainees, error: tErr } = await supabase
    .from('trainees')
    .select('id, first_name, last_name, enrolled, left_company_at, declined_at, needs_hotel, attendance(attendance_date, confirmed)')
    .eq('class_id', classId)
    .eq('needs_hotel', true)
  if (tErr) return json(500, { ok: false, error: tErr.message })

  const checkedIn = (trainees || []).filter(
    (t) =>
      t.enrolled !== false && !t.left_company_at &&
      !t.declined_at &&
      (t.attendance || []).some((a) => a.confirmed && a.attendance_date === date),
  )

  // Drop anyone already booked (an open, non-cancelled stay).
  const { data: stays } = await supabase
    .from('trainee_hotel_stays')
    .select('trainee_id, cancelled_at')
    .eq('class_id', classId)
  const booked = new Set((stays || []).filter((s) => !s.cancelled_at).map((s) => s.trainee_id))
  const needBooking = checkedIn.filter((t) => !booked.has(t.id))

  if (needBooking.length === 0) {
    return json(200, { ok: true, notified: false, reason: 'nobody_unbooked', class_id: classId, date })
  }

  const names = needBooking.map((t) => `${t.first_name || ''} ${t.last_name || ''}`.trim()).sort()
  const siteUrl = (process.env.PUBLIC_SITE_URL || process.env.URL || process.env.DEPLOY_URL || '').replace(/\/$/, '')
  const link = siteUrl ? `${siteUrl}/hotels` : '/hotels'
  const venue = cls.locations?.name ? ` · ${cls.locations.name}` : ''
  const wk = cls.week_start_date ? ` (week of ${cls.week_start_date})` : ''
  const n = needBooking.length
  const nounp = n === 1 ? 'trainee needs' : 'trainees need'

  const smsBody =
    `🏨 Hotel bookings needed — ${n} ${nounp} a room for ${cls.region}${wk}: ` +
    `${names.join(', ')}. Book them all here → ${link}`

  const emailSubject = `🏨 ${n} hotel ${n === 1 ? 'room' : 'rooms'} to book — ${cls.region}${wk}`
  const emailBody =
    `Sign-in just closed for ${cls.region}${venue}${wk}.\n\n` +
    `These ${n} ${n === 1 ? 'trainee has' : 'trainees have'} checked in and still ${n === 1 ? 'needs' : 'need'} a hotel room:\n\n` +
    names.map((nm) => `  • ${nm}`).join('\n') +
    `\n\nBook their rooms, then hit "Send hotel info to all" on the hotel screen — everyone gets their room details in one tap:\n${link}\n`

  const { recipients, source } = await recipientsForEvent(supabase, 'hotel_bookings_needed', { legacyRole: 'hr' })
  if (!recipients.length) {
    return json(200, { ok: true, notified: false, reason: 'no_recipients', count: n, names })
  }

  const r = await notifyAll(recipients, { smsBody, emailSubject, emailBody, contactLabel: 'HR' })

  return json(200, {
    ok: true,
    notified: true,
    class_id: classId,
    date,
    count: n,
    names,
    recipients: recipients.map((x) => x.name),
    recipients_source: source,
    sms_sent: r.sms_sent,
    email_sent: r.email_sent,
    ...(r.errors?.length ? { errors: r.errors } : {}),
  })
}

// Today (America/New_York) as YYYY-MM-DD.
function todayET() {
  const p = {}
  for (const part of new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())) p[part.type] = part.value
  return `${p.year}-${p.month}-${p.day}`
}

function json(status, obj) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) }
}
