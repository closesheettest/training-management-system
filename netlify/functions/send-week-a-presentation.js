// netlify/functions/send-week-a-presentation.js
//
// THE WORKER. Sends the full presentation audio to Week A trainees on the
// Wednesday they leave at noon, so they have the whole pitch to listen to on
// the drive home and over the rest of the week.
//
// Must NOT be scheduled — Netlify 403s HTTP calls to a scheduled function, and
// this one has to stay callable so it can be tested on a non-Wednesday and
// re-fired by hand. The schedule lives in cron-week-a-presentation.js.
//
//   GET  ?dry_run=1        who WOULD get it, sends nothing
//   GET  ?force=1          ignore the Wednesday/noon gate (testing)
//   GET  ?class_id=<uuid>  limit to one class
//
// Idempotent: presentation_sent_at on the trainee row. Re-firing is a no-op.
// One-time: run sql/week_a_presentation.sql.
//
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN, GHL_LOCATION_ID,
//      optional PRESENTATION_AUDIO_URL.

import { createClient } from '@supabase/supabase-js'
import { sendSmsViaGhl } from './_ghl.js'
import { sendEmail } from './_email.js'

// Uploaded through /upload-audio. Overridable by env so a re-recorded version
// can be swapped in without a deploy.
const AUDIO_URL = process.env.PRESENTATION_AUDIO_URL
  || 'https://yfmzktvmlfeqcubnvhxr.supabase.co/storage/v1/object/public/training-audio/full-presentation.mp3'

const WEDNESDAY = 3

// The live rep dashboard (the Google Site referenced in the IC agreement).
const REP_DASHBOARD = process.env.REP_DASHBOARD_URL || 'https://sites.google.com/shingleusa.com/repdashboard/home'

