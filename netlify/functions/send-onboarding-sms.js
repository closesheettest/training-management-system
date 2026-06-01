// Fires the Day 1 onboarding SMS — a single text containing the
// HomeMaxx funnel link the trainee fills out before / during their
// first training day.
//
// Triggered fire-and-forget from Kiosk.jsx after every sign-in. The
// function itself is idempotent — it checks onboarding_sms_sent_at
// and short-circuits if the trainee already got the text, so the
// kiosk can safely fire it on every sign-in without worrying about
// duplicates.
//
// Request:
//   POST { trainee_id: '<uuid>' }
//
// Response:
//   { ok: true, sent: true,  trainee_id, phone_last4 }  — fired
//   { ok: true, sent: false, reason: 'already_sent' }    — idempotent skip
//   { ok: true, sent: false, reason: 'no_phone' }        — can't send
//   { ok: false, error: '...' }                          — failure
//
// Env vars:
//   ONBOARDING_SMS_LINK    The HomeMaxx funnel URL. Defaults to the
//                          current one (8m3EQIb89AZIpWR97rrg) so a
//                          fresh deploy works without env tweaking.
//                          Override in Netlify when the funnel URL
//                          changes — no code redeploy needed.
//   SUPABASE_URL, SUPABASE_SECRET_KEY — standard.
//   GHL_PIT_TOKEN, GHL_LOCATION_ID — used by sendSmsViaGhl helper.

import { createClient } from '@supabase/supabase-js'
import { sendSmsViaGhl } from './_ghl.js'

const SB_URL = process.env.SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SECRET_KEY
const ONBOARDING_LINK =
  process.env.ONBOARDING_SMS_LINK ||
  'https://app.homemaxxusa.com/v2/preview/8m3EQIb89AZIpWR97rrg'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method Not Allowed' })
  if (!SB_URL || !SB_KEY) return json(500, { ok: false, error: 'Missing SUPABASE env vars' })

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return json(400, { ok: false, error: 'Invalid JSON body' })
  }
  const traineeId = String(body.trainee_id || '').trim()
  if (!traineeId) return json(400, { ok: false, error: 'trainee_id required' })

  const supabase = createClient(SB_URL, SB_KEY)
  const { data: t, error } = await supabase
    .from('trainees')
    .select('id, first_name, phone, onboarding_sms_sent_at')
    .eq('id', traineeId)
    .maybeSingle()
  if (error) return json(500, { ok: false, error: error.message })
  if (!t) return json(404, { ok: false, error: 'Trainee not found.' })

  // Idempotent guard. Kiosk fires this on every sign-in; we only send
  // the first time. To force a re-send (e.g. trainee lost the SMS),
  // admin nulls onboarding_sms_sent_at via SQL and signs them in again.
  if (t.onboarding_sms_sent_at) {
    return json(200, { ok: true, sent: false, reason: 'already_sent' })
  }
  if (!t.phone) {
    return json(200, { ok: true, sent: false, reason: 'no_phone' })
  }

  const firstName = t.first_name || 'there'
  const message =
    `Hi ${firstName}, welcome to your first day at U.S. Shingle! ` +
    `Tap to complete your onboarding:\n\n${ONBOARDING_LINK}\n\n` +
    `Get this done before we start.`

  try {
    const res = await sendSmsViaGhl(t.phone, message, {
      label: 'onboarding-sms',
      trainee_id: t.id,
    })
    if (!res?.ok) {
      return json(502, { ok: false, error: res?.error || 'GHL SMS failed.', details: res })
    }
  } catch (e) {
    return json(502, { ok: false, error: e?.message || 'Network error sending SMS.' })
  }

  await supabase
    .from('trainees')
    .update({ onboarding_sms_sent_at: new Date().toISOString() })
    .eq('id', t.id)

  return json(200, {
    ok: true,
    sent: true,
    trainee_id: t.id,
    phone_last4: (t.phone.match(/\d/g) || []).slice(-4).join(''),
  })
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  }
}
