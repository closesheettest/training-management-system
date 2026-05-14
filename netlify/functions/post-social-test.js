// Manual test: post a one-off message to the configured Facebook Page.
// Called from the "Send test FB post" button on /messages.
//
// Request body: { message?: string, photo_url?: string }
// Response: { ok, post_id?, error? }

import { postToFacebookPage } from './_facebook.js'
import { postToLinkedIn } from './_linkedin.js'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' })

  let body = {}
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  const message =
    body.message ||
    `Test post from the training auto-post system at ${new Date().toLocaleString('en-US')}. ` +
      `If you can see this on both Facebook and LinkedIn, the integration is working. Safe to delete.`
  const photoUrl = body.photo_url || null

  // Fire both in parallel. Each is independent — one failing doesn't fail the
  // other. Caller gets a per-platform result.
  const [facebook, linkedin] = await Promise.all([
    postToFacebookPage({ message, photoUrl }),
    postToLinkedIn({ message, photoUrl }),
  ])

  return json(200, { facebook, linkedin })
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
