// Public-ish endpoint that exposes the active-rep → Zone mapping for
// consumption by other apps (today: CCG claims' weekly report builds
// its per-zone grouping from this).
//
// No auth: the payload is a list of rep names + their currently-
// assigned Zone. That data is roughly what would appear on the public
// team /directory page in TMS, so it doesn't warrant a shared secret
// just to be readable cross-origin. If we ever want to lock it down,
// add CORS-by-origin or an X-Api-Key header check here.
//
// Request:
//   GET /.netlify/functions/rep-zones
//     → Returns every active field rep with their name + jobnimbus_id
//       (when populated) + zone. Non-field staff and inactive reps
//       are excluded.
//
// Response:
//   {
//     ok: true,
//     generated_at: '2026-05-31T17:42:00.000Z',
//     count: 55,
//     reps: [
//       {
//         name: 'Anthony Alongi',
//         first_name: 'Anthony',
//         last_name: 'Alongi',
//         jobnimbus_id: '67abc1234567890abcdef',  // null if not backfilled
//         zone: 'Zone 1',                          // null if no zone
//       },
//       ...
//     ]
//   }
//
// CORS: open to any origin so CCG (and any future internal app) can
// fetch it from the browser. The data is public-ish; no credentials.

import { createClient } from '@supabase/supabase-js'

const SB_URL = process.env.SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SECRET_KEY

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return cors(200, '')
  }
  if (event.httpMethod !== 'GET') {
    return cors(405, JSON.stringify({ ok: false, error: 'Method Not Allowed' }))
  }
  if (!SB_URL || !SB_KEY) {
    return cors(500, JSON.stringify({ ok: false, error: 'Missing SUPABASE env vars' }))
  }

  // ?include_inactive=1 → return inactive sales reps too, each tagged
  // with active:true/false. Default (no param) is UNCHANGED: active
  // field reps only. Used by CCG's back-to-retail / no-damage reports so
  // a former rep's leftover deals can be grouped under a "Non-active rep"
  // header for the manager to reassign.
  const qp = event.queryStringParameters || {}
  const includeInactive = ['1', 'true', 'yes'].includes(String(qp.include_inactive || '').toLowerCase())

  const supabase = createClient(SB_URL, SB_KEY)
  let q = supabase
    .from('trainees')
    .select('first_name, last_name, jobnimbus_id, region, county, phone, rep_level, is_active_sales_rep')
    // Exclude only EXPLICIT non-field reps. A plain `.neq('rep_level','non_field')`
    // drops rows where rep_level IS NULL (SQL: null <> x → null → excluded), which
    // hid active reps activated manually without a rep_level set (e.g. Danny
    // Pasicolan → missing from zone reports). Keep null + anything ≠ non_field.
    .or('rep_level.is.null,rep_level.neq.non_field')
    .order('last_name', { ascending: true })
  if (!includeInactive) q = q.eq('is_active_sales_rep', true)
  const { data, error } = await q

  if (error) {
    return cors(500, JSON.stringify({ ok: false, error: error.message }))
  }

  const reps = (data || []).map((t) => ({
    name: `${t.first_name || ''} ${t.last_name || ''}`.trim(),
    first_name: t.first_name || '',
    last_name: t.last_name || '',
    jobnimbus_id: t.jobnimbus_id || null,
    zone: t.region || null,
    county: t.county || null,
    phone: t.phone || null,
    rep_level: t.rep_level || null,   // 'junior' | 'senior'
    active: t.is_active_sales_rep !== false,
  }))

  return cors(
    200,
    JSON.stringify({
      ok: true,
      generated_at: new Date().toISOString(),
      count: reps.length,
      reps,
    }),
  )
}

function cors(status, body) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60',
      // Open CORS — see header comment. Tighten to specific origins
      // (https://ccg-claims-docs.netlify.app etc.) if the data ever
      // becomes sensitive.
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
    },
    body,
  }
}
