import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'

// Offboarding Reps — the dedicated home for cleaning up a rep who left the
// company. A rep is flagged "no longer a sales rep" on Active sales reps
// (sets left_company_at + fires notify-offboarding). They land here until
// every external system is deactivated.
//
// Each system is a checkbox saved per rep (trainees.cleanup_systems jsonb).
// When ALL boxes are checked, the rep auto-completes (cleanup_done_at gets
// stamped) and drops to the "cleanup done" history below.

const SYSTEMS = [
  { name: 'GoHighLevel', note: 'open contact, tag as inactive or delete' },
  { name: 'Google Workspace', note: 'suspend or delete their @shingleusa.com email' },
  { name: 'RepCard', note: 'remove user' },
  { name: 'JobNimbus', note: 'deactivate user' },
  { name: 'Sales Academy', note: 'remove user' },
  { name: 'RoofR', note: 'remove user' },
]
const SYSTEM_NAMES = SYSTEMS.map((s) => s.name)
const allChecked = (sys) => SYSTEM_NAMES.every((n) => sys && sys[n])

export default function OffboardingReps() {
  const [pending, setPending] = useState(null) // left, cleanup not done
  const [done, setDone] = useState([])         // left, cleanup done (recent)
  const [savingId, setSavingId] = useState(null)
  const [flash, setFlash] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setError(null)
    const { data, error } = await supabase
      .from('trainees')
      .select('id, first_name, last_name, phone, email, company_email, region, left_company_at, left_company_reason, cleanup_done_at, cleanup_systems, is_active_sales_rep')
      .not('left_company_at', 'is', null)
      .order('left_company_at', { ascending: false })
    if (error) { setError(error.message); setPending([]); return }
    const rows = (data || []).filter((t) => !t.is_active_sales_rep)
    setPending(rows.filter((t) => !t.cleanup_done_at))
    setDone(rows.filter((t) => t.cleanup_done_at).slice(0, 50))
  }

  // Toggle one system checkbox. If that flips the LAST box on, the rep
  // auto-completes (cleanup_done_at stamped) and moves to the done list.
  async function toggleSystem(t, name) {
    const cur = t.cleanup_systems || {}
    const next = { ...cur, [name]: !cur[name] }
    const patch = { cleanup_systems: next }
    const justFinished = allChecked(next)
    if (justFinished) patch.cleanup_done_at = new Date().toISOString()
    setSavingId(t.id)
    const { error } = await supabase.from('trainees').update(patch).eq('id', t.id)
    setSavingId(null)
    if (error) { setFlash({ kind: 'error', text: error.message }); return }
    if (justFinished) setFlash({ kind: 'success', text: `All systems cleared for ${t.first_name} ${t.last_name} — cleanup done.` })
    await load()
  }

  // Shortcut: check everything + complete in one tap.
  async function markAllDone(t) {
    const all = {}
    SYSTEM_NAMES.forEach((n) => { all[n] = true })
    setSavingId(t.id)
    const { error } = await supabase.from('trainees').update({ cleanup_systems: all, cleanup_done_at: new Date().toISOString() }).eq('id', t.id)
    setSavingId(null)
    if (error) { setFlash({ kind: 'error', text: error.message }); return }
    setFlash({ kind: 'success', text: `Cleanup marked done for ${t.first_name} ${t.last_name}.` })
    await load()
  }

  // Re-open: back to pending with a fresh (empty) checklist.
  async function reopenCleanup(t) {
    setSavingId(t.id)
    const { error } = await supabase.from('trainees').update({ cleanup_done_at: null, cleanup_systems: {} }).eq('id', t.id)
    setSavingId(null)
    if (error) { setFlash({ kind: 'error', text: error.message }); return }
    setFlash({ kind: 'success', text: `Re-opened cleanup for ${t.first_name} ${t.last_name}.` })
    await load()
  }

  async function restoreActive(t) {
    if (!window.confirm(`Restore ${t.first_name} ${t.last_name} to active reps? This clears the "left the company" flag.`)) return
    setSavingId(t.id)
    const { error } = await supabase
      .from('trainees')
      .update({ is_active_sales_rep: true, became_active_rep_at: new Date().toISOString(), left_company_at: null, left_company_reason: null, cleanup_done_at: null, cleanup_systems: {} })
      .eq('id', t.id)
    setSavingId(null)
    if (error) { setFlash({ kind: 'error', text: error.message }); return }
    setFlash({ kind: 'success', text: `${t.first_name} ${t.last_name} restored to active reps.` })
    await load()
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-brand-navy">Offboarding Reps</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          When a rep leaves, flag them on{' '}
          <Link to="/active-reps" className="font-semibold text-brand-navy underline">Active sales reps</Link>{' '}
          → they show up here. Check off each system as you deactivate their account; when all{' '}
          {SYSTEM_NAMES.length} are checked, they move to <strong>done</strong> automatically.
        </p>
      </header>

      {flash && (
        <div className={`mb-4 rounded-md px-3 py-2 text-sm ${flash.kind === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
          {flash.text}
        </div>
      )}
      {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <section className="rounded-lg border-2 border-amber-300 bg-amber-50 p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-amber-900">
          🚪 Cleanup pending {pending ? `(${pending.length})` : ''}
        </h2>
        {pending === null ? (
          <p className="mt-2 text-sm text-amber-900/70">Loading…</p>
        ) : pending.length === 0 ? (
          <p className="mt-2 text-sm text-amber-900">✅ All caught up — no reps awaiting cleanup.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {pending.map((t) => (
              <CleanupCard key={t.id} t={t} saving={savingId === t.id}
                onToggle={(name) => toggleSystem(t, name)}
                onAllDone={() => markAllDone(t)}
                onRestore={() => restoreActive(t)} />
            ))}
          </ul>
        )}
      </section>

      {done.length > 0 && (
        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Recently offboarded — cleanup done ({done.length})
          </h2>
          <ul className="mt-3 divide-y divide-slate-100">
            {done.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-semibold text-slate-800">{t.first_name} {t.last_name}</span>
                  {t.region && <span className="ml-2 text-xs text-slate-500">📍 {t.region}</span>}
                  <span className="ml-2 text-xs text-slate-400">
                    left {t.left_company_at ? new Date(t.left_company_at).toLocaleDateString() : '—'}
                    {' · '}cleaned {t.cleanup_done_at ? new Date(t.cleanup_done_at).toLocaleDateString() : '—'}
                  </span>
                </span>
                <button type="button" onClick={() => reopenCleanup(t)} disabled={savingId === t.id}
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                  Re-open cleanup
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function CleanupCard({ t, saving, onToggle, onAllDone, onRestore }) {
  const sys = t.cleanup_systems || {}
  const doneCount = SYSTEM_NAMES.filter((n) => sys[n]).length
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
            {t.company_email ? <> · <span className="text-emerald-700">{t.company_email}</span></> : (t.email ? <> · {t.email}</> : null)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            Flagged {stamp}
            {t.left_company_reason ? <> · Reason: <em>{t.left_company_reason}</em></> : <> · No reason given</>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onRestore} disabled={saving}
            className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            title="Restore them to active reps — clears the 'left the company' flag.">
            Undo (still active)
          </button>
          <button type="button" onClick={onAllDone} disabled={saving}
            className="rounded-md bg-amber-700 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
            title="Check every system and mark cleanup done in one tap.">
            {saving ? '…' : '✓ Mark all done'}
          </button>
        </div>
      </div>

      <div className="mt-3 rounded-md bg-slate-50 p-2">
        <div className="mb-1 flex items-center justify-between text-xs font-semibold text-amber-800">
          <span>Systems to deactivate</span>
          <span className="text-slate-500">{doneCount}/{SYSTEM_NAMES.length} done</span>
        </div>
        <ul className="space-y-1">
          {SYSTEMS.map((s) => (
            <li key={s.name}>
              <label className="flex cursor-pointer items-start gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-amber-700"
                  checked={!!sys[s.name]}
                  disabled={saving}
                  onChange={() => onToggle(s.name)}
                />
                <span>
                  <strong>{s.name}</strong> —{' '}
                  {s.name === 'Google Workspace'
                    ? <>suspend or delete <code>{t.company_email || '(no @shingleusa.com email)'}</code></>
                    : s.note}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-[11px] italic text-slate-500">
          Check each as you deactivate it — the last check completes cleanup automatically.
        </p>
      </div>
    </li>
  )
}
