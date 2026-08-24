// notify-week-b-hold.js
//
// Tells a trainee who has been HELD from Week B why, and what gets them back in.
//
// Being held is not the same as being dropped, and the message has to say so:
// there IS a way back, it is a full week of real effort in the field, and their
// manager will help them get there. Sending nothing leaves someone who finished
// Week A watching the Monday text arrive for everyone else and drawing their own
// conclusion (Neal, 2026-08-24).
//
//   GET ?dry=1                 preview exactly what would be sent, send nothing
//   POST { secret }            send to every held trainee not yet told
//   POST { secret, id }        just that one
//
// BOTH CHANNELS, always. An SMS alone misses anyone on DND or opted out of the
// GHL number, and this is not a message to leave to chance.
//
// Idempotent on week_b_hold_notified_at, so a second call is a no-op rather than
// a second text.
//
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN, GHL_LOCATION_ID,
//      CRON_SECRET.

import { createClient } from '@supabase/supabase-js'
import { sendSmsViaGhl } from './_ghl.js'
import { sendEmail } from './_email.js'

const COLS = 'id, first_name, last_name, phone, email, region, week_b_hold, week_b_hold_reason, week_b_hold_notified_at'

// Zone → the manager they should go to. Their field_manager_id is not set, and a
// message telling someone to "get with your manager" without naming them is a
// message that gets ignored.
const ZONE_MANAGER = {
  'Zone 1': 'your regional manager',
  'Zone 2': 'Richard',
  'Zone 3': 'Chad',
  'Zone 4': 'Sam',
}

function smsFor(t) {
  const mgr = ZONE_MANAGER[t.region] || 'your manager'
  return [
    `Hi ${t.first_name}, it's U.S. Shingle.`,
    ``,
    `Your second week of training is on hold for now. The map didn't show the minimum effort in the field this past week, and second week is for people who are working it.`,
    ``,
    `This isn't a no. Put in a full week of real effort out there and you're back in for week two.`,
    ``,
    `Get with ${mgr} — he'll help you put that week together.`,
  ].join('\n')
}

function emailFor(t) {
  const mgr = ZONE_MANAGER[t.region] || 'your manager'
  return {
    subject: 'Your second week of training',
    body: [
      `Hi ${t.first_name},`,
      ``,
      `Your second week of training is on hold for now.`,
      ``,
      `The map didn't show the minimum effort in the field this past week. Second week is for people who are working it, so we're holding your spot rather than moving you into it.`,
      ``,
      `This isn't a no, and it isn't the end of the road. Put in a full week of real effort in the field and you're back in for week two.`,
      ``,
      `Get with ${mgr} — that's exactly what he's there for, and he'll help you put that week together.`,
      ``,
      `U.S. Shingle & Metal`,
    ].join('\n'),
  }
}

// The manager hears at the SAME TIME as the trainee, not after.
//
// The message tells them to go to him, so he has to already know when the phone
// rings — and it is ultimately his call whether to keep them. Neal will normally
// have spoken to him first; this is the written record of exactly what the two
// men were told, so the manager and the trainee are working off the same words
// (Neal, 2026-08-24).
function managerNoteFor(names, region) {
  return [
    `Heads up — ${names.join(' and ')} ${names.length > 1 ? 'have' : 'has'} just been told their second week of training is on hold.`,
    ``,
    `What they were told: the map didn't show the minimum effort in the field this past week, it isn't a no, and a full week of real effort puts them back in for week two. They were told to get with you.`,
    ``,
    `Whether they stay is your call. If you want them back in for week two, say the word.`,
  ].join('\n')
}

async function managerFor(supabase, region) {
  if (!region) return null
  const { data } = await supabase
    .from('trainees')
    .select('id, first_name, last_name, phone, company_number, email, company_email')
    .eq('managed_region', region)
    .limit(1)
  const m = (data || [])[0]
  if (!m) return null
  return { ...m, sms_to: m.company_number || m.phone, email_to: m.company_email || m.email }
}

export const handler = async (event) => {
  const qp = event.queryStringParameters || {}
  const dry = qp.dry === '1' || qp.dry === 'true'

  let body = {}
  try { body = JSON.parse(event.body || '{}') } catch { /* GET */ }

  // A real send needs the secret. A dry run does not — reading the copy back is
  // harmless and it should be easy to check before anyone is texted.
  if (!dry && body.secret !== process.env.CRON_SECRET) {
    return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'secret required to actually send' }) }
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  let q = supabase.from('trainees').select(COLS).eq('week_b_hold', true).is('week_b_hold_notified_at', null)
  if (body.id) q = supabase.from('trainees').select(COLS).eq('id', body.id)
  const { data: held, error } = await q
  if (error) return { statusCode: 500, body: JSON.stringify({ ok: false, error: error.message }) }

  const out = []
  for (const t of held || []) {
    const sms = smsFor(t)
    const mail = emailFor(t)
    const row = { name: `${t.first_name} ${t.last_name}`, region: t.region, phone: t.phone, email: t.email, sms, subject: mail.subject, email_body: mail.body }
    if (dry) { out.push({ ...row, would_send: true }); continue }

    const sent = []
    if (t.phone) {
      try { await sendSmsViaGhl(t.phone, sms, { firstName: t.first_name, lastName: t.last_name }); sent.push('sms') }
      catch (e) { sent.push(`sms failed: ${e.message}`) }
    }
    if (t.email) {
      try { await sendEmail(t.email, mail.subject, mail.body); sent.push('email') }
      catch (e) { sent.push(`email failed: ${e.message}`) }
    }
    // Stamp only when at least one channel actually landed, so a total failure
    // is retried rather than silently marked done.
    if (sent.some((s) => s === 'sms' || s === 'email')) {
      await supabase.from('trainees').update({ week_b_hold_notified_at: new Date().toISOString() }).eq('id', t.id)
    }
    out.push({ ...row, sent })
  }

  // Managers, one message each covering everyone held in their zone.
  const managers = []
  const byRegion = {}
  for (const r of out) (byRegion[r.region] = byRegion[r.region] || []).push(r.name)
  for (const [region, names] of Object.entries(byRegion)) {
    const m = await managerFor(supabase, region)
    if (!m) { managers.push({ region, error: 'no manager set for this zone' }); continue }
    const note = managerNoteFor(names, region)
    const row = { region, manager: `${m.first_name} ${m.last_name}`, sms_to: m.sms_to, email_to: m.email_to, about: names, message: note }
    if (dry) { managers.push({ ...row, would_send: true }); continue }
    const sent = []
    if (m.sms_to) {
      try { await sendSmsViaGhl(m.sms_to, note, { firstName: m.first_name, lastName: m.last_name }); sent.push('sms') }
      catch (e) { sent.push(`sms failed: ${e.message}`) }
    }
    if (m.email_to) {
      try { await sendEmail(m.email_to, `Second week on hold — ${names.join(', ')}`, note); sent.push('email') }
      catch (e) { sent.push(`email failed: ${e.message}`) }
    }
    managers.push({ ...row, sent })
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, dry, count: out.length, results: out, managers }, null, 2),
  }
}
