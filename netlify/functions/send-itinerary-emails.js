// Daily cron — sends a training itinerary email to every newly eligible
// trainee. A trainee becomes eligible the day their class gets a
// location assigned (no longer TBD) AS LONG AS they've registered.
//
// Eligibility (a trainee gets the email if ALL true):
//   - registered = true
//   - enrolled = true
//   - declined_at IS NULL
//   - email is set
//   - itinerary_email_sent_at IS NULL (dedup — never re-send)
//   - class.location_id is not null (training location has been picked)
//   - class.week_start_date >= today (no point emailing for past classes)
//
// Body + subject come from the editable message_templates row with
// key='itinerary_email'. The admin can change wording from the
// /message-templates page at any time; no redeploy needed.
//
// Hiring manager signature is pulled from notification_recipients
// where role='hiring_manager' (first active one). Falls back to env
// vars HIRING_MANAGER_NAME / _TITLE / _PHONE, then to "Hiring Manager"
// placeholders so the template never breaks.
//
// Auth: ?secret=<CRON_SECRET> or X-Cron-Secret header.
//
// Required env vars: SUPABASE_URL, SUPABASE_SECRET_KEY, RESEND_API_KEY,
// CRON_SECRET. Optional: EMAIL_FROM/FROM_EMAIL,
// HIRING_MANAGER_NAME/TITLE/PHONE.

import { createClient } from '@supabase/supabase-js'
import { sendEmail } from './_email.js'
import { renderEmailTemplate } from './_templates.js'

export const handler = async (event) => {
  const provided =
    event.headers['x-cron-secret'] ||
    event.headers['X-Cron-Secret'] ||
    event.queryStringParameters?.secret
  if (!process.env.CRON_SECRET || provided !== process.env.CRON_SECRET) {
    return json(401, { error: 'Unauthorized' })
  }

  const missing = []
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY']) {
    if (!process.env[k]) missing.push(k)
  }
  if (missing.length) return json(500, { error: `Missing env vars: ${missing.join(', ')}` })

  const params = event.queryStringParameters || {}
  const dryRun = params.dry_run === '1' || params.dry_run === 'true'

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const todayIso = computeFloridaToday()

  // Find every candidate. The class join filters out trainees whose
  // class has no location yet (the whole point of this email — wait
  // until location is set).
  const { data: trainees, error } = await supabase
    .from('trainees')
    .select(
      'id, first_name, email, classes!inner(id, week_start_date, location_id, schedule_details, locations(name, street_address, city, state, zip, schedule_template))',
    )
    .eq('registered', true)
    .eq('enrolled', true)
    .is('declined_at', null)
    .is('itinerary_email_sent_at', null)
    .not('email', 'is', null)
    .not('classes.location_id', 'is', null)
  if (error) return json(500, { error: `Supabase: ${error.message}` })

  // Resolve hiring manager from notification recipients (preferred) or
  // env vars (fallback). Single lookup outside the loop.
  const hm = await loadHiringManager(supabase)

  const results = []
  for (const t of trainees || []) {
    const weekStart = t.classes?.week_start_date
    if (!weekStart || weekStart < todayIso) continue // class already happened

    const loc = t.classes?.locations
    const locationName = loc?.name || 'TBD'
    const locationAddress = formatAddress(loc)
    const schedule =
      (t.classes?.schedule_details || loc?.schedule_template || '').trim() ||
      'Schedule will be confirmed shortly.'
    const weekDate = formatDate(weekStart)
    const weekDayWord = formatDayWord(weekStart)

    const { subject, body } = await renderEmailTemplate(supabase, 'itinerary_email', {
      firstName: t.first_name || 'there',
      locationName,
      locationAddress,
      weekDate,
      weekDayWord,
      scheduleDetails: schedule,
      hiringManagerName: hm.name,
      hiringManagerTitle: hm.title,
      hiringManagerPhone: hm.phone,
    })

    if (dryRun) {
      results.push({
        trainee_id: t.id,
        dry_run: true,
        preview_subject: subject,
        preview_body: body,
      })
      continue
    }

    if (!t.email) {
      results.push({ trainee_id: t.id, ok: false, error: 'No email on file' })
      continue
    }

    const sent = await sendEmail(t.email, subject, body)
    if (!sent.ok) {
      results.push({ trainee_id: t.id, ok: false, error: sent.error, step: sent.step })
      continue
    }

    await supabase
      .from('trainees')
      .update({ itinerary_email_sent_at: new Date().toISOString() })
      .eq('id', t.id)

    results.push({ trainee_id: t.id, ok: true, sent_to: t.email })
  }

  return json(200, {
    target_date: todayIso,
    candidates: (trainees || []).length,
    fired: results.filter((r) => r.ok || r.dry_run).length,
    results,
  })
}

async function loadHiringManager(supabase) {
  // Look for an active recipient flagged as hiring_manager. We pick the
  // lowest-id one for stability (FIFO insert order).
  try {
    const { data } = await supabase
      .from('notification_recipients')
      .select('name, phone, email')
      .eq('active', true)
      .eq('role', 'hiring_manager')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (data?.name) {
      return {
        name: data.name,
        title: 'Hiring Manager',
        phone: data.phone || process.env.HIRING_MANAGER_PHONE || '',
      }
    }
  } catch {
    // fall through to env
  }
  return {
    name: process.env.HIRING_MANAGER_NAME || 'Hiring Manager',
    title: process.env.HIRING_MANAGER_TITLE || 'Hiring Manager',
    phone: process.env.HIRING_MANAGER_PHONE || '',
  }
}

function formatAddress(loc) {
  if (!loc) return ''
  const parts = []
  if (loc.street_address) parts.push(loc.street_address)
  const cityState = [loc.city, [loc.state, loc.zip].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ')
  if (cityState) parts.push(cityState)
  return parts.join('\n')
}

function computeFloridaToday() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
  return fmt.format(new Date())
}

function formatDate(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}

function formatDayWord(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return ''
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
