// cron-weekly-report-reminder.js
//
// Thursday evening (≈6 PM ET): text every regional manager a reminder to
// complete their Weekly Rep Report, due Friday morning. The text carries a
// deep link straight to their own dashboard (where the Weekly Report panel
// lives) — same /regional-manager/:token URL they already use.
//
// Schedule: "0 22,23 * * 4" (Thursday). 22:00 UTC = 6 PM EDT, 23:00 UTC = 6 PM
// EST — so the function fires twice but an ET-hour==18 guard lets exactly ONE
// of them through year-round (DST-safe, same trick as the other ET crons).
//
// Manual GET = dry run (no SMS) unless ?send=1 — and the hour guard is skipped
// for manual runs so it can be tested any time.
//
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY, SITE_URL (defaults to the prod URL).

import { createClient } from '@supabase/supabase-js'
import { sendSmsViaGhl } from './_ghl.js'
import { sendEmail } from './_email.js'

const SB_URL = process.env.SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SECRET_KEY
const SITE_URL = process.env.SITE_URL || 'https://trainingmanagementsys.netlify.app'

export const handler = async (event) => {
  if (!SB_URL || !SB_KEY) return json(500, { ok: false, error: 'Missing SUPABASE env vars' })
  const isManual = event && event.httpMethod === 'GET'
  const qp = (event && event.queryStringParameters) || {}
  const willSend = isManual ? ['1', 'true', 'yes'].includes(String(qp.send || '').toLowerCase()) : true

  // DST-safe single fire: only proceed when it's the 6 PM ET hour (scheduled
  // runs only — manual runs skip the guard so they can be tested any time).
  if (!isManual) {
    const etHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(new Date()))
    if (etHour !== 18) return json(200, { ok: true, skipped: `ET hour ${etHour}, not 18` })
  }

  const supabase = createClient(SB_URL, SB_KEY)

  // Every manager: a trainee with a managed_region, an access token, and a phone.
  const { data: managers, error } = await supabase
    .from('trainees')
    .select('first_name, last_name, phone, email, managed_region, manager_access_token')
    .not('managed_region', 'is', null)
    .not('manager_access_token', 'is', null)
  if (error) return json(500, { ok: false, error: error.message })

  const results = []
  for (const m of (managers || [])) {
    const phone = (m.phone || '').trim()
    const email = (m.email || '').trim()
    const name = `${m.first_name || ''} ${m.last_name || ''}`.trim()
    if (!phone && !email) { results.push({ name, zone: m.managed_region, skipped: 'no phone or email' }); continue }
    const link = `${SITE_URL}/regional-manager/${encodeURIComponent(m.manager_access_token)}`
    const message =
      `📋 ${m.first_name || 'Hey'} — your Weekly Rep Report for ${m.managed_region} is due FRIDAY MORNING. ` +
      `Fill it out for each of your reps here: ${link}`
    if (!willSend) { results.push({ name, zone: m.managed_region, would_text: phone || null, would_email: email || null }); continue }
    // Send by BOTH email and SMS — email is the reliable backstop for managers
    // whose SMS is DND/opted-out in GHL. Success = at least ONE channel went out.
    const channels = []
    const errors = []
    if (email) {
      try {
        const r = await sendEmail(email, `Weekly Rep Report due Friday — ${m.managed_region}`, message)
        if (r && r.ok !== false) channels.push('email')
        else errors.push('email: ' + (r?.error || 'failed'))
      } catch (e) { errors.push('email: ' + (e.message || 'error')) }
    }
    if (phone) {
      try {
        await sendSmsViaGhl(phone, message, { firstName: m.first_name || 'Manager', lastName: m.last_name || '' })
        channels.push('sms')
      } catch (e) { errors.push('sms: ' + (e.message || 'failed')) }
    }
    if (channels.length) {
      results.push({ name, zone: m.managed_region, channels, texted: phone || null, emailed: email || null })
    } else {
      results.push({ name, zone: m.managed_region, error: errors.join('; ') || 'send failed' })
    }
  }

  return json(200, { ok: true, sent: willSend, count: results.length, results })
}

function json(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

export const config = { schedule: '0 22,23 * * 4' }
