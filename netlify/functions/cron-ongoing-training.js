// cron-ongoing-training.js — daily "Ongoing Training" send.
//
// Sends each regional manager their personal training link with THAT day's
// slide, so they can run it with their team (usually on Zoom). One slide a
// day, advancing Mon→Tue→Wed→Thu through the active curriculum.
//
// SCHEDULE: fires at 12:00 AND 13:00 UTC Mon–Thu, then only proceeds when
// it's actually 8:00 AM in America/New_York — so exactly one run lands at
// 8 AM ET whether it's EST or EDT (DST-safe).
//
// GATED by the app_settings toggle 'ongoing_training_daily_send'. Default is
// 'off' — nothing goes out until an admin flips it on (Ongoing Training page).
//
// Recipients = trainees with a managed_region (regional managers), by SMS +
// email. The link is /ongoing-training/view/<manager_access_token>?day=N,
// which logs the open + time-on-page in training_views.
//
// Required env: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN, GHL_LOCATION_ID.

import { createClient } from '@supabase/supabase-js'
import { sendSmsViaGhl } from './_ghl.js'
import { sendEmail } from './_email.js'

export const config = { schedule: '0 12,13,14 * * 1-4' } // 8, 9, 10 AM ET (3 attempts; once-per-day guard prevents double-send)

function etParts() {
  const s = new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hour12: false,
  })
  // e.g. "Mon, 08" — grab weekday + hour
  const hour = parseInt(new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }), 10)
  const weekday = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short' })
  return { hour, weekday, raw: s }
}

export const handler = async (event) => {
  const url = new URL(event.rawUrl || `https://x/${event.path || ''}`)
  const provided = url.searchParams.get('secret') || event.headers?.['x-cron-secret']
  if (provided && process.env.CRON_SECRET && provided !== process.env.CRON_SECRET) {
    return json(401, { ok: false, error: 'bad secret' })
  }
  const force = url.searchParams.get('force') === '1'

  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'GHL_PIT_TOKEN', 'GHL_LOCATION_ID']) {
    if (!process.env[k]) return json(500, { ok: false, error: `Missing env: ${k}` })
  }

  const { hour, weekday } = etParts()
  const isWorkday = ['Mon', 'Tue', 'Wed', 'Thu'].includes(weekday)
  const etToday = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) // YYYY-MM-DD, ET
  // Morning window 7–10 AM ET on a Mon–Thu. Widened (was exact 8 AM) so a Netlify
  // fire a minute early/late or the backup fires still land — the once-per-day
  // guard below makes sure only the FIRST one of the morning actually sends.
  if (!force && (!isWorkday || hour < 7 || hour > 10)) {
    return json(200, { ok: true, skipped: `outside 7-10am ET Mon-Thu (et hour ${hour}, ${weekday})` })
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  // Toggle gate.
  const { data: settingsRows } = await supabase
    .from('app_settings').select('key,value')
    .in('key', ['ongoing_training_daily_send', 'ongoing_training_next_day', 'ongoing_training_last_sent_date'])
  const settings = Object.fromEntries((settingsRows || []).map((r) => [r.key, r.value]))
  if ((settings.ongoing_training_daily_send || 'off') !== 'on') {
    return json(200, { ok: true, skipped: 'daily send toggle is OFF' })
  }
  // Once-per-day guard: several fires (8/9/10 AM) reach here; only the first sends.
  if (!force && settings.ongoing_training_last_sent_date === etToday) {
    return json(200, { ok: true, skipped: `already sent today (${etToday})` })
  }

  // Which day goes out today.
  const { data: days } = await supabase
    .from('training_days').select('position,title').eq('status', 'active').order('position', { ascending: true })
  if (!days || !days.length) return json(200, { ok: true, skipped: 'no active training days' })
  const positions = days.map((d) => d.position)
  const maxPos = Math.max(...positions)
  let nextDay = parseInt(settings.ongoing_training_next_day || '1', 10)
  if (!positions.includes(nextDay)) nextDay = positions[0] // heal a stale cursor
  const today = days.find((d) => d.position === nextDay) || days[0]
  const total = days.length

  // Recipients: regional managers (trainees with a managed_region + token).
  const { data: mgrs } = await supabase
    .from('trainees')
    .select('id, first_name, last_name, phone, email, managed_region, manager_access_token')
    .not('managed_region', 'is', null)
  const managers = (mgrs || []).filter((m) => m.manager_access_token && (m.phone || m.email))

  const siteUrl = (process.env.PUBLIC_SITE_URL || process.env.URL || process.env.DEPLOY_URL || 'https://trainingmanagementsys.netlify.app').replace(/\/$/, '')

  let smsSent = 0, emailSent = 0
  for (const m of managers) {
    const first = (m.first_name || 'there').trim()
    const link = `${siteUrl}/ongoing-training/view/${m.manager_access_token}?day=${nextDay}`
    const smsBody =
      `Good morning ${first}! Today's Ongoing Training — Day ${nextDay} of ${total}: "${today.title}". ` +
      `Open it and run it with your team: ${link}`
    const emailBody =
      `Good morning ${first},\n\n` +
      `Here's today's Ongoing Training to run with your team.\n\n` +
      `Day ${nextDay} of ${total}: ${today.title}\n\n` +
      `Open it here: ${link}\n`

    if (m.phone) {
      const r = await sendSmsViaGhl(m.phone, smsBody, { firstName: first, lastName: (m.last_name || 'Manager') })
      if (r?.ok) smsSent++
    }
    if (m.email) {
      const r = await sendEmail(m.email, `Ongoing Training — Day ${nextDay}: ${today.title}`, emailBody)
      if (r?.ok) emailSent++
    }
  }

  // Advance the cursor (wrap after the last day).
  let advanced = nextDay + 1
  if (advanced > maxPos) advanced = positions[0]
  await supabase.from('app_settings')
    .update({ value: String(advanced), updated_at: new Date().toISOString() })
    .eq('key', 'ongoing_training_next_day')
  // Stamp today so the other morning fires skip.
  await supabase.from('app_settings')
    .upsert({ key: 'ongoing_training_last_sent_date', value: etToday, updated_at: new Date().toISOString() }, { onConflict: 'key' })

  return json(200, {
    ok: true, day: nextDay, day_title: today.title, total,
    managers: managers.length, sms_sent: smsSent, email_sent: emailSent, next_day: advanced,
  })
}

function json(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) }
}
