// Core group-broadcast logic — resolve recipients, send SMS/email in
// batches, stamp last_group_message_sent_at. Shared by:
//   • send-group-message.js   — admin /group-messages page (browser → function)
//   • regional-manager-api.js — regional manager blast (in-process call)
//
// Why this exists / why it's called in-process: the regional-manager blast
// used to reach this logic via an internal HTTP fetch (regional-manager-api
// → send-group-message, function-to-function). That second hop ran the
// whole send inside the OUTER function's 10s Netlify budget, so regional
// blasts timed out and silently delivered nothing — even though every other
// SMS path (which calls GHL directly, in one function) worked fine. Calling
// runGroupSend() directly removes the hop and puts the regional path on the
// same footing as the admin path.
//
// Takes a parsed request body (the shape documented in send-group-message.js)
// and returns { status, body }. Callers wrap that in their own HTTP response.
//
// Required env vars: SUPABASE_URL, SUPABASE_SECRET_KEY,
// GHL_PIT_TOKEN, GHL_LOCATION_ID (for SMS),
// RESEND_API_KEY + EMAIL_FROM (for email).

import { createClient } from '@supabase/supabase-js'
import { sendSmsViaGhl } from './_ghl.js'
import { sendEmail } from './_email.js'

const BATCH_SIZE = 20
const CONCURRENCY = 3

