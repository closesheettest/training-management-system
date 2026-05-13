// Shared GoHighLevel helper for SMS.
// Contacts are upserted by phone first; GHL needs a contactId before it'll
// deliver a message. Never throws — returns { ok, step?, error? }.
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

export async function sendSmsViaGhl(phone, message, { firstName = 'Notify', lastName = 'Training System' } = {}) {
  if (!phone) return { ok: false, step: 'precheck', error: 'No phone provided' }
  try {
    const cRes = await fetch(`${GHL_BASE}/contacts/upsert`, {
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

    const sRes = await fetch(`${GHL_BASE}/conversations/messages`, {
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
