// send-sandbox-inspection.js — office-triggered blast of the PRACTICE
// (sandbox) Free Roof Inspection signing link to every rep who's signed in.
//
// "Signed in" = a confirmed attendance row for the date (default: today, ET).
// Dropouts are excluded. Each rep gets it by BOTH SMS and email (some numbers
// are DND/opted-out, so SMS alone misses people).
//
// The sandbox link (?mode=training) is a shared practice mode — reps rehearse
// the whole signup + sign flow and nothing is saved.
//
// POST { date? }  →  { ok, date, signed_in, recipients, sms_sent, email_sent }
//
// Required env: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN, GHL_LOCATION_ID

import { createClient } from '@supabase/supabase-js'
import { sendSmsViaGhl } from './_ghl.js'
import { sendEmail } from './_email.js'

const SANDBOX_URL = process.env.SANDBOX_INSPECTION_URL || 'https://free-roof-inspections.netlify.app/?mode=training'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method Not Allowed' })
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'GHL_PIT_TOKEN', 'GHL_LOCATION_ID']) {
    if (!process.env[k]) return json(500, { ok: false, error: `Missing env: ${k}` })
  }

  let body = {}
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { ok: false, error: 'Bad JSON' }) }
  const etToday = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const date = String(body.date || etToday).slice(0, 10)

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  // Who's signed in (confirmed attendance) on this date.
  const { data: att, error: attErr } = await supabase
    .from('attendance').select('trainee_id').eq('attendance_date', date).eq('confirmed', true)
  if (attErr) return json(500, { ok: false, error: attErr.message })
  const ids = [...new Set((att || []).map((a) => a.trainee_id).filter(Boolean))]
  if (!ids.length) return json(200, { ok: true, date, signed_in: 0, recipients: 0, sms_sent: 0, email_sent: 0, note: `Nobody signed in on ${date}.` })

  const { data: trainees, error: trErr } = await supabase
    .from('trainees')
    .select('id, first_name, last_name, phone, email, enrolled, dropout_notified_at')
    .in('id', ids)
  if (trErr) return json(500, { ok: false, error: trErr.message })

  // Active reps only — drop dropouts and anyone with no contact info.
  const recipients = (trainees || []).filter(
    (t) => t.enrolled !== false && !t.dropout_notified_at && (t.phone || t.email),
  )

  const smsBody =
    `🎓 Practice the Free Roof Inspection! Open this and run the whole signup + sign flow — ` +
    `it's just practice, nothing is saved:\n${SANDBOX_URL}`
  const emailSubject = 'Practice: Free Roof Inspection signing'

  let smsSent = 0, emailSent = 0
  for (const t of recipients) {
    const first = (t.first_name || 'there').trim()
    const emailBody =
      `Hi ${first},\n\n` +
      `Here's the practice Free Roof Inspection — run the whole signup + sign flow to get comfortable with it. ` +
      `It's just practice; nothing is saved.\n\n` +
      `Open it here: ${SANDBOX_URL}\n`
    if (t.phone) {
      const r = await sendSmsViaGhl(t.phone, smsBody, { firstName: first, lastName: (t.last_name || 'Rep') })
      if (r?.ok) smsSent++
    }
    if (t.email) {
      const r = await sendEmail(t.email, emailSubject, emailBody)
      if (r?.ok) emailSent++
    }
  }

  return json(200, { ok: true, date, signed_in: ids.length, recipients: recipients.length, sms_sent: smsSent, email_sent: emailSent })
}

function json(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) }
}
