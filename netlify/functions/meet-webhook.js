// meet-webhook.js — LiveKit tells us when someone joins or leaves a meeting room, so attendance
// takes itself (Neal, 2026-10-04: no kiosk sign-in). Set in LiveKit → Settings → Webhooks:
//   https://trainingmanagementsys.netlify.app/.netlify/functions/meet-webhook
//
// One app_settings row per person per room per day, so two people joining at the same second
// can't overwrite each other:  meet_att_<YYYY-MM-DD>_<room>_<identity>
//   { name, identity, room, joins:[{ in, out }], camera_off_at:[…] }
// The signature is checked with the same API key/secret, so nobody else can post here.
// Env: LIVEKIT_API_KEY, LIVEKIT_API_SECRET, SUPABASE_URL, SUPABASE_SECRET_KEY.
import { WebhookReceiver } from 'livekit-server-sdk'
import { createClient } from '@supabase/supabase-js'

const etDay = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const safe = (s) => String(s || '').replace(/[^A-Za-z0-9:_-]/g, '').slice(0, 80)

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: '' }
  const receiver = new WebhookReceiver(String(process.env.LIVEKIT_API_KEY || '').trim(), String(process.env.LIVEKIT_API_SECRET || '').trim())
  let ev
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '')
    ev = await receiver.receive(raw, event.headers.authorization || event.headers.Authorization)
  } catch { return { statusCode: 401, body: 'bad signature' } }

  const kinds = ['participant_joined', 'participant_left', 'track_published', 'track_unpublished']
  if (!kinds.includes(ev.event) || !ev.participant || !ev.room) return { statusCode: 200, body: 'ok' }
  // The AI homeowner and any recorder aren't people — leave them off the register.
  if (/^(agent|egress|homeowner)/i.test(ev.participant.identity || '')) return { statusCode: 200, body: 'ok' }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const at = Number(ev.createdAt) ? Number(ev.createdAt) * 1000 : Date.now()
  const key = `meet_att_${etDay(at)}_${safe(ev.room.name)}_${safe(ev.participant.identity)}`
  const { data } = await sb.from('app_settings').select('value').eq('key', key).maybeSingle()
  let rec = null
  try { rec = data ? (typeof data.value === 'string' ? JSON.parse(data.value) : data.value) : null } catch { rec = null }
  rec = rec || { name: ev.participant.name || ev.participant.identity, identity: ev.participant.identity, room: ev.room.name, joins: [], camera: [] }
  const iso = new Date(at).toISOString()
  const open = rec.joins.length && !rec.joins[rec.joins.length - 1].out ? rec.joins[rec.joins.length - 1] : null

  if (ev.event === 'participant_joined') { if (!open) rec.joins.push({ in: iso, out: null }) }
  else if (ev.event === 'participant_left') { if (open) open.out = iso }
  else if (ev.track && Number(ev.track.type) === 1 && Number(ev.track.source) === 1) {
    // Camera (video track from the camera, not a screen share) turned on / off.
    rec.camera = (rec.camera || []).concat([{ at: iso, on: ev.event === 'track_published' }]).slice(-200)
  } else return { statusCode: 200, body: 'ok' }

  await sb.from('app_settings').upsert({ key, value: JSON.stringify(rec), updated_at: new Date().toISOString() }, { onConflict: 'key' })
  return { statusCode: 200, body: 'ok' }
}
