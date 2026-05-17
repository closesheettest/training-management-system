// Broadcast a message to a group of trainees by SMS, email, or both.
// Triggered manually from the /group-messages admin page.
//
// Request body:
//   {
//     scope: 'class' | 'all_active_reps',
//     class_id?: 'uuid',           // required when scope === 'class'
//     region?: 'St Pete'|'Jacksonville'|...,  // optional region filter
//                                  // (applies to all_active_reps scope only)
//     channels: { sms?: bool, email?: bool },
//     sms_body?: string,            // raw body OR with {firstName}/{link} placeholders
//     email_subject?: string,
//     email_body?: string,
//     // Optional convenience: if provided, the function loads the named
//     // message_templates row(s) and uses their body/subject — handy when
//     // the admin picked "Update info request" instead of free-text.
//     sms_template_key?: string,
//     email_template_key?: string,
//   }
//
// Scope semantics:
//   'class' = every enrolled/non-declined trainee assigned to that class
//     (regardless of registration status or active-rep flag). Used for
//     talking to a cohort during training week.
//   'all_active_reps' = every trainee where is_active_sales_rep = true.
//     This is the durable "on the sales team in the field" list —
//     decoupled from training-week state so no-shows and unregistered
//     trainees never get blasts meant for working reps. Combine with
//     `region` to slice to one geographic area (regional manager fanout).
//
// Per-recipient substitution:
//   {firstName} → trainee.first_name
//   {link}      → site_url/update-info/<registration_token>
//
// Each successful send (sms OR email) stamps trainees.last_group_message_sent_at
// so admin can see "last messaged" on the trainee.
//
// No auth — admin-only page triggers, same as other manual admin functions.
//
// Required env vars: SUPABASE_URL, SUPABASE_SECRET_KEY,
// GHL_PIT_TOKEN, GHL_LOCATION_ID (for SMS),
// RESEND_API_KEY + EMAIL_FROM (for email).

import { createClient } from '@supabase/supabase-js'
import { sendSmsViaGhl } from './_ghl.js'
import { sendEmail } from './_email.js'

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

  const channels = body.channels || {}
  const wantSms = !!channels.sms
  const wantEmail = !!channels.email
  if (!wantSms && !wantEmail) {
    return json(400, { error: 'At least one channel (sms or email) is required' })
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const siteUrl = (
    process.env.PUBLIC_SITE_URL ||
    process.env.URL ||
    process.env.DEPLOY_URL ||
    'https://trainingmanagementsys.netlify.app'
  ).replace(/\/$/, '')

  // Resolve any template keys the admin specified into actual body/subject.
  let smsBody = (body.sms_body || '').toString()
  let emailSubject = (body.email_subject || '').toString()
  let emailBody = (body.email_body || '').toString()

  if (wantSms && body.sms_template_key && !smsBody) {
    const { data: t } = await supabase
      .from('message_templates')
      .select('body')
      .eq('key', body.sms_template_key)
      .maybeSingle()
    if (t?.body) smsBody = t.body
  }
  if (wantEmail && body.email_template_key && (!emailBody || !emailSubject)) {
    const { data: t } = await supabase
      .from('message_templates')
      .select('subject, body')
      .eq('key', body.email_template_key)
      .maybeSingle()
    if (t) {
      if (!emailSubject && t.subject) emailSubject = t.subject
      if (!emailBody && t.body) emailBody = t.body
    }
  }

  if (wantSms && !smsBody.trim()) {
    return json(400, { error: 'SMS body is empty — provide sms_body or a valid sms_template_key' })
  }
  if (wantEmail && !emailBody.trim()) {
    return json(400, { error: 'Email body is empty — provide email_body or a valid email_template_key' })
  }

  // Resolve recipients based on scope.
  let q = supabase
    .from('trainees')
    .select(
      'id, first_name, phone, email, registration_token, enrolled, declined_at, is_active_sales_rep',
    )

  if (body.scope === 'class') {
    if (!body.class_id) return json(400, { error: 'class_id required when scope=class' })
    q = q.eq('class_id', body.class_id).neq('enrolled', false).is('declined_at', null)
  } else if (body.scope === 'all_active_reps' || body.scope === 'all_enrolled') {
    // 'all_enrolled' is the legacy alias — kept so a cached client doesn't
    // 400. Both paths apply the same active-rep filter.
    q = q.eq('is_active_sales_rep', true)
    if (body.region) {
      // Optional region slice — regional-manager broadcasts. Skipped on
      // company-wide blasts.
      q = q.eq('region', body.region)
    }
  } else {
    return json(400, { error: 'scope must be "class" or "all_active_reps"' })
  }

  const { data: trainees, error } = await q
  if (error) return json(500, { error: `Supabase: ${error.message}` })
  if (!trainees || trainees.length === 0) {
    return json(200, { ok: true, message: 'No recipients matched.', counts: { sms: 0, email: 0 } })
  }

  // Fan out in parallel, one promise per (recipient, channel).
  const tasks = []
  for (const t of trainees) {
    const vars = {
      firstName: t.first_name || 'there',
      link: t.registration_token ? `${siteUrl}/update-info/${t.registration_token}` : '',
    }
    if (wantSms && t.phone) {
      const msg = applyPlaceholders(smsBody, vars)
      tasks.push(
        sendSmsViaGhl(t.phone, msg, {
          firstName: t.first_name || 'Trainee',
          lastName: 'Group',
        }).then((s) => ({ trainee_id: t.id, channel: 'sms', ok: s.ok, error: s.error })),
      )
    }
    if (wantEmail && t.email) {
      const subject = applyPlaceholders(emailSubject || 'Update from training', vars)
      const msg = applyPlaceholders(emailBody, vars)
      tasks.push(
        sendEmail(t.email, subject, msg).then((s) => ({
          trainee_id: t.id, channel: 'email', ok: s.ok, error: s.error,
        })),
      )
    }
  }

  const results = await Promise.all(tasks)

  // Stamp last_group_message_sent_at for every trainee who got at least
  // one successful send. Single batch update for efficiency.
  const stampedIds = Array.from(
    new Set(results.filter((r) => r.ok).map((r) => r.trainee_id)),
  )
  if (stampedIds.length > 0) {
    await supabase
      .from('trainees')
      .update({ last_group_message_sent_at: new Date().toISOString() })
      .in('id', stampedIds)
  }

  const counts = {
    sms_sent: results.filter((r) => r.channel === 'sms' && r.ok).length,
    sms_failed: results.filter((r) => r.channel === 'sms' && !r.ok).length,
    email_sent: results.filter((r) => r.channel === 'email' && r.ok).length,
    email_failed: results.filter((r) => r.channel === 'email' && !r.ok).length,
    recipients: trainees.length,
  }
  const failures = results.filter((r) => !r.ok)

  return json(200, {
    ok: true,
    counts,
    ...(failures.length ? { failures: failures.slice(0, 50) } : {}),
  })
}

function applyPlaceholders(str, vars) {
  return String(str || '').replace(/\{(\w+)\}/g, (_, name) => {
    const v = vars[name]
    return v === undefined || v === null || v === '' ? `{${name}}` : String(v)
  })
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
