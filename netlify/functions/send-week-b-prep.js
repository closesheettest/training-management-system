// send-week-b-prep.js
//
// The moment someone CONFIRMS virtual Week B, send them what to study before the
// first morning (Neal, 2026-09-27: "once Week B is confirmed ... send them the
// full presentation along with the presentation page that breaks down each
// slide. So they're all prepared for the first morning."):
//   • the full presentation deck (PDF)
//   • the slide-by-slide page: each slide's talking points + the script
// Text + email (every trainee/rep message goes both ways). Called by the
// /confirm page right after "Yes, I'll be there".
//
//   POST { token, rep? }   token = the trainee's registration_token
//   → { ok, sent: true } | { ok, already: true }
//
// Sent once per invite: skipped if it already went out after the latest Week B
// invite (week_b_confirm_sent_at). Log: app_settings.week_b_prep_sent
// ({ trainee_id: iso }), so no new column is needed.
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_*, email env.
import { createClient } from '@supabase/supabase-js'
import { sendSmsViaGhl } from './_ghl.js'
import { sendEmail } from './_email.js'

const SITE = 'https://trainingmanagementsys.netlify.app'
const DECK = `${SITE}/sales-pitch/why-us-shingle-slides.pdf`
const SLIDES = `${SITE}/homework/slides`
const json = (code, body) => ({ statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false })
  let b = {}
  try { b = JSON.parse(event.body || '{}') } catch { return json(400, { ok: false, error: 'bad JSON' }) }
  const token = String(b.token || '').trim()
  if (!token) return json(400, { ok: false, error: 'token required' })
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  const { data: t } = await sb.from('trainees')
    .select('id, first_name, last_name, phone, email, confirmation_status, week_b_confirm_sent_at')
    .eq('registration_token', token).maybeSingle()
  if (!t) return json(404, { ok: false, error: 'not found' })
  if (t.confirmation_status !== 'confirmed') return json(200, { ok: false, error: 'not confirmed' })

  const { data: row } = await sb.from('app_settings').select('value').eq('key', 'week_b_prep_sent').maybeSingle()
  let log = {}
  try { log = JSON.parse(row?.value || '{}') } catch { log = {} }
  const last = log[t.id]
  if (last && (!t.week_b_confirm_sent_at || last > t.week_b_confirm_sent_at)) return json(200, { ok: true, already: true })

  const first = b.rep ? 'Tuesday at 10:00 AM' : 'Monday at 11:00 AM'
  const msg =
    `U.S. Shingle & Metal: thanks for confirming Week B, ${t.first_name || 'there'}! Please review both of these before ${first} so you're ready for the first session:\n\n` +
    `1) The full presentation: ${DECK}\n` +
    `2) Slide by slide, with the talking points and the script: ${SLIDES}\n\n` +
    `The Zoom link is on your confirmation page. Join from a stationary location (not driving), camera on.`
  const channels = []
  if (t.email) {
    try { const r = await sendEmail(t.email, 'Week B: review the presentation before the first session', msg); if (r && r.ok !== false) channels.push('email') } catch { /* try SMS */ }
  }
  if (t.phone) {
    try { const r = await sendSmsViaGhl(t.phone, msg, { firstName: t.first_name, lastName: t.last_name }); if (r && r.ok !== false) channels.push('sms') } catch { /* reported below */ }
  }
  if (!channels.length) return json(502, { ok: false, error: 'could not send' })
  log[t.id] = new Date().toISOString()
  await sb.from('app_settings').upsert({ key: 'week_b_prep_sent', value: JSON.stringify(log) }, { onConflict: 'key' })
  return json(200, { ok: true, sent: true, channels })
}
