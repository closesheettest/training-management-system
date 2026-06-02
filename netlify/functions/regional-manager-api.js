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
//     Runs the shared group-send logic (runGroupSend, _group-send.js)
//     IN-PROCESS, with scope locked to all_active_reps + the manager's
//     region. The manager can't pass scope/region themselves — those are
//     decided server-side from the token.
//
// All other request bodies / methods are rejected.
//
// No CRON_SECRET — this endpoint is intentionally public (it powers a
// public page). Security comes entirely from the unguessable token.

import { createClient } from '@supabase/supabase-js'
import { runGroupSend } from './_group-send.js'

const SB_URL = process.env.SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SECRET_KEY

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
    .select('id, first_name, last_name, phone, managed_region, manager_zoom_url, manager_helpline_url')
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
        'id, first_name, last_name, phone, email, company_email, company_number, region, rep_level, rep_level_confirmed_at, info_updated_at, became_active_rep_at, street_address, city, state, zip, latitude, longitude, geocoded_at',
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
        zoom_url: manager.manager_zoom_url || null,
        helpline_url: manager.manager_helpline_url || null,
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
    const replyToManager = !!body.reply_to_manager
    const smsBody = (body.sms_body || '').toString()
    const emailSubject = (body.email_subject || '').toString()
    const emailBody = (body.email_body || '').toString()
    if (wantSms && !smsBody.trim()) {
      return json(400, { error: 'SMS body is empty.' })
    }
    if (wantEmail && !emailBody.trim()) {
      return json(400, { error: 'Email body is empty.' })
    }

    // Run the broadcast IN-PROCESS — scope locked to active reps in the
    // manager's region. The manager doesn't get to choose the scope.
    //
    // This used to POST to send-group-message over an internal HTTP fetch.
    // That second function hop ran the entire send inside THIS function's
    // 10s Netlify budget, so regional blasts timed out and delivered
    // nothing while every other (in-process) SMS path worked. Calling
    // runGroupSend() directly removes the hop. See _group-send.js header.
    const payload = {
      scope: 'all_active_reps',
      region,
      channels: {
        ...(wantSms ? { sms: true } : {}),
        ...(wantEmail ? { email: true } : {}),
      },
      // Always copy the manager on their own blast so they see it land on
      // their phone. Deduped server-side — an in-zone manager gets one.
      include_trainee_ids: [manager.id],
      offset: Number.isFinite(+body.offset) ? +body.offset : 0,
    }
    if (wantSms) {
      // Reply mode: GHL texts from one company line, so a rep's reply never
      // lands on the manager's phone on its own. The only way replies reach
      // the manager is to put their number in the text and let reps text it
      // directly. Appended server-side so the number is authoritative and
      // survives every batch. Announcement mode omits it (one-way).
      const num = replyToManager ? formatPhone(manager.phone) : null
      payload.sms_body = num
        ? `${smsBody.trimEnd()}\n\nReply to ${manager.first_name}: ${num}`
        : smsBody
    }
    if (wantEmail) {
      payload.email_subject = emailSubject
      payload.email_body = emailBody
    }

    const { status, body: data } = await runGroupSend(payload)
    if (status >= 400) {
      return json(status, { error: data?.error || 'Send failed.' })
    }
    return json(200, { ok: true, ...data })
  }

  return json(400, { error: `Unknown action: ${action}` })
}

// (XXX) XXX-XXXX for the appended reply line; falls back to the raw value
// if it isn't a recognizable 10/11-digit US number.
function formatPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '')
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d
  if (ten.length !== 10) return String(raw || '').trim() || null
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`
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
