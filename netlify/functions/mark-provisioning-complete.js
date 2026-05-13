// Netlify Function: IT marks provisioning complete on a class.
//
// Stamps classes.it_completed_at and fires two notifications:
//   * 'it_emails_provisioned' — HR-style summary, link to the setup/list page
//   * 'va_setup_due'          — VA-style action prompt, same link
//
// Both go to the public setup page (/setup/:class_id). The page itself shows
// the email list for HR and the per-trainee checklist for VAs. The trainee
// credentials text is NOT sent here — that's the corporate trainer's button.
//
// Required env vars: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN, GHL_LOCATION_ID
// Optional: PUBLIC_SITE_URL
//
// Request body: { class_id: "uuid" }
// Response: { hr_notified, va_notified, results: [...] }

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

  // Load class + enrolled trainees with provisioned emails so the messages
  // can include the headcount.
  const { data: cls, error: clsErr } = await supabase
    .from('classes')
    .select('id, region, week_start_date, locations(name), trainees(id, enrolled, company_email)')
    .eq('id', class_id)
    .maybeSingle()
  if (clsErr || !cls) return json(404, { error: 'Class not found' })

  const provisionedCount = (cls.trainees || []).filter(
    (t) => t.enrolled !== false && t.company_email,
  ).length

  // Stamp completion regardless of SMS outcome.
  const { error: stampErr } = await supabase
    .from('classes')
    .update({ it_completed_at: new Date().toISOString() })
    .eq('id', class_id)
  if (stampErr) return json(500, { error: `Failed to stamp completion: ${stampErr.message}` })

  const setupLink = siteUrl ? `${siteUrl}/setup/${class_id}` : `/setup/${class_id}`
  const locationName = cls.locations?.name || `${cls.region} — TBD`

  const hrMessage =
    `[Training] IT just provisioned ${provisionedCount} company email${provisionedCount === 1 ? '' : 's'} ` +
    `for ${cls.region} · ${locationName} (week of ${cls.week_start_date}). ` +
    `View the list and confirm setup progress here: ${setupLink}`

  const vaMessage =
    `[Training] ${provisionedCount} new trainee${provisionedCount === 1 ? ' needs' : 's need'} to be set up in ` +
    `RepCard, JobNimbus, and Sales Academy for ${cls.region} (week of ${cls.week_start_date}). ` +
    `Check them off as you go: ${setupLink}`

  const hrResult = await fanOutNotification(supabase, {
    eventKey: 'it_emails_provisioned',
    legacyRole: 'hr',
    contactLabel: 'HR',
    message: hrMessage,
  })
  const vaResult = await fanOutNotification(supabase, {
    eventKey: 'va_setup_due',
    legacyRole: 'va',
    contactLabel: 'VA',
    message: vaMessage,
  })

  return json(200, {
    class_id,
    provisioned_count: provisionedCount,
    hr_notified: hrResult,
    va_notified: vaResult,
  })
}

async function fanOutNotification(supabase, { eventKey, legacyRole, contactLabel, message }) {
  const { phones, source } = await recipientPhonesForEvent(supabase, eventKey, { legacyRole })
  if (phones.length === 0) {
    return { sent_count: 0, recipient_count: 0, source, warning: `No subscribers to ${eventKey}` }
  }
  let sentCount = 0
  const errors = []
  for (const phone of phones) {
    const r = await sendOneSms(phone, message, contactLabel)
    if (r.ok) sentCount++
    else errors.push({ step: r.step, error: r.error })
  }
  return {
    sent_count: sentCount,
    recipient_count: phones.length,
    source,
    ...(errors.length ? { errors } : {}),
  }
}

async function sendOneSms(phone, message, contactLabel = 'Training System') {
  try {
    const cRes = await fetch(`${GHL_BASE}/contacts/upsert`, {
      method: 'POST',
      headers: ghlHeaders(),
      body: JSON.stringify({
        locationId: process.env.GHL_LOCATION_ID,
        phone,
        firstName: contactLabel,
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
