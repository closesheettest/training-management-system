// Sales Training Customer: save and read practice sessions (trainer-only).
//
// POST { pin, action:'save', session:{ trainee_id, trainee_name, class_id,
//        persona_key, section, started_at, ended_at, transcript, close_silence } }
//        → { ok, id }   and kicks off grading (practice-grade-background)
// POST { pin, action:'get', id }                 → { ok, session }
// POST { pin, action:'list', trainee_id? }       → { ok, sessions }   (newest 60)
//
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY, CRON_SECRET (authorizes the grader call).
import { createClient } from '@supabase/supabase-js'
import { verifyTrainerPin, json } from './_practice-auth.js'

const LIST_COLS = 'id, trainee_id, trainee_name, class_id, trainer_name, persona_key, section, started_at, duration_sec, grade_status, score'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' })
  let body
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { ok: false, error: 'bad JSON' }) }
  const who = await verifyTrainerPin(body.pin)
  if (!who) return json(401, { ok: false, error: 'Sign in again (PIN not recognized).' })
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  if (body.action === 'save') {
    const s = body.session || {}
    const transcript = Array.isArray(s.transcript) ? s.transcript.slice(0, 4000) : []
    const started = s.started_at ? new Date(s.started_at) : new Date()
    const ended = s.ended_at ? new Date(s.ended_at) : new Date()
    const row = {
      trainee_id: s.trainee_id || null,
      trainee_name: String(s.trainee_name || '').slice(0, 120) || null,
      class_id: s.class_id || null,
      trainer_name: who.name || null,
      persona_key: String(s.persona_key || ''),
      section: String(s.section || 'full'),
      started_at: started.toISOString(),
      ended_at: ended.toISOString(),
      duration_sec: Math.max(0, Math.round((ended - started) / 1000)),
      transcript,
      close_silence: s.close_silence || null,
      grade_status: transcript.some((t) => t.who === 'rep') ? 'pending' : 'failed',
      grade_error: transcript.some((t) => t.who === 'rep') ? null : 'Nothing the rep said was picked up, so there is nothing to grade.',
    }
    const { data, error } = await sb.from('sales_practice_sessions').insert(row).select('id').single()
    if (error) return json(500, { ok: false, error: error.message })
    if (row.grade_status === 'pending') {
      const base = (process.env.URL || 'https://trainingmanagementsys.netlify.app').replace(/\/$/, '')
      // Background function: returns 202 at once and grades for up to 15 min.
      await fetch(`${base}/.netlify/functions/practice-grade-background`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: data.id, secret: process.env.CRON_SECRET }),
      }).catch(() => {})
    }
    return json(200, { ok: true, id: data.id })
  }

  if (body.action === 'regrade') {
    if (!body.id) return json(400, { ok: false, error: 'id required' })
    await sb.from('sales_practice_sessions').update({ grade_status: 'pending', grade_error: null }).eq('id', body.id)
    const base = (process.env.URL || 'https://trainingmanagementsys.netlify.app').replace(/\/$/, '')
    await fetch(`${base}/.netlify/functions/practice-grade-background`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: body.id, secret: process.env.CRON_SECRET }),
    }).catch(() => {})
    return json(200, { ok: true })
  }

  if (body.action === 'get') {
    const { data, error } = await sb.from('sales_practice_sessions').select('*').eq('id', body.id).maybeSingle()
    if (error) return json(500, { ok: false, error: error.message })
    if (!data) return json(404, { ok: false, error: 'Not found' })
    return json(200, { ok: true, session: data })
  }

  if (body.action === 'list') {
    let q = sb.from('sales_practice_sessions').select(LIST_COLS).order('started_at', { ascending: false }).limit(60)
    if (body.trainee_id) q = q.eq('trainee_id', body.trainee_id)
    const { data, error } = await q
    if (error) return json(500, { ok: false, error: error.message })
    return json(200, { ok: true, sessions: data || [] })
  }

  return json(400, { ok: false, error: 'unknown action' })
}
