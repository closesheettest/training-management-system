// Regional Manager API — backs the public /regional-manager/:token page.
//
// Token-only auth: the URL itself is the credential. Every request must
// include the token; we resolve it to the trainee whose
// manager_access_token matches, read off managed_region, and gate every
// action to that region. There is no other way in.
//
// Why one function instead of three: the page only ever does three
// things (list reps, deactivate a rep, send a blast) and they all share
// the same token-validation + region-resolution preamble. Bundling them
// avoids 3 copies of that boilerplate and one round-trip to Supabase
// per cold start.
//
// Actions:
//   POST { action: 'whoami', token }
//     → { ok, manager: {first_name, last_name, region}, reps: [...] }
//     Used for the initial page load. Returns the manager record plus
//     the list of active field reps in their region.
//
//   POST { action: 'deactivate_rep', token, trainee_id, reason? }
//     → { ok, trainee: <updated> }
//     Marks the rep as departed (same fields the admin "No longer a
//     sales rep" modal stamps). Refuses if the target rep isn't in the
//     manager's region — the manager has zero reach outside their own
//     team.
//
//   POST { action: 'send_message', token, channels, sms_body?,
//          email_subject?, email_body?, offset? }
//     → { ok, counts, next_offset, total }
//     Thin proxy onto the existing send-group-message function, but with
//     scope locked to all_active_reps + the manager's region. The
//     manager can't pass scope/region themselves — those are decided
//     server-side from the token.
//
// All other request bodies / methods are rejected.
//
// No CRON_SECRET — this endpoint is intentionally public (it powers a
// public page). Security comes entirely from the unguessable token.

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
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  const action = String(body.action || '').trim()
  const token = String(body.token || '').trim()
  if (!token) return json(400, { error: 'Missing token' })

  const supabase = createClient(SB_URL, SB_KEY)

  // Resolve the token → manager record. If no match (revoked or typo'd),
  // 404 — same shape whether the token is fake or pointing at a former
  // manager whose row was cleared.
  const { data: manager } = await supabase
    .from('trainees')
    .select('id, first_name, last_name, phone, managed_region')
    .eq('manager_access_token', token)
    .maybeSingle()
  if (!manager || !manager.managed_region) {
    return json(404, { error: 'Invalid or revoked access link.' })
  }
  const region = manager.managed_region

  if (action === 'whoami') {
    // Active field reps in this region — same filter the admin page uses.
    // Includes non-active flags so the UI can render badges (info-updated,
    // unconfirmed rep level, etc.) without re-querying.
    const { data: reps, error: repsErr } = await supabase
      .from('trainees')
      .select(
        'id, first_name, last_name, phone, email, company_email, company_number, region, rep_level, rep_level_confirmed_at, info_updated_at, became_active_rep_at',
      )
      .eq('is_active_sales_rep', true)
      .neq('rep_level', 'non_field')
      .eq('region', region)
      .order('last_name', { ascending: true })
    if (repsErr) return json(500, { error: repsErr.message })

    return json(200, {
      ok: true,
      manager: {
        id: manager.id,
        first_name: manager.first_name,
        last_name: manager.last_name,
        region,
      },
      reps: reps || [],
    })
  }

  if (action === 'deactivate_rep') {
    const targetId = String(body.trainee_id || '').trim()
    if (!targetId) return json(400, { error: 'Missing trainee_id' })

    // Verify the target is actually in this manager's region. If not,
    // refuse — managers have no business reaching outside their own crew.
    const { data: target } = await supabase
      .from('trainees')
      .select('id, first_name, last_name, region, is_active_sales_rep')
      .eq('id', targetId)
      .maybeSingle()
    if (!target) return json(404, { error: 'Rep not found.' })
    if (target.region !== region) {
      return json(403, { error: 'That rep is not in your region.' })
    }
    if (!target.is_active_sales_rep) {
      // Already off — return the row so the UI removes it from the list
      // without making the manager wonder if something failed.
      return json(200, { ok: true, trainee: target, already_inactive: true })
    }

    // Same fields the admin "No longer a sales rep" modal stamps —
    // see ActiveReps.confirmLeaving(). Stamping left_company_at puts
    // the rep in the cleanup-pending pile so admin can finish the
    // GHL / RepCard / etc. scrub the next time they're on the page.
    const reason = (body.reason || '').toString().slice(0, 500).trim()
    const { data: updated, error: upErr } = await supabase
      .from('trainees')
      .update({
        is_active_sales_rep: false,
        became_active_rep_at: null,
        left_company_at: new Date().toISOString(),
        left_company_reason: reason
          ? `[Regional manager ${manager.first_name} ${manager.last_name}] ${reason}`
          : `Marked departed by regional manager (${manager.first_name} ${manager.last_name}).`,
        cleanup_done_at: null,
      })
      .eq('id', targetId)
      .select('id, first_name, last_name, left_company_at')
      .maybeSingle()
    if (upErr) return json(500, { error: upErr.message })

    return json(200, { ok: true, trainee: updated })
  }

  if (action === 'send_message') {
    const channels = body.channels || {}
    const wantSms = !!channels.sms
    const wantEmail = !!channels.email
    if (!wantSms && !wantEmail) {
      return json(400, { error: 'Pick at least one channel — SMS or email.' })
    }
    const smsBody = (body.sms_body || '').toString()
    const emailSubject = (body.email_subject || '').toString()
    const emailBody = (body.email_body || '').toString()
    if (wantSms && !smsBody.trim()) {
      return json(400, { error: 'SMS body is empty.' })
    }
    if (wantEmail && !emailBody.trim()) {
      return json(400, { error: 'Email body is empty.' })
    }

    // Forward to send-group-message with scope locked to active reps in
    // the manager's region. The manager doesn't get to choose the scope.
    const payload = {
      scope: 'all_active_reps',
      region,
      channels: {
        ...(wantSms ? { sms: true } : {}),
        ...(wantEmail ? { email: true } : {}),
      },
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
    if (!res.ok) {
      return json(res.status, { error: data?.error || 'Send failed.' })
    }
    return json(200, { ok: true, ...data })
  }

  return json(400, { error: `Unknown action: ${action}` })
}

function json(status, body) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  }
}
