// Netlify Function: post-test review-request email.
//
// Fired by TakeTest.jsx right after a trainee submits their final test.
// Sends ONE email asking the trainee to leave FOUR reviews — Google + Yelp
// for the CLIENT (U.S. Shingle & Metal) and Google + Yelp for the TRAINER
// (Neal Scoppettuolo, Corporate Trainer). Each section is pre-filled with
// one of the trainee's own essay answers (verbatim — never reworded), so
// they click the link and paste:
//
//   #1 of 4 — U.S. Shingle Google     ← longest use_for_client_review essay
//   #2 of 4 — U.S. Shingle Yelp       ← second-longest use_for_client_review
//   #3 of 4 — Neal Google             ← longest use_for_testimonial essay
//   #4 of 4 — Neal Yelp               ← second-longest use_for_testimonial
//
// Order: client first, trainer second. Rationale: trainees are most aligned
// with their new employer (client) right after graduation, so put those
// asks first when their goodwill is highest.
//
// Stamps trainees.review_email_sent_at on success so the email doesn't
// repeat if the trainee lands on TestDone again.
//
// Required env vars:
//   SUPABASE_URL, SUPABASE_SECRET_KEY
//   RESEND_API_KEY                    — for the email to actually deliver
//   FROM_EMAIL / EMAIL_FROM            — verified Resend sender
//
// Request body: { trainee_id: "uuid" }
// Response: { ok, sent_to?, skipped_reason? }

import { createClient } from '@supabase/supabase-js'
import { sendEmail } from './_email.js'

// ── Review URLs ─────────────────────────────────────────────────────────
//
// The Google URLs use Maps' "!9m1!1b1" data param to land trainees
// directly on the Reviews tab where the "Write a review" button is the
// first thing they see. Yelp URLs are Yelp's standard /writeareview/biz/
// <slug> pattern.

const US_SHINGLE_GOOGLE_URL =
  'https://www.google.com/maps/place/U.S.+Shingle+%26+Metal/@27.8527654,-82.6883464,17z/data=!4m8!3m7!1s0x8fb84b03769f830d:0x8d64a0e607cf3840!8m2!3d27.8527654!4d-82.6857715!9m1!1b1!16s%2Fg%2F11l5dn1vrt'
const US_SHINGLE_YELP_URL =
  'https://www.yelp.com/writeareview/biz/us-shingle-clearwater'

