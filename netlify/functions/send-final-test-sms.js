// Netlify Function: send the final-training-test link to every enrolled trainee
// of a class — by BOTH email and SMS (email reaches trainees whose SMS is
// blocked/opted-out in GHL). Triggered manually from Class Detail.
//
// Required env vars: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN, GHL_LOCATION_ID
//   (email also needs RESEND_API_KEY + EMAIL_FROM/FROM_EMAIL — see _email.js)
//
// POST body: { class_id: "uuid" }
// Response:  { results: [{ trainee_id, success, channels?, error? }] }

import { createClient } from '@supabase/supabase-js'
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
  const { class_id, trainee_id } = body
  if (!class_id && !trainee_id) return json(400, { error: 'class_id or trainee_id required' })

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const siteUrl = (process.env.PUBLIC_SITE_URL || process.env.URL || process.env.DEPLOY_URL || '').replace(/\/$/, '')

  // All enrolled + registered trainees for the class, OR a single trainee when
  // trainee_id is passed (e.g. someone who arrived late / missed the class blast).
  let q = supabase
    .from('trainees')
    .select('id, first_name, last_name, phone, email, registration_token, registered, enrolled')
  q = trainee_id ? q.eq('id', trainee_id) : q.eq('class_id', class_id)
  const { data: trainees, error: tErr } = await q
  if (tErr) return json(500, { error: tErr.message })

  // Eligible = registered, enrolled, and reachable on at least one channel.
  const eligible = (trainees || []).filter((t) => t.registered && t.enrolled !== false && (t.phone || t.email))

  const results = []
  for (const t of eligible) {
    const link = `${siteUrl}/test/${t.registration_token}`
    const message = `Hi ${t.first_name || 'there'}, it's time for your final assessment from Neal Scoppettuolo's training. Tap to start: ${link}`
    const channels = []
    const errors = []

    // --- Email (Resend) ---
    if (t.email) {
      try {
        const r = await sendEmail(t.email, 'Your final assessment — U.S. Shingle & Metal', message)
        if (r && r.ok !== false) channels.push('email')
        else errors.push('email: ' + (r?.error || 'failed'))
      } catch (err) {
        errors.push('email: ' + (err.message || 'error'))
      }
    }

    // --- SMS (GHL) ---
    if (t.phone) {
      try {
        const phone = normalizePhone(t.phone)
        if (!phone) {
          errors.push(`sms: invalid phone ${t.phone}`)
        } else {
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
            errors.push(`sms: contact upsert ${contactRes.status}: ${contactJson.message || JSON.stringify(contactJson)}`)
          } else {
            const contactId = contactJson.contact?.id || contactJson.id
            if (!contactId) {
              errors.push('sms: no contact id returned')
            } else {
              const smsRes = await fetch(`${GHL_BASE}/conversations/messages`, {
                method: 'POST',
                headers: ghlHeaders(),
                body: JSON.stringify({ type: 'SMS', contactId, message }),
              })
              const smsJson = await smsRes.json().catch(() => ({}))
              if (!smsRes.ok) errors.push(`sms: send ${smsRes.status}: ${smsJson.message || JSON.stringify(smsJson)}`)
              else channels.push('sms')
            }
          }
        }
      } catch (err) {
        errors.push('sms: ' + (err.message || 'error'))
      }
    }

    // Success if at least one channel went out.
    if (channels.length) results.push({ trainee_id: t.id, success: true, channels })
    else results.push({ trainee_id: t.id, success: false, error: errors.join('; ') || 'No channel sent' })
  }

  return json(200, { results, eligible_count: eligible.length, total_trainees: trainees?.length || 0 })
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
