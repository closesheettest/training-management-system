// Netlify Function: day-2 IT provisioning reminder.
//
// Cron-triggered (cron-job.org or similar). Hourly between 7–11 AM Eastern is
// fine. For each active class:
//   - Computes day 2 = week_start_date + 1
//   - If today is day 2 and day_2_it_notified_at IS NULL:
//       * If any trainee has signed in today (=day 2 attendance), fire NOW.
//       * Else if Florida-local hour >= 11, fire as the fallback.
//       * Else skip — wait for either a sign-in or 11 AM.
//   - On fire: text IT subscribers (event 'day_2_provision_due') and stamp
//     day_2_it_notified_at so we don't double-fire.
//
// Required env vars: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN,
// GHL_LOCATION_ID, CRON_SECRET. Optional: PUBLIC_SITE_URL.
//
// Auth: include ?secret=<CRON_SECRET> or an X-Cron-Secret header.
//
// Query params:
//   ?dry_run=1   — log who would be notified without sending or stamping
//   ?date=YYYY-MM-DD — override "today" for testing
//   ?hour=N      — override Florida hour (0–23) for testing
//
// Response: { target_date, classes_checked, classes_fired, results: [...] }

import { createClient } from '@supabase/supabase-js'
import { recipientPhonesForEvent } from './_recipients.js'

const GHL_BASE = 'https://services.leadconnectorhq.com'
const GHL_VERSION = '2021-07-28'
const FALLBACK_HOUR = 11

export const handler = async (event) => {
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
  const currentHour = params.hour !== undefined ? Number(params.hour) : computeFloridaHour()

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const siteUrl = (process.env.PUBLIC_SITE_URL || process.env.URL || process.env.DEPLOY_URL || '').replace(/\/$/, '')

  // Find every class whose day 2 is today and that hasn't been notified yet.
  // We can't filter by day_2 = today in PostgREST easily, so pull and filter in code.
  const { data: candidates, error: clsErr } = await supabase
    .from('classes')
    .select('id, region, week_start_date, week_end_date, day_2_it_notified_at, locations(name), attendance(attendance_date, confirmed)')
    .is('day_2_it_notified_at', null)
    .lte('week_start_date', today)
    .gte('week_end_date', today)
  if (clsErr) return json(500, { error: `Supabase: ${clsErr.message}` })

  const day2Classes = (candidates || []).filter((c) => addDaysIso(c.week_start_date, 1) === today)

  const results = []
  let firedCount = 0

  for (const cls of day2Classes) {
    const hasSignIn = (cls.attendance || []).some(
      (a) => a.attendance_date === today && a.confirmed,
    )
    const pastFallback = currentHour >= FALLBACK_HOUR
    const shouldFire = hasSignIn || pastFallback
    if (!shouldFire) {
      results.push({
        class_id: cls.id,
        region: cls.region,
        location: cls.locations?.name || null,
        fired: false,
        reason: `Waiting for first sign-in or ${FALLBACK_HOUR}:00 fallback (current hour: ${currentHour})`,
      })
      continue
    }

    const message = buildMessage(cls, siteUrl, hasSignIn ? 'sign_in' : 'fallback_hour')
    const { phones, source } = await recipientPhonesForEvent(supabase, 'day_2_provision_due', {
      legacyRole: 'it',
    })

    if (phones.length === 0) {
      results.push({
        class_id: cls.id,
        region: cls.region,
        location: cls.locations?.name || null,
        fired: false,
        warning: 'No active IT subscribers found. Add at least one in /notifications.',
        recipients_source: source,
      })
      continue
    }

    if (dryRun) {
      results.push({
        class_id: cls.id,
        region: cls.region,
        location: cls.locations?.name || null,
        dry_run: true,
        would_send_to: phones.length,
        preview_message: message,
        trigger: hasSignIn ? 'first_sign_in' : 'fallback_hour',
      })
      continue
    }

    let sentCount = 0
    const sendErrors = []
    for (const phone of phones) {
      const r = await sendOneSms(phone, message)
      if (r.ok) sentCount++
      else sendErrors.push({ phone: maskPhone(phone), step: r.step, error: r.error })
    }

    // Stamp so we don't double-fire (even if SMS sending partially failed —
    // a notification is fine to dedup once we tried).
    await supabase
      .from('classes')
      .update({ day_2_it_notified_at: new Date().toISOString() })
      .eq('id', cls.id)

    firedCount++
    results.push({
      class_id: cls.id,
      region: cls.region,
      location: cls.locations?.name || null,
      fired: true,
      sent_count: sentCount,
      recipient_count: phones.length,
      recipients_source: source,
      trigger: hasSignIn ? 'first_sign_in' : 'fallback_hour',
      ...(sendErrors.length > 0 ? { send_errors: sendErrors } : {}),
    })
  }

  return json(200, {
    target_date: today,
    current_hour: currentHour,
    classes_checked: day2Classes.length,
    classes_fired: firedCount,
    results,
  })
}

function buildMessage(cls, siteUrl, trigger) {
  const locationName = cls.locations?.name || `${cls.region} — TBD`
  const link = siteUrl ? `${siteUrl}/provision/${cls.id}` : `/provision/${cls.id}`
  const triggerLabel =
    trigger === 'first_sign_in'
      ? 'Day 2 trainees have started checking in.'
      : 'Day 2 is underway.'
  return `[Training] ${triggerLabel} Time to create company emails for ${cls.region} · ${locationName}. Open the Provision page and click "Mark provisioning complete" when done: ${link}`
}

function maskPhone(p) {
  if (!p) return p
  return p.length > 4 ? p.slice(0, -7) + 'xxxxxx' + p.slice(-1) : p
}

async function sendOneSms(phone, message) {
  try {
    const cRes = await fetch(`${GHL_BASE}/contacts/upsert`, {
      method: 'POST',
      headers: ghlHeaders(),
      body: JSON.stringify({
        locationId: process.env.GHL_LOCATION_ID,
        phone,
        firstName: 'IT',
        lastName: 'Training System',
      }),
    })
    const cJson = await cRes.json().catch(() => ({}))
    if (!cRes.ok) {
      return { ok: false, step: 'contact_upsert', error: `${cRes.status}: ${cJson.message || JSON.stringify(cJson)}` }
    }
    const cId = cJson.contact?.id || cJson.id
    if (!cId) return { ok: false, step: 'contact_upsert', error: 'No contact id returned' }

    const sRes = await fetch(`${GHL_BASE}/conversations/messages`, {
      method: 'POST',
      headers: ghlHeaders(),
      body: JSON.stringify({ type: 'SMS', contactId: cId, message }),
    })
    if (!sRes.ok) {
      const sJson = await sRes.json().catch(() => ({}))
      return { ok: false, step: 'sms_send', error: `${sRes.status}: ${sJson.message || JSON.stringify(sJson)}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, step: 'exception', error: err.message || 'Unknown' }
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

function computeFloridaToday() {
  // FL = America/New_York. Build a YYYY-MM-DD string in that zone.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
  return fmt.format(new Date())
}

function computeFloridaHour() {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit', hour12: false,
  })
  return Number(fmt.format(new Date()))
}

function addDaysIso(iso, days) {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  const base = new Date(y, m - 1, d)
  base.setDate(base.getDate() + days)
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
