// meet.js — the company's own video meetings (LiveKit), replacing Zoom (Neal, 2026-10-04).
//
// ROOMS live in app_settings 'meet_rooms' (set up on the admin page /meeting-rooms):
//   { slug, title, kind:'zone'|'managers'|'prayer'|'everyone'|'custom', zone?, schedule?,
//     topic?, cameras_required, hosts:[names] }
// A zone room shows that team's badge and name (HURRICANE…). The TOPIC line ("Today: John 3:16")
// shows at the top of everyone's screen and the host can change it live.
//
//   POST { action:'join', room, t }       rep/trainee/manager joins with their own TMS link token
//   POST { action:'join', room, pin }     admin joins with their PIN → host
//        → { ok, url, token, name, host, room:{title, zone, team, badge, color, topic, …} }
//        A regional manager is host in their own zone's room; so is a name in room.hosts.
//   POST { action:'set_topic', room, topic, pin | t }   host: change the line at the top (live)
//   POST { action:'mute'|'mute_all'|'remove', room, pin | t, identity? }   host controls
//   POST { action:'rooms', pin }                     admin: the room list
//   POST { action:'save_room', pin, room:{…} }       admin: create / edit
//   POST { action:'delete_room', pin, slug }         admin
//   POST { action:'audience', pin, slug }            admin: who the room is for + their links
//   POST { action:'send_links', pin, slug, note? }   admin: text + email each person their link
//   POST { action:'attendance', pin, slug, date }    admin: who joined, when, how long
//   POST { action:'guests', pin, slug }               admin: a public room's sign-in list (email list)
//   POST { action:'my_rooms', session }              a rep's own rooms + their personal links, for the
//        CCG rep dashboard (session = their CCG rep-pin session, checked with CCG). New active
//        reps show up on their own — the rooms come from their zone in TMS (Neal, 2026-10-04).
//   POST { action:'check' }                          setup check (no values shown)
//
// PUBLIC ROOMS (Neal, 2026-10-04 — the prayer call is open to people outside the company):
// room.public = true lets anyone in with their NAME + EMAIL instead of a TMS link, and each
// sign-in is kept (meet_guest_<room>_<hash>) so the host builds an email list; the opt-in
// box records whether they asked for emails. room.host_code lets a host who isn't in TMS
// (the prayer leader) host with a code instead of an admin PIN.
//
// Who you are is decided HERE, never by the page: the name on your tile comes from TMS, so
// nobody can join as someone else. Env: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET,
// SUPABASE_URL, SUPABASE_SECRET_KEY, URL.
import { AccessToken, RoomServiceClient, TrackType } from 'livekit-server-sdk'
import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import { sendSmsViaGhl } from './_ghl.js'
import { sendEmail } from './_email.js'

const PIN_URL = 'https://free-roof-inspections.netlify.app/.netlify/functions/regional-admin-pin'
const SITE = 'https://trainingmanagementsys.netlify.app'
const TEAMS = { 'Zone 1': 'SQUAD', 'Zone 2': 'SitSold', 'Zone 3': 'SHARKS', 'Zone 4': 'HURRICANE' } // = src/lib/zones.js
const COLORS = { 'Zone 1': '#E63946', 'Zone 2': '#1D6FB8', 'Zone 3': '#2A9D4A', 'Zone 4': '#F77F00' }
const TRIAL = { slug: 'trial', title: 'Trial meeting', kind: 'custom', hosts: [], cameras_required: false }
// CORS open: the CCG rep dashboard calls my_rooms from its own site.
const json = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' }, body: JSON.stringify(obj) })
const REP_PIN_URL = 'https://free-roof-inspections.netlify.app/.netlify/functions/rep-pin'
const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
const etDay = (ms = Date.now()) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

const verifyPin = async (pin) => {
  if (!String(pin || '').trim()) return null
  const v = await fetch(PIN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'verify', pin: String(pin) }) })
    .then((r) => r.json()).catch(() => ({}))
  return v.valid ? (v.name || 'Host') : null
}

