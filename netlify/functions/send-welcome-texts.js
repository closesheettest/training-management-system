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
import { renderTemplate } from './_templates.js'

const MAX_DAYS = 7
const MIN_HOURS_BETWEEN = 18

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

  // Pull candidate reps. Trigger changed (2026-06-02): we now key off
  // region (zone assigned by trainer), not test_attempts.submitted_at.
  const { data: trainees, error } = await supabase
    .from('trainees')
    .select(
      'id, first_name, phone, region, welcome_texts_sent, last_welcome_text_at',
    )
    .eq('enrolled', true)
    .is('declined_at', null)
    .not('phone', 'is', null)
    .not('region', 'is', null)
    .lt('welcome_texts_sent', MAX_DAYS)
  if (error) return json(500, { error: `Supabase: ${error.message}` })

  const results = []
  for (const t of trainees || []) {
    if (t.last_welcome_text_at) {
      const lastMs = new Date(t.last_welcome_text_at).getTime()
      if (lastMs > cutoffMs) continue // already texted within the last 18h
    }

    // Per-zone Zoom — fall back to "(coming soon)" if this zone's
    // manager hasn't sent Neal a link yet. The user-facing string here
    // is what shows up in the SMS where {salesMeetingZoom} appears.
    const zoneZoom = zoomByRegion.get(t.region) || '(Zoom coming soon — check the dashboard)'

    const dayNumber = (t.welcome_texts_sent || 0) + 1
    const message = await renderTemplate(supabase, 'welcome_drip', {
      firstName: t.first_name || 'there',
      link: welcomeLink,
      dayNumber,
      salesMeetingZoom: zoneZoom,
      region: t.region,
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
