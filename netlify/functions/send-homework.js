// netlify/functions/send-homework.js
//
// Manually send ONE trainee their day's homework SMS — fired from the Class
// Detail page ("📚 Homework" button per trainee). Replaces the old automatic
// blast: homework no longer auto-sends; an admin sends it per person.
//
// POST { class_id, trainee_id, day_number? }
//   day_number defaults to today's training day (computed from the class week).
// → { ok, sent, day_number, quiz... } | { ok, skipped }
//
// Records the GHL message id (homework_message_id) so cron-check-sms-delivery
// can verify it actually delivered.
//
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN, GHL_LOCATION_ID,
//      PUBLIC_SITE_URL / URL.

import { createClient } from '@supabase/supabase-js'
import { sendSmsViaGhl } from './_ghl.js'
import { sendEmail } from './_email.js'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'GHL_PIT_TOKEN', 'GHL_LOCATION_ID']) {
    if (!process.env[k]) return json(500, { error: `Missing env: ${k}` })
  }
  let body
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Invalid JSON' }) }
  const { class_id, trainee_id } = body
  if (!class_id || !trainee_id) return json(400, { error: 'class_id and trainee_id required' })

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const siteUrl = (process.env.PUBLIC_SITE_URL || process.env.URL || 'https://trainingmanagementsys.netlify.app').replace(/\/$/, '')

  // 1. Class → today's training day_number (or an explicit override).
  const { data: cls, error: cErr } = await supabase
    .from('classes').select('week_start_date, week_end_date, attendance_only').eq('id', class_id).maybeSingle()
  if (cErr || !cls) return json(404, { error: 'Class not found' })
  if (cls.attendance_only) return json(200, { ok: true, skipped: 'attendance-only class' })
  let dayNumber = parseInt(body.day_number, 10)
  if (!dayNumber || dayNumber < 1) dayNumber = daysBetween(cls.week_start_date, ymd(new Date())) + 1
  if (dayNumber < 1) dayNumber = 1

  // 2. Lesson must be enabled + have a homework body.
  const { data: lesson } = await supabase
    .from('training_day_lessons')
    .select('day_number, homework_sms_body, homework_link_url, enabled')
    .eq('day_number', dayNumber).maybeSingle()
  if (!lesson?.enabled) return json(200, { ok: false, skipped: `Day ${dayNumber} lesson is disabled` })
  const homeworkBody = (lesson.homework_sms_body || '').trim()
  if (!homeworkBody) return json(200, { ok: false, skipped: `No homework authored for Day ${dayNumber}` })

  // 3. Trainee phone + email + name (+ company login for the email footer).
  const { data: trainee } = await supabase
    .from('trainees').select('first_name, phone, email, company_email, company_email_password').eq('id', trainee_id).maybeSingle()
  if (!trainee) return json(404, { error: 'Trainee not found' })
  if (!trainee.phone && !trainee.email) return json(200, { ok: false, skipped: 'No phone or email on file for this trainee' })

  // 4. Compose + send by BOTH email and SMS (email reaches trainees whose SMS
  //    is blocked/opted-out in GHL — the Lisa case).
  const firstName = trainee.first_name || 'there'
  const personal = homeworkBody.replace(/\{firstName\}/g, firstName)
  const link = (lesson.homework_link_url || '').trim()
  const absLink = link ? (link.startsWith('http') ? link : siteUrl + (link.startsWith('/') ? link : '/' + link)) : ''
  const message = absLink ? `${personal}\n\n${absLink}` : personal

  const channels = []
  const errors = []
  let messageId = null
  let emailId = null
  if (trainee.email) {
    try {
      const r = await sendEmail(trainee.email, `Your Day ${dayNumber} homework — U.S. Shingle & Metal`, message + loginBlock(trainee))
      if (r && r.ok !== false) { channels.push('email'); emailId = r.id || null } else errors.push('email: ' + (r?.error || 'failed'))
    } catch (e) { errors.push('email: ' + (e.message || 'error')) }
  }
  if (trainee.phone) {
    const smsRes = await sendSmsViaGhl(trainee.phone, message, { firstName, lastName: 'Homework' })
    if (smsRes.ok) { channels.push('sms'); messageId = smsRes.messageId || null }
    else errors.push('sms: ' + (smsRes.error || 'failed'))
  }
  if (!channels.length) return json(500, { ok: false, error: `Send failed — ${errors.join('; ') || 'unknown'}` })

  // 5. Stamp the attempt row (create or update), with the GHL message id +
  //    Resend email id for the delivery checker (only when each channel went out).
  const nowIso = new Date().toISOString()
  const stamp = { homework_sent_at: nowIso, homework_message_id: messageId, homework_delivery_status: null, homework_delivery_checked_at: null, homework_email_id: emailId, homework_email_status: null, homework_email_checked_at: null, updated_at: nowIso }
  const { data: existing } = await supabase
    .from('training_day_attempts').select('id').eq('trainee_id', trainee_id).eq('day_number', dayNumber).maybeSingle()
  if (existing) {
    await supabase.from('training_day_attempts').update(stamp).eq('id', existing.id)
  } else {
    await supabase.from('training_day_attempts').insert({ trainee_id, class_id, day_number: dayNumber, ...stamp })
  }

  return json(200, { ok: true, sent: true, day_number: dayNumber, channels, errors: errors.length ? errors : undefined })
}

// Company-email login appended to the homework EMAIL (not the SMS) so trainees
// always have their credentials handy. Only rendered when both are on file.
function loginBlock(t) {
  if (!t || !t.company_email || !t.company_email_password) return ''
  return `\n\n— Your company email login —\nEmail: ${t.company_email}\nPassword: ${t.company_email_password}\nYou'll be asked to change this password the first time you sign in.`
}

function ymd(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}
function daysBetween(fromIso, toIso) {
  return Math.round((new Date(toIso + 'T00:00:00Z') - new Date(fromIso + 'T00:00:00Z')) / 86400000)
}
function json(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}
