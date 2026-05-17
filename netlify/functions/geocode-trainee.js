// Geocode one trainee's home address via Nominatim (free OpenStreetMap
// geocoder, no API key needed). Saves lat/lng/geocoded_at/geocoded_address
// on the trainees row so the Sales Team Map can show real pins instead
// of region-jittered approximations.
//
// Triggers:
//   - Fire-and-forget call from UpdateInfo.jsx after a rep submits the
//     form. Runs in the background, doesn't block the trainee's success
//     state. Skips silently if the address didn't actually change.
//   - Manual bulk backfill from /rep-map "🔄 Geocode N unmapped reps"
//     button — client-side loop with 1.1s spacing between calls (one per
//     trainee) to respect Nominatim's 1-req/sec rate limit.
//
// Nominatim usage policy compliance:
//   - Custom User-Agent (required)
//   - countrycodes=us so we don't get matches in other countries by accident
//   - Limit to 1 result per address (we only want the top hit)
//   - 1 req/sec max (caller throttles — this function only does ONE call
//     per invocation)
//
// Skips re-geocoding if the same address string was already geocoded —
// keeps the Nominatim quota clean when reps re-submit /update-info with
// no address change.
//
// Returns:
//   { ok: true, lat, lng, address } on success
//   { ok: true, skipped: true, reason: 'no_address' | 'already_geocoded' }
//   { ok: false, error: '...' } on Nominatim or DB failure

import { createClient } from '@supabase/supabase-js'

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT =
  'TrainingMgmtSystem/1.0 (https://trainingmanagementsys.netlify.app)'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' })
  }
  const missing = []
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY']) {
    if (!process.env[k]) missing.push(k)
  }
  if (missing.length) return json(500, { error: `Missing env vars: ${missing.join(', ')}` })

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }
  if (!body.trainee_id) return json(400, { error: 'trainee_id required' })

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const { data: t, error: tErr } = await supabase
    .from('trainees')
    .select('id, street_address, city, state, zip, geocoded_address')
    .eq('id', body.trainee_id)
    .maybeSingle()
  if (tErr) return json(500, { error: `Supabase: ${tErr.message}` })
  if (!t) return json(404, { error: 'Trainee not found' })

  const addr = buildAddress(t)
  if (!addr) {
    return json(200, { ok: true, skipped: true, reason: 'no_address' })
  }
  // Force-refresh path: caller can pass { force: true } to re-geocode
  // even when the address hasn't changed (useful for the bulk backfill
  // button or if Nominatim previously failed and we want to retry).
  if (!body.force && t.geocoded_address === addr) {
    return json(200, { ok: true, skipped: true, reason: 'already_geocoded' })
  }

  try {
    const url = new URL(NOMINATIM_BASE)
    url.searchParams.set('format', 'json')
    url.searchParams.set('limit', '1')
    url.searchParams.set('countrycodes', 'us')
    url.searchParams.set('q', addr)
    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': USER_AGENT },
    })
    if (!res.ok) {
      return json(200, { ok: false, error: `Nominatim ${res.status}` })
    }
    const arr = await res.json().catch(() => [])
    if (!Array.isArray(arr) || arr.length === 0) {
      return json(200, { ok: false, error: 'No match for that address' })
    }
    const top = arr[0]
    const lat = parseFloat(top.lat)
    const lng = parseFloat(top.lon)
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return json(200, { ok: false, error: 'Invalid coords from Nominatim' })
    }
    const { error: uErr } = await supabase
      .from('trainees')
      .update({
        latitude: lat,
        longitude: lng,
        geocoded_at: new Date().toISOString(),
        geocoded_address: addr,
      })
      .eq('id', body.trainee_id)
    if (uErr) return json(500, { error: `Supabase update: ${uErr.message}` })
    return json(200, { ok: true, lat, lng, address: addr })
  } catch (err) {
    return json(200, { ok: false, error: err.message || 'Unknown' })
  }
}

// Build a single-line address string Nominatim can match well.
// "street, city, state zip" is the canonical US format.
function buildAddress(t) {
  const parts = [t.street_address, t.city, t.state, t.zip]
    .map((s) => (s ? String(s).trim() : ''))
    .filter(Boolean)
  // Need at least street + (city or zip) for a meaningful match.
  if (parts.length < 2) return null
  return parts.join(', ')
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
