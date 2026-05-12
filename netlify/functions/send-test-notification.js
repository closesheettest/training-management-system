// Netlify Function: send a test SMS to every active recipient with role='test'.
// Triggered from the /notifications admin page.
//
// Required env vars: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN, GHL_LOCATION_ID
//
// POST: no body required
// Response: { results: [{ recipient_id, name, success, error? }] }

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

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  const { data: recipients, error } = await supabase
    .from('notification_recipients')
    .select('id, name, phone')
    .eq('role', 'test')
    .eq('active', true)
    .not('phone', 'is', null)
  if (error) return json(500, { error: error.message })
  if (!recipients || recipients.length === 0) {
    return json(400, { error: 'No active "Test" recipients with a phone number. Add one first.' })
  }

  const message = `[Training System Test] If you got this, SMS notifications are wired up correctly. Sent ${new Date().toLocaleString()}.`

  const results = []
  for (const r of recipients) {
    const phone = normalizePhone(r.phone)
    if (!phone) {
      results.push({ recipient_id: r.id, name: r.name, success: false, error: `Bad phone: ${r.phone}` })
      continue
    }
    try {
      const cRes = await fetch(`${GHL_BASE}/contacts/upsert`, {
        method: 'POST',
        headers: ghlHeaders(),
        body: JSON.stringify({
          locationId: process.env.GHL_LOCATION_ID,
          phone,
          firstName: r.name?.split(' ')[0] || 'Test',
          lastName: r.name?.split(' ').slice(1).join(' ') || 'Recipient',
        }),
      })
      const cJson = await cRes.json().catch(() => ({}))
      if (!cRes.ok) {
        results.push({
          recipient_id: r.id,
          name: r.name,
          success: false,
          error: `Contact upsert ${cRes.status}: ${cJson.message || JSON.stringify(cJson)}`,
        })
        continue
      }
      const cId = cJson.contact?.id || cJson.id
      if (!cId) {
        results.push({ recipient_id: r.id, name: r.name, success: false, error: 'No contact id returned' })
        continue
      }
      const sRes = await fetch(`${GHL_BASE}/conversations/messages`, {
        method: 'POST',
        headers: ghlHeaders(),
        body: JSON.stringify({ type: 'SMS', contactId: cId, message }),
      })
      const sJson = await sRes.json().catch(() => ({}))
      if (!sRes.ok) {
        results.push({
          recipient_id: r.id,
          name: r.name,
          success: false,
          error: `SMS send ${sRes.status}: ${sJson.message || JSON.stringify(sJson)}`,
        })
        continue
      }
      results.push({ recipient_id: r.id, name: r.name, success: true })
    } catch (err) {
      results.push({ recipient_id: r.id, name: r.name, success: false, error: err.message || 'Unknown' })
    }
  }

  return json(200, { results })
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
