// Shared GoHighLevel helper for SMS.
// Contacts are upserted by phone first; GHL needs a contactId before it'll
// deliver a message. Never throws — returns { ok, step?, error? }.
//
// Rate-limit handling: GHL caps at ~100 requests / 10 seconds per location.
// When we burst-send to a class (or to all active reps via Group Messages)
// we hit that ceiling and get 429s back. fetchWithRetry retries 429s and
// 5xx errors with exponential backoff + jitter, up to 3 attempts. Callers
// that want stricter concurrency should also limit how many sendSmsViaGhl
// calls are in flight at once (see send-group-message.js for an example).
//
// Required env vars: GHL_PIT_TOKEN, GHL_LOCATION_ID

const GHL_BASE = 'https://services.leadconnectorhq.com'
const GHL_VERSION = '2021-07-28'

export function ghlHeaders() {
  return {
    Authorization: `Bearer ${process.env.GHL_PIT_TOKEN}`,
    Version: GHL_VERSION,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

// Internal: fetch wrapper with retry-on-429 + retry-on-5xx. Each retry
// backs off with jitter so concurrent callers don't all retry at the
// same instant. Max 3 attempts (1 initial + 2 retries). Returns the
// final Response object regardless of status — callers decide if it's
// fatal.
async function fetchWithRetry(url, init, maxAttempts = 3) {
  let lastRes
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    lastRes = await fetch(url, init)
    if (lastRes.status !== 429 && lastRes.status < 500) {
      return lastRes
    }
    // 429 = rate limited; 5xx = transient GHL outage. Both worth retrying.
    if (attempt === maxAttempts - 1) break
    // Backoff: 800ms, 2000ms, 4500ms (with up to 500ms jitter each).
    const base = [800, 2000, 4500][attempt]
    const jitter = Math.floor(Math.random() * 500)
    await new Promise((r) => setTimeout(r, base + jitter))
  }
  return lastRes
}

export async function sendSmsViaGhl(phone, message, { firstName = 'Notify', lastName = 'Training System' } = {}) {
  if (!phone) return { ok: false, step: 'precheck', error: 'No phone provided' }
  try {
    const cRes = await fetchWithRetry(`${GHL_BASE}/contacts/upsert`, {
      method: 'POST',
      headers: ghlHeaders(),
      body: JSON.stringify({
        locationId: process.env.GHL_LOCATION_ID,
        phone,
        firstName,
        lastName,
      }),
    })
    const cJson = await cRes.json().catch(() => ({}))
    if (!cRes.ok) {
      return { ok: false, step: 'contact_upsert', error: `${cRes.status}: ${cJson.message || JSON.stringify(cJson)}` }
    }
    const cId = cJson.contact?.id || cJson.id
    if (!cId) return { ok: false, step: 'contact_upsert', error: 'No contact id returned' }

    const sRes = await fetchWithRetry(`${GHL_BASE}/conversations/messages`, {
      method: 'POST',
      headers: ghlHeaders(),
      body: JSON.stringify({ type: 'SMS', contactId: cId, message }),
    })
    if (!sRes.ok) {
      const sJson = await sRes.json().catch(() => ({}))
      return { ok: false, step: 'sms_send', error: `${sRes.status}: ${sJson.message || JSON.stringify(sJson)}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, step: 'exception', error: err.message || 'Unknown' }
  }
}
