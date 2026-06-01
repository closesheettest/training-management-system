// One-shot backfill: pull every CCG claims sales_rep, match against
// TMS trainees by case-insensitive full-name, and stamp jobnimbus_id
// on the matched trainee row.
//
// Run once after the 2026-05-31-jobnimbus-id migration to seed JN IDs
// for the existing ~55 active reps. Future reps can either:
//   (a) be picked up by re-running this (idempotent — already-set IDs
//       are skipped unless ?force=1), or
//   (b) be filled in manually by admin via the Edit Info modal on
//       /active-reps.
//
// Auth: requires the standard CRON_SECRET so this can't be triggered
// by a random visitor on the public URL.
//
// Cross-system env: needs CCG's Supabase URL + service role key so
// it can read sales_reps. We use SERVICE role (not anon) on the CCG
// side because we want to pull every rep even if RLS is enabled —
// service role bypasses RLS.
//
// Request:
//   POST /.netlify/functions/backfill-jobnimbus-ids?secret=<CRON_SECRET>
//     Body: { dry_run?: bool, force?: bool }
//       dry_run = true  → resolve matches, return preview, don't write
//       force   = true  → overwrite jobnimbus_id even when already set
//
// Response:
//   {
//     ok: true,
//     ccg_count: 73,
//     tms_count: 55,
//     matched: 48,
//     unmatched_ccg: ['Some Name', ...],  // in CCG but no TMS match
//     already_set: 2,                      // skipped unless force=1
//     updated: 46,
//     dry_run: false
//   }

import { createClient } from '@supabase/supabase-js'

const TMS_URL = process.env.SUPABASE_URL
const TMS_KEY = process.env.SUPABASE_SECRET_KEY
const CCG_URL = process.env.CCG_SUPABASE_URL
const CCG_KEY = process.env.CCG_SUPABASE_SECRET_KEY

export const handler = async (event) => {
  const params = event.queryStringParameters || {}
  if (process.env.CRON_SECRET && params.secret !== process.env.CRON_SECRET) {
    return json(401, { ok: false, error: 'Unauthorized' })
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Method Not Allowed' })
  }
  const missing = []
  for (const [k, v] of [
    ['SUPABASE_URL', TMS_URL],
    ['SUPABASE_SECRET_KEY', TMS_KEY],
    ['CCG_SUPABASE_URL', CCG_URL],
    ['CCG_SUPABASE_SECRET_KEY', CCG_KEY],
  ]) {
    if (!v) missing.push(k)
  }
  if (missing.length) {
    return json(500, { ok: false, error: `Missing env vars: ${missing.join(', ')}` })
  }

  let body = {}
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    /* tolerate empty body */
  }
  const dryRun = !!body.dry_run
  const force = !!body.force

  const tms = createClient(TMS_URL, TMS_KEY)
  const ccg = createClient(CCG_URL, CCG_KEY)

  // CCG side: pull every sales_rep with a jobnimbus_id. The name field
  // is free-text — we'll normalize it on the TMS side for matching.
  const { data: ccgReps, error: ccgErr } = await ccg
    .from('sales_reps')
    .select('name, jobnimbus_id')
  if (ccgErr) {
    return json(500, { ok: false, error: `CCG fetch: ${ccgErr.message}` })
  }
  const ccgWithIds = (ccgReps || []).filter((r) => r.jobnimbus_id)

  // TMS side: pull every active field rep. Inactive / non-field / etc.
  // don't need JN IDs because the rep-zones endpoint excludes them.
  const { data: tmsReps, error: tmsErr } = await tms
    .from('trainees')
    .select('id, first_name, last_name, jobnimbus_id')
    .eq('is_active_sales_rep', true)
    .neq('rep_level', 'non_field')
  if (tmsErr) {
    return json(500, { ok: false, error: `TMS fetch: ${tmsErr.message}` })
  }

  // Build a lookup keyed by normalized name. Normalization: lowercase,
  // collapse whitespace, strip punctuation. So "Anthony Alongi" and
  // "anthony  alongi" and "Anthony Alongi." all collide.
  const normalize = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()

  const tmsByName = new Map()
  for (const t of tmsReps || []) {
    const key = normalize(`${t.first_name} ${t.last_name}`)
    if (!tmsByName.has(key)) tmsByName.set(key, [])
    tmsByName.get(key).push(t)
  }

  const updates = [] // {id, jobnimbus_id, ccg_name, tms_name}
  const unmatchedCcg = []
  let alreadySet = 0
  for (const c of ccgWithIds) {
    const key = normalize(c.name)
    const candidates = tmsByName.get(key) || []
    if (candidates.length === 0) {
      unmatchedCcg.push(c.name)
      continue
    }
    if (candidates.length > 1) {
      // Multi-match — admin needs to disambiguate manually. Skip rather
      // than guess which trainee gets the JN ID.
      unmatchedCcg.push(`${c.name} (ambiguous — ${candidates.length} TMS matches)`)
      continue
    }
    const t = candidates[0]
    if (t.jobnimbus_id && !force) {
      alreadySet++
      continue
    }
    updates.push({
      id: t.id,
      jobnimbus_id: c.jobnimbus_id,
      ccg_name: c.name,
      tms_name: `${t.first_name} ${t.last_name}`,
    })
  }

  if (dryRun) {
    return json(200, {
      ok: true,
      dry_run: true,
      ccg_count: ccgWithIds.length,
      tms_count: (tmsReps || []).length,
      matched: updates.length,
      unmatched_ccg: unmatchedCcg,
      already_set: alreadySet,
      would_update: updates.map((u) => ({ tms_name: u.tms_name, jobnimbus_id: u.jobnimbus_id })),
    })
  }

  // Write updates. Doing it one-by-one is fine at this scale (~55
  // reps). Avoids any risk of partial-batch failure modes.
  let updated = 0
  for (const u of updates) {
    const { error } = await tms
      .from('trainees')
      .update({ jobnimbus_id: u.jobnimbus_id })
      .eq('id', u.id)
    if (!error) updated++
  }

  return json(200, {
    ok: true,
    dry_run: false,
    ccg_count: ccgWithIds.length,
    tms_count: (tmsReps || []).length,
    matched: updates.length,
    unmatched_ccg: unmatchedCcg,
    already_set: alreadySet,
    updated,
  })
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  }
}
