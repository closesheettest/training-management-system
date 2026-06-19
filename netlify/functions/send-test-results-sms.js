// Texts each trainee a private link to their final-test results
// (/results/<their registration_token>). Triggered from the
// TestResults section on a Class detail page — per-row "Send results"
// button OR a bulk "Send to all submitted" button.
//
// Request body shape:
//   { trainee_ids: ["uuid1", "uuid2", ...] }       — explicit list
//     OR
//   { class_id: "uuid", unsent_only: true }        — every trainee in
//                                                    the class with a
//                                                    submitted test that
//                                                    hasn't been sent yet
//
// Each successful send stamps trainees.test_results_link_sent_at so
// the bulk action doesn't re-text people who already got the link.
// Per-trainee sends always fire (used for re-sends after the trainee
// loses the text).
//
// No auth — admin-only triggers, same convention as other manual
// admin buttons in this app.
//
// Required env vars: SUPABASE_URL, SUPABASE_SECRET_KEY,
// GHL_PIT_TOKEN, GHL_LOCATION_ID. Optional: PUBLIC_SITE_URL.

import { createClient } from '@supabase/supabase-js'
import { sendSmsViaGhl } from './_ghl.js'
import { sendEmail } from './_email.js'
import { renderTemplate } from './_templates.js'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' })

  const missing = []
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'GHL_PIT_TOKEN', 'GHL_LOCATION_ID']) {
    if (!process.env[k]) missing.push(k)
  }
  if (missing.length) return json(500, { error: `Missing env vars: ${missing.join(', ')}` })

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const siteUrl = (process.env.PUBLIC_SITE_URL || process.env.URL || process.env.DEPLOY_URL || 'https://trainingmanagementsys.netlify.app').replace(/\/$/, '')

  // Resolve the trainee set.
  let q = supabase
    .from('trainees')
    .select(
      'id, first_name, phone, email, registration_token, test_results_link_sent_at, test_attempts(submitted_at)',
    )
    .not('phone', 'is', null)
    .not('registration_token', 'is', null)

  if (Array.isArray(body.trainee_ids) && body.trainee_ids.length > 0) {
    q = q.in('id', body.trainee_ids)
  } else if (body.class_id) {
    q = q.eq('class_id', body.class_id)
    if (body.unsent_only !== false) {
      q = q.is('test_results_link_sent_at', null)
    }
  } else {
    return json(400, { error: 'Either trainee_ids[] or class_id is required' })
  }

  const { data: trainees, error } = await q
  if (error) return json(500, { error: `Supabase: ${error.message}` })
  if (!trainees || trainees.length === 0) {
    return json(200, { ok: true, sent_count: 0, message: 'Nothing to send.' })
  }

  const results = []
  for (const t of trainees) {
    // Must have actually submitted the test — no point texting "see
    // your results" to a no-show.
    const submitted = (t.test_attempts || []).some((a) => a.submitted_at)
    if (!submitted) {
      results.push({ trainee_id: t.id, ok: false, error: 'Trainee has not submitted the test yet' })
      continue
    }

    const link = `${siteUrl}/results/${t.registration_token}`
    const message = await renderTemplate(supabase, 'test_results_link', {
      firstName: t.first_name || 'there',
      link,
    })

    // Send by BOTH email and SMS — email reaches trainees whose SMS is
    // blocked/opted-out in GHL. Success = at least one channel went out.
    const channels = []
    const errors = []

    if (t.email) {
      try {
        const r = await sendEmail(t.email, 'Your U.S. Shingle & Metal final-test results', message)
        if (r && r.ok !== false) channels.push('email')
        else errors.push('email: ' + (r?.error || 'failed'))
      } catch (e) { errors.push('email: ' + (e.message || 'error')) }
    }

    if (t.phone) {
      const sms = await sendSmsViaGhl(t.phone, message, {
        firstName: t.first_name || 'Trainee',
        lastName: 'Results',
      })
      if (sms.ok) channels.push('sms')
      else errors.push('sms: ' + (sms.error || 'failed'))
    }

    if (!channels.length) {
      results.push({ trainee_id: t.id, ok: false, error: errors.join('; ') })
      continue
    }

    await supabase
      .from('trainees')
      .update({ test_results_link_sent_at: new Date().toISOString() })
      .eq('id', t.id)

    results.push({ trainee_id: t.id, ok: true, channels, errors: errors.length ? errors : undefined })
  }

  return json(200, {
    ok: true,
    sent_count: results.filter((r) => r.ok).length,
    fail_count: results.filter((r) => !r.ok).length,
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
