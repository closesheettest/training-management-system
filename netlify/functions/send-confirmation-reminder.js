// Netlify Function: send a 24-hour-ahead confirmation SMS to every registered
// trainee whose class starts tomorrow.
//
// Required env vars (set in Netlify dashboard, NOT in code):
//   SUPABASE_URL              - your Supabase project URL
//   SUPABASE_SECRET_KEY       - the sb_secret_... key (bypasses RLS — server only)
//   GHL_PIT_TOKEN             - your GoHighLevel Private Integration Token (pit-...)
//   GHL_LOCATION_ID           - your GoHighLevel sub-account / Location ID
//   CRON_SECRET               - long random string. Required as ?secret=... or
//                               X-Cron-Secret header so a public URL can't trigger
//                               unsolicited SMS.
//   PUBLIC_SITE_URL           - (optional) override link origin
//
// Designed to be hit by an external cron service (e.g. cron-job.org) once per day.
//
// Query params:
//   ?dry_run=1   - log what would send without actually calling GHL
//   ?days=2      - look N days ahead instead of 1 (useful for testing)
//
// Response: { sent: number, skipped: number, errors: [...], details: [...] }

import { createClient } from '@supabase/supabase-js'

const GHL_BASE = 'https://services.leadconnectorhq.com'
const GHL_VERSION = '2021-07-28'

export const handler = async (event) => {
  // Auth: require shared secret
  const provided =
    event.headers['x-cron-secret'] ||
    event.headers['X-Cron-Secret'] ||
    new URLSearchParams(event.rawQuery || event.queryStringParameters || '').get?.('secret') ||
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
  const daysAhead = parseInt(params.days, 10) || 1

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  // Compute target date in America/New_York time zone (FL business hours)
  const targetDate = computeFloridaDateAhead(daysAhead)

  // Find classes that START on the target date
  const { data: classes, error: clsErr } = await supabase
    .from('classes')
    .select(
      'id, week_start_date, locations(name, street_address, city, state, zip), trainees(id, first_name, last_name, phone, registered, last_reminder_sent_at)',
    )
    .eq('week_start_date', targetDate)

  if (clsErr) return json(500, { error: `Supabase: ${clsErr.message}` })

  const details = []
  let sent = 0
  let skipped = 0
  const errors = []

  for (const cls of classes || []) {
    const locationName = cls.locations?.name || 'your training location'
    const address = cls.locations
      ? formatAddress(cls.locations)
      : 'Location TBD — your manager will share details before tomorrow.'

    for (const t of cls.trainees || []) {
      // Only message registered trainees with a phone we can dial
      if (!t.registered || !t.phone) {
        skipped++
        details.push({ trainee_id: t.id, action: 'skip', reason: !t.registered ? 'not registered' : 'no phone' })
        continue
      }

      const phone = normalizePhone(t.phone)
      if (!phone) {
        skipped++
        details.push({ trainee_id: t.id, action: 'skip', reason: `bad phone: ${t.phone}` })
        continue
      }

      const message = `Hi ${t.first_name || 'there'}, reminder: your U.S. Shingle & Metal training starts tomorrow at ${locationName} (${address}). Reply YES to confirm or NO if you can't make it.`

      if (dryRun) {
        details.push({ trainee_id: t.id, action: 'dry-run', phone, message })
        continue
      }

      try {
        const contactRes = await fetch(`${GHL_BASE}/contacts/upsert`, {
          method: 'POST',
          headers: ghlHeaders(),
          body: JSON.stringify({
            locationId: process.env.GHL_LOCATION_ID,
            phone,
            firstName: t.first_name,
            lastName: t.last_name,
          }),
        })
        const contactJson = await contactRes.json().catch(() => ({}))
        if (!contactRes.ok) {
          errors.push({ trainee_id: t.id, step: 'contact', error: contactJson.message || JSON.stringify(contactJson) })
          continue
        }
        const contactId = contactJson.contact?.id || contactJson.id
        if (!contactId) {
          errors.push({ trainee_id: t.id, step: 'contact', error: 'no contact id returned' })
          continue
        }

        const smsRes = await fetch(`${GHL_BASE}/conversations/messages`, {
          method: 'POST',
          headers: ghlHeaders(),
          body: JSON.stringify({ type: 'SMS', contactId, message }),
        })
        const smsJson = await smsRes.json().catch(() => ({}))
        if (!smsRes.ok) {
          errors.push({ trainee_id: t.id, step: 'sms', error: smsJson.message || JSON.stringify(smsJson) })
          continue
        }

        await supabase
          .from('trainees')
          .update({ last_reminder_sent_at: new Date().toISOString() })
          .eq('id', t.id)

        sent++
        details.push({ trainee_id: t.id, action: 'sent', phone })
      } catch (err) {
        errors.push({ trainee_id: t.id, step: 'fetch', error: err.message || 'unknown' })
      }
    }
  }

  return json(200, {
    target_date: targetDate,
    classes_found: classes?.length || 0,
    sent,
    skipped,
    errors,
    details: dryRun ? details : undefined,
  })
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
  if (digits.length >= 11 && raw.trim().startsWith('+')) return `+${digits}`
  return null
}

function formatAddress(loc) {
  if (!loc) return ''
  const parts = []
  if (loc.street_address) parts.push(loc.street_address)
  const csz = [loc.city, loc.state].filter(Boolean).join(', ')
  if (csz || loc.zip) parts.push([csz, loc.zip].filter(Boolean).join(' '))
  return parts.join(', ')
}

// Returns YYYY-MM-DD for "today + daysAhead" in America/New_York time zone,
// so we treat "tomorrow" consistently from Florida regardless of where the
// cron service or Netlify edge sits.
function computeFloridaDateAhead(daysAhead) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  // Today in NY -> Date at NY midnight
  const todayNyStr = fmt.format(new Date()) // YYYY-MM-DD
  const [y, m, d] = todayNyStr.split('-').map(Number)
  const ny = new Date(Date.UTC(y, m - 1, d))
  ny.setUTCDate(ny.getUTCDate() + daysAhead)
  return ny.toISOString().slice(0, 10)
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