export async function runGroupSend(body) {
  const channels = body.channels || {}
  const wantSms = !!channels.sms
  const wantEmail = !!channels.email
  if (!wantSms && !wantEmail) {
    return { status: 400, body: { error: 'At least one channel (sms or email) is required' } }
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const siteUrl = (
    process.env.PUBLIC_SITE_URL ||
    process.env.URL ||
    process.env.DEPLOY_URL ||
    'https://trainingmanagementsys.netlify.app'
  ).replace(/\/$/, '')

  // Resolve any template keys the admin specified into actual body/subject.
  let smsBody = (body.sms_body || '').toString()
  let emailSubject = (body.email_subject || '').toString()
  let emailBody = (body.email_body || '').toString()

  if (wantSms && body.sms_template_key && !smsBody) {
    const { data: t } = await supabase
      .from('message_templates')
      .select('body')
      .eq('key', body.sms_template_key)
      .maybeSingle()
    if (t?.body) smsBody = t.body
  }
  if (wantEmail && body.email_template_key && (!emailBody || !emailSubject)) {
    const { data: t } = await supabase
      .from('message_templates')
      .select('subject, body')
      .eq('key', body.email_template_key)
      .maybeSingle()
    if (t) {
      if (!emailSubject && t.subject) emailSubject = t.subject
      if (!emailBody && t.body) emailBody = t.body
    }
  }

  if (wantSms && !smsBody.trim()) {
    return { status: 400, body: { error: 'SMS body is empty — provide sms_body or a valid sms_template_key' } }
  }
  if (wantEmail && !emailBody.trim()) {
    return { status: 400, body: { error: 'Email body is empty — provide email_body or a valid email_template_key' } }
  }

  // Resolve recipients based on scope. company_email takes precedence
  // over email for graduates — once IT provisions a @shingleusa.com
  // address, that's their work inbox and any company-wide comms should
  // route there. Personal email is the fallback for un-provisioned reps
  // (bulk imports who haven't been through training yet).
  let q = supabase
    .from('trainees')
    .select(
      'id, first_name, phone, email, company_email, registration_token, enrolled, declined_at, is_active_sales_rep, rep_level',
    )

  // trainee_ids overrides every other scope — used by "Email these
  // failures" to re-send via the other channel to a specific subset.
  // No active-rep / enrolled filters apply; if admin passed the IDs in,
  // we trust them.
  if (Array.isArray(body.trainee_ids) && body.trainee_ids.length > 0) {
    q = q.in('id', body.trainee_ids)
  } else if (body.scope === 'class') {
    if (!body.class_id) return { status: 400, body: { error: 'class_id required when scope=class' } }
    q = q.eq('class_id', body.class_id).neq('enrolled', false).is('declined_at', null)
    // Optional "showed up every day so far" filter — narrows the cohort
    // to trainees with a confirmed sign-in on every distinct attendance
    // date <= today for this class. Mirrors the client-side computation
    // in GroupMessages.jsx so server enforces what the UI previews.
    if (body.attended_every_day === true) {
      const fullAttendeeIds = await getFullAttendeeIds(supabase, body.class_id)
      if (fullAttendeeIds.length === 0) {
        return {
          status: 200,
          body: {
            ok: true,
            message: 'No recipients matched — nobody has shown up every training day yet.',
            counts: { sms_sent: 0, sms_failed: 0, email_sent: 0, email_failed: 0, recipients: 0 },
            next_offset: null,
            total: 0,
          },
        }
      }
      q = q.in('id', fullAttendeeIds)
    }
  } else if (body.scope === 'class_attended_today') {
    // Recap-email scope — narrows a class blast to ONLY trainees with
    // a confirmed attendance row for today. Used for the "Day-of
    // training recap" template so no-shows + dropouts don't get a
    // summary of training they missed.
    if (!body.class_id) return { status: 400, body: { error: 'class_id required when scope=class_attended_today' } }
    const todayAttendeeIds = await getTodayAttendeeIds(supabase, body.class_id)
    if (todayAttendeeIds.length === 0) {
      return {
        status: 200,
        body: {
          ok: true,
          message: 'No recipients matched — nobody has a confirmed attendance row for today in this class.',
          counts: { sms_sent: 0, sms_failed: 0, email_sent: 0, email_failed: 0, recipients: 0 },
          next_offset: null,
          total: 0,
        },
      }
    }
    q = q
      .eq('class_id', body.class_id)
      .neq('enrolled', false)
      .is('declined_at', null)
      .in('id', todayAttendeeIds)
  } else if (body.scope === 'all_active_reps' || body.scope === 'all_enrolled') {
    // 'all_enrolled' is the legacy alias — kept so a cached client doesn't
    // 400. Both paths apply the same active-rep filter.
    // Non-field staff (rep_level = 'non_field') are still on the team but
    // not field sales — exclude them from "all active sales reps" blasts.
    // .or() handles the null case (legacy rows without a level set).
    q = q
      .eq('is_active_sales_rep', true)
      .or('rep_level.is.null,rep_level.neq.non_field')
    if (body.region) {
      // Optional region slice — regional-manager broadcasts. Skipped on
      // company-wide blasts.
      q = q.eq('region', body.region)
    }
  } else {
    return { status: 400, body: { error: 'scope must be "class", "class_attended_today", or "all_active_reps", or pass trainee_ids' } }
  }

  const { data: trainees, error } = await q
  if (error) return { status: 500, body: { error: `Supabase: ${error.message}` } }
  if (!trainees || trainees.length === 0) {
    return { status: 200, body: { ok: true, message: 'No recipients matched.', counts: { sms: 0, email: 0 } } }
  }

  // Slice the recipient list to the requested batch. Client loops with
  // increasing offsets so each function call fits in Netlify's 10s
  // budget — see GroupMessages.jsx / RegionalManager.jsx for the loop.
  const offset = Math.max(0, parseInt(body.offset ?? 0, 10) || 0)
  const traineesBatch = trainees.slice(offset, offset + BATCH_SIZE)
  const nextOffset = offset + BATCH_SIZE < trainees.length ? offset + BATCH_SIZE : null

  // Build task factories (deferred promises) so we can run them with
  // bounded concurrency — sending all 20 at once still trips GHL's rate
  // limit even with retry. CONCURRENCY of 3 gives roughly 6-9 calls/sec
  // to GHL (each SMS = upsert contact + send message = 2 calls), which
  // fits inside GHL's ~10/sec ceiling with headroom.
  const taskFactories = []
  for (const t of traineesBatch) {
    const vars = {
      firstName: t.first_name || 'there',
      link: t.registration_token ? `${siteUrl}/update-info/${t.registration_token}` : '',
    }
    if (wantSms && t.phone) {
      taskFactories.push(async () => {
        const msg = applyPlaceholders(smsBody, vars)
        const s = await sendSmsViaGhl(t.phone, msg, {
          firstName: t.first_name || 'Trainee',
          lastName: 'Group',
        })
        return { trainee_id: t.id, channel: 'sms', ok: s.ok, error: s.error }
      })
    }
    // Prefer company_email over personal email — see select-clause comment.
    const targetEmail = t.company_email || t.email
    if (wantEmail && targetEmail) {
      taskFactories.push(async () => {
        const subject = applyPlaceholders(emailSubject || 'Update from training', vars)
        const msg = applyPlaceholders(emailBody, vars)
        const s = await sendEmail(targetEmail, subject, msg)
        return { trainee_id: t.id, channel: 'email', ok: s.ok, error: s.error }
      })
    }
  }

  const results = await runWithConcurrency(taskFactories, CONCURRENCY)

  // Stamp last_group_message_sent_at for every trainee who got at least
  // one successful send. Single batch update for efficiency.
  const stampedIds = Array.from(
    new Set(results.filter((r) => r.ok).map((r) => r.trainee_id)),
  )
  if (stampedIds.length > 0) {
    await supabase
      .from('trainees')
      .update({ last_group_message_sent_at: new Date().toISOString() })
      .in('id', stampedIds)
  }

  const counts = {
    sms_sent: results.filter((r) => r.channel === 'sms' && r.ok).length,
    sms_failed: results.filter((r) => r.channel === 'sms' && !r.ok).length,
    email_sent: results.filter((r) => r.channel === 'email' && r.ok).length,
    email_failed: results.filter((r) => r.channel === 'email' && !r.ok).length,
    recipients: traineesBatch.length,
  }
  const failures = results.filter((r) => !r.ok)

  return {
    status: 200,
    body: {
      ok: true,
      counts,
      next_offset: nextOffset,
      total: trainees.length,
      ...(failures.length ? { failures: failures.slice(0, 50) } : {}),
    },
  }
}

function applyPlaceholders(str, vars) {
  return String(str || '').replace(/\{(\w+)\}/g, (_, name) => {
    const v = vars[name]
    return v === undefined || v === null || v === '' ? `{${name}}` : String(v)
  })
}

// Resolve the set of trainee_ids who have a confirmed attendance
// row for TODAY in the given class. Used by the
// `class_attended_today` scope so recap blasts only go to people
// who actually showed up that day (skips no-shows + dropouts).
//
// Returns [] when nobody has signed in yet today — caller should
// treat that as zero recipients.
async function getTodayAttendeeIds(supabase, classId) {
  const today = new Date()
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const { data, error } = await supabase
    .from('attendance')
    .select('trainee_id')
    .eq('class_id', classId)
    .eq('confirmed', true)
    .eq('attendance_date', todayIso)
  if (error || !data) return []
  return data.map((r) => r.trainee_id).filter(Boolean)
}

// Resolve the set of trainee_ids who've shown up every training day so
// far for the given class. "Training day" = a date <= today on which any
// trainee for this class has a confirmed=true attendance row. A trainee
// is "full attendance" if they have a confirmed row for every such date.
// Returns [] when no attendance is recorded yet — caller should treat
// that as a zero-recipient outcome (nobody to send to).
//
// Note: weekends naturally fall out because nobody signs in on Sat/Sun.
async function getFullAttendeeIds(supabase, classId) {
  const today = new Date()
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const { data, error } = await supabase
    .from('attendance')
    .select('trainee_id, attendance_date')
    .eq('class_id', classId)
    .eq('confirmed', true)
  if (error || !data) return []
  const trainingDays = new Set()
  const byTrainee = new Map()
  for (const row of data) {
    if (!row.attendance_date) continue
    if (row.attendance_date > todayIso) continue
    trainingDays.add(row.attendance_date)
    const set = byTrainee.get(row.trainee_id) || new Set()
    set.add(row.attendance_date)
    byTrainee.set(row.trainee_id, set)
  }
  if (trainingDays.size === 0) return []
  const needed = trainingDays.size
  const ids = []
  for (const [tid, days] of byTrainee.entries()) {
    if (days.size === needed) ids.push(tid)
  }
  return ids
}

// Simple bounded-concurrency runner. Each worker pulls the next factory
// off a shared index counter and awaits it. With N workers, at most N
// tasks are in-flight at any moment. Avoids the "fire all N at once"
// pattern that lights up GHL's rate limit.
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
