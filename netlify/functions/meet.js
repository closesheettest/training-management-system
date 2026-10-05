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
import { AccessToken, RoomServiceClient, TrackType, TrackSource, EgressClient, EncodedFileOutput, S3Upload } from 'livekit-server-sdk'
import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { sendSmsViaGhl } from './_ghl.js'
import { sendEmail } from './_email.js'
import { doorsFor, weekAFieldDays, EFFORT_DOORS, addDays } from './_effort.js'
import { recipientsForEvent } from './_recipients.js'

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
  // Every company room carries the U.S. Shingle & Metal logo (Neal, 2026-10-05); a team room its
  // team badge; the devotional (public, outside guests) its own banner.
  badge: r.zone ? `/team-badges/zone${String(r.zone).replace(/\D/g, '')}.png` : (r.kind === 'prayer' || r.public) ? null : '/uss-logo.png', color: r.zone ? COLORS[r.zone] || null : null,
  topic: r.topic || '', schedule: r.schedule || '', cameras_required: !!r.cameras_required, public: !!r.public,
  recording_enabled: !!r.recording_enabled,
  mic_lock: !!r.mic_lock,
  auto_stage: !!r.auto_stage,
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
// ⏰ 5-MINUTE REMINDER (Neal, 2026-10-04: "five minutes before the meeting, it sends everybody a
// text message with the link"). Rooms with remind_5 on and an invite list (custom / one-time): each
// invited person gets a text AND an email with their own link. Run by cron-meet-reminders every
// 5 minutes; each meeting is reminded once (app_settings meet_remind_<room>_<start>).
// RETRAINING DAY BY DAY (Neal, 2026-10-05): each evening a picked rep gets just the NEXT session
// and that night's homework. Day 1 = slides 1–5, day 2 = the rest (6–23), day 3+ = the whole
// presentation. room.plan can override: [{ from, to, section }].
const RETRAIN_PLAN = [{ from: 1, to: 5, section: 'slides_1_5' }, { from: 6, to: 23, section: 'slides_6_23' }, { from: 1, to: 23, section: 'full' }]
const planFor = (room, k) => (Array.isArray(room.plan) && room.plan[k]) || RETRAIN_PLAN[Math.min(k, RETRAIN_PLAN.length - 1)]
const retrainSessions = (room) => (room.once || []).filter(Boolean).map((o) => { const st = etWall(o.slice(0, 10), o.slice(11, 16)); return { start: st, end: new Date(st.getTime() + Math.max(10, Number(room.minutes) || 60) * 60000) } }).sort((a, c) => a.start - c.start)
const fmtSession = (x) => {
  const f = (d, o) => d.toLocaleString('en-US', { timeZone: 'America/New_York', ...o })
  return `${f(x.start, { weekday: 'long', month: 'short', day: 'numeric' })}, ${f(x.start, { hour: 'numeric', minute: '2-digit' }).replace(':00', '')}–${f(x.end, { hour: 'numeric', minute: '2-digit' }).replace(':00', '')}`
}
// Make one rep's homework for session k (a practice-test row; its token is their page link) and
// text + email them the page. Shared by the manager's pick and the nightly job.
async function sendRetrainDay(sb, room, p, k, byName) {
  const ses = retrainSessions(room)[k]
  if (!ses) return { name: `${p.first_name || ''} ${p.last_name || ''}`.trim(), sms: false, email: false }
  const plan = planFor(room, k)
  const name = `${p.first_name || ''} ${p.last_name || ''}`.trim(), fn = p.first_name || 'there', email = p.company_email || p.email || ''
  const ptok = crypto.randomBytes(18).toString('base64url')
  await sb.from('sales_practice_sessions').insert({ trainee_id: p.id, trainee_name: name, trainer_name: byName || null, persona_key: 'ready', section: plan.section, grade_status: 'invited', transcript: [],
    report: { retrain: room.slug, day: k, invite: { token: ptok, expires_at: ses.start.toISOString(), phone: p.phone || null, email: email || null, sent_by: byName || null } } })
  const lead = k === 0 && byName ? `${String(byName).split(' ')[0]} signed you up for ${room.title}. ` : ''
  const msg = `Hi ${fn}, ${lead}Your next ${room.title} session: ${fmtSession(ses)} (Eastern). Tap here for your link and tonight's homework: ${SITE}/prep/${ptok}`
  const r = { name, sms: false, email: false }
  if (p.phone) { try { const x = await sendSmsViaGhl(p.phone, msg, { firstName: fn, lastName: p.last_name || '' }); r.sms = !!(x && x.ok !== false) } catch { /* shown */ } }
  if (email) { try { const x = await sendEmail(email, `${room.title}: ${fmtSession(ses)}`, msg); r.email = !!(x && x.ok !== false) } catch { /* shown */ } }
  return r
}
// CCG rep_date_blocks for a picked rep's retraining hours (see retrain_nominate).
async function blockRetrainHours(room, traineeIds) {
  const CU = process.env.CCG_SUPABASE_URL, CK = process.env.CCG_SUPABASE_SECRET_KEY
  if (!CU || !CK || !traineeIds.length) return
  const H = { apikey: CK, Authorization: `Bearer ${CK}`, 'Content-Type': 'application/json' }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const { data: ts } = await sb.from('trainees').select('jobnimbus_id').in('id', traineeIds)
  const jn = (ts || []).map((x) => x.jobnimbus_id).filter(Boolean)
  if (!jn.length) return
  const reps = await (await fetch(`${CU}/rest/v1/sales_reps?jobnimbus_id=in.(${jn.map((x) => `"${x}"`).join(',')})&select=id`, { headers: H })).json().catch(() => [])
  const slots = []
  for (const x of retrainSessions(room)) {
    const day = etDay(x.start.getTime())
    const hm = (d) => { const [h, m] = d.toLocaleTimeString('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' }).split(':').map(Number); return h * 60 + m }
    for (let m = Math.floor(hm(x.start) / 60) * 60 - 60; m < hm(x.end); m += 60) slots.push({ date: day, start_min: m })
  }
  for (const r of reps || []) {
    const have = await (await fetch(`${CU}/rest/v1/rep_date_blocks?rep_id=eq.${r.id}&select=date,start_min`, { headers: H })).json().catch(() => [])
    const got = new Set((have || []).map((b) => `${b.date}:${b.start_min}`))
    const rows = slots.filter((x) => !got.has(`${x.date}:${x.start_min}`)).map((x) => ({ rep_id: r.id, ...x }))
    if (rows.length) await fetch(`${CU}/rest/v1/rep_date_blocks`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(rows) })
  }
}

// Nightly (7 PM ET): everyone picked for a retraining whose NEXT session is tomorrow gets that
// day's page — unless they already have it (e.g. picked today).
export async function runRetrainHomework() {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const { data } = await sb.from('app_settings').select('value').eq('key', 'meet_rooms').maybeSingle()
  let rooms = []; try { rooms = JSON.parse(data?.value || '[]') } catch { rooms = [] }
  const tomorrow = etDay(Date.now() + 864e5), out = []
  for (const room of rooms.filter((r) => r.kind === 'retraining')) {
    const k = retrainSessions(room).findIndex((x) => etDay(x.start.getTime()) === tomorrow)
    const ids = (room.invitees || []).filter((x) => x.id).map((x) => x.id)
    if (k < 0 || !ids.length) continue
    const { data: have } = await sb.from('sales_practice_sessions').select('trainee_id, report').in('trainee_id', ids)
    const done = new Set((have || []).filter((x) => x.report?.retrain === room.slug && Number(x.report?.day ?? 0) === k).map((x) => x.trainee_id))
    const { data: ppl } = await sb.from('trainees').select('id, first_name, last_name, phone, email, company_email').in('id', ids.filter((id) => !done.has(id)))
    for (const p of ppl || []) out.push(await sendRetrainDay(sb, room, p, k, null))
  }
  return out
}

// A room's people with their own links, as "Send links" sees them (used by the reminder job).
export async function audienceFor(slug) {
  INTERNAL = true
  try { const res = await handler({ httpMethod: 'POST', body: JSON.stringify({ action: 'audience', slug }) }); return JSON.parse(res.body).people || [] } finally { INTERNAL = false }
}

