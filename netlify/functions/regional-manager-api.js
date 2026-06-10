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
//   POST { action: 'update_rep', token, trainee_id, phone?, email?,
//          street_address?, city?, state?, zip? }
//     → { ok, trainee: <updated>, address_changed }
//     Edits a rep's personal contact info + home address (NAME, rep level,
//     and company email/number stay locked — name keys the JobNimbus match).
//     Region-gated like deactivate. On any change, texts the office (admins
//     subscribed to 'rep_info_updated_by_manager') a plain-English summary
//     of what changed so they mirror it in GHL / JobNimbus / RepCard. When
//     the address changes the geocode is cleared; the client re-geocodes.
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
import { notifyOffboarding } from './_offboard-notify.js'

const SB_URL = process.env.SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SECRET_KEY

// CCG deal board ("CCG Records") lives in a SEPARATE app + database
// (free-roof-inspections.netlify.app, CCG's Supabase). Each zone's
// manager has a row in CCG's regional_managers table with their own
// token. We auto-resolve the manager's board link by zone: TMS's
// managed_region ('Zone 1'…) is the SAME string as CCG's zone column,
// so we look up the token and hand the manager a deep link to their
// own board — no per-manager setup. The CCG anon key is public (it's
// bundled into CCG's browser JS), so this is a read of public data.
const CCG_SB_URL = process.env.CCG_SUPABASE_URL
const CCG_SB_KEY = process.env.CCG_SUPABASE_ANON_KEY
const CCG_BOARD_URL = process.env.CCG_BOARD_URL || 'https://free-roof-inspections.netlify.app'

// Look up a manager's CCG deal-board deep link by zone. Best-effort:
// returns null on any miss (env unset, no matching zone, network) so a
// missing board just hides the tile rather than breaking the dashboard.
async function resolveCcgRecordsUrl(zone) {
  if (!CCG_SB_URL || !CCG_SB_KEY || !zone) return null
  try {
    const url =
      `${CCG_SB_URL}/rest/v1/regional_managers` +
      `?zone=eq.${encodeURIComponent(zone)}&select=token&limit=1`
    const res = await fetch(url, {
      headers: { apikey: CCG_SB_KEY, Authorization: `Bearer ${CCG_SB_KEY}` },
    })
    if (!res.ok) return null
    const rows = await res.json().catch(() => [])
    const tok = rows[0]?.token
    if (!tok) return null
    return `${CCG_BOARD_URL}/?manager=${encodeURIComponent(tok)}`
  } catch {
    return null
  }
}

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
    .select('id, first_name, last_name, phone, managed_region, manager_zoom_url')
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

    // Auto-resolve this manager's CCG deal-board link by zone.
    const ccgRecordsUrl = await resolveCcgRecordsUrl(region)

    return json(200, {
      ok: true,
      manager: {
        id: manager.id,
        first_name: manager.first_name,
        last_name: manager.last_name,
        region,
        zoom_url: manager.manager_zoom_url || null,
        ccg_records_url: ccgRecordsUrl,
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

    // Tell whoever clears reps out of the outside systems (GHL, Google
    // Workspace, RepCard, JobNimbus, Sales Academy). Shared helper so the
    // manager + admin paths fire the identical text. The DB is already
    // updated, so a failed alert must NOT fail the manager's action.
    await notifyOffboarding(supabase, {
      repName: `${target.first_name || ''} ${target.last_name || ''}`,
      region,
      flaggedBy: `${manager.first_name} ${manager.last_name}`,
      reason,
    })

    return json(200, { ok: true, trainee: updated })
  }

  if (action === 'update_rep') {
    const targetId = String(body.trainee_id || '').trim()
    if (!targetId) return json(400, { error: 'Missing trainee_id' })

    // Region-gate, same as deactivate — managers can only touch their crew.
    const { data: target } = await supabase
      .from('trainees')
      .select('id, first_name, last_name, region, phone, email, street_address, city, state, zip')
      .eq('id', targetId)
      .maybeSingle()
    if (!target) return json(404, { error: 'Rep not found.' })
    if (target.region !== region) {
      return json(403, { error: 'That rep is not in your region.' })
    }

    // Editable: personal contact info + home address. NAME, rep level, and
    // provisioned company email/number stay off limits — the name keys the
    // JobNimbus↔TMS zone match, so a manager rename would silently break
    // sale/inspection attribution. The office handles those via the alert
    // text below.
    const updates = {}
    const changes = []
    if (body.phone !== undefined) {
      const next = String(body.phone || '').trim()
      if (next && next !== (target.phone || '')) {
        updates.phone = next
        changes.push(`phone changed to ${next}`)
      }
    }
    if (body.email !== undefined) {
      const next = String(body.email || '').trim()
      if (next !== (target.email || '')) {
        updates.email = next
        changes.push(next ? `personal email changed to ${next}` : 'personal email cleared')
      }
    }
    // Home address — four fields, but reported as one "address changed to …"
    // line so the office gets a single readable address, not four diffs.
    let addressChanged = false
    for (const f of ['street_address', 'city', 'state', 'zip']) {
      if (body[f] !== undefined) {
        const next = String(body[f] || '').trim()
        if (next !== (target[f] || '')) {
          updates[f] = next
          addressChanged = true
        }
      }
    }
    if (addressChanged) {
      const merged = { ...target, ...updates }
      const addrStr = [merged.street_address, merged.city, [merged.state, merged.zip].filter(Boolean).join(' ')]
        .filter((s) => s && String(s).trim())
        .join(', ')
      changes.push(addrStr ? `home address changed to ${addrStr}` : 'home address cleared')
      // The map pin is keyed off the geocoded address; null the geocode so a
      // stale pin doesn't linger until the client re-geocodes (it will, on
      // success, fire geocode-trainee). geocoded_address mismatch also lets
      // the geocoder know the address is new.
      updates.latitude = null
      updates.longitude = null
      updates.geocoded_at = null
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
    const msg = `${repName}'s info was updated by ${manager.first_name} (${region}): ${changes.join('; ')}. Please update your other records (GHL, JobNimbus, RepCard).`
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

    return json(200, { ok: true, trainee: updated, address_changed: addressChanged })
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
      // No "reply to my number" line anymore: reps reply to the company
      // line, those replies are mirrored into the Team Replies inbox, and
      // cron-poll-rep-replies texts the manager a heads-up. So every blast
      // is implicitly two-way without exposing the manager's personal cell.
      payload.sms_body = smsBody
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
  // rep_messages mirrors rep<->manager SMS (inbound rows come from
  // cron-poll-rep-replies; see the 2026-06-03-rep-manager-messages.sql
  // migration). These three actions back the portal's inbox: read the
  // threads, reply to a rep, mark read. All region-gated by the token.

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
