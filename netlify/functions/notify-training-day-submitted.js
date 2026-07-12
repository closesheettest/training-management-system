// notify-training-day-submitted.js — fired by the Training Days page right
// after a manager submits a new training day (that insert is a direct
// client-side Supabase write, so it can't send GHL texts itself).
//
// POST { submission_id }
// → { ok, sms_sent, email_sent }
//
// Guard: only notifies for a row that is genuinely PENDING and has a
// review token — so a stray/replayed call can't spam the reviewers.
//
// Recipients = whoever subscribes to the 'training_day_submitted' event on
// the /notifications page (DeWayne + Neal). Each gets an SMS + email with a
// private link to review, edit, and Activate the day.
//
// Required env: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN, GHL_LOCATION_ID.

import { createClient } from '@supabase/supabase-js'
import { recipientsForEvent } from './_recipients.js'
import { notifyAll } from './_notify.js'

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return cors(200, '')
  if (event.httpMethod !== 'POST') return cors(405, { error: 'Method Not Allowed' })

  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'GHL_PIT_TOKEN', 'GHL_LOCATION_ID']) {
    if (!process.env[k]) return cors(500, { error: `Missing env var: ${k}` })
  }

  let body = {}
  try { body = JSON.parse(event.body || '{}') } catch { return cors(400, { error: 'Bad JSON' }) }
  const submissionId = String(body.submission_id || '').trim()
  if (!submissionId) return cors(400, { error: 'Missing submission_id' })

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const { data: day, error } = await supabase
    .from('training_days')
    .select('id, title, status, review_token, submitted_by_name')
    .eq('id', submissionId)
    .maybeSingle()
  if (error) return cors(500, { error: error.message })
  if (!day) return cors(404, { error: 'Submission not found' })

  // Only notify for a genuinely-pending submission with a token.
  if (day.status !== 'pending' || !day.review_token) {
    return cors(200, { ok: true, sms_sent: 0, email_sent: 0, skipped: 'not a pending submission' })
  }

  const siteUrl = (process.env.PUBLIC_SITE_URL || process.env.URL || process.env.DEPLOY_URL || 'https://trainingmanagementsys.netlify.app').replace(/\/$/, '')
  const reviewLink = `${siteUrl}/review-training-day/${day.review_token}`
  const who = (day.submitted_by_name || 'A manager').trim()
  const title = (day.title || 'Untitled').trim()

  const smsBody =
    `New training day submitted for review.\n` +
    `"${title}" — by ${who}.\n` +
    `Review, edit & activate: ${reviewLink}`

  const emailSubject = `Review a new training day: "${title}"`
  const emailBody =
    `${who} submitted a new sales-training day for review.\n\n` +
    `Title: ${title}\n\n` +
    `It is saved as PENDING and won't go live until you activate it.\n` +
    `Open the link below to review it, edit anything you'd like, then click Activate:\n\n` +
    `${reviewLink}\n`

  const { recipients } = await recipientsForEvent(supabase, 'training_day_submitted', { legacyRole: 'admin' })
  const result = await notifyAll(recipients, {
    smsBody,
    emailSubject,
    emailBody,
    contactLabel: 'Training Review',
  })

  return cors(200, {
    ok: true,
    sms_sent: result.sms_sent,
    email_sent: result.email_sent,
    recipients: recipients.length,
    errors: result.errors,
  })
}

function cors(status, obj) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
    body: typeof obj === 'string' ? obj : JSON.stringify(obj),
  }
}
