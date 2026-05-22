import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useRegions } from '../lib/RegionsContext.jsx'
import {
  AddStaffModal,
  DirectoryVisibilityModal,
  directoryHiddenLabel,
} from '../components/DirectoryControls.jsx'

// Manage directory — focused admin panel for the shared /directory
// phone-book. Lets management add new people (non-trainee staff),
// remove anyone, and control which fields show publicly for each
// person. Distinct from /active-reps (which mixes training workflow
// with the rep roster); this page strips that out and focuses purely
// on directory membership and per-person privacy.

const LEVEL_LABEL = {
  junior: 'Junior',
  senior: 'Senior',
  non_field: 'Non-field',
}
const LEVEL_BADGE_CLS = {
  junior: 'bg-emerald-100 text-emerald-800',
  senior: 'bg-violet-100 text-violet-800',
  non_field: 'bg-slate-200 text-slate-700',
}

export default function DirectoryAdmin() {
  const { regionNames } = useRegions()
  const [people, setPeople] = useState([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)
  const [flash, setFlash] = useState(null)
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [visibilityModal, setVisibilityModal] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('trainees')
      .select(
        'id, first_name, last_name, phone, email, company_email, region, rep_level, rep_level_confirmed_at, company_number, directory_hidden, became_active_rep_at, is_active_sales_rep, class_id',
      )
      .eq('is_active_sales_rep', true)
      .order('last_name', { ascending: true })
      .order('first_name', { ascending: true })
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      setLoading(false)
      return
    }
    setPeople(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

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
      became_active_rep_at: new Date().toISOString(),
      enrolled: false,
      class_id: null,
      directory_hidden: payload.directory_hidden || {},
    }
    const { error } = await supabase.from('trainees').insert(row)
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      return false
    }
    setFlash({ kind: 'success', text: `Added ${row.first_name} ${row.last_name} to the directory.` })
    await load()
    return true
  }

  async function removePerson(person) {
    if (!confirm(
      `Remove ${person.first_name} ${person.last_name} from the directory?\n\n` +
      `They'll be marked as departed and disappear from the directory. ` +
      `You can restore them later from /active-reps if needed.`,
    )) return
    setSavingId(person.id)
    const { error } = await supabase
      .from('trainees')
      .update({
        is_active_sales_rep: false,
        left_company_at: new Date().toISOString(),
        left_company_reason: 'Removed from directory',
        cleanup_done_at: null,
      })
      .eq('id', person.id)
    setSavingId(null)
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      return
    }
    setFlash({ kind: 'success', text: `Removed ${person.first_name} ${person.last_name}.` })
    await load()
  }

  async function saveVisibility(person, hidden) {
    setSavingId(person.id)
    const { error } = await supabase
      .from('trainees')
      .update({ directory_hidden: hidden || {} })
      .eq('id', person.id)
    setSavingId(null)
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      return
    }
    setFlash({ kind: 'success', text: `Visibility updated for ${person.first_name} ${person.last_name}.` })
    setVisibilityModal(null)
    await load()
  }

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return people
    return people.filter((p) => {
      const hay = `${p.first_name || ''} ${p.last_name || ''} ${p.phone || ''} ${p.company_email || ''} ${p.company_number || ''} ${p.region || ''}`.toLowerCase()
      return hay.includes(s)
    })
  }, [people, search])

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Manage directory</h1>
          <p className="mt-2 text-slate-600">
            Add or remove people from the shared{' '}
            <a href="/directory" target="_blank" rel="noopener noreferrer" className="underline">
              team directory ↗
            </a>{' '}
            and control which fields show publicly for each person. Hidden fields are stripped
            server-side — they never reach the browser of anyone visiting <code>/directory</code>.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          + Add person
        </button>
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

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, phone, email, region, or company #…"
          className="w-full max-w-md rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <div className="text-xs text-slate-500">
          {loading ? 'Loading…' : `${filtered.length} of ${people.length} people`}
        </div>
      </div>

      <section className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Level</th>
              <th className="px-3 py-2 text-left">Phone</th>
              <th className="px-3 py-2 text-left">Company email</th>
              <th className="px-3 py-2 text-left">Region</th>
              <th className="px-3 py-2 text-left">Company #</th>
              <th className="px-3 py-2 text-left">Directory</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && !loading && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-sm text-slate-500">
                  {search ? 'No matches.' : 'Nobody in the directory yet — click + Add person.'}
                </td>
              </tr>
            )}
            {filtered.map((p) => {
              const hidden = p.directory_hidden || {}
              const isSaving = savingId === p.id
              return (
                <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 font-medium text-slate-900">
                    {p.first_name} {p.last_name}
                  </td>
                  <td className="px-3 py-2">
                    {p.rep_level ? (
                      <span
                        className={
                          'inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ' +
                          (LEVEL_BADGE_CLS[p.rep_level] || 'bg-slate-100 text-slate-700')
                        }
                      >
                        {LEVEL_LABEL[p.rep_level] || p.rep_level}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <FieldCell value={p.phone} hidden={hidden.phone} />
                  </td>
                  <td className="px-3 py-2">
                    <FieldCell value={p.company_email} hidden={hidden.email} />
                  </td>
                  <td className="px-3 py-2">
                    <FieldCell value={p.region} hidden={hidden.region} />
                  </td>
                  <td className="px-3 py-2">
                    <FieldCell value={p.company_number} hidden={hidden.company_number} />
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {directoryHiddenLabel(hidden)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setVisibilityModal({ trainee: p, hidden: { ...hidden } })}
                        disabled={isSaving}
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        title="Edit which fields appear in /directory for this person"
                      >
                        🔒 Visibility
                      </button>
                      <button
                        type="button"
                        onClick={() => removePerson(p)}
                        disabled={isSaving}
                        className="rounded-md border border-red-300 bg-white px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                        title="Remove from directory (marks as departed). Can be restored from /active-reps."
                      >
                        {isSaving ? '…' : 'Remove'}
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <p className="text-xs text-slate-400">
        Field reps usually get added automatically by going through training. This page is for
        manually managing the directory roster — usually staff who skipped the training flow.
        Need to manage field-rep workflow (pipeline, dropouts, cleanup pending){' '}
        <Link to="/active-reps" className="underline">use Active sales reps →</Link>.
      </p>

      {addOpen && (
        <AddStaffModal
          regionNames={regionNames}
          onCancel={() => setAddOpen(false)}
          onSave={async (payload) => {
            const ok = await addStaff(payload)
            if (ok) setAddOpen(false)
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
          onConfirm={() => saveVisibility(visibilityModal.trainee, visibilityModal.hidden)}
        />
      )}
    </div>
  )
}

// Cell renderer: shows the value with a visual cue when the field is
// hidden in the public /directory. Strikethrough + small lock icon so
// admin can see at a glance which fields are blocked from the
// phone-book without opening the visibility modal.
function FieldCell({ value, hidden }) {
  if (!value) return <span className="text-xs text-slate-400">—</span>
  if (hidden) {
    return (
      <span className="text-xs text-slate-400 line-through" title="Hidden in /directory">
        {value} 🔒
      </span>
    )
  }
  return <span className="text-xs text-slate-700">{value}</span>
}
