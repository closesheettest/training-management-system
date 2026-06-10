// notify-offboarding.js — fired by the ADMIN Active-Reps page right after
// an admin marks a rep "Quit / Fired" (that write is a direct client-side
// Supabase update, so it can't send GHL texts itself). The regional-manager
// path sends the same alert in-process via _offboard-notify.js; this gives
// the admin path the identical notification.
//
// POST { trainee_id, flaggedBy?, reason? }
// → { ok, sent }
//
// Guard: we only notify for a rep who is ACTUALLY flagged for cleanup
// (left_company_at set, is_active_sales_rep false, cleanup not done) — so a
// stray/replayed call can't spam the cleanup crew.
//
// Required env: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN, GHL_LOCATION_ID.

import { createClient } from '@supabase/supabase-js'
import { notifyOffboarding } from './_offboard-notify.js'

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return cors(200, '')
  if (event.httpMethod !== 'POST') return cors(405, { error: 'Method Not Allowed' })

  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'GHL_PIT_TOKEN', 'GHL_LOCATION_ID']) {
    if (!process.env[k]) return cors(500, { error: `Missing env var: ${k}` })
  }

  let body = {}
  try { body = JSON.parse(event.body || '{}') } catch { return cors(400, { error: 'Bad JSON' }) }
  const traineeId = String(body.trainee_id || '').trim()
  if (!traineeId) return cors(400, { error: 'Missing trainee_id' })

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const { data: rep, error } = await supabase
    .from('trainees')
    .select('id, first_name, last_name, region, is_active_sales_rep, left_company_at, cleanup_done_at, left_company_reason')
    .eq('id', traineeId)
    .maybeSingle()
  if (error) return cors(500, { error: error.message })
  if (!rep) return cors(404, { error: 'Rep not found' })

  // Only notify for a genuinely-flagged-for-cleanup rep.
  if (rep.is_active_sales_rep || !rep.left_company_at || rep.cleanup_done_at) {
    return cors(200, { ok: true, sent: 0, skipped: 'not flagged for cleanup' })
  }

  // Prefer an explicit reason from the caller; fall back to the stored one.
  const reason = (body.reason || rep.left_company_reason || '').toString().trim()
  const { sent } = await notifyOffboarding(supabase, {
    repName: `${rep.first_name || ''} ${rep.last_name || ''}`,
    region: rep.region,
    flaggedBy: (body.flaggedBy || 'the office').toString().trim() || 'the office',
    reason,
  })

  return cors(200, { ok: true, sent })
}

function cors(status, obj) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
    body: typeof obj === 'string' ? obj : JSON.stringify(obj),
  }
}
