// Geocode one trainee's home address via Google Maps Geocoding API.
// Saves lat/lng/geocoded_at/geocoded_address on the trainees row so the
// Sales Team Map can show real pins instead of region-jittered approximations.
//
// Why Google instead of Nominatim: Google's US residential address match
// rate is dramatically higher (~95%+ vs Nominatim's ~40%). For our use
// case — geocoding 80-something rep home addresses pulled from the
// /update-info form — Nominatim was failing on 60%+ of addresses
// (apartment numbers, abbreviated streets, missing zip+4, etc.).
// Google handles all of those gracefully. Free tier covers 40,000 calls
// per month which is way more than we'd ever use here.
//
// Triggers:
//   - Fire-and-forget call from UpdateInfo.jsx after a rep submits the
//     form. Runs in the background, doesn't block the trainee's success
//     state. Skips silently if the address didn't actually change.
//   - Manual bulk backfill from /rep-map "🔄 Geocode N unmapped reps"
//     button — client-side loop, 50ms between calls (Google allows
//     50 req/sec, far above what we need).
//
// Skips re-geocoding if the same address string was already geocoded —
// saves API quota when reps re-submit /update-info with no address change.
//
// Returns:
//   { ok: true, lat, lng, address } on success
//   { ok: true, skipped: true, reason: 'no_address' | 'already_geocoded' }
//   { ok: false, error: '...' } on Google or DB failure
//
// Required env vars: SUPABASE_URL, SUPABASE_SECRET_KEY, GOOGLE_MAPS_API_KEY

import { createClient } from '@supabase/supabase-js'

const GOOGLE_BASE = 'https://maps.googleapis.com/maps/api/geocode/json'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' })
  }
  const missing = []
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'GOOGLE_MAPS_API_KEY']) {
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
    const url = new URL(GOOGLE_BASE)
    url.searchParams.set('address', addr)
    url.searchParams.set('region', 'us')
    url.searchParams.set('key', process.env.GOOGLE_MAPS_API_KEY)
    const res = await fetch(url.toString())
    if (!res.ok) {
      return json(200, { ok: false, error: `Google ${res.status}` })
    }
    const data = await res.json().catch(() => ({}))
    // Google returns status='OK' on a successful match. Other statuses
    // worth distinguishing:
    //   ZERO_RESULTS    — address didn't match anything (treat as soft fail)
    //   OVER_QUERY_LIMIT / OVER_DAILY_LIMIT — out of quota
    //   REQUEST_DENIED  — API key issue (referrer restriction, billing off)
    //   INVALID_REQUEST — bad params (shouldn't happen, but log)
    if (data.status !== 'OK' || !Array.isArray(data.results) || data.results.length === 0) {
      return json(200, {
        ok: false,
        error: `Google status: ${data.status || 'unknown'}${data.error_message ? ` — ${data.error_message}` : ''}`,
      })
    }
    const loc = data.results[0].geometry?.location
    if (!loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') {
      return json(200, { ok: false, error: 'No coords in Google response' })
    }
    const { error: uErr } = await supabase
      .from('trainees')
      .update({
        latitude: loc.lat,
        longitude: loc.lng,
        geocoded_at: new Date().toISOString(),
        geocoded_address: addr,
      })
      .eq('id', body.trainee_id)
    if (uErr) return json(500, { error: `Supabase update: ${uErr.message}` })
    return json(200, { ok: true, lat: loc.lat, lng: loc.lng, address: addr })
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
