// Facebook Page posting helper.
//
// Required env vars: FB_PAGE_ACCESS_TOKEN, FB_PAGE_ID
//
// Posts a plain status update OR a photo-with-caption to the Neal Scoppettuolo
// Corporate Trainer Page. Returns { ok, post_id?, error?, step? } — never
// throws.

const FB_GRAPH = 'https://graph.facebook.com/v19.0'

export async function postToFacebookPage({ message, photoUrl }) {
  const token = process.env.FB_PAGE_ACCESS_TOKEN
  const pageId = process.env.FB_PAGE_ID
  if (!token || !pageId) {
    return { ok: false, step: 'precheck', error: 'FB_PAGE_ACCESS_TOKEN or FB_PAGE_ID not set' }
  }
  if (!message || !message.trim()) {
    return { ok: false, step: 'precheck', error: 'No message body provided' }
  }

  const endpoint = photoUrl
    ? `${FB_GRAPH}/${pageId}/photos`
    : `${FB_GRAPH}/${pageId}/feed`

  const body = photoUrl
    ? { url: photoUrl, caption: message, access_token: token }
    : { message, access_token: token }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || json.error) {
      return {
        ok: false,
        step: 'fb_publish',
        error: json.error?.message || `HTTP ${res.status}`,
        details: json.error || null,
      }
    }
    return { ok: true, post_id: json.id || json.post_id || null }
  } catch (err) {
    return { ok: false, step: 'exception', error: err.message || 'Unknown' }
  }
}
