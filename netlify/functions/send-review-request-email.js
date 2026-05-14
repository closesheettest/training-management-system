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

  // Pull this trainee's testimonial-eligible essay answers so we can pre-pick
  // two of them — one for Google, one for Yelp. Sort by length descending so
  // the most substantive answer goes to Google (typically higher-impact SEO).
  const { data: attempt } = await supabase
    .from('test_attempts')
    .select('id')
    .eq('trainee_id', trainee_id)
    .not('submitted_at', 'is', null)
    .maybeSingle()

  let essays = []
  if (attempt) {
    const { data: responses } = await supabase
      .from('test_responses')
      .select('essay_response, question_prompt')
      .eq('attempt_id', attempt.id)
      .eq('question_type', 'essay')
      .eq('use_for_testimonial', true)
      .not('essay_response', 'is', null)
    essays = (responses || [])
      .filter((r) => r.essay_response && r.essay_response.trim().length > 0)
      .sort((a, b) => (b.essay_response || '').length - (a.essay_response || '').length)
  }

  // Pick the answer for each platform. If only 1 essay exists, use the same
  // one for both. If 0 essays, both will be null and the email falls back to
  // just the links.
  const googleEssay = essays[0] || null
  const yelpEssay = essays[1] || essays[0] || null

  const firstName = (t.first_name || 'there').trim() || 'there'
  const subject = `Thanks for completing your training, ${firstName} — 30-second favor?`
  const textBody = buildBody({
    firstName,
    googleEssay,
    yelpEssay,
    sameEssay: !!(googleEssay && yelpEssay && googleEssay === yelpEssay),
  })

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

function buildBody({ firstName, googleEssay, yelpEssay, sameEssay }) {
  const intro =
    `Hi ${firstName},\n\n` +
    `Thanks so much for finishing your final assessment — that's a real accomplishment.\n\n` +
    `One small ask: would you take 30 seconds to leave a quick review? We've pre-picked one of your own essay answers for each site — just click the link, then paste the answer below.\n`

  let body = intro

  // Google section
  body += `\n────────────────────────────────────────\n`
  body += `⭐ GOOGLE REVIEW\n`
  body += `Step 1 — click: ${GOOGLE_REVIEW_URL}\n`
  if (googleEssay) {
    body += `Step 2 — copy & paste this answer of yours:\n\n`
    body += `"${googleEssay.essay_response.trim()}"\n`
  } else {
    body += `Step 2 — write a short note about your training experience.\n`
  }

  // Yelp section
  body += `\n────────────────────────────────────────\n`
  body += `⭐ YELP REVIEW\n`
  body += `Step 1 — click: ${YELP_REVIEW_URL}\n`
  if (yelpEssay) {
    if (sameEssay) {
      body += `Step 2 — paste the same answer (it was the only one you wrote that we could use):\n\n`
    } else {
      body += `Step 2 — copy & paste this different answer of yours:\n\n`
    }
    body += `"${yelpEssay.essay_response.trim()}"\n`
  } else {
    body += `Step 2 — write a short note about your training experience.\n`
  }

  body += `\n────────────────────────────────────────\n`
  body += `That's it. Each one really does help the next class find us.\n\n`
  body += `Congratulations on graduating training!\n\n`
  body += `— U.S. Shingle & Metal Training Team`

  return body
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
