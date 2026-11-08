// _harvester-welcome.js — what a HARVESTER gets the moment they sign their paperwork (Neal, 2026-11-08, for Mark
// Scoppettuolo: "once he does that, and it shows that it's signed and in, then I need the system to be able to send him
// the harvesting script along with DoorDispatcher").
//
// A harvester (trainees.departments contains "Harvester") knocks doors and books appointments for the reps, like
// William. Not a sales rep. On signing:
//   1. Make sure they have a CCG sales_reps row with a DoorDispatcher token (harvest_level senior, so they see the
//      pins, same as William). Found by phone, else by exact name; created if missing. Never touches an existing
//      row's level or token.
//   2. Text AND email (every message goes by both) the harvesting script (the "IQ Pitch at the Door" on the rep
//      dashboard) + their DoorDispatcher link. DoorDispatcher makes them watch the 2 videos and pass the test first.
// They must also be on CCG netlify/functions/_harvesters.js so their bookings go to the zone manager and count on
// Harvester's Pay.
//
// `_`-prefixed helper, not an endpoint. Env: CCG_SUPABASE_URL, CCG_SUPABASE_SECRET_KEY (+ the GHL / Resend ones the
// senders use).

import { randomBytes } from 'node:crypto'
import { sendEmail } from './_email.js'
import { sendSmsViaGhl as sendSms } from './_ghl.js'

export const HARVEST_SCRIPT_URL = 'https://us-shingle-rep-dashboard.netlify.app/new-company-info/IQ%20Pitch%20at%20the%20Door.pdf'
const CCG_SITE = 'https://free-roof-inspections.netlify.app'

const digits10 = (p) => String(p || '').replace(/\D/g, '').slice(-10)

async function ccg(path, init = {}) {
  const url = process.env.CCG_SUPABASE_URL, key = process.env.CCG_SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error('Missing CCG_SUPABASE_URL / CCG_SUPABASE_SECRET_KEY')
  const r = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(init.headers || {}) },
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`CCG ${r.status}: ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : null
}

// → { name, harvest_token, created }
export async function ensureDoorDispatcherRep({ name, phone, email }) {
  const ph = digits10(phone)
  let rows = []
  if (ph) rows = (await ccg(`sales_reps?select=id,name,phone,harvest_token&phone=ilike.*${ph}*&limit=5`)) || []
  if (!rows.length && name) rows = (await ccg(`sales_reps?select=id,name,phone,harvest_token&name=ilike.${encodeURIComponent(name)}&limit=5`)) || []
  if (rows.length > 1) throw new Error(`More than one CCG rep matches ${name || ph}; set them up by hand.`)
  if (rows.length === 1) {
    const r = rows[0]
    if (r.harvest_token) return { name: r.name, harvest_token: r.harvest_token, created: false }
    const tok = randomBytes(16).toString('hex')
    await ccg(`sales_reps?id=eq.${r.id}`, { method: 'PATCH', body: JSON.stringify({ harvest_token: tok }) })
    return { name: r.name, harvest_token: tok, created: false }
  }
  const tok = randomBytes(16).toString('hex')
  // active false like William's row: a harvester is not a sales rep, so they stay off the sales rep pickers.
  await ccg('sales_reps', {
    method: 'POST',
    body: JSON.stringify({ name, phone: ph || null, email: email || null, active: false, harvest_token: tok, harvest_level: 'senior', harvest_link_sent_at: new Date().toISOString() }),
  })
  return { name, harvest_token: tok, created: true }
}

export function harvesterWelcomeText(firstName, ddLink) {
  return `${firstName || 'Hi'}, your paperwork is in, thank you!\n\n` +
    `Your harvesting script (the IQ Pitch at the Door): ${HARVEST_SCRIPT_URL}\n\n` +
    `Your DoorDispatcher link (yours only, save it): ${ddLink}\n\n` +
    `Before the map opens you'll watch 2 short videos and take a quick test. You need every answer right, and if you miss one it shows you what to re-read.`
}

// → { ok, sms, email, dd_link, created, error? }
export async function sendHarvesterWelcome({ firstName, lastName, phone, email }) {
  const name = [firstName, lastName].filter(Boolean).join(' ').trim()
  const rep = await ensureDoorDispatcherRep({ name, phone, email })
  const ddLink = `${CCG_SITE}/?mode=harvest&rt=${rep.harvest_token}`
  const msg = harvesterWelcomeText(firstName, ddLink)
  const out = { ok: true, sms: false, email: false, dd_link: ddLink, created: rep.created }
  const [s, e] = await Promise.allSettled([
    phone ? sendSms(phone, msg, { firstName: firstName || '', lastName: lastName || '' }) : Promise.resolve(null),
    email ? sendEmail(email, 'Your harvesting script + DoorDispatcher link', `${msg}\n\n— U.S. Shingle & Metal`) : Promise.resolve(null),
  ])
  out.sms = s.status === 'fulfilled' && !!s.value && s.value.ok !== false
  out.email = e.status === 'fulfilled' && !!e.value && e.value.ok !== false
  if (!out.sms && !out.email) out.ok = false
  return out
}
