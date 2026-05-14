// Fires a generic testimonial post to Facebook using a trainee's testimonial-
// eligible essay answer.
//
// Called from TakeTest.jsx right after a trainee submits their final test.
// Picks the longest testimonial-eligible essay (proxy for "best/most quotable"),
// generates a generic post, and publishes. Skips silently if no eligible
// essay exists.
//
// Request body: { trainee_id: "uuid" }

import { createClient } from '@supabase/supabase-js'
import { postToFacebookPage } from './_facebook.js'
import { postToLinkedIn } from './_linkedin.js'
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
    .select('id, first_name, last_name, years_in_sales, classes(locations(name, city, photo_urls))')
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
    return json(200, { ok: false, skipped_reason: 'No submitted test for this trainee' })
  }

  const { data: responses } = await supabase
    .from('test_responses')
    .select('essay_response')
    .eq('attempt_id', attempt.id)
    .eq('question_type', 'essay')
    .eq('use_for_testimonial', true)
    .not('essay_response', 'is', null)

  const essays = (responses || [])
    .filter((r) => r.essay_response && r.essay_response.trim().length > 0)
    .sort((a, b) => b.essay_response.length - a.essay_response.length)

  if (essays.length === 0) {
    return json(200, { ok: false, skipped_reason: 'No testimonial-eligible essay' })
  }

  const message = buildTestimonialPost({
    quote: essays[0].essay_response,
    firstName: trainee.first_name,
    lastName: trainee.last_name,
    yearsInSales: trainee.years_in_sales,
  })

  // Attach a random photo of the venue if one exists.
  const photos = trainee.classes?.locations?.photo_urls || []
  const photoUrl = photos.length ? photos[Math.floor(Math.random() * photos.length)] : null

  const [facebook, linkedin] = await Promise.all([
    postToFacebookPage({ message, photoUrl }),
    postToLinkedIn({ message, photoUrl }),
  ])
  return json(200, { facebook, linkedin, preview_message: message, used_photo: !!photoUrl })
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
