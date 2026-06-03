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
//   POST { action: 'update_rep', token, trainee_id, phone?, email? }
//     → { ok, trainee: <updated> }
//     Edits a rep's personal contact info (phone / email only). Region-
//     gated like deactivate. On any change, texts the office (admins
//     subscribed to 'rep_info_updated_by_manager', ADMIN_PHONE fallback)
//     a summary so they can mirror it in GHL / JobNimbus / RepCard.
//
//   POST { action: 'send_message', token, channels, sms_body?,
//          email_subject?, email_body?, offset? }
//     → { ok, counts, next_offset, total }
//     Runs the shared group-send logic (runGroupSend, _group-send.js)
//     IN-PROCESS, with scope locked to all_active_reps + the manager's
//     region. The manager can't pass scope/region themselves — those are
//     decided server-side from the token.
//
//   POST { action: 'list_messages', token }
//     → { ok, threads: [{ trainee_id, rep_name, rep_phone, last_at,
//          unread, messages: [{ id, direction, body, created_at }] }] }
//     The Team Replies inbox: every rep_messages row in the manager's
//     region, grouped into per-rep threads (latest first, chronological
//     within). Unmatched-sender rows (trainee_id null) never surface.
//
//   POST { action: 'send_reply', token, trainee_id, body }
//     → { ok }
//     Sends a manager's reply to a rep via GHL (the same company line),
//     mirrors it as an outbound rep_messages row, and clears that rep's
//     unread inbound count. Region-gated.
//
//   POST { action: 'mark_read', token, trainee_id }
//     → { ok }
//     Stamps read_at on the rep's unread inbound messages. Region-gated.
//
// All other request bodies / methods are rejected.
//
// No CRON_SECRET — this endpoint is intentionally public (it powers a
// public page). Security comes entirely from the unguessable token.

