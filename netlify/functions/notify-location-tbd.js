// Netlify Function: daily reminder for upcoming classes without a training location.
//
// Cron-triggered (daily at 10 AM Eastern). Finds every class where:
//   - location_id IS NULL (no training location assigned)
//   - week_start_date is within the next 14 days (today through today+14)
//
// Fires the 'location_tbd_reminder' event to subscribers each day until a
// location is set. NO dedup stamp by design — the reminder repeats every
// morning so it can't be ignored.
//
// Required env vars: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN,
// GHL_LOCATION_ID, CRON_SECRET. Optional: RESEND_API_KEY, EMAIL_FROM,
// PUBLIC_SITE_URL.
//
// Auth: ?secret=<CRON_SECRET> or X-Cron-Secret header.
// Query params: ?dry_run=1 — preview without sending.
//   ?date=YYYY-MM-DD — override "today" (for testing).

import { createClient } from '@supabase/supabase-js'
import { recipientsForEvent } from './_recipients.js'
import { notifyAll } from './_notify.js'

const REMINDER_WINDOW_DAYS = 14

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
  const today = params.date || computeFloridaToday()
  const cutoff = addDaysIso(today, REMINDER_WINDOW_DAYS)

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const siteUrl = (process.env.PUBLIC_SITE_URL || process.env.URL || process.env.DEPLOY_URL || '').replace(/\/$/, '')

  const { data: classes, error: clsErr } = await supabase
    .from('classes')
    .select('id, region, week_start_date, week_end_date')
    .is('location_id', null)
    .gte('week_start_date', today)
    .lte('week_start_date', cutoff)
    .order('week_start_date', { ascending: true })
  if (clsErr) return json(500, { error: `Supabase: ${clsErr.message}` })

  if (!classes || classes.length === 0) {
    return json(200, {
      target_date: today,
      window_end: cutoff,
      tbd_count: 0,
      message: 'No upcoming classes need a location.',
    })
  }

  const lines = classes.map((c) => {
    const region = c.region || 'Region TBD'
    const link = siteUrl ? `${siteUrl}/class/${c.id}` : `/class/${c.id}`
    return {
      summary: `• ${region} — week of ${formatShortDate(c.week_start_date)} (${daysUntil(c.week_start_date, today)} days away)`,
      link,
      region,
      start: c.week_start_date,
    }
  })

  const smsBody =
    classes.length === 1
      ? `[Training] Still no location booked for ${lines[0].region} training week of ${formatShortDate(classes[0].week_start_date)} (${daysUntil(classes[0].week_start_date, today)} days away). Pick one: ${lines[0].link}`
      : `[Training] ${classes.length} upcoming class${classes.length === 1 ? '' : 'es'} still need${classes.length === 1 ? 's' : ''} a location:\n${lines.map((l) => l.summary).join('\n')}\nAssign at: ${siteUrl}/calendar`

  const emailSubject =
    classes.length === 1
      ? `Training location still TBD — week of ${formatShortDate(classes[0].week_start_date)}`
      : `${classes.length} upcoming classes still need locations`

  const emailBody =
    `The following upcoming class${classes.length === 1 ? '' : 'es'} ${classes.length === 1 ? 'doesn\'t' : 'don\'t'} have a training location assigned yet:\n\n` +
    lines.map((l) => `${l.summary}\n  → ${l.link}`).join('\n\n') +
    `\n\nThe reminder will keep firing every day at 10 AM until a location is selected.\n\n— Training System`

  const { recipients, source } = await recipientsForEvent(supabase, 'location_tbd_reminder', {
    legacyRole: 'admin',
  })

  if (recipients.length === 0) {
    return json(200, {
      target_date: today,
      window_end: cutoff,
      tbd_count: classes.length,
      warning: 'No subscribers to location_tbd_reminder. Subscribe in /notifications.',
      classes: classes.map((c) => ({ id: c.id, region: c.region, week_start_date: c.week_start_date })),
    })
  }

  if (dryRun) {
    return json(200, {
      target_date: today,
      window_end: cutoff,
      tbd_count: classes.length,
      dry_run: true,
      preview_sms: smsBody,
      preview_email_subject: emailSubject,
      subscribers: recipients.length,
      classes: classes.map((c) => ({ id: c.id, region: c.region, week_start_date: c.week_start_date })),
    })
  }

  const result = await notifyAll(recipients, {
    smsBody,
    emailSubject,
    emailBody,
    contactLabel: 'Admin',
  })

  return json(200, {
    target_date: today,
    window_end: cutoff,
    tbd_count: classes.length,
    classes: classes.map((c) => ({ id: c.id, region: c.region, week_start_date: c.week_start_date })),
    sms_sent: result.sms_sent,
    email_sent: result.email_sent,
    recipient_count: recipients.length,
    recipients_source: source,
    ...(result.errors.length ? { errors: result.errors } : {}),
  })
}

function computeFloridaToday() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
  return fmt.format(new Date())
}

function addDaysIso(iso, days) {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  const base = new Date(y, m - 1, d)
  base.setDate(base.getDate() + days)
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`
}

function daysUntil(targetIso, todayIso) {
  const [y1, m1, d1] = targetIso.split('-').map(Number)
  const [y2, m2, d2] = todayIso.split('-').map(Number)
  const a = new Date(y1, m1 - 1, d1)
  const b = new Date(y2, m2 - 1, d2)
  return Math.round((a - b) / (1000 * 60 * 60 * 24))
}

function formatShortDate(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
