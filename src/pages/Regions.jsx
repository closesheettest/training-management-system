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

  // Geocode a free-text place name via /.netlify/functions/geocode-place.
  // Returns { ok, lat, lng, formatted_address } or { ok: false, error }.
  // Used by both the Add form's "📍 Find center" button and the
  // per-region "Set map center" backfill button.
  async function findCenter(query) {
    if (!query || !query.trim()) {
      return { ok: false, error: 'Region name is required.' }
    }
    try {
      const res = await fetch('/.netlify/functions/geocode-place', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim() }),
      })
      return await res.json().catch(() => ({ ok: false, error: 'Bad response' }))
    } catch (err) {
      return { ok: false, error: err.message || 'Network error' }
    }
  }

  // Add-form: "📍 Find center" button state + matched-address feedback.
  const [findingNew, setFindingNew] = useState(false)
  const [matchedAddress, setMatchedAddress] = useState(null)
  async function findCenterForNew() {
    setFindingNew(true)
    setMatchedAddress(null)
    const result = await findCenter(newName)
    setFindingNew(false)
    if (!result.ok) {
      setFlash({ kind: 'error', text: `Couldn't find "${newName}": ${result.error}` })
      return
    }
    setNewLat(String(result.lat))
    setNewLng(String(result.lng))
    setMatchedAddress(result.formatted_address)
  }

  // Per-region: set map center for an existing region (used when the
  // region was created without lat/lng so the map can't generate
  // suggestions for reps living near it). Geocodes the region's name
  // and patches the regions row directly.
  const [centeringId, setCenteringId] = useState(null)
  async function setRegionCenter(region) {
    setCenteringId(region.id)
    const result = await findCenter(region.name)
    if (!result.ok) {
      setCenteringId(null)
      setFlash({ kind: 'error', text: `Couldn't find "${region.name}": ${result.error}` })
      return
    }
    const { error } = await supabase
      .from('regions')
      .update({ latitude: result.lat, longitude: result.lng })
      .eq('id', region.id)
    setCenteringId(null)
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      return
    }
    setFlash({
      kind: 'success',
      text: `Set "${region.name}" map center to ${result.formatted_address || `${result.lat}, ${result.lng}`}.`,
    })
    await reloadRegions()
  }

  // Regions in the managed list that don't have map-center coords yet.
  // Until every region has lat/lng the suggested-region badge can't run
  // (haversine needs both endpoints), so this list drives the "Set all
  // missing centers" bulk-backfill button.
  const regionsMissingCenter = regions.filter(
    (r) => !(typeof r.latitude === 'number' && typeof r.longitude === 'number'),
  )
  const [bulkCentering, setBulkCentering] = useState(null) // null | { processed, total, errors }

  async function setAllMissingCenters() {
    if (regionsMissingCenter.length === 0) return
    if (!confirm(
      `Look up the map center for ${regionsMissingCenter.length} region${regionsMissingCenter.length === 1 ? '' : 's'} ` +
      `(${regionsMissingCenter.map((r) => r.name).join(', ')}) using Google? ` +
      `Once this finishes, the 💡 Suggested-region badge will start appearing on rep rows.`,
    )) return
    setBulkCentering({ processed: 0, total: regionsMissingCenter.length, errors: 0 })
    let processed = 0
    let errors = 0
    for (const r of regionsMissingCenter) {
      const result = await findCenter(r.name)
      if (!result.ok) {
        errors++
      } else {
        const { error } = await supabase
          .from('regions')
          .update({ latitude: result.lat, longitude: result.lng })
          .eq('id', r.id)
        if (error) errors++
      }
      processed++
      setBulkCentering({ processed, total: regionsMissingCenter.length, errors })
      if (processed < regionsMissingCenter.length) {
        await new Promise((res) => setTimeout(res, 120))
      }
    }
    setBulkCentering(null)
    setFlash({
      kind: errors === 0 ? 'success' : 'error',
      text:
        errors === 0
          ? `Set map centers for ${processed} region${processed === 1 ? '' : 's'}. Suggested-region badges should now appear on rep rows.`
          : `Finished — ${processed - errors} updated, ${errors} couldn't be matched (check region names).`,
    })
    await reloadRegions()
  }

  // "Suggested region layout" — k-means clustering across every
  // geocoded rep. The user picks K (how many regions they want to plan
  // for), and the system splits all reps into K clusters as evenly /
  // tightly as possible. Each cluster gets a suggested name (most
  // common city among its members), a centroid (the average lat/lng of
  // all members — this becomes the proposed map center), and the list
  // of reps inside it. One-click "Add as region" pre-fills the Add
  // Region form so admin reviews before saving.
  //
  // Default K = existing region count, so the first thing admin sees
  // is "if we redrew the 4 regions from scratch, here's how reps would
  // split." Bumping K up shows "what if we added a 5th, 6th, 7th
  // region" — useful for planning growth.
  const geocodedReps = reps.filter(
    (r) => typeof r.latitude === 'number' && typeof r.longitude === 'number',
  )
  const minK = 2
  const maxK = Math.min(10, Math.max(2, geocodedReps.length))
  const defaultK = Math.min(maxK, Math.max(minK, regions.length || 4))
  const [targetK, setTargetK] = useState(defaultK)
  // Re-clamp if the data changes (e.g., regions reload). Keeps targetK
  // in a valid range without forcing a remount.
  useEffect(() => {
    if (targetK < minK) setTargetK(minK)
    else if (targetK > maxK) setTargetK(maxK)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxK])

  const layoutClusters = (() => {
    if (geocodedReps.length < minK) return []
    const points = geocodedReps.map((r) => ({
      lat: r.latitude,
      lng: r.longitude,
      _rep: r,
    }))
    const raw = kMeansCluster(points, targetK)
    return raw.map((cluster) => {
      const members = cluster.members.map((p) => p._rep)
      // Suggested name: most common city among members (needs 2+ for a
      // confident pick), else most common county + " County", else
      // generic "Cluster".
      const cityCount = new Map()
      const countyCount = new Map()
      for (const r of members) {
        if (r.city) cityCount.set(r.city, (cityCount.get(r.city) || 0) + 1)
        if (r.county) countyCount.set(r.county, (countyCount.get(r.county) || 0) + 1)
      }
      const topPair = (m) => {
        let topKey = null
        let topVal = 0
        for (const [k, v] of m) {
          if (v > topVal) { topKey = k; topVal = v }
        }
        return { key: topKey, count: topVal }
      }
      const topCity = topPair(cityCount)
      const topCounty = topPair(countyCount)
      let suggestedName = 'New region'
      if (topCity.count >= 2) suggestedName = topCity.key
      else if (topCounty.key) suggestedName = `${topCounty.key} County`
      // Average distance from each member to this centroid — gives a
      // sense of how tight/loose the cluster is.
      const distances = members.map((r) =>
        milesBetween(r.latitude, r.longitude, cluster.lat, cluster.lng),
      )
      const avgRadius = distances.length
        ? distances.reduce((s, d) => s + d, 0) / distances.length
        : 0
      // Does this cluster mostly overlap an existing region? If 50%+
      // of its members are currently in the same existing region, we
      // flag it as "≈ <ExistingRegionName>" — useful for the user to
      // see "this k-means cluster IS basically your existing St Pete
      // region, just with a tighter / shifted center."
      const existingRegionCount = new Map()
      for (const r of members) {
        if (r.region) existingRegionCount.set(r.region, (existingRegionCount.get(r.region) || 0) + 1)
      }
      const topExisting = topPair(existingRegionCount)
      const overlapPct = members.length ? topExisting.count / members.length : 0
      const mapsToExisting = overlapPct >= 0.5 ? { name: topExisting.key, pct: overlapPct } : null
      return {
        suggestedName,
        members,
        lat: cluster.lat,
        lng: cluster.lng,
        avgRadius,
        mapsToExisting,
      }
    })
  })()

  // One-click: prefill the Add Region form with a cluster's suggested
  // name + centroid coords, then scroll up so admin can review and
  // click Add region. Doesn't auto-insert — admin always sees the
  // proposed name and lat/lng before committing.
  function prefillFromCluster(cluster) {
    setNewName(cluster.suggestedName)
    setNewLat(cluster.lat.toFixed(6))
    setNewLng(cluster.lng.toFixed(6))
    setMatchedAddress(
      `Centroid of ${cluster.members.length} reps`,
    )
    setFlash(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

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
          load the page. Type the region's name (e.g. "Miami") and click <strong>📍 Find center</strong>{' '}
          to autofill the map-center latitude/longitude — those coords are what the suggested-region
          distance calculation needs.
        </p>
        <form onSubmit={addRegion} className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-[2fr_auto] sm:items-end">
            <label className="text-sm">
              <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Region name *
              </span>
              <input
                type="text"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value)
                  setMatchedAddress(null)
                }}
                placeholder="e.g. Tampa"
                required
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                disabled={adding}
              />
            </label>
            <button
              type="button"
              onClick={findCenterForNew}
              disabled={adding || findingNew || !newName.trim()}
              className="rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-800 hover:bg-sky-100 disabled:opacity-50"
              title="Use Google to look up this region's center latitude/longitude based on its name."
            >
              {findingNew ? 'Finding…' : '📍 Find center'}
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className="text-sm">
              <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Latitude
              </span>
              <input
                type="number"
                step="any"
                value={newLat}
                onChange={(e) => setNewLat(e.target.value)}
                placeholder="(auto-filled by Find center)"
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                disabled={adding}
              />
            </label>
            <label className="text-sm">
              <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Longitude
              </span>
              <input
                type="number"
                step="any"
                value={newLng}
                onChange={(e) => setNewLng(e.target.value)}
                placeholder="(auto-filled by Find center)"
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
          </div>
          {matchedAddress && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800">
              ✓ Matched: <strong>{matchedAddress}</strong>{' '}
              <span className="opacity-70">— review the lat/lng above and click Add region.</span>
            </div>
          )}
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

      {/* Bulk map-center backfill — only shown when one or more regions
          are missing lat/lng. Without coords the suggested-region badge
          can't fire, so this is the fastest path from "no suggestions"
          to "suggestions everywhere." */}
      {(regionsMissingCenter.length > 0 || bulkCentering) && (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-amber-900">
              <strong>⚠️ Missing map centers:</strong>{' '}
              {regionsMissingCenter.length} region{regionsMissingCenter.length === 1 ? '' : 's'}{' '}
              ({regionsMissingCenter.map((r) => r.name).join(', ') || '—'}) don't have a latitude/longitude.
              Until they do, the 💡 Suggested-region badge can't appear on rep rows. One click below
              will look them all up via Google.
            </div>
            {!bulkCentering ? (
              <button
                type="button"
                onClick={setAllMissingCenters}
                className="rounded-md border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
              >
                🔄 Set centers for {regionsMissingCenter.length} region{regionsMissingCenter.length === 1 ? '' : 's'}
              </button>
            ) : (
              <div className="flex items-center gap-2 text-xs text-amber-900">
                <span>
                  <strong>{bulkCentering.processed}</strong> / <strong>{bulkCentering.total}</strong>
                  {bulkCentering.errors > 0 && (
                    <span className="ml-1 text-red-700">({bulkCentering.errors} errored)</span>
                  )}
                </span>
                <div className="h-1.5 w-32 overflow-hidden rounded-full bg-amber-200">
                  <div
                    className="h-full bg-amber-600 transition-all duration-200"
                    style={{
                      width: `${Math.round((bulkCentering.processed / Math.max(1, bulkCentering.total)) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Suggested region layout — k-means split of every geocoded
          rep. Adjustable K so admin can see "what if we had 4 / 5 / 6
          regions" and pick the layout that splits reps most usefully. */}
      {layoutClusters.length > 0 && (
        <section className="rounded-lg border border-purple-200 bg-purple-50 p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-purple-900">
                🎯 Suggested region layout
              </h2>
              <p className="mt-1 text-xs text-purple-800">
                Computed by clustering every geocoded rep ({geocodedReps.length} total) into{' '}
                <strong>{targetK}</strong> groups that minimize each rep's distance to their
                region's center. Bump K up to see "what if we had one more region?" — bump it
                down to see "what if we had fewer?" Click <strong>➕ Add as region</strong> on any
                cluster to pre-fill the Add Region form above. The app never changes anything on
                its own — you always confirm.
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-md bg-white px-2 py-1 shadow-sm ring-1 ring-purple-100">
              <button
                type="button"
                onClick={() => setTargetK(Math.max(minK, targetK - 1))}
                disabled={targetK <= minK}
                className="rounded border border-purple-300 bg-purple-50 px-2 py-0.5 text-sm font-semibold text-purple-900 hover:bg-purple-100 disabled:opacity-40"
                aria-label="Fewer regions"
              >
                −
              </button>
              <span className="min-w-[1.5rem] text-center text-sm font-semibold text-purple-900">{targetK}</span>
              <button
                type="button"
                onClick={() => setTargetK(Math.min(maxK, targetK + 1))}
                disabled={targetK >= maxK}
                className="rounded border border-purple-300 bg-purple-50 px-2 py-0.5 text-sm font-semibold text-purple-900 hover:bg-purple-100 disabled:opacity-40"
                aria-label="More regions"
              >
                +
              </button>
              <span className="ml-1 text-[10px] uppercase tracking-wide text-purple-700">regions</span>
            </div>
          </div>
          {/* Balance summary — at a glance, are the clusters evenly sized? */}
          <div className="mt-3 text-xs text-purple-900">
            <strong>Split:</strong>{' '}
            {layoutClusters.map((c, i) => (
              <span key={i}>
                {i > 0 ? ' · ' : ''}
                <strong>{c.members.length}</strong> in {c.suggestedName}
              </span>
            ))}
          </div>
          <ul className="mt-3 space-y-2">
            {layoutClusters.map((c, idx) => (
              <li
                key={idx}
                className="rounded-md bg-white p-3 text-sm shadow-sm ring-1 ring-purple-100"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900">
                      {c.suggestedName}
                      {c.mapsToExisting && (
                        <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                          ≈ your current <strong>{c.mapsToExisting.name}</strong> ({Math.round(c.mapsToExisting.pct * 100)}% overlap)
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-600">
                      <strong>{c.members.length}</strong> rep{c.members.length === 1 ? '' : 's'}
                      {' '}· avg <strong>{Math.round(c.avgRadius)} mi</strong> from cluster center
                      {' '}· center at{' '}
                      <code className="rounded bg-slate-100 px-1 text-[10px]">
                        {c.lat.toFixed(3)}, {c.lng.toFixed(3)}
                      </code>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      {c.members.slice(0, 5).map((r) => `${r.first_name} ${r.last_name}`).join(', ')}
                      {c.members.length > 5 && ` +${c.members.length - 5} more`}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => prefillFromCluster(c)}
                    className="rounded-md border border-purple-300 bg-purple-50 px-3 py-1.5 text-xs font-semibold text-purple-900 hover:bg-purple-100"
                  >
                    ➕ Add as region
                  </button>
                </div>
              </li>
            ))}
          </ul>
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
                      {r.latitude && r.longitude ? (
                        <>
                          {' '}· map center{' '}
                          <code className="rounded bg-slate-100 px-1 text-[10px]">
                            {r.latitude.toFixed(3)}, {r.longitude.toFixed(3)}
                          </code>
                        </>
                      ) : (
                        <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                          ⚠️ no map center — suggested-region won't work for this region
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setRegionCenter(r)}
                    disabled={centeringId === r.id || !r.id}
                    className="rounded-md border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-800 hover:bg-sky-100 disabled:opacity-40"
                    title="Use Google to look up this region's map center based on its name. Updates the saved lat/lng."
                  >
                    {centeringId && centeringId === r.id ? 'Finding…' : (r.latitude && r.longitude ? '📍 Re-set center' : '📍 Set map center')}
                  </button>
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
                    {busyId && busyId === r.id ? '…' : 'Delete'}
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

// K-means clustering of geocoded reps. Returns K clusters with their
// centroid + member list. Used by the "Suggested region layout"
// section to show how reps would split if regions were drawn from
// scratch around their actual locations.
//
// Uses k-means++ for initial centroid placement (better than random —
// picks each next centroid as the point furthest from existing
// centroids, weighted toward more-spread-out starts). Then runs
// Lloyd's algorithm: assign each point to nearest centroid, recompute
// centroid as the mean of its assigned points, repeat until stable.
//
// Stable on ~80 points in well under 10ms; runs synchronously inside
// the render so the user gets instant feedback when changing K.
export function kMeansCluster(points, k, maxIter = 50) {
  if (k <= 0 || points.length === 0) return []
  if (points.length <= k) {
    return points.map((p) => ({ lat: p.lat, lng: p.lng, members: [p] }))
  }
  // k-means++ initialization
  const centers = [{ lat: points[0].lat, lng: points[0].lng }]
  for (let i = 1; i < k; i++) {
    let bestPoint = null
    let bestDist = -1
    for (const p of points) {
      let minDist = Infinity
      for (const c of centers) {
        const d = milesBetween(p.lat, p.lng, c.lat, c.lng)
        if (d < minDist) minDist = d
      }
      if (minDist > bestDist) {
        bestDist = minDist
        bestPoint = p
      }
    }
    centers.push({ lat: bestPoint.lat, lng: bestPoint.lng })
  }
  // Lloyd's algorithm
  for (let iter = 0; iter < maxIter; iter++) {
    const assignments = points.map((p) => {
      let best = 0
      let bestDist = Infinity
      for (let i = 0; i < k; i++) {
        const d = milesBetween(p.lat, p.lng, centers[i].lat, centers[i].lng)
        if (d < bestDist) {
          bestDist = d
          best = i
        }
      }
      return best
    })
    let changed = false
    for (let i = 0; i < k; i++) {
      const members = points.filter((_, idx) => assignments[idx] === i)
      if (members.length === 0) continue
      const newLat = members.reduce((s, p) => s + p.lat, 0) / members.length
      const newLng = members.reduce((s, p) => s + p.lng, 0) / members.length
      if (
        Math.abs(newLat - centers[i].lat) > 0.0001 ||
        Math.abs(newLng - centers[i].lng) > 0.0001
      ) {
        changed = true
      }
      centers[i] = { lat: newLat, lng: newLng }
    }
    if (!changed) break
  }
  // Final assignment + build cluster objects
  const clusters = centers.map((c) => ({ lat: c.lat, lng: c.lng, members: [] }))
  for (const p of points) {
    let best = 0
    let bestDist = Infinity
    for (let i = 0; i < clusters.length; i++) {
      const d = milesBetween(p.lat, p.lng, clusters[i].lat, clusters[i].lng)
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    }
    clusters[best].members.push(p)
  }
  return clusters.filter((c) => c.members.length > 0).sort((a, b) => b.members.length - a.members.length)
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
