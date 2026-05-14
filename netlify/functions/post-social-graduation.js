// Fires a generic "class graduated" post to the Facebook Page.
// Called automatically from send-graduation-report.js after the PDF email
// goes out. Can also be called manually with POST { class_id } for testing
// or re-posting.
//
// Picks a random photo from the class's location.photo_urls (if any) to
// attach to the post.

import { createClient } from '@supabase/supabase-js'
import { postToFacebookPage } from './_facebook.js'
import { postToLinkedIn } from './_linkedin.js'
import { buildGraduationPost } from './_social_copy.js'

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
  const { class_id } = body
  if (!class_id) return json(400, { error: 'class_id required' })

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  const { data: cls, error: clsErr } = await supabase
    .from('classes')
    .select('id, region, week_start_date, locations(name, city, photo_urls), trainees(id, enrolled)')
    .eq('id', class_id)
    .maybeSingle()
  if (clsErr || !cls) return json(404, { error: 'Class not found' })

  const graduateCount = (cls.trainees || []).filter((t) => t.enrolled !== false).length
  if (graduateCount === 0) {
    return json(200, { ok: false, skipped_reason: 'No graduates to celebrate' })
  }

  const message = buildGraduationPost({ count: graduateCount, location: cls.locations })

  // Pick a random photo from the location if any are uploaded.
  const photos = cls.locations?.photo_urls || []
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
