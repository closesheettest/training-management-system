import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { FL_REGIONS } from '../lib/locations.js'

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
  const [active, setActive] = useState([])
  const [inactive, setInactive] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [regionFilter, setRegionFilter] = useState('')
  const [savingId, setSavingId] = useState(null)
  const [flash, setFlash] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('trainees')
      .select('id, first_name, last_name, phone, email, region, is_active_sales_rep, became_active_rep_at, enrolled, declined_at, class_id, classes(region, week_start_date, attendance_only)')
      .order('last_name', { ascending: true })
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      setLoading(false)
      return
    }
    const all = data || []
    setActive(all.filter((t) => t.is_active_sales_rep))
    // Inactive list excludes explicit declines + manual unenrollments
    // (those are "permanently gone" buckets, not "candidates to promote").
    setInactive(
      all.filter(
        (t) => !t.is_active_sales_rep && t.enrolled !== false && !t.declined_at,
      ),
    )
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function toggle(trainee, makeActive) {
    setSavingId(trainee.id)
    const update = makeActive
      ? { is_active_sales_rep: true, became_active_rep_at: new Date().toISOString() }
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

  const searchLower = search.trim().toLowerCase()
  const filterList = (list) => {
    return list.filter((t) => {
      // '__none' = "no region set yet" — useful for chasing bulk imports
      // who haven't filled in /update-info yet.
      if (regionFilter === '__none' && t.region) return false
      if (regionFilter && regionFilter !== '__none' && t.region !== regionFilter) return false
      if (!searchLower) return true
      const full = `${t.first_name || ''} ${t.last_name || ''}`.toLowerCase()
      return full.includes(searchLower) || (t.phone || '').includes(searchLower)
    })
  }
  const activeFiltered = filterList(active)
  const inactiveFiltered = filterList(inactive)

  // Per-region active-rep counts for the breakdown card.
  const activeByRegion = useMemo(() => {
    const counts = { __none: 0 }
    for (const r of FL_REGIONS) counts[r] = 0
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

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span className="font-semibold uppercase tracking-wide text-slate-500">Active by region:</span>
          {FL_REGIONS.map((r) => (
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or phone…"
          className="w-full max-w-xs rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <div className="text-sm text-slate-600">
          <strong className="text-emerald-700">{active.length}</strong> active ·{' '}
          <strong className="text-slate-500">{inactive.length}</strong> inactive
        </div>
      </div>

      <section className="rounded-lg border border-emerald-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-emerald-900">
          ⭐ Active sales reps ({activeFiltered.length})
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
                onToggle={() => toggle(t, false)}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">
          Other trainees (not yet active) ({inactiveFiltered.length})
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          People in the system who aren't on the active-rep list — typically current trainees who
          haven't taken their final test yet. Listed here so you can promote anyone manually if
          needed.
        </p>
        {loading ? (
          <p className="mt-3 text-sm text-slate-500">Loading…</p>
        ) : inactiveFiltered.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            {search ? 'No matches.' : 'Nobody pending.'}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {inactiveFiltered.map((t) => (
              <RepRow
                key={t.id}
                t={t}
                active={false}
                saving={savingId === t.id}
                onToggle={() => toggle(t, true)}
              />
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-slate-400">
        Want to send a message to this list? <Link to="/group-messages" className="underline">Open Group messages</Link>.
      </p>
    </div>
  )
}

function RepRow({ t, active, saving, onToggle }) {
  const classLabel = t.classes
    ? `${t.classes.region}${t.classes.attendance_only ? ' meeting' : ''} · ${t.classes.week_start_date || ''}`
    : '—'
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-slate-900">
            {t.first_name} {t.last_name}
          </span>
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
          {t.phone || '—'} {t.email ? <>· {t.email}</> : null} · {classLabel}
        </div>
        {active && t.became_active_rep_at && (
          <div className="text-[10px] text-slate-400">
            Active since {new Date(t.became_active_rep_at).toLocaleDateString()}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onToggle}
        disabled={saving}
        className={
          'rounded-md px-3 py-1 text-xs font-semibold disabled:opacity-50 ' +
          (active
            ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            : 'bg-emerald-700 text-white hover:bg-emerald-800')
        }
      >
        {saving ? '…' : active ? 'Remove from list' : 'Add as active rep'}
      </button>
    </li>
  )
}
