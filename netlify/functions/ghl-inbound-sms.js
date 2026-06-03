// netlify/functions/ghl-inbound-sms.js
//
// Inbound SMS webhook — the rep half of the rep<->regional-manager mirror.
//
// WHY: team texts go out 1:1 through GoHighLevel (the company line), so a
// rep's reply lands in GHL's conversation inbox — a place the regional
// manager never opens. This endpoint captures that reply and mirrors it
// into the rep_messages table so the manager's /regional-manager portal
// can show it (and let them answer). GHL stays the source of truth; this
// is a convenience window into it. See 2026-06-03-rep-manager-messages.sql.
//
// WIRING (one-time, in GHL): a Workflow with trigger "Customer replied"
// and a "Webhook" action POSTing here. Append ?key=<GHL_INBOUND_SECRET>
// to the URL (or send it as the x-webhook-secret header). See the setup
// notes the build shipped with.
//
// SECURITY: this endpoint is public (GHL has to reach it), so the shared
// secret is the only gate. A request without the right key gets 401 and
// nothing is written.
//
// WHAT IT DOES:
//   1. Verify the shared secret.
//   2. Pull phone / body / message-id / contact-id out of the GHL payload
//      (defensive — GHL workflow webhooks vary in shape).
//   3. Normalize the phone to its last 10 digits and match it to a trainee
//      (a rep). Unmatched senders are parked with trainee_id/region null so
//      they simply never surface to any manager (no error, no leak).
//   4. Insert an inbound rep_messages row. ghl_message_id is unique-indexed
//      so GHL's retries (it re-fires on non-2xx) dedupe to one row.
//   5. Return 200 fast — always 200 once the secret checks out, so GHL
//      doesn't retry-storm us over a row we already have or a sender we
//      can't match.
//
// Required env: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_INBOUND_SECRET.

import { createClient } from '@supabase/supabase-js'

const SB_URL = process.env.SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SECRET_KEY
const INBOUND_SECRET = process.env.GHL_INBOUND_SECRET

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' })
  if (!SB_URL || !SB_KEY) return json(500, { error: 'Missing SUPABASE env vars' })
  if (!INBOUND_SECRET) return json(500, { error: 'Missing GHL_INBOUND_SECRET' })

  // Secret gate — accept it from the query string (?key=) or a header so the
  // GHL Workflow can supply it either way.
  const qsKey = event.queryStringParameters?.key || ''
  const hdrKey = event.headers?.['x-webhook-secret'] || event.headers?.['X-Webhook-Secret'] || ''
  if (qsKey !== INBOUND_SECRET && hdrKey !== INBOUND_SECRET) {
    return json(401, { error: 'Unauthorized' })
  }

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    // Bad JSON from GHL — nothing to mirror, but don't make GHL retry.
    return json(200, { ok: true, skipped: 'unparseable_body' })
  }

  // GHL workflow webhooks don't have a fixed shape — the message text,
  // sender phone, and ids can live at several keys depending on how the
  // workflow's custom data is mapped. Probe the common ones.
  const rawPhone = firstString(
    body.phone,
    body.from,
    body.contact?.phone,
    body.message?.phone,
    body.sms?.from,
  )
  const text = firstString(
    body.message?.body,
    body.body,
    body.sms?.body,
    body.text,
    body.message,
  )
  const ghlMessageId = firstString(
    body.message?.id,
    body.messageId,
    body.message_id,
    body.id,
  )
  const ghlContactId = firstString(
    body.contactId,
    body.contact_id,
    body.contact?.id,
    body.message?.contactId,
  )

  const phone10 = last10(rawPhone)

  const supabase = createClient(SB_URL, SB_KEY)

  // Match the sender to a rep. Reps reply from their personal or company
  // line, so compare both. We pull the small set of active field reps and
  // match on normalized digits in JS — phones are stored in mixed formats
  // ((xxx) xxx-xxxx, +1xxxxxxxxxx, bare 10) so a SQL eq won't catch them.
  let trainee_id = null
  let region = null
  if (phone10) {
    const { data: reps } = await supabase
      .from('trainees')
      .select('id, region, phone, company_number')
      .eq('is_active_sales_rep', true)
    const match = (reps || []).find(
      (r) => last10(r.phone) === phone10 || last10(r.company_number) === phone10,
    )
    if (match) {
      trainee_id = match.id
      region = match.region || null
    }
  }

  // Insert the mirrored inbound row. On ghl_message_id collision (GHL
  // retried a delivery we already stored) the unique partial index makes
  // this a no-op conflict — swallow it and still return 200.
  const { error: insErr } = await supabase.from('rep_messages').insert({
    trainee_id,
    region,
    direction: 'inbound',
    body: text || '',
    from_phone: rawPhone || null,
    ghl_message_id: ghlMessageId || null,
    ghl_contact_id: ghlContactId || null,
  })
  if (insErr) {
    // 23505 = unique_violation on ghl_message_id → already mirrored, fine.
    if (insErr.code === '23505') {
      return json(200, { ok: true, duplicate: true })
    }
    // Any other DB error: log it but still 200 so GHL doesn't retry-storm.
    console.warn('rep_messages insert failed:', insErr.message || insErr)
    return json(200, { ok: false, error: 'insert_failed' })
  }

  return json(200, { ok: true, matched: !!trainee_id })
}

// First defined, non-empty string among the candidates (trimmed).
function firstString(...vals) {
  for (const v of vals) {
    if (v == null) continue
    const s = String(v).trim()
    if (s) return s
  }
  return ''
}

// Last 10 digits of a phone, ignoring a leading US country code. '' if not
// a recognizable 10/11-digit number.
function last10(raw) {
  const d = String(raw || '').replace(/\D/g, '')
  if (d.length === 10) return d
  if (d.length === 11 && d.startsWith('1')) return d.slice(1)
  if (d.length > 11) return d.slice(-10)
  return ''
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
