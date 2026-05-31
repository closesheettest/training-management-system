// Announce a new regional sales manager to every active rep in their
// zone. Sends SMS + optional email. Each rep gets a link to the
// manager's vCard so they can save the contact to their phone with
// one tap.
//
// Triggered manually from the admin's Active Reps page — the
// "📣 Announce to zone" button next to each manager's row. No cron,
// no auto-fire. Neal clicks it tomorrow during the meeting.
//
// Request:
//   POST {
//     manager_id: '<trainee_id>',
//     channels:   { sms?: bool, email?: bool },
//     dry_run?:   bool      // true = return who would get it, don't send
//     offset?:    number    // pagination; client loops until next is null
//   }
//
// Response:
//   { ok, counts: {sms_sent, sms_failed, email_sent, email_failed,
//                  recipients}, next_offset, total, recipients?(dry_run) }
//
// Implementation: builds an SMS / email body with placeholders
// resolved per-recipient ({firstName} for the trainee, {managerName}
// + {managerPhone} + {zone} + {vcardLink} for the manager) and
// forwards to send-group-message scoped to all_active_reps + the
// manager's region.

import { createClient } from '@supabase/supabase-js'

const SB_URL = process.env.SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SECRET_KEY
const SITE_URL = (
  process.env.PUBLIC_SITE_URL ||
  process.env.URL ||
  process.env.DEPLOY_URL ||
  'https://trainingmanagementsys.netlify.app'
).replace(/\/$/, '')

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' })
  if (!SB_URL || !SB_KEY) return json(500, { error: 'Missing SUPABASE env vars' })

  let body
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Invalid JSON body' }) }

  const managerId = String(body.manager_id || '').trim()
  if (!managerId) return json(400, { error: 'manager_id required' })
  const channels = body.channels || {}
  const wantSms = !!channels.sms
  const wantEmail = !!channels.email
  if (!wantSms && !wantEmail) return json(400, { error: 'Pick at least one channel' })
  const dryRun = !!body.dry_run

  const supabase = createClient(SB_URL, SB_KEY)

  // Resolve the manager.
  const { data: m } = await supabase
    .from('trainees')
    .select('id, first_name, last_name, phone, email, company_email, managed_region')
    .eq('id', managerId)
    .maybeSingle()
  if (!m || !m.managed_region) return json(404, { error: 'Manager not assigned to a zone.' })

  const zone = m.managed_region
  const managerName = `${m.first_name || ''} ${m.last_name || ''}`.trim()
  const managerPhone = m.phone || ''
  const managerEmail = m.company_email || m.email || ''
  const vcardLink = `${SITE_URL}/.netlify/functions/regional-manager-vcard?id=${m.id}`

  // Build the SMS + email bodies. {firstName} → recipient first name
  // (resolved per-message in send-group-message). All other braces are
  // resolved here once.
  const smsBody =
    `Hi {firstName}, big news — ${managerName} is your new ${zone} regional sales manager.\n\n` +
    `Save their contact to your phone (one tap): ${vcardLink}\n\n` +
    `Reach out anytime. — U.S. Shingle`

  const emailSubject = `Meet your new ${zone} sales manager — ${managerName}`
  const emailBody =
    `<p>Hi {firstName},</p>` +
    `<p>You have a new regional sales manager — <strong>${escapeHtml(managerName)}</strong>.</p>` +
    `<p>${escapeHtml(managerName)} is your direct line for everything ${escapeHtml(zone)} — questions, scheduling, ride-alongs, support. Save their contact to your phone now so you have it when you need it.</p>` +
    `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin:18px 0;">` +
      `<tr><td style="background:#13294b;border-radius:8px;">` +
        `<a href="${vcardLink}" download style="display:inline-block;padding:12px 22px;color:#fff;font-weight:700;text-decoration:none;font-family:Arial,sans-serif;">📇 Save to phone</a>` +
      `</td></tr>` +
    `</table>` +
    `<p style="font-size:14px;color:#475569;">` +
      (managerPhone ? `📱 <strong>${escapeHtml(managerPhone)}</strong><br>` : '') +
      (managerEmail ? `✉️ <strong>${escapeHtml(managerEmail)}</strong>` : '') +
    `</p>` +
    `<p style="color:#475569;">— U.S. Shingle</p>`

  if (dryRun) {
    // Recipient preview only — same scope query, no send.
    const { data: recipients } = await supabase
      .from('trainees')
      .select('id, first_name, last_name, phone, company_email, email')
      .eq('is_active_sales_rep', true)
      .neq('rep_level', 'non_field')
      .eq('region', zone)
    return json(200, {
      ok: true,
      dry_run: true,
      manager: { name: managerName, zone, vcardLink },
      total: (recipients || []).length,
      // Exclude the manager themselves so we don't text/email them
      // their own announcement. send-group-message doesn't do this
      // automatically — it's our responsibility upstream.
      would_send_to: (recipients || [])
        .filter((r) => r.id !== m.id)
        .map((r) => `${r.first_name} ${r.last_name}`),
    })
  }

  // Resolve recipient IDs ourselves so we can exclude the manager.
  // send-group-message has a trainee_ids escape hatch that overrides
  // scope/region — we hand it the exact set of people we want.
  const { data: recipients, error: recErr } = await supabase
    .from('trainees')
    .select('id')
    .eq('is_active_sales_rep', true)
    .neq('rep_level', 'non_field')
    .eq('region', zone)
  if (recErr) return json(500, { error: recErr.message })
  const traineeIds = (recipients || []).map((r) => r.id).filter((id) => id !== m.id)
  if (traineeIds.length === 0) {
    return json(200, {
      ok: true,
      manager: { name: managerName, zone },
      counts: { sms_sent: 0, sms_failed: 0, email_sent: 0, email_failed: 0, recipients: 0 },
      total: 0,
      next_offset: null,
      note: 'No reps to announce to — the manager is the only person in this zone right now.',
    })
  }

  // Forward to the group-message broadcaster with the explicit ID set.
  // send-group-message handles batching, per-rep failure tracking, and
  // the {firstName} placeholder.
  const payload = {
    trainee_ids: traineeIds,
    channels: { ...(wantSms ? { sms: true } : {}), ...(wantEmail ? { email: true } : {}) },
    offset: Number.isFinite(+body.offset) ? +body.offset : 0,
  }
  if (wantSms) payload.sms_body = smsBody
  if (wantEmail) {
    payload.email_subject = emailSubject
    payload.email_body = emailBody
  }

  const res = await fetch(`${SITE_URL}/.netlify/functions/send-group-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) return json(res.status, { error: data?.error || 'Send failed' })
  return json(200, { ok: true, manager: { name: managerName, zone }, ...data })
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  }
}
