// Netlify Function: 10:30 AM hotel-no-show alert.
//
// Runs daily (via cron-job.org or similar). Finds every trainee whose
// needs_hotel=true who hasn't checked in by 10:30 AM today, then sends a
// summary SMS to HR (falls back to admin recipients, then to ADMIN_PHONE
// env var). Helps HR cancel unused hotel rooms quickly.
//
// Required env vars: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN,
// GHL_LOCATION_ID, CRON_SECRET
//
// Auth: include ?secret=<CRON_SECRET> or an X-Cron-Secret header.
//
// Query params:
//   ?dry_run=1   — log who would be alerted without sending SMS or stamping DB
//   ?date=YYYY-MM-DD — override the "today" check (useful for testing)
//
// Response: {
//   target_date, absent_count, sent_count, recipient_count,
//   role_used, absentees: [...], dry_run?
// }

import { createClient } from '@supabase/supabase-js'

const GHL_BASE = 'https://services.leadconnectorhq.com'
const GHL_VERSION = '2021-07-28'

export const handler = async (event) => {
  // Auth
  const provided =
    event.headers['x-cron-secret'] ||
    event.headers['X-Cron-Secret'] ||
    event.queryStringParameters?.secret
  if (!process.env.CRON_SECRET || provided !== process.env.CRON_SECRET) {
    return json(401, { error: 'Unauthorized' })
  }

  const missing = []
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'GHL_PIT_TOKEN', 'GHL_LOCATION_ID']) {
    if (!process.env[k]) missing.push(k)
  }
  if (missing.length) return json(500, { error: `Missing env vars: ${missing.join(', ')}` })

  const params = event.queryStringParameters || {}
  const dryRun = params.dry_run === '1' || params.dry_run === 'true'
  const today = params.date || computeFloridaToday()

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  // Pull all needs_hotel trainees who are enrolled and registered. We'll filter
  // by "class active today" and "no attendance today" in code (simpler than
  // building a complex PostgREST query).
  const { data: trainees, error: trErr } = await supabase
    .from('trainees')
    .select(`
      id,
      first_name,
      last_name,
      hotel_alert_sent_at,
      classes(week_start_date, week_end_date, region, locations(name)),
      attendance(attendance_date, confirmed)
    `)
    .eq('needs_hotel', true)
    .eq('enrolled', true)
    .eq('registered', true)

  if (trErr) return json(500, { error: `Supabase: ${trErr.message}` })

  const absentees = (trainees || []).filter((t) => {
    const start = t.classes?.week_start_date
    const end = t.classes?.week_end_date
    if (!start || !end) return false
    if (today < start || today > end) return false
    const checkedIn = (t.attendance || []).some(
      (a) => a.attendance_date === today && a.confirmed,
    )
    return !checkedIn
  })

  if (absentees.length === 0) {
    return json(200, {
      target_date: today,
      absent_count: 0,
      sent_count: 0,
      message: 'No hotel-needing no-shows today.',
    })
  }

  // Build summary message
  const message = buildMessage(absentees, today)

  // Look up recipients — HR first, then admin, then env var fallback
  const { phones, roleUsed } = await loadRecipientPhones(supabase)

  if (phones.length === 0) {
    return json(200, {
      target_date: today,
      absent_count: absentees.length,
      sent_count: 0,
      role_used: null,
      warning: 'No active recipients found in HR or Admin roles, and no ADMIN_PHONE env var. Add at least one in /notifications.',
      absentees: absentees.map((t) => `${t.first_name} ${t.last_name} (${t.classes?.region || 'Region'})`),
    })
  }

  if (dryRun) {
    return json(200, {
      target_date: today,
      absent_count: absentees.length,
      role_used: roleUsed,
      recipient_count: phones.length,
      dry_run: true,
      preview_message: message,
      absentees: absentees.map((t) => `${t.first_name} ${t.last_name} (${t.classes?.region || 'Region'})`),
    })
  }

  // Send SMS to each recipient
  let sentCount = 0
  for (const phone of phones) {
    if (await sendOneSms(phone, message)) sentCount++
  }

  // Stamp hotel_alert_sent_at on each absentee
  await supabase
    .from('trainees')
    .update({ hotel_alert_sent_at: new Date().toISOString() })
    .in('id', absentees.map((t) => t.id))

  return json(200, {
    target_date: today,
    absent_count: absentees.length,
    sent_count: sentCount,
    recipient_count: phones.length,
    role_used: roleUsed,
    absentees: absentees.map((t) => `${t.first_name} ${t.last_name} (${t.classes?.region || 'Region'})`),
  })
}

function buildMessage(absentees, dateIso) {
  const dateLabel = new Date(dateIso + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
  if (absentees.length === 1) {
    const t = absentees[0]
    const region = t.classes?.region || 'training'
    const loc = t.classes?.locations?.name
    const locStr = loc ? ` at ${loc}` : ''
    return `[Training] ${t.first_name} ${t.last_name} (${region}${locStr}) hasn't checked in by 10:30 AM on ${dateLabel}. They need a hotel — consider cancelling their room.`
  }
  const lines = absentees.map((t) => {
    const region = t.classes?.region || 'training'
    return `• ${t.first_name} ${t.last_name} (${region})`
  })
  return `[Training] ${absentees.length} hotel-needing trainees haven't checked in by 10:30 AM on ${dateLabel}:\n${lines.join('\n')}\nConsider cancelling their rooms.`
}

// Look up phones for HR -> Admin -> env var fallback.
async function loadRecipientPhones(supabase) {
  // Try HR first
  let { data } = await supabase
    .from('notification_recipients')
    .select('phone')
    .eq('role', 'hr')
    .eq('active', true)
    .not('phone', 'is', null)
  let phones = (data || []).map((r) => normalizePhone(r.phone)).filter(Boolean)
  if (phones.length > 0) return { phones, roleUsed: 'hr' }

  // Fall back to admin
  ;({ data } = await supabase
    .from('notification_recipients')
    .select('phone')
    .eq('role', 'admin')
    .eq('active', true)
    .not('phone', 'is', null))
  phones = (data || []).map((r) => normalizePhone(r.phone)).filter(Boolean)
  if (phones.length > 0) return { phones, roleUsed: 'admin (HR not set up)' }

  // Final fallback to env var
  const env = normalizePhone(process.env.ADMIN_PHONE)
  return env ? { phones: [env], roleUsed: 'ADMIN_PHONE env var' } : { phones: [], roleUsed: null }
}

async function sendOneSms(phone, message) {
  try {
    const cRes = await fetch(`${GHL_BASE}/contacts/upsert`, {
      method: 'POST',
      headers: ghlHeaders(),
      body: JSON.stringify({
        locationId: process.env.GHL_LOCATION_ID,
        phone,
        firstName: 'HR',
        lastName: 'Training System',
      }),
    })
    const cJson = await cRes.json().catch(() => ({}))
    if (!cRes.ok) return false
    const cId = cJson.contact?.id || cJson.id
    if (!cId) return false
    const sRes = await fetch(`${GHL_BASE}/conversations/messages`, {
      method: 'POST',
      headers: ghlHeaders(),
      body: JSON.stringify({ type: 'SMS', contactId: cId, message }),
    })
    return sRes.ok
  } catch {
    return false
  }
}

function ghlHeaders() {
  return {
    Authorization: `Bearer ${process.env.GHL_PIT_TOKEN}`,
    Version: GHL_VERSION,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

function normalizePhone(raw) {
  if (!raw) return null
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (digits.length >= 11 && String(raw).trim().startsWith('+')) return `+${digits}`
  return null
}

function computeFloridaToday() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return fmt.format(new Date())
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
