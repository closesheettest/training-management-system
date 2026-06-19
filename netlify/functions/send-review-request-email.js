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
import { sendSmsViaGhl } from './_ghl.js'

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
    .select('id, first_name, last_name, email, phone, review_email_sent_at, classes!class_id(region, week_start_date)')
    .eq('id', trainee_id)
    .maybeSingle()
  if (tErr || !t) return json(404, { error: 'Trainee not found' })

  if (!t.email && !t.phone) {
    return json(200, { ok: false, skipped_reason: 'Trainee has no email or phone on file' })
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

  // Send as TWO separate emails so the trainee doesn't get confused about
  // which review goes where. Each email is focused on one business with
  // two sections inside (Google + Yelp). Different subjects so they sort
  // distinctly in their inbox.
  const usShingleEmail = {
    subject: `${firstName}, quick review for U.S. Shingle & Metal (2 min)`,
    body: buildBusinessEmail({
      firstName,
      businessName: 'U.S. Shingle & Metal',
      intro:
        "Thanks so much for finishing your final assessment — that's a real accomplishment. " +
        "Would you leave a quick review for U.S. Shingle & Metal? I've pre-picked one of " +
        "your own essay answers for each site — click the link, paste the answer, done.",
      sections: [
        {
          n: 1,
          platform: 'Google',
          url: US_SHINGLE_GOOGLE_URL,
          essay: usGoogleEssay,
          sameAsPrev: false,
        },
        {
          n: 2,
          platform: 'Yelp',
          url: US_SHINGLE_YELP_URL,
          essay: usYelpEssay,
          sameAsPrev: !!(usGoogleEssay && usYelpEssay && usGoogleEssay === usYelpEssay),
        },
      ],
      sendoff:
        "Each review really does help the next class of trainees find us. " +
        "There's a second email coming with a quick review for your trainer Neal — " +
        "if you have an extra minute, that would be huge too.",
    }),
  }

  const nealEmail = {
    subject: `${firstName}, quick review for your trainer Neal Scoppettuolo (2 min)`,
    body: buildBusinessEmail({
      firstName,
      businessName: 'Neal Scoppettuolo — Corporate Trainer',
      intro:
        "One more quick ask. Your trainer Neal Scoppettuolo runs training for sales reps " +
        "and the only way new reps find him is through reviews from past trainees. " +
        "Would you leave him a quick review on each site? I've pre-picked one of your own " +
        "essay answers for each — click the link, paste the answer, done.",
      sections: [
        {
          n: 1,
          platform: 'Google',
          url: NEAL_GOOGLE_URL,
          essay: nealGoogleEssay,
          sameAsPrev: false,
        },
        {
          n: 2,
          platform: 'Yelp',
          url: NEAL_YELP_URL,
          essay: nealYelpEssay,
          sameAsPrev: !!(nealGoogleEssay && nealYelpEssay && nealGoogleEssay === nealYelpEssay),
        },
      ],
      sendoff: "Thanks again, congratulations on graduating training!",
    }),
  }

  // SMS version: the email carries all four links, but an SMS with four
  // links is unreadable. Send one short friendly line + the single most
  // important ask — the U.S. Shingle Google review (client first, the
  // surface that matters most). The full set still arrives by email.
  const smsBody =
    `Congrats on graduating training, ${firstName}! ` +
    `If you have 2 min, a quick Google review for U.S. Shingle & Metal would mean a lot: ${US_SHINGLE_GOOGLE_URL} ` +
    `Check your email for a couple more quick review links too. — U.S. Shingle Training Team`

  // Fire email + SMS in parallel so the trainee sees them at roughly the
  // same time. Email sends as two messages (one per business).
  const [usResult, nealResult, smsResult] = await Promise.all([
    t.email ? sendEmail(t.email, usShingleEmail.subject, usShingleEmail.body) : Promise.resolve({ ok: false, skipped: 'no email' }),
    t.email ? sendEmail(t.email, nealEmail.subject, nealEmail.body) : Promise.resolve({ ok: false, skipped: 'no email' }),
    t.phone ? sendSmsViaGhl(t.phone, smsBody, { firstName, lastName: 'Reviews' }) : Promise.resolve({ ok: false, skipped: 'no phone' }),
  ])

  const anyOk = usResult.ok || nealResult.ok || smsResult.ok
  if (!anyOk) {
    return json(200, {
      ok: false,
      us_shingle: usResult,
      neal: nealResult,
      sms: smsResult,
    })
  }

  // Stamp if at least one channel delivered. Same dedup pattern as
  // elsewhere — partial success is success, the retry won't re-spam.
  await supabase
    .from('trainees')
    .update({ review_email_sent_at: new Date().toISOString() })
    .eq('id', trainee_id)

  return json(200, {
    ok: true,
    sent_to: t.email || undefined,
    sent_sms: t.phone ? smsResult.ok : undefined,
    us_shingle: usResult,
    neal: nealResult,
    sms: smsResult,
  })
}

// ── Email body builder ──────────────────────────────────────────────────
//
// One email = one business with two review sections (Google + Yelp).
// Plain text with horizontal-rule dividers. Each section gives the
// trainee a one-click link + their own pre-picked answer to paste.

function buildBusinessEmail({ firstName, businessName, intro, sections, sendoff }) {
  let body = `Hi ${firstName},\n\n${intro}\n`

  for (const s of sections) {
    body += `\n────────────────────────────────────────\n`
    body += `⭐ ${s.platform.toUpperCase()} REVIEW FOR ${businessName.toUpperCase()}\n`
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
  body += `${sendoff}\n\n`
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
