// Sales Training Customer: hand the trainer's browser a short-lived Gemini Live
// token so it can talk to the AI homeowner directly (audio can't go through a
// Netlify function). The real GEMINI_API_KEY never leaves the server; the token
// is good for ONE session start within a minute, and that session for 30 min.
// The page asks for a fresh one to reconnect (Live connections are recycled
// every ~10 min and resumed with a handle).
//
// POST { pin }                      → { ok, token, model }
// POST { check: true }              → setup check: key accepted? models exist?
// POST { check: 'live', secret }    → a real short Live session, server-side
// Env: GEMINI_API_KEY (billing ON: the free tier may train on the data).
//      GEMINI_LIVE_MODEL / GEMINI_TEXT_MODEL optional. CRON_SECRET gates 'live'.
import WebSocketImpl from 'ws'
import { verifyTrainerPin, json } from './_practice-auth.js'
import { liveSetup, LIVE_WS_URL } from '../../src/lib/geminiLive.js'
import { PERSONAS, homeownerPrompt } from '../../src/lib/salesPractice.js'

// One-use token. Google's auth_tokens call takes uses + expiry times; it
// rejected the "liveConnectConstraints" block the docs showed ("Unknown name
// ... at 'auth_token'", first real run 2026-09-25), so the token is not pinned
// to a model. It is single-use and dies in a minute if no session starts.
async function mintToken(key) {
  const now = Date.now()
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      uses: 1,
      expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
      newSessionExpireTime: new Date(now + 60 * 1000).toISOString(),
    }),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || !d.name) throw new Error(`Gemini refused the token: ${d.error?.message || r.status}`)
  return d.name
}

// A real Live session exactly as the page opens one: token → WebSocket → setup
// (the shared liveSetup) → say something → expect the homeowner's voice and
// words back. Proves the voice path without a trainer at a laptop. A few cents.
async function liveSmokeTest(key, model) {
  const token = await mintToken(key)
  const p = PERSONAS[0]
  return await new Promise((resolve) => {
    const res = { steps: ['token ok'], setup_ok: false, audio_chunks: 0, homeowner_said: '' }
    const ws = new WebSocketImpl(`${LIVE_WS_URL}?access_token=${encodeURIComponent(token)}`)
    let done = false
    const finish = (extra) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try { ws.close() } catch { /* already closed */ }
      resolve({ ...res, ...extra })
    }
    const timer = setTimeout(() => finish({ ok: false, error: 'timed out after 20s' }), 20000)
    ws.on('open', () => {
      res.steps.push('socket open')
      ws.send(JSON.stringify(liveSetup({ model, systemPrompt: homeownerPrompt(p, 'survey'), voice: p.voice })))
    })
    ws.on('message', (buf) => {
      let m
      try { m = JSON.parse(buf.toString()) } catch { return }
      if (m.setupComplete) {
        res.setup_ok = true
        res.steps.push('setup accepted')
        // The page's slide note, sent exactly as geminiLive.sendSlide sends it.
        ws.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text: '[Slide now showing: Why U.S. Shingle: 15 years in business, veteran owned.] (stage info only: do not respond to this)' }] }], turnComplete: false } }))
        res.steps.push('slide note sent')
        ws.send(JSON.stringify({ realtimeInput: { text: "Hi, I'm Mike from U.S. Shingle. Thanks for having me. Mind if I ask you a couple of questions about the house?" } }))
        return
      }
      const sc = m.serverContent
      if (!sc) return
      for (const part of sc.modelTurn?.parts || []) if (part.inlineData?.data) res.audio_chunks++
      if (sc.outputTranscription?.text) res.homeowner_said += sc.outputTranscription.text
      if (sc.turnComplete) finish({ ok: res.audio_chunks > 0 })
    })
    ws.on('close', (code, reason) => finish({ ok: res.audio_chunks > 0, close_code: code, close_reason: String(reason || '') }))
    ws.on('error', (e) => finish({ ok: false, error: e.message }))
  })
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' })
  const key = process.env.GEMINI_API_KEY
  if (!key) return json(500, { ok: false, error: 'The Gemini key is not set up yet (GEMINI_API_KEY in Netlify).' })
  let body
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { ok: false, error: 'bad JSON' }) }
  const model = process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live'
  const textModel = process.env.GEMINI_TEXT_MODEL || 'gemini-3.8-flash'

  if (body.check === 'live') {
    if (!process.env.CRON_SECRET || body.secret !== process.env.CRON_SECRET) return json(401, { ok: false, error: 'secret required' })
    try { return json(200, await liveSmokeTest(key, model)) } catch (e) { return json(200, { ok: false, error: e.message }) }
  }

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
  try {
    return json(200, { ok: true, token: await mintToken(key), model })
  } catch (e) {
    return json(502, { ok: false, error: e.message })
  }
}
