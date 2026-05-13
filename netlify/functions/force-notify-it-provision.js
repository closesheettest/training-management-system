// Manually fire the day-2 IT provisioning reminder for a single class.
// Called from the "Send day-2 IT reminder text now" button on the Class
// detail page. Always fires (no dedup check), then stamps so the cron won't
// double-text.
//
// Request body: { class_id }

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
    .select('id, region, week_start_date, locations(name)')
    .eq('id', class_id)
    .maybeSingle()
  if (clsErr || !cls) return json(404, { error: 'Class not found' })

  const { recipients, source } = await recipientsForEvent(supabase, 'day_2_provision_due', {
    legacyRole: 'it',
  })
  if (recipients.length === 0) {
    return json(200, {
      sent_count: 0,
      recipient_count: 0,
      source,
      warning:
        'No active IT subscribers found. Add at least one in /notifications and subscribe them to "Day 2 reminder — IT, please create emails".',
    })
  }

  const link = siteUrl ? `${siteUrl}/provision/${cls.id}` : `/provision/${cls.id}`
  const locationName = cls.locations?.name || `${cls.region} — TBD`

  const smsBody =
    `[Training] Manual reminder from your training admin: time to create company emails for ` +
    `${cls.region} · ${locationName}. Open the Provision page and click "Mark provisioning complete" when done: ${link}`
  const emailSubject = `Create company emails for ${cls.region} (week of ${cls.week_start_date})`
  const emailBody =
    `Manual reminder from your training admin.\n\n` +
    `Time to create company emails for ${cls.region} · ${locationName} (week of ${cls.week_start_date}).\n\n` +
    `Open the Provision page and click "Mark provisioning complete" when done:\n${link}\n\n` +
    `— Training System`

  const result = await notifyAll(recipients, {
    smsBody,
    emailSubject,
    emailBody,
    contactLabel: 'IT',
  })

  // Stamp so the cron won't double-fire later today.
  await supabase
    .from('classes')
    .update({ day_2_it_notified_at: new Date().toISOString() })
    .eq('id', class_id)

  return json(200, {
    sent_count: result.sms_sent + result.email_sent,
    sms_sent: result.sms_sent,
    email_sent: result.email_sent,
    recipient_count: recipients.length,
    source,
    preview_sms: smsBody,
    preview_email_subject: emailSubject,
    ...(result.errors.length ? { errors: result.errors } : {}),
  })
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
