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
//     // Batching: client loops calling this with increasing offset until
//     // the response has next_offset = null. Each call processes up to
//     // BATCH_SIZE=20 recipients to fit in Netlify's 10s function timeout.
//     offset?: number,             // default 0
//     // Optional override: when provided, recipients are scoped to these
//     // exact trainees (ignoring scope/class_id/region). Used by the UI's
//     // "Email these failures" button to re-route an SMS broadcast that
//     // bounced (DND, unsubscribed) over to email instead.
//     trainee_ids?: string[],
//   }
//
// Response:
//   {
//     ok: true,
//     counts: { sms_sent, sms_failed, email_sent, email_failed, recipients },
//     next_offset: number | null,  // null when no more batches remain
//     total: number,               // total recipients across all batches
//     failures?: [{trainee_id, channel, error}, ...]
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
// The actual recipient-resolve + send loop lives in _group-send.js so the
// regional-manager blast can reuse it IN-PROCESS (regional-manager-api.js)
// instead of calling this function over HTTP — see that module's header for
// why the old function-to-function hop was the bug.
//
// Required env vars: SUPABASE_URL, SUPABASE_SECRET_KEY,
// GHL_PIT_TOKEN, GHL_LOCATION_ID (for SMS),
// RESEND_API_KEY + EMAIL_FROM (for email).

import { runGroupSend } from './_group-send.js'

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

  const { status, body: payload } = await runGroupSend(body)
  return json(status, payload)
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
