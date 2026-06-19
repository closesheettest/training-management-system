// Daily cron — texts each newly-zone-assigned rep a link to /welcome
// for 7 consecutive days. Goal: cut down on the "where do I find X"
// calls during their first week by drilling the link into their texts.
//
// Trigger change (2026-06-02 per Neal): the drip now starts when the
// TRAINER ASSIGNS A ZONE (region IS NOT NULL), not when the trainee
// graduates. Reps usually get zoned at or just before grad, so the
// effective start time is similar — but this lets the very first
// welcome SMS already carry the rep's per-zone Sales Meeting Zoom URL.
//
// The Zoom URL comes from the regional manager's trainees row
// (manager_zoom_url, where managed_region = the rep's region). If the
// zone's Zoom hasn't been set yet (Zones 1-3 as of 2026-06-02 — Neal
// is still waiting on Tony / Richard / Chad's links), the SMS shows
// "(coming soon)" so the rest of the welcome content still flows.
//
// Eligibility (a trainee gets a text on a given day if ALL true):
//   - enrolled = true
//   - declined_at IS NULL
//   - phone is set
//   - region is set (zone assigned by trainer)
//   - welcome_texts_sent < 7
//   - last_welcome_text_at is NULL OR was more than 18 hours ago
//     (prevents same-day double-send if cron fires twice)
//
// On send: increment welcome_texts_sent + stamp last_welcome_text_at.
//
// Auth: ?secret=<CRON_SECRET> or X-Cron-Secret header.

import { createClient } from '@supabase/supabase-js'
import { sendSmsViaGhl } from './_ghl.js'
import { sendEmail } from './_email.js'
import { renderTemplate } from './_templates.js'

const MAX_DAYS = 7
const MIN_HOURS_BETWEEN = 18

// Native Netlify SCHEDULED function (daily 14:00 UTC = 10 AM EDT) — same
// model as the leaderboard texts, so it no longer depends on cron-job.org +
// a secret (which kept getting the wrong secret / auto-disabled). Auth is now
// permissive like the leaderboard crons: a WRONG secret is rejected, but
// scheduled runs (and no-secret calls) are allowed. Harm is bounded — the
// graduation gate + 18h guard mean at most a recent grad gets one extra text.
export const config = { schedule: '0 14 * * *' }

export const handler = async (event) => {
  const provided =
    event?.headers?.['x-cron-secret'] ||
    event?.headers?.['X-Cron-Secret'] ||
    event?.queryStringParameters?.secret
  if (provided && process.env.CRON_SECRET && provided !== process.env.CRON_SECRET) {
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

  // Pre-fetch the per-zone Sales Meeting Zoom URLs from each regional
  // manager's trainees row. Map keyed by managed_region (e.g. "Zone 1").
  // Reps in zones whose manager_zoom_url is NULL get a "(coming soon)"
  // fallback so the rest of the welcome text still goes out.
  const { data: managers, error: mgrErr } = await supabase
    .from('trainees')
    .select('managed_region, manager_zoom_url')
    .not('managed_region', 'is', null)
  if (mgrErr) return json(500, { error: `Supabase managers: ${mgrErr.message}` })
  const zoomByRegion = new Map()
  for (const m of managers || []) {
    if (m.managed_region && m.manager_zoom_url) {
      zoomByRegion.set(m.managed_region, m.manager_zoom_url)
    }
  }

  // GRADUATION WINDOW — the drip is ONLY for reps who passed the final test
  // in the last 7 days (one welcome/day for 7 days after graduation, then it
  // stops until the next class graduates). Without this it swept in every
  // zoned rep under 7 texts (~86 people, incl. months-old grads). The
  // graduation signal is a test_attempts row (no pass/fail stored — taking
  // the final = graduating).
  const gradSince = new Date(nowMs - MAX_DAYS * 24 * 3600 * 1000).toISOString()
  const { data: attempts, error: aErr } = await supabase
    .from('test_attempts')
    .select('trainee_id, submitted_at')
    .gte('submitted_at', gradSince)
  if (aErr) return json(500, { error: `Supabase test_attempts: ${aErr.message}` })
  const recentGradIds = [...new Set((attempts || []).map((a) => a.trainee_id).filter(Boolean))]
  if (recentGradIds.length === 0) {
    return json(200, { candidates: 0, due: 0, fired: 0, note: 'no graduations in the last 7 days' })
  }

  // Candidate reps: recent graduates who still owe welcome texts.
  const { data: trainees, error } = await supabase
    .from('trainees')
    .select(
      'id, first_name, phone, email, region, welcome_texts_sent, last_welcome_text_at',
    )
    .in('id', recentGradIds)
    .eq('enrolled', true)
    .is('declined_at', null)
    // Reachable by SMS OR email (email is the backstop for DND/opted-out reps).
    .or('phone.not.is.null,email.not.is.null')
    .lt('welcome_texts_sent', MAX_DAYS)
    // Fairness: never-texted (null) first, then longest-waiting.
    .order('last_welcome_text_at', { ascending: true, nullsFirst: true })
  if (error) return json(500, { error: `Supabase: ${error.message}` })

  // Skip anyone texted within the last 18h (double-send guard).
  const due = (trainees || []).filter(
    (t) => !(t.last_welcome_text_at && new Date(t.last_welcome_text_at).getTime() > cutoffMs),
  )

  // Process ONE trainee → render + (send + stamp). Returns a result row.
  async function processOne(t) {
    const zoneZoom = zoomByRegion.get(t.region) || '(Zoom coming soon — check the dashboard)'
    const dayNumber = (t.welcome_texts_sent || 0) + 1
    const message = await renderTemplate(supabase, 'welcome_drip', {
      firstName: t.first_name || 'there',
      link: welcomeLink,
      dayNumber,
      salesMeetingZoom: zoneZoom,
      region: t.region,
    })
    if (dryRun) return { trainee_id: t.id, dry_run: true, day_number: dayNumber, preview: message }

    // Send by BOTH email and SMS. Email is the reliable backstop for reps whose
    // SMS is DND/opted-out in GHL. Success = at least ONE channel went out.
    const channels = []
    const errors = []
    if (t.email) {
      try {
        const r = await sendEmail(t.email, `Welcome to U.S. Shingle — Day ${dayNumber}`, message)
        if (r && r.ok !== false) channels.push('email')
        else errors.push('email: ' + (r?.error || 'failed'))
      } catch (e) { errors.push('email: ' + (e?.message || 'error')) }
    }
    if (t.phone) {
      const sms = await sendSmsViaGhl(t.phone, message, {
        firstName: t.first_name || 'Trainee',
        lastName: 'Welcome',
      })
      if (sms.ok) channels.push('sms')
      else errors.push('sms: ' + (sms.error || 'failed'))
    }
    if (!channels.length) return { trainee_id: t.id, ok: false, error: errors.join('; ') || 'no channel' }

    await supabase
      .from('trainees')
      .update({ welcome_texts_sent: dayNumber, last_welcome_text_at: new Date().toISOString() })
      .eq('id', t.id)
    return { trainee_id: t.id, ok: true, day_number: dayNumber, channels }
  }

  // Send in PARALLEL batches so a full class clears well within the function
  // timeout (the old one-by-one loop timed out after a handful, starving the
  // rest of the list — eligible reps sat at 0 texts forever).
  const results = []
  const CONCURRENCY = 20
  for (let i = 0; i < due.length; i += CONCURRENCY) {
    const batch = due.slice(i, i + CONCURRENCY)
    results.push(...(await Promise.all(batch.map(processOne))))
  }

  return json(200, {
    candidates: (trainees || []).length,
    due: due.length,
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
