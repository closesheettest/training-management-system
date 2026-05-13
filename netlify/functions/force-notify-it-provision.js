// Netlify Function: manually fire the day-2 IT provisioning reminder for a
// single class — called from the "Send day-2 IT reminder now" button on the
// Class detail page.
//
// Differences from notify-day-2-provision (the cron):
//   - Targets one class_id from the POST body, no date math.
//   - No CRON_SECRET auth — same trust model as the other admin endpoints.
//   - Always fires, even if day_2_it_notified_at is already set (the button
//     is the user's explicit request). Stamps the timestamp afterward so the
//     cron won't double-text.
//
// Required env vars: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN, GHL_LOCATION_ID
// Optional: PUBLIC_SITE_URL
//
// Request body: { class_id: "uuid" }
// Response: { sent_count, recipient_count, source, preview_message, errors? }

import { createClient } from '@supabase/supabase-js'
import { recipientPhonesForEvent } from './_recipients.js'

const GHL_BASE = 'https://services.leadconnectorhq.com'
const GHL_VERSION = '2021-07-28'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' })

  const missing = []
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'GHL_PIT_TOKEN', 'GHL_LOCATION_ID']) {
    if (!process.env[k]) missing.push(k)
  }
  if (missing.length) return json(500, { error: `Missing env vars: ${missing.join(', ')}` })

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }
  const { class_id } = body
  if (!class_id) return json(400, { error: 'class_id required' })

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const siteUrl = (process.env.PUBLIC_SITE_URL || process.env.URL || process.env.DEPLOY_URL || '').replace(/\/$/, '')

  const { data: cls, error: clsErr } = await supabase
    .from('classes')
    .select('id, region, week_start_date, locations(name)')
    .eq('id', class_id)
    .maybeSingle()
  if (clsErr || !cls) return json(404, { error: 'Class not found' })

  const { phones, source } = await recipientPhonesForEvent(supabase, 'day_2_provision_due', {
    legacyRole: 'it',
  })
  if (phones.length === 0) {
    return json(200, {
      sent_count: 0,
      recipient_count: 0,
      source,
      warning:
        'No active IT subscribers found. Add at least one in /notifications and subscribe them to "Day 2 reminder — IT, please create emails".',
    })
  }

  const link = siteUrl ? `${siteUrl}/provision/${cls.id}` : `/provision/${cls.id}`
  const locationName = cls.locations?.name || `${cls.region} — TBD`
  const message =
    `[Training] Manual reminder from your training admin: time to create company emails for ` +
    `${cls.region} · ${locationName}. Open the Provision page and click "Mark provisioning complete" when done: ${link}`

  let sentCount = 0
  const errors = []
  for (const phone of phones) {
    const r = await sendOneSms(phone, message)
    if (r.ok) sentCount++
    else errors.push({ step: r.step, error: r.error })
  }

  // Stamp so the cron won't double-fire later today.
  await supabase
    .from('classes')
    .update({ day_2_it_notified_at: new Date().toISOString() })
    .eq('id', class_id)

  return json(200, {
    sent_count: sentCount,
    recipient_count: phones.length,
    source,
    preview_message: message,
    ...(errors.length ? { errors } : {}),
  })
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

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
