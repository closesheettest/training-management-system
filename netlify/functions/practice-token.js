// Sales Training Customer: hand the trainer's browser a short-lived Gemini Live
// token so it can talk to the AI homeowner directly (audio can't go through a
// Netlify function). The real GEMINI_API_KEY never leaves the server; the token
// is good for ONE session start within a minute, and that session for 30 min.
// The page asks for a fresh one to reconnect (Live connections are recycled
// every ~10 min and resumed with a handle).
//
// POST { pin } → { ok, token, model }
// Env: GEMINI_API_KEY (billing ON: the free tier may train on the data).
//      GEMINI_LIVE_MODEL optional (default gemini-3.8-live).
import { verifyTrainerPin, json } from './_practice-auth.js'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' })
  const key = process.env.GEMINI_API_KEY
  if (!key) return json(500, { ok: false, error: 'The Gemini key is not set up yet (GEMINI_API_KEY in Netlify).' })
  let body
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { ok: false, error: 'bad JSON' }) }
  if (!(await verifyTrainerPin(body.pin))) return json(401, { ok: false, error: 'Sign in again (PIN not recognized).' })

  const model = process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live'
  const now = Date.now()
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      uses: 1,
      expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
      newSessionExpireTime: new Date(now + 60 * 1000).toISOString(),
      liveConnectConstraints: { model: `models/${model}` },
    }),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || !d.name) return json(502, { ok: false, error: `Gemini refused the token: ${d.error?.message || r.status}` })
  return json(200, { ok: true, token: d.name, model })
}
