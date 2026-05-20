// Netlify Function: training class cancelled.
//
// Fires TWO event fan-outs in one call:
//
//   class_cancelled                         → whole office (short broadcast)
//   class_cancelled_reschedule_detail       → Hiring Manager (full breakdown)
//
// Triggered from ClassDetail.jsx's cancel-class flow as a fire-and-forget
// fetch right after the DB updates land. Failure here is non-fatal — the
// class is still cancelled, just nobody got notified.
//
// POST body: {
//   class_id: uuid,
//   cancelled_by: string,                  // person's name (from persona) or 'Admin'
//   reschedule_summary: [                  // one entry per trainee that was moved
//     { name: 'Jahlani Lansiquot',
//       destination: 'Tampa · May 25-29 holding list' | 'General holding pool' },
//     ...
//   ],
// }
//
// Required env vars: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN,
// GHL_LOCATION_ID. Optional: RESEND_API_KEY, EMAIL_FROM.

import { createClient } from '@supabase/supabase-js'
import { recipientsForEvent } from './_recipients.js'
import { notifyAll } from './_notify.js'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' })
  }

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

  const { class_id, cancelled_by, reschedule_summary } = body
  if (!class_id) return json(400, { error: 'class_id required' })

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  // Pull class info for the message body (location name, week dates).
  const { data: cls } = await supabase
    .from('classes')
    .select('id, region, week_start_date, week_end_date, locations(name, city)')
    .eq('id', class_id)
    .maybeSingle()

  const classLabel = cls?.locations?.name || `${cls?.region || 'Training'} class`
  const dateRange = cls
    ? formatDateRangeShort(cls.week_start_date, cls.week_end_date)
    : ''
  const movedCount = Array.isArray(reschedule_summary) ? reschedule_summary.length : 0

  // Short office-wide broadcast.
  const officeSms = [
    `🗑️ Training cancelled: ${classLabel}${dateRange ? ' · ' + dateRange : ''}.`,
    cancelled_by ? `Cancelled by ${cancelled_by}.` : '',
    movedCount > 0
      ? `${movedCount} trainee${movedCount === 1 ? '' : 's'} ${movedCount === 1 ? 'has' : 'have'} been rescheduled — see Hiring Manager for details.`
      : 'No trainees were enrolled.',
  ]
    .filter(Boolean)
    .join(' ')
  const officeEmailSubject = `Training cancelled: ${classLabel}${dateRange ? ' · ' + dateRange : ''}`
  const officeEmailBody = `
    <p>The following training was cancelled:</p>
    <ul>
      <li><strong>${classLabel}</strong></li>
      ${dateRange ? `<li>${dateRange}</li>` : ''}
      ${cancelled_by ? `<li>Cancelled by: ${cancelled_by}</li>` : ''}
    </ul>
    <p>${movedCount} trainee${movedCount === 1 ? '' : 's'} ${movedCount === 1 ? 'has' : 'have'} been rescheduled.
       The full breakdown went to the Hiring Manager.</p>
  `.trim()

  // Hiring Manager detail message — lists every rescheduled trainee
  // with their destination.
  const detailLines =
    Array.isArray(reschedule_summary) && reschedule_summary.length > 0
      ? reschedule_summary.map((r) => `• ${r.name} → ${r.destination}`).join('\n')
      : '• (No enrolled trainees were on this class.)'
  const hmSms =
    `🗑️ Training cancelled: ${classLabel}${dateRange ? ' · ' + dateRange : ''}.\n\n` +
    `Reschedule breakdown:\n${detailLines}\n\n` +
    `Manage at /manager → Holding pool.`
  const hmEmailSubject = `Reschedule breakdown — ${classLabel}${dateRange ? ' · ' + dateRange : ''}`
  const hmEmailBody = `
    <p><strong>${classLabel}${dateRange ? ' · ' + dateRange : ''}</strong> was cancelled${cancelled_by ? ` by ${cancelled_by}` : ''}.</p>
    <p>Here's where each trainee was rescheduled:</p>
    <ul>
      ${(reschedule_summary || []).map((r) => `<li>${escapeHtml(r.name)} → ${escapeHtml(r.destination)}</li>`).join('')}
    </ul>
    <p>Open the <a href="/manager">Hiring Manager page</a> → Holding pool to admit, move, or remove each one.</p>
  `.trim()

  // Fire both fan-outs sequentially. Each falls back to legacy roles
  // and ADMIN_PHONE if no subscriptions are configured yet.
  const officeRes = await recipientsForEvent(supabase, 'class_cancelled', { legacyRole: 'admin' })
  const officeNotify = await notifyAll(officeRes.recipients, {
    smsBody: officeSms,
    emailSubject: officeEmailSubject,
    emailBody: officeEmailBody,
    contactLabel: 'Training cancellation',
  })

  const hmRes = await recipientsForEvent(supabase, 'class_cancelled_reschedule_detail', {
    legacyRole: 'hiring_manager',
  })
  const hmNotify = await notifyAll(hmRes.recipients, {
    smsBody: hmSms,
    emailSubject: hmEmailSubject,
    emailBody: hmEmailBody,
    contactLabel: 'Training reschedule detail',
  })

  return json(200, {
    ok: true,
    office: {
      source: officeRes.source,
      recipients: officeRes.recipients.length,
      ...officeNotify,
    },
    hiring_manager: {
      source: hmRes.source,
      recipients: hmRes.recipients.length,
      ...hmNotify,
    },
  })
}

function formatDateRangeShort(start, end) {
  if (!start) return ''
  const s = new Date(start + 'T12:00:00')
  const e = end ? new Date(end + 'T12:00:00') : s
  const opts = { month: 'short', day: 'numeric' }
  const sStr = s.toLocaleDateString('en-US', opts)
  const eStr = e.toLocaleDateString('en-US', opts)
  return sStr === eStr ? sStr : `${sStr}–${eStr}`
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
