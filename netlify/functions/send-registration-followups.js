// Daily cron — sends paced registration follow-up texts to trainees who
// haven't registered yet. Two follow-ups, then we stop.
//
// Eligibility (a trainee is a candidate if ALL true):
//   - enrolled = true (no point texting people who've been removed)
//   - registered = false (already registered → nothing to nudge)
//   - declined_at IS NULL (they opted out → never text them again)
//   - phone is set
//   - class.week_start_date is in the future (no point chasing for a
//     class that's already started)
//
// Follow-up #1 fires if:
//   - last_sms_sent_at >= 1 day ago
//   - registration_followup_1_sent_at IS NULL
//
// Follow-up #2 fires if:
//   - registration_followup_1_sent_at >= 2 days ago
//   - registration_followup_2_sent_at IS NULL
//   - class.week_start_date is within 7 days from today
//
// After follow-up #2 there are no more automated texts — HR can pick up
// the phone if they really need to reach the trainee.
//
// Auth: ?secret=<CRON_SECRET> or X-Cron-Secret header.
//
// Required env vars: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN,
// GHL_LOCATION_ID, CRON_SECRET. Optional: PUBLIC_SITE_URL.

import { createClient } from '@supabase/supabase-js'
import { sendSmsViaGhl } from './_ghl.js'
import { renderTemplate } from './_templates.js'

const FOLLOWUP_1_DELAY_HOURS = 24
const FOLLOWUP_2_DELAY_HOURS = 48
const FOLLOWUP_2_CLASS_WINDOW_DAYS = 7

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

  const todayIso = computeFloridaToday()

  // Pull every active candidate. Filtering by class.week_start_date >= today
  // happens client-side because PostgREST doesn't allow nested column filters
  // in this query shape — small enough N to be fine.
  const { data: trainees, error } = await supabase
    .from('trainees')
    .select(
      'id, first_name, last_name, phone, registration_token, last_sms_sent_at, registration_followup_1_sent_at, registration_followup_2_sent_at, classes!class_id(id, week_start_date, locations(name))',
    )
    .eq('registered', false)
    .eq('enrolled', true)
    .is('declined_at', null)
    .not('phone', 'is', null)
    .not('last_sms_sent_at', 'is', null)
  if (error) return json(500, { error: `Supabase: ${error.message}` })

  const now = Date.now()
  const followup1Cutoff = now - FOLLOWUP_1_DELAY_HOURS * 3600 * 1000
  const followup2Cutoff = now - FOLLOWUP_2_DELAY_HOURS * 3600 * 1000

  const results = []
  for (const t of trainees || []) {
    const weekStart = t.classes?.week_start_date
    if (!weekStart || weekStart < todayIso) continue // class already started / no class

    const lastSentMs = t.last_sms_sent_at ? new Date(t.last_sms_sent_at).getTime() : 0
    const fu1SentMs = t.registration_followup_1_sent_at
      ? new Date(t.registration_followup_1_sent_at).getTime()
      : null
    const fu2SentMs = t.registration_followup_2_sent_at
      ? new Date(t.registration_followup_2_sent_at).getTime()
      : null

    // Decide which followup (if any) is due.
    let stage = null
    if (fu1SentMs === null) {
      if (lastSentMs <= followup1Cutoff) stage = 1
    } else if (fu2SentMs === null) {
      const classWithinWindow = daysUntil(weekStart, todayIso) <= FOLLOWUP_2_CLASS_WINDOW_DAYS
      if (fu1SentMs <= followup2Cutoff && classWithinWindow) stage = 2
    }
    if (stage === null) continue

    const link = `${siteUrl}/register/${t.registration_token}`
    const locationName = t.classes?.locations?.name || 'your training location'
    const weekDate = formatDate(weekStart)
    const templateKey = stage === 1 ? 'registration_followup_1' : 'registration_followup_2'
    const message = await renderTemplate(supabase, templateKey, {
      firstName: t.first_name,
      locationName,
      weekDate,
      link,
    })

    if (dryRun) {
      results.push({
        trainee_id: t.id,
        stage,
        dry_run: true,
        preview: message,
      })
      continue
    }

    const phone = normalizePhone(t.phone)
    if (!phone) {
      results.push({ trainee_id: t.id, stage, ok: false, error: `Invalid phone: ${t.phone}` })
      continue
    }

    const sms = await sendSmsViaGhl(phone, message, {
      firstName: t.first_name || 'Trainee',
      lastName: t.last_name || 'Followup',
    })
    if (!sms.ok) {
      results.push({ trainee_id: t.id, stage, ok: false, error: sms.error, step: sms.step })
      continue
    }

    const stamp = stage === 1
      ? { registration_followup_1_sent_at: new Date().toISOString() }
      : { registration_followup_2_sent_at: new Date().toISOString() }
    await supabase.from('trainees').update(stamp).eq('id', t.id)

    results.push({ trainee_id: t.id, stage, ok: true })
  }

  return json(200, {
    target_date: todayIso,
    candidates: (trainees || []).length,
    fired: results.filter((r) => r.ok || r.dry_run).length,
    results,
  })
}

function normalizePhone(raw) {
  if (!raw) return null
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (digits.length >= 11 && raw.trim().startsWith('+')) return `+${digits}`
  return null
}

function computeFloridaToday() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
  return fmt.format(new Date())
}

function daysUntil(targetIso, todayIso) {
  const [y1, m1, d1] = targetIso.split('-').map(Number)
  const [y2, m2, d2] = todayIso.split('-').map(Number)
  const a = new Date(y1, m1 - 1, d1)
  const b = new Date(y2, m2 - 1, d2)
  return Math.round((a - b) / (1000 * 60 * 60 * 24))
}

function formatDate(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
