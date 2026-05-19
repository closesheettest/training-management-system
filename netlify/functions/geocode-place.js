// Geocode a free-text place name (city, neighborhood, etc.) via Google
// Maps Geocoding API. Returns lat/lng + the formatted address Google
// matched against so the caller can show "✓ Matched: Miami, FL, USA"
// for verification.
//
// Used by /regions to autofill the "map center" lat/lng when admin adds
// a new region (or back-fills coords for an existing one) — admin
// shouldn't have to know "Miami's center is 25.76, -80.19" by heart.
//
// Required env vars: GOOGLE_MAPS_API_KEY.

const GOOGLE_BASE = 'https://maps.googleapis.com/maps/api/geocode/json'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' })
  }
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    return json(500, { error: 'Missing GOOGLE_MAPS_API_KEY' })
  }

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }
  const query = (body.query || '').toString().trim()
  if (!query) return json(400, { error: 'query required' })

  try {
    const url = new URL(GOOGLE_BASE)
    url.searchParams.set('address', query)
    url.searchParams.set('region', 'us')
    url.searchParams.set('key', process.env.GOOGLE_MAPS_API_KEY)
    const res = await fetch(url.toString())
    if (!res.ok) {
      return json(200, { ok: false, error: `Google ${res.status}` })
    }
    const data = await res.json().catch(() => ({}))
    if (data.status !== 'OK' || !Array.isArray(data.results) || data.results.length === 0) {
      return json(200, {
        ok: false,
        error: `Google status: ${data.status || 'unknown'}${data.error_message ? ` — ${data.error_message}` : ''}`,
      })
    }
    const top = data.results[0]
    const loc = top.geometry?.location
    if (!loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') {
      return json(200, { ok: false, error: 'No coords in Google response' })
    }
    return json(200, {
      ok: true,
      lat: loc.lat,
      lng: loc.lng,
      formatted_address: top.formatted_address || null,
    })
  } catch (err) {
    return json(200, { ok: false, error: err.message || 'Unknown' })
  }
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
