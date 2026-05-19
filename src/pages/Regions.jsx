import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useRegions } from '../lib/RegionsContext.jsx'

// Regions admin page.
//
// What admin can do here:
//   • See every region with its current active-rep count
//   • Add a new region (optional lat/lng for the Sales Team Map pin)
//   • Delete a region (only allowed when no active reps reference it —
//     forces admin to move reps first instead of orphaning them)
//   • Move active reps between regions, region-by-region, with a
//     "Move to..." dropdown per rep
//
// Source of truth:
//   regions table (DB), exposed via RegionsContext.
//   Other pages (Active Reps filter chips, Group Messages region filter,
//   Sales Team Map filter, /update-info dropdown) consume the same
//   context, so adding "Tampa" here immediately shows up everywhere.

export default function Regions() {
  const { regions, reload: reloadRegions } = useRegions()
  const [reps, setReps] = useState([])
  const [loading, setLoading] = useState(true)
  const [flash, setFlash] = useState(null)
  const [busyId, setBusyId] = useState(null)
  // New region form state
  const [newName, setNewName] = useState('')
  const [newLat, setNewLat] = useState('')
  const [newLng, setNewLng] = useState('')
  const [adding, setAdding] = useState(false)
  // Expanded-region state for the rep-mover UI. id of the open region
  // (null = all collapsed).
  const [openRegionId, setOpenRegionId] = useState(null)

  const loadReps = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('trainees')
      .select('id, first_name, last_name, phone, region, is_active_sales_rep, street_address, city, state, zip, county, latitude, longitude')
      .eq('is_active_sales_rep', true)
      .order('last_name', { ascending: true })
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      setLoading(false)
      return
    }
    setReps(data || [])
    setLoading(false)
  }, [])

  // Reps that have lat/lng but no county — candidates for the
  // "🔄 Look up counties" backfill. County wasn't captured until the
  // 2026-05-19 geocode-function update, so already-geocoded reps need a
  // force re-geocode to pick it up.
  const needsCounty = reps.filter(
    (r) => typeof r.latitude === 'number' && typeof r.longitude === 'number' && !r.county,
  )
  const [countyfilling, setCountyfilling] = useState(null) // null | { processed, total, errors }

  async function backfillCounties() {
    if (needsCounty.length === 0) return
    if (!confirm(
      `Look up the county for ${needsCounty.length} rep${needsCounty.length === 1 ? '' : 's'} ` +
      `who've already submitted their address? Takes about ${Math.ceil(needsCounty.length * 0.15)} seconds ` +
      `(one Google Maps call per rep). Counties will appear next to each rep as they're filled in.`,
    )) return
    setCountyfilling({ processed: 0, total: needsCounty.length, errors: 0 })
    let processed = 0
    let errors = 0
    for (const t of needsCounty) {
      try {
        const res = await fetch('/.netlify/functions/geocode-trainee', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trainee_id: t.id, force: true }),
        })
        const b = await res.json().catch(() => ({}))
        if (!b.ok && !b.skipped) errors++
      } catch {
        errors++
      }
      processed++
      setCountyfilling({ processed, total: needsCounty.length, errors })
      if (processed % 10 === 0 || processed === needsCounty.length) {
        await loadReps()
      }
      if (processed < needsCounty.length) {
        await new Promise((r) => setTimeout(r, 120))
      }
    }
    setCountyfilling(null)
    await loadReps()
  }

  useEffect(() => {
    loadReps()
  }, [loadReps])

  // Group reps by region name. Reps with no region or with a region
  // that isn't in the managed list land in a synthetic "Unassigned"
  // bucket so admin can see them and assign them properly.
  const repsByRegion = (() => {
    const byName = new Map()
    for (const r of regions) byName.set(r.name, [])
    const unassigned = []
    for (const t of reps) {
      if (t.region && byName.has(t.region)) byName.get(t.region).push(t)
      else unassigned.push(t)
    }
    return { byName, unassigned }
  })()

  async function addRegion(e) {
    e?.preventDefault?.()
    const name = newName.trim()
    if (!name) {
      setFlash({ kind: 'error', text: 'Region name is required.' })
      return
    }
    if (regions.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
      setFlash({ kind: 'error', text: `"${name}" is already a region.` })
      return
    }
    setAdding(true)
    const maxSort = regions.reduce((m, r) => Math.max(m, r.sort_order || 0), 0)
    const lat = newLat.trim() ? parseFloat(newLat) : null
    const lng = newLng.trim() ? parseFloat(newLng) : null
    const { error } = await supabase
      .from('regions')
      .insert({
        name,
        sort_order: maxSort + 10,
        latitude: Number.isFinite(lat) ? lat : null,
        longitude: Number.isFinite(lng) ? lng : null,
      })
    setAdding(false)
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      return
    }
    setFlash({ kind: 'success', text: `Added region "${name}".` })
    setNewName('')
    setNewLat('')
    setNewLng('')
    await reloadRegions()
  }

  async function deleteRegion(region) {
    const count = (repsByRegion.byName.get(region.name) || []).length
    if (count > 0) {
      alert(
        `Can't delete "${region.name}" — ${count} active rep${count === 1 ? '' : 's'} ` +
        `still assigned. Move them to a different region first (expand the region card below ` +
        `and use the "Move to..." dropdown next to each rep).`,
      )
      return
    }
    if (!confirm(`Delete region "${region.name}"? This is reversible — you can add it back any time.`)) return
    setBusyId(region.id)
    const { error } = await supabase.from('regions').delete().eq('id', region.id)
    setBusyId(null)
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      return
    }
    setFlash({ kind: 'success', text: `Deleted region "${region.name}".` })
    await reloadRegions()
  }

  async function moveRep(rep, toRegionName) {
    if (!toRegionName || toRegionName === rep.region) return
    setBusyId(rep.id)
    const { error } = await supabase
      .from('trainees')
      .update({ region: toRegionName })
      .eq('id', rep.id)
    setBusyId(null)
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      return
    }
    setFlash({
      kind: 'success',
      text: `Moved ${rep.first_name} ${rep.last_name} → ${toRegionName}.`,
    })
    await loadReps()
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Regions</h1>
        <p className="mt-2 text-slate-600">
          Manage the list of sales regions and reassign reps between them. Changes here ripple
          to every region picker in the app —{' '}
          <Link to="/active-reps" className="underline">Active Reps</Link>,{' '}
          <Link to="/group-messages" className="underline">Group Messages</Link>, the{' '}
          <Link to="/rep-map" className="underline">Sales Team Map</Link>, and the public{' '}
          <code className="rounded bg-slate-100 px-1 text-xs">/update-info</code> page reps fill out.
        </p>
      </header>

      {flash && (
        <div
          className={
            'rounded-md border px-3 py-2 text-sm ' +
            (flash.kind === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-800')
          }
        >
          {flash.text}
        </div>
      )}

      {/* Add region form */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">➕ Add a new region</h2>
        <p className="mt-1 text-xs text-slate-500">
          Reps will see this region in their <code>/update-info</code> picker the next time they
          load the page. Lat/lng are optional — they only affect the Sales Team Map pin
          placement for reps in this region who haven't filled in their home address yet.
        </p>
        <form onSubmit={addRegion} className="mt-3 grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
          <label className="text-sm">
            <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Region name *
            </span>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Tampa"
              required
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              disabled={adding}
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Latitude (optional)
            </span>
            <input
              type="number"
              step="any"
              value={newLat}
              onChange={(e) => setNewLat(e.target.value)}
              placeholder="27.9506"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              disabled={adding}
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Longitude (optional)
            </span>
            <input
              type="number"
              step="any"
              value={newLng}
              onChange={(e) => setNewLng(e.target.value)}
              placeholder="-82.4572"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              disabled={adding}
            />
          </label>
          <button
            type="submit"
            disabled={adding || !newName.trim()}
            className="rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy-dark disabled:opacity-50"
          >
            {adding ? 'Adding…' : 'Add region'}
          </button>
        </form>
      </section>

      {/* Backfill counties — only shown when there are reps with lat/lng
          but no county on file (i.e. they were geocoded before county
          capture shipped). One-click batch re-geocode that pulls county
          out of Google's address_components and saves it. */}
      {(needsCounty.length > 0 || countyfilling) && (
        <section className="rounded-lg border border-sky-200 bg-sky-50 p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-sky-900">
              <strong>🏛️ County backfill:</strong>{' '}
              {needsCounty.length} rep{needsCounty.length === 1 ? '' : 's'} ha{needsCounty.length === 1 ? 's' : 've'} a
              geocoded address but no county on file yet. Click to look them up so the rep rows
              below show "Hillsborough County" etc.
            </div>
            {!countyfilling ? (
              <button
                type="button"
                onClick={backfillCounties}
                className="rounded-md border border-sky-300 bg-white px-3 py-1.5 text-xs font-semibold text-sky-800 hover:bg-sky-100"
              >
                🔄 Look up {needsCounty.length} count{needsCounty.length === 1 ? 'y' : 'ies'}
              </button>
            ) : (
              <div className="flex items-center gap-2 text-xs text-sky-900">
                <span>
                  <strong>{countyfilling.processed}</strong> / <strong>{countyfilling.total}</strong>
                  {countyfilling.errors > 0 && (
                    <span className="ml-1 text-amber-700">({countyfilling.errors} errored)</span>
                  )}
                </span>
                <div className="h-1.5 w-32 overflow-hidden rounded-full bg-sky-200">
                  <div
                    className="h-full bg-sky-600 transition-all duration-200"
                    style={{
                      width: `${Math.round((countyfilling.processed / Math.max(1, countyfilling.total)) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Region cards */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">📍 Regions ({regions.length})</h2>

        {regions.map((r) => {
          const repsInRegion = repsByRegion.byName.get(r.name) || []
          const isOpen = openRegionId === r.id
          return (
            <article
              key={r.id || r.name}
              className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-xl">📍</span>
                  <div>
                    <div className="font-semibold text-slate-900">{r.name}</div>
                    <div className="text-xs text-slate-500">
                      {repsInRegion.length} active rep{repsInRegion.length === 1 ? '' : 's'}
                      {r.latitude && r.longitude && (
                        <>
                          {' '}· map center{' '}
                          <code className="rounded bg-slate-100 px-1 text-[10px]">
                            {r.latitude.toFixed(3)}, {r.longitude.toFixed(3)}
                          </code>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setOpenRegionId(isOpen ? null : r.id)}
                    disabled={!r.id}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                    title={!r.id ? 'Reload after running the regions migration' : undefined}
                  >
                    {isOpen ? 'Hide reps' : `View ${repsInRegion.length} rep${repsInRegion.length === 1 ? '' : 's'}`}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteRegion(r)}
                    disabled={busyId === r.id || !r.id}
                    className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-40"
                    title={!r.id ? 'Reload after running the regions migration' : undefined}
                  >
                    {busyId === r.id ? '…' : 'Delete'}
                  </button>
                </div>
              </div>

              {isOpen && (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  {repsInRegion.length === 0 ? (
                    <p className="text-xs italic text-slate-500">
                      No active reps in this region yet.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {repsInRegion.map((rep) => (
                        <RepMoveRow
                          key={rep.id}
                          rep={rep}
                          regions={regions}
                          busy={busyId === rep.id}
                          onMove={(toName) => moveRep(rep, toName)}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </article>
          )
        })}

        {/* Unassigned bucket — reps with no region OR with a region not in
            the managed list. Shows up automatically if someone deleted a
            region without first reassigning, or if the rep's stored
            region.region string somehow drifted from the managed list. */}
        {repsByRegion.unassigned.length > 0 && (
          <article className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-xl">⚠️</span>
                <div>
                  <div className="font-semibold text-amber-900">Unassigned</div>
                  <div className="text-xs text-amber-800">
                    {repsByRegion.unassigned.length} rep{repsByRegion.unassigned.length === 1 ? '' : 's'} with no region (or with a region that's no longer in the managed list)
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpenRegionId(isOpen('__unassigned') ? null : '__unassigned')}
                className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
              >
                {openRegionId === '__unassigned' ? 'Hide' : 'View reps'}
              </button>
            </div>
            {openRegionId === '__unassigned' && (
              <div className="mt-3 border-t border-amber-200 pt-3">
                <ul className="space-y-1.5">
                  {repsByRegion.unassigned.map((rep) => (
                    <RepMoveRow
                      key={rep.id}
                      rep={rep}
                      regions={regions}
                      busy={busyId === rep.id}
                      onMove={(toName) => moveRep(rep, toName)}
                    />
                  ))}
                </ul>
              </div>
            )}
          </article>
        )}
      </section>
    </div>
  )

  // Helper used inline above so the toggle handler doesn't need a
  // separate state for "__unassigned" — keeps it consistent with the
  // openRegionId pattern used for real regions.
  function isOpen(key) {
    return openRegionId === key
  }
}

// Haversine distance between two lat/lng pairs, in miles. Used to score
// which region a rep lives closest to.
function milesBetween(lat1, lng1, lat2, lng2) {
  const R = 3958.7613 // earth radius in miles
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// Given a rep with lat/lng + the managed regions list (each potentially
// having its own lat/lng), return:
//   { name, miles } of the closest region — or null if rep has no
//   coords yet, or no region in the list has coords to compare against.
function suggestRegionFor(rep, regions) {
  if (typeof rep.latitude !== 'number' || typeof rep.longitude !== 'number') return null
  let best = null
  for (const r of regions) {
    if (typeof r.latitude !== 'number' || typeof r.longitude !== 'number') continue
    const miles = milesBetween(rep.latitude, rep.longitude, r.latitude, r.longitude)
    if (!best || miles < best.miles) best = { name: r.name, miles }
  }
  return best
}

// One row in the expanded rep list. Shows the rep's name + phone, their
// address summary + county (if known), the system's suggested region
// (closest by miles) when it differs from the current one, and a
// "Move to..." dropdown. Selecting a region fires the onMove callback
// which patches trainees.region.
function RepMoveRow({ rep, regions, busy, onMove }) {
  const addressSummary = [rep.city, rep.state, rep.zip]
    .filter((s) => s && String(s).trim())
    .join(', ')
  const suggested = suggestRegionFor(rep, regions)
  const suggestedDiffersFromCurrent =
    suggested && suggested.name !== rep.region
  return (
    <li className="rounded-md bg-slate-50 px-3 py-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <div className="text-sm font-medium text-slate-900">
            {rep.first_name} {rep.last_name}
          </div>
          <div className="text-[11px] text-slate-500">{rep.phone || '—'}</div>
          {addressSummary && (
            <div className="text-[11px] text-slate-600">📍 {addressSummary}</div>
          )}
          {rep.county && (
            <div className="text-[11px] text-slate-600">
              🏛️ {rep.county} County
            </div>
          )}
          {!addressSummary && !rep.county && (
            <div className="text-[11px] italic text-slate-400">
              No address on file yet — rep hasn't filled in /update-info
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="text-[11px] text-slate-600">
            Currently:{' '}
            <strong>{rep.region || <span className="text-amber-700">— none —</span>}</strong>
          </div>
          {suggested && (
            <div
              className={
                'text-[11px] ' +
                (suggestedDiffersFromCurrent
                  ? 'rounded bg-sky-50 px-1.5 py-0.5 font-medium text-sky-800'
                  : 'text-emerald-700')
              }
            >
              {suggestedDiffersFromCurrent ? '💡 Suggested: ' : '✓ Matches suggested: '}
              <strong>{suggested.name}</strong>{' '}
              <span className="opacity-70">({Math.round(suggested.miles)} mi)</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-slate-500">Move to:</span>
            <select
              value=""
              onChange={(e) => onMove(e.target.value)}
              disabled={busy}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
            >
              <option value="">— Pick region —</option>
              {regions
                .filter((r) => r.name !== rep.region)
                .map((r) => (
                  <option key={r.id || r.name} value={r.name}>{r.name}</option>
                ))}
            </select>
          </div>
        </div>
      </div>
    </li>
  )
}
