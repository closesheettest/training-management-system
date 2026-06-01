// Send a regional sales manager their personal dashboard link via SMS.
//
// Triggered from /active-reps when admin clicks "📲 Send access link"
// next to a manager. Pulls the manager's phone, builds the dashboard
// URL from their existing manager_access_token, and fires one SMS.
//
// Why not auto-send on assignment: per Neal's 2026-05-31 design call,
// the assignment flow stays explicit-copy-only — admin shares the
// link manually when the manager is ready. THIS function exists for
// the case where admin wants to send it via SMS instead of texting
// it from their own phone (e.g., during a meeting where pasting from
// the Mac into iMessage and selecting the recipient takes longer
// than clicking a button).
//
// Request:
//   POST { trainee_id: '<manager_trainee_id>' }
//     The trainee must have:
//       - is_active_sales_rep = true
//       - managed_region set
//       - manager_access_token set (the URL token)
//       - phone set
//
// Response:
//   { ok: true, sent_to: 'name', phone_last4: '...' } on success
//   { ok: false, error: '...' } on validation / send failure

import { createClient } from '@supabase/supabase-js'
import { sendSmsViaGhl } from './_ghl.js'

const SB_URL = process.env.SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SECRET_KEY
const SITE_URL = (
  process.env.PUBLIC_SITE_URL ||
  process.env.URL ||
  process.env.DEPLOY_URL ||
  'https://trainingmanagementsys.netlify.app'
).replace(/\/$/, '')

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
  const { data: m } = await supabase
    .from('trainees')
    .select('id, first_name, last_name, phone, managed_region, manager_access_token, is_active_sales_rep')
    .eq('id', traineeId)
    .maybeSingle()
  if (!m) return json(404, { ok: false, error: 'Trainee not found.' })
  if (!m.is_active_sales_rep) return json(400, { ok: false, error: 'Not an active rep.' })
  if (!m.managed_region) return json(400, { ok: false, error: 'Not a regional manager.' })
  if (!m.manager_access_token) {
    return json(400, { ok: false, error: 'No access token set. Revoke + reassign to generate one.' })
  }
  if (!m.phone) return json(400, { ok: false, error: 'No phone number on file for this manager.' })

  const url = `${SITE_URL}/regional-manager/${m.manager_access_token}`
  const firstName = m.first_name || 'there'

  // Body kept short on purpose — long SMS body + URL pushes some
  // carriers to segment, which means slower delivery and higher
  // chance of GHL deduping it as spam. One sentence + URL works.
  const message =
    `Hi ${firstName}, this is your U.S. Shingle regional manager dashboard. ` +
    `See your team, save contacts to your phone, and message everyone in your zone in one tap.\n\n` +
    `${url}\n\n` +
    `Tap to open. Save it — it's how you'll reach your team going forward.`

  try {
    const res = await sendSmsViaGhl(m.phone, message, {
      label: 'regional-manager-link',
      trainee_id: m.id,
    })
    if (!res?.ok) {
      return json(502, {
        ok: false,
        error: res?.error || 'GHL SMS failed.',
        details: res,
      })
    }
  } catch (e) {
    return json(502, { ok: false, error: e?.message || 'Network error sending SMS.' })
  }

  // Stamp the send so we have a record. Skips the stamp on failure
  // above so retries aren't silently swallowed.
  await supabase
    .from('trainees')
    .update({ manager_link_sent_at: new Date().toISOString() })
    .eq('id', m.id)

  return json(200, {
    ok: true,
    sent_to: `${m.first_name} ${m.last_name}`.trim(),
    phone_last4: (m.phone.match(/\d/g) || []).slice(-4).join(''),
  })
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  }
}
