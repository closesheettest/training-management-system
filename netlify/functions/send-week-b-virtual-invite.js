// send-week-b-virtual-invite.js
//
// The VIRTUAL Week B invite (Neal, 2026-09-27). Week B is on Zoom this time, and
// the people invited back are hand-picked: the office flags them week_b_force on
// the class (some finished Week A in an earlier class). Each gets a text + email
// with a link they MUST tap to confirm ("one of the criteria is they have to
// respond back to confirm"). The link opens /confirm/<token>?week=B&virtual=1,
// which shows the Zoom link (app_settings week_b_zoom_url) and the class's hours.
// Their answer lands on confirmation_status, the same badge the class page shows.
//
//   POST { secret, class_id, dry_run?, only_unconfirmed? }   secret = CRON_SECRET
//   → { sent, recipients:[{name, channels}], skipped:[{name, reason}], message }
//
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY, CRON_SECRET, GHL_*, email env,
//      optional PUBLIC_SITE_URL.
import { createClient } from '@supabase/supabase-js'
import { sendSmsViaGhl } from './_ghl.js'
import { sendEmail } from './_email.js'

const json = (code, body) => ({ statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

// "Monday, Sep 28 · 11:00 AM – 1:00 PM" lines → one short line for a text.
function hoursLine(details) {
  const lines = String(details || '').split('\n').map((l) => l.replace(/^\*\s*/, '').trim()).filter(Boolean)
  const out = []
  for (let i = 0; i < lines.length; i++) {
    if (/am|pm/i.test(lines[i])) continue
    const time = (lines[i + 1] || '').match(/^([\d:]+\s*[AP]M\s*[–-]\s*[\d:]+\s*[AP]M)/i)
    if (time && !/^week b/i.test(lines[i])) out.push(`${lines[i]} ${time[1]}`)
  }
  return out.join('; ')
}

export const handler = async (event) => {
  let body = {}
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { ok: false, error: 'bad JSON' }) }
  if (!process.env.CRON_SECRET || body.secret !== process.env.CRON_SECRET) return json(401, { ok: false, error: 'Unauthorized' })
  const classId = String(body.class_id || '').trim()
  if (!classId) return json(400, { ok: false, error: 'class_id required' })
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const siteUrl = (process.env.PUBLIC_SITE_URL || process.env.URL || 'https://trainingmanagementsys.netlify.app').replace(/\/$/, '')

  const { data: cls } = await supabase.from('classes')
    .select('id, schedule_details, trainees!class_id(id, first_name, last_name, phone, email, registration_token, enrolled, dropped_out_at, declined_at, week_b_force, confirmation_status)')
    .eq('id', classId).maybeSingle()
  if (!cls) return json(404, { ok: false, error: 'Class not found' })
  const { data: z } = await supabase.from('app_settings').select('value').eq('key', 'week_b_zoom_url').maybeSingle()
  if (!String(z?.value || '').trim() && !body.dry_run) return json(400, { ok: false, error: 'Set the Zoom link first (app_settings week_b_zoom_url).' })

  const hours = hoursLine(cls.schedule_details)
  const nameOf = (t) => `${t.first_name || ''} ${t.last_name || ''}`.trim()
  const recipients = [], skipped = [], errors = []
  let sample = ''
  for (const t of cls.trainees || []) {
    if (!t.week_b_force) continue // only the people the office picked for Week B
    if (t.enrolled === false || t.dropped_out_at || t.declined_at) { skipped.push({ name: nameOf(t), reason: 'not active' }); continue }
    if (body.only_unconfirmed && t.confirmation_status === 'confirmed') { skipped.push({ name: nameOf(t), reason: 'already confirmed' }); continue }
    if (!t.registration_token || (!t.phone && !t.email)) { skipped.push({ name: nameOf(t), reason: 'no link or no contact' }); continue }
    const link = `${siteUrl}/confirm/${t.registration_token}?week=B&virtual=1`
    const msg = `U.S. Shingle & Metal: ${t.first_name}, you are invited back for Week B training, held virtually on Zoom. ${hours}. ` +
      `Please tap to confirm your attendance. Confirming is required to hold your seat: ${link}  The Zoom link is on that page.`
    if (!sample) sample = msg.replace(t.registration_token, '<their link>')
    if (body.dry_run) { recipients.push({ name: nameOf(t), channels: [t.phone && 'sms', t.email && 'email'].filter(Boolean) }); continue }
    const channels = []
    if (t.email) {
      try { const r = await sendEmail(t.email, 'Week B training (virtual): please confirm your attendance', msg); if (r && r.ok !== false) channels.push('email') }
      catch (e) { errors.push(`email ${nameOf(t)}: ${e.message}`) }
    }
    if (t.phone) {
      try { const r = await sendSmsViaGhl(t.phone, msg, { firstName: t.first_name, lastName: t.last_name }); if (r && r.ok !== false) channels.push('sms') }
      catch (e) { errors.push(`sms ${nameOf(t)}: ${e.message}`) }
    }
    if (channels.length) {
      // A fresh ask: clear any old answer so the badge shows THIS invite's reply.
      await supabase.from('trainees').update({ confirmation_status: null, confirmation_at: null, week_b_confirm_sent_at: new Date().toISOString() }).eq('id', t.id)
    }
    recipients.push({ name: nameOf(t), channels })
  }
  return json(200, { ok: true, dry_run: !!body.dry_run, sent: recipients.length, recipients, skipped, message: sample, ...(errors.length ? { errors } : {}) })
}
