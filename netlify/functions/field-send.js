// netlify/functions/field-send.js
//
// One-off sends for a FIELD-TRAINED hire (someone the regional manager is
// training out in the field instead of in a normal class). Two actions, both
// fired manually from the /field-trainee admin screen:
//
//   POST { trainee_id, what: 'homework' }
//     → texts + emails ONE link to /full-week-homework/ (the whole week in
//       one page).
//
//   POST { trainee_id, what: 'test' }
//     → marks the trainee registered (so the test page opens) and texts +
//       emails the final test link in multiple-choice-only mode:
//       /test/<registration_token>?mc=1  (no essay questions).
//
// Required env: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN,
//               GHL_LOCATION_ID, RESEND_API_KEY (+ EMAIL_FROM/FROM_EMAIL).

import { createClient } from '@supabase/supabase-js'
import { sendSmsViaGhl } from './_ghl.js'
import { sendEmail } from './_email.js'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' })
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY']) {
    if (!process.env[k]) return json(500, { ok: false, error: `Missing env: ${k}` })
  }

  let body
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { ok: false, error: 'Bad JSON' }) }
  const traineeId = String(body.trainee_id || '').trim()
  const what = String(body.what || '').trim()
  if (!traineeId) return json(400, { ok: false, error: 'trainee_id required' })
  if (!['homework', 'test'].includes(what)) return json(400, { ok: false, error: "what must be 'homework' or 'test'" })

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const siteUrl = (process.env.PUBLIC_SITE_URL || process.env.URL || 'https://trainingmanagementsys.netlify.app').replace(/\/$/, '')

  const { data: t, error: tErr } = await supabase
    .from('trainees')
    .select('id, first_name, phone, email, registration_token, registered')
    .eq('id', traineeId)
    .maybeSingle()
  if (tErr) return json(500, { ok: false, error: tErr.message })
  if (!t) return json(404, { ok: false, error: 'Trainee not found' })
  if (!t.phone && !t.email) return json(200, { ok: false, error: 'No phone or email on file for this trainee' })

  const firstName = t.first_name || 'there'
  let message
  if (what === 'homework') {
    const link = `${siteUrl}/full-week-homework/`
    message =
      `Hi ${firstName}, here's your full week of U.S. Shingle & Metal training in one place. ` +
      `Work through it in order as you train in the field — the script comes first. Everything's here:\n\n${link}`
  } else {
    // test — make sure the test page will open for them, then send the MC-only link.
    if (!t.registered) {
      await supabase.from('trainees').update({ registered: true }).eq('id', t.id)
    }
    const link = `${siteUrl}/test/${t.registration_token}?mc=1`
    message =
      `Hi ${firstName}, you're cleared for your U.S. Shingle & Metal final test. ` +
      `Take your time and answer every question. Tap here to start:\n\n${link}`
  }

  const channels = []
  const errors = []
  if (t.email) {
    try {
      const subject = what === 'homework' ? 'Your full week of training — U.S. Shingle & Metal' : 'Your final test — U.S. Shingle & Metal'
      const r = await sendEmail(t.email, subject, message)
      if (r && r.ok !== false) channels.push('email'); else errors.push('email: ' + (r?.error || 'failed'))
    } catch (e) { errors.push('email: ' + (e.message || 'error')) }
  }
  if (t.phone) {
    const lastName = what === 'homework' ? 'Field Homework' : 'Final Test'
    const sms = await sendSmsViaGhl(t.phone, message, { firstName, lastName })
    if (sms.ok) channels.push('sms'); else errors.push('sms: ' + (sms.error || 'failed'))
  }
  if (!channels.length) return json(500, { ok: false, error: `Send failed — ${errors.join('; ') || 'unknown'}` })

  return json(200, { ok: true, what, channels, errors: errors.length ? errors : undefined })
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(obj),
  }
}