export async function runMeetReminders() {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const get = async (k) => { const { data } = await sb.from('app_settings').select('value').eq('key', k).maybeSingle(); try { return data ? JSON.parse(data.value) : null } catch { return null } }
  const rooms = (await get('meet_rooms')) || [], sent = []
  for (const room of rooms) {
    if (!room.remind_5) continue
    const nm = nextMeeting(room)
    if (!nm) continue
    const mins = (nm.start.getTime() - Date.now()) / 60000
    if (mins <= 0 || mins > 7) continue
    const key = `meet_remind_${room.slug}_${nm.start.toISOString()}`
    if (await get(key)) continue
    await sb.from('app_settings').upsert({ key, value: JSON.stringify({ at: new Date().toISOString() }), updated_at: new Date().toISOString() }, { onConflict: 'key' })
    // Everyone the room is for, with their own link — the same list "Send links" uses.
    const rows = await audienceFor(room.slug)
    const at = nm.start.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
    const seen = new Set()
    for (const r of rows) {
      const ph = String(r.phone || '').replace(/\D/g, '').slice(-10)
      if (ph && seen.has(ph)) continue
      if (ph) seen.add(ph)
      const first = String(r.name || 'there').split(' ')[0]
      const msg = `⏰ ${first}, ${room.title} starts in 5 minutes (${at} Eastern). Join here: ${r.link}`
      if (r.phone) await sendSmsViaGhl(r.phone, msg, { firstName: first, lastName: String(r.name || '').split(' ').slice(1).join(' ') }).catch(() => {})
      if (r.email) await sendEmail(r.email, `Starting in 5 minutes: ${room.title}`, msg).catch(() => {})
      sent.push(`${room.slug}:${first}`)
    }
  }
  return sent
}

