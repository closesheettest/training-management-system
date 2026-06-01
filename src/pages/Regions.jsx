import { useCallback, useEffect, useRef, useState } from 'react'
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
      .select('id, first_name, last_name, phone, region, is_active_sales_rep, rep_level, street_address, city, state, zip, county, latitude, longitude')
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
  // Re-default K to current region count once the regions context finishes
  // loading — useState's initializer runs before the regions table has been
  // fetched, so without this the slider would stick at 2 on first load even
  // though admin almost always wants K = current_region_count to start.
  const initedKRef = useRef(false)
  useEffect(() => {
    if (initedKRef.current) return
    if (regions.length > 0 && geocodedReps.length > 0) {
      setTargetK(Math.min(maxK, Math.max(minK, regions.length)))
      initedKRef.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regions.length, geocodedReps.length])

  const layoutClusters = (() => {
    if (geocodedReps.length < minK) return []
    const points = geocodedReps.map((r) => ({
      lat: r.latitude,
      lng: r.longitude,
      _rep: r,
    }))
    const raw = kMeansCluster(points, targetK)
    const built = raw.map((cluster) => {
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
      // Count which existing regions this cluster's members currently
      // belong to. Used by the pairing pass below to decide which
      // existing region each cluster "really is" (greedy bipartite
      // match, so each existing region pairs to at most one cluster —
      // no two clusters both try to replace St Pete).
      const existingRegionCount = new Map()
      for (const r of members) {
        if (r.region) existingRegionCount.set(r.region, (existingRegionCount.get(r.region) || 0) + 1)
      }
      return {
        suggestedName,
        members,
        lat: cluster.lat,
        lng: cluster.lng,
        avgRadius,
        existingRegionCount,
      }
    })
    // Greedy pairing: walk clusters by size desc and grab each one's
    // most-overlapping existing region that's still unpaired. This is
    // what turns "k-means says here are 4 clusters" into "your existing
    // 4 regions should be renamed/recentered to look like this."
    const remainingExisting = regions.filter((r) => r.id)
    const indexed = built.map((c, idx) => ({ c, idx }))
    indexed.sort((a, b) => b.c.members.length - a.c.members.length)
    const pairings = new Map()
    for (const { c, idx } of indexed) {
      let best = null
      let bestCount = 0
      for (const r of remainingExisting) {
        const count = c.existingRegionCount.get(r.name) || 0
        if (count > bestCount) {
          best = r
          bestCount = count
        }
      }
      if (best && bestCount > 0) {
        pairings.set(idx, {
          region: best,
          overlapCount: bestCount,
          overlapPct: bestCount / c.members.length,
        })
        const removeAt = remainingExisting.indexOf(best)
        remainingExisting.splice(removeAt, 1)
      }
    }
    // Fallback pass: any cluster that didn't pair via overlap now
    // grabs any remaining existing region in arbitrary order. This is
    // what lets the user "have exactly K regions even if we have to
    // rename all of them" — every cluster gets paired to an existing
    // region when K = existing count, so canApplyLayout fires.
    for (const { c, idx } of indexed) {
      if (pairings.has(idx)) continue
      if (remainingExisting.length === 0) break
      const fallback = remainingExisting.shift()
      pairings.set(idx, {
        region: fallback,
        overlapCount: 0,
        overlapPct: 0,
      })
    }
    return built.map((c, idx) => ({ ...c, pairedWith: pairings.get(idx) || null }))
  })()


  // Rename + recenter an existing region to match a k-means cluster,
  // AND move every cluster member into the new region (even reps that
  // were originally in OTHER regions). This is what "use this k-means
  // split for one of my regions" really means — not just a name change
  // but pulling in the right reps from wherever they currently live.
  async function replaceExistingWithCluster(cluster, existingRegion) {
    if (!existingRegion?.id) return
    const oldName = existingRegion.name
    const newName = cluster.suggestedName
    const center = `${cluster.lat.toFixed(4)}, ${cluster.lng.toFixed(4)}`
    const renaming = oldName !== newName
    const recentering =
      existingRegion.latitude !== cluster.lat ||
      existingRegion.longitude !== cluster.lng
    const externalMembers = cluster.members.filter((m) => m.region !== oldName)
    const willMoveExternal = externalMembers.length
    if (!renaming && !recentering && willMoveExternal === 0) {
      setFlash({ kind: 'success', text: `"${oldName}" already matches this cluster.` })
      return
    }
    const lines = []
    if (renaming) lines.push(`• Rename "${oldName}" → "${newName}"`)
    if (recentering) lines.push(`• Recenter to ${center}`)
    if (willMoveExternal > 0) {
      lines.push(`• Move ${willMoveExternal} rep${willMoveExternal === 1 ? '' : 's'} into "${newName}" from other regions`)
    }
    if (!confirm(`Apply these changes?\n\n${lines.join('\n')}\n\nContinue?`)) return
    setBusyId(existingRegion.id)
    // Two-step rename to dodge the unique-name constraint when names swap.
    if (renaming) {
      const tmp = `__tmp_${existingRegion.id.slice(0, 8)}`
      const { error: tmpErr } = await supabase
        .from('regions')
        .update({ name: tmp })
        .eq('id', existingRegion.id)
      if (tmpErr) {
        setBusyId(null)
        setFlash({ kind: 'error', text: tmpErr.message })
        return
      }
      const { error: trnErr } = await supabase
        .from('trainees')
        .update({ region: tmp })
        .eq('region', oldName)
      if (trnErr) {
        setBusyId(null)
        setFlash({ kind: 'error', text: trnErr.message })
        return
      }
      const { error: finalRegionErr } = await supabase
        .from('regions')
        .update({ name: newName, latitude: cluster.lat, longitude: cluster.lng })
        .eq('id', existingRegion.id)
      if (finalRegionErr) {
        setBusyId(null)
        setFlash({ kind: 'error', text: finalRegionErr.message })
        return
      }
      const { error: finalTrnErr } = await supabase
        .from('trainees')
        .update({ region: newName })
        .eq('region', tmp)
      if (finalTrnErr) {
        setBusyId(null)
        setFlash({ kind: 'error', text: finalTrnErr.message })
        return
      }
    } else {
      // Just recenter — no name change.
      const { error } = await supabase
        .from('regions')
        .update({ latitude: cluster.lat, longitude: cluster.lng })
        .eq('id', existingRegion.id)
      if (error) {
        setBusyId(null)
        setFlash({ kind: 'error', text: error.message })
        return
      }
    }
    // Pull in any cluster members not yet in this region — by id.
    // After the rename, reps originally in oldName already have the
    // right region string; this step catches the ones who lived
    // somewhere else and need to be moved into the new region.
    if (externalMembers.length > 0) {
      const { error: moveErr } = await supabase
        .from('trainees')
        .update({ region: newName })
        .in('id', externalMembers.map((m) => m.id))
      if (moveErr) {
        setBusyId(null)
        setFlash({ kind: 'error', text: moveErr.message })
        return
      }
    }
    setBusyId(null)
    const movedSuffix = willMoveExternal > 0 ? ` (${willMoveExternal} rep${willMoveExternal === 1 ? '' : 's'} moved in)` : ''
    setFlash({
      kind: 'success',
      text: renaming
        ? `Updated "${oldName}" → "${newName}"${movedSuffix}.`
        : `Re-centered "${oldName}"${movedSuffix}.`,
    })
    await reloadRegions()
    await loadReps()
  }

  // Apply the entire k-means layout in one click. Only makes sense
  // when targetK === regions.length (so every cluster pairs to exactly
  // one existing region — no leftovers either way). Renames + recenters
  // each paired existing region, in two phases to dodge unique-name
  // collisions when names swap.
  const canApplyLayout =
    layoutClusters.length === regions.filter((r) => r.id).length &&
    layoutClusters.every((c) => c.pairedWith)
  const [applyingLayout, setApplyingLayout] = useState(false)
  async function applyEntireLayout() {
    if (!canApplyLayout) return
    const ops = layoutClusters.map((c) => ({
      cluster: c,
      existing: c.pairedWith.region,
      renaming: c.suggestedName !== c.pairedWith.region.name,
    }))
    const preview = ops
      .map((o) => {
        const total = o.cluster.members.length
        const moving = o.cluster.members.filter((m) => m.region !== o.existing.name).length
        const fragments = []
        if (o.renaming) fragments.push(`Rename "${o.existing.name}" → "${o.cluster.suggestedName}"`)
        fragments.push(`re-center to ${o.cluster.lat.toFixed(4)}, ${o.cluster.lng.toFixed(4)}`)
        fragments.push(`${total} reps total (${moving} moving in from other regions)`)
        return `  • ${fragments.join(', ')}`
      })
      .join('\n')
    if (!confirm(
      `Apply this layout? Will make these changes:\n\n${preview}\n\n` +
      `Reps will be reassigned to match the k-means clusters — including ones moving in from other regions. ` +
      `This is reversible — you can edit names + move reps individually after.`,
    )) return
    setApplyingLayout(true)
    let errors = 0
    // Phase 1: rename every paired region to a tmp name + move its reps to that tmp.
    // Dodges the unique-name constraint when two regions swap names.
    for (const o of ops) {
      if (!o.renaming) continue
      const tmp = `__tmp_${o.existing.id.slice(0, 8)}`
      const { error: e1 } = await supabase
        .from('regions')
        .update({ name: tmp })
        .eq('id', o.existing.id)
      if (e1) { errors++; continue }
      const { error: e2 } = await supabase
        .from('trainees')
        .update({ region: tmp })
        .eq('region', o.existing.name)
      if (e2) errors++
    }
    // Phase 2: set final name + lat/lng + move tmp reps to final name.
    for (const o of ops) {
      const finalName = o.cluster.suggestedName
      const { error: e3 } = await supabase
        .from('regions')
        .update({ name: finalName, latitude: o.cluster.lat, longitude: o.cluster.lng })
        .eq('id', o.existing.id)
      if (e3) { errors++; continue }
      if (o.renaming) {
        const tmp = `__tmp_${o.existing.id.slice(0, 8)}`
        const { error: e4 } = await supabase
          .from('trainees')
          .update({ region: finalName })
          .eq('region', tmp)
        if (e4) errors++
      }
    }
    // Phase 3: reassign each cluster's geocoded members by id. This
    // moves reps that were originally in OTHER existing regions into
    // their k-means cluster's region — the real "apply the layout"
    // part. Overrides any region string set by the rename pass.
    for (const o of ops) {
      const memberIds = o.cluster.members.map((m) => m.id)
      if (memberIds.length === 0) continue
      const { error } = await supabase
        .from('trainees')
        .update({ region: o.cluster.suggestedName })
        .in('id', memberIds)
      if (error) errors++
    }
    setApplyingLayout(false)
    setFlash({
      kind: errors === 0 ? 'success' : 'error',
      text:
        errors === 0
          ? `Applied ${ops.length} region update${ops.length === 1 ? '' : 's'} — your regions now match the suggested layout.`
          : `Done with ${errors} error${errors === 1 ? '' : 's'} — check region names + try again.`,
    })
    await reloadRegions()
    await loadReps()
  }

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
  //
  // Unassigned is further split into field vs non-field. Only field
  // reps actually need a region (it drives sales-team routing, blasts,
  // map pins, manager assignments). Non-field staff — admins, ops,
  // hiring managers — can sit without a region forever without
  // breaking anything, so flagging them with the same amber warning
  // as field reps creates false urgency.
  const repsByRegion = (() => {
    const byName = new Map()
    for (const r of regions) byName.set(r.name, [])
    const unassignedField = []
    const unassignedNonField = []
    for (const t of reps) {
      if (t.region && byName.has(t.region)) {
        byName.get(t.region).push(t)
      } else if (t.rep_level === 'non_field') {
        unassignedNonField.push(t)
      } else {
        unassignedField.push(t)
      }
    }
    return { byName, unassignedField, unassignedNonField }
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
    // Also check managed_region — a stale legacy manager assignment
    // (Anthony's old "Jacksonville manager" scenario) doesn't show up
    // in the per-region rep list above, but it still ties data to this
    // region name. Deleting underneath that would leave the trainee
    // with a managed_region pointing at a row that no longer exists.
    // Re-query rather than trust the local reps state because reps[]
    // here doesn't carry managed_region (the regions page doesn't
    // select it).
    setBusyId(region.id)
    const { data: stale, error: staleErr } = await supabase
      .from('trainees')
      .select('first_name, last_name')
      .eq('managed_region', region.name)
      .limit(5)
    if (staleErr) {
      setBusyId(null)
      setFlash({ kind: 'error', text: staleErr.message })
      return
    }
    if (stale && stale.length > 0) {
      setBusyId(null)
      const names = stale.map((s) => `${s.first_name} ${s.last_name}`).join(', ')
      alert(
        `Can't delete "${region.name}" — ${stale.length} regional manager assignment${stale.length === 1 ? '' : 's'} ` +
        `still point${stale.length === 1 ? 's' : ''} at it (${names}). ` +
        `Go to /active-reps and either click "↪ Move to Zone X" or "Revoke" on each ` +
        `flagged amber row first.`,
      )
      return
    }
    if (!confirm(`Delete region "${region.name}"? This is reversible — you can add it back any time.`)) {
      setBusyId(null)
      return
    }
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
        <h1 className="text-3xl font-semibold tracking-tight">Zones</h1>
        <p className="mt-2 text-slate-600">
          Manage the list of sales zones and reassign reps between them. Changes here ripple
          to every zone picker in the app —{' '}
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

      {/* Suggested region layout — REMOVED 2026-05-31 per Neal.
          The k-means clustering would name clusters after the nearest
          city (Tampa / Orlando / Jacksonville / etc.), which conflicts
          with the owner-defined Zone model now in use (Zones 1-4 are
          county-based, not pure-geographic). Also kept resurfacing the
          names of deleted legacy regions, which made the cleanup pass
          feel half-finished.

          The Zone suggestion that survives is the per-rep one on
          /active-reps Edit Info — it suggests Zone X from the rep's
          home county using the authoritative mapping in src/lib/zones.js.

          State / memos for the clustering algorithm (layoutClusters,
          targetK, applyEntireLayout, adoptCluster, kMeansCluster) are
          left in place above for now in case we want to bring back a
          Zone-aware version later — easier than re-deriving from
          scratch. They run but the result is unused. */}
      {false && layoutClusters.length > 0 && (
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
          {/* "Apply this entire layout" — only available when K matches
              the existing region count AND every cluster pairs cleanly
              to an existing region. Single click renames + recenters
              every region to match its k-means cluster (with reps
              following the renames). */}
          {canApplyLayout && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-purple-300 bg-white p-3 shadow-sm">
              <div className="min-w-0 flex-1 text-xs text-purple-900">
                <strong>🚀 Ready to apply:</strong> these {layoutClusters.length} clusters pair 1:1
                with your existing {layoutClusters.length} regions. One click below renames /
                re-centers each one — and reps follow the rename automatically.
              </div>
              <button
                type="button"
                onClick={applyEntireLayout}
                disabled={applyingLayout}
                className="rounded-md bg-purple-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-800 disabled:opacity-50"
              >
                {applyingLayout ? 'Applying…' : '🚀 Apply this entire layout'}
              </button>
            </div>
          )}
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
                      {c.pairedWith && (
                        <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                          pairs with your current <strong>{c.pairedWith.region.name}</strong>{' '}
                          {c.pairedWith.overlapCount > 0
                            ? `(${Math.round(c.pairedWith.overlapPct * 100)}% overlap)`
                            : '(no overlap — would be a full rename)'}
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
                  <div className="flex flex-col items-end gap-1.5">
                    {c.pairedWith ? (
                      <button
                        type="button"
                        onClick={() => replaceExistingWithCluster(c, c.pairedWith.region)}
                        disabled={busyId === c.pairedWith.region.id}
                        className="rounded-md border border-purple-400 bg-purple-100 px-3 py-1.5 text-xs font-semibold text-purple-900 hover:bg-purple-200 disabled:opacity-50"
                        title={`Rename "${c.pairedWith.region.name}" to "${c.suggestedName}" and recenter it.`}
                      >
                        {busyId === c.pairedWith.region.id
                          ? 'Updating…'
                          : `📍 Replace ${c.pairedWith.region.name}`}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => prefillFromCluster(c)}
                        className="rounded-md border border-purple-300 bg-purple-50 px-3 py-1.5 text-xs font-semibold text-purple-900 hover:bg-purple-100"
                      >
                        ➕ Add as region
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Region cards */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">📍 Zones ({regions.length})</h2>

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
                      {(() => {
                        // Split total active reps in this region into field
                        // vs non-field so the count matches what shows up
                        // on /active-reps (which only renders field reps).
                        // Without this split, an admin/ops person tagged
                        // to a region inflates the count here vs there
                        // and looks like a bug.
                        const fieldCount = repsInRegion.filter((t) => t.rep_level !== 'non_field').length
                        const nonFieldCount = repsInRegion.length - fieldCount
                        return (
                          <>
                            <strong>{fieldCount}</strong> active field rep{fieldCount === 1 ? '' : 's'}
                            {nonFieldCount > 0 && (
                              <span className="text-slate-400"> · +{nonFieldCount} non-field staff</span>
                            )}
                          </>
                        )
                      })()}
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

        {/* Unassigned field reps — actual action item. Shows when a sales
            rep has no region OR has a region not in the managed list (e.g.
            the rep was on a region that got deleted underneath them, or
            their region string somehow drifted). */}
        {repsByRegion.unassignedField.length > 0 && (
          <article className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-xl">⚠️</span>
                <div>
                  <div className="font-semibold text-amber-900">Field reps needing assignment</div>
                  <div className="text-xs text-amber-800">
                    {repsByRegion.unassignedField.length} sales rep{repsByRegion.unassignedField.length === 1 ? '' : 's'} with no region (or with a region that's no longer in the managed list)
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
                  {repsByRegion.unassignedField.map((rep) => (
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

        {/* Non-field staff with no region — informational only. These are
            admins / ops / managers / etc. They don't need a region tied
            to their record to function; rendering them in the alarming
            amber bucket above creates fake homework. Collapse by default
            and clearly label "no action needed". */}
        {repsByRegion.unassignedNonField.length > 0 && (
          <article className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-medium text-slate-700">
                  {repsByRegion.unassignedNonField.length} non-field staff with no region
                </div>
                <div className="text-xs text-slate-500">
                  No action needed — non-field roles (admin / ops / management) don't require a region. Listed here for completeness only. To assign one anyway, use Edit Info on <Link to="/active-reps" className="underline">/active-reps</Link>.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpenRegionId(isOpen('__unassigned_nonfield') ? null : '__unassigned_nonfield')}
                className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                {openRegionId === '__unassigned_nonfield' ? 'Hide' : 'View staff'}
              </button>
            </div>
            {openRegionId === '__unassigned_nonfield' && (
              <ul className="mt-2 space-y-1 text-xs text-slate-600">
                {repsByRegion.unassignedNonField.map((rep) => (
                  <li key={rep.id}>
                    <strong className="text-slate-800">{rep.first_name} {rep.last_name}</strong>
                    {rep.phone && <span className="ml-2 text-slate-500">{rep.phone}</span>}
                  </li>
                ))}
              </ul>
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
