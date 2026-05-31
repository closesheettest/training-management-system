import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useRegions } from '../lib/RegionsContext.jsx'
import {
  AddStaffModal,
  DirectoryVisibilityModal,
  DIRECTORY_FIELDS,
  directoryHiddenLabel,
} from '../components/DirectoryControls.jsx'

// Display labels for rep_level values. Single source of truth so the
// "to confirm" buttons, badges, and dropdowns all read the same.
const LEVEL_LABEL = {
  junior: 'Junior',
  senior: 'Senior',
  non_field: 'Non-field',
}

// The set of fields editable from the rep-info modal — everything we
// might need to fix without forcing the rep to re-do /update-info. List
// here so the modal, the initial draft, and the Supabase update payload
// all stay in sync.
const EDITABLE_FIELDS = [
  'first_name',
  'last_name',
  'phone',
  'email',
  'company_email',
  'company_number',
  'region',
  'street_address',
  'city',
  'state',
  'zip',
]

function editableDraftFor(t) {
  const out = {}
  for (const k of EDITABLE_FIELDS) out[k] = t[k] || ''
  return out
}

// Active Sales Reps page — admin's master list of "in the field" reps.
//
// The is_active_sales_rep flag on trainees is the durable "on the sales
// team" signal, separate from "currently in a training class" (enrolled).
// Auto-managed in two places:
//   • TakeTest submits set the flag to true (graduation = active rep).
//   • The bulk-import + past-graduate backfill in the 2026-05-17 migration
//     seeded the initial list.
//
// This page is the manual escape hatch:
//   • Remove someone who left the company.
//   • Add someone who slipped through (graduated before this feature shipped,
//     or hired without going through training).
//   • Bulk-promote a class's graduates if the auto-flip missed them.
//
// Group Messages "All active sales reps" scope filters by this flag, so
// the list shown here is exactly who'd be reached by a company-wide blast.

