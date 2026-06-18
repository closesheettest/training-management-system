// Netlify Function: send company email credentials link to selected trainees
// (called from /provision/:class_id) and notify the admin (ADMIN_PHONE) via SMS.
//
// Required env vars (set in Netlify dashboard):
//   SUPABASE_URL              - your Supabase project URL
//   SUPABASE_SECRET_KEY       - the sb_secret_... key
//   GHL_PIT_TOKEN             - GoHighLevel Private Integration Token
//   GHL_LOCATION_ID           - GoHighLevel sub-account / Location ID
//   ADMIN_PHONE               - phone number to receive admin notification SMS
//                               (E.164 or any US format; will be normalized).
//                               Optional — if missing, admin notification is skipped.
//   PUBLIC_SITE_URL           - (optional) override credentials link origin
//
// Request body: { class_id: "uuid", trainee_ids: ["uuid", ...] }
// Response: { results: [{ trainee_id, success, error? }], admin_notified: bool }

import { createClient } from '@supabase/supabase-js'
import { recipientsForEvent } from './_recipients.js'
import { notifyAll } from './_notify.js'
import { sendEmail } from './_email.js'

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
  const { class_id, trainee_ids } = body
  if (!class_id || !Array.isArray(trainee_ids) || trainee_ids.length === 0) {
    return json(400, { error: 'class_id and trainee_ids[] required' })
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const siteUrl = (process.env.PUBLIC_SITE_URL || process.env.URL || process.env.DEPLOY_URL || '').replace(/\/$/, '')

  // Load class + trainees
  const { data: cls, error: clsErr } = await supabase
    .from('classes')
    .select('id, region, week_start_date, locations(name)')
    .eq('id', class_id)
    .maybeSingle()
  if (clsErr || !cls) return json(404, { error: 'Class not found' })

  const { data: trainees, error: trErr } = await supabase
    .from('trainees')
    .select('id, first_name, last_name, phone, email, registration_token, company_email, company_email_password')
    .in('id', trainee_ids)
  if (trErr) return json(500, { error: trErr.message })

  const results = []
  for (const t of trainees || []) {
    try {
      if (!t.company_email) {
        results.push({ trainee_id: t.id, success: false, error: 'No company_email assigned yet' })
        continue
      }

      const link = `${siteUrl}/credentials/${t.registration_token}`

      // Email the actual login (email + password) in addition to the SMS link,
      // so trainees have their credentials in writing. Best-effort, runs even
      // if the phone is invalid, and never blocks the SMS path below.
      if (t.email) {
        try {
          const emailBody =
            `Hi ${t.first_name || 'there'},\n\n` +
            `Your U.S. Shingle & Metal company email is set up. Here's your login:\n\n` +
            `Email: ${t.company_email}\n` +
            (t.company_email_password ? `Password: ${t.company_email_password}\n` : '') +
            `You'll be asked to change this password the first time you sign in.\n\n` +
            `Setup guide (how to add it to your phone): ${link}`
          await sendEmail(t.email, 'Your U.S. Shingle & Metal company email login', emailBody)
        } catch { /* best-effort — SMS is the primary path */ }
      }

      const phone = normalizePhone(t.phone)
      if (!phone) {
        results.push({ trainee_id: t.id, success: false, error: `Invalid phone: ${t.phone}`, email_sent: !!t.email })
        continue
      }
      const message = `Hi ${t.first_name || 'there'}, your U.S. Shingle & Metal company email is set up. Tap to see your login and how to add it to your phone: ${link}`

      // Upsert contact then send SMS via GHL
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
        results.push({ trainee_id: t.id, success: false, error: `Contact upsert ${contactRes.status}: ${contactJson.message || JSON.stringify(contactJson)}` })
        continue
      }
      const contactId = contactJson.contact?.id || contactJson.id
      if (!contactId) {
        results.push({ trainee_id: t.id, success: false, error: 'No contact id returned' })
        continue
      }

      const smsRes = await fetch(`${GHL_BASE}/conversations/messages`, {
        method: 'POST',
        headers: ghlHeaders(),
        body: JSON.stringify({ type: 'SMS', contactId, message }),
      })
      const smsJson = await smsRes.json().catch(() => ({}))
      if (!smsRes.ok) {
        results.push({ trainee_id: t.id, success: false, error: `SMS send ${smsRes.status}: ${smsJson.message || JSON.stringify(smsJson)}` })
        continue
      }

      await supabase
        .from('trainees')
        .update({ credentials_sent_at: new Date().toISOString() })
        .eq('id', t.id)

      results.push({ trainee_id: t.id, success: true })
    } catch (err) {
      results.push({ trainee_id: t.id, success: false, error: err.message || 'Unknown error' })
    }
  }

  // Admin notification — looks up active 'admin' recipients in the DB,
  // falls back to ADMIN_PHONE env var for backwards compatibility.
  const successCount = results.filter((r) => r.success).length
  const failCount = results.length - successCount
  const locationName = cls.locations?.name || `${cls.region} — TBD`
  const adminMessage =
    `[Training System] Company emails provisioned for ${cls.region} · ${locationName} (week of ${cls.week_start_date}). ` +
    `${successCount} credential text${successCount === 1 ? '' : 's'} sent` +
    (failCount > 0 ? `, ${failCount} failed.` : '.')

  const adminEmailSubject = `Credentials texts sent — ${cls.region} (week of ${cls.week_start_date})`
  const adminEmailBody = adminMessage

  const { recipients: admins } = await recipientsForEvent(
    supabase,
    'day_2_provision_complete',
    { legacyRole: 'admin' },
  )
  const adminResult = await notifyAll(admins, {
    smsBody: adminMessage,
    emailSubject: adminEmailSubject,
    emailBody: adminEmailBody,
    contactLabel: 'Admin',
  })

  return json(200, {
    results,
    admin_sms_sent: adminResult.sms_sent,
    admin_email_sent: adminResult.email_sent,
    admin_recipient_count: admins.length,
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
  if (digits.length >= 11 && String(raw).trim().startsWith('+')) return `+${digits}`
  return null
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
