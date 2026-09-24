// Server-side check for the Sales Training Customer functions. The page sits
// behind PinGate, but PinGate is a browser lock; these functions spend Gemini
// money and hold trainee transcripts, so each call re-verifies the signed-in
// trainer's PIN against the same per-person list (CCG regional-admin-pin).
const PIN_URL = 'https://free-roof-inspections.netlify.app/.netlify/functions/regional-admin-pin'

export async function verifyTrainerPin(pin) {
  if (!String(pin || '').trim()) return null
  try {
    const r = await fetch(PIN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify', pin: String(pin) }),
    })
    const d = await r.json().catch(() => ({}))
    return d.ok && d.valid ? { name: d.name || '' } : null
  } catch { return null }
}

export function json(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) }
}
