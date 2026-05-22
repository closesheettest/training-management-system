import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useRegions } from '../lib/RegionsContext.jsx'

// Display labels for rep_level values. Single source of truth so the
// "to confirm" buttons, badges, and dropdowns all read the same.
const LEVEL_LABEL = {
  junior: 'Junior',
  senior: 'Senior',
  non_field: 'Non-field',
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
  // Extra filter chip: when true, list shows only reps whose
  // info_updated_at is null (haven't self-served via /update-info yet).
  const [neverUpdatedOnly, setNeverUpdatedOnly] = useState(false)
  // Bulk re-send state for the "Re-send update-info request" button.
  // { traineeIds: [...], sending, result } while running.
  const [resendBatch, setResendBatch] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('trainees')
      .select('id, first_name, last_name, phone, email, company_email, region, is_active_sales_rep, became_active_rep_at, enrolled, declined_at, class_id, left_company_at, left_company_reason, cleanup_done_at, info_updated_at, registration_token, rep_level, rep_level_confirmed_at, classes!class_id(region, week_start_date, week_end_date, attendance_only)')
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
  const filterList = (list) => {
    return list.filter((t) => {
      // '__none' = "no region set yet" — useful for chasing bulk imports
      // who haven't filled in /update-info yet.
      if (regionFilter === '__none' && t.region) return false
      if (regionFilter && regionFilter !== '__none' && t.region !== regionFilter) return false
      if (neverUpdatedOnly && t.info_updated_at) return false
      if (!searchLower) return true
      const full = `${t.first_name || ''} ${t.last_name || ''}`.toLowerCase()
      return full.includes(searchLower) || (t.phone || '').includes(searchLower)
    })
  }
  // Active reps: group by info-update status (updated first, then
  // never-updated) so admin can scroll past the "done" pile and focus
  // on the stragglers. Each group stays alphabetical within itself.
  const activeFiltered = filterList(active).slice().sort((a, b) => {
    const aHas = !!a.info_updated_at
    const bHas = !!b.info_updated_at
    if (aHas !== bHas) return aHas ? -1 : 1
    return `${a.last_name || ''} ${a.first_name || ''}`.localeCompare(
      `${b.last_name || ''} ${b.first_name || ''}`,
    )
  })
  const notYetActiveFiltered = filterList(notYetActive)
  const dropoutsFiltered = filterList(dropouts)
  const nonFieldFiltered = filterList(nonField)

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
              return (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm"
                >
                  <span className="min-w-0">
                    <strong>{t.first_name} {t.last_name}</strong>{' '}
                    <span className="text-slate-500">{t.phone || ''}</span>
                    <span className="ml-2 text-xs text-slate-600">
                      Auto-guess: <strong>{LEVEL_LABEL[guess]}</strong>
                    </span>
                  </span>
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

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm space-y-3">
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
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or phone…"
          className="w-full max-w-xs rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <div className="text-sm text-slate-600">
          <strong className="text-emerald-700">{active.length}</strong> active field ·{' '}
          <strong className="text-slate-500">{nonField.length}</strong> non-field ·{' '}
          <strong className="text-slate-500">{notYetActive.length}</strong> not yet active ·{' '}
          <strong className="text-slate-500">{dropouts.length}</strong> dropouts
          {(regionFilter || neverUpdatedOnly || search) && (
            <span className="ml-2 text-xs text-amber-700">
              ⚠ filters active — counts below reflect filters, totals above are unfiltered
            </span>
          )}
        </div>
      </div>

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
          <ul className="mt-3 divide-y divide-slate-100">
            {activeFiltered.map((t) => (
              <RepRow
                key={t.id}
                t={t}
                active
                saving={savingId === t.id}
                onMarkLeaving={() => setLeavingModal({ trainee: t, reason: '' })}
                onPromote={() => toggle(t, true)}
                onSetLevel={(lvl) => setRepLevel(t, lvl)}
              />
            ))}
          </ul>
        )}
      </section>

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
    </div>
  )
}

function RepRow({ t, active, saving, onMarkLeaving, onPromote, onSetLevel }) {
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
        {active && t.became_active_rep_at && (
          <div className="text-[10px] text-slate-400">
            Active since {new Date(t.became_active_rep_at).toLocaleDateString()}
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
      </div>
      {active ? (
        <button
          type="button"
          onClick={onMarkLeaving}
          disabled={saving}
          className="rounded-md border border-amber-300 bg-white px-3 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-50"
          title="Mark this person as no longer a sales rep. Adds them to the Cleanup pending list so admin can deactivate them in GHL / RepCard / etc."
        >
          {saving ? '…' : 'Mark as departed →'}
        </button>
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