// Neal Scoppettuolo — Corporate Trainer (personal brand surface).
// Token-style g.page short link returned by Google Business Profile.
const NEAL_GOOGLE_URL = 'https://g.page/r/CYeQXuq6eOfTEAI/review'
const NEAL_YELP_URL =
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

  // ── Build the two essay pools ─────────────────────────────────────────
  //
  // Each pool is sorted longest-first so #1 (Google) gets the most
  // substantive answer and #2 (Yelp) gets the second-most.
  //
  //   clientPool   — essays flagged use_for_client_review on /questions.
  //                  U.S. Shingle-specific wording is welcome.
  //                  Used for the two U.S. Shingle review sections.
  //   trainerPool  — essays flagged use_for_testimonial on /questions.
  //                  Generic — about Neal as a corporate trainer.
  //                  Used for the two Neal review sections.

  const { data: attempt } = await supabase
    .from('test_attempts')
    .select('id')
    .eq('trainee_id', trainee_id)
    .not('submitted_at', 'is', null)
    .maybeSingle()

  let clientPool = []
  let trainerPool = []
  let anyEssayPool = []
  if (attempt) {
    const { data: responses } = await supabase
      .from('test_responses')
      .select('essay_response, question_prompt, use_for_client_review, use_for_testimonial')
      .eq('attempt_id', attempt.id)
      .eq('question_type', 'essay')
      .not('essay_response', 'is', null)
    const all = (responses || []).filter(
      (r) => r.essay_response && r.essay_response.trim().length > 0,
    )
    const byLength = (a, b) => (b.essay_response || '').length - (a.essay_response || '').length
    clientPool = all.filter((r) => r.use_for_client_review).sort(byLength)
    trainerPool = all.filter((r) => r.use_for_testimonial).sort(byLength)
    anyEssayPool = all.slice().sort(byLength)
  }

  // ── Pick the four essays ──────────────────────────────────────────────
  //
  // Fallback chain when a pool is short:
  //   - If the trainer pool is empty, fall back to anyEssayPool so the
  //     Neal sections still have something to paste.
  //   - Same for the client pool.
  //   - If a single pool has only 1 essay, reuse it for both the Google
  //     and Yelp section of that business (same essay flagged as such).

  const fallbackClient = clientPool.length > 0 ? clientPool : anyEssayPool
  const fallbackTrainer = trainerPool.length > 0 ? trainerPool : anyEssayPool

  const usGoogleEssay = fallbackClient[0] || null
  const usYelpEssay = fallbackClient[1] || fallbackClient[0] || null
  const nealGoogleEssay = fallbackTrainer[0] || null
  const nealYelpEssay = fallbackTrainer[1] || fallbackTrainer[0] || null

  const firstName = (t.first_name || 'there').trim() || 'there'
  const subject = `Thanks for completing your training, ${firstName} — 4 quick reviews?`
  const textBody = buildBody({
    firstName,
    sections: [
      {
        n: 1,
        platform: 'Google',
        business: 'U.S. Shingle & Metal',
        url: US_SHINGLE_GOOGLE_URL,
        essay: usGoogleEssay,
        sameAsPrev: false,
      },
      {
        n: 2,
        platform: 'Yelp',
        business: 'U.S. Shingle & Metal',
        url: US_SHINGLE_YELP_URL,
        essay: usYelpEssay,
        sameAsPrev: !!(usGoogleEssay && usYelpEssay && usGoogleEssay === usYelpEssay),
      },
      {
        n: 3,
        platform: 'Google',
        business: 'Neal Scoppettuolo — Corporate Trainer',
        url: NEAL_GOOGLE_URL,
        essay: nealGoogleEssay,
        sameAsPrev: false,
      },
      {
        n: 4,
        platform: 'Yelp',
        business: 'Neal Scoppettuolo — Corporate Trainer',
        url: NEAL_YELP_URL,
        essay: nealYelpEssay,
        sameAsPrev: !!(nealGoogleEssay && nealYelpEssay && nealGoogleEssay === nealYelpEssay),
      },
    ],
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

// ── Email body builder ──────────────────────────────────────────────────
//
// Plain text. Four numbered review sections separated by horizontal rules.
// Each section: platform · business name · link · prefilled answer with the
// original question shown in context so the pasted block reads naturally.

function buildBody({ firstName, sections }) {
  let body =
    `Hi ${firstName},\n\n` +
    `Thanks so much for finishing your final assessment — that's a real accomplishment.\n\n` +
    `One ask before you go: would you leave 4 quick reviews so the next class of trainees can find us? Two for U.S. Shingle & Metal (the company you're joining) and two for Neal Scoppettuolo (your corporate trainer). I've pre-picked one of your own essay answers for each — just click the link, then paste the answer.\n`

  for (const s of sections) {
    body += `\n────────────────────────────────────────\n`
    body += `⭐ #${s.n} OF 4 — ${s.platform.toUpperCase()} REVIEW FOR ${s.business.toUpperCase()}\n`
    body += `Step 1 — click: ${s.url}\n`
    if (s.essay) {
      if (s.sameAsPrev) {
        body += `Step 2 — paste the same answer you used above (it was the only one we could use for this business).\n`
      } else {
        body += `Step 2 — copy & paste this answer of yours below.\n`
      }
      if (s.essay.question_prompt) {
        body += `(You wrote it in response to: "${s.essay.question_prompt.trim()}")\n`
      }
      body += `\n"${s.essay.essay_response.trim()}"\n`
    } else {
      body += `Step 2 — write a short note about your training experience in your own words.\n`
    }
  }

  body += `\n────────────────────────────────────────\n`
  body += `That's everything. Each review takes about a minute and really does help the next class of trainees find us.\n\n`
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
