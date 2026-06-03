// netlify/functions/cron-poll-rep-replies.js
//
// Pulls rep SMS replies out of GoHighLevel and mirrors them into the
// rep_messages table so the regional-manager portal's Team Replies inbox
// can show + answer them. GHL stays the source of truth.
//
// WHY POLL INSTEAD OF A WEBHOOK: GHL's push (a "Customer replied" Workflow
// → Webhook) needs the Automation/Workflows screen, which wasn't usable on
// this account. So instead of GHL pushing to us, WE pull from GHL — no
// setup inside GoHighLevel at all. The trade-off is latency: a reply shows
// up within ~1 minute (next poll) rather than instantly. Fine for this.
//
// HOW IT WORKS, each minute:
//   1. Load the active reps and index them by phone (last 10 digits).
//   2. Ask GHL for conversations whose latest message is an INBOUND SMS,
//      newest first (server-side filtered — 1.6k of 19k conversations, not
//      all of them). Page back only until we pass the lookback window.
//   3. For each such conversation whose phone matches a rep, fetch its
//      recent messages and mirror every inbound SMS from inside the window.
//      Conversations that don't match a rep (homeowners, leads) are skipped
//      without fetching messages — cheap.
//   4. Insert each as an inbound rep_messages row. ghl_message_id is the
//      GHL message id; the table's unique index dedupes, and we also skip
//      ids we already have, so re-scanning the overlapping window is a
//      no-op. Outbound (manager) replies are written by send_reply in
//      regional-manager-api and are ignored here.
//
// LOOKBACK: we re-scan a 10-minute window every run. The cron fires every
// minute, so this overlaps heavily — that overlap is intentional belt-and-
// suspenders against a missed/late fire, and dedup makes it free.
//
// Required env: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN,
// GHL_LOCATION_ID.

import { createClient } from '@supabase/supabase-js'

const SB_URL = process.env.SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SECRET_KEY
const GHL_TOKEN = process.env.GHL_PIT_TOKEN
const GHL_LOC = process.env.GHL_LOCATION_ID

const GHL_BASE = 'https://services.leadconnectorhq.com'
// Conversations endpoints use the 2021-04-15 API version (the SMS-send
// path in _ghl.js uses 2021-07-28 — different surface, different version).
const GHL_VERSION = '2021-04-15'

const LOOKBACK_MS = 10 * 60 * 1000
const CONV_PAGE = 100
const MAX_PAGES = 10 // safety cap — 1000 inbound-SMS convos per run is plenty

export const handler = async () => {
  if (!SB_URL || !SB_KEY) return json(500, { error: 'Missing SUPABASE env vars' })
  if (!GHL_TOKEN || !GHL_LOC) return json(500, { error: 'Missing GHL env vars' })

  const supabase = createClient(SB_URL, SB_KEY)
  const sinceMs = Date.now() - LOOKBACK_MS

  // Index active reps by normalized phone so we can match a conversation's
  // contact to a rep without an extra query per conversation.
  const { data: reps, error: repsErr } = await supabase
    .from('trainees')
    .select('id, region, phone, company_number')
    .eq('is_active_sales_rep', true)
  if (repsErr) return json(500, { error: repsErr.message })
  const repByPhone = new Map()
  for (const r of reps || []) {
    for (const p of [last10(r.phone), last10(r.company_number)]) {
      if (p && !repByPhone.has(p)) repByPhone.set(p, { id: r.id, region: r.region || null })
    }
  }

  let scanned = 0
  let matchedConvs = 0
  let inserted = 0
  let skippedDup = 0
  let startAfterDate = null

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const url =
        `${GHL_BASE}/conversations/search?locationId=${encodeURIComponent(GHL_LOC)}` +
        `&sortBy=last_message_date&sort=desc&lastMessageType=TYPE_SMS&lastMessageDirection=inbound` +
        `&limit=${CONV_PAGE}` +
        (startAfterDate != null ? `&startAfterDate=${startAfterDate}` : '')
      const data = await ghlGet(url)
      const convs = data?.conversations || []
      if (convs.length === 0) break

      let reachedWindowEnd = false
      for (const c of convs) {
        scanned++
        // lastMessageDate is epoch ms. Once we're past the window, every
        // later conversation is older too (sorted desc) — stop.
        if (typeof c.lastMessageDate === 'number' && c.lastMessageDate < sinceMs) {
          reachedWindowEnd = true
          break
        }
        const rep = repByPhone.get(last10(c.phone))
        if (!rep) continue // homeowner / lead — not a rep, skip cheaply
        matchedConvs++

        const res = await mirrorConversation(supabase, c, rep, sinceMs)
        inserted += res.inserted
        skippedDup += res.skipped
      }

      if (reachedWindowEnd) break
      const last = convs[convs.length - 1]
      if (typeof last?.lastMessageDate !== 'number') break
      startAfterDate = last.lastMessageDate
    }
  } catch (e) {
    return json(502, { ok: false, error: e?.message || 'GHL poll failed', scanned, inserted })
  }

  return json(200, { ok: true, scanned, matched_convs: matchedConvs, inserted, skipped_dup: skippedDup })
}

