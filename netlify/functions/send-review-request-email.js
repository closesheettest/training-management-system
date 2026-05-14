// Netlify Function: post-test review-request email.
//
// Fired by TakeTest.jsx right after a trainee submits their final test.
// Sends one email to the trainee with their Google + Yelp review links,
// then stamps trainees.review_email_sent_at so it doesn't repeat if they
// land on the TestDone page again.
//
// Required env vars:
//   SUPABASE_URL
//   SUPABASE_SECRET_KEY
//   RESEND_API_KEY    — required for the email to actually deliver
//   FROM_EMAIL / EMAIL_FROM — verified Resend sender
//
// Request body: { trainee_id: "uuid" }
// Response: { ok, sent_to?, skipped_reason? }

import { createClient } from '@supabase/supabase-js'
import { sendEmail } from './_email.js'

const GOOGLE_REVIEW_URL = 'https://g.page/r/CYeQXuq6eOfTEAI/review'
const YELP_REVIEW_URL =
  'https://www.yelp.com/writeareview/biz/CPWQA_SoEVdP8Swql9keWQ?return_url=%2Fbiz%2FCPWQA_SoEVdP8Swql9keWQ&review_origin=biz-details-war-button'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' })

  const missing = []
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY']) {
    if (!process.env[k]) missing.push(k)
  }
  if (missing.length) return json(500, { error: `Missing env vars: ${missing.join(', ')}` })

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }
  const { trainee_id } = body
  if (!trainee_id) return json(400, { error: 'trainee_id required' })

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  const { data: t, error: tErr } = await supabase
    .from('trainees')
    .select('id, first_name, last_name, email, review_email_sent_at, classes(region, week_start_date)')
    .eq('id', trainee_id)
    .maybeSingle()
  if (tErr || !t) return json(404, { error: 'Trainee not found' })

  if (!t.email) {
    return json(200, { ok: false, skipped_reason: 'Trainee has no email on file' })
  }
  if (t.review_email_sent_at) {
    return json(200, { ok: true, skipped_reason: 'Already sent', sent_at: t.review_email_sent_at })
  }

  const firstName = (t.first_name || 'there').trim() || 'there'
  const subject = `Thanks for completing your training, ${firstName} — 30-second favor?`
  const textBody =
    `Hi ${firstName},\n\n` +
    `Thanks so much for finishing your final assessment — that's a real accomplishment.\n\n` +
    `One small ask: would you take 30 seconds to leave a quick review? It helps the next class find us and means the world.\n\n` +
    `Google: ${GOOGLE_REVIEW_URL}\n` +
    `Yelp: ${YELP_REVIEW_URL}\n\n` +
    `Whatever you wrote in your essay answers makes a perfect review — feel free to copy/paste anything you said there.\n\n` +
    `Thanks again — congratulations on graduating training.\n\n` +
    `— U.S. Shingle & Metal Training Team`

  const result = await sendEmail(t.email, subject, textBody)
  if (!result.ok) {
    return json(200, {
      ok: false,
      error: result.error,
      step: result.step,
    })
  }

  await supabase
    .from('trainees')
    .update({ review_email_sent_at: new Date().toISOString() })
    .eq('id', trainee_id)

  return json(200, { ok: true, sent_to: t.email })
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
