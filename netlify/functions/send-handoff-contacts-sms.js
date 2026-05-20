// Fires immediately after a trainee submits their final test (called from
// TakeTest.jsx, alongside the review-email + social-testimonial enqueue).
//
// Sends a single SMS to the trainee with a link to a .vcf that contains
// their handoff contacts (Sales Manager + Helpline, plus anyone region-
// matched). Tapping the link on iPhone/Android opens the native
// "Add to Contacts" sheet so everything saves in one confirmation.
//
// Dedup: stamps handoff_contacts_sent_at on the trainee so a re-submit or
// accidental refire doesn't double-text.
//
// Request body: { trainee_id }
//
// Required env vars: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN,
// GHL_LOCATION_ID. Optional: PUBLIC_SITE_URL.

import { createClient } from '@supabase/supabase-js'
import { sendSmsViaGhl } from './_ghl.js'

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
  const { trainee_id } = body
  if (!trainee_id) return json(400, { error: 'trainee_id required' })

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  const { data: trainee, error: tErr } = await supabase
    .from('trainees')
    .select('id, first_name, phone, handoff_contacts_sent_at, classes!class_id(region)')
    .eq('id', trainee_id)
    .maybeSingle()
  if (tErr) return json(500, { error: `Supabase: ${tErr.message}` })
  if (!trainee) return json(404, { error: 'Trainee not found' })
  if (!trainee.phone) return json(200, { ok: false, skipped_reason: 'Trainee has no phone' })
  if (trainee.handoff_contacts_sent_at) {
    return json(200, { ok: false, skipped_reason: 'Already sent', stamped_at: trainee.handoff_contacts_sent_at })
  }

  // Check there's anything to send before bothering the trainee. A trainee
  // gets all "universal" (region IS NULL) + everyone matching their region.
  const region = trainee.classes?.region || null
  let countQ = supabase
    .from('trainee_handoff_contacts')
    .select('id', { count: 'exact', head: true })
    .eq('active', true)
  if (region) {
    countQ = countQ.or(`region.is.null,region.eq.${escapeOr(region)}`)
  } else {
    countQ = countQ.is('region', null)
  }
  const { count, error: cErr } = await countQ
  if (cErr) return json(500, { error: `Supabase: ${cErr.message}` })
  if (!count || count === 0) {
    return json(200, { ok: false, skipped_reason: 'No handoff contacts configured' })
  }

  const siteUrl = (process.env.PUBLIC_SITE_URL || process.env.URL || process.env.DEPLOY_URL || 'https://trainingmanagementsys.netlify.app').replace(/\/$/, '')
  const vcardUrl = `${siteUrl}/.netlify/functions/trainee-contacts-vcard?trainee_id=${trainee.id}`
  const greeting = trainee.first_name ? `${trainee.first_name}, ` : ''
  const message =
    `[Training] ${greeting}congrats on finishing your final test! Tap to save your team contacts to your phone in one go: ${vcardUrl}`

  const sms = await sendSmsViaGhl(trainee.phone, message, {
    firstName: trainee.first_name || 'Trainee',
    lastName: 'Handoff',
  })
  if (!sms.ok) {
    return json(200, {
      ok: false,
      sms_error: sms.error,
      step: sms.step,
    })
  }

  // Stamp success so we don't re-send if the trainee re-submits.
  await supabase
    .from('trainees')
    .update({ handoff_contacts_sent_at: new Date().toISOString() })
    .eq('id', trainee.id)

  return json(200, { ok: true, contact_count: count, vcard_url: vcardUrl })
}

function escapeOr(v) {
  if (/[,()'"\s]/.test(v)) return `"${String(v).replace(/"/g, '\\"')}"`
  return v
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
