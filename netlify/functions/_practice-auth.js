// Server-side check for the Sales Training Customer functions. The page sits
// behind PinGate, but PinGate is a browser lock; these functions spend Gemini
// money and hold trainee transcripts, so each call re-verifies the signed-in
// trainer's PIN against the same per-person list (CCG regional-admin-pin).
const PIN_URL = 'https://free-roof-inspections.netlify.app/.netlify/functions/regional-admin-pin'

// OPENED FROM MY TOOLS (Neal, 2026-10-09: "it should recognize that I'm already authorized"): the page holds
// "mt:<base64 {name, pin}>" — the person's own My Tools name + passcode, checked with CCG. Never SETS a passcode:
// a name without one is refused (same rule as meet.js Call).
const MT = 'https://free-roof-inspections.netlify.app/.netlify/functions/manager-dashboard'
export async function verifyMyTools(mt) {
  const nm = String(mt?.name || '').trim().slice(0, 60), pw = String(mt?.pin || '').trim()
  if (!nm || !pw) return null
  try {
    const has = await fetch(`${MT}?manager=${encodeURIComponent(nm)}`).then((r) => r.json()).catch(() => ({}))
    if (!has.pin_set) return null
    const ok = await fetch(MT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'auth', manager: nm, pin: pw }) }).then((r) => r.json()).catch(() => ({}))
    return ok.ok ? { name: nm } : null
  } catch { return null }
}

export async function verifyTrainerPin(pin) {
  if (!String(pin || '').trim()) return null
  if (String(pin).startsWith('mt:')) {
    try { return await verifyMyTools(JSON.parse(decodeURIComponent(Buffer.from(String(pin).slice(3), 'base64').toString('utf8')))) } catch { return null }
  }
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
