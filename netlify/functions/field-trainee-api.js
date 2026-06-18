// Field Trainee API — manages the per-person provisioning chain for someone
// being trained in the field by a regional manager (not in a class).
//
// Chain: add → send_homework (trainee + manager, then fire IT email provisioning)
//        → email_done (fires VA app setup) → apps_done (send trainee instructions)
//        → send_test (final test, multiple-choice only).
//
// POST { action, ... }. Reuses the same IT/VA provisioning notifications as the
// class flow (recipientsForEvent / notifyAll).
import { createClient } from '@supabase/supabase-js'
import { sendSmsViaGhl } from './_ghl.js'
import { sendEmail } from './_email.js'
import { recipientsForEvent } from './_recipients.js'
import { notifyAll } from './_notify.js'

const json = (s, o) => ({ statusCode: s, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(o) })

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, {})
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' })
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY']) if (!process.env[k]) return json(500, { ok: false, error: `Missing env: ${k}` })

  let body
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { ok: false, error: 'Bad JSON' }) }
  const action = String(body.action || '')
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
  const siteUrl = (process.env.PUBLIC_SITE_URL || process.env.URL || 'https://trainingmanagementsys.netlify.app').replace(/\/$/, '')
  const FT_COLS = 'id, first_name, last_name, phone, email, region, registration_token, field_manager_id, field_homework_sent_at, field_email_provisioned_at, field_apps_done_at, field_instructions_sent_at'

  try {
    if (action === 'list') {
      const { data: fts } = await supabase.from('trainees').select(FT_COLS).eq('is_field_trainee', true).order('created_at', { ascending: false })
      const { data: mgrs } = await supabase.from('trainees').select('id, first_name, last_name').not('managed_region', 'is', null)
      const mgrName = Object.fromEntries((mgrs || []).map((m) => [m.id, `${m.first_name || ''} ${m.last_name || ''}`.trim()]))
      const list = (fts || []).map((t) => ({ ...t, manager_name: t.field_manager_id ? (mgrName[t.field_manager_id] || null) : null }))
      return json(200, { ok: true, trainees: list })
    }

    if (action === 'managers') {
      const { data } = await supabase.from('trainees').select('id, first_name, last_name, managed_region').not('managed_region', 'is', null).order('managed_region')
      return json(200, { ok: true, managers: (data || []).map((m) => ({ id: m.id, name: `${m.first_name || ''} ${m.last_name || ''}`.trim(), region: m.managed_region })) })
    }

    if (action === 'add') {
      const first = String(body.first_name || '').trim()
      if (!first) return json(400, { ok: false, error: 'First name required' })
      if (!body.phone && !body.email) return json(400, { ok: false, error: 'Need a phone or email' })
      const { data, error } = await supabase.from('trainees').insert({
        first_name: first,
        last_name: String(body.last_name || '').trim() || null,
        phone: body.phone || null,
        email: body.email || null,
        region: body.region || null,
        is_field_trainee: true,
        field_manager_id: body.manager_id || null,
        registration_token: cryptoRandom(),
      }).select(FT_COLS).single()
      if (error) throw error
      return json(200, { ok: true, trainee: data })
    }

    if (action === 'search') {
      // Browse EXISTING trainees (not already field trainees) to flag — with
      // their class context (region · week · cancelled) so you can recognize
      // someone whose name you don't remember. Optional name filter.
      const q = String(body.q || '').trim()
      let query = supabase
        .from('trainees')
        .select('id, first_name, last_name, phone, email, region, created_at, classes!class_id(region, week_start_date, cancelled_at)')
        .neq('is_field_trainee', true)
        .order('created_at', { ascending: false })
        .limit(120)
      if (q.length >= 2) query = query.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`)
      const { data } = await query
      const rows = (data || []).map((t) => ({
        id: t.id,
        name: `${t.first_name || ''} ${t.last_name || ''}`.trim() || '(no name)',
        phone: t.phone, email: t.email,
        region: t.region || t.classes?.region || null,
        week: t.classes?.week_start_date || null,
        cancelled: !!t.classes?.cancelled_at,
      }))
      const regions = [...new Set(rows.map((r) => r.region).filter(Boolean))].sort()
      return json(200, { ok: true, results: rows, regions })
    }

    if (action === 'mark_existing') {
      const tid = String(body.trainee_id || '').trim()
      if (!tid) return json(400, { ok: false, error: 'trainee_id required' })
      const patch = { is_field_trainee: true }
      if (body.manager_id) patch.field_manager_id = body.manager_id
      const { error } = await supabase.from('trainees').update(patch).eq('id', tid)
      if (error) throw error
      return json(200, { ok: true })
    }

    // The remaining actions operate on one field trainee.
    const id = String(body.id || '').trim()
    if (!id) return json(400, { ok: false, error: 'id required' })
    const { data: t } = await supabase.from('trainees').select(FT_COLS).eq('id', id).maybeSingle()
    if (!t) return json(404, { ok: false, error: 'Field trainee not found' })
    const name = `${t.first_name || ''} ${t.last_name || ''}`.trim() || 'the trainee'
    let mgr = null
    if (t.field_manager_id) {
      const { data: m } = await supabase.from('trainees').select('first_name, last_name, phone, email').eq('id', t.field_manager_id).maybeSingle()
      mgr = m || null
    }
    const nowIso = new Date().toISOString()

    if (action === 'send_homework') {
      const link = `${siteUrl}/full-week-homework/`
      // 1) Trainee
      const tMsg = `Hi ${t.first_name || 'there'}, welcome to U.S. Shingle & Metal training. Here's your full week of training in one place — work through it as you train in the field: ${link}`
      const ch = []
      if (t.email) { try { const r = await sendEmail(t.email, 'Your full week of training — U.S. Shingle & Metal', tMsg); if (r && r.ok !== false) ch.push('trainee email') } catch { /* */ } }
      if (t.phone) { const r = await sendSmsViaGhl(t.phone, tMsg, { firstName: t.first_name || 'Trainee', lastName: 'Field Training' }); if (r.ok) ch.push('trainee text') }
      // 2) Regional manager
      if (mgr && (mgr.phone || mgr.email)) {
        const mName = mgr.first_name || 'there'
        const mMsg = `Hi ${mName}, ${name} is now set up as your field trainee. Here's the full week of homework they'll be working through: ${link}`
        if (mgr.email) { try { await sendEmail(mgr.email, `Field trainee: ${name}`, mMsg); ch.push('manager email') } catch { /* */ } }
        if (mgr.phone) { const r = await sendSmsViaGhl(mgr.phone, mMsg, { firstName: mName, lastName: 'Manager' }); if (r.ok) ch.push('manager text') }
      }
      // 3) Fire IT email-provisioning (same team as classes)
      const { recipients } = await recipientsForEvent(supabase, 'day_2_provision_due', { legacyRole: 'it' })
      const provMsg = `Provision a @shingleusa.com email for FIELD TRAINEE ${name} (${t.phone || t.email || 'no contact'}). They're being trained in the field — set up the email, then mark it done in the Field Trainee page.`
      await notifyAll(recipients, { smsBody: provMsg, emailSubject: `Provision email — field trainee ${name}`, emailBody: provMsg, contactLabel: 'IT Provisioning' })
      await supabase.from('trainees').update({ field_homework_sent_at: nowIso }).eq('id', id)
      return json(200, { ok: true, channels: ch, it_notified: (recipients || []).length })
    }

    if (action === 'email_done') {
      await supabase.from('trainees').update({ field_email_provisioned_at: nowIso }).eq('id', id)
      const { recipients } = await recipientsForEvent(supabase, 'va_setup_due', { legacyRole: 'va' })
      const msg = `Email is provisioned for FIELD TRAINEE ${name}. Please set up their apps (RepCard / JobNimbus / Sales Academy), then mark apps done in the Field Trainee page.`
      await notifyAll(recipients, { smsBody: msg, emailSubject: `App setup — field trainee ${name}`, emailBody: msg, contactLabel: 'App Setup' })
      return json(200, { ok: true, va_notified: (recipients || []).length })
    }

    if (action === 'apps_done') {
      const appsLink = `${siteUrl}/apps/`
      const msg = `Hi ${t.first_name || 'there'}, you're all set up! Your @shingleusa.com email is ready. Install and sign into your apps here: ${appsLink}\n\nOnce your apps are working, you're ready to roll. Welcome to the team.`
      const ch = []
      if (t.email) { try { const r = await sendEmail(t.email, "You're set up — install your apps", msg); if (r && r.ok !== false) ch.push('email') } catch { /* */ } }
      if (t.phone) { const r = await sendSmsViaGhl(t.phone, msg, { firstName: t.first_name || 'Trainee', lastName: 'Setup' }); if (r.ok) ch.push('text') }
      await supabase.from('trainees').update({ field_apps_done_at: nowIso, field_instructions_sent_at: nowIso }).eq('id', id)
      return json(200, { ok: true, channels: ch })
    }

    if (action === 'send_test') {
      if (!t.registration_token) return json(400, { ok: false, error: 'No test token on file' })
      await supabase.from('trainees').update({ registered: true }).eq('id', id)
      const link = `${siteUrl}/test/${t.registration_token}?mc=1`
      const msg = `Hi ${t.first_name || 'there'}, you're cleared for your U.S. Shingle & Metal final test. Take your time and answer every question: ${link}`
      const ch = []
      if (t.email) { try { const r = await sendEmail(t.email, 'Your final test — U.S. Shingle & Metal', msg); if (r && r.ok !== false) ch.push('email') } catch { /* */ } }
      if (t.phone) { const r = await sendSmsViaGhl(t.phone, msg, { firstName: t.first_name || 'Trainee', lastName: 'Final Test' }); if (r.ok) ch.push('text') }
      if (!ch.length) return json(500, { ok: false, error: 'Send failed — no phone/email worked' })
      return json(200, { ok: true, channels: ch })
    }

    return json(400, { ok: false, error: `Unknown action: ${action}` })
  } catch (e) {
    return json(500, { ok: false, error: e.message || 'Server error' })
  }
}

function cryptoRandom() {
  try { return globalThis.crypto.randomUUID() } catch { return 'ft-' + Math.random().toString(36).slice(2) + Date.now().toString(36) }
}
