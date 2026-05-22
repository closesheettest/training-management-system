import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useRegions } from '../lib/RegionsContext.jsx'
import {
  AddStaffModal,
  DirectoryVisibilityModal,
  directoryHiddenLabel,
  normalizeDepartments,
  notesFromDb,
  notesForDb,
  NoteEditor,
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
  const [editPerson, setEditPerson] = useState(null)
  const [visibilityModal, setVisibilityModal] = useState(null)
  // { trainee, draft } while a note is being edited.
  const [noteModal, setNoteModal] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('trainees')
      .select(
        'id, first_name, last_name, phone, company_phone, email, company_email, region, departments, rep_level, rep_level_confirmed_at, company_number, birthday, directory_hidden, directory_note, became_active_rep_at, is_active_sales_rep, class_id',
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
      company_phone: payload.company_phone?.trim() || null,
      company_email: payload.company_email?.trim() || null,
      email: null,
      region: payload.region || null,
      departments: Array.isArray(payload.departments) ? payload.departments : normalizeDepartments(payload.departments),
      rep_level: payload.rep_level || 'non_field',
      rep_level_confirmed_at: new Date().toISOString(),
      birthday: payload.birthday || null,
      is_active_sales_rep: true,
      became_active_rep_at: new Date().toISOString(),
      enrolled: false,
      class_id: null,
      directory_hidden: payload.directory_hidden || {},
      directory_note: notesForDb(payload.directory_note),
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

  // Update an existing person from the edit modal — same payload shape
  // as addStaff, just routes to UPDATE instead of INSERT and uses the
  // existing id. Returns true on success so the modal can close itself.
  async function updatePerson(person, payload) {
    const row = {
      first_name: payload.first_name.trim(),
      last_name: payload.last_name.trim(),
      phone: payload.phone?.trim() || null,
      company_phone: payload.company_phone?.trim() || null,
      company_email: payload.company_email?.trim() || null,
      region: payload.region || null,
      departments: Array.isArray(payload.departments) ? payload.departments : normalizeDepartments(payload.departments),
      rep_level: payload.rep_level || 'non_field',
      birthday: payload.birthday || null,
      directory_hidden: payload.directory_hidden || {},
      directory_note: notesForDb(payload.directory_note),
    }
    setSavingId(person.id)
    const { error } = await supabase.from('trainees').update(row).eq('id', person.id)
    setSavingId(null)
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      return false
    }
    setFlash({ kind: 'success', text: `Updated ${row.first_name} ${row.last_name}.` })
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

  async function setDepartments(person, value) {
    const next = normalizeDepartments(value)
    const current = Array.isArray(person.departments) ? person.departments : []
    if (sameArray(current, next)) return
    setSavingId(person.id)
    const { error } = await supabase
      .from('trainees')
      .update({ departments: next.length ? next : null })
      .eq('id', person.id)
    setSavingId(null)
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      return
    }
    setFlash({ kind: 'success', text: `Departments updated for ${person.first_name} ${person.last_name}.` })
    await load()
  }

  async function setCompanyPhone(person, value) {
    const next = value.trim() || null
    if ((person.company_phone || null) === next) return
    setSavingId(person.id)
    const { error } = await supabase
      .from('trainees')
      .update({ company_phone: next })
      .eq('id', person.id)
    setSavingId(null)
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      return
    }
    setFlash({ kind: 'success', text: `Work phone updated for ${person.first_name} ${person.last_name}.` })
    await load()
  }

  async function saveNote(person, notes) {
    const next = notesForDb(notes)
    setSavingId(person.id)
    const { error } = await supabase
      .from('trainees')
      .update({ directory_note: next })
      .eq('id', person.id)
    setSavingId(null)
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      return
    }
    setFlash({
      kind: 'success',
      text: next ? `Note updated for ${person.first_name} ${person.last_name}.` : `Note cleared for ${person.first_name} ${person.last_name}.`,
    })
    setNoteModal(null)
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

  const existingDepartments = useMemo(() => {
    const set = new Set()
    for (const p of people) {
      const list = Array.isArray(p.departments) ? p.departments : []
      for (const d of list) if (d) set.add(d)
    }
    return Array.from(set).sort()
  }, [people])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return people
    return people.filter((p) => {
      const deptText = Array.isArray(p.departments) ? p.departments.join(' ') : ''
      const hay = `${p.first_name || ''} ${p.last_name || ''} ${p.phone || ''} ${p.company_phone || ''} ${p.company_email || ''} ${p.region || ''} ${deptText} ${formatBirthday(p.birthday) || ''}`.toLowerCase()
      return hay.includes(s)
    })
  }, [people, search])

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Manage directory</h1>
          <p className="mt-2 text-slate-600">
            Click any name (or the ✏ Edit button) to open the full edit form. Add or remove people from the shared{' '}
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
          placeholder="Search by name, phone, email, territory, department, or birthday…"
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
              <th className="px-3 py-2 text-left">Personal phone</th>
              <th className="px-3 py-2 text-left">Work phone</th>
              <th className="px-3 py-2 text-left">Company email</th>
              <th className="px-3 py-2 text-left">Territory</th>
              <th className="px-3 py-2 text-left">Department</th>
              <th className="px-3 py-2 text-left">Birthday</th>
              <th className="px-3 py-2 text-left">Directory</th>
              <th className="px-3 py-2 text-left">Note</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && !loading && (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center text-sm text-slate-500">
                  {search ? 'No matches.' : 'Nobody in the directory yet — click + Add person.'}
                </td>
              </tr>
            )}
            {filtered.map((p) => {
              const hidden = p.directory_hidden || {}
              const isSaving = savingId === p.id
              return (
                <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 font-medium">
                    <button
                      type="button"
                      onClick={() => setEditPerson(p)}
                      disabled={isSaving}
                      className="text-left text-slate-900 underline decoration-dotted hover:decoration-solid disabled:opacity-50"
                      title="Open the full edit form for this person."
                    >
                      {p.first_name} {p.last_name}
                    </button>
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
                    <div className="flex items-center gap-1.5">
                      <FieldCell value={p.phone} hidden={hidden.phone} />
                      <PhoneActions number={p.phone} />
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <EditableTextCell
                        value={p.company_phone}
                        hidden={hidden.company_phone}
                        placeholder="(555) 987-6543"
                        onSave={(v) => setCompanyPhone(p, v)}
                        busy={isSaving}
                      />
                      <PhoneActions number={p.company_phone} />
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <FieldCell value={p.company_email} hidden={hidden.email} />
                      {p.company_email && (
                        <a
                          href={`mailto:${p.company_email}`}
                          className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs hover:bg-slate-50"
                          title="Send email"
                          aria-label={`Email ${p.first_name} ${p.last_name}`}
                        >
                          📧
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <FieldCell value={p.region} hidden={hidden.region} />
                  </td>
                  <td className="px-3 py-2">
                    <EditableTextCell
                      value={Array.isArray(p.departments) ? p.departments.join(', ') : ''}
                      hidden={hidden.department}
                      placeholder="e.g. Sales, HR"
                      onSave={(v) => setDepartments(p, v)}
                      busy={isSaving}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <FieldCell value={formatBirthday(p.birthday)} hidden={hidden.birthday} />
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {directoryHiddenLabel(hidden)}
                  </td>
                  <td className="px-3 py-2 max-w-xs">
                    <NotePreview notes={notesFromDb(p.directory_note)} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setEditPerson(p)}
                        disabled={isSaving}
                        className="rounded-md border border-brand-navy bg-white px-2 py-1 text-xs font-semibold text-brand-navy hover:bg-slate-50 disabled:opacity-50"
                        title="Edit name, contact info, level, department, visibility, and note all at once."
                      >
                        ✏ Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setNoteModal({ trainee: p, draft: notesFromDb(p.directory_note) })}
                        disabled={isSaving}
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        title='Edit the "how to reach me" note shown publicly on /directory.'
                      >
                        💡 Note
                      </button>
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
          existingDepartments={existingDepartments}
          onCancel={() => setAddOpen(false)}
          onSave={async (payload) => {
            const ok = await addStaff(payload)
            if (ok) setAddOpen(false)
          }}
        />
      )}

      {editPerson && (
        <AddStaffModal
          regionNames={regionNames}
          existingDepartments={existingDepartments}
          initial={editPerson}
          onCancel={() => setEditPerson(null)}
          onSave={async (payload) => {
            const ok = await updatePerson(editPerson, payload)
            if (ok) setEditPerson(null)
          }}
        />
      )}

      {noteModal && (
        <NoteModal
          trainee={noteModal.trainee}
          draft={noteModal.draft}
          setDraft={(v) => setNoteModal({ ...noteModal, draft: v })}
          sending={savingId === noteModal.trainee.id}
          onCancel={() => setNoteModal(null)}
          onSave={() => saveNote(noteModal.trainee, noteModal.draft)}
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

// Edit modal for the "how to reach me" notes shown on /directory. For
// people in multiple departments, NoteEditor renders one textarea per
// department plus a general fallback. For 0 or 1 departments, it
// collapses to a single textarea.
function NoteModal({ trainee, draft, setDraft, sending, onCancel, onSave }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-slate-900">
          How to reach me — {trainee.first_name} {trainee.last_name}
        </h3>
        <p className="mt-2 text-sm text-slate-600">
          Free-text guidance shown in 💡 callouts on this person's directory card. Tell people the
          right channel per topic so they don't have to guess.
        </p>
        <div className="mt-3">
          <NoteEditor
            departments={trainee.departments}
            notes={draft}
            setNotes={setDraft}
            disabled={sending}
          />
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          Empty boxes are skipped. Clear everything and save to remove all notes.
        </p>
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
            onClick={onSave}
            disabled={sending}
            className="rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {sending ? 'Saving…' : 'Save note'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Truncated preview for the Note column in the admin table. Shows the
// count when multiple notes exist; otherwise the first line of the
// single note. Always shows tooltip with the full set on hover.
function NotePreview({ notes }) {
  // Skip the legacy "_default" key — notes only render on /directory
  // when filtered by department, so a general fallback has no path to
  // display and shouldn't inflate the preview count either.
  const entries = Object.entries(notes || {}).filter(([k, v]) =>
    k !== '_default' && typeof v === 'string' && v.trim(),
  )
  if (entries.length === 0) return <span className="text-xs text-slate-400">—</span>
  const fullText = entries.map(([k, v]) => `[${k}] ${v}`).join('\n\n')
  if (entries.length === 1) {
    return (
      <span className="block truncate text-xs text-slate-700" title={fullText}>
        💡 [{entries[0][0]}] {entries[0][1]}
      </span>
    )
  }
  return (
    <span className="block truncate text-xs text-slate-700" title={fullText}>
      💡 {entries.length} notes ({entries.map(([k]) => k).join(', ')})
    </span>
  )
}

// Inline call + text icons next to a phone number in the admin table.
// Renders nothing when the number is empty. Tapping triggers the
// device's dialer (tel:) or messages app (sms:) — same pattern as the
// action pills on the public /directory page, just compact icons here
// to fit the table density.
function PhoneActions({ number }) {
  if (!number) return null
  return (
    <span className="flex shrink-0 items-center gap-1">
      <a
        href={`tel:${number}`}
        className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs hover:bg-slate-50"
        title={`Call ${number}`}
        aria-label={`Call ${number}`}
      >
        📞
      </a>
      <a
        href={`sms:${number}`}
        className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs hover:bg-slate-50"
        title={`Text ${number}`}
        aria-label={`Text ${number}`}
      >
        💬
      </a>
    </span>
  )
}

// Order-insensitive equality for string arrays. Used to skip a DB
// write when the normalized departments list didn't actually change.
function sameArray(a, b) {
  if (a === b) return true
  if (!Array.isArray(a) || !Array.isArray(b)) return false
  if (a.length !== b.length) return false
  const sa = [...a].sort()
  const sb = [...b].sort()
  return sa.every((v, i) => v === sb[i])
}

// Format the DB date string ('YYYY-MM-DD') for admin display — full
// date including year, parsed component-wise so the `new Date(s)` UTC
// parsing trap doesn't shift the day.
function formatBirthday(s) {
  if (!s) return ''
  const parts = String(s).slice(0, 10).split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return ''
  return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString()
}

// Inline click-to-edit text cell for fields that DirectoryAdmin owns
// (e.g. work phone). Click the value to swap to an input; saves on
// blur or Enter. Renders with the same struck-through / 🔒 lock cue
// as FieldCell when the field is currently hidden in /directory.
function EditableTextCell({ value, hidden, placeholder, onSave, busy }) {
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
        placeholder={placeholder}
        className="w-32 rounded border border-slate-300 px-1 text-xs"
      />
    )
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      disabled={busy}
      className={
        'text-xs underline decoration-dotted hover:decoration-solid disabled:opacity-50 ' +
        (hidden ? 'text-slate-400 line-through' : 'text-slate-700')
      }
      title={hidden ? 'Hidden in /directory · click to edit' : 'Click to edit'}
    >
      {value ? <>{value}{hidden && ' 🔒'}</> : 'set'}
    </button>
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