import { createClient } from '@supabase/supabase-js'
import { runGroupSend } from './_group-send.js'
import { recipientPhonesForEvent } from './_recipients.js'
import { sendSmsViaGhl } from './_ghl.js'

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

  if (action === 'update_rep') {
    const targetId = String(body.trainee_id || '').trim()
    if (!targetId) return json(400, { error: 'Missing trainee_id' })

    // Region-gate, same as deactivate — managers can only touch their crew.
    const { data: target } = await supabase
      .from('trainees')
      .select('id, first_name, last_name, region, phone, email')
      .eq('id', targetId)
      .maybeSingle()
    if (!target) return json(404, { error: 'Rep not found.' })
    if (target.region !== region) {
      return json(403, { error: 'That rep is not in your region.' })
    }

    // Only personal contact fields are editable here. Provisioned fields
    // (company email/number), rep level, and NAME are intentionally off
    // limits — names key the JobNimbus↔TMS zone match, so a manager rename
    // would silently break sale/inspection attribution.
    const updates = {}
    const changes = []
    if (body.phone !== undefined) {
      const next = String(body.phone || '').trim()
      if (next && next !== (target.phone || '')) {
        updates.phone = next
        changes.push(`Phone changed to ${next}`)
      }
    }
    if (body.email !== undefined) {
      const next = String(body.email || '').trim()
      if (next !== (target.email || '')) {
        updates.email = next
        changes.push(next ? `Email changed to ${next}` : 'Email cleared')
      }
    }
    if (changes.length === 0) {
      return json(200, { ok: true, trainee: target, no_change: true })
    }

    const { data: updated, error: upErr } = await supabase
      .from('trainees')
      .update(updates)
      .eq('id', targetId)
      .select(
        'id, first_name, last_name, phone, email, company_email, company_number, region, rep_level, rep_level_confirmed_at, info_updated_at, became_active_rep_at, street_address, city, state, zip, latitude, longitude, geocoded_at',
      )
      .maybeSingle()
    if (upErr) return json(500, { error: upErr.message })

    // Tell the office so they can mirror the change in GHL / JobNimbus /
    // RepCard. A failed alert must NOT fail the manager's edit — the DB is
    // already updated, so we swallow notify errors and just log them.
    const repName = `${target.first_name || ''} ${target.last_name || ''}`.trim() || 'A rep'
    const msg = `${repName}'s record was updated by ${manager.first_name} (${region}). ${changes.join('. ')}. Please update your records.`
    try {
      const { phones } = await recipientPhonesForEvent(supabase, 'rep_info_updated_by_manager', {
        legacyRole: 'admin',
      })
      for (const ph of phones) {
        await sendSmsViaGhl(ph, msg, { firstName: 'Rep update', lastName: 'Notify' })
      }
    } catch (e) {
      console.warn('rep_info_updated_by_manager notify failed:', e?.message || e)
    }

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

  // ── Team Replies inbox ───────────────────────────────────────────────
  // rep_messages mirrors rep<->manager SMS (see ghl-inbound-sms.js and the
  // 2026-06-03-rep-manager-messages.sql migration). These three actions
  // back the portal's inbox: read the threads, reply to a rep, mark read.
  // All region-gated by the token, same as everything else here.

  if (action === 'list_messages') {
    // Newest-first across the whole region, then grouped into per-rep
    // threads in JS. The region index makes this one cheap query; 500 rows
    // is far more than a regional inbox will hold but caps a runaway.
    const { data: rows, error: msgErr } = await supabase
      .from('rep_messages')
      .select('id, trainee_id, direction, body, from_phone, manager_id, read_at, created_at')
      .eq('region', region)
      .order('created_at', { ascending: false })
      .limit(500)
    if (msgErr) return json(500, { error: msgErr.message })

    // Resolve rep names for the threads in one extra query.
    const repIds = [...new Set((rows || []).map((r) => r.trainee_id).filter(Boolean))]
    let nameById = {}
    if (repIds.length) {
      const { data: reps } = await supabase
        .from('trainees')
        .select('id, first_name, last_name, phone')
        .in('id', repIds)
      nameById = Object.fromEntries(
        (reps || []).map((r) => [r.id, { name: `${r.first_name || ''} ${r.last_name || ''}`.trim(), phone: r.phone }]),
      )
    }

    // Group into threads. rows are newest-first, so the first row we see
    // for a rep is their latest message (drives thread ordering); we push
    // messages and reverse to chronological at the end.
    const threadMap = new Map()
    for (const r of rows || []) {
      if (!r.trainee_id) continue // unmatched senders never surface
      let t = threadMap.get(r.trainee_id)
      if (!t) {
        const who = nameById[r.trainee_id] || {}
        t = {
          trainee_id: r.trainee_id,
          rep_name: who.name || 'Unknown rep',
          rep_phone: who.phone || null,
          last_at: r.created_at,
          unread: 0,
          messages: [],
        }
        threadMap.set(r.trainee_id, t)
      }
      if (r.direction === 'inbound' && !r.read_at) t.unread += 1
      t.messages.push({
        id: r.id,
        direction: r.direction,
        body: r.body,
        created_at: r.created_at,
        read_at: r.read_at,
      })
    }
    const threads = [...threadMap.values()].map((t) => ({
      ...t,
      messages: t.messages.reverse(), // chronological for display
    }))
    // Threads already in latest-first order (rows were newest-first).

    return json(200, { ok: true, threads })
  }

  if (action === 'send_reply') {
    const targetId = String(body.trainee_id || '').trim()
    const replyBody = (body.body || '').toString().trim()
    if (!targetId) return json(400, { error: 'Missing trainee_id' })
    if (!replyBody) return json(400, { error: 'Reply is empty.' })

    // Region-gate — managers can only answer their own crew.
    const { data: target } = await supabase
      .from('trainees')
      .select('id, first_name, last_name, region, phone')
      .eq('id', targetId)
      .maybeSingle()
    if (!target) return json(404, { error: 'Rep not found.' })
    if (target.region !== region) {
      return json(403, { error: 'That rep is not in your region.' })
    }
    if (!target.phone) return json(400, { error: 'That rep has no phone on file.' })

    // Push the reply out through GHL (same company line the blast used, so
    // the rep sees it as part of the same thread on their phone).
    const sent = await sendSmsViaGhl(target.phone, replyBody, {
      firstName: target.first_name || 'Rep',
      lastName: target.last_name || '',
    })
    if (!sent.ok) {
      return json(502, { error: `Could not send: ${sent.error || sent.step || 'unknown'}` })
    }

    // Mirror the outbound reply so the thread shows it. manager_id labels
    // it "You" in the portal. We don't get a ghl_message_id back from the
    // send helper, so this row stays null there (the unique index allows
    // many null-id rows).
    const { error: insErr } = await supabase.from('rep_messages').insert({
      trainee_id: target.id,
      region,
      direction: 'outbound',
      body: replyBody,
      to_phone: target.phone,
      manager_id: manager.id,
    })
    if (insErr) return json(500, { error: insErr.message })

    // Replying implicitly clears the rep's unread inbound messages — the
    // manager has clearly engaged with the thread.
    await supabase
      .from('rep_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('trainee_id', target.id)
      .eq('region', region)
      .eq('direction', 'inbound')
      .is('read_at', null)

    return json(200, { ok: true })
  }

  if (action === 'mark_read') {
    const targetId = String(body.trainee_id || '').trim()
    if (!targetId) return json(400, { error: 'Missing trainee_id' })

    // Clear unread inbound messages for this rep's thread. Region-scoped in
    // the WHERE so a manager can only ever touch their own region's rows.
    const { error: upErr } = await supabase
      .from('rep_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('trainee_id', targetId)
      .eq('region', region)
      .eq('direction', 'inbound')
      .is('read_at', null)
    if (upErr) return json(500, { error: upErr.message })

    return json(200, { ok: true })
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