// Regional managers live in the CCG database, joined by zone string.
// Week A trainees have no zone yet — it's assigned at activation — so the
// message lists ALL FOUR rather than guessing. Once a trainee IS assigned a
// zone, they get theirs alone.
//
// Sends NAME, PHONE and EMAIL only. `token` in that table is a manager's
// private dashboard key and must never reach a trainee.
async function loadManagers(zone) {
  const url = process.env.CCG_SUPABASE_URL, key = process.env.CCG_SUPABASE_ANON_KEY
  if (!url || !key) return []
  try {
    const r = await fetch(`${url}/rest/v1/regional_managers?select=zone,name,phone,email&order=zone`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    if (!r.ok) return []
    const all = await r.json()
    const mine = zone ? all.filter((m) => m.zone === zone) : []
    return mine.length ? mine : all
  } catch { return [] }
}

// "+19045608819" reads as a machine. Trainees have to be able to dial it.
function prettyPhone(p) {
  const d = String(p || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : (p || '')
}

export const handler = async (event) => {
  const qp = (event && event.queryStringParameters) || {}
  const dryRun = /^(1|true|yes)$/i.test(qp.dry_run || '')
  const force = /^(1|true|yes)$/i.test(qp.force || '')

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const todayIso = etToday()
  const dow = dayOfWeekEt(todayIso)

  if (!force && dow !== WEDNESDAY) {
    return json(200, { ok: true, skipped: 'not Wednesday', today: todayIso })
  }

  // Week A classes: the class's own Monday is this week's Monday. A two-week
  // class is in Week B by its second Monday, and Week B must not get this.
  let q = supabase
    .from('classes')
    .select('id, region, week_start_date, week_end_date')
    .lte('week_start_date', todayIso)
    .gte('week_end_date', todayIso)
  if (qp.class_id) q = q.eq('id', qp.class_id)
  const { data: classes, error: cErr } = await q
  if (cErr) return json(500, { ok: false, error: cErr.message })

  const results = { sent: [], skipped: [], errors: [] }

  for (const cls of classes || []) {
    const dayNumber = daysBetween(cls.week_start_date, todayIso) + 1
    // Day 3 of Week A. Past day 5 we're into Week B of a two-week class.
    if (!force && dayNumber !== 3) {
      results.skipped.push({ class_id: cls.id, reason: `day ${dayNumber}, not Week A Wednesday` })
      continue
    }

    // Only trainees who were actually here today. Same strict-attendance rule
    // the homework send uses — a no-show isn't continuing.
    const { data: attendance, error: aErr } = await supabase
      .from('attendance')
      .select('trainee_id, trainees(id, first_name, last_name, phone, email, presentation_sent_at)')
      .eq('class_id', cls.id)
      .eq('attendance_date', todayIso)
      .eq('confirmed', true)
    if (aErr) { results.errors.push({ class_id: cls.id, error: aErr.message }); continue }
    if (!attendance?.length) { results.skipped.push({ class_id: cls.id, reason: 'nobody attended today' }); continue }

    for (const row of attendance) {
      const t = row.trainees
      if (!t) continue
      const who = `${t.first_name || ''} ${t.last_name || ''}`.trim()
      if (t.presentation_sent_at && !force) { results.skipped.push({ who, reason: 'already sent' }); continue }
      if (!t.phone && !t.email) { results.skipped.push({ who, reason: 'no phone or email' }); continue }

      const firstName = t.first_name || 'there'
      const managers = await loadManagers(t.region)
      const mgrBlock = managers.length
        ? '\n\n' + (managers.length === 1 ? 'Your manager:' : 'Your regional managers:') + '\n' +
          managers.map((m) => `${m.name}${m.zone ? ` (${m.zone})` : ''} — ${prettyPhone(m.phone)}${m.email ? ` · ${m.email}` : ''}`).join('\n')
        : ''
      const message =
        `${firstName} — here's the full presentation, start to finish.\n\n` +
        `Listen to it on the way home and again this week. The words matter: ` +
        `learn it the way it's delivered, not your own version of it.\n\n` +
        `${AUDIO_URL}` +
        `\n\nRep dashboard — pay structure, forms and everything else:\n${REP_DASHBOARD}` +
        mgrBlock

      if (dryRun) { results.sent.push({ who, dry_run: true, phone: !!t.phone, email: !!t.email }); continue }

      // BOTH channels — SMS alone misses anyone opted-out or on DND.
      const channels = []
      if (t.email) {
        try {
          const er = await sendEmail(t.email, 'The full presentation — U.S. Shingle & Metal', message)
          if (er && er.ok !== false) channels.push('email')
        } catch { /* best-effort */ }
      }
      if (t.phone) {
        const sr = await sendSmsViaGhl(t.phone, message, { firstName, lastName: t.last_name || '' })
        if (sr.ok) channels.push('sms')
        else results.errors.push({ who, error: sr.error })
      }

      if (!channels.length) { results.skipped.push({ who, reason: 'both channels failed' }); continue }

      // Stamp ONLY after something actually landed. Stamping first would mark
      // a trainee done on a send that never happened, and nothing would retry.
      const { error: uErr } = await supabase
        .from('trainees')
        .update({ presentation_sent_at: new Date().toISOString() })
        .eq('id', t.id)
      if (uErr) results.errors.push({ who, error: `sent but not stamped: ${uErr.message}` })
      results.sent.push({ who, channels })
    }
  }

  return json(200, { ok: true, today: todayIso, audio: AUDIO_URL, dry_run: dryRun, ...results,
    counts: { sent: results.sent.length, skipped: results.skipped.length, errors: results.errors.length } })
}

function etToday() {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
  return f.format(new Date())
}
function dayOfWeekEt(isoDate) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' })
  return ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 })[f.format(new Date(isoDate + 'T17:00:00Z'))] ?? null
}
function daysBetween(fromIso, toIso) {
  return Math.round((new Date(toIso + 'T00:00:00Z') - new Date(fromIso + 'T00:00:00Z')) / 86400000)
}
function json(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body, null, 2) }
}
