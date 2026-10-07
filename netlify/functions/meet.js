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
import { sendSmsViaGhl, getSmsStatus, ghlHeaders } from './_ghl.js'
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
// The "when" line people see on the link, written from the room's own schedule (Neal, 2026-10-05:
// Nikki typed "Tues 10am" AND set the schedule — "why have it twice"). Weekly: "Tue 10 AM" or
// "Mon–Thu 9:30 AM"; dated: "Tue Oct 6, 10 AM". Nothing scheduled → '' (keeps any old typed line).
const DAYN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const hm12 = (t) => { const [h, m] = String(t).split(':').map(Number); return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}` }
const scheduleText = (r) => {
  const slots = (Array.isArray(r.slots) ? r.slots : []).filter((x) => x && /^\d{2}:\d{2}$/.test(x.time || ''))
  if (slots.length) {
    const byTime = {}
    for (const x of slots) (byTime[x.time] = byTime[x.time] || []).push(Number(x.day))
    return Object.entries(byTime).sort().map(([t, ds]) => {
      ds = [...new Set(ds)].sort((a, c) => a - c)
      const run = ds.length > 2 && ds.every((d, i) => i === 0 || d === ds[i - 1] + 1)
      return `${run ? `${DAYN[ds[0]]}–${DAYN[ds[ds.length - 1]]}` : ds.map((d) => DAYN[d]).join(', ')} ${hm12(t)}`
    }).join(' · ')
  }
  const once = (Array.isArray(r.once) ? r.once : []).filter((o) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(o)).sort()
  if (once.length) return once.slice(0, 4).map((o) => `${new Date(`${o.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })}, ${hm12(o.slice(11, 16))}`).join(' · ') + (once.length > 4 ? ' …' : '')
  return ''
}
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
  rec_where: r.rec_where === 'host' ? 'host' : 'cloud',
  rec_kind: ['combined', 'raw', 'both'].includes(r.rec_kind) ? r.rec_kind : 'combined',
  rec_name: r.rec_name || '',
  mic_lock: !!r.mic_lock,
  no_host: !!r.no_host,
  // Which week a training room is for — the 📊 Present list only offers that week's decks (Neal,
  // 2026-10-06: "week B is a different meeting room… shouldn't be having week B presentations in week A").
  training_week: r.kind === 'training' ? (r.training_week || 'A') : null,
  auto_stage: !!r.auto_stage,
  // 👤 HOST (Neal, 2026-10-05: "an area where we can say who the host is… the 9:15 devotional,
  // DeWayne is always the host"). Shown on every card, dashboard and the join screen.
  host_names: Array.isArray(r.host_names) ? r.host_names : [],
  call: !!r.call, // 📞 Call rooms get the phone 'Click me' link preview
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
// Day 2 = slides 6–21: the rest of the presentation WITHOUT the close (22–23 = payment options / the
// investment close sheet), plus the whole deck 1–21 again to run through (Neal, 2026-10-06).
const RETRAIN_PLAN = [{ from: 1, to: 5, section: 'slides_1_5' }, { from: 6, to: 21, section: 'slides_6_21', deck: [1, 21] }, { from: 1, to: 23, section: 'full' }]
const planFor = (room, k) => (Array.isArray(room.plan) && room.plan[k]) || RETRAIN_PLAN[Math.min(k, RETRAIN_PLAN.length - 1)]
const retrainSessions = (room) => (room.once || []).filter(Boolean).map((o) => { const st = etWall(o.slice(0, 10), o.slice(11, 16)); return { start: st, end: new Date(st.getTime() + Math.max(10, Number(room.minutes) || 60) * 60000) } }).sort((a, c) => a.start - c.start)
const fmtSession = (x) => {
  const f = (d, o) => d.toLocaleString('en-US', { timeZone: 'America/New_York', ...o })
  return `${f(x.start, { weekday: 'long', month: 'short', day: 'numeric' })}, ${f(x.start, { hour: 'numeric', minute: '2-digit' }).replace(':00', '')}–${f(x.end, { hour: 'numeric', minute: '2-digit' }).replace(':00', '')}`
}
// RETRAINING HOMEWORK STATUS per rep (Neal, 2026-10-06: "report whether they opened their links and have
// done stuff like the self training"). A rep's homework = their practice-test rows made since they were
// signed up. Matched by person + time, NOT by the row's retrain tag: finishing/grading a test used to
// overwrite that tag, so finished homework vanished from the reports (fixed in practice-invite /
// practice-grade-background the same day; this also reads the rows done before the fix correctly).
// → { [traineeId]: { links, opened_at, done, score, last_at } }
async function retrainHomework(sb, room, ids) {
  const at = new Map((room.invitees || []).filter((x) => x.id && ids.includes(x.id)).map((x) => [x.id, Date.parse(x.at || 0) - 60000]))
  if (!at.size) return {}
  const since = new Date(Math.min(...at.values())).toISOString()
  const { data } = await sb.from('sales_practice_sessions').select('trainee_id, grade_status, score, report, created_at').in('trainee_id', [...at.keys()]).gte('created_at', since)
  const out = {}
  for (const p of data || []) {
    if (Date.parse(p.created_at) < at.get(p.trainee_id)) continue
    if (!(p.report?.retrain === room.slug || p.report?.invite)) continue
    const o = (out[p.trainee_id] ||= { links: 0, opened_at: null, done: false, score: null, last_at: null })
    o.links++
    const opened = p.report?.opened_at || p.report?.invite?.used_at || null
    if (opened && (!o.opened_at || opened < o.opened_at)) o.opened_at = opened
    if (p.grade_status !== 'invited') { o.done = true; if (p.score != null && (o.score == null || p.score > o.score)) o.score = p.score; if (!o.opened_at) o.opened_at = p.created_at }
    if (!o.last_at || p.created_at > o.last_at) o.last_at = p.created_at
  }
  return out
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
    // ONLY THE ONES WHO SHOWED UP (Neal, 2026-10-06: "send to the ones in retraining that showed up today,
    // in the attendance"). If a session was held today, tonight's homework goes only to the reps who
    // joined it (meeting attendance in the room they join).
    let sendIds = ids
    if (k > 0 && etDay(retrainSessions(room)[k - 1].start.getTime()) === etDay()) {
      const tgt = room.joins_room || room.slug
      const { data: att } = await sb.from('app_settings').select('key').like('key', `meet_att_${etDay()}_${tgt}_t:%`)
      const came = new Set((att || []).map((x) => x.key.split('_t:')[1]))
      sendIds = ids.filter((id) => came.has(id))
    }
    if (!sendIds.length) continue
    const { data: have } = await sb.from('sales_practice_sessions').select('trainee_id, report').in('trainee_id', ids)
    const done = new Set((have || []).filter((x) => x.report?.retrain === room.slug && Number(x.report?.day ?? 0) === k).map((x) => x.trainee_id))
    const { data: ppl } = await sb.from('trainees').select('id, first_name, last_name, phone, email, company_email').in('id', sendIds.filter((id) => !done.has(id)))
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

// FINISHED EARLY = DONE (Neal, 2026-10-05: "once the 8:30 managers' meeting is over, it should
// disappear"). A meeting that started more than 15 minutes ago and has no host in it any more is
// over for today: what's "next" is the following one.
// A meeting stays on the dashboards until its SCHEDULED END, even if the room empties (Neal, 2026-10-06:
// Sam's 9:30 dropped at 9:45, the room was empty 16 min in, and the old "15 min past start + empty = done"
// rule took his link away mid-meeting). nextMeeting already moves on once the end time has passed.
const nextAfterDone = (r, live, now = Date.now()) => nextMeeting(r, now)

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
  // GoHighLevel users kept OFF our people lists (test logins etc.). app_settings staff_hide = [names].
  // Neal, 2026-10-05: "get rid of the Neal S, that was for testing".
  // EVERYONE ELSE IN THE COMPANY = JobNimbus (Neal, 2026-10-05: "GoHighLevel is fine for the sales
  // reps but for everyone else it should be JobNimbus" — the GHL list was mostly inactive salespeople
  // and no foremen). CCG company-directory gives active JN users + department + any known cell; a
  // missing cell is filled from GoHighLevel / TMS by email or name. Sales departments are left out
  // (they're on the Active sales reps list). Each: { name, email, phone, cell, dept }.
  const SALES_DEPTS = ['retail sales', 'insurance sales rep']
  const companyStaff = async () => {
    const d = await fetch('https://free-roof-inspections.netlify.app/.netlify/functions/company-directory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: process.env.DIRECTORY_KEY }) }).then((r) => r.json()).catch(() => ({}))
    if (!d.ok) return []
    const dg = (x) => String(x || '').replace(/\D/g, '').slice(-10)
    let gu = []
    try { gu = (await fetch(`https://services.leadconnectorhq.com/users/?locationId=${process.env.GHL_LOCATION_ID}`, { headers: ghlHeaders() }).then((r) => r.json())).users || [] } catch { /* fine */ }
    const gBy = {}
    for (const x of gu) if (x.phone) { if (x.email) gBy[x.email.toLowerCase()] = x.phone; gBy[`n:${`${x.firstName || ''} ${x.lastName || ''}`.trim().toLowerCase()}`] = x.phone }
    const { data: tt } = await sb.from('trainees').select('first_name, last_name, phone, email, company_email').not('phone', 'is', null)
    for (const x of tt || []) { for (const m of [x.email, x.company_email]) if (m && !gBy[m.toLowerCase()]) gBy[m.toLowerCase()] = x.phone; const nk = `n:${fullName(x).toLowerCase()}`; if (!gBy[nk]) gBy[nk] = x.phone }
    const hide = await staffHidden()
    return (d.people || []).filter((p) => !SALES_DEPTS.includes(String(p.dept).toLowerCase()) && !hide.has(p.name.toLowerCase())).map((p) => {
      const phone = p.phone || gBy[p.email || '-'] || gBy[`n:${p.name.toLowerCase()}`] || ''
      return { name: p.name, email: p.email || '', phone, cell: dg(phone).length === 10 ? dg(phone) : '', dept: p.dept }
    })
  }
  const staffHidden = async () => new Set(((await getSetting('staff_hide', null)) || ['Neal S']).map((n) => String(n).trim().toLowerCase()))
  // Who the room shows as its host: the people picked as Host (plus any names typed in); with
  // none picked, the team's manager (team room) and Neal / DeWayne when they're Also included.
  const hostNamesFor = async (r) => {
    const ids = [...(r.host_ids || [])]
    let names = []
    if (ids.length) { const { data } = await sb.from('trainees').select('id, first_name, last_name').in('id', ids); names = ids.map((id) => (data || []).find((x) => x.id === id)).filter(Boolean).map(fullName) }
    names = [...names, ...(r.hosts || [])]
    if (!names.length) {
      if (r.zone) { const { data } = await sb.from('trainees').select('first_name, last_name').eq('managed_region', r.zone); names = (data || []).map(fullName) }
      const al = alsoIds(r)
      if (al.length) { const { data } = await sb.from('trainees').select('id, first_name, last_name').in('id', al); names = [...names, ...al.map((id) => (data || []).find((x) => x.id === id)).filter(Boolean).map(fullName)] }
    }
    return [...new Set(names.filter(Boolean))]
  }
  const isRoomHost = (room, t) => (room.host_ids || []).includes(t.id) || !!(room.zone && t.managed_region === room.zone) || alsoIds(room).includes(t.id) || (room.hosts || []).some((h) => h.toLowerCase() === fullName(t).toLowerCase())

  // Is a host in the room right now, and may non-hosts come in?
  // 👥 NO-HOST ROOM (Neal, 2026-10-06: "the 8 a.m. meeting, it's always just DeWayne and I … no host"):
  // everyone from the COMPANY who comes in (their own link) has the host controls, and nobody waits —
  // the room is always open. Outside guests / guest speakers are never hosts, so never see host notes.
  const openState = async (r) => {
    let live = false
    // A no-host room is LIVE when anyone is in it (Neal, 2026-10-06: it showed "LIVE NOW" all day once
    // it was no-host — it said live without looking) and always open to come in.
    try { live = (await svc().listParticipants(r.slug)).some((p) => { if (r.no_host) return !/^egress/i.test(String(p.identity || '')); try { return JSON.parse(p.metadata || '{}').host } catch { return false } }) } catch { /* room not open */ }
    if (r.no_host) return { live, open: true }
    if (!hasSchedule(r)) return { live, open: r.kind === 'company' ? live : true }
    const nm = nextMeeting(r)
    const open = live || !!(nm && Date.now() >= nm.start.getTime() - 15 * 60000)
    return { live, open }
  }

  // RESEND TRAINING INVITE (Neal, 2026-10-05: Peter Klimek never confirmed Monday — "all I have is
  // the resend registration link"). From the class page: this one trainee gets their own training
  // link again by text + email. It asks them to confirm they'll be there (?confirm=1), then the same
  // link gets them into class. Week A or B is worked out from where they are now. Fixed message,
  // only to that trainee, at most once every 5 minutes.
  if (b.action === 'resend_class_invite') {
    const { data: t } = await sb.from('trainees').select('id, first_name, last_name, phone, email, company_email, registration_token').eq('id', String(b.trainee_id || '')).maybeSingle()
    if (!t || !t.registration_token) return json(404, { ok: false, error: 'No such trainee (or no link yet: send the registration link first).' })
    const rooms0 = (await loadRooms()).filter((r) => r.kind === 'training')
    let room = null
    for (const w of ['A', 'B']) if (!room && (await trainingIds(w)).has(t.id)) room = rooms0.find((r) => r.training_week === w) || rooms0.find((r) => r.training_week === 'both')
    if (!room) return json(400, { ok: false, error: `${t.first_name} isn't in a training week that's on now.` })
    const gate = `meet_reinvite_${t.id}`, prev = await getSetting(gate, null)
    if (prev && Date.now() - Date.parse(prev) < 5 * 60000) return json(200, { ok: false, error: 'Just sent. Give it a few minutes.' })
    const tag = `reinvite-${etDay()}`
    const link = `${SITE}/meet/${room.slug}?t=${t.registration_token}&confirm=1&tag=${tag}`
    const nm = nextMeeting(room)
    const when = nm ? nm.start.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null
    const msg = `Hi ${t.first_name}, this is U.S. Shingle & Metal. ${when ? `Your training is ${when} (Eastern), on video.` : 'Your training is on video.'} Tap to confirm you'll be there. The same link gets you into class, so keep it: ${link}`
    const out = { sms: false, email: false }
    if (t.phone) { const r = await sendSmsViaGhl(t.phone, msg, { firstName: t.first_name, lastName: t.last_name }).catch(() => null); out.sms = !!(r && r.ok); if (r && !r.ok) out.sms_error = r.error }
    const em = t.email || t.company_email
    if (em) { const r = await sendEmail(em, `Confirm your training: ${room.title}`, msg).catch(() => null); out.email = !!(r && r.ok !== false) }
    await putSetting(gate, new Date().toISOString())
    // Logged like the class notices, so the Audit shows it and when they open it.
    const au = (await getSetting(`invite_audit_${tag}`, null)) || { title: `Training invite re-sent (${etDay()})`, sent_at: new Date().toISOString(), sends: {}, opens: {} }
    au.sends[t.id] = { name: fullName(t), phone: t.phone || '', email: em || '', sms: out.sms, email_ok: out.email, at: new Date().toISOString() }
    await putSetting(`invite_audit_${tag}`, au)
    if (!out.sms && !out.email) return json(200, { ok: false, error: `Nothing went out${out.sms_error ? ` (text: ${out.sms_error})` : ''}.` })
    return json(200, { ok: true, ...out, room: room.title })
  }

  // 🔎 TRAINEE AUDIT (Neal, 2026-10-05: "would be nice to have an audit button as well"). For one
  // trainee on the class page: did they confirm, every logged notice we sent them (text / email went
  // out, did they open the link), and GoHighLevel's last texts to their phone with delivery status
  // and any replies. Read-only.
  if (b.action === 'trainee_audit') {
    const { data: t } = await sb.from('trainees').select('id, first_name, last_name, phone, email, company_email, confirmation_status, confirmation_at, registration_token, created_at').eq('id', String(b.trainee_id || '')).maybeSingle()
    if (!t) return json(404, { ok: false, error: 'No such trainee.' })
    const notices = []
    const { data: au } = await sb.from('app_settings').select('key, value').like('key', 'invite_audit_%')
    for (const row of au || []) {
      let v = null; try { v = typeof row.value === 'string' ? JSON.parse(row.value) : row.value } catch { continue }
      const snd = v?.sends?.[t.id]; if (!snd) continue
      const op = (v.opens || {})[t.id] || []
      notices.push({ title: v.title || row.key.slice(13), at: snd.at || v.sent_at, sms: !!snd.sms, email: !!snd.email_ok, opened: op.length ? op[op.length - 1] : null, opens: op.length })
    }
    notices.sort((a, c) => String(c.at).localeCompare(String(a.at)))
    const texts = []
    let dnd = null
    const ph = String(t.phone || '').replace(/\D/g, '').slice(-10)
    if (ph.length === 10) {
      try {
        const B = 'https://services.leadconnectorhq.com', L = process.env.GHL_LOCATION_ID
        const q = await fetch(`${B}/contacts/search/duplicate?locationId=${L}&number=${encodeURIComponent('+1' + ph)}`, { headers: ghlHeaders() }).then((r) => r.json())
        const c = q.contact
        if (c) {
          dnd = !!c.dnd || Object.values(c.dndSettings || {}).some((x) => x && x.status === 'active')
          const cv = await fetch(`${B}/conversations/search?locationId=${L}&contactId=${c.id}`, { headers: ghlHeaders() }).then((r) => r.json())
          for (const x of (cv.conversations || []).slice(0, 2)) {
            const m = await fetch(`${B}/conversations/${x.id}/messages?limit=15`, { headers: ghlHeaders() }).then((r) => r.json())
            for (const y of (m.messages?.messages || [])) if (/SMS/i.test(y.messageType || '')) texts.push({ at: y.dateAdded, dir: y.direction, status: y.status || '', body: String(y.body || '').slice(0, 90) })
          }
          texts.sort((a, c2) => String(c2.at).localeCompare(String(a.at)))
        }
      } catch { /* GHL down: the rest still shows */ }
    }
    return json(200, { ok: true, name: fullName(t), phone: t.phone || '', email: t.email || t.company_email || '', confirmation: t.confirmation_status || null, confirmed_at: t.confirmation_at || null, dnd, notices, texts: texts.slice(0, 12), ghl_found: texts.length > 0 || dnd !== null })
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
      out.push({ id: x.egress_id, started: x.started, kind: x.kind, minutes: x.minutes || null, seconds: x.seconds ?? null, mb: x.mb || null, ready: !!x.ready, deleted: !!x.deleted, error: x.error || null, link })
    }
    return json(200, { ok: true, room: publicRoom(r), keep_days: r.rec_keep_days ?? 90, recordings: out })
  }

  // 🗑 DELETE FROM THE RECORDINGS PAGE (Neal, 2026-10-06: "have a delete on all these recordings").
  // Neal, same day: "only two people have access to this page, they should be able to delete" — the
  // page's own key (the private recordings link) is enough; an admin PIN still works too.
  // { room, k, id }  or  { room, k, all: true }
  if (b.action === 'rec_delete') {
    const r = (await loadRooms()).find((x) => x.slug === String(b.room || ''))
    if (!r) return json(404, { ok: false, error: 'No recordings here.' })
    const ok = (r.rec_key && String(b.k || '') === r.rec_key) || !!(await verifyPin(b.pin))
    if (!ok) return json(401, { ok: false, error: 'This recordings link is not valid.' })
    const key = `meet_recordings_${r.slug}`
    const log = (await getSetting(key, [])) || []
    const gone = b.all ? log : log.filter((x) => x.egress_id === String(b.id || ''))
    if (!gone.length) return json(404, { ok: false, error: 'Already gone.' })
    const files = gone.map((x) => x.file).filter(Boolean)
    for (let i = 0; i < files.length; i += 50) await sb.storage.from('meeting-recordings').remove(files.slice(i, i + 50))
    await putSetting(key, log.filter((x) => !gone.includes(x)))
    return json(200, { ok: true, deleted: gone.length })
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
      slides: `${SITE}/homework/slides?from=${plan.from}&to=${plan.to}`, ...(plan.deck ? { deck: `${SITE}/homework/slides?from=${plan.deck[0]}&to=${plan.deck[1]}`, deck_from: plan.deck[0], deck_to: plan.deck[1] } : {}), script: `${SITE}/sales-pitch/sales-script.pdf`, practice: `${SITE}/practice/${tok}`,
      // FIGS deck as a PDF to keep (Neal, 2026-10-06: "add that PDF to their homework so they can just download it").
      figs: `${SITE}/find-their-button/Find-Their-Button-FIGS.pdf`,
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

  // 📵 TEXT CHECK (Neal, 2026-10-05: William Hennis says he isn't getting our texts). A card at the
  // top of a flagged rep's dashboard: their cell on file, "Send me a test text", then "Did you get
  // it?" Yes clears the card; No tells Neal (text + email) with GoHighLevel's delivery status.
  // Who sees it: app_settings text_check_reps (trainee ids). State: text_check_<trainee id>.
  if (b.action === 'rep_textcheck' || b.action === 'rep_textcheck_send' || b.action === 'rep_textcheck_answer') {
    const who = await fetch(REP_PIN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'whoami', session: String(b.session || '') }) }).then((r) => r.json()).catch(() => ({}))
    if (!who.ok || !who.jnid || who.viewer) return json(200, { ok: true, show: false })
    const { data: ts } = await sb.from('trainees').select('id, first_name, last_name, phone, is_active_sales_rep').eq('jobnimbus_id', who.jnid)
    const t = (ts || []).find((x) => x.is_active_sales_rep) || (ts || [])[0]
    const flagged = await getSetting('text_check_reps', [])
    if (!t || !(ts || []).some((x) => flagged.includes(x.id))) return json(200, { ok: true, show: false })
    const key = `text_check_${t.id}`, st = await getSetting(key, {})
    const view = async (x) => {
      let status = null
      if (x.message_id && !x.answer) { const g = await getSmsStatus(x.message_id); if (g.ok) status = g.status || null }
      return { ok: true, show: x.answer !== 'yes', phone: t.phone || '', sent_at: x.sent_at || null, status, answer: x.answer || null }
    }
    if (b.action === 'rep_textcheck') return json(200, await view(st))
    if (b.action === 'rep_textcheck_send') {
      if (!t.phone) return json(200, { ok: false, error: "We don't have a cell number for you. Fix it below." })
      if (st.sent_at && Date.now() - Date.parse(st.sent_at) < 60000) return json(200, { ok: false, error: 'Just sent. Give it a minute.' })
      const r = await sendSmsViaGhl(t.phone, `Hi ${t.first_name}, this is a TEST text from U.S. Shingle. Did you receive this message? Reply YES, and tap "Yes, I got it" on your dashboard.`, { firstName: t.first_name, lastName: t.last_name })
      const next = { sent_at: new Date().toISOString(), message_id: r.messageId || null, send_error: r.ok ? null : r.error, phone: t.phone, answer: null }
      await putSetting(key, next)
      if (!r.ok) return json(200, { ok: false, error: `The text didn't go out (${r.error}). Neal has been told.` })
      return json(200, await view(next))
    }
    // rep_textcheck_answer
    const yes = b.answer === 'yes'
    let status = null
    if (st.message_id) { const g = await getSmsStatus(st.message_id); if (g.ok) status = g.status || null }
    await putSetting(key, { ...st, answer: yes ? 'yes' : 'no', answered_at: new Date().toISOString(), status })
    if (!yes) {
      const nm = fullName(t), at = st.sent_at ? new Date(st.sent_at).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'n/a'
      const msg = `📵 ${nm} did NOT get the test text to ${t.phone} (sent ${at} ET). GoHighLevel delivery status: ${status || st.send_error || 'unknown'}.`
      await sendSmsViaGhl('727-503-7017', msg).catch(() => {})
      await sendEmail('neals@shingleusa.com', `Text check: ${nm} did not get the test text`, msg).catch(() => {})
    }
    return json(200, { ok: true, show: !yes, answer: yes ? 'yes' : 'no', status, phone: t.phone || '' })
  }

  // 📱 WAITING ON YOU (Neal, 2026-10-05): things we texted a rep that they haven't done — unsigned
  // pay documents, a retraining page not opened — for an alert on their dashboard, with a button to
  // re-send them all by text once they've texted START to our number (texts were blocked).
  if (b.action === 'rep_pending' || b.action === 'rep_resend' || b.action === 'rep_update_contact') {
    const who = await fetch(REP_PIN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'whoami', session: String(b.session || '') }) }).then((r) => r.json()).catch(() => ({}))
    if (!who.ok || !who.jnid || who.viewer) return json(200, { ok: true, items: [] })
    const { data: ts } = await sb.from('trainees').select('id, first_name, last_name, phone, email, company_email, registration_token, is_active_sales_rep').eq('jobnimbus_id', who.jnid)
    const t = (ts || []).find((x) => x.is_active_sales_rep) || (ts || [])[0]
    if (!t) return json(200, { ok: true, items: [] })
    // CHECK THE CONTACT FIRST (Neal, 2026-10-05: his own record had an old number — that's why texts
    // never came). The rep confirms or fixes their cell + email; a fix saves to every record of theirs.
    if (b.action === 'rep_update_contact') {
      const ph = String(b.phone || '').replace(/\D/g, '').slice(-10), em = String(b.email || '').trim().toLowerCase()
      if (ph.length !== 10) return json(400, { ok: false, error: 'Enter a 10-digit cell number.' })
      if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return json(400, { ok: false, error: 'That email doesn\'t look right.' })
      const nice = `${ph.slice(0, 3)}-${ph.slice(3, 6)}-${ph.slice(6)}`
      await sb.from('trainees').update({ phone: nice, ...(em ? { email: em } : {}) }).eq('jobnimbus_id', who.jnid)
      return json(200, { ok: true, phone: nice, email: em || t.email })
    }
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
    if (b.action === 'rep_pending') return json(200, { ok: true, items, last4, phone: t.phone || '', email: t.company_email || t.email || '' })
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

  // A meeting screen crashed (MeetErrorBoundary): keep the last 30 so the cause can be found.
  if (b.action === 'client_error') {
    const list = (await getSetting('meet_client_errors', [])) || []
    list.unshift({ at: new Date().toISOString(), room: String(b.room || '').slice(0, 60), message: String(b.message || '').slice(0, 500), stack: String(b.stack || '').slice(0, 1500), where: String(b.where || '').slice(0, 1500), ua: String(b.ua || '').slice(0, 200) })
    await putSetting('meet_client_errors', list.slice(0, 30))
    return json(200, { ok: true })
  }

  // 🎥 WHO'S IN A MEETING (Neal, 2026-10-06: "so many times I get phone calls … if I'm in a meeting, or
  // Dwayne … let everybody know so they don't try to call"). meet-webhook keeps meet_busy_<first name>
  // = { name, seats:{ identity: since } } for hosts / managers / Neal / DeWayne. Names only — no rooms.
  // A seat older than 6 hours is ignored (a missed "left" event can't leave someone busy forever).
  if (b.action === 'busy_now') {
    const { data } = await sb.from('app_settings').select('value').like('key', 'meet_busy_%')
    const cut = Date.now() - 6 * 3600e3, names = []
    for (const row of data || []) {
      let v = null; try { v = typeof row.value === 'string' ? JSON.parse(row.value) : row.value } catch { v = null }
      if (v?.name && Object.values(v.seats || {}).some((at) => Date.parse(at) > cut)) names.push(v.name)
    }
    return json(200, { ok: true, busy: names.sort() })
  }

  if (b.action === 'my_rooms') {
    const who = await fetch(REP_PIN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'whoami', session: String(b.session || '') }) })
      .then((r) => r.json()).catch(() => ({}))
    if (!who.ok || !who.jnid) return json(401, { ok: false, error: 'Signed out' })
    const { data: t } = await sb.from('trainees').select('id, first_name, last_name, phone, region, managed_region, registration_token, is_active_sales_rep, rep_level').eq('jobnimbus_id', who.jnid).maybeSingle()
    if (!t || !t.registration_token) return json(200, { ok: true, rooms: [] })
    const active = t.is_active_sales_rep === true && t.rep_level !== 'non_field'
    // 📞 Calls never show on dashboards (Neal, 2026-10-05: the Nikki call kept flashing after it ended) —
    // they happen through the texted link.
    const mine = (await loadRooms()).filter((r) => !r.call).filter((r) =>
      (INVITE_KINDS.includes(r.kind) && (r.invitees || []).some((x) => x.id === t.id || (!x.id && String(x.name || '').trim().toLowerCase().split(' ')[0] === String(t.first_name || '').toLowerCase() && String(x.phone || '').replace(/\D/g, '').slice(-10) === String(t.phone || '').replace(/\D/g, '').slice(-10))) && (r.kind !== 'oneoff' || nextMeeting(r))) ||
      alsoIds(r).includes(t.id) ||
      (r.kind === 'zone' && (t.region === r.zone || t.managed_region === r.zone) && (active || t.managed_region)) ||
      (r.kind === 'managers' && t.managed_region) ||
      ((r.kind === 'everyone' || r.kind === 'prayer' || r.kind === 'company') && (active || t.managed_region)))
    const openOf = Object.fromEntries(await Promise.all(mine.map(async (r) => [r.slug, await openState(r)])))
    // COMPANY MEETING DAY (Neal, 2026-10-04): on a day with a company meeting, the rep's regular
    // meetings that day are greyed out ("Company Meeting today instead") and the company one
    // stands out. Only meetings still to come today count.
    const today = etDay()
    const dayOf = (r) => { const nm = hasSchedule(r) ? nextAfterDone(r, openOf[r.slug]?.live) : null; return nm ? etDay(nm.start.getTime()) : null }
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
      // In the order they're attended (Neal, 2026-10-05): live now, then by next start; rooms with
      // no time (always open / nothing scheduled) last.
      rooms: mine.map((r) => {
        const pr = publicRoom(r)
        // Viewing as a rep (Neal's view-as) shows the rooms but never their personal link.
        const nmx = hasSchedule(r) ? nextAfterDone(r, openOf[r.slug]?.live) : null
        return { ...pr, ...openOf[r.slug], ...(hasSchedule(r) ? { next_at: nmx ? nmx.start.toISOString() : null } : {}), badge: pr.badge ? `${SITE}${pr.badge}` : null, host: isRoomHost(r, t), link: who.viewer ? null : `${SITE}/meet/${r.joins_room || r.slug}?t=${t.registration_token}` }
      }).sort((a, c) => ((c.live ? 1 : 0) - (a.live ? 1 : 0)) || ((a.next_at ? Date.parse(a.next_at) : 9e15) - (c.next_at ? Date.parse(c.next_at) : 9e15))),
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
    const mine = (await loadRooms()).filter((r) => !r.call).filter((r) => {
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
      const pr = publicRoom(r), st = await openState(r), nm = hasSchedule(r) ? nextAfterDone(r, st.live) : null
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
  // My Tools (CCG ?mode=mytools) shows the signed-in person's meetings TODAY (Neal, 2026-10-05). By
  // name only, so it returns just today's / live rooms and plain room links (they host with their PIN).
  if (b.action === 'mine_today_by_name') {
    const name = String(b.name || '').trim()
    const parts = name.split(/\s+/)
    if (parts.length < 2) return json(200, { ok: true, rooms: [] })
    const { data: ts } = await sb.from('trainees').select('id, first_name, last_name, phone, region, managed_region, registration_token, is_active_sales_rep, rep_level').ilike('first_name', parts[0]).ilike('last_name', `${parts[parts.length - 1]}%`)
    const rows = await roomsForPerson(ts, name, (r) => `${SITE}/meet/${r.slug}`)
    return json(200, { ok: true, rooms: rows.filter((r) => r.live || r.today).map(({ slug, title, live, open, today, next_at, topic, badge, kind, host_names }) => ({ slug, title, live, open, today, next_at, topic, badge, kind, host_names, link: `${SITE}/meet/${slug}` })) })
  }
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
  // 📞 CALL (Neal, 2026-10-05: "pick somebody, let's say Brent Davidson… I press the button, it sends
  // him a text with a link and we're both in a meeting room"). An admin (PIN) picks a person: anyone
  // in TMS, office staff from GoHighLevel's user list (Brent isn't in TMS), or a name + cell typed in.
  // A private room is made for right now, they get "join now" by text + email, and the caller goes
  // straight in as host. Call rooms are kind 'oneoff' with call:true; ones over 2 days old are cleared.
  if (b.action === 'call_people' || b.action === 'call_start') {
    // Who's calling: an admin PIN, or (Neal, 2026-10-05: "put call someone on everybody that has a
    // My Tools dashboard") the person's own My Tools name + passcode, checked with CCG. Never sets a
    // passcode: a name without one is refused.
    let caller = await verifyPin(b.pin)
    if (!caller && b.mt && String(b.mt.name || '').trim() && String(b.mt.pin || '').trim()) {
      const MT = 'https://free-roof-inspections.netlify.app/.netlify/functions/manager-dashboard'
      const nm = String(b.mt.name).trim().slice(0, 60)
      const has = await fetch(`${MT}?manager=${encodeURIComponent(nm)}`).then((r) => r.json()).catch(() => ({}))
      if (has.pin_set) {
        const ok = await fetch(MT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'auth', manager: nm, pin: String(b.mt.pin) }) }).then((r) => r.json()).catch(() => ({}))
        if (ok.ok) caller = nm
      }
    }
    if (!caller) return json(401, { ok: false, error: 'Sign-in not recognised. Open Call again from your My Tools page.' })
    const digits = (x) => String(x || '').replace(/\D/g, '').slice(-10)
    if (b.action === 'call_people') {
      const { data } = await sb.from('trainees').select('id, first_name, last_name, phone, email, company_email, region, managed_region, is_active_sales_rep, registration_token').or('is_active_sales_rep.eq.true,managed_region.not.is.null')
      // Everyone is listed with the cell we have (last 4), so you can see before you call; no cell = flagged.
      const people = (data || []).filter((p) => p.registration_token).map((p) => ({ id: p.id, name: fullName(p), tag: p.managed_region ? `Manager · ${TEAMS[p.managed_region] || p.managed_region}` : TEAMS[p.region] || 'Rep', ph: digits(p.phone), cell: digits(p.phone).length === 10 ? digits(p.phone) : '', has_email: !!(p.company_email || p.email) }))
      const staff = (await companyStaff()).map((x) => ({ name: x.name, phone: x.phone, email: x.email, tag: x.dept, ph: x.cell, cell: x.cell, has_email: !!x.email }))
      const seen = new Set(people.map((p) => p.ph).filter(Boolean))
      const tmsNames = new Set(people.map((p) => p.name.toLowerCase()))
      const all = [...people, ...staff.filter((x) => !tmsNames.has(x.name.toLowerCase()) && (!x.ph || (!seen.has(x.ph) && seen.add(x.ph))))].map(({ ph, ...x }) => x).sort((a, c) => a.name.localeCompare(c.name))
      return json(200, { ok: true, people: all })
    }
    // call_start
    const to = b.to || {}
    let invitee = null, name = ''
    if (to.id) {
      const { data: t } = await sb.from('trainees').select('id, first_name, last_name, phone, email, company_email, registration_token').eq('id', String(to.id)).maybeSingle()
      if (!t || !t.registration_token) return json(400, { ok: false, error: "Can't call that person (no TMS link)." })
      if (digits(t.phone).length !== 10 && !(t.company_email || t.email)) return json(400, { ok: false, error: `${fullName(t)} has no cell or email in TMS, so there's nothing to send the link to. Add their cell in TMS, or type their name + cell under "Someone else".` })
      to.cell = digits(t.phone)
      invitee = { id: t.id }; name = fullName(t)
    } else {
      name = String(to.name || '').trim().slice(0, 60)
      if (!name || digits(to.phone).length !== 10) return json(400, { ok: false, error: 'Pick someone, or type a name and a 10-digit cell.' })
      invitee = { key: crypto.randomBytes(6).toString('base64url'), name, phone: String(to.phone).trim().slice(0, 20), email: String(to.email || '').trim().toLowerCase().slice(0, 120) }
      to.cell = digits(to.phone)
    }
    const start = new Date(Date.now() - 60000)
    const p2 = (n) => String(n).padStart(2, '0')
    const hm = start.toLocaleTimeString('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false })
    const once = `${etDay(start.getTime())}T${hm.slice(0, 2)}:${p2(hm.slice(3, 5))}`
    const callerFirst = String(caller).split(' ')[0]
    const room = { title: `📞 ${callerFirst} ↔ ${name.split(' ')[0]}`, kind: 'oneoff', call: true, look: 'team', topic: '', cameras_required: false, once: [once], minutes: 60, invitees: [invitee], hosts: [String(caller)],
      // ⏺ Record this call to my computer (Neal, 2026-10-06), with the file name typed on the call form.
      ...(b.record ? { recording_enabled: true, rec_where: 'host', rec_name: String(b.rec_name || '').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 120) } : {}) }
    // Clear finished calls (over 2 days old) so Meeting Room Setup doesn't fill up with them.
    const cutoff = Date.now() - 2 * 86400000
    const kept = (await loadRooms()).filter((r) => !(r.call && (r.once || [])[0] && etWall(r.once[0].slice(0, 10), r.once[0].slice(11, 16)).getTime() < cutoff))
    await putSetting('meet_rooms', kept)
    INTERNAL = true
    try {
      const saved = JSON.parse((await handler({ httpMethod: 'POST', body: JSON.stringify({ action: 'save_room', room }) })).body)
      if (!saved.ok) return json(400, saved)
      // Your own words first when you typed a message (Neal, 2026-10-05), the join link under it.
      const note = String(b.note || '').trim().slice(0, 600)
      const msg = note ? `${note}\n\n📞 ${callerFirst} is calling you on video now. Tap to join: {link}` : `📞 Hi {first}, ${callerFirst} is calling you on video RIGHT NOW. Tap to join: {link}`
      const sent = JSON.parse((await handler({ httpMethod: 'POST', body: JSON.stringify({ action: 'send_links', slug: saved.room.slug, message: msg, subject: `📞 ${callerFirst} is calling you now` }) })).body)
      const r0 = (sent.sent || [])[0] || {}
      const cell = to.cell && to.cell.length === 10 ? `${to.cell.slice(0, 3)}-${to.cell.slice(3, 6)}-${to.cell.slice(6)}` : ''
      // A caller signed in through My Tools (not an admin PIN) gets their own seat AFTER the invite
      // went out (so they aren't texted their own call): their TMS link if they're in TMS by name,
      // else a guest key. Hosts by name, so a TMS caller is the host.
      let join = null
      if (!(await verifyPin(b.pin))) {
        const parts = String(caller).trim().split(/\s+/)
        // "Neal S" on My Tools = Neal Scoppe in TMS: last name matched as a prefix, used only if it's one person.
        const { data: me0 } = parts.length > 1 ? await sb.from('trainees').select('id, registration_token, managed_region, is_active_sales_rep').ilike('first_name', parts[0]).ilike('last_name', `${parts[parts.length - 1]}%`).not('registration_token', 'is', null).limit(5) : { data: [] }
        const me = (me0 || []).length === 1 ? me0 : (me0 || []).filter((x) => x.managed_region || x.is_active_sales_rep).slice(0, 1).length === 1 && (me0 || []).filter((x) => x.managed_region || x.is_active_sales_rep).length === 1 ? (me0 || []).filter((x) => x.managed_region || x.is_active_sales_rep) : []
        const all = await loadRooms(), rm = all.find((x) => x.slug === saved.room.slug)
        if (rm) {
          // The caller is always HOST of their own call (Neal, 2026-10-05: no Share button when calling Jen).
          if (me && me[0]) { rm.invitees.push({ id: me[0].id }); rm.host_ids = [...new Set([...(rm.host_ids || []), me[0].id])]; join = `/meet/${rm.slug}?t=${me[0].registration_token}` }
          else { const k = crypto.randomBytes(6).toString('base64url'); rm.invitees.push({ key: k, name: String(caller), phone: '', email: '', host: true }); join = `/meet/${rm.slug}?g=${k}` }
          await putSetting('meet_rooms', all)
        }
      }
      return json(200, { ok: true, slug: saved.room.slug, join, name, cell, sms: !!r0.sms, email: !!r0.email })
    } finally { INTERNAL = false }
  }

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
      const msg = `Hi {first}, ${m.first_name} set up a meeting: ${title}${room.topic ? ` (${room.topic})` : ''} on {when} (Eastern). 👉 Please CONFIRM: tap your link and press ✅ I'll be there (or ❌ Can't make it): {link}`
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
  // TWO CLASSES AHEAD, SIGN-UP A WEEK OUT (Neal, 2026-10-06: "it has to be a week out, not the day
  // before … just do two classes ahead"). Presentation retraining rides the Week B class every Tue–Thu,
  // so the room the office set up is a TEMPLATE: we keep a copy for each upcoming week (same times,
  // +7 days a week), and managers see the next two whose first day is 7+ days away. Each copy is an
  // ordinary retraining room, so homework, links, schedule blocks and the join all work unchanged.
  const fmtD = (d) => d.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' })
  const daysOut = (r) => { const f = sessionsOf(r)[0]; return f ? Math.round((Date.parse(etDay(f.start.getTime())) - Date.parse(etDay())) / 864e5) : -1 }
  const signupOpen = (r) => daysOut(r) >= 7
  const classRange = (r) => { const ss = sessionsOf(r); return ss.length ? (ss.length > 1 ? `${fmtD(ss[0].start)} – ${fmtD(ss[ss.length - 1].start)}` : fmtD(ss[0].start)) : '' }
  const closesOn = (r) => { const f = sessionsOf(r)[0]; return f ? fmtD(new Date(f.start.getTime() - 7 * 864e5)) : '' }
  const ensureRetrainClasses = async () => {
    const rooms = await loadRooms()
    let changed = false
    for (const t of rooms.filter((r) => r.kind === 'retraining' && !r.template && (r.once || []).filter(Boolean).length)) {
      const family = () => rooms.filter((r) => r.kind === 'retraining' && (r.slug === t.slug || r.template === t.slug) && signupOpen(r))
      for (let w = 1; w <= 260 && family().length < 2; w++) {
        const once = t.once.filter(Boolean).map((o) => { const d = new Date(`${o.slice(0, 10)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 7 * w); return `${d.toISOString().slice(0, 10)}T${o.slice(11, 16)}` })
        const slug = `${t.slug}-${once.slice().sort()[0].slice(0, 10)}`
        if (rooms.some((r) => r.slug === slug)) continue
        const copy = { ...t, slug, once, template: t.slug, invitees: [], visible_from: null, early_zones: [], rec_key: Math.random().toString(36).slice(2, 14), created_at: new Date().toISOString(), updated_by: 'auto (next class)' }
        if (!signupOpen(copy)) continue
        rooms.push(copy); changed = true
      }
    }
    if (changed) await putSetting('meet_rooms', rooms)
    return rooms
  }
  const practiceDone = async (ids, slug) => {
    if (!ids.length) return {}
    const room = (await loadRooms()).find((r) => r.slug === slug)
    if (room) { const hw = await retrainHomework(sb, room, ids).catch(() => null); if (hw) return Object.fromEntries(Object.entries(hw).map(([id, o]) => [id, o.done ? 'done' : 'sent'])) }
    const { data } = await sb.from('sales_practice_sessions').select('trainee_id, grade_status, report').in('trainee_id', ids).eq('section', 'slides_1_5')
    const out = {}
    for (const x of data || []) if (x.report?.retrain === slug) out[x.trainee_id] = x.grade_status === 'invited' ? 'sent' : 'done'
    return out
  }
  // 📋 MORNING MEETING REPORT for a regional manager (Neal, 2026-10-05: "the same audience report for
  // the regional manager morning sales training meetings"). Their own team room: every rep, joined /
  // stayed or left / minutes / camera / drops, for a day (default today). Manager link token.
  if (b.action === 'mgr_meeting_report') {
    const who = await mgrByToken(b.token)
    if (!who) return json(401, { ok: false, error: 'Open this from your own dashboard link.' })
    const room = (await loadRooms()).find((r) => r.kind === 'zone' && r.zone === who.m.managed_region)
    if (!room) return json(200, { ok: true, room: null, people: [] })
    INTERNAL = true
    try {
      const a = JSON.parse((await handler({ httpMethod: 'POST', body: JSON.stringify({ action: 'audience', slug: room.slug, day: b.day }) })).body)
      const people = (a.people || []).filter((p) => !p.host).map((p) => ({ name: p.name, today: p.today || null }))
      people.sort((x, c) => (x.today ? 0 : 1) - (c.today ? 0 : 1) || (x.today?.first_ms || 0) - (c.today?.first_ms || 0) || x.name.localeCompare(c.name))
      return json(200, { ok: true, room: { title: room.title, team: TEAMS[room.zone] || '' }, day: /^\d{4}-\d{2}-\d{2}$/.test(String(b.day || '')) ? b.day : etDay(), people })
    } finally { INTERNAL = false }
  }
  if (b.action === 'retrain_open') {
    const who = await mgrByToken(b.token)
    if (!who) return json(401, { ok: false })
    // visible_from: managers don't see it before then (Neal, 2026-10-05: reveal it on the 8:30 call).
    // early_zones: those zones' managers see it before visible_from (Neal previewing as SitSold, 2026-10-05).
    // SIGN-UP CLOSES a week before the class starts; the next two open classes show (signupOpen above).
    const all = await ensureRetrainClasses()
    const list = all.filter((r) => r.kind === 'retraining' && nextMeeting(r) && signupOpen(r) && (!r.visible_from || Date.parse(r.visible_from) <= Date.now() || (r.early_zones || []).includes(who.m.managed_region)))
    list.sort((a, c) => sessionsOf(a)[0].start - sessionsOf(c)[0].start)
    const out = []
    for (const r of list.slice(0, 2)) {
      const mine = (r.invitees || []).filter((x) => x.id && who.team.some((t) => t.id === x.id))
      const pr = await practiceDone(mine.map((x) => x.id), r.slug)
      // Already in ANOTHER upcoming class of the same retraining → shown, not pickable twice.
      const fam = r.template || r.slug
      const elsewhere = (id) => all.find((o) => o.slug !== r.slug && o.kind === 'retraining' && (o.template || o.slug) === fam && daysOut(o) >= 0 && (o.invitees || []).some((x) => x.id === id))
      out.push({ slug: r.slug, title: r.title, sessions: sessionLine(r), range: classRange(r), closes: closesOn(r), first_at: sessionsOf(r)[0]?.start.toISOString() || null,
        team: who.team.map((t) => { const o = elsewhere(t.id); return { id: t.id, name: fullName(t), picked: mine.some((x) => x.id === t.id), practice: pr[t.id] || null, other: o ? classRange(o) : null } }) })
    }
    return json(200, { ok: true, rooms: out })
  }
  if (b.action === 'retrain_nominate') {
    const who = await mgrByToken(b.token)
    if (!who) return json(401, { ok: false, error: 'Open this from your own dashboard link.' })
    const rooms0 = await loadRooms()
    const room = rooms0.find((r) => r.slug === b.slug && r.kind === 'retraining')
    if (!room || !nextMeeting(room)) return json(404, { ok: false, error: 'That retraining is not open.' })
    if (!signupOpen(room)) return json(400, { ok: false, error: `Sign-up for the ${classRange(room)} class closed a week before it starts. Pick the next class.` })
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
  if (['rooms', 'save_room', 'delete_room', 'reorder', 'people_search', 'import_contacts', 'set_staff_cell', 'audience', 'send_links', 'attendance', 'guests', 'email_log', 'recordings', 'delete_recording', 'early_grad'].includes(b.action)) {
    const admin = INTERNAL ? 'reminder job' : await verifyPin(b.pin)
    if (!admin) return json(401, { ok: false, error: 'Sign in again (PIN not recognised).' })
    const rooms = await loadRooms()
    // 📇 MY CONTACTS (Neal, 2026-10-07: "it knows it's me from my PIN … add someone else and it saves their contact
    // information in my contacts"): one list per PIN holder. Fed by every outside person they invite (on save, or the
    // 💾 button) and by a .vcf import. The old shared list (meet_contacts) is read as Neal's — it's the one he started.
    const myKey = `meet_contacts_${slugify(admin)}`
    const dgt = (x) => String(x || '').replace(/\D/g, '').slice(-10)
    const loadMine = async () => { const m = (await getSetting(myKey, null)) || []; return m.length || !/^neal/i.test(admin) ? m : (await getSetting('meet_contacts', [])) || [] }
    const addMine = async (list) => {
      const cur = await loadMine(); let added = 0
      const at = new Map(cur.map((c, i) => [(c.email || '').toLowerCase() || dgt(c.phone), i]))
      for (const c of (Array.isArray(list) ? list : []).slice(0, 5000)) {
        const name = String(c.name || '').trim().slice(0, 80), email = String(c.email || '').trim().toLowerCase().slice(0, 120), phone = String(c.phone || '').trim().slice(0, 30)
        const k = email || dgt(phone); if (!name || !k) continue
        if (at.has(k)) { const o = cur[at.get(k)]; if (!o.email && email) o.email = email; if (!o.phone && phone) o.phone = phone; continue } // fill in what was missing
        at.set(k, cur.length); cur.push({ name, email: email || null, phone: phone || null }); added++
      }
      await putSetting(myKey, cur)
      return { added, total: cur.length }
    }
    if (b.action === 'rooms') {
      // One-off meetings: RSVP counts for the card.
      const { data: rs } = await sb.from('app_settings').select('key, value').like('key', 'meet_rsvp_%')
      const tally = {}
      for (const x of rs || []) { const r = rooms.find((rm) => x.key.startsWith(`meet_rsvp_${rm.slug}_`)); if (!r) continue; let v = {}; try { v = JSON.parse(x.value) } catch { /* skip */ } const tt = (tally[r.slug] = tally[r.slug] || { yes: 0, no: 0 }); if (v.status === 'yes') tt.yes++; else if (v.status === 'no') tt.no++ }
      // Rooms saved before the Host setting get their host worked out once and kept.
      let filled = false
      for (const r of rooms) if (!Array.isArray(r.host_names)) { r.host_names = await hostNamesFor(r); filled = true }
      if (filled) await putSetting('meet_rooms', rooms)
      // People to pick as Host: Neal, DeWayne and the regional managers.
      const { data: hp } = await sb.from('trainees').select('id, first_name, last_name, managed_region').or(`managed_region.not.is.null,id.in.(${LEADERS.map((l) => l.id).join(',')})`)
      // Plus office hosts (Neal, 2026-10-05: "Nikki, Hank Smith be as a host as well"): app_settings
      // meet_host_extra { ids:[TMS ids], names:[people not in TMS — they host with their own PIN] }.
      const extra = (await getSetting('meet_host_extra', null)) || { ids: ['968b3d34-0774-4490-ba46-4482a9864563'], names: ['Hank Smith'] }
      const { data: hx } = (extra.ids || []).length ? await sb.from('trainees').select('id, first_name, last_name').in('id', extra.ids) : { data: [] }
      const host_people = [
        ...(hp || []).map((x) => ({ id: x.id, name: fullName(x), tag: x.managed_region ? `${TEAMS[x.managed_region] || x.managed_region} manager` : '' })),
        ...(hx || []).filter((x) => !(hp || []).some((y) => y.id === x.id)).map((x) => ({ id: x.id, name: fullName(x), tag: 'Office' })),
        ...(extra.names || []).map((n) => ({ name: n, tag: 'Office', name_only: true })),
      ].sort((a, c) => a.name.localeCompare(c.name))
      return json(200, { ok: true, host_people, rooms: rooms.map((r) => ({ ...r, ...publicRoom(r), ...(r.kind === 'oneoff' ? { rsvp: { ...(tally[r.slug] || { yes: 0, no: 0 }), invited: (r.invitees || []).length } } : {}) })), site: SITE })
    }
    if (b.action === 'save_room') {
      const r = b.room || {}
      await addMine((r.invitees || []).filter((y) => !y.id)).catch((e) => console.warn('my contacts', e.message))
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
        schedule: scheduleText(r) || String(r.schedule || '').slice(0, 120), topic: String(r.topic || '').slice(0, 200), cameras_required: !!r.cameras_required,
        look: ['team', 'company', 'devotional'].includes(r.look) ? r.look : (kind === 'company' ? 'company' : 'team'),
        banner_url: /^https:\/\/\S+$/.test(String(r.banner_url || '').trim()) ? String(r.banner_url).trim().slice(0, 300) : '',
        welcome: String(r.welcome || '').slice(0, 400), back_label: String(r.back_label || '').slice(0, 60),
        back_url: /^https:\/\/\S+$/.test(String(r.back_url || '').trim()) ? String(r.back_url).trim().slice(0, 300) : '',
        recording_enabled: !!r.recording_enabled,
        // Who gets "the recording is ready" (name + email each), what to record, how long to keep.
        rec_to: (Array.isArray(r.rec_to) ? r.rec_to : []).map((x) => ({ name: String(x?.name || '').trim().slice(0, 60), email: String(x?.email || '').trim().toLowerCase().slice(0, 120) })).filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.email)).slice(0, 10),
        rec_kind: ['combined', 'raw', 'both'].includes(r.rec_kind) ? r.rec_kind : 'combined',
        // 💻 Where the recording is saved (Neal, 2026-10-06, like Zoom's local recording): 'cloud' = our
        // recording service + recordings page; 'host' = the host's own computer records and downloads it.
        rec_where: r.rec_where === 'host' ? 'host' : 'cloud',
        rec_keep_days: [30, 60, 90, 0].includes(Number(r.rec_keep_days)) ? Number(r.rec_keep_days) : 90,
        // The recordings page's private key (its link is shared with the editor, e.g. DeWayne's cousin).
        rec_key: (rooms.find((x) => x.slug === r.original_slug) || {}).rec_key || crypto.randomBytes(9).toString('base64url'),
        training_week: ['A', 'B', 'both'].includes(r.training_week) ? r.training_week : 'A',
        effort_gate: !!r.effort_gate,
        remind_5: !!r.remind_5,
        mic_lock: !!r.mic_lock,
        no_host: !!r.no_host && kind !== 'training',
        joins_room: kind === 'retraining' ? String(r.joins_room || '').slice(0, 60) : '',
        early_zones: (rooms.find((x) => x.slug === r.original_slug) || {}).early_zones || [],
        visible_from: r.visible_from || (rooms.find((x) => x.slug === r.original_slug) || {}).visible_from || null,
        auto_stage: !!r.auto_stage,
        call: !!r.call,
        // Neal is the corporate trainer: every training room carries him (Neal, 2026-10-05).
        also: [...new Set([...(Array.isArray(r.also) ? r.also : []), ...(kind === 'training' || kind === 'retraining' ? ['neal'] : [])])].filter((k) => LEADERS.some((l) => l.key === k)),
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
        host_ids: (Array.isArray(r.host_ids) ? r.host_ids : []).map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 10),
        updated_at: new Date().toISOString(), updated_by: admin,
      }
      clean.host_names = await hostNamesFor(clean)
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
    // 🔀 COMBINE TODAY (Neal, 2026-10-05: "Anthony is out today so all of his team is meeting up with
    // Chad's team"). For today only, this room's people are sent to another team's room; both teams
    // are texted + emailed their own link to it. Tomorrow it's back to normal by itself.
    if (b.action === 'combine_today') {
      const into = rooms.find((x) => x.slug === b.into)
      if (!into || into.slug === room.slug) return json(400, { ok: false, error: 'Pick the room they are joining.' })
      if (b.cancel) { delete room.merge; await putSetting('meet_rooms', rooms); return json(200, { ok: true, cancelled: true }) }
      room.merge = { into: into.slug, date: etDay(), at: new Date().toISOString() }
      await putSetting('meet_rooms', rooms)
      const sent = []
      if (b.notify) {
        INTERNAL = true
        let away = [], host = []
        try {
          away = JSON.parse((await handler({ httpMethod: 'POST', body: JSON.stringify({ action: 'audience', slug: room.slug }) })).body).people || []
          host = JSON.parse((await handler({ httpMethod: 'POST', body: JSON.stringify({ action: 'audience', slug: into.slug }) })).body).people || []
        } finally { INTERNAL = false }
        const awayMgr = String(b.away_manager || '').trim().toLowerCase()
        const t1 = room.zone ? TEAMS[room.zone] || room.title : room.title, t2 = into.zone ? TEAMS[into.zone] || into.title : into.title
        const nm = nextMeeting(into), at = nm ? nm.start.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) : ''
        const seen = new Set()
        const send = async (p, msg) => {
          const ph = String(p.phone || '').replace(/\D/g, '').slice(-10); if (ph && seen.has(ph)) return; if (ph) seen.add(ph)
          const first = String(p.name || '').split(' ')[0] || 'there', r = { name: p.name, sms: false, email: false }
          const text = msg.replace('{first}', first)
          if (p.phone) { try { const x = await sendSmsViaGhl(p.phone, text, { firstName: first, lastName: '' }); r.sms = !!(x && x.ok !== false) } catch { /* shown */ } }
          if (p.email) { try { const x = await sendEmail(p.email, `Today: ${t1} meets with ${t2}`, text); r.email = !!(x && x.ok !== false) } catch { /* shown */ } }
          sent.push(r)
        }
        const linkFor = (p) => String(p.link || '').replace(`/meet/${room.slug}`, `/meet/${into.slug}`)
        // The away team's own host (their manager, who's out) isn't texted.
        for (const p of away) { if (p.host || (awayMgr && String(p.name || '').toLowerCase() === awayMgr)) continue; await send({ ...p, link: linkFor(p) }, `Hi {first}, ${b.reason ? `${String(b.reason).trim().replace(/[.!]?$/, ',')} so ` : ''}${t1} is joining ${t2} for ${into.title}${at ? ` at ${at}` : ''} today. Tap here to join: ${linkFor(p)}`) }
        for (const p of host) await send(p, `Hi {first}, heads up: ${t1} is joining our ${into.title} today${b.reason ? ` (${String(b.reason).trim().replace(/[.!]$/, '')})` : ''}. Same time${at ? `, ${at}` : ''}. Your link: ${p.link}`)
      }
      return json(200, { ok: true, merged: room.merge, sent })
    }
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
    // A cell typed in on the invite list for someone JobNimbus has no number for (foremen etc.) —
    // kept in CCG's staff_cells so every list and Call has it from now on.
    if (b.action === 'set_staff_cell') {
      const r = await fetch('https://free-roof-inspections.netlify.app/.netlify/functions/company-directory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: process.env.DIRECTORY_KEY, action: 'set_cell', email: b.email || '', name: b.name || '', phone: b.phone || '' }) }).then((x) => x.json()).catch(() => ({ ok: false, error: 'Could not save.' }))
      return json(r.ok ? 200 : 400, r)
    }
    if (b.action === 'people_search') {
      const now = await traineeIdsNow()
      const { data } = await sb.from('trainees').select('id, first_name, last_name, region, managed_region, is_active_sales_rep, rep_level, registration_token').or(`is_active_sales_rep.eq.true,managed_region.not.is.null${now.size ? `,id.in.(${[...now].join(',')})` : ''}`)
      // EVERYONE ELSE IN THE COMPANY (Neal, 2026-10-05: Nikki, Hank want department meetings): office
      // staff from GoHighLevel's user list who aren't already in TMS, with their cell + email. Picked
      // ones go on the invite list as outside guests (their own link by text + email).
      const dg = (x) => String(x || '').replace(/\D/g, '').slice(-10)
      const { data: allT } = await sb.from('trainees').select('phone').or('is_active_sales_rep.eq.true,managed_region.not.is.null')
      const tms = new Set((allT || []).map((x) => dg(x.phone)).filter(Boolean))
      const staffAll = (await companyStaff()).filter((x) => !x.cell || !tms.has(x.cell))
      // 📇 CONTACTS (Neal, 2026-10-07: "invite two people from Five Star … they're in my email"): MY contacts first (this
      // PIN's own list), then anyone else ever invited from outside on any room. Not staff, not in TMS.
      const seen = new Set([...staffAll.map((x) => (x.email || '').toLowerCase()), ...staffAll.map((x) => x.cell)].filter(Boolean))
      const contacts = []
      const addC = (c, dept) => {
        const name = String(c.name || '').trim(), email = String(c.email || '').trim().toLowerCase(), cell = dg(c.phone)
        if (!name || (!email && !cell)) return
        const k = email || cell; if (seen.has(k) || (cell && tms.has(cell))) return; seen.add(k); if (email && cell) seen.add(cell)
        contacts.push({ name, email: email || null, phone: c.phone || null, cell: cell || null, dept })
      }
      for (const c of await loadMine()) addC(c, '📇 My contacts')
      for (const r of rooms) for (const y of r.invitees || []) if (!y.id) addC(y, '📇 Invited before')
      const staff = [...staffAll, ...contacts].sort((a, c) => a.dept.localeCompare(c.dept) || a.name.localeCompare(c.name))
      return json(200, { ok: true, staff, people: (data || []).filter((p) => p.registration_token).map((p) => ({ id: p.id, name: fullName(p), tag: p.managed_region ? `Manager · ${TEAMS[p.managed_region] || p.managed_region}` : now.has(p.id) && !p.is_active_sales_rep ? 'Trainee' : p.rep_level === 'non_field' ? 'Office' : (TEAMS[p.region] || p.region || 'Rep') })).sort((a, c) => a.name.localeCompare(c.name)) })
    }
    // 📥 IMPORT CONTACTS: a list parsed from a .vcf (Gmail "Export → vCard", Mac Contacts "Export vCard") — merged, deduped.
    if (b.action === 'import_contacts') return json(200, { ok: true, ...(await addMine(b.contacts)) })
    if (b.action === 'delete_room') {
      await putSetting('meet_rooms', rooms.filter((x) => x.slug !== b.slug))
      return json(200, { ok: true })
    }
    const room = rooms.find((x) => x.slug === b.slug)
    if (!room) return json(404, { ok: false, error: 'No such room.' })
    if (b.action === 'audience' || b.action === 'send_links') {
      // Who the room is FOR — straight from TMS, so it follows the roster on its own.
      let q = sb.from('trainees').select('id, first_name, last_name, phone, email, company_email, region, managed_region, registration_token, rep_level, is_active_sales_rep')
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
      // MISSED A DAY = OFF THE LIST (Neal, 2026-10-06: Maliah and Peter missed day 1 but still showed in
      // First Week Training's list). Same rule the sign-in uses: if the class met on its last day before
      // today and this trainee wasn't marked present, they're out — unless the admin override (week_b_force)
      // is on, or they're here today. Hosts / managers always stay.
      if (room.kind === 'training' && people.length) {
        const { data: tr } = await sb.from('trainees').select('id, class_id, week_b_force').in('id', people.map((p) => p.id))
        const info = new Map((tr || []).map((x) => [x.id, x]))
        const classIds = [...new Set((tr || []).map((x) => x.class_id).filter(Boolean))]
        const lastDayOf = {}
        for (const cid of classIds) {
          const { data: last } = await sb.from('attendance').select('attendance_date').eq('class_id', cid).lt('attendance_date', etDay()).order('attendance_date', { ascending: false }).limit(1)
          lastDayOf[cid] = last?.[0]?.attendance_date || null
        }
        const days = [...new Set(Object.values(lastDayOf).filter(Boolean)), etDay()]
        const { data: att } = await sb.from('attendance').select('trainee_id, attendance_date').in('trainee_id', people.map((p) => p.id)).in('attendance_date', days)
        const was = new Set((att || []).map((a) => `${a.trainee_id}|${a.attendance_date}`))
        people = people.filter((p) => {
          const x = info.get(p.id); if (!x || isRoomHost(room, p) || x.week_b_force) return true
          const ld = lastDayOf[x.class_id]
          return !ld || was.has(`${p.id}|${ld}`) || was.has(`${p.id}|${etDay()}`)
        })
      }
      // Neal / DeWayne ticked "Also include" on this room.
      const extra = alsoIds(room).filter((id) => !people.some((p) => p.id === id))
      if (extra.length) { const { data: lx } = await sb.from('trainees').select('id, first_name, last_name, phone, email, company_email, region, managed_region, registration_token, rep_level, is_active_sales_rep').in('id', extra); people = people.concat((lx || []).filter((p) => p.registration_token)) }
      const eg = room.kind === 'training' ? ((await getSetting('early_grads', {})) || {}) : {}
      // Company email first (Neal, 2026-10-05: William Hennis never got the meeting email — it went to his
      // personal iCloud address). Same order as the 5-minute reminders.
      const rows = people.map((p) => ({ id: p.id, name: fullName(p), phone: p.phone, email: p.company_email || p.email, link: `${SITE}/meet/${room.joins_room || room.slug}?t=${p.registration_token}`, host: isRoomHost(room, p), early_a: eg[p.id]?.week_a_at || null, early_b: eg[p.id]?.week_b_at || null, active_rep: !!p.is_active_sales_rep }))
        .sort((a, c) => a.name.localeCompare(c.name))
      // People outside TMS on the invite list, each with their own key.
      if (invited) for (const x of (room.invitees || []).filter((y) => y.key)) rows.push({ id: `x:${x.key}`, name: x.name, phone: x.phone, email: x.email, link: `${SITE}/meet/${room.slug}?g=${x.key}`, host: false })
      // Retraining: did they open their homework link, and did they do the practice test?
      if (room.kind === 'retraining') {
        const hw = await retrainHomework(sb, room, rows.map((r) => r.id)).catch(() => ({}))
        for (const r of rows) if (!r.host) r.prep = hw[r.id] || { links: 0, opened_at: null, done: false, score: null }
      }
      // WHERE EVERYONE IS RIGHT NOW (Neal, 2026-10-05): in the room (LiveKit says so), else their last
      // step today — doing paperwork (which one), or waiting in the lobby — else not here yet.
      if (b.action === 'audience') {
        const { data: seen } = await sb.from('app_settings').select('key, value').like('key', `meet_seen_${room.slug}_%`)
        const seenBy = {}
        for (const x of seen || []) { try { const v = typeof x.value === 'string' ? JSON.parse(x.value) : x.value; if (v?.day === etDay()) seenBy[x.key.slice(`meet_seen_${room.slug}_`.length)] = v } catch { /* skip */ } }
        let liveIds = new Set()
        try { liveIds = new Set((await svc().listParticipants(room.slug)).map((p) => String(p.identity || '')).filter((i) => i.startsWith('t:')).map((i) => i.slice(2))) } catch { /* room not open */ }
        // TODAY'S TIMELINE (Neal, 2026-10-05: "joined at a certain time and then stayed the whole time
        // or left at a certain time"). From meet-webhook's LiveKit join/leave log (meet_att_<day>_<room>_t:<id>).
        // The class end = the last time anyone in the room left (or now, if it's still going).
        const aDay = /^\d{4}-\d{2}-\d{2}$/.test(String(b.day || '')) ? String(b.day) : etDay()
        const { data: att } = await sb.from('app_settings').select('key, value').like('key', `meet_att_${aDay}_${room.slug}_%`)
        const attBy = {}
        let classEnd = 0
        for (const x of att || []) {
          let v = null; try { v = typeof x.value === 'string' ? JSON.parse(x.value) : x.value } catch { continue }
          const joins = (v?.joins || []).filter((j) => j.in)
          for (const j of joins) classEnd = Math.max(classEnd, j.out ? Date.parse(j.out) : Date.now())
          const id = String(v?.identity || '').startsWith('t:') ? v.identity.slice(2) : null
          if (id) attBy[id] = { joins, camera: v.camera || [] }
        }
        for (const r of rows) {
          const a = attBy[r.id]
          if (!a || !a.joins.length) continue
          const first = Date.parse(a.joins[0].in), lastOut = a.joins[a.joins.length - 1].out
          const mins = Math.round(a.joins.reduce((n, j) => n + ((j.out ? Date.parse(j.out) : Date.now()) - Date.parse(j.in)), 0) / 60000)
          const camOn = (a.camera || []).find((c) => c.on)
          r.today = { joined: a.joins[0].in, left: lastOut, stayed: !lastOut || Date.parse(lastOut) >= classEnd - 3 * 60000, drops: a.joins.length - 1, minutes: mins, camera_on: camOn ? camOn.at : null, class_end: classEnd ? new Date(classEnd).toISOString() : null, first_ms: first }
        }
        for (const r of rows) {
          if (liveIds.has(r.id)) r.now = { state: 'in', live: true }
          else if (seenBy[r.id]) r.now = { ...seenBy[r.id], state: seenBy[r.id].state === 'in' ? 'left' : seenBy[r.id].state }
          else r.now = null
        }
      }
      if (room.kind === 'oneoff') {
        // Everyone's RSVP.
        const { data: rs } = await sb.from('app_settings').select('key, value').like('key', `meet_rsvp_${room.slug}_%`)
        const rsvp = Object.fromEntries((rs || []).map((x) => { try { return [x.key.slice(`meet_rsvp_${room.slug}_`.length), JSON.parse(x.value)] } catch { return [x.key, null] } }))
        for (const r of rows) r.rsvp = rsvp[r.id] || null
      }
      if (b.action === 'audience' && room.kind === 'training' && room.training_week === 'B') {
        // Each trainee's Week A field-day average, so the office can see who qualifies.
        const { data: info } = await sb.from('trainees').select('id, first_name, last_name, phone, week_b_force, classes!class_id(week_start_date)').in('id', rows.map((r) => r.id))
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
        if (room.kind === 'oneoff' && !String(b.message || '').trim()) b.message = `Hi {first}, you're invited to ${room.title} on ${when} (Eastern). 👉 Please CONFIRM: tap your link and press ✅ I'll be there (or ❌ Can't make it): {link}`
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
  // 🔀 COMBINED TODAY: this room's people go to another team's room (redirect on the page).
  const mergedInto = room.merge && room.merge.date === etDay() ? room.merge.into : null
  if (b.action === 'info') return json(200, { ok: true, room: { ...publicRoom(room), training_week: room.training_week || null, merged_into: mergedInto, ...(await openState(room)) }, host_code: !!room.host_code })

  if (b.action === 'join') {
    // WHERE EVERYONE IS (Neal, 2026-10-05: "I can see that they're in the room, doing their onboarding
    // paperwork, paperwork's complete, they're in the lobby"). Each trainee's latest step on this room
    // today, for the People panel: meet_seen_<room>_<trainee id> = { state, step, at }.
    const mark = (state, step = '') => (String(identity || '').startsWith('t:') ? Promise.resolve(putSetting(`meet_seen_${room.slug}_${identity.slice(2)}`, { state, step, at: new Date().toISOString(), day: etDay() })).catch(() => {}) : Promise.resolve())
    let name = null, identity = null, host = false, isRetrainee = false, busyAs = null
    const admin = await verifyPin(b.pin)
    // Each device gets its own seat — the same identity twice would kick the first device out.
    const seat = () => Math.random().toString(36).slice(2, 7)
    // ?as=attendee (Neal, 2026-10-05: "as admin, we should have the ability to join the meeting. But
    // not as a host"): an admin PIN joins as a plain attendee, with no host controls.
    const asAttendee = !!admin && !!b.attendee
    if (admin) { name = admin; identity = asAttendee ? `a:${slugify(admin)}:${seat()}` : `host:${admin}:${seat()}`; host = !asAttendee; if (!asAttendee) busyAs = admin }
    // The trainer's first arrival today starts the 2-minute door (training rooms).
    if (admin && !asAttendee && room.kind === 'training' && !(await getSetting(`meet_hostin_${room.slug}_${etDay()}`, null))) await putSetting(`meet_hostin_${room.slug}_${etDay()}`, { at: new Date().toISOString(), by: admin })
    else if (room.host_code && sameCode(b.host_code, room.host_code)) {
      name = String(b.name || '').trim().slice(0, 60) || 'Host'; identity = `host:${slugify(name)}:${seat()}`; host = true; busyAs = name
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
      const x = outsiderOf(b.g); name = x.name || 'Guest'; identity = `x:${x.key}`; host = !!x.host; if (x.host) busyAs = name // a My Tools caller's own seat — outside people never get host (so never the host notes), even in a no-host room
    } else {
      const t = await traineeByToken(b.t)
      if (t) {
        name = fullName(t) || 'Guest'; identity = `t:${t.id}`; host = isRoomHost(room, t) || (!!room.no_host && room.kind !== 'training') // 👥 no-host room: everyone has the controls
        // 🎥 IN A MEETING banner (see busy_now): real hosts, managers, Neal and DeWayne — not reps.
        if (isRoomHost(room, t) || t.managed_region || LEADERS.some((l) => l.id === t.id)) busyAs = name
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
          // Same one-day switch lifts the late lock too (Neal, 2026-10-05: "let them in" — a link bug
          // kept the class out until after start).
          const lock = (await getSetting(`onboarding_gate_off_${etDay()}`, false)) ? null : await getSetting(`meet_hostin_${room.slug}_${etDay()}`, null)
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
          // TODAY'S SWITCH (Neal, 2026-10-05, 1:50 PM: nobody had done their paperwork 10 minutes before
          // class): app_settings onboarding_gate_off_<YYYY-MM-DD> = true lets trainees in without it
          // for that day only. They still owe the paperwork; it's back on tomorrow by itself.
          const gateOff = !!(await getSetting(`onboarding_gate_off_${etDay()}`, false))
          const { data: ob } = gateOff ? { data: { signed_at: new Date().toISOString(), banking_completed_at: 'skip', comp_signed_at: 'skip' } } : await sb.from('trainee_onboarding').select('signed_at, banking_completed_at, comp_signed_at').eq('trainee_id', t.id).maybeSingle()
          // BANKING (Neal, 2026-10-04): okay to skip on the day they sign; from the NEXT day on,
          // no training until their direct deposit details are in.
          if (ob?.signed_at && !ob.banking_completed_at && etDay(Date.parse(ob.signed_at)) < etDay()) {
            const ok2 = b._direct !== false
            if (!ok2) await fetch(`${SITE}/.netlify/functions/send-onboarding-sms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trainee_id: t.id }) }).catch(() => {})
            await mark('paperwork', 'Direct deposit')
            return json(200, { ok: false, onboarding: true, banking: true, first: t.first_name || '', onboarding_url: ok2 ? `/onboarding/${String(b.t).trim()}?back=${encodeURIComponent(`/meet/${room.slug}?t=${String(b.t).trim()}`)}` : null })
          }
          if (!ob?.signed_at) {
            // Signed in with their own link or a matching email → open the paperwork right here
            // (Neal, 2026-10-04: "they're signing in anyways"). Otherwise send it by text + email.
            const direct = b._direct !== false && (b._direct === true || !!String(b.t || '').trim())
            if (direct) {
              await mark('paperwork', 'ICA + W-9')
              return json(200, { ok: false, onboarding: true, first: t.first_name || '', onboarding_url: `/onboarding/${String(b.t).trim()}?back=${encodeURIComponent(`/meet/${room.slug}?t=${String(b.t).trim()}`)}` })
            }
            await fetch(`${SITE}/.netlify/functions/send-onboarding-sms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trainee_id: t.id }) }).catch(() => {})
            await mark('paperwork', 'ICA + W-9 (sent by text)')
            return json(200, { ok: false, onboarding: true, first: t.first_name || '' })
          }
          // PAY DOCUMENTS (Neal, 2026-10-05: onboarding = ICA + W-9 + the draw and inspection
          // commission). Signed the first two but not these → straight to them, then back in.
          if (ob?.signed_at && !ob.comp_signed_at && String(b.t || '').trim()) {
            await mark('paperwork', 'Pay documents')
            return json(200, { ok: false, onboarding: true, first: t.first_name || '', onboarding_url: `/comp-agreement/${String(b.t).trim()}?back=${encodeURIComponent(`/meet/${room.slug}?t=${String(b.t).trim()}`)}` })
          }
        }
      }
    }
    if (!identity) return json(401, { ok: false, error: b.pin ? 'PIN not recognised.' : 'Open the meeting from your own link.' })
    // Not a host and no meeting on: say when the next one is instead of an empty room.
    if (!host) { const st = await openState(room); if (!st.open) { await mark('lobby'); return json(200, { ok: false, not_open: true, room: publicRoom(room) }) } }
    // 🔒 LOCKED BY THE HOST (Neal, 2026-10-07: "a button for the host that says do not allow anyone else in … if I'm the
    // host, I don't want anybody else coming in. The only way another host can come in is if I do it in the setup saying
    // there's more than one host"). Nobody new gets in — not even another manager or an admin with the PIN — except the
    // one who locked it and the hosts named in Meeting Room Setup. Someone already in today can rejoin after a drop.
    // Clears itself at the end of the day.
    {
      const lk = await getSetting(`meet_lock_${room.slug}_${etDay()}`, null)
      const first = (x) => String(x || '').trim().split(/\s+/)[0].toLowerCase()
      const named = new Set([...(room.hosts || []), ...(room.host_names || []), ...LEADERS.filter((l) => (room.also || []).includes(l.key)).map((l) => l.name), lk?.by].map(first).filter(Boolean))
      if (lk?.on && !named.has(first(name))) {
        const { data: seen } = await sb.from('app_settings').select('key').eq('key', `meet_att_${etDay()}_${room.slug}_${identity}`).maybeSingle()
        if (!seen) return json(200, { ok: false, locked: true, title: 'This meeting is locked', message: 'The host has closed this meeting to anyone new. If you should be in it, contact the host.' })
      }
    }
    // Training room, class in session: this join IS today's sign-in (same row the kiosk writes).
    if (room.kind === 'training' && !host && !isRetrainee && identity.startsWith('t:')) {
      const { data: tr } = await sb.from('trainees').select('class_id, is_field_trainee, is_active_sales_rep, classes!class_id(week_start_date)').eq('id', identity.slice(2)).maybeSingle()
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
    const at = new AccessToken(key, secret, { identity, name, ttl: '6h', metadata: JSON.stringify({ host, ...(busyAs ? { busy: busyAs } : {}) }) })
    // 🔇 LOCKED MICS (Neal, 2026-10-05: "when people show up for training their microphones are
    // muted and they cannot unmute. I am the only one that can unmute"). Non-hosts may publish
    // their camera only; the host's Unmute grants the mic (allow_mic) and Mute takes it back.
    const micLocked = !!room.mic_lock && !host
    at.addGrant({ room: room.slug, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true, roomAdmin: host, ...(micLocked ? { canPublishSources: [TrackSource.CAMERA] } : {}) })
    // Open the room with its top line already set, so the first person in sees it.
    try { await svc().createRoom({ name: room.slug, emptyTimeout: 600, metadata: JSON.stringify({ topic: room.topic || '' }) }) } catch { /* already open */ }
    await mark('in')
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
  // A My Tools caller's own seat in a call room (invitee key with host:true) is a host too.
  if (!hostOk && b.g) { const x = (room.invitees || []).find((y) => y.key && y.key === String(b.g)); hostOk = !!(x && x.host) }
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
    // 📲 🆕 NEW FLOW (Week A, Oct 6): "a button I can press that says send all trainees that are on this
    // meeting access to Door Dispatcher" (Neal, 2026-10-06). Everyone in the room right now on their own
    // trainee link (identity t:<id>), minus hosts, deduped by phone → CCG harvest-trainees grant with the
    // new-flow tag (their certification is then the one video + the test). CCG texts AND emails the link.
    if (b.action === 'dd_access_live') {
      const live = [...new Set((await svc().listParticipants(room.slug).catch(() => [])).map((p) => String(p.identity || '')).filter((i) => i.startsWith('t:')).map((i) => i.slice(2)))]
      if (!live.length) return json(200, { ok: true, results: [], note: 'No trainees are in the meeting right now.' })
      const { data: ppl } = await sb.from('trainees').select('id, first_name, last_name, phone, email, company_email, managed_region').in('id', live)
      const seen = new Set(), results = []
      for (const p of ppl || []) {
        if (isRoomHost(room, p)) continue
        const name = fullName(p), ph = String(p.phone || '').replace(/\D/g, '').slice(-10)
        if (ph.length !== 10) { results.push({ name, ok: false, error: 'no phone number on file' }); continue }
        if (seen.has(ph)) continue
        seen.add(ph)
        const r = await fetch('https://free-roof-inspections.netlify.app/.netlify/functions/harvest-trainees', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'grant', name, phone: p.phone, email: p.email || p.company_email || '', flow: 'weekA-new-2026-10-06', key: process.env.DIRECTORY_KEY }) })
          .then((x) => x.json()).catch((e) => ({ ok: false, error: e.message }))
        results.push({ name, ok: !!r.ok, sms: !!r.sent, email: !!r.emailed, error: r.ok ? '' : (r.error || 'failed') })
      }
      return json(200, { ok: true, results })
    }
    // 📊 PRESENT: { key, pos:{h,v,f}|{n}, showing, by } or null — the trainer's deck and where it is.
    // 📝 HOST NOTES / TELEPROMPTER (DeWayne via Neal, 2026-10-06): the host's own notes for this room —
    // only ever sent to a host (this whole block is host-only), never to attendees. One per room.
    // NOTES BY DATE (Neal, 2026-10-06: "these notes are for Tuesday, October 6th … plan ahead a bunch of
    // days"). day = 'YYYY-MM-DD' → that meeting's notes; no day → the room's "every meeting" notes.
    // Also returns which days already have notes, so the panel can list them.
    const notesKey = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? `meet_notes_${room.slug}_${d}` : `meet_notes_${room.slug}`
    // 🔗 SHARE for invite / call rooms (Neal, 2026-10-06: shared the room's plain link with Nick from a call
    // and it asked him for a PIN). Hosts get each invited outsider's OWN link (…?g=<key>), which never does.
    if (b.action === 'share_links') return json(200, { ok: true, people: (room.invitees || []).filter((x) => x.key && !x.host).map((x) => ({ name: x.name || 'Guest', link: `${SITE}/meet/${room.slug}?g=${x.key}` })) })
    if (b.action === 'get_notes') {
      const { data: ks } = await sb.from('app_settings').select('key').like('key', `meet_notes_${room.slug}_%`)
      const days = (ks || []).map((x) => x.key.slice(`meet_notes_${room.slug}_`.length)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= etDay()).sort()
      return json(200, { ok: true, notes: await getSetting(notesKey(b.day), { text: '' }), days })
    }
    if (b.action === 'set_notes') {
      const notes = { text: String(b.text || '').slice(0, 30000), by: String(b.by || '').slice(0, 60), at: new Date().toISOString() }
      await putSetting(notesKey(b.day), notes)
      return json(200, { ok: true, notes })
    }
    if (b.action === 'set_deck') {
      const dk = b.deck && typeof b.deck.key === 'string' ? { key: b.deck.key.slice(0, 20), pos: b.deck.pos && typeof b.deck.pos === 'object' ? { h: Number(b.deck.pos.h) || 0, v: Number(b.deck.pos.v) || 0, f: Number.isFinite(Number(b.deck.pos.f)) ? Number(b.deck.pos.f) : -1, n: Number(b.deck.pos.n) || 0, t: Math.max(0, Number(b.deck.pos.t) || 0), play: !!b.deck.pos.play } : null, showing: !!b.deck.showing, by: String(b.identity || '').slice(0, 80) } : null
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
      await setMeta({ stage, stage_auto: !!b.auto && stage.length > 0, ...(b.auto_off !== undefined ? { auto_off: !!b.auto_off } : {}) })
      return json(200, { ok: true, stage })
    }
    // How the presenter's camera sits beside slides / scripture (Neal, 2026-10-05): circle (small, in
    // the corner) | split (half and half) | stack_top (you on top) | stack_bottom (you underneath).
    if (b.action === 'set_lock') {
      const on = !!b.on
      await putSetting(`meet_lock_${room.slug}_${etDay()}`, { on, by: String(b.by || '').slice(0, 60), at: new Date().toISOString() })
      await setMeta({ locked: on })
      return json(200, { ok: true, locked: on })
    }
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
      // Recording to the host's own computer works in every room (Neal, 2026-10-06); the cloud recorder
      // still needs the room's recording turned on.
      if (!room.recording_enabled && !b.local && b.action === 'record_start') return json(400, { ok: false, error: 'Recording is not turned on for this room.' })
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
      // 💻 HOST-COMPUTER recording: same mute + speaker view for everyone, but the host's browser records
      // and saves the file — nothing is sent to the recording service.
      if (room.rec_where === 'host' || b.local) {
        for (const p of list) if (!meta(p).host && !/^(egress|homeowner)/.test(p.identity)) { try { await muteMic(p); mutedN++ } catch { /* left */ } }
        await setMeta({ recording: true, recording_local: true, spotlight: String(b.identity || '') })
        return json(200, { ok: true, recording: true, local: true, note: `⏺ Recording to your computer. ${mutedN ? `Muted ${mutedN} ${mutedN === 1 ? 'person' : 'people'}.` : ''}`.trim() })
      }
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
