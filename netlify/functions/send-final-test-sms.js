// Netlify Function: send the final-training-test link to every enrolled trainee
// of a class. Triggered manually from Class Detail.
//
// Required env vars: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN, GHL_LOCATION_ID
//
// POST body: { class_id: "uuid" }
// Response:  { results: [{ trainee_id, success, error? }] }

import { createClient } from '@supabase/supabase-js'

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

  // Find all enrolled + registered trainees for this class
  const { data: trainees, error: tErr } = await supabase
    .from('trainees')
    .select('id, first_name, last_name, phone, registration_token, registered, enrolled')
    .eq('class_id', class_id)
  if (tErr) return json(500, { error: tErr.message })

  const eligible = (trainees || []).filter((t) => t.registered && t.enrolled !== false && t.phone)

  const results = []
  for (const t of eligible) {
    try {
      const phone = normalizePhone(t.phone)
      if (!phone) {
        results.push({ trainee_id: t.id, success: false, error: `Invalid phone: ${t.phone}` })
        continue
      }

      const link = `${siteUrl}/test/${t.registration_token}`
      const message = `Hi ${t.first_name || 'there'}, it's time for your final assessment from Neal Scoppettuolo's training. Tap to start: ${link}`

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
      results.push({ trainee_id: t.id, success: true })
    } catch (err) {
      results.push({ trainee_id: t.id, success: false, error: err.message || 'Unknown error' })
    }
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
