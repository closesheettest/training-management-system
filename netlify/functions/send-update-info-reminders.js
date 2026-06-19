// Cron-triggered reminder SMS for active reps who still haven't
// submitted /update-info. Designed to be pointed at cron-job.org
// firing hourly (or whatever cadence) — the function self-throttles
// per-rep so you can't accidentally double-text someone.
//
// Eligibility — a rep gets a reminder if ALL true:
//   - is_active_sales_rep = true
//   - info_updated_at IS NULL (still haven't filled in the form)
//   - phone is set
//   - last_update_reminder_sent_at IS NULL or >= REMINDER_INTERVAL_HOURS ago
//   - update_reminder_count < REMINDER_MAX_ATTEMPTS
//
// After REMINDER_MAX_ATTEMPTS reminders (default 5) the rep is quietly
// dropped — pestering them more isn't going to work, and it'll torch
// our SMS deliverability with carriers.
//
// Tunable via env vars (set in Netlify dashboard):
//   UPDATE_REMINDER_INTERVAL_HOURS  default 24
//   UPDATE_REMINDER_MAX_ATTEMPTS    default 5
//
// Auth:
//   GET ?secret=<CRON_SECRET>          (cron-job.org trigger)
//   POST                               (manual admin trigger — no secret;
//                                       admin UI is implicit auth)
// Query params:
//   ?dry_run=1                          preview without sending
//
// Body template: pulls update_info_request_sms from /message-templates
// so the wording stays editable. Substitutes {firstName} + {link} per
// recipient (link = site_url/update-info/<registration_token>).
//
// Required env vars: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN,
// GHL_LOCATION_ID, CRON_SECRET (GET path only).

import { createClient } from '@supabase/supabase-js'
import { sendSmsViaGhl } from './_ghl.js'
import { sendEmail } from './_email.js'

