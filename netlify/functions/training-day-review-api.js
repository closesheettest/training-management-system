// training-day-review-api.js — backs the public /review-training-day/:token
// page that DeWayne & Neal open from the submit notification.
//
// Token-only auth: the review_token in the URL is the credential. Every
// request resolves the token to its training_days row; there is no other
// way in. Writes use the service key (RLS is nominal-only app-wide), so
// the token check here IS the gate — keep it strict.
//
// Actions:
//   POST { action: 'load', token }
//     → { ok, day }               initial page load (any status)
//
//   POST { action: 'save', token, fields }
//     → { ok, day }               edit the content in place (does NOT
//                                 change status — reviewer can save drafts
//                                 while deciding). fields = subset of
//                                 { title, subject, theme, on_slide, point,
//                                   script, coach, drill }
//
//   POST { action: 'activate', token, activated_by?, fields? }
//     → { ok, day }               optional final edit, then status→'active',
//                                 stamps activated_at + appends to the end
//                                 of the live list (position = max+1).
//
//   POST { action: 'decline', token }
//     → { ok, day }               status→'archived' (kept, not deleted).
//
// Required env: SUPABASE_URL, SUPABASE_SECRET_KEY.

import { createClient } from '@supabase/supabase-js'

const EDITABLE = ['title', 'subject', 'theme', 'on_slide', 'point', 'script', 'coach', 'drill']

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return cors(200, '')
  if (event.httpMethod !== 'POST') return cors(405, { error: 'Method Not Allowed' })

  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY']) {
    if (!process.env[k]) return cors(500, { error: `Missing env var: ${k}` })
  }

  let body = {}
  try { body = JSON.parse(event.body || '{}') } catch { return cors(400, { error: 'Bad JSON' }) }
  const action = String(body.action || '').trim()
  const token = String(body.token || '').trim()
  if (!token) return cors(400, { error: 'Missing token' })

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  // Resolve the token → row. This is the gate for every action.
  const { data: day, error: loadErr } = await supabase
    .from('training_days')
    .select('*')
    .eq('review_token', token)
    .maybeSingle()
  if (loadErr) return cors(500, { error: loadErr.message })
  if (!day) return cors(404, { error: 'This review link is not valid.' })

  if (action === 'load') {
    return cors(200, { ok: true, day })
  }

  // Build a clean patch from only the whitelisted, provided fields.
  function cleanFields(src) {
    const patch = {}
    if (src && typeof src === 'object') {
      for (const k of EDITABLE) {
        if (k in src) patch[k] = src[k]
      }
    }
    return patch
  }

  if (action === 'save') {
    const patch = cleanFields(body.fields)
    patch.updated_at = new Date().toISOString()
    const { data, error } = await supabase
      .from('training_days').update(patch).eq('id', day.id).select('*').maybeSingle()
    if (error) return cors(500, { error: error.message })
    return cors(200, { ok: true, day: data })
  }

  if (action === 'activate') {
    const patch = cleanFields(body.fields)
    // Append after the current live days.
    const { data: maxRow } = await supabase
      .from('training_days').select('position').order('position', { ascending: false }).limit(1).maybeSingle()
    const nextPos = (maxRow?.position || 0) + 1
    Object.assign(patch, {
      status: 'active',
      activated_at: new Date().toISOString(),
      activated_by: (body.activated_by || '').toString().trim() || null,
      position: day.status === 'active' ? day.position : nextPos,
      updated_at: new Date().toISOString(),
    })
    const { data, error } = await supabase
      .from('training_days').update(patch).eq('id', day.id).select('*').maybeSingle()
    if (error) return cors(500, { error: error.message })
    return cors(200, { ok: true, day: data })
  }

  if (action === 'decline') {
    const { data, error } = await supabase
      .from('training_days')
      .update({ status: 'archived', updated_at: new Date().toISOString() })
      .eq('id', day.id).select('*').maybeSingle()
    if (error) return cors(500, { error: error.message })
    return cors(200, { ok: true, day: data })
  }

  return cors(400, { error: `Unknown action: ${action}` })
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
