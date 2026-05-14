// Netlify Function: daily flush of the social_post_queue.
//
// Triggered by cron-job.org once a day at 9 AM Eastern (with a small grace
// window — any item whose scheduled_post_at <= now() and posted_at IS NULL
// is eligible). Pops the OLDEST eligible item for each platform and posts
// it, stamping posted_at + post_id on success or last_error on failure.
//
// Hard cap: one item per platform per run. Prevents bursts if the cron
// fires multiple times (or if a backlog accumulated during an outage).
// The queue catches up naturally one day at a time.
//
// Auth: GET (cron) requires ?secret=<CRON_SECRET> or X-Cron-Secret header.
//
// POST mode (manual override from Messages page):
//   POST /.netlify/functions/flush-social-queue
//   Body: { platform?: 'facebook' | 'linkedin' }  // optional, default both
//   No auth required — matches the other manual admin buttons in the app
//   (mark-provisioning-complete, force-notify-it-provision, etc.).
//   Behavior: ignores scheduled_post_at and posts the oldest pending item
//   anyway (so "post the next one now" works even before its scheduled day).
//
// Required env vars: SUPABASE_URL, SUPABASE_SECRET_KEY, CRON_SECRET,
// plus the platform creds (FB_PAGE_ACCESS_TOKEN / FB_PAGE_ID,
// LINKEDIN_ACCESS_TOKEN / LINKEDIN_PERSON_URN) which the helpers check.

import { createClient } from '@supabase/supabase-js'
import { postToFacebookPage } from './_facebook.js'
import { postToLinkedIn } from './_linkedin.js'

export const handler = async (event) => {
  // Mode detection:
  //   - GET (cron): respect scheduled_post_at — only post items whose time has come.
  //     CRON_SECRET required (same as every other cron).
  //   - POST (manual override from Messages page): ignore scheduled_post_at,
  //     post the oldest pending item regardless. No auth — matches other
  //     manual admin buttons in this app.
  const isManual = event.httpMethod === 'POST'

  if (!isManual) {
    const provided =
      event.headers['x-cron-secret'] ||
      event.headers['X-Cron-Secret'] ||
      event.queryStringParameters?.secret
    if (!process.env.CRON_SECRET || provided !== process.env.CRON_SECRET) {
      return json(401, { error: 'Unauthorized' })
    }
  }

  const missing = []
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY']) {
    if (!process.env[k]) missing.push(k)
  }
  if (missing.length) return json(500, { error: `Missing env vars: ${missing.join(', ')}` })
  let requestedPlatform = null
  if (isManual) {
    try {
      const body = JSON.parse(event.body || '{}')
      if (body.platform === 'facebook' || body.platform === 'linkedin') {
        requestedPlatform = body.platform
      }
    } catch {
      // ignore — manual mode with no body is fine (does both)
    }
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const platforms = requestedPlatform ? [requestedPlatform] : ['facebook', 'linkedin']
  const results = []

  for (const platform of platforms) {
    const result = await flushOne(supabase, platform, { respectSchedule: !isManual })
    results.push({ platform, ...result })
  }

  return json(200, {
    mode: isManual ? 'manual' : 'cron',
    results,
  })
}

// Find the oldest eligible pending item for `platform`, attempt to publish
// it, and stamp the row with success or failure metadata.
//
// respectSchedule=true → only items with scheduled_post_at <= now()
// respectSchedule=false → any pending item (manual override)
async function flushOne(supabase, platform, { respectSchedule }) {
  let q = supabase
    .from('social_post_queue')
    .select('id, message, photo_url, scheduled_post_at, trainee_id, class_id')
    .eq('platform', platform)
    .is('posted_at', null)
    .order('scheduled_post_at', { ascending: true })
    .limit(1)

  if (respectSchedule) {
    q = q.lte('scheduled_post_at', new Date().toISOString())
  }

  const { data: item, error } = await q.maybeSingle()
  if (error) return { ok: false, error: `select: ${error.message}` }
  if (!item) {
    return { ok: true, skipped: true, reason: 'No eligible queued item' }
  }

  const poster = platform === 'facebook' ? postToFacebookPage : postToLinkedIn
  const post = await poster({ message: item.message, photoUrl: item.photo_url })

  if (post.ok) {
    await supabase
      .from('social_post_queue')
      .update({
        posted_at: new Date().toISOString(),
        post_id: post.post_id || null,
        last_error: null,
      })
      .eq('id', item.id)
    return {
      ok: true,
      posted_item_id: item.id,
      post_id: post.post_id || null,
      trainee_id: item.trainee_id,
    }
  }

  // Failure: leave posted_at null so the next run retries this same row.
  await supabase
    .from('social_post_queue')
    .update({ last_error: `${post.step || 'post'}: ${post.error || 'unknown'}` })
    .eq('id', item.id)

  return {
    ok: false,
    item_id: item.id,
    error: post.error || 'unknown',
    step: post.step || null,
  }
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
