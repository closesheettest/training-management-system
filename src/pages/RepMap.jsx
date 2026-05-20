import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from '../lib/supabase.js'
import { useRegions } from '../lib/RegionsContext.jsx'

// Sales Team Map.
//
// Goal: at-a-glance map of where every rep is. Each rep is a pin colored
// by status (active / in pipeline / dropout / departed). Filter checkboxes
// at the top let admin scope the view to one or more statuses.
//
// Until every rep has self-served their home address via /update-info, we
// approximate location by their REGION (Florida only, four metro centers).
// Each pin gets a small random jitter around its region's center so reps
// in the same region don't perfectly stack — gives a visual sense of
// density without requiring real geocoded addresses. Reps with no region
// fall back to the corporate office (Pinellas Park).
//
// Future enhancement: geocode street_address/city/zip when present so
// individual reps show at their actual homes. The skeleton is here — just
// add a lat/lng column to trainees and a Nominatim geocode helper.

// Fallback for reps with no region (or with a region that has no
// latitude/longitude on its regions-table row) — the corporate office
// in Pinellas Park. New regions added via the /regions page can
// include their own lat/lng so reps there get a sensible jittered
// pin instead of all clustering at corporate.
const CORPORATE_OFFICE = { lat: 27.8636, lng: -82.7298 }

// Stable deterministic jitter from a string seed (the trainee id). Returns
// a small lat/lng offset (~5km radius) so the same rep lands at the same
// pin every render — no flickering on re-renders.
function seededJitter(seed) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  // Two pseudo-random floats in [-1, 1] from the hash
  const r1 = ((h & 0xffff) / 0xffff) * 2 - 1
  const r2 = (((h >> 16) & 0xffff) / 0xffff) * 2 - 1
  // ~0.05° ≈ 5-6km in FL latitudes. Enough to spread pins visibly.
  return { dLat: r1 * 0.05, dLng: r2 * 0.05 }
}

function locationForTrainee(t, regions) {
  // Real geocoded coords win — set by /.netlify/functions/geocode-trainee
  // when the rep submits /update-info (or via the bulk backfill button).
  if (typeof t.latitude === 'number' && typeof t.longitude === 'number') {
    return { lat: t.latitude, lng: t.longitude, geocoded: true }
  }
  const region = regions.find((r) => r.name === t.region)
  const center = region && typeof region.latitude === 'number' && typeof region.longitude === 'number'
    ? { lat: region.latitude, lng: region.longitude }
    : CORPORATE_OFFICE
  const j = seededJitter(t.id || '')
  return { lat: center.lat + j.dLat, lng: center.lng + j.dLng, geocoded: false }
}

// Status → pin color + label. Drives both the legend and the marker icons.
const STATUS = {
  active:    { label: '⭐ Active sales reps',  color: '#10b981' },
  notYet:    { label: '⏳ In the pipeline',     color: '#0ea5e9' },
  dropout:   { label: '❌ Dropouts',             color: '#94a3b8' },
  departed:  { label: '🚪 Departed (cleanup pending)', color: '#f59e0b' },
}