// "ALSO INCLUDE" (Neal, 2026-10-04): Neal and DeWayne can be ticked onto ANY room — they then get
// its invites/links and reminders, see it on Your meetings, and host it. Their TMS records:
const LEADERS = [
  { key: 'neal', name: 'Neal', id: '78c97338-b102-4d7c-92d2-5829cb241536' },
  { key: 'dewayne', name: 'DeWayne', id: 'd1770dd6-bea9-419e-a6a1-98bbe5bfae03' },
]
// Rooms whose people are an invite list (picked by hand, or by managers for retraining).
const INVITE_KINDS = ['oneoff', 'custom', 'retraining']
const alsoIds = (room) => LEADERS.filter((l) => (room.also || []).includes(l.key)).map((l) => l.id)
// The reminder job asks this same file for a room's people (no PIN in a scheduled job).
let INTERNAL = false

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
  const isRoomHost = (room, t) => !!(room.zone && t.managed_region === room.zone) || alsoIds(room).includes(t.id) || (room.hosts || []).some((h) => h.toLowerCase() === fullName(t).toLowerCase())

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

  // CLASS PAGE → WEEK B STATUS (Neal, 2026-10-04: "when I click on Week B … that's where I need it,
  // so I know what's going on"). Per trainee of the class: was the Week B link sent / opened, their
  // Week A field-day average, turned away or in, 🔥 committed, and doors so far this week.
  if (b.action === 'class_week_b') {
    const { data: c } = await sb.from('classes').select('id, week_start_date, trainees!class_id(id, first_name, last_name, phone, enrolled, dropped_out_at, declined_at, week_b_force, confirmation_status)').eq('id', String(b.class_id || '')).maybeSingle()
    if (!c) return json(404, { ok: false })
    const prob = (await getSetting('week_b_probation', {})) || {}
    const { data: audits } = await sb.from('app_settings').select('key, value').like('key', 'invite_audit_%')
    const sentAt = {}
    for (const a of audits || []) { let v = {}; try { v = JSON.parse(a.value) } catch { continue } if (!/week b/i.test(v.title || '')) continue; for (const [id, x] of Object.entries(v.sends || {})) if (x.sms || x.email_ok) sentAt[id] = x.at }
    const wkB = (await loadRooms()).find((r) => r.kind === 'training' && r.training_week === 'B')
    const { data: last } = await sb.from('attendance').select('attendance_date').eq('class_id', c.id).lt('attendance_date', addDays(c.week_start_date, 7)).order('attendance_date', { ascending: false }).limit(1)
    const lastDay = last?.[0]?.attendance_date || null
    const people = []
    for (const t of c.trainees || []) {
      if (t.enrolled === false || t.dropped_out_at || t.declined_at) continue
      let missed = false
      if (lastDay && !t.week_b_force) { const { data: m } = await sb.from('attendance').select('id').eq('trainee_id', t.id).eq('attendance_date', lastDay).limit(1); missed = !m?.length }
      const e = await doorsFor(t, weekAFieldDays(c.week_start_date))
      const pr = prob[t.id] || null
      let soFar = null
      if (pr?.committed_at && !pr.result) { const days = [0, 1, 2, 3, 4].map((k) => addDays(pr.week_monday, k)).filter((d) => d <= etDay()); if (days.length) soFar = (await doorsFor(t, days)).average }
      people.push({ name: fullName(t), missed_last_day: missed, override: !!t.week_b_force, week_a_avg: e.average, week_a_perDay: e.perDay, william_days: e.rideDays, map: e.linked,
        qualified: !missed && (t.week_b_force || e.average === null || e.average >= EFFORT_DOORS), link_sent: sentAt[t.id] || null, opened: pr?.seen_at || null, committed: pr?.committed_at || null, declined: pr?.declined_at || null, so_far: soFar, result: pr?.result || null })
    }
    return json(200, { ok: true, last_class_day: lastDay, needed: EFFORT_DOORS, room: wkB ? { slug: wkB.slug, title: wkB.title, effort_gate: !!wkB.effort_gate } : null, people })
  }

  // ROOM LIST for the "My meeting rooms" launcher (My Tools): names, looks, live / next only —
  // no personal links or codes, so it needs no sign-in. Hosts join with their PIN in the room.
  if (b.action === 'room_list') {
    const list = await loadRooms()
    const states = await Promise.all(list.map((r) => openState(r)))
    return json(200, { ok: true, rooms: list.map((r, i) => ({ ...publicRoom(r), ...states[i], badge: publicRoom(r).badge ? `${SITE}${publicRoom(r).badge}` : null, link: `${SITE}/meet/${r.slug}` })) })
  }

  // ---- A REP'S OWN ROOMS (their dashboard) ----
  // 📋 A RETRAINING REP'S OWN PAGE (/prep/<token>, Neal 2026-10-05: "one link … on that page it
  // lists everything"). The token is their practice-test token: schedule, join link, homework.
  if (b.action === 'retrain_page') {
    const tok = String(b.token || '').trim()
    if (tok.length < 20) return json(404, { ok: false, error: 'This link is not valid.' })
    const { data: row } = await sb.from('sales_practice_sessions').select('id, trainee_id, grade_status, report').filter('report->invite->>token', 'eq', tok).maybeSingle()
    if (!row?.report?.retrain) return json(404, { ok: false, error: 'This link is not valid.' })
    const room = (await loadRooms()).find((r) => r.slug === row.report.retrain)
    if (!room) return json(404, { ok: false, error: 'This retraining is no longer on the schedule.' })
    const { data: t } = await sb.from('trainees').select('first_name, registration_token').eq('id', row.trainee_id).maybeSingle()
    if (!row.report.opened_at) { const rep = { ...row.report, opened_at: new Date().toISOString() }; await sb.from('sales_practice_sessions').update({ report: rep }).eq('id', row.id) }
    const k = Number(row.report.day ?? 0), all = retrainSessions(room), ses = all[k] ? [all[k]] : all.slice(0, 1)
    const plan = planFor(room, k), tgt = room.joins_room || room.slug
    return json(200, { ok: true, first: t?.first_name || '', title: room.title, topic: room.topic || '', day: k + 1, days: all.length,
      sessions: ses.map((x) => ({ start: x.start.toISOString(), end: x.end.toISOString() })), from: plan.from, to: plan.to,
      join: t?.registration_token ? `${SITE}/meet/${tgt}?t=${t.registration_token}` : `${SITE}/meet/${tgt}`,
      slides: `${SITE}/homework/slides?from=${plan.from}&to=${plan.to}`, script: `${SITE}/sales-pitch/sales-script.pdf`, practice: `${SITE}/practice/${tok}`,
      practice_done: row.grade_status !== 'invited', practice_expires: row.report.invite?.expires_at || null })
  }

  // 🚫 IN CLASS = NO DOORDISPATCHER (Neal, 2026-10-05: "during those times they're supposed to be in
  // class, door dispatcher will not work for them"). The map asks with the rep's JobNimbus id; from
  // 15 minutes before a retraining session they were picked for until it ends, it's locked.
  if (b.action === 'class_lock') {
    const jn = String(b.jnid || '').trim()
    if (!jn) return json(200, { ok: true, locked: false })
    const { data: ts } = await sb.from('trainees').select('id, registration_token').eq('jobnimbus_id', jn)
    const ids = new Set((ts || []).map((x) => x.id))
    if (!ids.size) return json(200, { ok: true, locked: false })
    const now = Date.now()
    for (const r of (await loadRooms()).filter((x) => x.kind === 'retraining')) {
      const me = (r.invitees || []).find((x) => x.id && ids.has(x.id))
      if (!me) continue
      const ses = retrainSessions(r).find((x) => now >= x.start.getTime() - 15 * 60000 && now < x.end.getTime())
      if (!ses) continue
      const t = (ts || []).find((x) => x.id === me.id), tgt = r.joins_room || r.slug
      // FINISHED EARLY (Neal: "I close it at 11:30, then it just automatically activates their door
      // dispatcher"): once the host has been in today's session and no host is in the room any more,
      // class is over — unlocked.
      const hostin = await getSetting(`meet_hostin_${tgt}_${etDay()}`, null)
      if (hostin?.at && Date.parse(hostin.at) >= ses.start.getTime() - 60 * 60000) {
        let hostHere = false
        try { hostHere = (await svc().listParticipants(tgt)).some((p) => { try { return !!JSON.parse(p.metadata || '{}').host } catch { return false } }) } catch { /* room closed */ }
        if (!hostHere) return json(200, { ok: true, locked: false, ended: true })
      }
      return json(200, { ok: true, locked: true, title: r.title, until: ses.end.toISOString(), join: t?.registration_token ? `${SITE}/meet/${tgt}?t=${t.registration_token}` : `${SITE}/meet/${tgt}` })
    }
    return json(200, { ok: true, locked: false })
  }

  // 📱 WAITING ON YOU (Neal, 2026-10-05): things we texted a rep that they haven't done — unsigned
  // pay documents, a retraining page not opened — for an alert on their dashboard, with a button to
  // re-send them all by text once they've texted START to our number (texts were blocked).
  if (b.action === 'rep_pending' || b.action === 'rep_resend') {
    const who = await fetch(REP_PIN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'whoami', session: String(b.session || '') }) }).then((r) => r.json()).catch(() => ({}))
    if (!who.ok || !who.jnid || who.viewer) return json(200, { ok: true, items: [] })
    const { data: ts } = await sb.from('trainees').select('id, first_name, last_name, phone, registration_token, is_active_sales_rep').eq('jobnimbus_id', who.jnid)
    const t = (ts || []).find((x) => x.is_active_sales_rep) || (ts || [])[0]
    if (!t) return json(200, { ok: true, items: [] })
    const ids = (ts || []).map((x) => x.id), items = []
    const { data: ob } = await sb.from('trainee_onboarding').select('comp_signed_at').in('trainee_id', ids)
    if (t.registration_token && !(ob || []).some((x) => x.comp_signed_at)) items.push({ key: 'pay', label: 'Sign your pay documents (Draw Program + Inspection Compensation Plan)', link: `${SITE}/comp-agreement/${t.registration_token}` })
    const { data: pr } = await sb.from('sales_practice_sessions').select('report, grade_status').in('trainee_id', ids).eq('grade_status', 'invited')
    for (const x of pr || []) {
      const inv = x.report?.invite
      if (!x.report?.retrain || x.report?.opened_at || !inv?.token || Date.parse(inv.expires_at) < Date.now()) continue
      items.push({ key: `prep-${inv.token.slice(0, 6)}`, label: 'Your retraining: tomorrow\'s link and homework', link: `${SITE}/prep/${inv.token}` })
    }
    const last4 = String(t.phone || '').replace(/\D/g, '').slice(-4)
    if (b.action === 'rep_pending') return json(200, { ok: true, items, last4 })
    if (!items.length) return json(200, { ok: true, sent: false, error: 'Nothing waiting.' })
    if (!t.phone) return json(200, { ok: false, error: "We don't have a cell number for you. Tell your manager." })
    const gate = `meet_resend_${t.id}`, prev = await getSetting(gate, null)
    if (prev && Date.now() - Date.parse(prev) < 60000) return json(200, { ok: false, last4, error: 'Just sent. Give it a minute.' })
    await putSetting(gate, new Date().toISOString())
    const msg = `${t.first_name || 'Hi'}, here's what's waiting for you:\n` + items.map((x, i) => `${i + 1}) ${x.label}: ${x.link}`).join('\n')
    const r = await sendSmsViaGhl(t.phone, msg, { firstName: t.first_name || '', lastName: t.last_name || '' }).catch((e) => ({ ok: false, error: e.message }))
    if (r?.ok) return json(200, { ok: true, sent: true, last4 })
    const blocked = /dnd|do not disturb|unsubscrib|opt/i.test(String(r?.error || ''))
    return json(200, { ok: false, last4, error: blocked ? 'Texts are still blocked. Text START to (727) 349-3584 from your phone, wait a moment, then tap again.' : 'The text didn\'t go out. Tell your manager.' })
  }

  if (b.action === 'my_rooms') {
    const who = await fetch(REP_PIN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'whoami', session: String(b.session || '') }) })
      .then((r) => r.json()).catch(() => ({}))
    if (!who.ok || !who.jnid) return json(401, { ok: false, error: 'Signed out' })
    const { data: t } = await sb.from('trainees').select('id, first_name, last_name, region, managed_region, registration_token, is_active_sales_rep, rep_level').eq('jobnimbus_id', who.jnid).maybeSingle()
    if (!t || !t.registration_token) return json(200, { ok: true, rooms: [] })
    const active = t.is_active_sales_rep === true && t.rep_level !== 'non_field'
    const mine = (await loadRooms()).filter((r) =>
      (INVITE_KINDS.includes(r.kind) && (r.invitees || []).some((x) => x.id === t.id) && (r.kind !== 'oneoff' || nextMeeting(r))) ||
      alsoIds(r).includes(t.id) ||
      (r.kind === 'zone' && (t.region === r.zone || t.managed_region === r.zone) && (active || t.managed_region)) ||
      (r.kind === 'managers' && t.managed_region) ||
      ((r.kind === 'everyone' || r.kind === 'prayer' || r.kind === 'company') && (active || t.managed_region)))
    const openOf = Object.fromEntries(await Promise.all(mine.map(async (r) => [r.slug, await openState(r)])))
    // COMPANY MEETING DAY (Neal, 2026-10-04): on a day with a company meeting, the rep's regular
    // meetings that day are greyed out ("Company Meeting today instead") and the company one
    // stands out. Only meetings still to come today count.
    const today = etDay()
    const dayOf = (r) => { const nm = hasSchedule(r) ? nextMeeting(r) : null; return nm ? etDay(nm.start.getTime()) : null }
    // Special meetings flash on their day (Neal, 2026-10-05: "none of them are flashing"): the
    // Managers Meeting, a company meeting, a one-off or invite meeting. Daily rooms don't.
    for (const r of mine) if (['managers', 'company', 'oneoff', 'custom', 'retraining'].includes(r.kind) && dayOf(r) === today) openOf[r.slug] = { ...openOf[r.slug], today: true }
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
        return { ...pr, ...openOf[r.slug], badge: pr.badge ? `${SITE}${pr.badge}` : null, host: isRoomHost(r, t), link: who.viewer ? null : `${SITE}/meet/${r.joins_room || r.slug}?t=${t.registration_token}` }
      }),
    })
  }

  // YOUR MEETINGS (Neal, 2026-10-04: "a button that says your meetings… the link for every meeting
  // he is part of"). Signed in with their admin PIN (the same one they host with): every room this
  // person belongs in — invited (custom / one-time), named as a host, or by their role (team,
  // managers, company, everyone, prayer). One-time meetings that are over drop off.
  // Every room one person belongs in (invited, named host, Also include, or by role), soonest first.
  const roomsForPerson = async (ts, name, linkFor) => {
    const ids = new Set((ts || []).map((x) => x.id))
    const t = (ts || []).find((x) => x.managed_region) || (ts || []).find((x) => x.is_active_sales_rep) || (ts || [])[0] || null
    const nm0 = String(name || '').trim().toLowerCase()
    const named = (r) => !!nm0 && (r.hosts || []).some((h) => String(h).trim().toLowerCase() === nm0)
    const mine = (await loadRooms()).filter((r) => {
      if (alsoIds(r).some((id) => ids.has(id))) return true
      if (INVITE_KINDS.includes(r.kind)) return (r.invitees || []).some((x) => (x.id && ids.has(x.id)) || (!x.id && nm0 && String(x.name || '').trim().toLowerCase() === nm0)) || named(r)
      if (named(r)) return true
      if (!t) return false
      const active = t.is_active_sales_rep === true && t.rep_level !== 'non_field'
      if (r.kind === 'zone') return (t.region === r.zone || t.managed_region === r.zone) && (active || !!t.managed_region)
      if (r.kind === 'managers') return !!t.managed_region
      if (['everyone', 'prayer', 'company'].includes(r.kind)) return active || !!t.managed_region
      return false
    }).filter((r) => (r.kind !== 'oneoff' && r.kind !== 'retraining') || nextMeeting(r))
    const today = etDay()
    const rows = await Promise.all(mine.map(async (r) => {
      const pr = publicRoom(r), st = await openState(r), nm = hasSchedule(r) ? nextMeeting(r) : null
      return { ...pr, ...st, next_at: nm ? nm.start.toISOString() : null, today: !!nm && etDay(nm.start.getTime()) === today, badge: pr.badge ? `${SITE}${pr.badge}` : null, link: linkFor({ ...r, slug: r.joins_room || r.slug }, t) }
    }))
    rows.sort((a, c) => (c.live - a.live) || ((a.next_at ? Date.parse(a.next_at) : 9e15) - (c.next_at ? Date.parse(c.next_at) : 9e15)))
    return rows
  }

  // YOUR MEETINGS (Neal, 2026-10-04): by admin PIN (/my-meetings, My Tools "Your meetings").
  if (b.action === 'mine_by_pin') {
    const name = await verifyPin(b.pin)
    if (!name) return json(401, { ok: false, error: 'Sign in again (PIN not recognised).' })
    const parts = String(name).trim().split(/\s+/)
    const { data: ts } = await sb.from('trainees').select('id, first_name, last_name, region, managed_region, registration_token, is_active_sales_rep, rep_level').ilike('first_name', parts[0]).ilike('last_name', parts[parts.length - 1])
    return json(200, { ok: true, name, rooms: await roomsForPerson(ts, name, (r) => `${SITE}/meet/${r.slug}`) })
  }
  // …and by a manager's dashboard token (TMS /regional-manager/<token>), with their OWN join link
  // so they come in as themselves (Neal, 2026-10-05: "show up on their personal dashboards").
  if (b.action === 'mine_by_mgr_token') {
    const tok = String(b.token || '').trim()
    if (!tok) return json(401, { ok: false })
    const { data: t } = await sb.from('trainees').select('id, first_name, last_name, region, managed_region, registration_token, is_active_sales_rep, rep_level').eq('manager_access_token', tok).maybeSingle()
    if (!t) return json(401, { ok: false })
    return json(200, { ok: true, rooms: await roomsForPerson([t], fullName(t), (r) => (t.registration_token ? `${SITE}/meet/${r.slug}?t=${t.registration_token}` : `${SITE}/meet/${r.slug}`)) })
  }

  // 📅 A MANAGER SETS UP A MEETING from their dashboard (Neal, 2026-10-05: "need to set up a
  // meeting with your team, or an individual on your team"). Their whole team or picked reps (only
  // people in their own zone), a date + time: a one-time meeting with them as host, the 5-minute
  // reminder on, and everyone (manager too) texted + emailed an invite to confirm.
  if (b.action === 'mgr_create_meeting') {
    const tok = String(b.token || '').trim()
    const { data: m } = tok ? await sb.from('trainees').select('id, first_name, last_name, managed_region').eq('manager_access_token', tok).maybeSingle() : { data: null }
    if (!m?.managed_region) return json(401, { ok: false, error: 'Open this from your own dashboard link.' })
    const { data: team } = await sb.from('trainees').select('id, rep_level').eq('region', m.managed_region).or('is_active_sales_rep.eq.true,is_field_trainee.eq.true')
    const teamIds = new Set((team || []).filter((x) => x.rep_level !== 'non_field').map((x) => x.id))
    const picked = b.whole ? [...teamIds] : (Array.isArray(b.ids) ? b.ids : []).map(String).filter((id) => teamIds.has(id))
    if (!picked.length) return json(400, { ok: false, error: 'Pick your team or at least one person.' })
    const when = String(b.when || '')
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(when) || etWall(when.slice(0, 10), when.slice(11, 16)).getTime() < Date.now() - 5 * 60000) return json(400, { ok: false, error: 'Pick a date and time that hasn\'t passed.' })
    const mName = fullName(m)
    const title = String(b.title || '').trim().slice(0, 80) || (b.whole ? `${TEAMS[m.managed_region] || 'Team'} meeting` : 'Meeting with ' + m.first_name)
    const room = { title, kind: 'oneoff', look: 'team', topic: String(b.topic || '').slice(0, 200), cameras_required: true, once: [when], minutes: Math.min(240, Math.max(10, Number(b.minutes) || 30)), invitees: [...new Set([...picked, m.id])].map((id) => ({ id })), hosts: [mName], remind_5: true, schedule: '' }
    INTERNAL = true
    try {
      const saved = JSON.parse((await handler({ httpMethod: 'POST', body: JSON.stringify({ action: 'save_room', room }) })).body)
      if (!saved.ok) return json(400, saved)
      const msg = `Hi {first}, ${m.first_name} set up a meeting: ${title}${room.topic ? ` (${room.topic})` : ''} on {when} (Eastern). Please confirm you'll be there: {link}`
      const sent = JSON.parse((await handler({ httpMethod: 'POST', body: JSON.stringify({ action: 'send_links', slug: saved.room.slug, message: msg, subject: `Meeting: ${title}` }) })).body)
      return json(200, { ok: true, slug: saved.room.slug, invited: picked.length, sent: (sent.sent || []).filter((x) => x.sms || x.email).length })
    } finally { INTERNAL = false }
  }

  // 🔁 RETRAINING (Neal, 2026-10-05; the same flow Week B trainees will go through). The office
  // sets up a 'retraining' room with its session dates; each regional manager picks which of their
  // reps need it (Today's work). Each picked rep is texted + emailed: their join link for every
  // session, and homework due before the first one — the full sales script and a practice test
  // (slides 1–5, the easy homeowner) on their own device. Managers see who's done the practice.
  const RETRAIN_SCRIPT = `${SITE}/sales-pitch/sales-script.pdf`
  const mgrByToken = async (tok) => {
    const { data: m } = String(tok || '').trim() ? await sb.from('trainees').select('id, first_name, last_name, managed_region').eq('manager_access_token', String(tok).trim()).maybeSingle() : { data: null }
    if (!m?.managed_region) return null
    const { data: team } = await sb.from('trainees').select('id, first_name, last_name, rep_level').eq('region', m.managed_region).eq('is_active_sales_rep', true).order('first_name')
    return { m, team: (team || []).filter((x) => x.rep_level !== 'non_field') }
  }
  const sessionsOf = (r) => (r.once || []).filter(Boolean).map((o) => ({ start: etWall(o.slice(0, 10), o.slice(11, 16)), mins: Math.max(10, Number(r.minutes) || 60) })).sort((a, c) => a.start - c.start)
  const sessionLine = (r) => sessionsOf(r).map((x) => {
    const f = (d, o) => d.toLocaleString('en-US', { timeZone: 'America/New_York', ...o })
    const end = new Date(x.start.getTime() + x.mins * 60000)
    return `${f(x.start, { weekday: 'short', month: 'short', day: 'numeric' })} ${f(x.start, { hour: 'numeric', minute: '2-digit' }).replace(':00', '')}–${f(end, { hour: 'numeric', minute: '2-digit' }).replace(':00', '')}`
  }).join(' · ')
  const practiceDone = async (ids, slug) => {
    if (!ids.length) return {}
    const { data } = await sb.from('sales_practice_sessions').select('trainee_id, grade_status, report').in('trainee_id', ids).eq('section', 'slides_1_5')
    const out = {}
    for (const x of data || []) if (x.report?.retrain === slug) out[x.trainee_id] = x.grade_status === 'invited' ? 'sent' : 'done'
    return out
  }
  if (b.action === 'retrain_open') {
    const who = await mgrByToken(b.token)
    if (!who) return json(401, { ok: false })
    // visible_from: managers don't see it before then (Neal, 2026-10-05: reveal it on the 8:30 call).
    // early_zones: those zones' managers see it before visible_from (Neal previewing as SitSold, 2026-10-05).
    const list = (await loadRooms()).filter((r) => r.kind === 'retraining' && nextMeeting(r) && (!r.visible_from || Date.parse(r.visible_from) <= Date.now() || (r.early_zones || []).includes(who.m.managed_region)))
    const out = []
    for (const r of list) {
      const mine = (r.invitees || []).filter((x) => x.id && who.team.some((t) => t.id === x.id))
      const pr = await practiceDone(mine.map((x) => x.id), r.slug)
      out.push({ slug: r.slug, title: r.title, sessions: sessionLine(r), first_at: sessionsOf(r)[0]?.start.toISOString() || null,
        team: who.team.map((t) => ({ id: t.id, name: fullName(t), picked: mine.some((x) => x.id === t.id), practice: pr[t.id] || null })) })
    }
    return json(200, { ok: true, rooms: out })
  }
  if (b.action === 'retrain_nominate') {
    const who = await mgrByToken(b.token)
    if (!who) return json(401, { ok: false, error: 'Open this from your own dashboard link.' })
    const rooms0 = await loadRooms()
    const room = rooms0.find((r) => r.slug === b.slug && r.kind === 'retraining')
    if (!room || !nextMeeting(room)) return json(404, { ok: false, error: 'That retraining is not open.' })
    const fresh = (Array.isArray(b.ids) ? b.ids : []).map(String).filter((id) => who.team.some((t) => t.id === id) && !(room.invitees || []).some((x) => x.id === id))
    if (!fresh.length) return json(400, { ok: false, error: 'Pick at least one rep who isn\'t signed up yet.' })
    const mName = fullName(who.m), at = new Date().toISOString()
    room.invitees = [...(room.invitees || []), ...fresh.map((id) => ({ id, by: mName, at }))]
    await putSetting('meet_rooms', rooms0)
    const { data: ppl } = await sb.from('trainees').select('id, first_name, last_name, phone, email, company_email, registration_token').in('id', fresh)
    // Their NEXT session (normally day 1) and its homework, right away.
    const k = Math.max(0, retrainSessions(room).findIndex((x) => x.start.getTime() > Date.now()))
    const results = []
    for (const p of ppl || []) results.push(await sendRetrainDay(sb, room, p, k, mName))
    // BLOCK THEIR SCHEDULE (Neal, 2026-10-05: "their schedule makes them not available, so nothing can
    // be booked for them"): CCG rep_date_blocks for the hour before each session through its end —
    // the setter portal, come-back booking, door cards and reassignments all honour these.
    await blockRetrainHours(room, (ppl || []).map((p) => p.id)).catch((e) => console.warn('retrain blocks', e.message))
    return json(200, { ok: true, added: results.length, sent: results })
  }

  // ---- ADMIN: rooms ----
  if (['rooms', 'save_room', 'delete_room', 'reorder', 'people_search', 'audience', 'send_links', 'attendance', 'guests', 'email_log', 'recordings', 'delete_recording', 'early_grad'].includes(b.action)) {
    const admin = INTERNAL ? 'reminder job' : await verifyPin(b.pin)
    if (!admin) return json(401, { ok: false, error: 'Sign in again (PIN not recognised).' })
    const rooms = await loadRooms()
    if (b.action === 'rooms') {
      // One-off meetings: RSVP counts for the card.
      const { data: rs } = await sb.from('app_settings').select('key, value').like('key', 'meet_rsvp_%')
      const tally = {}
      for (const x of rs || []) { const r = rooms.find((rm) => x.key.startsWith(`meet_rsvp_${rm.slug}_`)); if (!r) continue; let v = {}; try { v = JSON.parse(x.value) } catch { /* skip */ } const tt = (tally[r.slug] = tally[r.slug] || { yes: 0, no: 0 }); if (v.status === 'yes') tt.yes++; else if (v.status === 'no') tt.no++ }
      return json(200, { ok: true, rooms: rooms.map((r) => ({ ...r, ...publicRoom(r), ...(r.kind === 'oneoff' ? { rsvp: { ...(tally[r.slug] || { yes: 0, no: 0 }), invited: (r.invitees || []).length } } : {}) })), site: SITE })
    }
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
      const kind = ['zone', 'managers', 'company', 'training', 'prayer', 'everyone', 'custom', 'oneoff', 'retraining'].includes(r.kind) ? r.kind : 'custom'
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
        effort_gate: !!r.effort_gate,
        remind_5: !!r.remind_5,
        mic_lock: !!r.mic_lock,
        joins_room: kind === 'retraining' ? String(r.joins_room || '').slice(0, 60) : '',
        early_zones: (rooms.find((x) => x.slug === r.original_slug) || {}).early_zones || [],
        visible_from: r.visible_from || (rooms.find((x) => x.slug === r.original_slug) || {}).visible_from || null,
        auto_stage: !!r.auto_stage,
        also: (Array.isArray(r.also) ? r.also : []).filter((k) => LEADERS.some((l) => l.key === k)),
        // ONE-OFF MEETING (Neal, 2026-10-04): invite certain people — TMS people by id, anyone else by
        // name + phone + email (they get their own key). Each must confirm they'll be there.
        invitees: INVITE_KINDS.includes(kind) ? (Array.isArray(r.invitees) ? r.invitees : []).slice(0, 200).map((x) => (x && x.id
          ? { id: String(x.id), ...(x.by ? { by: String(x.by).slice(0, 60), at: String(x.at || '') } : {}) }
          : { key: String(x?.key || crypto.randomBytes(6).toString('base64url')), name: String(x?.name || '').trim().slice(0, 60), phone: String(x?.phone || '').trim().slice(0, 20), email: String(x?.email || '').trim().toLowerCase().slice(0, 120) })).filter((x) => x.id || x.name) : [], // Week B: needs an average of 30 doors/day on Week A Thu–Sat
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
    // Everyone you can invite to a one-off meeting: TMS people who are active reps, managers, staff
    // or in a class running now.
    if (b.action === 'people_search') {
      const now = await traineeIdsNow()
      const { data } = await sb.from('trainees').select('id, first_name, last_name, region, managed_region, is_active_sales_rep, rep_level, registration_token').or(`is_active_sales_rep.eq.true,managed_region.not.is.null${now.size ? `,id.in.(${[...now].join(',')})` : ''}`)
      return json(200, { ok: true, people: (data || []).filter((p) => p.registration_token).map((p) => ({ id: p.id, name: fullName(p), tag: p.managed_region ? `Manager · ${TEAMS[p.managed_region] || p.managed_region}` : now.has(p.id) && !p.is_active_sales_rep ? 'Trainee' : p.rep_level === 'non_field' ? 'Office' : (TEAMS[p.region] || p.region || 'Rep') })).sort((a, c) => a.name.localeCompare(c.name)) })
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
      // A Custom room has an invite list too (Neal, 2026-10-04: the 8 AM meeting with DeWayne).
      const invited = INVITE_KINDS.includes(room.kind)
      const invIds = invited ? (room.invitees || []).filter((x) => x.id).map((x) => x.id) : []
      if (invited) q = invIds.length ? q.in('id', invIds) : q.eq('id', '00000000-0000-0000-0000-000000000000')
      const nowIds = room.kind === 'company' ? await traineeIdsNow() : room.kind === 'training' ? await trainingIds(room.training_week || 'A') : new Set()
      if (room.kind === 'training') q = nowIds.size ? q.in('id', [...nowIds]) : q.eq('id', '00000000-0000-0000-0000-000000000000')
      else if (invited) { /* the invite list, set above */ }
      else if (room.kind === 'managers') q = q.not('managed_region', 'is', null)
      else if (room.kind === 'company' && nowIds.size) q = q.or(`is_active_sales_rep.eq.true,managed_region.not.is.null,id.in.(${[...nowIds].join(',')})`)
      else q = q.or('is_active_sales_rep.eq.true,managed_region.not.is.null')
      const { data } = await q
      let people = (data || []).filter((p) => p.registration_token && (invited || p.rep_level !== 'non_field' || nowIds.has(p.id)))
      if (room.kind === 'zone') people = people.filter((p) => p.region === room.zone || p.managed_region === room.zone)
      // Neal / DeWayne ticked "Also include" on this room.
      const extra = alsoIds(room).filter((id) => !people.some((p) => p.id === id))
      if (extra.length) { const { data: lx } = await sb.from('trainees').select('id, first_name, last_name, phone, email, region, managed_region, registration_token, rep_level, is_active_sales_rep').in('id', extra); people = people.concat((lx || []).filter((p) => p.registration_token)) }
      const eg = room.kind === 'training' ? ((await getSetting('early_grads', {})) || {}) : {}
      const rows = people.map((p) => ({ id: p.id, name: fullName(p), phone: p.phone, email: p.email, link: `${SITE}/meet/${room.joins_room || room.slug}?t=${p.registration_token}`, host: isRoomHost(room, p), early_a: eg[p.id]?.week_a_at || null, early_b: eg[p.id]?.week_b_at || null, active_rep: !!p.is_active_sales_rep }))
        .sort((a, c) => a.name.localeCompare(c.name))
      // People outside TMS on the invite list, each with their own key.
      if (invited) for (const x of (room.invitees || []).filter((y) => y.key)) rows.push({ id: `x:${x.key}`, name: x.name, phone: x.phone, email: x.email, link: `${SITE}/meet/${room.slug}?g=${x.key}`, host: false })
      if (room.kind === 'oneoff') {
        // Everyone's RSVP.
        const { data: rs } = await sb.from('app_settings').select('key, value').like('key', `meet_rsvp_${room.slug}_%`)
        const rsvp = Object.fromEntries((rs || []).map((x) => { try { return [x.key.slice(`meet_rsvp_${room.slug}_`.length), JSON.parse(x.value)] } catch { return [x.key, null] } }))
        for (const r of rows) r.rsvp = rsvp[r.id] || null
      }
      if (b.action === 'audience' && room.kind === 'training' && room.training_week === 'B') {
        // Each trainee's Week A field-day average, so the office can see who qualifies.
        const { data: info } = await sb.from('trainees').select('id, first_name, last_name, phone, week_b_force, classes(week_start_date)').in('id', rows.map((r) => r.id))
        const byId = new Map((info || []).map((x) => [x.id, x]))
        const prob = (await getSetting('week_b_probation', {})) || {}
        for (const r of rows) if (prob[r.id]) r.probation = { committed_at: prob[r.id].committed_at || null, result: prob[r.id].result || null, week_avg: prob[r.id].week_avg ?? null, seen_at: prob[r.id].seen_at || null, week_monday: prob[r.id].week_monday }
        // This week so far (Mon → today, William days left out), for anyone on the second chance.
        await Promise.all(rows.filter((r) => r.probation && !r.probation.result).map(async (r) => {
          const x = byId.get(r.id); if (!x) return
          const days = [0, 1, 2, 3, 4].map((k) => addDays(r.probation.week_monday, k)).filter((d) => d <= etDay())
          if (!days.length) return
          const e = await doorsFor(x, days); r.probation.so_far = e.average; r.probation.so_far_days = e.counted; r.probation.so_far_perDay = e.perDay
        }))
        await Promise.all(rows.map(async (r) => { const x = byId.get(r.id); if (!x?.classes?.week_start_date) return; const e = await doorsFor(x, weekAFieldDays(x.classes.week_start_date)); r.effort = { average: e.average, perDay: e.perDay, rideDays: e.rideDays, linked: e.linked, override: !!x.week_b_force } }))
      }
      if (b.action === 'audience') return json(200, { ok: true, people: rows, effort_needed: EFFORT_DOORS })
      // Every message goes by text AND email (texts alone miss people on Do Not Disturb).
      const results = []
      for (const p of rows) {
        const first = p.name.split(' ')[0] || 'there'
        // A custom message from the Send box ({first} and {link} filled in per person), or the default.
        const when = room.kind === 'oneoff' && (room.once || [])[0] ? new Date(etWall(room.once[0].slice(0, 10), room.once[0].slice(11, 16))).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
        if (room.kind === 'oneoff' && !String(b.message || '').trim()) b.message = `Hi {first}, you're invited to ${room.title} on ${when} (Eastern). Please confirm you'll be there: {link}`
        const msg = String(b.message || '').trim()
          ? String(b.message).slice(0, 1200).replace(/\{when\}/g, when).replace(/\{first\}/g, first).replace(/\{link\}/g, p.link) + (String(b.message).includes('{link}') ? '' : `\n\n${p.link}`)
          : `Hi ${first}, here is your link for ${room.title}${room.schedule ? ` (${room.schedule})` : ''}. It's yours only, so keep it and use it every time: ${p.link}${b.note ? `\n\n${String(b.note).slice(0, 300)}` : ''}`
        const r = { name: p.name, sms: false, email: false }
        if (p.phone) { try { const x = await sendSmsViaGhl(p.phone, msg, { firstName: first, lastName: p.name.split(' ').slice(1).join(' ') }); r.sms = !!(x && x.ok !== false) } catch { /* shown as not sent */ } }
        if (p.email) { try { const x = await sendEmail(p.email, String(b.subject || '').trim() || `Your link: ${room.title}`, msg); r.email = !!(x && x.ok !== false) } catch { /* shown as not sent */ } }
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

  // 🔥 "I still want it, and I'll prove it" (Neal, 2026-10-04): the trainee turned away from Week B
  // commits to the second chance. Recorded with the time; the Saturday job only enrolls people who
  // committed (no click = they're gone).
  // "No, training isn't for me" on the Week B decision screen (Neal, 2026-10-04: make the choice
  // super clear — two answers, not one button and silence).
  if (b.action === 'effort_decline') {
    let t = String(b.t || '').trim() ? await traineeByToken(b.t) : null
    if (!t && room.kind === 'training' && b.first) t = await findTrainee()
    if (!t) return json(401, { ok: false, error: 'Open this from your own link.' })
    const prob = (await getSetting('week_b_probation', {})) || {}
    if (!prob[t.id]) return json(404, { ok: false, error: 'Nothing to answer.' })
    if (!prob[t.id].committed_at) { prob[t.id].declined_at = prob[t.id].declined_at || new Date().toISOString(); await putSetting('week_b_probation', prob) }
    return json(200, { ok: true, declined_at: prob[t.id].declined_at || null })
  }

  if (b.action === 'effort_commit') {
    let t = String(b.t || '').trim() ? await traineeByToken(b.t) : null
    if (!t && room.kind === 'training' && b.first) t = await findTrainee()
    if (!t) return json(401, { ok: false, error: 'Open this from your own link.' })
    const prob = (await getSetting('week_b_probation', {})) || {}
    if (!prob[t.id]) return json(404, { ok: false, error: 'Nothing to commit to.' })
    const first = !prob[t.id].committed_at
    prob[t.id].committed_at = prob[t.id].committed_at || new Date().toISOString()
    await putSetting('week_b_probation', prob)
    // Tell the office right away (Notifications → "Trainee committed to prove it"), the first click only.
    if (first) {
      const { recipients } = await recipientsForEvent(sb, 'week_b_commit', { legacyRole: 'admin' }).catch(() => ({ recipients: [] }))
      const nm = fullName(t), avg = prob[t.id].week_a_avg
      const msg = `🔥 ${nm} clicked "I still want Week B and I'll prove it." Week A average: ${avg ?? '?'} doors/day. Goal: 30 a day Mon–Fri this week; Saturday they're auto-enrolled if they make it.`
      for (const r of recipients || []) {
        if (r.phone && r.notify_via_sms !== false) { try { await sendSmsViaGhl(r.phone, msg, { firstName: (r.name || 'Office').split(' ')[0], lastName: 'Notify' }) } catch { /* next */ } }
        if (r.email && r.notify_via_email !== false) { try { await sendEmail(r.email, `🔥 ${nm} committed to prove it (Week B)`, msg) } catch { /* next */ } }
      }
    }
    return json(200, { ok: true, committed_at: prob[t.id].committed_at })
  }

  // 📱 "TEXT ME MY LINK" (Neal, 2026-10-05: some people only ever get the email — usually they once
  // replied STOP, or their carrier blocks us). The join screen tells them to text START to our
  // number, then tap this: we text their own link to the phone on file and say what happened.
  if (b.action === 'text_me') {
    let person = null, link = null
    if (String(b.t || '').trim()) {
      const t = await traineeByToken(b.t)
      if (t) { person = { first: t.first_name || 'there', last: t.last_name || '', phone: t.phone }; link = `${SITE}/meet/${room.slug}?t=${String(b.t).trim()}` }
    } else if (b.g && (room.invitees || []).some((x) => x.key === String(b.g))) {
      const x = room.invitees.find((y) => y.key === String(b.g)); person = { first: (x.name || 'there').split(' ')[0], last: '', phone: x.phone }; link = `${SITE}/meet/${room.slug}?g=${x.key}`
    }
    if (!person) return json(401, { ok: false, error: 'Open this from your own link.' })
    const digits = String(person.phone || '').replace(/\D/g, '')
    if (digits.length < 10) return json(200, { ok: false, error: "We don't have a cell number for you. Tell your manager the right one." })
    const last4 = digits.slice(-4)
    const gate = `meet_textme_${digits.slice(-10)}`
    const prev = await getSetting(gate, null)
    if (prev && Date.now() - Date.parse(prev) < 60000) return json(200, { ok: false, last4, error: 'Just sent one. Give it a minute, then try again.' })
    await putSetting(gate, new Date().toISOString())
    const r = await sendSmsViaGhl(person.phone, `✅ ${person.first}, texts from U.S. Shingle & Metal are working again. Your link for ${room.title}: ${link}`, { firstName: person.first, lastName: person.last }).catch((e) => ({ ok: false, error: e.message }))
    if (r?.ok) return json(200, { ok: true, last4 })
    const blocked = /dnd|do not disturb|unsubscrib|opt/i.test(String(r?.error || ''))
    return json(200, { ok: false, last4, error: blocked ? 'Texts are still blocked. From your phone, text START to (727) 349-3584, wait a moment, then tap again.' : `The text didn't go out (${String(r?.error || 'unknown').slice(0, 80)}). Tell your manager.` })
  }

  // CLASS CONFIRMATION from the trainee's own link (?confirm=1) — the same confirmation the class
  // page shows (trainees.confirmation_status), and it marks the invite as opened if it was tracked.
  if (b.action === 'class_confirm' && room.kind === 'training') {
    const t = await traineeByToken(b.t)
    if (!t) return json(401, { ok: false, error: 'Open this from your own link.' })
    if (b.status === 'yes' || b.status === 'no') await sb.from('trainees').update({ confirmation_status: b.status === 'yes' ? 'confirmed' : 'declined', confirmation_at: new Date().toISOString() }).eq('id', t.id)
    if (b.tag) await fetch(`${SITE}/.netlify/functions/invite-audit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'open', token: String(b.t), tag: String(b.tag) }) }).catch(() => {})
    const { data: c } = await sb.from('trainees').select('confirmation_status, confirmation_at').eq('id', t.id).maybeSingle()
    return json(200, { ok: true, first: t.first_name || '', status: c?.confirmation_status || null, room: publicRoom(room), next_at: hasSchedule(room) ? nextMeeting(room)?.start?.toISOString() || null : null })
  }

  // RSVP for a one-off meeting: ✅ I'll be there / ❌ Can't make it, from their own link.
  const outsiderOf = (key) => (room.invitees || []).find((x) => x.key && x.key === String(key || ''))
  if (b.action === 'rsvp' && room.kind === 'oneoff') {
    let who = null
    if (String(b.t || '').trim()) { const t = await traineeByToken(b.t); if (t && (room.invitees || []).some((x) => x.id === t.id)) who = { id: t.id, name: fullName(t) } }
    else if (b.g) { const x = outsiderOf(b.g); if (x) who = { id: `x:${x.key}`, name: x.name } }
    if (!who) return json(401, { ok: false, error: "This invite link isn't valid." })
    const status = b.status === 'no' ? 'no' : 'yes'
    await putSetting(`meet_rsvp_${room.slug}_${who.id}`, { status, at: new Date().toISOString(), name: who.name })
    return json(200, { ok: true, status })
  }
  if (b.action === 'rsvp_status' && room.kind === 'oneoff') {
    let id = null, first = ''
    if (String(b.t || '').trim()) { const t = await traineeByToken(b.t); if (t) { id = t.id; first = t.first_name || '' } } else if (b.g) { const x = outsiderOf(b.g); if (x) { id = `x:${x.key}`; first = x.name.split(' ')[0] } }
    if (!id) return json(200, { ok: false })
    return json(200, { ok: true, first, rsvp: await getSetting(`meet_rsvp_${room.slug}_${id}`, null), room: publicRoom(room) })
  }

  // What the door shows before anyone signs in (title, badge, whether outside guests can come in).
  if (b.action === 'info') return json(200, { ok: true, room: { ...publicRoom(room), training_week: room.training_week || null, ...(await openState(room)) }, host_code: !!room.host_code })

  if (b.action === 'join') {
    let name = null, identity = null, host = false, isRetrainee = false
    const admin = await verifyPin(b.pin)
    // Each device gets its own seat — the same identity twice would kick the first device out.
    const seat = () => Math.random().toString(36).slice(2, 7)
    if (admin) { name = admin; identity = `host:${admin}:${seat()}`; host = true }
    // The trainer's first arrival today starts the 2-minute door (training rooms).
    if (admin && room.kind === 'training' && !(await getSetting(`meet_hostin_${room.slug}_${etDay()}`, null))) await putSetting(`meet_hostin_${room.slug}_${etDay()}`, { at: new Date().toISOString(), by: admin })
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
    } else if (INVITE_KINDS.includes(room.kind) && b.g && outsiderOf(b.g)) {
      const x = outsiderOf(b.g); name = x.name || 'Guest'; identity = `x:${x.key}`
    } else {
      const t = await traineeByToken(b.t)
      if (t) {
        name = fullName(t) || 'Guest'; identity = `t:${t.id}`; host = isRoomHost(room, t)
        // TRAINING ROOMS: joining = signing in for the day (the virtual kiosk), and nobody gets in
        // until their onboarding paperwork is signed — it's sent to them right here (text + email).
        // RETRAINING (Neal, 2026-10-05): reps a manager picked for a retraining that "joins" this
        // room come in alongside the trainees — none of the trainee-only checks apply to them.
        const retrainee = room.kind === 'training' && (await loadRooms()).some((r) => r.kind === 'retraining' && r.joins_room === room.slug && (r.invitees || []).some((x) => x.id === t.id))
        isRetrainee = retrainee
        if (room.kind === 'training' && !host && !retrainee) {
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
          // SHOW THE EFFORT (Neal, 2026-10-04): Week B only for trainees who averaged 30 doors a day on
          // DoorDispatcher over Week A's field days (Thu–Sat). Short of it → a second chance: average
          // 30 a day Mon–Fri this week and the Saturday job enrolls them in next week's Week B.
          if (room.effort_gate && room.training_week === 'B' && me?.class_id && !me.week_b_force) {
            const { data: cl } = await sb.from('classes').select('week_start_date').eq('id', me.class_id).maybeSingle()
            const { data: full } = await sb.from('trainees').select('id, first_name, last_name, phone').eq('id', t.id).maybeSingle()
            if (cl?.week_start_date && full) {
              const eff = await doorsFor(full, weekAFieldDays(cl.week_start_date))
              if (eff.average !== null && eff.average < EFFORT_DOORS) {
                const dow = new Date(`${etDay()}T12:00:00Z`).getUTCDay(), monday = addDays(etDay(), dow === 0 ? 1 : 1 - dow)
                const prob = (await getSetting('week_b_probation', {})) || {}
                if (!prob[t.id]) { prob[t.id] = { week_monday: monday, from_class: me.class_id, week_a_avg: eff.average, at: new Date().toISOString() }; await putSetting('week_b_probation', prob) }
                const pr = prob[t.id]
                if (!pr.seen_at || Date.now() - Date.parse(pr.last_seen || 0) > 600000) { pr.seen_at = pr.seen_at || new Date().toISOString(); pr.last_seen = new Date().toISOString(); await putSetting('week_b_probation', prob) }
                const sofar = await doorsFor(full, [0, 1, 2, 3, 4].map((k) => addDays(pr.week_monday, k)).filter((d) => d <= etDay()))
                return json(200, { ok: false, effort: true, average: eff.average, needed: EFFORT_DOORS, week_monday: pr.week_monday, so_far: sofar.average, so_far_days: Object.keys(sofar.perDay).length, linked: eff.linked, committed: !!pr.committed_at, declined: !!pr.declined_at && !pr.committed_at })
              }
            }
          }
          // LATE = LOCKED OUT (Neal, 2026-10-04): once the trainer is in, the doors stay open 2 more
          // minutes, then close for anyone not already in today (someone who was in and dropped can
          // always get back). Week A Day 1 → "call Brent to reschedule"; any other day → being on time.
          const lock = await getSetting(`meet_hostin_${room.slug}_${etDay()}`, null)
          // The clock starts at whichever is LATER — the trainer arriving or the scheduled start — so
          // a trainer who logs on early doesn't shut people out before class even begins.
          const sched = hasSchedule(room) ? nextMeeting(room) : null
          const lockBase = lock?.at ? Math.max(Date.parse(lock.at), sched && sched.start.getTime() <= Date.now() + 864e5 && etDay(sched.start.getTime()) === etDay() ? sched.start.getTime() : 0) : null
          if (lockBase && Date.now() > lockBase + 120000) {
            const { data: inToday } = await sb.from('attendance').select('id').eq('trainee_id', t.id).eq('attendance_date', etDay()).limit(1)
            if (!inToday?.length) {
              const { data: cl } = await sb.from('classes').select('week_start_date').eq('id', me?.class_id || '').maybeSingle()
              const day1A = (room.training_week || 'A') !== 'B' && cl?.week_start_date === etDay()
              if (day1A) {
                const { data: hm } = await sb.from('notification_recipients').select('name, phone').eq('active', true).eq('role', 'hiring_manager').order('created_at', { ascending: true }).limit(1).maybeSingle()
                const who = (hm?.name || 'Brent').split(' ')[0]
                return json(200, { ok: false, locked: true, day1: true, title: 'Training has already started', message: `Training has already started. You will have to call ${who} to reschedule.`, phone: hm?.phone || process.env.HIRING_MANAGER_PHONE || '' })
              }
              return json(200, { ok: false, locked: true, title: 'Training has already started', message: 'Being on time is part of being a professional. Training started without you today, and the doors are now closed. We wish you the best in your future endeavors.' })
            }
          }
          const { data: ob } = await sb.from('trainee_onboarding').select('signed_at, banking_completed_at, comp_signed_at').eq('trainee_id', t.id).maybeSingle()
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
          // PAY DOCUMENTS (Neal, 2026-10-05: onboarding = ICA + W-9 + the draw and inspection
          // commission). Signed the first two but not these → straight to them, then back in.
          if (ob?.signed_at && !ob.comp_signed_at && String(b.t || '').trim()) {
            return json(200, { ok: false, onboarding: true, first: t.first_name || '', onboarding_url: `/comp-agreement/${String(b.t).trim()}?back=${encodeURIComponent(`/meet/${room.slug}?t=${String(b.t).trim()}`)}` })
          }
        }
      }
    }
    if (!identity) return json(401, { ok: false, error: b.pin ? 'PIN not recognised.' : 'Open the meeting from your own link.' })
    // Not a host and no meeting on: say when the next one is instead of an empty room.
    if (!host) { const st = await openState(room); if (!st.open) return json(200, { ok: false, not_open: true, room: publicRoom(room) }) }
    // Training room, class in session: this join IS today's sign-in (same row the kiosk writes).
    if (room.kind === 'training' && !host && !isRetrainee && identity.startsWith('t:')) {
      const { data: tr } = await sb.from('trainees').select('class_id, is_field_trainee, is_active_sales_rep, classes(week_start_date)').eq('id', identity.slice(2)).maybeSingle()
      if (tr?.class_id) await sb.from('attendance').upsert({ trainee_id: identity.slice(2), class_id: tr.class_id, attendance_date: etDay(), confirmed: true, confirmed_at: new Date().toISOString() }, { onConflict: 'trainee_id,attendance_date' })
      // Same as the kiosk: signing in from the class's 2nd day on makes them a field trainee, so
      // their regional manager sees them (Kiosk.jsx signIn). Only ever turns it ON.
      const ws = tr?.classes?.week_start_date
      const dayIdx = ws ? Math.floor((Date.parse(`${etDay()}T12:00:00Z`) - Date.parse(`${ws}T12:00:00Z`)) / 864e5) : -1
      if (dayIdx >= 1 && dayIdx <= 6 && tr.is_field_trainee !== true && tr.is_active_sales_rep !== true) await sb.from('trainees').update({ is_field_trainee: true }).eq('id', identity.slice(2))
      // DAY 2 = SET-UP DAY (Neal, 2026-10-05): the first sign-in on day 2 tells IT to create the company
      // emails right away (then HR / the VA do JobNimbus + GoHighLevel). The notifier fires once per
      // class, so every day-2 join can safely knock.
      if (dayIdx === 1 && process.env.CRON_SECRET) await fetch(`${SITE}/.netlify/functions/notify-day-2-provision?secret=${encodeURIComponent(process.env.CRON_SECRET)}`).catch(() => {})
    }
    const at = new AccessToken(key, secret, { identity, name, ttl: '6h', metadata: JSON.stringify({ host }) })
    // 🔇 LOCKED MICS (Neal, 2026-10-05: "when people show up for training their microphones are
    // muted and they cannot unmute. I am the only one that can unmute"). Non-hosts may publish
    // their camera only; the host's Unmute grants the mic (allow_mic) and Mute takes it back.
    const micLocked = !!room.mic_lock && !host
    at.addGrant({ room: room.slug, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true, roomAdmin: host, ...(micLocked ? { canPublishSources: [TrackSource.CAMERA] } : {}) })
    // Open the room with its top line already set, so the first person in sees it.
    try { await svc().createRoom({ name: room.slug, emptyTimeout: 600, metadata: JSON.stringify({ topic: room.topic || '' }) }) } catch { /* already open */ }
    return json(200, { ok: true, url, token: await at.toJwt(), name, host, mic_locked: micLocked, title: room.title, room: publicRoom(room) })
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
    // 🎭 PRACTICE ON STAGE (Neal, 2026-10-04): { showing, presenter, presenterName, homeowner, section,
    // page } — everyone sees the practice slide full screen with the presenter as a circle. With
    // mute:true, everyone except the presenter (and the AI homeowner) is muted.
    if (b.action === 'set_practice') {
      const pr = b.practice && typeof b.practice === 'object' ? { showing: !!b.practice.showing, presenter: String(b.practice.presenter || '').slice(0, 80), presenterName: String(b.practice.presenterName || '').slice(0, 60), homeowner: String(b.practice.homeowner || '').slice(0, 60), section: String(b.practice.section || '').slice(0, 40), door: !!b.practice.door, page: Number(b.practice.page) || 0 } : null
      if (b.mute && pr?.presenter) {
        const list = await svc().listParticipants(room.slug)
        for (const p of list) if (p.identity !== pr.presenter && !/^(homeowner|egress)/.test(p.identity)) { try { for (const tr of p.tracks || []) if (tr.type === TrackType.AUDIO && !tr.muted) await svc().mutePublishedTrack(room.slug, p.identity, tr.sid, true) } catch { /* left */ } }
      }
      await setMeta({ practice: pr })
      return json(200, { ok: true })
    }
    // 📊 PRESENT: { key, pos:{h,v,f}|{n}, showing, by } or null — the trainer's deck and where it is.
    if (b.action === 'set_deck') {
      const dk = b.deck && typeof b.deck.key === 'string' ? { key: b.deck.key.slice(0, 20), pos: b.deck.pos && typeof b.deck.pos === 'object' ? { h: Number(b.deck.pos.h) || 0, v: Number(b.deck.pos.v) || 0, f: Number.isFinite(Number(b.deck.pos.f)) ? Number(b.deck.pos.f) : -1, n: Number(b.deck.pos.n) || 0 } : null, showing: !!b.deck.showing, by: String(b.identity || '').slice(0, 80) } : null
      await setMeta({ deck: dk })
      return json(200, { ok: true })
    }
    // 🎙 PODCAST MODE: put people on stage (identities, max 4) or clear it ([]). Everyone NOT on
    // stage is muted when the stage is set; the page unmutes the people on it.
    if (b.action === 'set_stage') {
      const stage = (Array.isArray(b.stage) ? b.stage : []).map(String).slice(0, 4)
      // no_mute: the automatic podcast view (hosts side by side) features the hosts without
      // muting anyone else (Neal, 2026-10-04 — managers can still speak up).
      if (stage.length && !b.no_mute) {
        const list = await svc().listParticipants(room.slug)
        for (const p of list) if (!stage.includes(p.identity) && !/^(egress|homeowner)/.test(p.identity)) { try { for (const tr of p.tracks || []) if (tr.type === TrackType.AUDIO && !tr.muted) await svc().mutePublishedTrack(room.slug, p.identity, tr.sid, true) } catch { /* left */ } }
      }
      await setMeta({ stage, ...(b.auto_off !== undefined ? { auto_off: !!b.auto_off } : {}) })
      return json(200, { ok: true, stage })
    }
    // How the presenter's camera sits beside slides / scripture (Neal, 2026-10-05): circle (small, in
    // the corner) | split (half and half) | stack_top (you on top) | stack_bottom (you underneath).
    if (b.action === 'set_layout') {
      const layout = ['circle', 'split', 'stack_top', 'stack_bottom'].includes(b.layout) ? b.layout : 'circle'
      await setMeta({ layout })
      return json(200, { ok: true, layout })
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
    // Locked-mic rooms: give someone (or everyone) their mic, or take it back.
    const micPerm = (on) => ({ canSubscribe: true, canPublish: true, canPublishData: true, canPublishSources: on ? [TrackSource.CAMERA, TrackSource.MICROPHONE] : [TrackSource.CAMERA] })
    const isHostP = (p) => { try { return !!JSON.parse(p.metadata || '{}').host } catch { return false } }
    if (b.action === 'allow_mic' || b.action === 'lock_mic') {
      const on = b.action === 'allow_mic'
      const list = (await svc().listParticipants(room.slug)).filter((p) => !isHostP(p) && !/^(egress|homeowner)/.test(p.identity) && (b.all || (Array.isArray(b.identities) ? b.identities : [b.identity]).includes(p.identity)))
      for (const p of list) { try { if (!on) await muteMic(p); await svc().updateParticipant(room.slug, p.identity, undefined, micPerm(on)) } catch { /* left */ } }
      return json(200, { ok: true, n: list.length })
    }
    if (b.action === 'mute' || b.action === 'remove') {
      const identity = String(b.identity || '')
      if (!identity) return json(400, { ok: false, error: 'Who?' })
      if (b.action === 'remove') await svc().removeParticipant(room.slug, identity)
      else { const p = await svc().getParticipant(room.slug, identity); await muteMic(p); if (room.mic_lock && !isHostP(p)) await svc().updateParticipant(room.slug, identity, undefined, micPerm(false)).catch(() => {}) }
      return json(200, { ok: true })
    }
    if (b.action === 'mute_all') {
      const list = await svc().listParticipants(room.slug)
      const meta = (p) => { try { return JSON.parse(p.metadata || '{}') } catch { return {} } }
      for (const p of list) if (!meta(p).host) { await muteMic(p); if (room.mic_lock) await svc().updateParticipant(room.slug, p.identity, undefined, micPerm(false)).catch(() => {}) }
      return json(200, { ok: true, muted: list.length })
    }
  } catch (e) {
    return json(502, { ok: false, error: e.message || 'LiveKit error' })
  }
  return json(400, { ok: false, error: 'unknown action' })
}