// Fetch a matched conversation's recent messages and insert every inbound
// SMS that landed inside the lookback window and isn't already stored.
async function mirrorConversation(supabase, conv, rep, sinceMs) {
  const url = `${GHL_BASE}/conversations/${encodeURIComponent(conv.id)}/messages?limit=20`
  const data = await ghlGet(url)
  const arr = data?.messages?.messages || []

  // Candidate inbound SMS in-window, with a stable id for dedup.
  const candidates = arr.filter(
    (m) =>
      m.direction === 'inbound' &&
      m.messageType === 'TYPE_SMS' &&
      m.id &&
      Date.parse(m.dateAdded || '') >= sinceMs,
  )
  if (candidates.length === 0) return { inserted: 0, skipped: 0 }

  // Drop ids we already mirrored (overlapping windows + prior pushes).
  const ids = candidates.map((m) => m.id)
  const { data: existing } = await supabase
    .from('rep_messages')
    .select('ghl_message_id')
    .in('ghl_message_id', ids)
  const have = new Set((existing || []).map((r) => r.ghl_message_id))

  let inserted = 0
  let skipped = 0
  for (const m of candidates) {
    if (have.has(m.id)) {
      skipped++
      continue
    }
    const { error } = await supabase.from('rep_messages').insert({
      trainee_id: rep.id,
      region: rep.region,
      direction: 'inbound',
      body: m.body || '',
      from_phone: m.from || conv.phone || null,
      ghl_message_id: m.id,
      ghl_contact_id: conv.contactId || m.contactId || null,
      created_at: m.dateAdded || new Date().toISOString(),
    })
    if (error) {
      // 23505 = a concurrent insert won the race on the unique index. Fine.
      if (error.code === '23505') skipped++
      else console.warn('rep_messages insert failed:', error.message || error)
    } else {
      inserted++
    }
  }
  return { inserted, skipped }
}

// GET a GHL endpoint as JSON with a small retry on 429/5xx.
async function ghlGet(url, maxAttempts = 3) {
  let res
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${GHL_TOKEN}`,
        Version: GHL_VERSION,
        Accept: 'application/json',
      },
    })
    if (res.status !== 429 && res.status < 500) break
    if (attempt === maxAttempts - 1) break
    const base = [600, 1500, 3000][attempt]
    await new Promise((r) => setTimeout(r, base + Math.floor(Math.random() * 400)))
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`GHL ${res.status}: ${txt.slice(0, 200)}`)
  }
  return res.json()
}

// Last 10 digits of a phone, ignoring a US country code. '' if unusable.
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
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  }
}

// Netlify v2 scheduled function — every minute. The toml block of the same
// name is authoritative (Netlify reads it), but keep these in sync.
export const config = { schedule: '* * * * *' }
