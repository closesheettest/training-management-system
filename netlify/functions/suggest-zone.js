// Suggest a zone from a trainee's home address. Geocodes the address via Google
// and returns its county (administrative_area_level_2). The Edit-trainee form
// calls this when a trainee has no zone yet, then maps the county → zone with
// lib/zones' zoneForCounty. No DB write — pure lookup.
//
// POST { street_address, city, state, zip }
//   → { ok, county, formatted } | { ok:false, error }
//
// Env: GOOGLE_MAPS_API_KEY (or VITE_GOOGLE_PLACES_API_KEY).

const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_PLACES_API_KEY

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return cors(200, '')
  if (event.httpMethod !== 'POST') return cors(405, JSON.stringify({ ok: false, error: 'POST only' }))
  if (!GOOGLE_KEY) return cors(500, JSON.stringify({ ok: false, error: 'Missing GOOGLE_MAPS_API_KEY' }))

  let b = {}
  try { b = JSON.parse(event.body || '{}') } catch { return cors(400, JSON.stringify({ ok: false, error: 'bad JSON' })) }
  const addr = [b.street_address, b.city, b.state, b.zip].filter(Boolean).join(', ').trim()
  if (!addr) return cors(200, JSON.stringify({ ok: true, county: null, reason: 'no_address' }))

  try {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
    url.searchParams.set('address', addr)
    url.searchParams.set('region', 'us')
    url.searchParams.set('key', GOOGLE_KEY)
    const r = await fetch(url)
    if (!r.ok) return cors(200, JSON.stringify({ ok: false, error: `Google ${r.status}` }))
    const d = await r.json().catch(() => ({}))
    const res = (d.results || [])[0]
    let county = null
    for (const c of (res?.address_components || [])) {
      if ((c.types || []).includes('administrative_area_level_2')) { county = String(c.long_name || '').replace(/\s+county$/i, '').trim(); break }
    }
    return cors(200, JSON.stringify({ ok: true, county, formatted: res?.formatted_address || null }))
  } catch (e) {
    return cors(500, JSON.stringify({ ok: false, error: e.message || 'error' }))
  }
}

function cors(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }, body }
}
