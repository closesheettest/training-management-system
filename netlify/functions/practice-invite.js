// Sales Training Customer, PRACTICE LINK side (/practice/<token>). No PIN: the
// link's own token is the permission, and it only opens the ONE session it was
// made for. Valid while the row is still 'invited' and under 48 hours old; once
// the practice is saved it can only show its own report card.
//
// POST { token, action:'load' }   → { ok, name, persona_key, section, status }
// POST { token, action:'live' }   → { ok, token, model }   one-use Gemini token
// POST { token, action:'save', session } → { ok }            then grading starts
// POST { token, action:'get' }    → { ok, session }         their report card
import { createClient } from '@supabase/supabase-js'
import { json } from './_practice-auth.js'
import { mintToken, liveModel } from './_practice-gemini.js'
import { liveCost } from './_practice-prices.js'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' })
  let body
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { ok: false, error: 'bad JSON' }) }
  const token = String(body.token || '').trim()
  if (token.length < 20) return json(404, { ok: false, error: 'This practice link is not valid.' })
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const { data: row } = await sb.from('sales_practice_sessions').select('*').filter('report->invite->>token', 'eq', token).maybeSingle()
  if (!row) return json(404, { ok: false, error: 'This practice link is not valid.' })
  const inv = row.report?.invite || {}
  const open = row.grade_status === 'invited' && Date.parse(inv.expires_at) > Date.now()
  const status = row.grade_status === 'invited' ? (open ? 'ready' : 'expired') : 'done'

  if (body.action === 'load') {
    return json(200, { ok: true, name: row.trainee_name, persona_key: row.persona_key, section: row.section, status, sent_by: inv.sent_by || null })
  }
  if (body.action === 'get') {
    if (status !== 'done') return json(400, { ok: false, error: 'This practice has not been done yet.' })
    return json(200, { ok: true, session: row })
  }
  if (!open) return json(410, { ok: false, error: status === 'expired' ? 'This practice link has expired. Ask your trainer for a new one.' : 'This practice has already been done.' })

  if (body.action === 'live') {
    if (!process.env.GEMINI_API_KEY) return json(500, { ok: false, error: 'Practice is not set up yet.' })
    try { return json(200, { ok: true, token: await mintToken(process.env.GEMINI_API_KEY), model: liveModel() }) }
    catch (e) { return json(502, { ok: false, error: e.message }) }
  }

  if (body.action === 'save') {
    const s = body.session || {}
    const transcript = Array.isArray(s.transcript) ? s.transcript.slice(0, 4000) : []
    const started = s.started_at ? new Date(s.started_at) : new Date()
    const ended = s.ended_at ? new Date(s.ended_at) : new Date()
    const spoke = transcript.some((t) => t.who === 'rep')
    const { error } = await sb.from('sales_practice_sessions').update({
      started_at: started.toISOString(), ended_at: ended.toISOString(),
      duration_sec: Math.max(0, Math.round((ended - started) / 1000)),
      transcript, close_silence: s.close_silence || null,
      grade_status: spoke ? 'pending' : 'failed',
      grade_error: spoke ? null : 'Nothing the presenter said was picked up, so there is nothing to grade.',
      report: { invite: { ...inv, used_at: new Date().toISOString() }, ...(s.usage ? { usage: { live: s.usage }, cost: Math.round(liveCost(s.usage) * 10000) / 10000 } : {}) },
    }).eq('id', row.id)
    if (error) return json(500, { ok: false, error: error.message })
    if (spoke) {
      const base = (process.env.URL || 'https://trainingmanagementsys.netlify.app').replace(/\/$/, '')
      await fetch(`${base}/.netlify/functions/practice-grade-background`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, secret: process.env.CRON_SECRET }),
      }).catch(() => {})
    }
    return json(200, { ok: true })
  }
  return json(400, { ok: false, error: 'unknown action' })
}