export default function ActiveReps() {
  const { regionNames } = useRegions()
  const [active, setActive] = useState([])
  // 'Not yet active' = inactive trainees scheduled for a CURRENT or
  // FUTURE training class — i.e. people still in the pipeline. Once
  // they submit their final test they'll auto-flip to active.
  const [notYetActive, setNotYetActive] = useState([])
  // 'Non-field' = on the company team but not a field sales rep
  // (admin / ops / etc.). Excluded from the active sales rep section
  // and from "All active sales reps" group blasts.
  const [nonField, setNonField] = useState([])
  // 'Dropouts' = inactive trainees whose training class has ENDED but
  // they never graduated (no test submission, or auto-flagged as a
  // no-show). Effectively dead leads. Kept around for record-keeping
  // and the rare "actually they did make it, promote them anyway" case.
  const [dropouts, setDropouts] = useState([])
  // Reps flagged "no longer a sales rep" but admin hasn't yet finished
  // cleaning them up in GHL / RepCard / etc. Surfaced as a separate
  // section with a checklist + "✓ All cleanup done" button.
  const [pendingCleanup, setPendingCleanup] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [regionFilter, setRegionFilter] = useState('')
  const [savingId, setSavingId] = useState(null)
  const [flash, setFlash] = useState(null)
  // Modal state for "No longer a sales rep" — null when closed.
  // { trainee, reason } while open.
  const [leavingModal, setLeavingModal] = useState(null)
  // Modal state for "Add staff / management" form. null when closed.
  const [addStaffOpen, setAddStaffOpen] = useState(false)
  // Modal state for per-person directory privacy. null when closed,
  // { trainee, hidden } while open (hidden is a draft of directory_hidden).
  const [visibilityModal, setVisibilityModal] = useState(null)
  // Extra filter chip: when true, list shows only reps whose
  // info_updated_at is null (haven't self-served via /update-info yet).
  const [neverUpdatedOnly, setNeverUpdatedOnly] = useState(false)
  // Rep-level filter — applies to the Active field sales reps section.
  //   '' = no filter (show all active field reps)
  //   'junior' / 'senior' = only that confirmed level
  //   'need_to_assign' = level not set OR not yet confirmed
  //                      (i.e. anyone the admin still has to lock in)
  const [levelFilter, setLevelFilter] = useState('')
  // Bulk re-send state for the "Re-send update-info request" button.
  // { traineeIds: [...], sending, result } while running.
  const [resendBatch, setResendBatch] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('trainees')
      .select('id, first_name, last_name, phone, email, company_email, region, street_address, city, state, zip, is_active_sales_rep, became_active_rep_at, enrolled, declined_at, class_id, left_company_at, left_company_reason, cleanup_done_at, info_updated_at, registration_token, rep_level, rep_level_confirmed_at, company_number, directory_hidden, managed_region, manager_access_token, classes!class_id(region, week_start_date, week_end_date, attendance_only)')
      .order('last_name', { ascending: true })
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      setLoading(false)
      return
    }
    const all = data || []
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    // Classify each inactive trainee by their class state:
    //   - past TRAINING class (week_end < today, NOT attendance_only) → dropout
    //   - current/future training class                              → notYetActive
    //   - attendance-only or no class                                 → hidden
    //     (these are bulk-import dupes etc — not interesting here)
    //
    // Date parsing: Postgres `date` columns come back as 'YYYY-MM-DD'.
    // We parse component-wise (parseLocalDate) so the result is a local
    // Date at midnight — safer than feeding the string into `new Date`
    // which has timezone quirks across environments.
    function classifyInactive(t) {
      if (t.is_active_sales_rep) return null
      if (t.declined_at) return null
      if (t.left_company_at) return null
      const c = t.classes
      // attendance-only classes (meetings) don't graduate anyone, so
      // anyone inactive with that class type isn't a "trainee" or a
      // "dropout" — they're either a dedup'd row or just stuck there.
      // Hide from both new sections.
      if (c?.attendance_only) return null
      if (!c?.week_end_date) {
        // No class scheduled — treat as not-yet-active.
        return 'notYet'
      }
      // Parse 'YYYY-MM-DD' (or full ISO) as a local-midnight Date.
      const parts = String(c.week_end_date).slice(0, 10).split('-').map(Number)
      if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return 'notYet'
      const end = new Date(parts[0], parts[1] - 1, parts[2], 23, 59, 59)
      if (end < today) return 'dropout'
      return 'notYet'
    }

    // Active = on the team in the field (junior / senior / unset level).
    // Non-field = on the team but rep_level = non_field. Both have
    // is_active_sales_rep = true; we just split them visually.
    setActive(all.filter((t) => t.is_active_sales_rep && t.rep_level !== 'non_field'))
    setNonField(all.filter((t) => t.is_active_sales_rep && t.rep_level === 'non_field'))
    setNotYetActive(all.filter((t) => classifyInactive(t) === 'notYet'))
    setDropouts(
      all
        .filter((t) => classifyInactive(t) === 'dropout')
        // Most recent first — newest dropouts are most actionable.
        .sort((a, b) =>
          new Date(b.classes?.week_end_date || 0) -
          new Date(a.classes?.week_end_date || 0),
        ),
    )
    setPendingCleanup(
      all
        .filter((t) => t.left_company_at && !t.cleanup_done_at)
        .sort((a, b) => new Date(b.left_company_at) - new Date(a.left_company_at)),
    )
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function toggle(trainee, makeActive) {
    setSavingId(trainee.id)
    // Adding back as active also clears the "left the company" flag if
    // it was set — admin's saying "actually they're still on the team."
    const update = makeActive
      ? {
          is_active_sales_rep: true,
          became_active_rep_at: new Date().toISOString(),
          left_company_at: null,
          left_company_reason: null,
          cleanup_done_at: null,
        }
      : { is_active_sales_rep: false }
    const { error } = await supabase.from('trainees').update(update).eq('id', trainee.id)
    setSavingId(null)
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      return
    }
    setFlash({
      kind: 'success',
      text: `${trainee.first_name} ${trainee.last_name} ${makeActive ? 'added to' : 'removed from'} active reps.`,
    })
    await load()
  }

  // Confirm + submit the "No longer a sales rep" flag. Stamps
  // left_company_at + optional reason so the cleanup-pending list
  // can pick them up.
  async function confirmLeaving(trainee, reason) {
    setSavingId(trainee.id)
    const { error } = await supabase
      .from('trainees')
      .update({
        is_active_sales_rep: false,
        became_active_rep_at: null,
        left_company_at: new Date().toISOString(),
        left_company_reason: reason || null,
        cleanup_done_at: null,
      })
      .eq('id', trainee.id)
    setSavingId(null)
    setLeavingModal(null)
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      return
    }
    setFlash({
      kind: 'success',
      text: `${trainee.first_name} ${trainee.last_name} moved to "no longer a sales rep" — see Cleanup pending below.`,
    })
    await load()
  }

  // Edit the "active with us since" date — what HR actually wants for
  // real start-of-employment data, separate from when the system first
  // saw the rep (graduation submission or bulk-import meeting). Stored
  // as noon-UTC on the chosen date so the displayed date stays stable
  // across US timezones.
  async function setActiveSince(trainee, isoStamp) {
    setSavingId(trainee.id)
    const { error } = await supabase
      .from('trainees')
      .update({ became_active_rep_at: isoStamp })
      .eq('id', trainee.id)
    setSavingId(null)
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      return
    }
    setFlash({
      kind: 'success',
      text: `Updated active-since date for ${trainee.first_name} ${trainee.last_name}.`,
    })
    await load()
  }

  // Set the company number — HR-managed identifier shown in the public
  // /directory page (employee ID, badge number, work extension, etc.).
  // Empty string clears it.
  async function setCompanyNumber(trainee, value) {
    const next = value.trim() || null
    if ((trainee.company_number || null) === next) return
    setSavingId(trainee.id)
    const { error } = await supabase
      .from('trainees')
      .update({ company_number: next })
      .eq('id', trainee.id)
    setSavingId(null)
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      return
    }
    setFlash({
      kind: 'success',
      text: `Updated company number for ${trainee.first_name} ${trainee.last_name}.`,
    })
    await load()
  }

  // Create a non-trainee staff/management record. Inserts a trainees
  // row with is_active_sales_rep=true, rep_level pre-confirmed, no class.
  // Returns true on success so the modal can close itself.
  async function addStaff(payload) {
    const row = {
      first_name: payload.first_name.trim(),
      last_name: payload.last_name.trim(),
      phone: payload.phone?.trim() || null,
      company_email: payload.company_email?.trim() || null,
      email: null,
      region: payload.region || null,
      company_number: payload.company_number?.trim() || null,
      rep_level: payload.rep_level || 'non_field',
      rep_level_confirmed_at: new Date().toISOString(),
      is_active_sales_rep: true,
      became_active_rep_at: payload.active_since || new Date().toISOString(),
      enrolled: false,
      class_id: null,
      directory_hidden: payload.directory_hidden || {},
    }
    const { error } = await supabase.from('trainees').insert(row)
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      return false
    }
    setFlash({
      kind: 'success',
      text: `Added ${row.first_name} ${row.last_name} to the team.`,
    })
    await load()
    return true
  }

  // Save directory privacy flags (which fields are hidden in /directory)
  // for one rep. Empty object means everything is shown — the default.
  async function setDirectoryHidden(trainee, hidden) {
    setSavingId(trainee.id)
    const { error } = await supabase
      .from('trainees')
      .update({ directory_hidden: hidden || {} })
      .eq('id', trainee.id)
    setSavingId(null)
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      return
    }
    setFlash({
      kind: 'success',
      text: `Directory visibility updated for ${trainee.first_name} ${trainee.last_name}.`,
    })
    await load()
  }

  // Regional manager state: the modal asks which region a rep should
  // manage. null when closed, { trainee, region } while open.
  const [managerModal, setManagerModal] = useState(null)

  // Edit-info modal — opens with an editable copy of the rep's contact
  // + address + region. Saves back to Supabase on confirm. Used when
  // info comes in wrong from /update-info or admin needs to fix a typo
  // without making the rep re-self-serve.
  // Shape: { trainee, draft: {...editable fields} } while open, null otherwise.
  const [editModal, setEditModal] = useState(null)

  async function saveRepEdits(trainee, draft) {
    setSavingId(trainee.id)
    // Trim everything and convert empty strings to null so we don't
    // store "" instead of actually-blank fields. Supabase treats "" and
    // null differently in `eq` filters downstream.
    const payload = {}
    for (const [k, v] of Object.entries(draft)) {
      const s = String(v ?? '').trim()
      payload[k] = s === '' ? null : s
    }
    const { error } = await supabase
      .from('trainees')
      .update(payload)
      .eq('id', trainee.id)
    setSavingId(null)
    setEditModal(null)
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      return
    }
    setFlash({
      kind: 'success',
      text: `Saved updates for ${trainee.first_name} ${trainee.last_name}.`,
    })
    await load()
  }

  // Assign someone as the regional manager for a region. Generates a
  // fresh access token (rotates if there was an old one), stamps the
  // managed_region. The token lands in the URL the manager opens, so
  // rotating it effectively revokes any previously-shared link.
  async function assignAsManager(trainee, region) {
    if (!region) return
    setSavingId(trainee.id)
    const token = crypto.randomUUID().replace(/-/g, '')
    const { error } = await supabase
      .from('trainees')
      .update({
        managed_region: region,
        manager_access_token: token,
      })
      .eq('id', trainee.id)
    setSavingId(null)
    setManagerModal(null)
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      return
    }
    setFlash({
      kind: 'success',
      text: `${trainee.first_name} ${trainee.last_name} is now the regional manager for ${region}. Use "Copy access link" to share their dashboard URL.`,
    })
    await load()
  }

  // Revoke regional manager status — clears managed_region AND rotates
  // the access token (so any link already in their phone stops working).
  async function revokeManager(trainee) {
    setSavingId(trainee.id)
    const { error } = await supabase
      .from('trainees')
      .update({
        managed_region: null,
        manager_access_token: null,
      })
      .eq('id', trainee.id)
    setSavingId(null)
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      return
    }
    setFlash({
      kind: 'success',
      text: `${trainee.first_name} ${trainee.last_name} is no longer a regional manager. Their old link is now dead.`,
    })
    await load()
  }

  // Copy the public manager dashboard URL to clipboard. The hostname
  // comes from window.location so localhost / preview deploys / prod
  // all generate working links.
  async function copyManagerLink(trainee) {
    if (!trainee.manager_access_token) return
    const url = `${window.location.origin}/regional-manager/${trainee.manager_access_token}`
    try {
      await navigator.clipboard.writeText(url)
      setFlash({
        kind: 'success',
        text: `Link copied — paste into a text to ${trainee.first_name}.`,
      })
    } catch {
      setFlash({ kind: 'error', text: `Couldn't copy. Link: ${url}` })
    }
  }

  // Confirm or change a rep's level (junior/senior). Stamping
  // rep_level_confirmed_at removes them from the "to confirm" list.
  async function setRepLevel(trainee, level) {
    setSavingId(trainee.id)
    const { error } = await supabase
      .from('trainees')
      .update({
        rep_level: level,
        rep_level_confirmed_at: new Date().toISOString(),
      })
      .eq('id', trainee.id)
    setSavingId(null)
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      return
    }
    setFlash({
      kind: 'success',
      text: `${trainee.first_name} ${trainee.last_name} set to ${level === 'junior' ? 'Junior' : 'Senior'} rep.`,
    })
    await load()
  }

  // Mark a former rep's other-system cleanup as done. They disappear
  // from the pending list once stamped. Reversible: clear cleanup_done_at
  // in Supabase if admin needs to redo.
  async function markCleanupDone(trainee) {
    setSavingId(trainee.id)
    const { error } = await supabase
      .from('trainees')
      .update({ cleanup_done_at: new Date().toISOString() })
      .eq('id', trainee.id)
    setSavingId(null)
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      return
    }
    setFlash({ kind: 'success', text: `Cleanup marked done for ${trainee.first_name} ${trainee.last_name}.` })
    await load()
  }

  const searchLower = search.trim().toLowerCase()
  // Predicate for the level filter — pulled out so it's easy to reuse
  // for both filtering and the chip counts.
  function matchesLevelFilter(t) {
    if (!levelFilter) return true
    if (levelFilter === 'junior') return t.rep_level === 'junior' && !!t.rep_level_confirmed_at
    if (levelFilter === 'senior') return t.rep_level === 'senior' && !!t.rep_level_confirmed_at
    if (levelFilter === 'need_to_assign') return !t.rep_level || !t.rep_level_confirmed_at
    return true
  }
  // Whether the level filter should apply to a given list — only the
  // Active field-rep list has Junior/Senior/unconfirmed nuance worth
  // slicing. For non-field / pipeline / dropouts, ignore the filter so
  // those sections don't go empty when admin's slicing actives.
  const filterList = (list, { applyLevel = false } = {}) => {
    return list.filter((t) => {
      // '__none' = "no region set yet" — useful for chasing bulk imports
      // who haven't filled in /update-info yet.
      if (regionFilter === '__none' && t.region) return false
      if (regionFilter && regionFilter !== '__none' && t.region !== regionFilter) return false
      if (neverUpdatedOnly && t.info_updated_at) return false
      if (applyLevel && !matchesLevelFilter(t)) return false
      if (!searchLower) return true
      const full = `${t.first_name || ''} ${t.last_name || ''}`.toLowerCase()
      return full.includes(searchLower) || (t.phone || '').includes(searchLower)
    })
  }
  // Active reps: sorted alphabetically by last name within each
  // region group. Region grouping happens below in activeByRegionGroups.
  // Info-updated status no longer drives the top-level order — the
  // per-row "📋 Never updated their info" badge already surfaces
  // stragglers without needing a global sort.
  const activeFiltered = filterList(active, { applyLevel: true }).slice().sort((a, b) =>
    `${a.last_name || ''} ${a.first_name || ''}`.localeCompare(
      `${b.last_name || ''} ${b.first_name || ''}`,
    ),
  )
  const notYetActiveFiltered = filterList(notYetActive)
  const dropoutsFiltered = filterList(dropouts)
  const nonFieldFiltered = filterList(nonField)

  // Group active reps by region for the field-section render below.
  // Each region group has:
  //   manager  - the trainee whose managed_region matches (if any)
  //   reps     - everyone in that region MINUS the manager (deduped
  //              so the manager only renders once, at the top, as the
  //              group header)
  // Regions are sorted alphabetically; "No region yet" sinks to the
  // bottom so it doesn't disrupt the alphabetical flow.
  //
  // Edge case: a manager whose own region field doesn't match their
  // managed_region (e.g. lives in Miami, manages Jacksonville) appears
  // ONLY as the Jacksonville header — they're pulled out of the Miami
  // bucket by the dedupe pass. That's the right call for "who's in
  // charge of region X" framing.
  const activeByRegionGroups = useMemo(() => {
    const groups = new Map()
    function ensure(region) {
      if (!groups.has(region)) groups.set(region, { region, manager: null, reps: [] })
      return groups.get(region)
    }
    // Seed every visible region (including managed-only ones) so a
    // region with just a manager and no reps still gets a header card.
    for (const t of activeFiltered) {
      ensure(t.region || '__no_region')
      if (t.managed_region) ensure(t.managed_region)
    }
    // Place each rep in their region's bucket.
    for (const t of activeFiltered) {
      ensure(t.region || '__no_region').reps.push(t)
    }
    // Promote each manager to their region's header + remove them
    // from the rep bucket they were just added to (dedupe).
    for (const t of activeFiltered) {
      if (!t.managed_region) continue
      const g = ensure(t.managed_region)
      g.manager = t
      g.reps = g.reps.filter((r) => r.id !== t.id)
      // Also pull the manager out of any OTHER region bucket they
      // might be in (the rare cross-region case above).
      for (const og of groups.values()) {
        if (og.region === t.managed_region) continue
        og.reps = og.reps.filter((r) => r.id !== t.id)
      }
    }
    return Array.from(groups.values()).sort((a, b) => {
      // "No region yet" always sinks to the bottom of the alpha list.
      if (a.region === '__no_region') return 1
      if (b.region === '__no_region') return -1
      return a.region.localeCompare(b.region)
    })
  }, [activeFiltered])

  // CSV download for the active field reps section.
  //
  // Respects the currently-applied filters (region / rep level / search /
  // never-updated chip) so admin can e.g. filter to Miami and export only
  // that crew. Columns are picked for "what would I actually paste into
  // payroll / a partner spreadsheet" — name + contact + region + level +
  // a couple of operational dates.
  //
  // RFC 4180 CSV escaping: any cell with a comma, quote, CR, or LF gets
  // wrapped in double quotes and internal quotes get doubled.
  function downloadActiveRepsCsv() {
    const headers = [
      'First Name',
      'Last Name',
      'Phone',
      'Personal Email',
      'Company Email',
      'Company Number',
      'Region',
      'Rep Level',
      'Street Address',
      'City',
      'State',
      'Zip',
      'Full Address',
      'Active Since',
      'Info Last Updated',
    ]
    const rows = activeFiltered.map((t) => {
      // Build the "Full Address" column — single-line, comma-separated,
      // skipping any blank component. Convenient for pasting into a
      // mailing label or geocoder without rebuilding the string yourself.
      const fullAddress = [
        t.street_address,
        t.city,
        [t.state, t.zip].filter(Boolean).join(' '),
      ]
        .filter((s) => s && String(s).trim())
        .join(', ')
      return [
        t.first_name || '',
        t.last_name || '',
        t.phone || '',
        t.email || '',
        t.company_email || '',
        t.company_number || '',
        t.region || '',
        // Same label rule as the on-page badges: unconfirmed counts as
        // "needs assignment" even if a tentative level was auto-set.
        !t.rep_level || !t.rep_level_confirmed_at
          ? 'Needs assignment'
          : LEVEL_LABEL[t.rep_level] || t.rep_level,
        t.street_address || '',
        t.city || '',
        t.state || '',
        t.zip || '',
        fullAddress,
        t.became_active_rep_at
          ? new Date(t.became_active_rep_at).toISOString().slice(0, 10)
          : '',
        t.info_updated_at
          ? new Date(t.info_updated_at).toISOString().slice(0, 10)
          : '',
      ]
    })
    const csv = [headers, ...rows]
      .map((row) =>
        row
          .map((v) => {
            const s = String(v ?? '')
            return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
          })
          .join(','),
      )
      .join('\r\n')

    // BOM so Excel reads UTF-8 (accented names) correctly on Windows.
    const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const today = new Date().toISOString().slice(0, 10)
    // Hint the filter in the filename so a region-filtered export
    // doesn't get mistaken for the full roster later.
    const suffix = regionFilter
      ? `-${regionFilter === '__none' ? 'no-region' : regionFilter.toLowerCase().replace(/\s+/g, '-')}`
      : ''
    const a = document.createElement('a')
    a.href = url
    a.download = `active-sales-reps${suffix}-${today}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // How many active reps still haven't responded to the update-info
  // blast (info_updated_at IS NULL). Shown as a chip + powers the bulk
  // "Re-send update-info request" button.
  const neverUpdatedCount = useMemo(
    () => active.filter((t) => !t.info_updated_at).length,
    [active],
  )

  // Active reps whose auto-assigned Junior/Senior level admin hasn't
  // confirmed yet. Drives the "Rep levels to confirm" section.
  const unconfirmedLevel = useMemo(
    () => active.filter((t) => t.rep_level && !t.rep_level_confirmed_at),
    [active],
  )

  // Per-level active-rep counts — drive the chip labels for the
  // Junior / Senior / Need-to-assign filter row.
  const activeByLevel = useMemo(() => {
    const counts = { junior: 0, senior: 0, need_to_assign: 0 }
    for (const t of active) {
      if (!t.rep_level || !t.rep_level_confirmed_at) counts.need_to_assign++
      else if (t.rep_level === 'junior') counts.junior++
      else if (t.rep_level === 'senior') counts.senior++
    }
    return counts
  }, [active])

  // Per-region active-rep counts for the breakdown card.
  const activeByRegion = useMemo(() => {
    const counts = { __none: 0 }
    for (const r of regionNames) counts[r] = 0
    for (const t of active) {
      if (t.region && counts[t.region] !== undefined) counts[t.region]++
      else if (t.region) counts[t.region] = (counts[t.region] || 0) + 1
      else counts.__none++
    }
    return counts
  }, [active])

  // Suggest promotion for trainees who graduated (submitted test) but
  // somehow aren't flagged active yet. With the auto-flip in TakeTest
  // this should be empty, but it's here as a safety net for any past
  // graduates the backfill missed.
  const [suggested, setSuggested] = useState([])
  useEffect(() => {
    loadSuggestions()
  }, [])
  async function loadSuggestions() {
    const { data } = await supabase
      .from('test_attempts')
      .select('trainee_id, submitted_at, trainees(id, first_name, last_name, phone, is_active_sales_rep)')
      .not('submitted_at', 'is', null)
    const rows = (data || [])
      .filter((a) => a.trainees && !a.trainees.is_active_sales_rep)
      .map((a) => ({ ...a.trainees, submitted_at: a.submitted_at }))
    // Dedup in case a trainee has multiple attempts
    const seen = new Set()
    const dedup = []
    for (const r of rows) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      dedup.push(r)
    }
    setSuggested(dedup)
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Active sales reps</h1>
        <p className="mt-2 text-slate-600">
          The master list of people on the sales team in the field. Group Messages "All active
          sales reps" broadcasts go to everyone here. Auto-updated when a trainee submits their
          final test; the rest is hand-managed below.
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

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        {/* Rep-level row: slice the Active list by Junior / Senior /
            "Need to assign" (level missing OR auto-guessed but not yet
            confirmed). Only affects the Active field reps section —
            non-field, pipeline, and dropouts ignore it. */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span className="font-semibold uppercase tracking-wide text-slate-500">Level:</span>
          <button
            type="button"
            onClick={() => setLevelFilter(levelFilter === 'junior' ? '' : 'junior')}
            className={
              'rounded-full border px-2.5 py-1 ' +
              (levelFilter === 'junior'
                ? 'border-emerald-700 bg-emerald-100 text-emerald-900'
                : 'border-emerald-300 bg-white hover:bg-emerald-50 text-emerald-800')
            }
            title="Show only confirmed Junior reps."
          >
            🎖 Junior <span className="ml-1 opacity-70">({activeByLevel.junior})</span>
          </button>
          <button
            type="button"
            onClick={() => setLevelFilter(levelFilter === 'senior' ? '' : 'senior')}
            className={
              'rounded-full border px-2.5 py-1 ' +
              (levelFilter === 'senior'
                ? 'border-violet-700 bg-violet-100 text-violet-900'
                : 'border-violet-300 bg-white hover:bg-violet-50 text-violet-800')
            }
            title="Show only confirmed Senior reps."
          >
            🎖 Senior <span className="ml-1 opacity-70">({activeByLevel.senior})</span>
          </button>
          <button
            type="button"
            onClick={() =>
              setLevelFilter(levelFilter === 'need_to_assign' ? '' : 'need_to_assign')
            }
            className={
              'rounded-full border px-2.5 py-1 ' +
              (levelFilter === 'need_to_assign'
                ? 'border-amber-700 bg-amber-100 text-amber-900'
                : activeByLevel.need_to_assign > 0
                  ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                  : 'border-slate-300 bg-white text-slate-500 cursor-default')
            }
            disabled={activeByLevel.need_to_assign === 0}
            title="Reps without a confirmed Junior/Senior level — the admin still needs to lock them in."
          >
            🛈 Need to assign <span className="ml-1 opacity-70">({activeByLevel.need_to_assign})</span>
          </button>
          {levelFilter && (
            <button
              type="button"
              onClick={() => setLevelFilter('')}
              className="ml-2 text-slate-500 underline hover:text-slate-700"
            >
              Clear filter
            </button>
          )}
        </div>

        {/* Info-status row: who still hasn't filled in /update-info? */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span className="font-semibold uppercase tracking-wide text-slate-500">Info status:</span>
          <button
            type="button"
            onClick={() => setNeverUpdatedOnly(!neverUpdatedOnly)}
            className={
              'rounded-full border px-2.5 py-1 ' +
              (neverUpdatedOnly
                ? 'border-amber-700 bg-amber-100 text-amber-900'
                : neverUpdatedCount > 0
                  ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                  : 'border-emerald-300 bg-emerald-50 text-emerald-800 cursor-default')
            }
            disabled={neverUpdatedCount === 0}
            title="Active reps who haven't submitted the /update-info form yet."
          >
            📋 Never updated their info ({neverUpdatedCount})
          </button>
          <span className="text-slate-500">
            · {active.length - neverUpdatedCount} of {active.length} have filled it in
          </span>
          {neverUpdatedOnly && (
            <>
              <button
                type="button"
                onClick={() =>
                  setResendBatch({
                    traineeIds: active.filter((t) => !t.info_updated_at).map((t) => t.id),
                    channels: { sms: true, email: true },
                    sending: false,
                    result: null,
                  })
                }
                className="ml-2 rounded-md bg-amber-700 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-800"
              >
                📧 Re-send update-info request to {neverUpdatedCount}
              </button>
              <button
                type="button"
                onClick={() => setNeverUpdatedOnly(false)}
                className="text-slate-500 underline hover:text-slate-700"
              >
                Clear filter
              </button>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span className="font-semibold uppercase tracking-wide text-slate-500">Active by region:</span>
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
              {r} <span className="ml-1 opacity-70">({activeByRegion[r] || 0})</span>
            </button>
          ))}
          {activeByRegion.__none > 0 && (
            <button
              type="button"
              onClick={() => setRegionFilter(regionFilter === '__none' ? '' : '__none')}
              className={
                'rounded-full border px-2.5 py-1 ' +
                (regionFilter === '__none'
                  ? 'border-amber-700 bg-amber-100 text-amber-900'
                  : 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100')
              }
              title="Active reps who haven't picked a region yet — likely bulk imports who haven't filled in /update-info"
            >
              No region yet ({activeByRegion.__none})
            </button>
          )}
          {regionFilter && (
            <button
              type="button"
              onClick={() => setRegionFilter('')}
              className="ml-2 text-slate-500 underline hover:text-slate-700"
            >
              Clear filter
            </button>
          )}
        </div>
      </section>

      {resendBatch && (
        <ResendUpdateInfoModal
          batch={resendBatch}
          setBatch={setResendBatch}
          onClose={() => setResendBatch(null)}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or phone…"
            className="w-full max-w-xs rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => setAddStaffOpen(true)}
            className="rounded-md border border-brand-navy bg-white px-3 py-2 text-sm font-semibold text-brand-navy hover:bg-slate-50"
            title="Add a non-trainee staff or management person — they appear in the team directory but skip the training workflow."
          >
            + Add staff / management
          </button>
          <button
            type="button"
            onClick={downloadActiveRepsCsv}
            disabled={activeFiltered.length === 0}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            title="Download the currently-filtered active field reps as a CSV (name, contact, region, rep level)."
          >
            ⬇ Download CSV ({activeFiltered.length})
          </button>
        </div>
        <div className="text-sm text-slate-600">
          <strong className="text-emerald-700">{active.length}</strong> active field ·{' '}
          <strong className="text-slate-500">{nonField.length}</strong> non-field ·{' '}
          <strong className="text-slate-500">{notYetActive.length}</strong> not yet active ·{' '}
          <strong className="text-slate-500">{dropouts.length}</strong> dropouts
          {(regionFilter || neverUpdatedOnly || levelFilter || search) && (
            <span className="ml-2 text-xs text-amber-700">
              ⚠ filters active — counts below reflect filters, totals above are unfiltered
            </span>
          )}
        </div>
      </div>

      <section className="rounded-lg border border-emerald-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-emerald-900">
          ⭐ Active field sales reps ({activeFiltered.length})
        </h2>
        {loading ? (
          <p className="mt-3 text-sm text-slate-500">Loading…</p>
        ) : activeFiltered.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            {search ? 'No matches.' : 'Nobody yet — promote past graduates above or wait for the next class to finish their test.'}
          </p>
        ) : (
          <div className="mt-3 space-y-6">
            {activeByRegionGroups.map((g) => {
              const isNoRegion = g.region === '__no_region'
              const totalPeople = (g.manager ? 1 : 0) + g.reps.length
              // Helper — every RepRow in this section needs the same
              // 11 handler props, and duplicating them ~3x per group
              // would obscure the structure. Inline arrow keeps the
              // props plumbing in one spot.
              const renderRepRow = (t) => (
                <RepRow
                  key={t.id}
                  t={t}
                  active
                  saving={savingId === t.id}
                  onMarkLeaving={() => setLeavingModal({ trainee: t, reason: '' })}
                  onPromote={() => toggle(t, true)}
                  onSetLevel={(lvl) => setRepLevel(t, lvl)}
                  onSetActiveSince={(iso) => setActiveSince(t, iso)}
                  onSetCompanyNumber={(v) => setCompanyNumber(t, v)}
                  onEditDirectory={() => setVisibilityModal({ trainee: t, hidden: { ...(t.directory_hidden || {}) } })}
                  onAssignManager={() => setManagerModal({ trainee: t, region: t.region || '' })}
                  onRevokeManager={() => revokeManager(t)}
                  onCopyManagerLink={() => copyManagerLink(t)}
                  onEditInfo={() => setEditModal({ trainee: t, draft: editableDraftFor(t) })}
                />
              )
              return (
                <div key={g.region}>
                  <div className={`-mx-5 border-y px-5 py-2 ${isNoRegion ? 'border-amber-200 bg-amber-50/60' : 'border-emerald-200 bg-emerald-50/50'}`}>
                    <h3 className={`flex items-baseline gap-2 text-sm font-bold uppercase tracking-wide ${isNoRegion ? 'text-amber-900' : 'text-emerald-900'}`}>
                      <span>📍 {isNoRegion ? 'No region yet' : g.region}</span>
                      <span className={`text-xs font-normal ${isNoRegion ? 'text-amber-700' : 'text-emerald-700'}`}>
                        ({totalPeople} {totalPeople === 1 ? 'person' : 'people'})
                      </span>
                    </h3>
                  </div>
                  {g.manager ? (
                    <div className="mt-2 rounded-md border border-purple-300 bg-purple-50/60 px-3 pt-2">
                      <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-purple-900">
                        👑 Regional Manager
                      </div>
                      <ul className="divide-y divide-purple-200/50">
                        {renderRepRow(g.manager)}
                      </ul>
                    </div>
                  ) : !isNoRegion ? (
                    <p className="mt-2 text-xs italic text-amber-700">
                      No regional manager assigned yet — click the 👑 button on a rep below to designate one.
                    </p>
                  ) : null}
                  {g.reps.length > 0 ? (
                    <ul className="mt-2 divide-y divide-slate-100">
                      {g.reps.map(renderRepRow)}
                    </ul>
                  ) : (
                    <p className="mt-2 text-xs italic text-slate-500">
                      {g.manager ? 'Just the manager so far — no other reps in this region yet.' : 'No reps in this region yet.'}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {unconfirmedLevel.length > 0 && (
        <section className="rounded-lg border border-indigo-200 bg-indigo-50 p-5">
          <h2 className="text-lg font-semibold text-indigo-900">
            🎖 Rep levels to confirm ({unconfirmedLevel.length})
          </h2>
          <p className="mt-1 text-sm text-indigo-900">
            The system has auto-guessed Junior or Senior for each rep below — Junior if they
            graduated through this system, Senior if they were already on the team when bulk-imported.
            Confirm the guess (one click) or flip it to the other level.
          </p>
          <ul className="mt-3 space-y-2">
            {unconfirmedLevel.map((t) => {
              const guess = t.rep_level
              const otherFieldLevel = guess === 'junior' ? 'senior' : 'junior'
              const history = repHistoryLabel(t)
              return (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <div>
                      <strong>{t.first_name} {t.last_name}</strong>{' '}
                      <span className="text-slate-500">{t.phone || ''}</span>
                      <span className="ml-2 text-xs text-slate-600">
                        Auto-guess: <strong>{LEVEL_LABEL[guess]}</strong>
                      </span>
                    </div>
                    {history && (
                      <div className="mt-0.5 text-[11px] text-slate-500">{history}</div>
                    )}
                    <div className="mt-0.5 text-[11px] text-slate-600">
                      Active with us since:{' '}
                      <EditableActiveSince
                        value={t.became_active_rep_at}
                        onSave={(iso) => setActiveSince(t, iso)}
                        busy={savingId === t.id}
                      />
                    </div>
                  </div>
                  <span className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setRepLevel(t, guess)}
                      disabled={savingId === t.id}
                      className="rounded-md bg-indigo-700 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-800 disabled:opacity-50"
                    >
                      {savingId === t.id ? '…' : `✓ Confirm ${LEVEL_LABEL[guess]}`}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRepLevel(t, otherFieldLevel)}
                      disabled={savingId === t.id}
                      className="rounded-md border border-indigo-300 bg-white px-3 py-1 text-xs font-semibold text-indigo-800 hover:bg-indigo-50 disabled:opacity-50"
                    >
                      Change to {LEVEL_LABEL[otherFieldLevel]}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRepLevel(t, 'non_field')}
                      disabled={savingId === t.id}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      title="Not a field sales rep — admin / ops / other role. Removes them from /active-reps and from 'all active sales reps' broadcasts."
                    >
                      Move to Non-field
                    </button>
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {suggested.length > 0 && (
        <section className="rounded-lg border border-sky-200 bg-sky-50 p-5">
          <h2 className="text-lg font-semibold text-sky-900">
            🎓 Past graduates not yet flagged active ({suggested.length})
          </h2>
          <p className="mt-1 text-sm text-sky-900">
            These trainees submitted their final test before the auto-flip rule existed (or it
            missed them). One click each to promote — or skip if they've left the company since.
          </p>
          <ul className="mt-3 space-y-2">
            {suggested.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-sky-200 bg-white px-3 py-2 text-sm"
              >
                <span>
                  <strong>{t.first_name} {t.last_name}</strong>{' '}
                  <span className="text-slate-500">{t.phone || ''}</span>{' '}
                  <span className="text-xs text-slate-400">
                    graduated {new Date(t.submitted_at).toLocaleDateString()}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => toggle(t, true)}
                  disabled={savingId === t.id}
                  className="rounded-md bg-sky-700 px-3 py-1 text-xs font-semibold text-white hover:bg-sky-800 disabled:opacity-50"
                >
                  {savingId === t.id ? 'Saving…' : 'Promote'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pendingCleanup.length > 0 && (
        <section className="rounded-lg border-2 border-amber-300 bg-amber-50 p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-amber-900">
            🚪 Cleanup pending — reps to remove from other systems ({pendingCleanup.length})
          </h2>
          <p className="mt-1 text-sm text-amber-900">
            These reps are flagged "no longer with the company." Go deactivate them in each
            external system below, then click <strong>✓ All cleanup done</strong> to clear them
            from this list.
          </p>
          <ul className="mt-3 space-y-3">
            {pendingCleanup.map((t) => (
              <CleanupRow
                key={t.id}
                t={t}
                saving={savingId === t.id}
                onDone={() => markCleanupDone(t)}
                onUndo={() => toggle(t, true)}
              />
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">
          🧑‍💼 Non-field roles ({nonFieldFiltered.length})
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Still on the company team but not field sales reps (admin / ops / other). They don't
          receive "All active sales reps" broadcasts and aren't counted in the field map. Use the
          level dropdown to move someone back to Junior or Senior.
        </p>
        {loading ? (
          <p className="mt-3 text-sm text-slate-500">Loading…</p>
        ) : nonFieldFiltered.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            {search ? 'No matches.' : 'No non-field roles yet.'}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {nonFieldFiltered.map((t) => (
              <RepRow
                key={t.id}
                t={t}
                active
                saving={savingId === t.id}
                onMarkLeaving={() => setLeavingModal({ trainee: t, reason: '' })}
                onPromote={() => toggle(t, true)}
                onSetLevel={(lvl) => setRepLevel(t, lvl)}
                onSetActiveSince={(iso) => setActiveSince(t, iso)}
                onSetCompanyNumber={(v) => setCompanyNumber(t, v)}
                onEditDirectory={() => setVisibilityModal({ trainee: t, hidden: { ...(t.directory_hidden || {}) } })}
                onEditInfo={() => setEditModal({ trainee: t, draft: editableDraftFor(t) })}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">
          ⏳ Trainees in the pipeline ({notYetActiveFiltered.length})
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          People scheduled for a current or upcoming training class. They'll auto-flip to active
          reps when they submit their final test. Listed here so you can promote anyone manually
          if needed.
        </p>
        {loading ? (
          <p className="mt-3 text-sm text-slate-500">Loading…</p>
        ) : notYetActiveFiltered.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            {search ? 'No matches.' : 'No trainees currently in the pipeline.'}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {notYetActiveFiltered.map((t) => (
              <RepRow
                key={t.id}
                t={t}
                active={false}
                saving={savingId === t.id}
                onPromote={() => toggle(t, true)}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-slate-50 p-5">
        <h2 className="text-lg font-semibold text-slate-700">
          ❌ Dropouts / dead ({dropoutsFiltered.length})
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Trainees whose class week ended without them graduating — never submitted the final
          test, or no-showed entirely. Kept here for record-keeping. If someone in this list
          actually did make it through and should be active, click <strong>Add as active rep</strong>{' '}
          to override.
        </p>
        {loading ? (
          <p className="mt-3 text-sm text-slate-500">Loading…</p>
        ) : dropoutsFiltered.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            {search ? 'No matches.' : 'No dropouts on record. 🎉'}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-200">
            {dropoutsFiltered.map((t) => (
              <RepRow
                key={t.id}
                t={t}
                active={false}
                saving={savingId === t.id}
                onPromote={() => toggle(t, true)}
              />
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-slate-400">
        Want to send a message to this list? <Link to="/group-messages" className="underline">Open Group messages</Link>.
      </p>

      {leavingModal && (
        <LeavingModal
          trainee={leavingModal.trainee}
          reason={leavingModal.reason}
          setReason={(v) => setLeavingModal({ ...leavingModal, reason: v })}
          sending={savingId === leavingModal.trainee.id}
          onCancel={() => setLeavingModal(null)}
          onConfirm={() => confirmLeaving(leavingModal.trainee, leavingModal.reason)}
        />
      )}

      {managerModal && (
        <AssignManagerModal
          trainee={managerModal.trainee}
          region={managerModal.region}
          setRegion={(r) => setManagerModal({ ...managerModal, region: r })}
          regionNames={regionNames}
          sending={savingId === managerModal.trainee.id}
          onCancel={() => setManagerModal(null)}
          onConfirm={() => assignAsManager(managerModal.trainee, managerModal.region)}
        />
      )}

      {editModal && (
        <EditRepModal
          trainee={editModal.trainee}
          draft={editModal.draft}
          setDraft={(d) => setEditModal({ ...editModal, draft: d })}
          regionNames={regionNames}
          sending={savingId === editModal.trainee.id}
          onCancel={() => setEditModal(null)}
          onConfirm={() => saveRepEdits(editModal.trainee, editModal.draft)}
        />
      )}

      {addStaffOpen && (
        <AddStaffModal
          regionNames={regionNames}
          onCancel={() => setAddStaffOpen(false)}
          onSave={async (payload) => {
            const ok = await addStaff(payload)
            if (ok) setAddStaffOpen(false)
          }}
        />
      )}

      {visibilityModal && (
        <DirectoryVisibilityModal
          trainee={visibilityModal.trainee}
          hidden={visibilityModal.hidden}
          setHidden={(h) => setVisibilityModal({ ...visibilityModal, hidden: h })}
          sending={savingId === visibilityModal.trainee.id}
          onCancel={() => setVisibilityModal(null)}
          onConfirm={async () => {
            await setDirectoryHidden(visibilityModal.trainee, visibilityModal.hidden)
            setVisibilityModal(null)
          }}
        />
      )}
    </div>
  )
}

function RepRow({ t, active, saving, onMarkLeaving, onPromote, onSetLevel, onSetActiveSince, onSetCompanyNumber, onEditDirectory, onAssignManager, onRevokeManager, onCopyManagerLink, onEditInfo }) {
  const classLabel = t.classes
    ? `${t.classes.region}${t.classes.attendance_only ? ' meeting' : ''} · ${t.classes.week_start_date || ''}`
    : '—'
  const levelConfirmed = !!t.rep_level_confirmed_at
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-slate-900">
            {t.first_name} {t.last_name}
          </span>
          {active && t.rep_level && (
            <RepLevelBadge
              level={t.rep_level}
              confirmed={levelConfirmed}
              onChange={onSetLevel}
              busy={saving}
            />
          )}
          {t.region ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
              📍 {t.region}
            </span>
          ) : (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
              📍 no region yet
            </span>
          )}
        </div>
        <div className="text-xs text-slate-500">
          {t.phone || '—'}
          {t.company_email ? (
            <>
              {' · '}
              <span className="text-emerald-700">{t.company_email}</span>
              <span className="ml-1 text-[10px] uppercase tracking-wide text-emerald-700">company</span>
            </>
          ) : t.email ? (
            <>
              {' · '}
              {t.email}
              <span className="ml-1 text-[10px] uppercase tracking-wide text-slate-400">personal</span>
            </>
          ) : null}
          {' · '}{classLabel}
        </div>
        {active && (
          <div className="text-[10px] text-slate-500">
            Active with us since:{' '}
            <EditableActiveSince
              value={t.became_active_rep_at}
              onSave={(iso) => onSetActiveSince && onSetActiveSince(iso)}
              busy={saving}
            />
            {' · '}
            <button
              type="button"
              onClick={onEditDirectory}
              className="underline decoration-dotted hover:decoration-solid"
              title="Edit which fields show in the shared /directory phone-book."
            >
              🔒 Directory: {directoryHiddenLabel(t.directory_hidden)}
            </button>
            {' · '}
            {t.info_updated_at ? (
              <span className="text-emerald-700">
                Info updated {formatRelativeDate(t.info_updated_at)}
              </span>
            ) : (
              <span className="text-amber-700">📋 Never updated their info</span>
            )}
          </div>
        )}
        {active && t.managed_region && (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="rounded-full bg-purple-100 px-2 py-0.5 font-semibold uppercase tracking-wide text-purple-900">
              👑 Regional manager · {t.managed_region}
            </span>
            {onCopyManagerLink && (
              <button
                type="button"
                onClick={onCopyManagerLink}
                disabled={saving}
                className="rounded-md border border-purple-300 bg-white px-2 py-0.5 font-semibold text-purple-800 hover:bg-purple-50 disabled:opacity-50"
                title="Copy this manager's dashboard URL. Paste it into a text to share."
              >
                📋 Copy access link
              </button>
            )}
            {onRevokeManager && (
              <button
                type="button"
                onClick={onRevokeManager}
                disabled={saving}
                className="rounded-md border border-slate-300 bg-white px-2 py-0.5 font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                title="Remove manager status and kill their access link."
              >
                Revoke
              </button>
            )}
          </div>
        )}
      </div>
      {active ? (
        <div className="flex flex-col items-end gap-1">
          {onEditInfo && (
            <button
              type="button"
              onClick={onEditInfo}
              disabled={saving}
              className="rounded-md border border-sky-300 bg-white px-3 py-1 text-xs font-semibold text-sky-800 hover:bg-sky-50 disabled:opacity-50"
              title="Edit name, phone, email, region, address — anything that came in wrong from /update-info."
            >
              ✏️ Edit info
            </button>
          )}
          {!t.managed_region && onAssignManager && (
            <button
              type="button"
              onClick={onAssignManager}
              disabled={saving}
              className="rounded-md border border-purple-300 bg-white px-3 py-1 text-xs font-semibold text-purple-800 hover:bg-purple-50 disabled:opacity-50"
              title="Make this rep the regional manager for a region. They get a private dashboard URL where they can see their team, deactivate someone, and SMS/email the whole region."
            >
              👑 Make regional manager
            </button>
          )}
          <button
            type="button"
            onClick={onMarkLeaving}
            disabled={saving}
            className="rounded-md border border-amber-300 bg-white px-3 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-50"
            title="Mark this person as no longer a sales rep. Adds them to the Cleanup pending list so admin can deactivate them in GHL / RepCard / etc."
          >
            {saving ? '…' : 'Mark as departed →'}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onPromote}
          disabled={saving}
          className="rounded-md bg-emerald-700 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {saving ? '…' : 'Add as active rep'}
        </button>
      )}
    </li>
  )
}

// Rep level badge with an inline native <select> for changing. Three
// options: Junior, Senior, Non-field. Saving fires on change. Unconfirmed
// levels show an "(auto)" tag so admin spots that they should still be
// confirmed via the "Rep levels to confirm" section.
function RepLevelBadge({ level, confirmed, onChange, busy }) {
  const label = LEVEL_LABEL[level] || level
  const cls =
    level === 'junior'
      ? 'bg-emerald-100 text-emerald-800'
      : level === 'senior'
        ? 'bg-violet-100 text-violet-800'
        : 'bg-slate-200 text-slate-700'
  return (
    <span
      className={
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ' +
        cls
      }
      title={confirmed ? `Confirmed ${label}` : `Auto-assigned ${label} — not yet confirmed`}
    >
      🎖 {label}
      {!confirmed && <span className="opacity-70">(auto)</span>}
      {onChange && (
        <select
          value={level}
          onChange={(e) => {
            const next = e.target.value
            if (next === level) return
            if (busy) return
            if (confirm(`Change ${label} → ${LEVEL_LABEL[next]}?`)) onChange(next)
          }}
          disabled={busy}
          className="ml-1 bg-transparent text-[10px] font-normal normal-case underline opacity-70 hover:opacity-100 disabled:opacity-40"
          aria-label="Change rep level"
          title="Change level"
        >
          <option value="junior">Junior</option>
          <option value="senior">Senior</option>
          <option value="non_field">Non-field</option>
        </select>
      )}
    </span>
  )
}

// Row in the "Cleanup pending" section. Surfaces the rep's contact info,
// reason for leaving, plus a checklist of the external systems they
// need to be deactivated in. The "✓ All cleanup done" button is the
// finish line — once clicked, they disappear from this list.
function CleanupRow({ t, saving, onDone, onUndo }) {
  const stamp = t.left_company_at ? new Date(t.left_company_at).toLocaleDateString() : '?'
  return (
    <li className="rounded-md border border-amber-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-slate-900">
            {t.first_name} {t.last_name}
            {t.region && (
              <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
                📍 {t.region}
              </span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-slate-600">
            {t.phone || '—'}
            {t.company_email && (
              <> · <span className="text-emerald-700">{t.company_email}</span></>
            )}
            {!t.company_email && t.email && <> · {t.email}</>}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            Flagged {stamp}
            {t.left_company_reason ? <> · Reason: <em>{t.left_company_reason}</em></> : <> · No reason given</>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onUndo}
            disabled={saving}
            className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            title="Restore them to the active rep list — clears the 'left the company' flag."
          >
            Undo (still active)
          </button>
          <button
            type="button"
            onClick={onDone}
            disabled={saving}
            className="rounded-md bg-amber-700 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
          >
            {saving ? '…' : '✓ All cleanup done'}
          </button>
        </div>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-semibold text-amber-800">
          Systems to deactivate (click to expand)
        </summary>
        <ul className="mt-1 space-y-0.5 text-xs text-slate-700">
          <li>☐ <strong>GoHighLevel</strong> — open contact, tag as inactive or delete</li>
          <li>☐ <strong>Google Workspace</strong> — suspend or delete <code>{t.company_email || '(no @shingleusa.com email)'}</code></li>
          <li>☐ <strong>RepCard</strong> — remove user</li>
          <li>☐ <strong>JobNimbus</strong> — deactivate user</li>
          <li>☐ <strong>Sales Academy</strong> — remove user</li>
        </ul>
        <p className="mt-1 text-[11px] italic text-slate-500">
          These are reminders — the system doesn't reach into those tools automatically. Walk
          through each, then click "✓ All cleanup done" to clear from this list.
        </p>
      </details>
    </li>
  )
}

// Click-to-edit "Active since" date — HR's real start-with-company
// date. Click the date to open a native date picker; saves on change.
// Stores as noon-UTC of the chosen day so the displayed date is the
// same regardless of viewer timezone.
function EditableActiveSince({ value, onSave, busy }) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <input
        type="date"
        defaultValue={isoToDateInput(value)}
        autoFocus
        disabled={busy}
        onBlur={() => setEditing(false)}
        onChange={(e) => {
          const v = e.target.value
          setEditing(false)
          if (!v) return
          const newIso = `${v}T12:00:00Z`
          if (newIso === value) return
          onSave(newIso)
        }}
        className="rounded border border-slate-300 px-1 text-[11px]"
      />
    )
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      disabled={busy}
      className="underline decoration-dotted hover:decoration-solid disabled:opacity-50"
      title="Click to edit the real 'active with us since' date — HR uses this for company tenure."
    >
      {value ? fmtDateString(value) : 'set date'}
    </button>
  )
}

// Click-to-edit company number (employee ID / badge / work extension —
// free text). Saves on blur or Enter; empty string clears the field.
function EditableCompanyNumber({ value, onSave, busy }) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <input
        type="text"
        defaultValue={value || ''}
        autoFocus
        disabled={busy}
        onBlur={(e) => {
          setEditing(false)
          onSave(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            setEditing(false)
            onSave(e.currentTarget.value)
          } else if (e.key === 'Escape') {
            setEditing(false)
          }
        }}
        placeholder="e.g. 1042"
        className="w-24 rounded border border-slate-300 px-1 text-[11px]"
      />
    )
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      disabled={busy}
      className="underline decoration-dotted hover:decoration-solid disabled:opacity-50"
      title="Click to edit company number (employee ID / badge / extension)."
    >
      {value || 'set'}
    </button>
  )
}

// ISO timestamp → 'YYYY-MM-DD' string for an <input type="date">.
// Slices directly off the ISO string to avoid timezone shifts that
// `new Date(iso).toISOString().slice(0, 10)` would introduce for any
// stamp near midnight.
function isoToDateInput(iso) {
  if (!iso) return ''
  const s = String(iso)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return ''
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

// One-line history label for a rep — used in the "to confirm" list so
// admin can see why the system guessed Junior vs Senior. For graduates
// it's the training week they came through; for bulk imports it's the
// import (attendance-only) meeting date; otherwise just "active since".
function repHistoryLabel(t) {
  const c = t.classes
  if (c?.attendance_only && c?.week_start_date) {
    return `Bulk-imported via meeting on ${fmtDateString(c.week_start_date)}`
  }
  if (c?.week_end_date && !c?.attendance_only) {
    return `Graduated training week of ${fmtDateString(c.week_end_date)}`
  }
  if (t.became_active_rep_at) {
    return `Active since ${fmtDateString(t.became_active_rep_at)}`
  }
  return ''
}

// Parse a 'YYYY-MM-DD' date string (or full ISO) as a local-midnight
// Date and return a short locale date. Component-wise to avoid the
// `new Date('2026-05-15')` UTC parsing trap.
function fmtDateString(s) {
  if (!s) return ''
  const parts = String(s).slice(0, 10).split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString()
  }
  return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString()
}

// Renders "5 days ago" / "today" / "yesterday" / "Jan 12, 2026" for a
// timestamp. Keeps the active-rep row compact but still gives admin a
// quick read on how fresh the data is.
function formatRelativeDate(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const diffMs = now - d
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (days < 0) return d.toLocaleDateString()
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  if (days < 60) return '~1 month ago'
  if (days < 365) return `~${Math.floor(days / 30)} months ago`
  return d.toLocaleDateString()
}

// Modal that opens when admin clicks "Re-send update-info request to N"
// on /active-reps. Picks SMS/Email channels, previews the seeded
// template wording, and fires the request to send-group-message with
// trainee_ids for the never-updated subset.
function ResendUpdateInfoModal({ batch, setBatch, onClose }) {
  const { traineeIds, channels, sending, result } = batch
  const wantSms = !!channels.sms
  const wantEmail = !!channels.email
  function toggle(key) {
    if (sending) return
    setBatch({ ...batch, channels: { ...channels, [key]: !channels[key] } })
  }
  async function fire() {
    if (!wantSms && !wantEmail) return
    setBatch({ ...batch, sending: true, result: null })
    // The function accepts template keys so we don't have to hard-code
    // the body here — admin can edit the wording on /message-templates
    // and the next blast picks up the change.
    const payload = {
      scope: 'all_active_reps', // overridden by trainee_ids — value just satisfies validation
      trainee_ids: traineeIds,
      channels: { sms: wantSms, email: wantEmail },
      ...(wantSms ? { sms_template_key: 'update_info_request_sms' } : {}),
      ...(wantEmail ? { email_template_key: 'update_info_request_email' } : {}),
    }
    try {
      const res = await fetch('/.netlify/functions/send-group-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setBatch({ ...batch, sending: false, result: { kind: 'error', text: body.error || `HTTP ${res.status}` } })
      } else {
        setBatch({
          ...batch,
          sending: false,
          result: {
            kind: 'success',
            counts: body.counts,
            failures: body.failures || [],
          },
        })
      }
    } catch (err) {
      setBatch({ ...batch, sending: false, result: { kind: 'error', text: err.message } })
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-slate-900">
          Re-send update-info request to {traineeIds.length} rep{traineeIds.length === 1 ? '' : 's'}
        </h3>
        <p className="mt-2 text-sm text-slate-600">
          Uses the saved templates from <code>/message-templates</code> (keys:{' '}
          <code>update_info_request_sms</code> /{' '}
          <code>update_info_request_email</code>). Personalized per recipient
          with their first name + private <code>/update-info</code> link.
        </p>
        <div className="mt-4 flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={wantSms}
              onChange={() => toggle('sms')}
              disabled={sending || !!result}
            />
            📱 SMS
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={wantEmail}
              onChange={() => toggle('email')}
              disabled={sending || !!result}
            />
            ✉️ Email
          </label>
        </div>
        {result && (
          <div
            className={
              'mt-3 rounded-md border p-2 text-xs ' +
              (result.kind === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-red-200 bg-red-50 text-red-800')
            }
          >
            {result.kind === 'success' ? (
              <>
                ✓ Done.
                <ul className="mt-1 space-y-0.5">
                  {wantSms && (
                    <li>📱 SMS sent: <strong>{result.counts?.sms_sent ?? 0}</strong>{result.counts?.sms_failed ? ` · ${result.counts.sms_failed} failed` : ''}</li>
                  )}
                  {wantEmail && (
                    <li>✉️ Email sent: <strong>{result.counts?.email_sent ?? 0}</strong>{result.counts?.email_failed ? ` · ${result.counts.email_failed} failed` : ''}</li>
                  )}
                </ul>
              </>
            ) : (
              <>✗ {result.text}</>
            )}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {result?.kind === 'success' ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button
              type="button"
              onClick={fire}
              disabled={sending || (!wantSms && !wantEmail)}
              className="rounded-md bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
            >
              {sending ? 'Sending…' : `Send to ${traineeIds.length}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// Modal that opens when admin clicks "No longer a sales rep" on an
// active rep. Optional reason field — typed text becomes
// left_company_reason on the trainees row (handy for HR audit later).

function EditRepModal({ trainee, draft, setDraft, regionNames, sending, onCancel, onConfirm }) {
  function set(field, value) {
    setDraft({ ...draft, [field]: value })
  }
  // Disable Save while there's nothing to save (empty or unchanged
  // drafts shouldn't fire a no-op update with a flash). Compare each
  // editable field normalized so trailing whitespace doesn't trigger
  // a "dirty" check on its own.
  const dirty = EDITABLE_FIELDS.some(
    (k) => String(draft[k] ?? '').trim() !== String(trainee[k] ?? '').trim(),
  )
  const canSave = dirty && !sending && draft.first_name?.trim() && draft.last_name?.trim()
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-xl rounded-lg border border-sky-200 bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-sky-900">
          ✏️ Edit info — {trainee.first_name} {trainee.last_name}
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          Fix anything that came in wrong on <code>/update-info</code> — name typos, wrong region,
          new phone, address fixes. Saves straight to the trainee record.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="First name" required>
            <input
              type="text"
              value={draft.first_name || ''}
              onChange={(e) => set('first_name', e.target.value)}
              disabled={sending}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Last name" required>
            <input
              type="text"
              value={draft.last_name || ''}
              onChange={(e) => set('last_name', e.target.value)}
              disabled={sending}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Phone">
            <input
              type="tel"
              value={draft.phone || ''}
              onChange={(e) => set('phone', e.target.value)}
              disabled={sending}
              placeholder="813-555-0100"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Region">
            <select
              value={draft.region || ''}
              onChange={(e) => set('region', e.target.value)}
              disabled={sending}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">— No region —</option>
              {regionNames.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Personal email">
            <input
              type="email"
              value={draft.email || ''}
              onChange={(e) => set('email', e.target.value)}
              disabled={sending}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Company email">
            <input
              type="email"
              value={draft.company_email || ''}
              onChange={(e) => set('company_email', e.target.value)}
              disabled={sending}
              placeholder="rep@shingleusa.com"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Company number">
            <input
              type="text"
              value={draft.company_number || ''}
              onChange={(e) => set('company_number', e.target.value)}
              disabled={sending}
              placeholder="e.g. 105"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Street address" span2>
            <input
              type="text"
              value={draft.street_address || ''}
              onChange={(e) => set('street_address', e.target.value)}
              disabled={sending}
              placeholder="123 Main St"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="City">
            <input
              type="text"
              value={draft.city || ''}
              onChange={(e) => set('city', e.target.value)}
              disabled={sending}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="State">
              <input
                type="text"
                value={draft.state || ''}
                onChange={(e) => set('state', e.target.value)}
                disabled={sending}
                placeholder="FL"
                maxLength={2}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm uppercase"
              />
            </Field>
            <Field label="Zip">
              <input
                type="text"
                value={draft.zip || ''}
                onChange={(e) => set('zip', e.target.value)}
                disabled={sending}
                placeholder="33602"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </Field>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={sending}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canSave}
            className="rounded-md bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-50"
          >
            {sending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Tiny label-wrapping helper so the EditRepModal grid stays readable
// without a 'label > span > input' tree on every field. span2 makes the
// field stretch full-width inside the 2-column parent grid.
function Field({ label, required, span2, children }) {
  return (
    <label className={`block ${span2 ? 'sm:col-span-2' : ''}`}>
      <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
        {required && <span className="ml-1 text-red-600">*</span>}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

function AssignManagerModal({ trainee, region, setRegion, regionNames, sending, onCancel, onConfirm }) {
  // Region picker defaults to the rep's own region — most common case
  // is "this senior rep already lives in Miami, make him the Miami
  // manager" so we pre-fill and let admin override.
  const canSubmit = !!region && !sending
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border border-purple-200 bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-purple-900">
          👑 Make {trainee.first_name} {trainee.last_name} a regional manager?
        </h3>
        <p className="mt-2 text-sm text-slate-600">
          They'll get a private dashboard URL where they can see every active rep in their
          region, mark someone as departed, and SMS / email the whole team. That's
          <em> all </em> they'll see — no admin chrome, no other regions.
        </p>
        <label className="mt-4 block">
          <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Region they'll manage
          </span>
          <select
            value={region || ''}
            onChange={(e) => setRegion(e.target.value)}
            disabled={sending}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">— Pick a region —</option>
            {regionNames.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-slate-500">
            One region per manager. To change later, just reassign here.
          </span>
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={sending}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canSubmit}
            className="rounded-md bg-purple-700 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-800 disabled:opacity-50"
          >
            {sending ? 'Saving…' : 'Yes, make them a manager'}
          </button>
        </div>
      </div>
    </div>
  )
}

function LeavingModal({ trainee, reason, setReason, sending, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-slate-900">
          Mark {trainee.first_name} {trainee.last_name} as no longer a sales rep?
        </h3>
        <p className="mt-2 text-sm text-slate-600">
          This will remove them from the active reps list (no more group broadcasts) and add
          them to the <strong>Cleanup pending</strong> section above, so you can deactivate
          their accounts in GoHighLevel, RepCard, JobNimbus, Sales Academy, and Google Workspace.
        </p>
        <label className="mt-4 block">
          <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Reason (optional)
          </span>
          <input
            type="text"
            value={reason || ''}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. quit, terminated, moved out of state…"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            disabled={sending}
          />
          <span className="mt-1 block text-xs text-slate-500">
            Free-text. Saved to the trainee record for HR audit later.
          </span>
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={sending}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={sending}
            className="rounded-md bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
          >
            {sending ? 'Saving…' : 'Yes, no longer a rep'}
          </button>
        </div>
      </div>
    </div>
  )
}