export const handler = async (event) => {
  const isPost = event.httpMethod === 'POST'
  if (!isPost) {
    const provided =
      event.headers['x-cron-secret'] ||
      event.headers['X-Cron-Secret'] ||
      event.queryStringParameters?.secret
    if (!process.env.CRON_SECRET || provided !== process.env.CRON_SECRET) {
      return json(401, { error: 'Unauthorized' })
    }
  }

  const missing = []
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'GHL_PIT_TOKEN', 'GHL_LOCATION_ID']) {
    if (!process.env[k]) missing.push(k)
  }
  if (missing.length) return json(500, { error: `Missing env vars: ${missing.join(', ')}` })

  const intervalHours = parseInt(process.env.UPDATE_REMINDER_INTERVAL_HOURS || '24', 10)
  const maxAttempts = parseInt(process.env.UPDATE_REMINDER_MAX_ATTEMPTS || '5', 10)
  const dryRun =
    event.queryStringParameters?.dry_run === '1' ||
    event.queryStringParameters?.dry_run === 'true'

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const siteUrl = (
    process.env.PUBLIC_SITE_URL ||
    process.env.URL ||
    process.env.DEPLOY_URL ||
    'https://trainingmanagementsys.netlify.app'
  ).replace(/\/$/, '')

  // Load the SMS template body (editable on /message-templates so admin
  // can tune the wording without code changes).
  const { data: tpl } = await supabase
    .from('message_templates')
    .select('body')
    .eq('key', 'update_info_request_sms')
    .maybeSingle()
  const templateBody =
    tpl?.body ||
    'Hi {firstName}, we\'re updating our records — please take 30 seconds to enter your personal email, home address, and pick your region: {link}'

  // Find the eligible reps. We pull everyone active+un-updated and
  // filter the time / attempt constraints client-side — Supabase's
  // .or() and .filter() get awkward to chain for this combination.
  const { data: candidates, error } = await supabase
    .from('trainees')
    .select(
      'id, first_name, phone, email, registration_token, info_updated_at, last_update_reminder_sent_at, update_reminder_count, is_active_sales_rep, rep_level',
    )
    .eq('is_active_sales_rep', true)
    // Skip non-field staff — they're not a field sales rep and the
    // update-info ask (region, home address) doesn't apply.
    .or('rep_level.is.null,rep_level.neq.non_field')
    .is('info_updated_at', null)
  if (error) return json(500, { error: `Supabase: ${error.message}` })

  const now = Date.now()
  const intervalMs = intervalHours * 3600 * 1000
  const eligible = (candidates || []).filter((t) => {
    if (!t.phone) return false
    if ((t.update_reminder_count || 0) >= maxAttempts) return false
    if (!t.last_update_reminder_sent_at) return true
    const last = new Date(t.last_update_reminder_sent_at).getTime()
    if (Number.isNaN(last)) return true
    return now - last >= intervalMs
  })

  // Concurrency-limited fan-out — same pattern as send-group-message.
  // Keeps us under GHL's ~10/sec rate ceiling and lets retries inside
  // the GHL helper handle transient 429s.
  const CONCURRENCY = 3
  const factories = eligible.map((t) => async () => {
    const vars = {
      firstName: t.first_name || 'there',
      link: t.registration_token ? `${siteUrl}/update-info/${t.registration_token}` : '',
    }
    const body = applyPlaceholders(templateBody, vars)
    if (dryRun) {
      return { trainee_id: t.id, phone: t.phone, body, ok: true, dryRun: true }
    }
    // Send by BOTH email and SMS — email reaches reps whose SMS is
    // blocked/opted-out in GHL. Success = at least one channel went out.
    const channels = []
    const errors = []

    if (t.email) {
      try {
        const r = await sendEmail(t.email, 'Please update your U.S. Shingle & Metal rep info', body)
        if (r && r.ok !== false) channels.push('email')
        else errors.push('email: ' + (r?.error || 'failed'))
      } catch (e) { errors.push('email: ' + (e.message || 'error')) }
    }

    if (t.phone) {
      const s = await sendSmsViaGhl(t.phone, body, {
        firstName: t.first_name || 'Trainee',
        lastName: 'Update Reminder',
      })
      if (s.ok) channels.push('sms')
      else errors.push('sms: ' + (s.error || 'failed'))
    }

    if (channels.length) {
      // Stamp + increment the counter so the next cron iteration
      // doesn't re-contact this person before INTERVAL_HOURS has passed.
      await supabase
        .from('trainees')
        .update({
          last_update_reminder_sent_at: new Date().toISOString(),
          update_reminder_count: (t.update_reminder_count || 0) + 1,
        })
        .eq('id', t.id)
    }
    return { trainee_id: t.id, phone: t.phone, ok: channels.length > 0, channels, error: errors.length ? errors.join('; ') : undefined }
  })

  const results = await runWithConcurrency(factories, CONCURRENCY)

  const sent = results.filter((r) => r.ok && !r.dryRun).length
  const failed = results.filter((r) => !r.ok).length
  const previewed = results.filter((r) => r.dryRun).length

  return json(200, {
    ok: true,
    interval_hours: intervalHours,
    max_attempts: maxAttempts,
    candidates_total: candidates?.length || 0,
    eligible_now: eligible.length,
    sent,
    failed,
    ...(dryRun ? { dry_run: true, previewed, preview: results.slice(0, 10) } : {}),
    ...(failed > 0 ? { failures: results.filter((r) => !r.ok).slice(0, 20) } : {}),
  })
}

async function runWithConcurrency(factories, limit) {
  const results = new Array(factories.length)
  let nextIdx = 0
  const workers = Array.from({ length: Math.min(limit, factories.length) }, async () => {
    while (true) {
      const myIdx = nextIdx++
      if (myIdx >= factories.length) return
      results[myIdx] = await factories[myIdx]()
    }
  })
  await Promise.all(workers)
  return results
}

function applyPlaceholders(str, vars) {
  return String(str || '').replace(/\{(\w+)\}/g, (_, name) => {
    const v = vars[name]
    return v === undefined || v === null || v === '' ? `{${name}}` : String(v)
  })
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
