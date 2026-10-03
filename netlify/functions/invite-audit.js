// invite-audit.js — who got a class notice, who OPENED their link, who confirmed.
//
// Neal, 2026-10-03 (Week A going virtual): "I want it audited to know who opened it, who
// confirmed, that type of thing." Each send is logged under a tag (e.g. weekA-virtual-2026-10-05)
// in app_settings invite_audit_<tag>:
//   { title, class_id, sent_at, sends:{ trainee_id:{ name, phone, email, sms, email_ok, at } },
//     opens:{ trainee_id:[iso…] } }
//
//   POST { action:'open', token, tag }        → marks that trainee's link as opened (from the
//                                                confirm page; public, writes a timestamp only)
//   POST { action:'report', pin, tag }        → admin PIN → { ok, title, rows:[{ name, phone,
//          sent_at, sms, email, opened_first, opened_last, opens, confirmation, confirmed_at }] }
//
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY.
import { createClient } from '@supabase/supabase-js'

const PIN_URL = 'https://free-roof-inspections.netlify.app/.netlify/functions/regional-admin-pin'
const json = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) })
const safeTag = (t) => String(t || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60)

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false })
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  let b = {}
  try { b = JSON.parse(event.body || '{}') } catch { return json(400, { ok: false }) }
  const tag = safeTag(b.tag)
  if (!tag) return json(400, { ok: false, error: 'tag required' })
  const key = `invite_audit_${tag}`
  const load = async () => {
    const { data } = await sb.from('app_settings').select('value').eq('key', key).maybeSingle()
    try { return data ? (typeof data.value === 'string' ? JSON.parse(data.value) : data.value) : null } catch { return null }
  }

  if (b.action === 'open') {
    const token = String(b.token || '').trim()
    if (!token) return json(400, { ok: false })
    const audit = await load()
    if (!audit) return json(200, { ok: true }) // not a tracked send
    const { data: t } = await sb.from('trainees').select('id').eq('registration_token', token).maybeSingle()
    if (!t || !audit.sends?.[t.id]) return json(200, { ok: true })
    audit.opens = audit.opens || {}
    ;(audit.opens[t.id] = audit.opens[t.id] || []).push(new Date().toISOString())
    audit.opens[t.id] = audit.opens[t.id].slice(-50)
    await sb.from('app_settings').upsert({ key, value: JSON.stringify(audit), updated_at: new Date().toISOString() }, { onConflict: 'key' })
    return json(200, { ok: true })
  }

  if (b.action === 'report') {
    const v = await fetch(PIN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'verify', pin: String(b.pin || '') }) }).then((r) => r.json()).catch(() => ({}))
    if (!v.valid) return json(401, { ok: false, error: 'Sign in again (PIN not recognised).' })
    const audit = await load()
    if (!audit) return json(404, { ok: false, error: 'No send recorded under that name.' })
    const ids = Object.keys(audit.sends || {})
    const { data: tr } = ids.length ? await sb.from('trainees').select('id, confirmation_status, confirmation_at, declined_at').in('id', ids) : { data: [] }
    const byId = new Map((tr || []).map((t) => [t.id, t]))
    const rows = ids.map((id) => {
      const s = audit.sends[id], o = (audit.opens || {})[id] || [], t = byId.get(id) || {}
      // A confirmation only counts if it came AFTER this notice went out.
      const fresh = t.confirmation_at && Date.parse(t.confirmation_at) >= Date.parse(s.at || audit.sent_at || 0)
      return { name: s.name, phone: s.phone, email: s.email, sent_at: s.at, sms: !!s.sms, email_ok: !!s.email_ok,
        opened_first: o[0] || null, opened_last: o[o.length - 1] || null, opens: o.length,
        confirmation: fresh ? t.confirmation_status : null, confirmed_at: fresh ? t.confirmation_at : null }
    }).sort((a, b) => a.name.localeCompare(b.name))
    return json(200, { ok: true, title: audit.title, sent_at: audit.sent_at, rows })
  }
  return json(400, { ok: false, error: 'unknown action' })
}
