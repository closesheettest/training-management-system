// Netlify Function: bulk-fire the handoff contacts SMS for every
// trainee in a class who submitted the final test but never got the
// dedup stamp (handoff_contacts_sent_at is NULL).
//
// Why: TakeTest.jsx fires send-handoff-contacts-sms as a
// fire-and-forget fetch with `.catch(() => {})` — any network blip,
// GHL hiccup, or server timeout silently swallows the call. On
// 2026-05-29 6 of 8 Miami trainees submitted the test but the SMS
// never reached them. This function lets Neal trigger the recovery
// in one hit instead of hunting down each trainee ID.
//
// USAGE:
//   GET /.netlify/functions/resend-handoff-sms-for-class
//       ?secret=<CRON_SECRET>
//       &class_id=<uuid>
//       [&dry_run=1]
//
// Returns a per-trainee summary so Neal can see who fired, who was
// skipped (already stamped), and who failed.

import { createClient } from '@supabase/supabase-js'

const SB_URL = process.env.SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SECRET_KEY
const SITE_URL = (process.env.PUBLIC_SITE_URL || process.env.URL || 'https://trainingmanagementsys.netlify.app').replace(/\/$/, '')

export const handler = async (event) => {
  const params = event.queryStringParameters || {}
  if (process.env.CRON_SECRET && params.secret !== process.env.CRON_SECRET) {
    return json(401, { error: 'Unauthorized' })
  }
  if (!SB_URL || !SB_KEY) {
    return json(500, { error: 'Missing SUPABASE_URL or SUPABASE_SECRET_KEY' })
  }
  const supabase = createClient(SB_URL, SB_KEY)

  // Accept either an explicit class_id OR a region (auto-resolves to
  // the most recent class for that region whose window includes
  // today). Region lookup is the easier mode — Neal doesn't have to
  // chase a UUID; just hit ?region=miami.
  let classId = params.class_id
  if (!classId) {
    const region = (params.region || '').trim()
    if (!region) {
      return json(400, {
        error: 'Pass either class_id=<uuid> or region=miami (or whichever region) — neither was provided.',
      })
    }
    const today = new Date().toISOString().slice(0, 10)
    const { data: cls } = await supabase
      .from('classes')
      .select('id, region, week_start_date, week_end_date')
      .ilike('region', `%${region}%`)
      .lte('week_start_date', today)
      .gte('week_end_date', today)
      .order('week_start_date', { ascending: false })
      .limit(1)
    if (!cls || cls.length === 0) {
      return json(404, {
        error: `No active class matched region="${region}" for ${today}.`,
      })
    }
    classId = cls[0].id
  }
  const dryRun = params.dry_run === '1' || params.dry_run === 'true'

  // 1. Find trainees in the class who:
  //    - submitted the final test (test_attempts.submitted_at not null)
  //    - do NOT have handoff_contacts_sent_at set (the gap we're filling)
  //    - have a phone (otherwise the downstream function will fail)
  const { data: rows, error } = await supabase
    .from('trainees')
    .select('id, first_name, last_name, phone, handoff_contacts_sent_at, test_attempts!trainee_id(submitted_at)')
    .eq('class_id', classId)
    .is('handoff_contacts_sent_at', null)
  if (error) return json(500, { error: error.message })

  const targets = (rows || []).filter((t) => {
    const submitted = (t.test_attempts || []).some((a) => a.submitted_at)
    return submitted && t.phone
  })

  if (targets.length === 0) {
    return json(200, {
      ok: true,
      message: 'No trainees need a re-send — everyone who submitted is already stamped.',
      scanned: rows?.length || 0,
    })
  }

  if (dryRun) {
    return json(200, {
      ok: true,
      dry_run: true,
      would_fire_for: targets.map((t) => `${t.first_name} ${t.last_name}`),
      count: targets.length,
    })
  }

  // 2. Fire the existing send-handoff-contacts-sms function for each
  //    target. Sequential (not parallel) so we don't accidentally
  //    DDoS GHL, and so we can capture per-trainee results.
  const results = []
  for (const t of targets) {
    try {
      const res = await fetch(`${SITE_URL}/.netlify/functions/send-handoff-contacts-sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trainee_id: t.id }),
      })
      const body = await res.json().catch(() => ({}))
      results.push({
        trainee: `${t.first_name} ${t.last_name}`,
        ok: res.ok && body.ok !== false,
        status: res.status,
        body,
      })
    } catch (e) {
      results.push({
        trainee: `${t.first_name} ${t.last_name}`,
        ok: false,
        error: e?.message || 'Network error',
      })
    }
  }

  const summary = {
    fired_ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
  }
  return json(200, { ok: true, summary, results })
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
