// meet.js — the company's own video meetings (LiveKit), replacing Zoom (Neal, 2026-10-04).
//
// ROOMS live in app_settings 'meet_rooms' (set up on the admin page /meeting-rooms):
//   { slug, title, kind:'zone'|'managers'|'prayer'|'everyone'|'custom', zone?, schedule?,
//     topic?, cameras_required, hosts:[names] }
// 'company' (Neal, 2026-10-04) = every active sales rep + every manager + the trainees in a
// class running now (enrolled, not dropped or declined).
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
import { AccessToken, RoomServiceClient, TrackType, EgressClient, EncodedFileOutput, S3Upload } from 'livekit-server-sdk'
import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3'
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
  recording_enabled: !!r.recording_enabled,
  look: r.look || (r.kind === 'company' ? 'company' : 'team'), banner_url: r.banner_url || null, welcome: r.welcome || '',
  back_label: r.back_label || '', back_url: r.back_url || '',
  next_at: hasSchedule(r) ? nextMeeting(r)?.start?.toISOString() || null : null,
  // A company meeting only exists on the dates you add, so with none it reads "nothing scheduled",
  // never "always open" (Neal, 2026-10-04).
  scheduled: !!hasSchedule(r) || r.kind === 'company',
})
// SCHEDULE (Neal, 2026-10-04: "if they pressed it and there is no company meeting, it could tell
// them when the meeting is scheduled for"). A room can repeat on weekdays at a time (days 0=Sun…6,
// time 'HH:MM' Eastern, minutes long) and/or have one-time meetings (once: ['YYYY-MM-DDTHH:MM', …]).
// A room with a schedule is OPEN from 15 minutes before a start until it ends, or whenever a host
// is in it; otherwise people get "no meeting right now — next one is …". No schedule = always open.
const etOffsetMin = (d) => { const m = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' }).formatToParts(d).find((x) => x.type === 'timeZoneName')?.value.match(/GMT([+-]\d+)(?::(\d+))?/); return m ? Number(m[1]) * 60 + Math.sign(Number(m[1])) * Number(m[2] || 0) : -300 }
const etWall = (day, time) => { const guess = new Date(`${day}T${time}:00Z`); return new Date(guess.getTime() - etOffsetMin(guess) * 60000) }
// Weekly slots, each day with its OWN time and length (Neal, 2026-10-04: "Week A does Monday at
// 2 to 4, Tuesday is different…"). Old rooms (one time for all days) read as slots too.
const slotsOf = (r) => (Array.isArray(r.slots) && r.slots.length ? r.slots
  : (Array.isArray(r.days) && /^\d{2}:\d{2}$/.test(r.time || '') ? r.days.map((d) => ({ day: d, time: r.time, minutes: r.minutes })) : []))
  .filter((x) => x && x.day >= 0 && x.day <= 6 && /^\d{2}:\d{2}$/.test(x.time || ''))
const hasSchedule = (r) => slotsOf(r).length > 0 || (Array.isArray(r.once) && r.once.length)
// The current or next meeting: { start, end } as Dates, or null.
const nextMeeting = (r, now = Date.now()) => {
  const dflt = Math.max(10, Number(r.minutes) || 60), out = []
  const slots = slotsOf(r)
  for (let i = -1; i < 15; i++) {
    const day = etDay(now + i * 864e5), dow = new Date(`${day}T12:00:00Z`).getUTCDay()
    for (const sl of slots) if (sl.day === dow) out.push({ start: etWall(day, sl.time), mins: Math.max(10, Number(sl.minutes) || dflt) })
  }
  for (const o of r.once || []) { const m = String(o).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/); if (m) out.push({ start: etWall(m[1], m[2]), mins: dflt }) }
  const hit = out.map((x) => ({ start: x.start, end: new Date(x.start.getTime() + x.mins * 60000) })).filter((x) => x.end.getTime() > now).sort((a, b) => a.start - b.start)[0]
  return hit || null
}
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

  // Recording storage check (no values shown): can the S3 keys see the recordings folder?
  if (b.action === 'rec_check') {
    try {
      const c = new S3Client({ region: (process.env.REC_S3_REGION || '').trim(), endpoint: process.env.REC_S3_ENDPOINT || `${String(process.env.SUPABASE_URL).replace('.supabase.co', '.storage.supabase.co')}/storage/v1/s3`, forcePathStyle: true, credentials: { accessKeyId: (process.env.REC_S3_ACCESS_KEY || '').trim(), secretAccessKey: (process.env.REC_S3_SECRET || '').trim() } })
      const r = await c.send(new ListObjectsV2Command({ Bucket: 'meeting-recordings', MaxKeys: 1 }))
      return json(200, { ok: true, files: r.KeyCount ?? 0 })
    } catch (e) { return json(200, { ok: false, error: e.name + ': ' + e.message }) }
  }
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
    const { data } = await sb.from('trainees').select('id, first_name, last_name, managed_region, region, class_id').eq('registration_token', String(t).trim()).maybeSingle()
    return data || null
  }
  // Trainees in a class running now (or starting within 3 days), still enrolled.
  const traineeIdsNow = async () => {
    const today = etDay(), soon = etDay(Date.now() + 3 * 864e5)
    const { data } = await sb.from('classes').select('id, attendance_only, cancelled_at, trainees!class_id(id, enrolled, dropped_out_at, declined_at)')
      .lte('week_start_date', soon).gte('week_end_date', today)
    const ids = new Set()
    for (const c of data || []) if (!c.cancelled_at) for (const t of c.trainees || []) if (t.enrolled !== false && !t.dropped_out_at && !t.declined_at) ids.add(t.id)
    return ids
  }
  // TRAINING CLASS rooms (Neal, 2026-10-04 — virtual Week A): the trainees of the class that is in
  // its Week A (first week) or Week B (second week) right now. Counted from the class start, with a
  // 3-day lead so Friday's links can go out for Monday.
  const trainingIds = (week) => (async () => {
    const now = Date.now(), lead = 3 * 864e5
    const { data } = await sb.from('classes').select('id, week_start_date, week_end_date, cancelled_at, trainees!class_id(id, enrolled, dropped_out_at, declined_at)')
      .gte('week_end_date', etDay(now - 864e5)).lte('week_start_date', etDay(now + lead))
    const ids = new Set()
    for (const c of data || []) {
      if (c.cancelled_at) continue
      const start = Date.parse(`${c.week_start_date}T12:00:00Z`), wkB = start + 7 * 864e5
      const inA = now >= start - lead && now < wkB - 864e5 * 2 // through Friday of week A (weekend → week B)
      const inB = now >= wkB - lead && now <= Date.parse(`${c.week_end_date}T23:59:00Z`)
      if (week === 'both' ? !(inA || inB) : week === 'B' ? !inB : !inA) continue
      for (const t of c.trainees || []) if (t.enrolled !== false && !t.dropped_out_at && !t.declined_at) ids.add(t.id)
    }
    return ids
  })()
  const fullName = (t) => `${t.first_name || ''} ${t.last_name || ''}`.trim()
  const isRoomHost = (room, t) => !!(room.zone && t.managed_region === room.zone) || (room.hosts || []).some((h) => h.toLowerCase() === fullName(t).toLowerCase())

  // Is a host in the room right now, and may non-hosts come in?
  const openState = async (r) => {
    let live = false
    try { live = (await svc().listParticipants(r.slug)).some((p) => { try { return JSON.parse(p.metadata || '{}').host } catch { return false } }) } catch { /* room not open */ }
    if (!hasSchedule(r)) return { live, open: r.kind === 'company' ? live : true }
    const nm = nextMeeting(r)
    const open = live || !!(nm && Date.now() >= nm.start.getTime() - 15 * 60000)
    return { live, open }
  }

  // RECORDINGS PAGE (/recordings/<room>?k=…): the room's recordings with download links, for the
  // people the link is shared with (Neal, 2026-10-04: "devotional will have devotional
  // recordings"). The key is the room's own rec_key, or an admin PIN.
  if (b.action === 'rec_list') {
    const r = (await loadRooms()).find((x) => x.slug === String(b.room || ''))
    if (!r || !r.recording_enabled) return json(404, { ok: false, error: 'No recordings here.' })
    const allowed = (r.rec_key && String(b.k || '') === r.rec_key) || !!(await verifyPin(b.pin))
    if (!allowed) return json(401, { ok: false, error: 'This recordings link is not valid.' })
    const log = (await getSetting(`meet_recordings_${r.slug}`, [])) || []
    const out = []
    for (const x of log.slice(0, 120)) {
      let link = null
      if (x.ready && !x.deleted) { const { data } = await sb.storage.from('meeting-recordings').createSignedUrl(x.file, 3600, { download: `${r.title} ${String(x.started).slice(0, 10)}${x.kind === 'raw' ? ' host camera' : ''}.mp4` }); link = data?.signedUrl || null }
      out.push({ started: x.started, kind: x.kind, minutes: x.minutes || null, seconds: x.seconds ?? null, mb: x.mb || null, ready: !!x.ready, deleted: !!x.deleted, error: x.error || null, link })
    }
    return json(200, { ok: true, room: publicRoom(r), keep_days: r.rec_keep_days ?? 90, recordings: out })
  }

  // ROOM LIST for the "My meeting rooms" launcher (My Tools): names, looks, live / next only —
  // no personal links or codes, so it needs no sign-in. Hosts join with their PIN in the room.
  if (b.action === 'room_list') {
    const list = await loadRooms()
    const states = await Promise.all(list.map((r) => openState(r)))
    return json(200, { ok: true, rooms: list.map((r, i) => ({ ...publicRoom(r), ...states[i], badge: publicRoom(r).badge ? `${SITE}${publicRoom(r).badge}` : null, link: `${SITE}/meet/${r.slug}` })) })
  }

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
      ((r.kind === 'everyone' || r.kind === 'prayer' || r.kind === 'company') && (active || t.managed_region)))
    const openOf = Object.fromEntries(await Promise.all(mine.map(async (r) => [r.slug, await openState(r)])))
    // COMPANY MEETING DAY (Neal, 2026-10-04): on a day with a company meeting, the rep's regular
    // meetings that day are greyed out ("Company Meeting today instead") and the company one
    // stands out. Only meetings still to come today count.
    const today = etDay()
    const dayOf = (r) => { const nm = hasSchedule(r) ? nextMeeting(r) : null; return nm ? etDay(nm.start.getTime()) : null }
    const company = mine.find((r) => r.kind === 'company' && dayOf(r) === today)
    if (company) for (const r of mine) {
      if (r === company) openOf[r.slug] = { ...openOf[r.slug], today: true }
      else if (r.kind !== 'prayer' && dayOf(r) === today && !openOf[r.slug].live) openOf[r.slug] = { ...openOf[r.slug], instead: company.title }
    }
    return json(200, {
      ok: true,
      rooms: mine.map((r) => {
        const pr = publicRoom(r)
        // Viewing as a rep (Neal's view-as) shows the rooms but never their personal link.
        return { ...pr, ...openOf[r.slug], badge: pr.badge ? `${SITE}${pr.badge}` : null, host: isRoomHost(r, t), link: who.viewer ? null : `${SITE}/meet/${r.slug}?t=${t.registration_token}` }
      }),
    })
  }

  // ---- ADMIN: rooms ----
  if (['rooms', 'save_room', 'delete_room', 'reorder', 'audience', 'send_links', 'attendance', 'guests', 'email_log', 'recordings', 'delete_recording', 'early_grad'].includes(b.action)) {
    const admin = await verifyPin(b.pin)
    if (!admin) return json(401, { ok: false, error: 'Sign in again (PIN not recognised).' })
    const rooms = await loadRooms()
    if (b.action === 'rooms') return json(200, { ok: true, rooms: rooms.map((r) => ({ ...r, ...publicRoom(r) })), site: SITE })
    if (b.action === 'save_room') {
      const r = b.room || {}
      // A NEW room gets its own address. Team rooms all called "Morning Sales Training" used to
      // share one, so saving the second wrote over the first (Neal, 2026-10-04). Team rooms take
      // the team name (morning-sales-training-hurricane); any clash after that gets -2, -3….
      const editing = r.original_slug ? rooms.find((x) => x.slug === r.original_slug) : null
      let slug = editing ? editing.slug : slugify(`${r.title || ''}${r.kind === 'zone' && TEAMS[r.zone] ? ` ${TEAMS[r.zone]}` : ''}`)
      if (!editing) { const base = slug; for (let n = 2; rooms.some((x) => x.slug === slug) || slug === 'trial'; n++) slug = `${base}-${n}` }
      if (!slug || !String(r.title || '').trim()) return json(400, { ok: false, error: 'The room needs a name.' })
      if (slug === 'trial') return json(400, { ok: false, error: 'Pick another name.' })
      const kind = ['zone', 'managers', 'company', 'training', 'prayer', 'everyone', 'custom'].includes(r.kind) ? r.kind : 'custom'
      const clean = {
        slug, title: String(r.title).trim().slice(0, 80), kind, zone: kind === 'zone' && TEAMS[r.zone] ? r.zone : null,
        schedule: String(r.schedule || '').slice(0, 120), topic: String(r.topic || '').slice(0, 200), cameras_required: !!r.cameras_required,
        look: ['team', 'company', 'devotional'].includes(r.look) ? r.look : (kind === 'company' ? 'company' : 'team'),
        banner_url: /^https:\/\/\S+$/.test(String(r.banner_url || '').trim()) ? String(r.banner_url).trim().slice(0, 300) : '',
        welcome: String(r.welcome || '').slice(0, 400), back_label: String(r.back_label || '').slice(0, 60),
        back_url: /^https:\/\/\S+$/.test(String(r.back_url || '').trim()) ? String(r.back_url).trim().slice(0, 300) : '',
        recording_enabled: !!r.recording_enabled,
        // Who gets "the recording is ready" (name + email each), what to record, how long to keep.
        rec_to: (Array.isArray(r.rec_to) ? r.rec_to : []).map((x) => ({ name: String(x?.name || '').trim().slice(0, 60), email: String(x?.email || '').trim().toLowerCase().slice(0, 120) })).filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.email)).slice(0, 10),
        rec_kind: ['combined', 'raw', 'both'].includes(r.rec_kind) ? r.rec_kind : 'combined',
        rec_keep_days: [30, 60, 90, 0].includes(Number(r.rec_keep_days)) ? Number(r.rec_keep_days) : 90,
        // The recordings page's private key (its link is shared with the editor, e.g. DeWayne's cousin).
        rec_key: (rooms.find((x) => x.slug === r.original_slug) || {}).rec_key || crypto.randomBytes(9).toString('base64url'),
        training_week: ['A', 'B', 'both'].includes(r.training_week) ? r.training_week : 'A',
        public: !!r.public, host_code: String(r.host_code || '').trim().slice(0, 20),
        slots: (Array.isArray(r.slots) ? r.slots : []).map((x) => ({ day: Number(x.day), time: String(x.time || ''), minutes: Math.min(600, Math.max(10, Number(x.minutes) || 60)) })).filter((x) => x.day >= 0 && x.day <= 6 && /^\d{2}:\d{2}$/.test(x.time)).sort((a, b) => a.day - b.day),
        days: [], time: '',
        minutes: Math.min(600, Math.max(10, Number(r.minutes) || 60)), once: (Array.isArray(r.once) ? r.once : []).filter((o) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(o)).slice(0, 20),
        hosts: (Array.isArray(r.hosts) ? r.hosts : String(r.hosts || '').split(',')).map((h) => String(h).trim()).filter(Boolean).slice(0, 10),
        updated_at: new Date().toISOString(), updated_by: admin,
      }
      // Editing keeps the room's address, so links already sent keep working.
      const i = editing ? rooms.indexOf(editing) : -1
      if (i >= 0) rooms[i] = { ...rooms[i], ...clean }
      else rooms.push({ ...clean, created_at: clean.updated_at })
      await putSetting('meet_rooms', rooms)
      return json(200, { ok: true, room: { ...clean, ...publicRoom(clean) } })
    }
    // ORDER (Neal, 2026-10-04: drag the rooms into any order). The list order is also the order
    // the rooms show on a rep's dashboard.
    if (b.action === 'reorder') {
      const want = (Array.isArray(b.slugs) ? b.slugs : []).map(String)
      const pos = (x) => { const k = want.indexOf(x.slug); return k < 0 ? 1e9 : k }
      rooms.sort((a, c) => pos(a) - pos(c))
      await putSetting('meet_rooms', rooms)
      return json(200, { ok: true })
    }
    // GRADUATED EARLY (Neal, 2026-10-04), from a training room's people list:
    //   Week A early → into the field for the rest of Week A, still IN for Week B (is_field_trainee
    //     + week_b_force, the override the kiosk / class page / no-show rule already honour).
    //   Week B early → a junior rep on their team now (the same switch as the field-trainee
    //     "graduate": active sales rep, junior if no level yet, field trainee off).
    if (b.action === 'early_grad') {
      const tid = String(b.trainee_id || ''), week = b.week === 'B' ? 'B' : 'A', now = new Date().toISOString()
      const { data: g } = await sb.from('trainees').select('id, first_name, last_name, rep_level, became_active_rep_at').eq('id', tid).maybeSingle()
      if (!g) return json(404, { ok: false, error: 'Trainee not found' })
      const patch = week === 'A' ? { is_field_trainee: true, week_b_force: true }
        : { is_field_trainee: false, is_active_sales_rep: true, became_active_rep_at: g.became_active_rep_at || now, ...(g.rep_level ? {} : { rep_level: 'junior', rep_level_confirmed_at: now }) }
      const { error } = await sb.from('trainees').update(patch).eq('id', tid)
      if (error) return json(500, { ok: false, error: error.message })
      const log = (await getSetting('early_grads', {})) || {}
      log[tid] = { ...(log[tid] || {}), [week === 'A' ? 'week_a_at' : 'week_b_at']: now, by: admin }
      await putSetting('early_grads', log)
      return json(200, { ok: true, name: `${g.first_name || ''} ${g.last_name || ''}`.trim() })
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
      const nowIds = room.kind === 'company' ? await traineeIdsNow() : room.kind === 'training' ? await trainingIds(room.training_week || 'A') : new Set()
      if (room.kind === 'training') q = nowIds.size ? q.in('id', [...nowIds]) : q.eq('id', '00000000-0000-0000-0000-000000000000')
      else if (room.kind === 'managers') q = q.not('managed_region', 'is', null)
      else if (room.kind === 'company' && nowIds.size) q = q.or(`is_active_sales_rep.eq.true,managed_region.not.is.null,id.in.(${[...nowIds].join(',')})`)
      else q = q.or('is_active_sales_rep.eq.true,managed_region.not.is.null')
      const { data } = await q
      let people = (data || []).filter((p) => p.registration_token && (p.rep_level !== 'non_field' || nowIds.has(p.id)))
      if (room.kind === 'zone') people = people.filter((p) => p.region === room.zone || p.managed_region === room.zone)
      if (room.kind === 'custom') people = []
      const eg = room.kind === 'training' ? ((await getSetting('early_grads', {})) || {}) : {}
      const rows = people.map((p) => ({ id: p.id, name: fullName(p), phone: p.phone, email: p.email, link: `${SITE}/meet/${room.slug}?t=${p.registration_token}`, host: isRoomHost(room, p), early_a: eg[p.id]?.week_a_at || null, early_b: eg[p.id]?.week_b_at || null, active_rep: !!p.is_active_sales_rep }))
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
    // Delete one recording: the file AND its row (Neal, 2026-10-04 — clearing out test runs).
    if (b.action === 'delete_recording') {
      const key = `meet_recordings_${room.slug}`
      const log = (await getSetting(key, [])) || []
      const x = log.find((r) => r.egress_id === b.egress_id)
      if (!x) return json(404, { ok: false, error: 'Already gone.' })
      if (x.file) await sb.storage.from('meeting-recordings').remove([x.file])
      await putSetting(key, log.filter((r) => r !== x))
      return json(200, { ok: true })
    }
    if (b.action === 'recordings') {
      const log = (await getSetting(`meet_recordings_${room.slug}`, [])) || []
      const out = []
      for (const x of log.slice(0, 60)) {
        let link = null
        if (x.ready && !x.deleted) { const { data } = await sb.storage.from('meeting-recordings').createSignedUrl(x.file, 3600, { download: true }); link = data?.signedUrl || null }
        out.push({ ...x, link })
      }
      return json(200, { ok: true, recordings: out })
    }
    if (b.action === 'email_log') return json(200, { ok: true, log: (await getSetting(`meet_email_log_${room.slug}`, [])) || [] })
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

  // VIRTUAL TRAINING SIGN-IN (Neal, 2026-10-04 — Week A goes virtual): a trainee without a link
  // types first + last name + email. We find them in this room's class (email first, then name),
  // then carry on exactly like their own link (attendance + onboarding gate below).
  const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z]/g, '')
  const findTrainee = async () => {
    const ids = [...(await trainingIds(room.training_week || 'A'))]
    if (!ids.length) return null
    const { data } = await sb.from('trainees').select('id, first_name, last_name, email, registration_token').in('id', ids)
    const email = String(b.email || '').trim().toLowerCase(), first = norm(b.first), last = norm(b.last)
    const byEmail = (data || []).find((t) => email && String(t.email || '').trim().toLowerCase() === email)
    if (byEmail) { byEmail._emailMatch = true; return byEmail }
    return (data || []).find((t) => first && last && norm(t.first_name) === first && norm(t.last_name) === last)
      || (data || []).find((t) => last && norm(t.last_name) === last && first && norm(t.first_name).startsWith(first.slice(0, 3)))
      || null
  }
  if ((b.action === 'checkin' || b.action === 'onboarding_resend') && room.kind === 'training') {
    if (!String(b.first || '').trim() || !String(b.last || '').trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.email || '').trim())) return json(400, { ok: false, error: 'Please enter your first name, last name and email.' })
    const t = await findTrainee()
    if (!t) return json(200, { ok: false, error: "We couldn't find you on this week's class list. Use the name and email you registered with, or text your trainer." })
    if (!t.email) await sb.from('trainees').update({ email: String(b.email).trim().toLowerCase() }).eq('id', t.id)
    if (b.action === 'onboarding_resend') {
      await sb.from('trainees').update({ onboarding_sms_sent_at: null }).eq('id', t.id)
      const r = await fetch(`${SITE}/.netlify/functions/send-onboarding-sms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trainee_id: t.id }) }).then((x) => x.json()).catch(() => ({}))
      return json(200, { ok: !!r.ok, sent: !!r.sent, error: r.ok ? null : (r.error || 'Could not send') })
    }
    b.action = 'join'; b.t = t.registration_token; b.pin = undefined
    // Their own paperwork opens right here only when the email they typed is the one on file
    // (or they came from their own link) — a name alone isn't enough to open someone's W-9.
    b._direct = !!t._emailMatch || !t.email
  }

  // What the door shows before anyone signs in (title, badge, whether outside guests can come in).
  if (b.action === 'info') return json(200, { ok: true, room: { ...publicRoom(room), training_week: room.training_week || null, ...(await openState(room)) }, host_code: !!room.host_code })

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
      if (t) {
        name = fullName(t) || 'Guest'; identity = `t:${t.id}`; host = isRoomHost(room, t)
        // TRAINING ROOMS: joining = signing in for the day (the virtual kiosk), and nobody gets in
        // until their onboarding paperwork is signed — it's sent to them right here (text + email).
        if (room.kind === 'training' && !host) {
          // MISSED A DAY = OUT (Neal, 2026-10-04): if the class met on its last day before today
          // (someone in the class signed in) and this trainee didn't, their link stops working.
          // Their own week_b_force flag (the existing admin override) lets them back in.
          const { data: me } = await sb.from('trainees').select('class_id, enrolled, dropped_out_at, declined_at, week_b_force').eq('id', t.id).maybeSingle()
          const outMsg = "We wish you the best, but attendance is important for success. You didn't show up yesterday. So good luck in your future endeavors."
          if (me && (me.enrolled === false || me.dropped_out_at || me.declined_at) && !me.week_b_force) return json(200, { ok: false, removed: true, message: outMsg })
          if (me?.class_id && !me.week_b_force) {
            const { data: last } = await sb.from('attendance').select('attendance_date').eq('class_id', me.class_id).lt('attendance_date', etDay()).order('attendance_date', { ascending: false }).limit(1)
            const lastDay = last?.[0]?.attendance_date
            if (lastDay) {
              const { data: mine } = await sb.from('attendance').select('id').eq('trainee_id', t.id).eq('attendance_date', lastDay).limit(1)
              if (!mine?.length) return json(200, { ok: false, removed: true, message: outMsg })
            }
          }
          const { data: ob } = await sb.from('trainee_onboarding').select('signed_at, banking_completed_at').eq('trainee_id', t.id).maybeSingle()
          // BANKING (Neal, 2026-10-04): okay to skip on the day they sign; from the NEXT day on,
          // no training until their direct deposit details are in.
          if (ob?.signed_at && !ob.banking_completed_at && etDay(Date.parse(ob.signed_at)) < etDay()) {
            const ok2 = b._direct !== false
            if (!ok2) await fetch(`${SITE}/.netlify/functions/send-onboarding-sms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trainee_id: t.id }) }).catch(() => {})
            return json(200, { ok: false, onboarding: true, banking: true, first: t.first_name || '', onboarding_url: ok2 ? `/onboarding/${String(b.t).trim()}?back=${encodeURIComponent(`/meet/${room.slug}?t=${String(b.t).trim()}`)}` : null })
          }
          if (!ob?.signed_at) {
            // Signed in with their own link or a matching email → open the paperwork right here
            // (Neal, 2026-10-04: "they're signing in anyways"). Otherwise send it by text + email.
            const direct = b._direct !== false && (b._direct === true || !!String(b.t || '').trim())
            if (direct) {
              return json(200, { ok: false, onboarding: true, first: t.first_name || '', onboarding_url: `/onboarding/${String(b.t).trim()}?back=${encodeURIComponent(`/meet/${room.slug}?t=${String(b.t).trim()}`)}` })
            }
            await fetch(`${SITE}/.netlify/functions/send-onboarding-sms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trainee_id: t.id }) }).catch(() => {})
            return json(200, { ok: false, onboarding: true, first: t.first_name || '' })
          }
        }
      }
    }
    if (!identity) return json(401, { ok: false, error: b.pin ? 'PIN not recognised.' : 'Open the meeting from your own link.' })
    // Not a host and no meeting on: say when the next one is instead of an empty room.
    if (!host) { const st = await openState(room); if (!st.open) return json(200, { ok: false, not_open: true, room: publicRoom(room) }) }
    // Training room, class in session: this join IS today's sign-in (same row the kiosk writes).
    if (room.kind === 'training' && !host && identity.startsWith('t:')) {
      const { data: tr } = await sb.from('trainees').select('class_id').eq('id', identity.slice(2)).maybeSingle()
      if (tr?.class_id) await sb.from('attendance').upsert({ trainee_id: identity.slice(2), class_id: tr.class_id, attendance_date: etDay(), confirmed: true, confirmed_at: new Date().toISOString() }, { onConflict: 'trainee_id,attendance_date' })
    }
    const at = new AccessToken(key, secret, { identity, name, ttl: '6h', metadata: JSON.stringify({ host }) })
    at.addGrant({ room: room.slug, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true, roomAdmin: host })
    // Open the room with its top line already set, so the first person in sees it.
    try { await svc().createRoom({ name: room.slug, emptyTimeout: 600, metadata: JSON.stringify({ topic: room.topic || '' }) }) } catch { /* already open */ }
    return json(200, { ok: true, url, token: await at.toJwt(), name, host, title: room.title, room: publicRoom(room) })
  }

  // PRACTICE IN THE MEETING: a seat for the AI homeowner (its own tile), run from the trainer's
  // browser. Admin PIN only — the Sales Training Customer spends Gemini money and is trainer-only.
  if (b.action === 'homeowner_token') {
    if (!(await verifyPin(b.pin))) return json(401, { ok: false, error: 'Trainer PIN required.' })
    const nm = `${String(b.name || 'Homeowner').slice(0, 40)} (homeowner)`
    const at = new AccessToken(key, secret, { identity: `homeowner:${Math.random().toString(36).slice(2, 8)}`, name: nm, ttl: '3h', metadata: JSON.stringify({ homeowner: true }) })
    at.addGrant({ room: room.slug, roomJoin: true, canPublish: true, canSubscribe: false, canPublishData: false })
    return json(200, { ok: true, url, token: await at.toJwt() })
  }

  // The room's live metadata (topic, recording, spotlight) — merged, so one change never wipes another.
  const setMeta = async (patch) => {
    let cur = {}
    try { const [lr] = await svc().listRooms([room.slug]); cur = JSON.parse(lr?.metadata || '{}') } catch { /* not open */ }
    const next = { ...cur, ...patch }
    await svc().updateRoomMetadata(room.slug, JSON.stringify(next))
    return next
  }

  // Host actions: an admin PIN, or the link of a room host (the zone's manager, a named host).
  let hostOk = !!(await verifyPin(b.pin)) || !!(room.host_code && sameCode(b.host_code, room.host_code))
  if (!hostOk) { const t = await traineeByToken(b.t); hostOk = !!(t && isRoomHost(room, t)) }
  if (!hostOk) return json(401, { ok: false, error: 'Only the host can do that.' })
  try {
    // 📖 Scripture on screen: { ref, version, verses:[{n,text}], idx, mode, showing, by } or null.
    if (b.action === 'set_scripture') {
      const sc = b.scripture && Array.isArray(b.scripture.verses) ? {
        ref: String(b.scripture.ref || '').slice(0, 80), version: String(b.scripture.version || 'NIV').slice(0, 8),
        verses: b.scripture.verses.slice(0, 180).map((x) => ({ n: Number.isFinite(Number(x.n)) && x.n !== null ? Number(x.n) : null, text: String(x.text || '').slice(0, 900) })),
        idx: Math.max(0, Number(b.scripture.idx) || 0), mode: b.scripture.mode === 'all' ? 'all' : 'verse', showing: !!b.scripture.showing, by: String(b.identity || '').slice(0, 80),
      } : null
      await setMeta({ scripture: sc })
      return json(200, { ok: true })
    }
    // 🎙 PODCAST MODE: put people on stage (identities, max 4) or clear it ([]). Everyone NOT on
    // stage is muted when the stage is set; the page unmutes the people on it.
    if (b.action === 'set_stage') {
      const stage = (Array.isArray(b.stage) ? b.stage : []).map(String).slice(0, 4)
      if (stage.length) {
        const list = await svc().listParticipants(room.slug)
        for (const p of list) if (!stage.includes(p.identity) && !/^(egress|homeowner)/.test(p.identity)) { try { for (const tr of p.tracks || []) if (tr.type === TrackType.AUDIO && !tr.muted) await svc().mutePublishedTrack(room.slug, p.identity, tr.sid, true) } catch { /* left */ } }
      }
      await setMeta({ stage })
      return json(200, { ok: true, stage })
    }
    if (b.action === 'set_topic') {
      const topic = String(b.topic || '').slice(0, 200)
      if (room.slug !== 'trial') { const rooms = await loadRooms(); const r = rooms.find((x) => x.slug === room.slug); if (r) { r.topic = topic; await putSetting('meet_rooms', rooms) } }
      try { await setMeta({ topic }) } catch { /* nobody in yet — saved for next time */ }
      return json(200, { ok: true, topic })
    }
    const muteMic = async (p) => {
      for (const tr of p.tracks || []) if (tr.type === TrackType.AUDIO && !tr.muted) await svc().mutePublishedTrack(room.slug, p.identity, tr.sid, true)
    }
    // ⏺ RECORD (Neal, 2026-10-04 — the 9:15 Devotional, which DeWayne's cousin edits): mute everyone
    // but the hosts (they can unmute themselves), put EVERYONE in speaker view on the host who
    // pressed it, show ● REC, and record the room as an MP4 into our storage (Supabase,
    // bucket meeting-recordings). Storage needs REC_S3_ACCESS_KEY / REC_S3_SECRET (Supabase →
    // Storage → S3 access keys) + REC_S3_REGION; without them it still mutes and switches views.
    if (b.action === 'record_start' || b.action === 'record_stop') {
      if (!room.recording_enabled) return json(400, { ok: false, error: 'Recording is not turned on for this room.' })
      const egress = new EgressClient(url.replace(/^wss:/, 'https:'), key, secret)
      const activeKey = `meet_rec_active_${room.slug}`
      if (b.action === 'record_stop') {
        const act = await getSetting(activeKey, null)
        for (const id of act?.egress_ids || []) { try { await egress.stopEgress(id) } catch { /* already stopped */ } }
        await putSetting(activeKey, null)
        try { await setMeta({ recording: false }) } catch { /* room closed */ }
        // The file lands a minute or two later; meet-webhook (egress_ended) emails the link.
        return json(200, { ok: true, recording: false })
      }
      const list = await svc().listParticipants(room.slug)
      const meta = (p) => { try { return JSON.parse(p.metadata || '{}') } catch { return {} } }
      let mutedN = 0
      for (const p of list) if (!meta(p).host && !/^(egress|homeowner)/.test(p.identity)) { try { await muteMic(p); mutedN++ } catch { /* left */ } }
      let saved = false, note = ''
      const { REC_S3_ACCESS_KEY: ak, REC_S3_SECRET: sk, REC_S3_REGION: region } = process.env
      if (ak && sk) {
        const day = etDay(), stamp = new Date().toLocaleTimeString('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' }).replace(':', '')
        const out = (name) => new EncodedFileOutput({ filepath: `${room.slug}/${day}-${stamp}-${name}.mp4`, output: { case: 's3', value: new S3Upload({ accessKey: ak.trim(), secret: sk.trim(), region: (region || 'us-east-1').trim(), endpoint: process.env.REC_S3_ENDPOINT || `${String(process.env.SUPABASE_URL).replace('.supabase.co', '.storage.supabase.co')}/storage/v1/s3`, bucket: 'meeting-recordings', forcePathStyle: true }) } })
        const kind = room.rec_kind || 'combined', ids = [], log = (await getSetting(`meet_recordings_${room.slug}`, [])) || []
        try {
          // Combined: the meeting as viewers see it (speaker layout). Raw: the host's own camera +
          // mic as a clean file for editing.
          if (kind !== 'raw') { const i = await egress.startRoomCompositeEgress(room.slug, out('meeting'), { layout: 'speaker', customBaseUrl: `${SITE}/recorder/${room.slug}` }); ids.push(i.egressId); log.unshift({ egress_id: i.egressId, kind: 'combined', file: `${room.slug}/${day}-${stamp}-meeting.mp4`, started: new Date().toISOString() }) }
          if (kind !== 'combined' && b.identity) { const i = await egress.startParticipantEgress(room.slug, String(b.identity), { file: out('host-camera') }); ids.push(i.egressId); log.unshift({ egress_id: i.egressId, kind: 'raw', file: `${room.slug}/${day}-${stamp}-host-camera.mp4`, started: new Date().toISOString() }) }
          await putSetting(activeKey, { egress_ids: ids, started: new Date().toISOString() })
          await putSetting(`meet_recordings_${room.slug}`, log.slice(0, 300))
          saved = ids.length > 0
        } catch (e) { note = `Recording didn't start: ${e.message}`; for (const id of ids) { try { await egress.stopEgress(id) } catch { /* ignore */ } } }
      } else note = 'Muted and switched everyone to speaker view. Saving the video needs storage set up (ask Neal).'
      await setMeta({ recording: saved, spotlight: String(b.identity || '') })
      const mutedLine = mutedN ? `Muted ${mutedN} ${mutedN === 1 ? 'person' : 'people'}.` : 'Nobody else to mute.'
      return json(200, { ok: true, recording: saved, note: saved ? `⏺ Recording. ${mutedLine}` : `${mutedLine} ${note}`.trim() })
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
