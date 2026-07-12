// ongoing-training-view-api.js — backs the manager training viewer at
// /ongoing-training/view/:token. The manager_access_token in the URL is the
// credential (same token as their regional-manager portal).
//
// Actions:
//   POST { action:'open', token, day? }
//     → { ok, manager_name, view_id, days:[...active training_days] }
//     Resolves the manager, loads the active curriculum, and logs a view row
//     (so we can see who opened it, for which day).
//
//   POST { action:'ping', view_id, seconds }
//     → { ok }
//     Heartbeat — updates the running time-on-page counter. Called every
//     ~30s while the tab is visible, and once more on unload (sendBeacon).
//
// Required env: SUPABASE_URL, SUPABASE_SECRET_KEY.

import { createClient } from '@supabase/supabase-js'

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return cors(200, '')
  if (event.httpMethod !== 'POST') return cors(405, { error: 'Method Not Allowed' })
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY']) {
    if (!process.env[k]) return cors(500, { error: `Missing env: ${k}` })
  }

  let body = {}
  try { body = JSON.parse(event.body || '{}') } catch { return cors(400, { error: 'Bad JSON' }) }
  const action = String(body.action || '').trim()
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  if (action === 'ping') {
    const viewId = String(body.view_id || '').trim()
    const seconds = Math.max(0, Math.min(60 * 60 * 8, parseInt(body.seconds, 10) || 0)) // clamp 0..8h
    if (!viewId) return cors(400, { error: 'view_id required' })
    await supabase.from('training_views')
      .update({ seconds, last_ping_at: new Date().toISOString() })
      .eq('id', viewId)
    return cors(200, { ok: true })
  }

  if (action === 'open') {
    const token = String(body.token || '').trim()
    if (!token) return cors(400, { error: 'token required' })

    const { data: mgr } = await supabase
      .from('trainees')
      .select('id, first_name, last_name, managed_region')
      .eq('manager_access_token', token)
      .maybeSingle()
    if (!mgr) return cors(404, { error: 'This training link is not valid.' })

    const { data: days, error } = await supabase
      .from('training_days').select('*').eq('status', 'active').order('position', { ascending: true })
    if (error) return cors(500, { error: error.message })

    const wantDay = parseInt(body.day, 10)
    const current = (days || []).find((d) => d.position === wantDay) || (days || [])[0] || null

    const { data: view } = await supabase.from('training_views').insert({
      manager_token: token,
      manager_id: mgr.id,
      manager_name: `${mgr.first_name || ''} ${mgr.last_name || ''}`.trim() || 'Manager',
      day_position: current?.position || null,
      day_title: current?.title || null,
    }).select('id').single()

    return cors(200, {
      ok: true,
      manager_name: (mgr.first_name || 'there').trim(),
      view_id: view?.id || null,
      days: days || [],
    })
  }

  return cors(400, { error: `Unknown action: ${action}` })
}

function cors(statusCode, obj) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
    body: typeof obj === 'string' ? obj : JSON.stringify(obj),
  }
}
