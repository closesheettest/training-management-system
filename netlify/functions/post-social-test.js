// Manual test: post a one-off message to the configured Facebook Page.
// Called from the "Send test FB post" button on /messages.
//
// Request body: { message?: string, photo_url?: string }
// Response: { ok, post_id?, error? }

import { postToFacebookPage } from './_facebook.js'

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
      `If you can see this on the Page, the Facebook integration is working. Safe to delete.`

  const result = await postToFacebookPage({ message, photoUrl: body.photo_url || null })
  return json(200, result)
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
