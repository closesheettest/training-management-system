// Enqueue paced social posts (Facebook + LinkedIn) for a graduating trainee.
//
// Called from TakeTest.jsx the moment a trainee submits their final test.
// Instead of firing posts immediately, this function:
//   - Pulls the trainee's testimonial-eligible essay answers, sorted longest first
//   - Picks longest for Facebook, second-longest for LinkedIn (different
//     essays — same trainee shows up twice, once on each platform)
//   - Schedules each post 1 day after the latest pending item already in
//     that platform's queue (so 12 trainees → ~12 days of paced posts per
//     platform)
//   - The daily flush-social-queue cron at 9 AM Eastern publishes one item
//     per platform per day
//
// Graduation announcement still fires immediately (that's the headliner).
//
// Skips silently if no testimonial-eligible essay. If only 1 essay,
// Facebook gets it and LinkedIn is skipped (to avoid duplicate quotes).

import { createClient } from '@supabase/supabase-js'
import { buildTestimonialPost } from './_social_copy.js'

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

  const { data: trainee } = await supabase
    .from('trainees')
    .select('id, class_id, first_name, last_name, years_in_sales, classes(locations(photo_urls))')
    .eq('id', trainee_id)
    .maybeSingle()
  if (!trainee) return json(404, { error: 'Trainee not found' })

  const { data: attempt } = await supabase
    .from('test_attempts')
    .select('id')
    .eq('trainee_id', trainee_id)
    .not('submitted_at', 'is', null)
    .maybeSingle()
  if (!attempt) {
    return json(200, { ok: false, skipped_reason: 'No submitted test' })
  }

  const { data: responses } = await supabase
    .from('test_responses')
    .select('essay_response, question_prompt')
    .eq('attempt_id', attempt.id)
    .eq('question_type', 'essay')
    .eq('use_for_testimonial', true)
    .not('essay_response', 'is', null)

  const essays = (responses || [])
    .filter((r) => r.essay_response && r.essay_response.trim().length > 0)
    .sort((a, b) => b.essay_response.length - a.essay_response.length)

  if (essays.length === 0) {
    return json(200, { ok: false, skipped_reason: 'No testimonial-eligible essays' })
  }

  // Pick a random venue photo (same selection for both platforms — simplest).
  const photos = trainee.classes?.locations?.photo_urls || []
  const photoUrl = photos.length ? photos[Math.floor(Math.random() * photos.length)] : null

  // Common copy fields for buildTestimonialPost.
  const meta = {
    firstName: trainee.first_name,
    lastName: trainee.last_name,
    yearsInSales: trainee.years_in_sales,
  }

  // Decide which essay goes where. Different essays per platform when we have
  // at least 2; otherwise Facebook gets the only essay and LinkedIn is skipped
  // (so we don't post the exact same quote twice).
  const fbEssay = essays[0]
  const liEssay = essays[1] || null

  const fbMessage = buildTestimonialPost({
    ...meta,
    quote: fbEssay.essay_response,
    question: fbEssay.question_prompt,
  })
  const liMessage = liEssay
    ? buildTestimonialPost({
        ...meta,
        quote: liEssay.essay_response,
        question: liEssay.question_prompt,
      })
    : null

  const enqueued = []

  if (fbMessage) {
    const at = await nextSlotFor(supabase, 'facebook')
    const { data, error } = await supabase
      .from('social_post_queue')
      .insert({
        class_id: trainee.class_id,
        trainee_id,
        platform: 'facebook',
        message: fbMessage,
        photo_url: photoUrl,
        scheduled_post_at: at,
      })
      .select('id, scheduled_post_at')
      .maybeSingle()
    if (!error && data) enqueued.push({ platform: 'facebook', id: data.id, scheduled_post_at: data.scheduled_post_at })
  }

  if (liMessage) {
    const at = await nextSlotFor(supabase, 'linkedin')
    const { data, error } = await supabase
      .from('social_post_queue')
      .insert({
        class_id: trainee.class_id,
        trainee_id,
        platform: 'linkedin',
        message: liMessage,
        photo_url: photoUrl,
        scheduled_post_at: at,
      })
      .select('id, scheduled_post_at')
      .maybeSingle()
    if (!error && data) enqueued.push({ platform: 'linkedin', id: data.id, scheduled_post_at: data.scheduled_post_at })
  }

  return json(200, { ok: true, enqueued })
}

// Returns the timestamp when this platform's next post should fire.
// If queue is empty for this platform: next 9 AM Eastern (today if before 9
// AM, tomorrow otherwise).
// If queue has pending items: 1 day after the latest scheduled item.
async function nextSlotFor(supabase, platform) {
  const { data } = await supabase
    .from('social_post_queue')
    .select('scheduled_post_at')
    .eq('platform', platform)
    .is('posted_at', null)
    .order('scheduled_post_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (data?.scheduled_post_at) {
    const d = new Date(data.scheduled_post_at)
    d.setUTCDate(d.getUTCDate() + 1)
    return d.toISOString()
  }
  // No queue → next 9 AM Eastern slot.
  return nextNineAmEastern()
}

// Returns ISO string for the next upcoming 9 AM America/New_York time.
function nextNineAmEastern() {
  const now = new Date()
  const nyParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(now)
  const get = (t) => Number(nyParts.find((p) => p.type === t)?.value || 0)
  const year = get('year')
  const month = get('month')
  const day = get('day')
  const hour = get('hour')
  // 9 AM ET = ~13:00 UTC (EDT) or 14:00 UTC (EST). Use Date.UTC math, then
  // re-interpret in NY timezone. Simpler: build a UTC date for today's 13:00,
  // and check if it's >= now; if not, add a day. (DST off-by-one is okay for
  // posting — never more than one hour shift.)
  let candidate = new Date(Date.UTC(year, month - 1, day, 13, 0, 0))
  if (hour >= 9) {
    // Already past 9 AM ET today — schedule for tomorrow 9 AM ET.
    candidate.setUTCDate(candidate.getUTCDate() + 1)
  }
  return candidate.toISOString()
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
