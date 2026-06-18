// Netlify Function: send registration SMS to one or more trainees via GoHighLevel.
//
// Required env vars (set in Netlify dashboard, NOT in code):
//   SUPABASE_URL              - your Supabase project URL
//   SUPABASE_SECRET_KEY       - the sb_secret_... key (bypasses RLS — server only)
//   GHL_PIT_TOKEN             - your GoHighLevel Private Integration Token (pit-...)
//   GHL_LOCATION_ID           - your GoHighLevel sub-account / Location ID
//   PUBLIC_SITE_URL           - (optional) override the registration link origin.
//                               Defaults to Netlify's auto-set URL env var.
//
// Request body: { trainee_ids: ["uuid1", "uuid2", ...] }
// Response:     { results: [{ trainee_id, success, error? }] }

import { createClient } from '@supabase/supabase-js'
import { renderTemplate } from './_templates.js'
import { sendEmail } from './_email.js'

const GHL_BASE = 'https://services.leadconnectorhq.com'
const GHL_VERSION = '2021-07-28'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' })
  }

  // Validate env first so failures are clear in Netlify logs
  const missing = []
  for (const key of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'GHL_PIT_TOKEN', 'GHL_LOCATION_ID']) {
    if (!process.env[key]) missing.push(key)
  }
  if (missing.length) {
    return json(500, { error: `Missing env vars: ${missing.join(', ')}` })
  }

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }
  const { trainee_ids } = body
  if (!Array.isArray(trainee_ids) || trainee_ids.length === 0) {
    return json(400, { error: 'trainee_ids array required' })
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  // Fetch trainees with class + location info
  const { data: trainees, error: dbError } = await supabase
    .from('trainees')
    .select(
      'id, first_name, last_name, phone, email, registration_token, classes!class_id(week_start_date, locations(name))',
    )
    .in('id', trainee_ids)

  if (dbError) {
    return json(500, { error: `Supabase: ${dbError.message}` })
  }
  if (!trainees || trainees.length === 0) {
    return json(404, { error: 'No trainees found for the given ids' })
  }

  const siteUrl = (process.env.PUBLIC_SITE_URL || process.env.URL || process.env.DEPLOY_URL || '').replace(/\/$/, '')
  const results = []

  for (const t of trainees) {
    try {
      const link = `${siteUrl}/register/${t.registration_token}`
      const locationName = t.classes?.locations?.name || 'your training location'
      const weekDate = formatDate(t.classes?.week_start_date)
      const message = await renderTemplate(supabase, 'registration_initial', {
        firstName: t.first_name,
        locationName,
        weekDate,
        link,
      })

      const channels = []
      const errs = []

      // 1. SMS via GoHighLevel (if there's a usable phone)
      const phone = normalizePhone(t.phone)
      if (phone) {
        try {
          const contactRes = await fetch(`${GHL_BASE}/contacts/upsert`, {
            method: 'POST',
            headers: ghlHeaders(),
            body: JSON.stringify({ locationId: process.env.GHL_LOCATION_ID, phone, firstName: t.first_name, lastName: t.last_name }),
          })
          const contactJson = await contactRes.json().catch(() => ({}))
          const contactId = contactJson.contact?.id || contactJson.id
          if (!contactRes.ok || !contactId) {
            errs.push(`sms: contact ${contactRes.status}: ${contactJson.message || 'no id'}`)
          } else {
            const smsRes = await fetch(`${GHL_BASE}/conversations/messages`, {
              method: 'POST',
              headers: ghlHeaders(),
              body: JSON.stringify({ type: 'SMS', contactId, message }),
            })
            if (smsRes.ok) channels.push('sms')
            else { const sj = await smsRes.json().catch(() => ({})); errs.push(`sms: ${smsRes.status}: ${sj.message || ''}`) }
          }
        } catch (e) { errs.push('sms: ' + (e.message || 'error')) }
      } else {
        errs.push(`sms: no valid phone (${t.phone || 'blank'})`)
      }

      // 2. Email via Resend — so people whose SMS is blocked/opted-out still get it.
      if (t.email) {
        try {
          const r = await sendEmail(t.email, 'Register for your U.S. Shingle & Metal training', message)
          if (r && r.ok !== false) channels.push('email'); else errs.push('email: ' + (r?.error || 'failed'))
        } catch (e) { errs.push('email: ' + (e.message || 'error')) }
      } else {
        errs.push('email: none on file')
      }

      if (channels.length) {
        // Stamp the trainee row so the UI can show "Sent, no response" across refreshes.
        await supabase.from('trainees').update({ last_sms_sent_at: new Date().toISOString() }).eq('id', t.id)
        results.push({ trainee_id: t.id, success: true, channels })
      } else {
        results.push({ trainee_id: t.id, success: false, error: errs.join('; ') })
      }
    } catch (err) {
      results.push({ trainee_id: t.id, success: false, error: err.message || 'Unknown error' })
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

// Normalize US phone numbers to E.164 (+1XXXXXXXXXX)
function normalizePhone(raw) {
  if (!raw) return null
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (digits.length >= 11 && raw.trim().startsWith('+')) return `+${digits}`
  return null
}

function formatDate(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
