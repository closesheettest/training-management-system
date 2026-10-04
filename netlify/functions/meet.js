// meet.js — the company's own video meetings (LiveKit), replacing Zoom (Neal, 2026-10-04).
//
// STEP 1 of the build: one working room with gallery, speaker view, screen share, chat and
// host controls. The admin page that creates rooms (zone rooms, managers, prayer, Week A/B)
// and automatic attendance come next; until then the only room is the TRIAL room.
//
//   POST { action:'join', room, t }        → a trainee/rep joins with their own TMS link token
//   POST { action:'join', room, pin }      → the host joins with their admin PIN (host powers)
//        → { ok, url, token, name, host }
//   POST { action:'mute',   room, pin, identity }   host: mute one person's microphone
//   POST { action:'mute_all', room, pin }           host: mute everyone except the host
//   POST { action:'remove', room, pin, identity }   host: take someone out of the room
//
// Who you are is decided HERE, never by the page: the name on your tile comes from TMS, so
// nobody can join as someone else. Env: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET,
// SUPABASE_URL, SUPABASE_SECRET_KEY.
import { AccessToken, RoomServiceClient, TrackType } from 'livekit-server-sdk'
import { createClient } from '@supabase/supabase-js'

const PIN_URL = 'https://free-roof-inspections.netlify.app/.netlify/functions/regional-admin-pin'
const ROOMS = { trial: { title: 'Trial meeting' } } // the admin page replaces this list
const json = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) })

const verifyPin = async (pin) => {
  if (!String(pin || '').trim()) return null
  const v = await fetch(PIN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'verify', pin: String(pin) }) })
    .then((r) => r.json()).catch(() => ({}))
  return v.valid ? (v.name || 'Host') : null
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false })
  const { LIVEKIT_URL: url, LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret } = process.env
  if (!url || !key || !secret) return json(500, { ok: false, error: 'Meetings are not set up yet.' })
  let b = {}
  try { b = JSON.parse(event.body || '{}') } catch { return json(400, { ok: false }) }
  const room = String(b.room || '').toLowerCase()
  if (!ROOMS[room]) return json(404, { ok: false, error: 'That meeting room does not exist.' })

  if (b.action === 'join') {
    let name = null, identity = null, host = false
    const hostName = await verifyPin(b.pin)
    // Each device gets its own seat — the same identity twice would kick the first device out.
    if (hostName) { name = hostName; identity = `host:${hostName}:${Math.random().toString(36).slice(2, 7)}`; host = true }
    else if (String(b.t || '').trim()) {
      const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
      const { data: t } = await sb.from('trainees').select('id, first_name, last_name').eq('registration_token', String(b.t).trim()).maybeSingle()
      if (t) { name = `${t.first_name || ''} ${t.last_name || ''}`.trim() || 'Guest'; identity = `t:${t.id}` }
    }
    if (!identity) return json(401, { ok: false, error: b.pin ? 'PIN not recognised.' : 'Open the meeting from your own link.' })
    const at = new AccessToken(key, secret, { identity, name, ttl: '6h', metadata: JSON.stringify({ host }) })
    at.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true, roomAdmin: host })
    return json(200, { ok: true, url, token: await at.toJwt(), name, host, title: ROOMS[room].title })
  }

  // Host controls — PIN checked on every call.
  if (!(await verifyPin(b.pin))) return json(401, { ok: false, error: 'Host PIN required.' })
  const svc = new RoomServiceClient(url.replace(/^wss:/, 'https:'), key, secret)
  const muteMic = async (p) => {
    for (const tr of p.tracks || []) if (tr.type === TrackType.AUDIO && !tr.muted) await svc.mutePublishedTrack(room, p.identity, tr.sid, true)
  }
  try {
    if (b.action === 'mute' || b.action === 'remove') {
      const identity = String(b.identity || '')
      if (!identity) return json(400, { ok: false, error: 'Who?' })
      if (b.action === 'remove') await svc.removeParticipant(room, identity)
      else await muteMic(await svc.getParticipant(room, identity))
      return json(200, { ok: true })
    }
    if (b.action === 'mute_all') {
      const list = await svc.listParticipants(room)
      for (const p of list) if (!p.identity.startsWith('host:')) await muteMic(p)
      return json(200, { ok: true, muted: list.length })
    }
  } catch (e) {
    return json(502, { ok: false, error: e.message || 'LiveKit error' })
  }
  return json(400, { ok: false, error: 'unknown action' })
}
