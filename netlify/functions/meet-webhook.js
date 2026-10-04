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
import { sendEmail } from './_email.js'

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

  // RECORDING FINISHED → mark it ready and email the room's recipients a download link (the
  // 9:15 Devotional → DeWayne's cousin, who edits it). Link good for 7 days; the room card's
  // 🎞 Recordings list always has a fresh one.
  if (ev.event === 'egress_ended' && ev.egressInfo) {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
    const info = ev.egressInfo, slug = info.roomName
    const get = async (k) => { const { data } = await sb.from('app_settings').select('value').eq('key', k).maybeSingle(); try { return data ? JSON.parse(data.value) : null } catch { return null } }
    const logKey = `meet_recordings_${slug}`
    const log = (await get(logKey)) || []
    const rec = log.find((x) => x.egress_id === info.egressId)
    if (!rec || rec.notified) return { statusCode: 200, body: 'ok' }
    const ok = Number(info.status) === 3 // EGRESS_COMPLETE
    rec.ended = new Date().toISOString(); rec.ready = ok; rec.error = ok ? null : (info.error || `status ${info.status}`)
    const fr = (info.fileResults || [])[0] || info.file || {}
    if (fr.duration) rec.minutes = Math.round(Number(fr.duration) / 6e10) / 1 // ns → minutes
    if (fr.size) rec.mb = Math.round(Number(fr.size) / 1048576)
    const room = ((await get('meet_rooms')) || []).find((r) => r.slug === slug)
    if (ok && room && (room.rec_to || []).length) {
      const { data } = await sb.storage.from('meeting-recordings').createSignedUrl(rec.file, 7 * 86400, { download: true })
      const when = new Date(rec.started).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' })
      const what = rec.kind === 'raw' ? 'host camera (raw, for editing)' : 'recording'
      for (const p of room.rec_to) {
        const first = (p.name || '').split(' ')[0]
        await sendEmail(p.email, `${room.title}: ${when} ${what} is ready`,
          `${first ? `Hi ${first},\n\n` : ''}The ${room.title} ${what} from ${when} is ready to download${rec.minutes ? ` (${rec.minutes} min${rec.mb ? `, ${rec.mb} MB` : ''})` : ''}:\n\n${data?.signedUrl || '(link unavailable: ask Neal)'}\n\nThis link works for 7 days. Every recording is also on the recordings page: ${room.rec_key ? `https://trainingmanagementsys.netlify.app/recordings/${room.slug}?k=${room.rec_key}` : '(ask Neal for the link)'}`,
          { fromName: room.title }).catch(() => {})
      }
      rec.notified = new Date().toISOString()
    }
    await sb.from('app_settings').upsert({ key: logKey, value: JSON.stringify(log), updated_at: new Date().toISOString() }, { onConflict: 'key' })
    return { statusCode: 200, body: 'ok' }
  }

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