// Build a colored marker icon. Two variants per status:
//   solid  — geocoded from real address (full status color fill)
//   hollow — approximated to region center (outline only, no fill)
// Lets admin distinguish real locations from region-jittered placeholders
// at a glance, while still seeing status color in both cases.
function makeIcon(color, { hollow = false } = {}) {
  const fill = hollow ? 'white' : color
  const stroke = hollow ? color : 'white'
  const strokeWidth = hollow ? 3 : 2
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="24" height="32">
      <path d="M16 0C8.27 0 2 6.27 2 14c0 9.5 14 18 14 18s14-8.5 14-18c0-7.73-6.27-14-14-14z" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>
      <circle cx="16" cy="13" r="5" fill="${hollow ? color : 'white'}"/>
    </svg>
  `.trim()
  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [24, 32],
    iconAnchor: [12, 32],
    popupAnchor: [0, -28],
  })
}

// Lookup table: ICONS[status][solid|hollow]
const ICONS = Object.fromEntries(
  Object.entries(STATUS).map(([key, v]) => [
    key,
    {
      solid: makeIcon(v.color, { hollow: false }),
      hollow: makeIcon(v.color, { hollow: true }),
    },
  ]),
)

export default function RepMap() {
  const { regions, regionNames } = useRegions()
  const [trainees, setTrainees] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // Which statuses are visible. Active is on by default — the most useful
  // view. Pipeline/dropouts/departed toggle in as needed.
  const [show, setShow] = useState({
    active: true,
    notYet: false,
    dropout: false,
    departed: false,
  })
  // Region filter on top of status — same pattern as ActiveReps.
  const [regionFilter, setRegionFilter] = useState('')
  // Bulk backfill state for "🔄 Geocode N unmapped reps". The client
  // loops through reps with addresses but no lat/lng, calling the
  // geocode function once per rep with a 1.1s gap (Nominatim's free
  // tier requires 1 req/sec max). Progress shown live so admin can
  // watch pins appear without wondering whether anything is happening.
  const [geocoding, setGeocoding] = useState(null) // null | { processed, total, errors }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('trainees')
      .select('id, first_name, last_name, phone, email, company_email, region, is_active_sales_rep, declined_at, left_company_at, cleanup_done_at, info_updated_at, class_id, latitude, longitude, geocoded_at, street_address, city, state, zip, classes!class_id(week_end_date, attendance_only)')
      .order('last_name', { ascending: true })
    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }
    setTrainees(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Classify each trainee into one of the four buckets. Same logic as
  // ActiveReps so the map matches what the master list shows.
  const today = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])

  const categorized = useMemo(() => {
    function classify(t) {
      if (t.left_company_at && !t.cleanup_done_at) return 'departed'
      if (t.declined_at) return null // declined trainees not shown
      if (t.is_active_sales_rep) return 'active'
      const c = t.classes
      if (c?.attendance_only) return null // dedup'd dupes etc — hidden
      if (!c?.week_end_date) return 'notYet'
      const parts = String(c.week_end_date).slice(0, 10).split('-').map(Number)
      if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return 'notYet'
      const end = new Date(parts[0], parts[1] - 1, parts[2], 23, 59, 59)
      return end < today ? 'dropout' : 'notYet'
    }
    const buckets = { active: [], notYet: [], dropout: [], departed: [] }
    for (const t of trainees) {
      const c = classify(t)
      if (c && buckets[c]) buckets[c].push(t)
    }
    return buckets
  }, [trainees, today])

  // Combined visible list, filtered by status + region.
  const visible = useMemo(() => {
    const out = []
    for (const status of Object.keys(STATUS)) {
      if (!show[status]) continue
      for (const t of categorized[status]) {
        if (regionFilter && t.region !== regionFilter) continue
        out.push({ trainee: t, status })
      }
    }
    return out
  }, [categorized, show, regionFilter])

  // Reps eligible for the bulk-geocode pass: have a street address on
  // file but no lat/lng yet. Drives the "Geocode N unmapped reps" button.
  const unmapped = useMemo(
    () => trainees.filter(
      (t) =>
        t.street_address &&
        String(t.street_address).trim() !== '' &&
        (t.latitude == null || t.longitude == null),
    ),
    [trainees],
  )

  async function geocodeAllUnmapped() {
    if (unmapped.length === 0) return
    if (!confirm(
      `Geocode ${unmapped.length} rep${unmapped.length === 1 ? '' : 's'}? ` +
      `Takes about ${Math.ceil(unmapped.length * 0.15)} seconds (Google Maps API). ` +
      `Pins will appear on the map as each one completes.`,
    )) return
    setGeocoding({ processed: 0, total: unmapped.length, errors: 0 })
    let processed = 0
    let errors = 0
    for (const t of unmapped) {
      try {
        const res = await fetch('/.netlify/functions/geocode-trainee', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trainee_id: t.id }),
        })
        const body = await res.json().catch(() => ({}))
        if (!body.ok && !body.skipped) errors++
      } catch {
        errors++
      }
      processed++
      setGeocoding({ processed, total: unmapped.length, errors })
      // Refresh map data periodically so pins appear as they're geocoded
      // (every 10 successful lookups is a nice balance — not too chatty).
      if (processed % 10 === 0 || processed === unmapped.length) {
        await load()
      }
      // Google allows 50 QPS; 100ms gap keeps us nicely under that and
      // gives the UI time to render progress updates between batches.
      if (processed < unmapped.length) {
        await new Promise((r) => setTimeout(r, 100))
      }
    }
    setGeocoding(null)
    await load()
  }

  // Center the map on Florida initially. Zoom 6.5 fits the whole state.
  const FL_CENTER = [27.9944, -81.7603]
  const FL_ZOOM = 6.7

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Sales team map</h1>
        <p className="mt-2 text-slate-600">
          Geographic view of where every rep is, by status. Until each rep self-serves their
          home address via <Link to="/active-reps" className="underline">/update-info</Link>,
          pins are placed near their <strong>region</strong>'s metro center (with a small
          random scatter so they don't perfectly stack). Reps with no region yet fall back to
          the corporate office in Pinellas Park.
        </p>
      </header>

      {/* Status filters */}
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Show:</span>
          {Object.entries(STATUS).map(([key, v]) => (
            <label key={key} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={show[key]}
                onChange={(e) => setShow({ ...show, [key]: e.target.checked })}
              />
              <span
                className="inline-block h-3 w-3 rounded-full border border-white shadow-sm"
                style={{ backgroundColor: v.color }}
                aria-hidden="true"
              />
              {v.label} <span className="text-slate-400">({categorized[key].length})</span>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
          <span className="font-semibold uppercase tracking-wide text-slate-500">Pin style:</span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 rounded-full border border-white shadow-sm"
              style={{ backgroundColor: '#10b981' }}
              aria-hidden="true"
            />
            <strong>Solid</strong> = geocoded from real address
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 rounded-full border-2"
              style={{ backgroundColor: 'white', borderColor: '#10b981' }}
              aria-hidden="true"
            />
            <strong>Hollow</strong> = approximated (region center, no address yet)
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span className="font-semibold uppercase tracking-wide text-slate-500">Region:</span>
          <button
            type="button"
            onClick={() => setRegionFilter('')}
            className={
              'rounded-full border px-2.5 py-1 ' +
              (regionFilter === ''
                ? 'border-brand-navy bg-brand-navy text-white'
                : 'border-slate-300 bg-white hover:bg-slate-50')
            }
          >
            All regions
          </button>
          {regionNames.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRegionFilter(regionFilter === r ? '' : r)}
              className={
                'rounded-full border px-2.5 py-1 ' +
                (regionFilter === r
                  ? 'border-brand-navy bg-brand-navy text-white'
                  : 'border-slate-300 bg-white hover:bg-slate-50')
              }
            >
              {r}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs text-slate-500">
            Showing <strong>{visible.length}</strong> rep{visible.length === 1 ? '' : 's'} on the map.
            {loading && ' Loading…'}
            {error && <span className="text-red-700"> Error: {error}</span>}
          </p>
          {unmapped.length > 0 && !geocoding && (
            <button
              type="button"
              onClick={geocodeAllUnmapped}
              className="rounded-md border border-sky-300 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-800 hover:bg-sky-100"
              title="Look up actual lat/lng for each rep with an address on file — about 1 second per rep (Nominatim free-tier rate limit)."
            >
              🔄 Geocode {unmapped.length} unmapped rep{unmapped.length === 1 ? '' : 's'}
            </button>
          )}
          {geocoding && (
            <div className="flex items-center gap-2 text-xs text-sky-900">
              <span>
                Geocoding: <strong>{geocoding.processed}</strong> of{' '}
                <strong>{geocoding.total}</strong>
                {geocoding.errors > 0 && (
                  <span className="ml-1 text-amber-700">({geocoding.errors} couldn't be matched)</span>
                )}
              </span>
              <div className="h-1.5 w-32 overflow-hidden rounded-full bg-sky-200">
                <div
                  className="h-full bg-sky-600 transition-all duration-200"
                  style={{
                    width: `${Math.round((geocoding.processed / Math.max(1, geocoding.total)) * 100)}%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* The map itself. Height set explicitly so Leaflet renders. */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <MapContainer
          center={FL_CENTER}
          zoom={FL_ZOOM}
          scrollWheelZoom
          style={{ height: '600px', width: '100%' }}
        >
          <TileLayer
            attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {visible.map(({ trainee, status }) => {
            const loc = locationForTrainee(trainee, regions)
            const icon = loc.geocoded ? ICONS[status].solid : ICONS[status].hollow
            return (
              <Marker key={trainee.id} position={[loc.lat, loc.lng]} icon={icon}>
                <Popup>
                  <div className="text-sm">
                    <div className="font-semibold">
                      {trainee.first_name} {trainee.last_name}
                    </div>
                    <div className="text-xs text-slate-600">
                      {trainee.phone || '—'}
                      {trainee.company_email && <> · {trainee.company_email}</>}
                      {!trainee.company_email && trainee.email && <> · {trainee.email}</>}
                    </div>
                    <div className="mt-1 text-xs">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: STATUS[status].color, marginRight: 4 }}
                      />
                      {STATUS[status].label}
                    </div>
                    <div className="text-xs text-slate-500">
                      Region: {trainee.region || '— (defaulted to corporate)'}
                    </div>
                    {loc.geocoded ? (
                      <div className="mt-1 text-[10px] text-emerald-700">
                        📍 Geocoded from home address
                      </div>
                    ) : (
                      <div className="mt-1 text-[10px] text-slate-500">
                        📍 Approximated (region center — no address on file)
                      </div>
                    )}
                    {!trainee.info_updated_at && (
                      <div className="mt-1 text-[10px] text-amber-700">
                        📋 Hasn't filled in /update-info yet
                      </div>
                    )}
                  </div>
                </Popup>
              </Marker>
            )
          })}
          <FitOnce points={visible.map(({ trainee }) => locationForTrainee(trainee, regions))} />
        </MapContainer>
      </div>
    </div>
  )
}

// When the visible set is non-empty and small, fit the bounds to show
// every pin. When empty or large, leave the default Florida view.
// Only runs ONCE on initial render to avoid jarring re-zooms when the
// admin toggles filters.
function FitOnce({ points }) {
  const map = useMap()
  const [didFit, setDidFit] = useState(false)
  useEffect(() => {
    if (didFit) return
    if (points.length === 0) return
    if (points.length > 50) return // too many — Florida-wide is fine
    const lats = points.map((p) => p.lat)
    const lngs = points.map((p) => p.lng)
    map.fitBounds(
      [
        [Math.min(...lats), Math.min(...lngs)],
        [Math.max(...lats), Math.max(...lngs)],
      ],
      { padding: [40, 40], maxZoom: 12 },
    )
    setDidFit(true)
  }, [points, map, didFit])
  return null
}
