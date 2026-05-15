// Daily cron — texts each newly-graduated rep a link to /welcome for
// 7 consecutive days. Goal: cut down on the "where do I find X" calls
// during their first week by drilling the link into their texts.
//
// Eligibility (a trainee gets a text on a given day if ALL true):
//   - enrolled = true
//   - declined_at IS NULL
//   - phone is set
//   - test_attempts row exists with submitted_at NOT NULL (they graduated)
//   - welcome_texts_sent < 7
//   - last_welcome_text_at is NULL OR was more than 18 hours ago
//     (prevents same-day double-send if cron fires twice somehow)
//   - submitted_at >= 14 days ago (sanity floor — don't text a trainee
//     who graduated months ago if for some reason their count is stuck
//     at < 7)
//
// On send: increment welcome_texts_sent + stamp last_welcome_text_at.
//
// Auth: ?secret=<CRON_SECRET> or X-Cron-Secret header.

import { createClient } from '@supabase/supabase-js'
import { sendSmsViaGhl } from './_ghl.js'
import { renderTemplate } from './_templates.js'

const MAX_DAYS = 7
const MIN_HOURS_BETWEEN = 18
const STALE_AFTER_DAYS = 14

export const handler = async (event) => {
  const provided =
    event.headers['x-cron-secret'] ||
    event.headers['X-Cron-Secret'] ||
    event.queryStringParameters?.secret
  if (!process.env.CRON_SECRET || provided !== process.env.CRON_SECRET) {
    return json(401, { error: 'Unauthorized' })
  }

  const missing = []
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'GHL_PIT_TOKEN', 'GHL_LOCATION_ID']) {
    if (!process.env[k]) missing.push(k)
  }
  if (missing.length) return json(500, { error: `Missing env vars: ${missing.join(', ')}` })

  const params = event.queryStringParameters || {}
  const dryRun = params.dry_run === '1' || params.dry_run === 'true'

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const siteUrl = (process.env.PUBLIC_SITE_URL || process.env.URL || process.env.DEPLOY_URL || 'https://trainingmanagementsys.netlify.app').replace(/\/$/, '')
  const welcomeLink = `${siteUrl}/welcome`

  const nowMs = Date.now()
  const cutoffMs = nowMs - MIN_HOURS_BETWEEN * 3600 * 1000
  const staleAfterMs = nowMs - STALE_AFTER_DAYS * 24 * 3600 * 1000

  // Pull candidates. We over-fetch and filter in JS because the test
  // submission status lives on test_attempts (nested), not directly on
  // trainees.
  const { data: trainees, error } = await supabase
    .from('trainees')
    .select(
      'id, first_name, phone, welcome_texts_sent, last_welcome_text_at, test_attempts(submitted_at)',
    )
    .eq('enrolled', true)
    .is('declined_at', null)
    .not('phone', 'is', null)
    .lt('welcome_texts_sent', MAX_DAYS)
  if (error) return json(500, { error: `Supabase: ${error.message}` })

  const results = []
  for (const t of trainees || []) {
    const submittedAt = (t.test_attempts || [])
      .map((a) => a.submitted_at)
      .filter(Boolean)
      .sort()
      .pop()
    if (!submittedAt) continue // hasn't graduated
    const submittedMs = new Date(submittedAt).getTime()
    if (submittedMs < staleAfterMs) continue // graduated too long ago

    if (t.last_welcome_text_at) {
      const lastMs = new Date(t.last_welcome_text_at).getTime()
      if (lastMs > cutoffMs) continue // already texted within the last 18h
    }

    const dayNumber = (t.welcome_texts_sent || 0) + 1
    const message = await renderTemplate(supabase, 'welcome_drip', {
      firstName: t.first_name || 'there',
      link: welcomeLink,
      dayNumber,
    })

    if (dryRun) {
      results.push({
        trainee_id: t.id,
        dry_run: true,
        day_number: dayNumber,
        preview: message,
      })
      continue
    }

    const sms = await sendSmsViaGhl(t.phone, message, {
      firstName: t.first_name || 'Trainee',
      lastName: 'Welcome',
    })
    if (!sms.ok) {
      results.push({ trainee_id: t.id, ok: false, error: sms.error, step: sms.step })
      continue
    }

    await supabase
      .from('trainees')
      .update({
        welcome_texts_sent: dayNumber,
        last_welcome_text_at: new Date().toISOString(),
      })
      .eq('id', t.id)

    results.push({ trainee_id: t.id, ok: true, day_number: dayNumber })
  }

  return json(200, {
    candidates: (trainees || []).length,
    fired: results.filter((r) => r.ok || r.dry_run).length,
    results,
  })
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