// What the page shows at the top: team badge + name for a zone room, the title, the topic.
const publicRoom = (r) => ({
  slug: r.slug, title: r.title, kind: r.kind, zone: r.zone || null, team: r.zone ? TEAMS[r.zone] || null : null,
  badge: r.zone ? `/team-badges/zone${String(r.zone).replace(/\D/g, '')}.png` : null, color: r.zone ? COLORS[r.zone] || null : null,
  topic: r.topic || '', schedule: r.schedule || '', cameras_required: !!r.cameras_required, public: !!r.public,
})
const sameCode = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y) }

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, {})
  if (event.httpMethod !== 'POST') return json(405, { ok: false })
  const { LIVEKIT_URL: rawUrl, LIVEKIT_API_KEY: rawKey, LIVEKIT_API_SECRET: rawSecret } = process.env
  if (!rawUrl || !rawKey || !rawSecret) return json(500, { ok: false, error: 'Meetings are not set up yet.' })
  const url = rawUrl.trim(), key = rawKey.trim(), secret = rawSecret.trim()
  let b = {}
  try { b = JSON.parse(event.body || '{}') } catch { return json(400, { ok: false }) }
  const svc = () => new RoomServiceClient(url.replace(/^wss:/, 'https:'), key, secret)

  // Setup check (no values shown): do the key and secret actually pair up?
  if (b.action === 'check') {
    try { await svc().listRooms(); return json(200, { ok: true }) } catch (e) { return json(200, { ok: false, error: e.message }) }
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const getSetting = async (k, dflt) => { const { data } = await sb.from('app_settings').select('value').eq('key', k).maybeSingle(); try { return data ? (typeof data.value === 'string' ? JSON.parse(data.value) : data.value) ?? dflt : dflt } catch { return dflt } }
  const putSetting = (k, v) => sb.from('app_settings').upsert({ key: k, value: JSON.stringify(v), updated_at: new Date().toISOString() }, { onConflict: 'key' })
  const loadRooms = async () => { const list = await getSetting('meet_rooms', []); return Array.isArray(list) ? list : [] }
  const findRoom = async (slug) => { const s = String(slug || '').toLowerCase(); if (s === 'trial') return TRIAL; return (await loadRooms()).find((r) => r.slug === s) || null }
  const traineeByToken = async (t) => {
    if (!String(t || '').trim()) return null
    const { data } = await sb.from('trainees').select('id, first_name, last_name, managed_region, region').eq('registration_token', String(t).trim()).maybeSingle()
    return data || null
  }
  const fullName = (t) => `${t.first_name || ''} ${t.last_name || ''}`.trim()
  const isRoomHost = (room, t) => !!(room.zone && t.managed_region === room.zone) || (room.hosts || []).some((h) => h.toLowerCase() === fullName(t).toLowerCase())

  // ---- A REP'S OWN ROOMS (their dashboard) ----
  if (b.action === 'my_rooms') {
    const who = await fetch(REP_PIN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'whoami', session: String(b.session || '') }) })
      .then((r) => r.json()).catch(() => ({}))
    if (!who.ok || !who.jnid) return json(401, { ok: false, error: 'Signed out' })
    const { data: t } = await sb.from('trainees').select('id, first_name, last_name, region, managed_region, registration_token, is_active_sales_rep, rep_level').eq('jobnimbus_id', who.jnid).maybeSingle()
    if (!t || !t.registration_token) return json(200, { ok: true, rooms: [] })
    const active = t.is_active_sales_rep === true && t.rep_level !== 'non_field'
    const mine = (await loadRooms()).filter((r) =>
      (r.kind === 'zone' && (t.region === r.zone || t.managed_region === r.zone) && (active || t.managed_region)) ||
      (r.kind === 'managers' && t.managed_region) ||
      ((r.kind === 'everyone' || r.kind === 'prayer') && (active || t.managed_region)))
    return json(200, {
      ok: true,
      rooms: mine.map((r) => {
        const pr = publicRoom(r)
        // Viewing as a rep (Neal's view-as) shows the rooms but never their personal link.
        return { ...pr, badge: pr.badge ? `${SITE}${pr.badge}` : null, host: isRoomHost(r, t), link: who.viewer ? null : `${SITE}/meet/${r.slug}?t=${t.registration_token}` }
      }),
    })
  }

  // ---- ADMIN: rooms ----
  if (['rooms', 'save_room', 'delete_room', 'audience', 'send_links', 'attendance', 'guests'].includes(b.action)) {
    const admin = await verifyPin(b.pin)
    if (!admin) return json(401, { ok: false, error: 'Sign in again (PIN not recognised).' })
    const rooms = await loadRooms()
    if (b.action === 'rooms') return json(200, { ok: true, rooms: rooms.map((r) => ({ ...r, ...publicRoom(r) })), site: SITE })
    if (b.action === 'save_room') {
      const r = b.room || {}
      const slug = slugify(r.slug || r.title)
      if (!slug || !String(r.title || '').trim()) return json(400, { ok: false, error: 'The room needs a name.' })
      if (slug === 'trial') return json(400, { ok: false, error: 'Pick another name.' })
      const kind = ['zone', 'managers', 'prayer', 'everyone', 'custom'].includes(r.kind) ? r.kind : 'custom'
      const clean = {
        slug, title: String(r.title).trim().slice(0, 80), kind, zone: kind === 'zone' && TEAMS[r.zone] ? r.zone : null,
        schedule: String(r.schedule || '').slice(0, 120), topic: String(r.topic || '').slice(0, 200), cameras_required: !!r.cameras_required,
        public: !!r.public, host_code: String(r.host_code || '').trim().slice(0, 20),
        hosts: (Array.isArray(r.hosts) ? r.hosts : String(r.hosts || '').split(',')).map((h) => String(h).trim()).filter(Boolean).slice(0, 10),
        updated_at: new Date().toISOString(), updated_by: admin,
      }
      const i = rooms.findIndex((x) => x.slug === (r.original_slug || slug))
      if (i >= 0) {
        if (clean.slug !== rooms[i].slug && rooms.some((x) => x.slug === clean.slug)) return json(409, { ok: false, error: 'A room with that name already exists.' })
        rooms[i] = { ...rooms[i], ...clean }
      } else {
        if (rooms.some((x) => x.slug === slug)) return json(409, { ok: false, error: 'A room with that name already exists.' })
        rooms.push({ ...clean, created_at: clean.updated_at })
      }
      await putSetting('meet_rooms', rooms)
      return json(200, { ok: true, room: { ...clean, ...publicRoom(clean) } })
    }
    if (b.action === 'delete_room') {
      await putSetting('meet_rooms', rooms.filter((x) => x.slug !== b.slug))
      return json(200, { ok: true })
    }
    const room = rooms.find((x) => x.slug === b.slug)
    if (!room) return json(404, { ok: false, error: 'No such room.' })
    if (b.action === 'audience' || b.action === 'send_links') {
      // Who the room is FOR — straight from TMS, so it follows the roster on its own.
      let q = sb.from('trainees').select('id, first_name, last_name, phone, email, region, managed_region, registration_token, rep_level, is_active_sales_rep')
      q = room.kind === 'managers' ? q.not('managed_region', 'is', null) : q.or('is_active_sales_rep.eq.true,managed_region.not.is.null')
      const { data } = await q
      let people = (data || []).filter((p) => p.registration_token && p.rep_level !== 'non_field')
      if (room.kind === 'zone') people = people.filter((p) => p.region === room.zone || p.managed_region === room.zone)
      if (room.kind === 'custom') people = []
      const rows = people.map((p) => ({ id: p.id, name: fullName(p), phone: p.phone, email: p.email, link: `${SITE}/meet/${room.slug}?t=${p.registration_token}`, host: isRoomHost(room, p) }))
        .sort((a, c) => a.name.localeCompare(c.name))
      if (b.action === 'audience') return json(200, { ok: true, people: rows })
      // Every message goes by text AND email (texts alone miss people on Do Not Disturb).
      const results = []
      for (const p of rows) {
        const first = p.name.split(' ')[0] || 'there'
        const msg = `Hi ${first}, here is your link for ${room.title}${room.schedule ? ` (${room.schedule})` : ''}. It's yours only, so keep it and use it every time: ${p.link}${b.note ? `\n\n${String(b.note).slice(0, 300)}` : ''}`
        const r = { name: p.name, sms: false, email: false }
        if (p.phone) { try { const x = await sendSmsViaGhl(p.phone, msg, { firstName: first, lastName: p.name.split(' ').slice(1).join(' ') }); r.sms = !!(x && x.ok !== false) } catch { /* shown as not sent */ } }
        if (p.email) { try { const x = await sendEmail(p.email, `Your link: ${room.title}`, msg); r.email = !!(x && x.ok !== false) } catch { /* shown as not sent */ } }
        results.push(r)
      }
      return json(200, { ok: true, sent: results })
    }
    if (b.action === 'guests') {
      const { data } = await sb.from('app_settings').select('value').like('key', `meet_guest_${room.slug}_%`)
      const rows = (data || []).map((x) => { try { return typeof x.value === 'string' ? JSON.parse(x.value) : x.value } catch { return null } }).filter(Boolean)
        .sort((a, c) => String(c.last || '').localeCompare(String(a.last || '')))
      return json(200, { ok: true, guests: rows })
    }
    if (b.action === 'attendance') {
      const day = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : etDay()
      const { data } = await sb.from('app_settings').select('key, value').like('key', `meet_att_${day}_${room.slug}_%`)
      const rows = (data || []).map((x) => { try { return typeof x.value === 'string' ? JSON.parse(x.value) : x.value } catch { return null } }).filter(Boolean)
      return json(200, { ok: true, date: day, people: rows })
    }
  }

  // ---- JOIN + HOST ----
  const room = await findRoom(b.room)
  if (!room) return json(404, { ok: false, error: 'That meeting room does not exist.' })

  // What the door shows before anyone signs in (title, badge, whether outside guests can come in).
  if (b.action === 'info') return json(200, { ok: true, room: publicRoom(room), host_code: !!room.host_code })

  if (b.action === 'join') {
    let name = null, identity = null, host = false
    const admin = await verifyPin(b.pin)
    // Each device gets its own seat — the same identity twice would kick the first device out.
    const seat = () => Math.random().toString(36).slice(2, 7)
    if (admin) { name = admin; identity = `host:${admin}:${seat()}`; host = true }
    else if (room.host_code && sameCode(b.host_code, room.host_code)) {
      name = String(b.name || '').trim().slice(0, 60) || 'Host'; identity = `host:${slugify(name)}:${seat()}`; host = true
    } else if (room.public && b.guest) {
      // Outside guest: name + email, kept as the room's email list.
      const gName = String(b.guest.name || '').trim().slice(0, 60), email = String(b.guest.email || '').trim().toLowerCase().slice(0, 120)
      if (!gName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { ok: false, error: 'Please enter your name and a real email.' })
      const h = crypto.createHash('sha256').update(email).digest('hex').slice(0, 16)
      const gKey = `meet_guest_${room.slug}_${h}`
      const prev = await getSetting(gKey, null)
      const now = new Date().toISOString()
      await putSetting(gKey, { name: gName, email, opt_in: !!b.guest.opt_in || !!prev?.opt_in, first: prev?.first || now, last: now, visits: (prev?.visits || 0) + 1 })
      name = gName; identity = `g:${h}:${seat()}`
    } else {
      const t = await traineeByToken(b.t)
      if (t) { name = fullName(t) || 'Guest'; identity = `t:${t.id}`; host = isRoomHost(room, t) }
    }
    if (!identity) return json(401, { ok: false, error: b.pin ? 'PIN not recognised.' : 'Open the meeting from your own link.' })
    const at = new AccessToken(key, secret, { identity, name, ttl: '6h', metadata: JSON.stringify({ host }) })
    at.addGrant({ room: room.slug, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true, roomAdmin: host })
    // Open the room with its top line already set, so the first person in sees it.
    try { await svc().createRoom({ name: room.slug, emptyTimeout: 600, metadata: JSON.stringify({ topic: room.topic || '' }) }) } catch { /* already open */ }
    return json(200, { ok: true, url, token: await at.toJwt(), name, host, title: room.title, room: publicRoom(room) })
  }

  // Host actions: an admin PIN, or the link of a room host (the zone's manager, a named host).
  let hostOk = !!(await verifyPin(b.pin)) || !!(room.host_code && sameCode(b.host_code, room.host_code))
  if (!hostOk) { const t = await traineeByToken(b.t); hostOk = !!(t && isRoomHost(room, t)) }
  if (!hostOk) return json(401, { ok: false, error: 'Only the host can do that.' })
  try {
    if (b.action === 'set_topic') {
      const topic = String(b.topic || '').slice(0, 200)
      if (room.slug !== 'trial') { const rooms = await loadRooms(); const r = rooms.find((x) => x.slug === room.slug); if (r) { r.topic = topic; await putSetting('meet_rooms', rooms) } }
      try { await svc().updateRoomMetadata(room.slug, JSON.stringify({ topic })) } catch { /* nobody in yet — saved for next time */ }
      return json(200, { ok: true, topic })
    }
    const muteMic = async (p) => {
      for (const tr of p.tracks || []) if (tr.type === TrackType.AUDIO && !tr.muted) await svc().mutePublishedTrack(room.slug, p.identity, tr.sid, true)
    }
    if (b.action === 'mute' || b.action === 'remove') {
      const identity = String(b.identity || '')
      if (!identity) return json(400, { ok: false, error: 'Who?' })
      if (b.action === 'remove') await svc().removeParticipant(room.slug, identity)
      else await muteMic(await svc().getParticipant(room.slug, identity))
      return json(200, { ok: true })
    }
    if (b.action === 'mute_all') {
      const list = await svc().listParticipants(room.slug)
      const meta = (p) => { try { return JSON.parse(p.metadata || '{}') } catch { return {} } }
      for (const p of list) if (!meta(p).host) await muteMic(p)
      return json(200, { ok: true, muted: list.length })
    }
  } catch (e) {
    return json(502, { ok: false, error: e.message || 'LiveKit error' })
  }
  return json(400, { ok: false, error: 'unknown action' })
}
