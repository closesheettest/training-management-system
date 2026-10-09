// meet-email-background.js — email a public room's guest list (Neal, 2026-10-04: "we should have
// a send everybody an email kind of thing" — the 9:15 Devotional's list). Background function so
// a long list can't time out; Resend allows ~2 emails a second, so it paces itself.
//
//   POST { pin, slug, subject, message, test_to? }
//     test_to → sends ONE copy there (a test) and stops.
//     otherwise → every guest who ticked "email me" (opt_in), each with their own unsubscribe link.
// Each send is logged to app_settings meet_email_log_<slug> (newest first, last 30).
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY, RESEND_API_KEY, EMAIL_FROM.
import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import { sendEmail } from './_email.js'
import { adminVerify } from './_admin-auth.js'

const PIN_URL = 'https://free-roof-inspections.netlify.app/.netlify/functions/regional-admin-pin'
const SITE = 'https://trainingmanagementsys.netlify.app'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
export const unsubSig = (slug, h) => crypto.createHmac('sha256', String(process.env.SUPABASE_SECRET_KEY || '')).update(`unsub:${slug}:${h}`).digest('hex').slice(0, 24)

export const handler = async (event) => {
  let b = {}
  try { b = JSON.parse(event.body || '{}') } catch { return { statusCode: 400 } }
  const v = await adminVerify(b.pin)
  if (!v.valid) return { statusCode: 401 }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const get = async (k) => { const { data } = await sb.from('app_settings').select('value').eq('key', k).maybeSingle(); try { return data ? JSON.parse(data.value) : null } catch { return null } }
  const rooms = (await get('meet_rooms')) || []
  const room = rooms.find((r) => r.slug === b.slug && r.public)
  const subject = String(b.subject || '').trim().slice(0, 150), message = String(b.message || '').trim().slice(0, 8000)
  if (!room || !subject || !message) return { statusCode: 400 }

  const footer = (link) => `\n\n—\nYou're getting this because you signed up at ${room.title}.${link ? `\nUnsubscribe: ${link}` : ''}`
  const opts = { fromName: room.title }
  if (b.test_to) {
    await sendEmail(String(b.test_to).trim(), `[TEST] ${subject}`, message + footer(`${SITE}/.netlify/functions/meet-unsub?r=${room.slug}&h=test`), opts)
    return { statusCode: 202 }
  }
  const { data } = await sb.from('app_settings').select('key, value').like('key', `meet_guest_${room.slug}_%`)
  const guests = (data || []).map((x) => { try { return { h: x.key.slice(`meet_guest_${room.slug}_`.length), ...JSON.parse(x.value) } } catch { return null } }).filter((g) => g && g.opt_in && g.email)
  let sent = 0; const failed = []
  for (const g of guests) {
    const link = `${SITE}/.netlify/functions/meet-unsub?r=${room.slug}&h=${g.h}&s=${unsubSig(room.slug, g.h)}`
    const first = String(g.name || '').split(' ')[0]
    const r = await sendEmail(g.email, subject, (first ? `Hi ${first},\n\n` : '') + message + footer(link), opts).catch((e) => ({ ok: false, error: e.message }))
    if (r.ok) sent++; else failed.push(`${g.email}: ${r.error || r.step}`)
    await wait(600)
  }
  const log = (await get(`meet_email_log_${room.slug}`)) || []
  log.unshift({ at: new Date().toISOString(), by: v.name || '', subject, to: guests.length, sent, failed: failed.slice(0, 20) })
  await sb.from('app_settings').upsert({ key: `meet_email_log_${room.slug}`, value: JSON.stringify(log.slice(0, 30)), updated_at: new Date().toISOString() }, { onConflict: 'key' })
  return { statusCode: 202 }
}
