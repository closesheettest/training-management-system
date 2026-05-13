// Netlify Function: IT marks provisioning complete on a class.
//
// Stamps classes.it_completed_at and fires two notifications:
//   * 'it_emails_provisioned' — HR-style summary
//   * 'va_setup_due'          — VA-style action prompt
// Both go to the public setup page (/setup/:class_id). Trainee credentials
// SMS is NOT sent here — that's the corporate trainer's button (Commit C).
//
// Required env vars: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN,
// GHL_LOCATION_ID, RESEND_API_KEY (only if any subscriber wants email)
// Optional: PUBLIC_SITE_URL, NOTIFICATION_FROM_EMAIL
//
// Request body: { class_id: "uuid" }

import { createClient } from '@supabase/supabase-js'
import { recipientsForEvent } from './_recipients.js'
import { notifyAll } from './_notify.js'

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
  const { class_id } = body
  if (!class_id) return json(400, { error: 'class_id required' })

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const siteUrl = (process.env.PUBLIC_SITE_URL || process.env.URL || process.env.DEPLOY_URL || '').replace(/\/$/, '')

  const { data: cls, error: clsErr } = await supabase
    .from('classes')
    .select('id, region, week_start_date, locations(name), trainees(id, enrolled, company_email)')
    .eq('id', class_id)
    .maybeSingle()
  if (clsErr || !cls) return json(404, { error: 'Class not found' })

  const provisionedCount = (cls.trainees || []).filter(
    (t) => t.enrolled !== false && t.company_email,
  ).length

  const { error: stampErr } = await supabase
    .from('classes')
    .update({ it_completed_at: new Date().toISOString() })
    .eq('id', class_id)
  if (stampErr) return json(500, { error: `Failed to stamp completion: ${stampErr.message}` })

  const setupLink = siteUrl ? `${siteUrl}/setup/${class_id}` : `/setup/${class_id}`
  const locationName = cls.locations?.name || `${cls.region} — TBD`
  const weekLabel = cls.week_start_date

  // HR-facing message
  const hrSms =
    `[Training] IT just provisioned ${provisionedCount} company email${provisionedCount === 1 ? '' : 's'} ` +
    `for ${cls.region} · ${locationName} (week of ${weekLabel}). ` +
    `View the list and confirm setup progress here: ${setupLink}`
  const hrEmailSubject = `Email list ready — ${cls.region} (week of ${weekLabel})`
  const hrEmailBody =
    `IT just provisioned ${provisionedCount} company email${provisionedCount === 1 ? '' : 's'} for ` +
    `${cls.region} · ${locationName} (week of ${weekLabel}).\n\n` +
    `Open the list and confirm setup progress:\n${setupLink}\n\n` +
    `— Training System`

  // VA-facing message
  const vaSms =
    `[Training] ${provisionedCount} new trainee${provisionedCount === 1 ? ' needs' : 's need'} to be set up in ` +
    `RepCard, JobNimbus, and Sales Academy for ${cls.region} (week of ${weekLabel}). Check them off as you go: ${setupLink}`
  const vaEmailSubject = `Set up ${provisionedCount} trainee${provisionedCount === 1 ? '' : 's'} — ${cls.region}`
  const vaEmailBody =
    `${provisionedCount} new trainee${provisionedCount === 1 ? ' needs' : 's need'} accounts created in ` +
    `RepCard, JobNimbus, and Sales Academy for ${cls.region} (week of ${weekLabel}).\n\n` +
    `Open the checklist (each platform tracks per-trainee progress):\n${setupLink}\n\n` +
    `— Training System`

  const hrRecipients = await recipientsForEvent(supabase, 'it_emails_provisioned', { legacyRole: 'hr' })
  const hrResult = await notifyAll(hrRecipients.recipients, {
    smsBody: hrSms,
    emailSubject: hrEmailSubject,
    emailBody: hrEmailBody,
    contactLabel: 'HR',
  })

  const vaRecipients = await recipientsForEvent(supabase, 'va_setup_due', { legacyRole: 'va' })
  const vaResult = await notifyAll(vaRecipients.recipients, {
    smsBody: vaSms,
    emailSubject: vaEmailSubject,
    emailBody: vaEmailBody,
    contactLabel: 'VA',
  })

  return json(200, {
    class_id,
    provisioned_count: provisionedCount,
    hr_notified: { ...hrResult, source: hrRecipients.source, recipient_count: hrRecipients.recipients.length },
    va_notified: { ...vaResult, source: vaRecipients.source, recipient_count: vaRecipients.recipients.length },
  })
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
