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
import { liveCost } from './_practice-prices.js'
import { randomBytes } from 'crypto'
import { sendSmsViaGhl } from './_ghl.js'
import { sendEmail } from './_email.js'
import { personaByKey, sectionByKey } from '../../src/lib/salesPractice.js'

const SITE = 'https://trainingmanagementsys.netlify.app'
const INVITE_HOURS = 48

const LIST_COLS = 'id, trainee_id, trainee_name, class_id, trainer_name, persona_key, section, started_at, duration_sec, grade_status, score, cost:report->cost'

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
      // Cost rides on the report; the grader keeps it and adds its own share.
      report: s.usage ? { usage: { live: s.usage }, cost: Math.round(liveCost(s.usage) * 10000) / 10000 } : null,
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

  // PRACTICE LINK (Neal, 25 Sep): the trainer sets up a session and texts +
  // emails someone a private link to do it on their own device (the owner, a rep
  // on Zoom). The session row is created now as 'invited'; the link's token lives
  // on report.invite. It works for INVITE_HOURS and until the practice is saved.
  if (body.action === 'invite') {
    const v = body.invite || {}
    const sec = sectionByKey(v.section)
    if (!v.section || (!sec.range && v.section !== 'survey')) return json(400, { ok: false, error: 'Pick what they are practicing.' })
    let name = String(v.name || '').trim(), phone = String(v.phone || '').trim(), email = String(v.email || '').trim()
    if (v.trainee_id) {
      const { data: t } = await sb.from('trainees').select('first_name, last_name, phone, email, company_email').eq('id', v.trainee_id).maybeSingle()
      if (t) {
        name = name || `${t.first_name} ${t.last_name}`.trim()
        phone = phone || t.phone || ''
        email = email || t.company_email || t.email || ''
      }
    }
    if (!name) return json(400, { ok: false, error: 'Who is it for? Enter their name.' })
    if (!phone && !email) return json(400, { ok: false, error: 'Enter a cell number or an email to send the link to.' })
    const token = randomBytes(18).toString('base64url')
    const expires = new Date(Date.now() + INVITE_HOURS * 3600 * 1000).toISOString()
    const { data: row, error } = await sb.from('sales_practice_sessions').insert({
      trainee_id: v.trainee_id || null, trainee_name: name, class_id: v.class_id || null,
      trainer_name: who.name || null, persona_key: String(v.persona_key || ''), section: v.section,
      grade_status: 'invited', transcript: [],
      report: { invite: { token, expires_at: expires, phone: phone || null, email: email || null, sent_by: who.name || null } },
    }).select('id').single()
    if (error) return json(500, { ok: false, error: error.message })
    const link = `${SITE}/practice/${token}`
    const first = name.split(/\s+/)[0]
    const persona = personaByKey(v.persona_key)
    const sms = `${first}, ${who.name || 'your trainer'} set you up a sales practice: present ${sec.label.toLowerCase()} to an AI homeowner (${persona.tagline.toLowerCase()}). Use a laptop or tablet in Chrome, ideally with headphones. Your link (good for 48 hours): ${link}`
    const html = `${first},\n\n${who.name || 'Your trainer'} set you up a sales practice with Sales Training Customer.\n\nYou'll present ${sec.label} out loud to an AI homeowner (${persona.name}, ${persona.tagline.toLowerCase()}), who talks back. When you finish you get a report card.\n\nUse a laptop or tablet in Chrome, ideally with headphones, somewhere quiet. Your private link, good for 48 hours:\n\n${link}\n\nU.S. Shingle & Metal`
    const [smsR, emailR] = await Promise.all([
      phone ? sendSmsViaGhl(phone, sms, { firstName: first, lastName: name.split(/\s+/).slice(1).join(' ') || 'Practice' }) : Promise.resolve({ ok: false, error: 'no phone' }),
      email ? sendEmail(email, 'Your sales practice link — U.S. Shingle & Metal', html) : Promise.resolve({ ok: false, error: 'no email' }),
    ])
    return json(200, { ok: true, id: row.id, link, sms: !!smsR?.ok, email: !!emailR?.ok, sms_error: smsR?.ok ? undefined : smsR?.error, email_error: emailR?.ok ? undefined : emailR?.error })
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
