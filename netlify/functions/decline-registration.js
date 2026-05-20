// Fired when a trainee taps "I can't attend" → "Yes, I'm not attending"
// on the registration page (Register.jsx). Updates the trainee row to
// capture the decline, marks them un-enrolled so they drop off active
// lists + future automated texts, and fires the 'trainee_declined'
// notification event so HR / Admin / Hiring Manager hear about it.
//
// No auth — the registration_token gates access (each trainee has a
// unique unguessable token).
//
// Request body: { registration_token: "uuid", reason?: "free text" }
// Response: { ok, error? }
//
// Required env vars: SUPABASE_URL, SUPABASE_SECRET_KEY,
// GHL_PIT_TOKEN, GHL_LOCATION_ID.

import { createClient } from '@supabase/supabase-js'
import { recipientsForEvent } from './_recipients.js'
import { notifyAll } from './_notify.js'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' })

  const missing = []
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY']) {
    if (!process.env[k]) missing.push(k)
  }
  if (missing.length) return json(500, { error: `Missing env vars: ${missing.join(', ')}` })

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }
  const { registration_token, reason } = body
  if (!registration_token) return json(400, { error: 'registration_token required' })

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  // Look up the trainee + their class. We use registration_token as the
  // identifier (matches how Register.jsx finds them).
  const { data: trainee, error: tErr } = await supabase
    .from('trainees')
    .select(
      'id, first_name, last_name, phone, email, declined_at, classes!class_id(id, region, week_start_date, locations(name))',
    )
    .eq('registration_token', registration_token)
    .maybeSingle()
  if (tErr) return json(500, { error: `Supabase: ${tErr.message}` })
  if (!trainee) return json(404, { error: 'Trainee not found' })

  // Already declined — idempotent, just succeed.
  if (trainee.declined_at) {
    return json(200, { ok: true, already_declined: true, at: trainee.declined_at })
  }

  const cleanReason = (reason || '').trim().slice(0, 1000) || null
  const now = new Date().toISOString()

  const { error: upErr } = await supabase
    .from('trainees')
    .update({
      declined_at: now,
      declined_reason: cleanReason,
      enrolled: false,
      unenrolled_at: now,
    })
    .eq('id', trainee.id)
  if (upErr) return json(500, { error: `Update failed: ${upErr.message}` })

  // Fan out the notification — fire-and-forget so the trainee's "Thanks
  // for letting us know" screen doesn't wait on SMS/email round-trips.
  try {
    const { recipients } = await recipientsForEvent(supabase, 'trainee_declined', {
      legacyRole: 'admin',
    })
    if (recipients.length > 0) {
      const name = `${trainee.first_name || ''} ${trainee.last_name || ''}`.trim() || 'A trainee'
      const region = trainee.classes?.region || 'TBD'
      const location = trainee.classes?.locations?.name || 'TBD'
      const week = trainee.classes?.week_start_date || 'TBD'
      const reasonLine = cleanReason
        ? `\nReason: "${cleanReason}"`
        : '\n(They didn\'t leave a reason.)'
      const smsBody = `[Training] ${name} declined training for ${region} · ${location} (week of ${week}).${reasonLine}`
      const emailSubject = `Trainee declined: ${name} — ${region} (week of ${week})`
      const emailBody =
        `${name} just used the "I can't attend" link on the registration page.\n\n` +
        `Class: ${region} · ${location}\n` +
        `Week of: ${week}\n` +
        `Trainee phone: ${trainee.phone || '—'}\n` +
        `Trainee email: ${trainee.email || '—'}\n` +
        `${reasonLine.trim()}\n\n` +
        `They've been marked declined + un-enrolled. No more automated texts will fire to them.\n\n` +
        `— Training System`
      await notifyAll(recipients, {
        smsBody,
        emailSubject,
        emailBody,
        contactLabel: 'Admin',
      })
    }
  } catch (err) {
    console.warn('trainee_declined notify failed:', err.message)
  }

  return json(200, { ok: true })
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
