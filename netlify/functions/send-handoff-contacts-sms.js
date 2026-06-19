// Fires immediately after a trainee submits their final test (called from
// TakeTest.jsx, alongside the review + social-testimonial enqueue).
//
// Sends the trainee their handoff contacts (Sales Manager + Helpline, plus
// anyone region-matched) by BOTH email and SMS — email reaches trainees whose
// SMS is blocked/opted-out in GHL (the Lisa case). The SMS + email both carry
// a link to a .vcf "Add to Contacts" page; the email also lists every contact
// inline so the info is right there even without tapping.
//
// Dedup: stamps handoff_contacts_sent_at so a re-submit doesn't double-send.
// Pass { force: true } to bypass the stamp (used for manual backfills).
//
// Request body: { trainee_id, force? }
//
// Required env vars: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN,
// GHL_LOCATION_ID. Email also needs RESEND_API_KEY / EMAIL_FROM (see _email.js).
// Optional: PUBLIC_SITE_URL.

import { createClient } from '@supabase/supabase-js'
import { sendSmsViaGhl } from './_ghl.js'
import { sendEmail } from './_email.js'

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
  const force = body.force === true
  if (!trainee_id) return json(400, { error: 'trainee_id required' })

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  const { data: trainee, error: tErr } = await supabase
    .from('trainees')
    .select('id, first_name, phone, email, handoff_contacts_sent_at, classes!class_id(region)')
    .eq('id', trainee_id)
    .maybeSingle()
  if (tErr) return json(500, { error: `Supabase: ${tErr.message}` })
  if (!trainee) return json(404, { error: 'Trainee not found' })
  if (!trainee.phone && !trainee.email) return json(200, { ok: false, skipped_reason: 'No phone or email on file' })
  if (trainee.handoff_contacts_sent_at && !force) {
    return json(200, { ok: false, skipped_reason: 'Already sent', stamped_at: trainee.handoff_contacts_sent_at })
  }

  // A trainee gets all "universal" (region IS NULL) contacts + everyone
  // matching their region. Pull the full rows so we can list them in the email.
  const region = trainee.classes?.region || null
  let q = supabase
    .from('trainee_handoff_contacts')
    .select('display_name, title, organization, phone, email, region, display_order')
    .eq('active', true)
    .order('display_order', { ascending: true })
  if (region) {
    q = q.or(`region.is.null,region.eq.${escapeOr(region)}`)
  } else {
    q = q.is('region', null)
  }
  const { data: contacts, error: cErr } = await q
  if (cErr) return json(500, { error: `Supabase: ${cErr.message}` })
  if (!contacts || contacts.length === 0) {
    return json(200, { ok: false, skipped_reason: 'No handoff contacts configured' })
  }

  const siteUrl = (process.env.PUBLIC_SITE_URL || process.env.URL || process.env.DEPLOY_URL || 'https://trainingmanagementsys.netlify.app').replace(/\/$/, '')
  const vcardUrl = `${siteUrl}/.netlify/functions/trainee-contacts-vcard?trainee_id=${trainee.id}`
  const greeting = trainee.first_name ? `${trainee.first_name}, ` : ''

  const smsMessage =
    `[Training] ${greeting}congrats on finishing your final test! Tap to save your team contacts to your phone in one go: ${vcardUrl}`

  // Email lists each contact inline + the same one-tap save link.
  const emailLines = [
    `Hi ${trainee.first_name || 'there'}, congratulations on finishing your final test!`,
    '',
    'Here are your U.S. Shingle & Metal team contacts — please save these:',
    '',
  ]
  for (const c of contacts) {
    emailLines.push(c.display_name || 'Contact')
    const sub = [c.title, c.organization].filter(Boolean).join(' · ')
    if (sub) emailLines.push(sub)
    if (c.phone) emailLines.push(`Phone: ${c.phone}`)
    if (c.email) emailLines.push(`Email: ${c.email}`)
    emailLines.push('')
  }
  emailLines.push(`Save them all to your phone in one tap: ${vcardUrl}`)
  const emailBody = emailLines.join('\n')

  const channels = []
  const errors = []

  if (trainee.email) {
    try {
      const r = await sendEmail(trainee.email, 'Your U.S. Shingle & Metal team contacts', emailBody)
      if (r && r.ok !== false) channels.push('email'); else errors.push('email: ' + (r?.error || 'failed'))
    } catch (e) { errors.push('email: ' + (e.message || 'error')) }
  }
  if (trainee.phone) {
    const sms = await sendSmsViaGhl(trainee.phone, smsMessage, { firstName: trainee.first_name || 'Trainee', lastName: 'Handoff' })
    if (sms.ok) channels.push('sms'); else errors.push('sms: ' + (sms.error || 'failed'))
  }

  // Stamp only when something actually went out, so a total failure can retry.
  if (channels.length) {
    await supabase
      .from('trainees')
      .update({ handoff_contacts_sent_at: new Date().toISOString() })
      .eq('id', trainee.id)
  }

  return json(200, {
    ok: channels.length > 0,
    contact_count: contacts.length,
    channels,
    errors: errors.length ? errors : undefined,
    vcard_url: vcardUrl,
  })
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
