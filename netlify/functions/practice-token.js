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
  const model = process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live'
  const textModel = process.env.GEMINI_TEXT_MODEL || 'gemini-3.8-flash'

  // { check: true } — setup check, no PIN: does Google accept the key, and do the
  // voice + grading models we are set to use exist for it? Answers yes/no and
  // model names only; never echoes the key. Costs nothing (lists models).
  if (body.check) {
    const names = []
    let pageToken = '', status = 0, err = ''
    for (let i = 0; i < 10; i++) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200${pageToken ? `&pageToken=${pageToken}` : ''}`, { headers: { 'x-goog-api-key': key } })
      status = r.status
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { err = d.error?.message || String(r.status); break }
      for (const m of d.models || []) names.push(String(m.name || '').replace(/^models\//, ''))
      if (!d.nextPageToken) break
      pageToken = d.nextPageToken
    }
    return json(200, {
      ok: !err, key_accepted: !err, status, error: err || undefined,
      live_model: model, live_model_found: names.includes(model),
      text_model: textModel, text_model_found: names.includes(textModel),
      live_models_available: names.filter((n) => /live|native-audio/i.test(n)),
      flash_models_available: names.filter((n) => /flash/i.test(n) && !/live|audio|tts|image/i.test(n)).slice(0, 12),
    })
  }

  if (!(await verifyTrainerPin(body.pin))) return json(401, { ok: false, error: 'Sign in again (PIN not recognized).' })

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
