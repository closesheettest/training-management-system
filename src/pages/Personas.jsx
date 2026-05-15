import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { usePersona } from '../lib/PersonaContext.jsx'
import { PAGES, ROLES, ROLE_DEFAULTS, ALWAYS_VISIBLE } from '../lib/personas.js'

// Personas admin page — grid of role × page checkboxes. Pick which
// pages each role sees in their default nav after they sign in on the
// splash screen. Same UX as the events ↔ subscribers grid on
// /notifications, but for pages.
//
// Admin role uses the '*' wildcard so any new page added in a future
// release automatically appears for admins without a config update.

export default function Personas() {
  const { refreshVisibility } = usePersona()
  const [rows, setRows] = useState(null) // role_settings rows from DB
  const [drafts, setDrafts] = useState({}) // role → Set of visible keys
  const [saving, setSaving] = useState(null) // role currently saving
  const [flash, setFlash] = useState(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    const { data, error } = await supabase
      .from('role_settings')
      .select('*')
      .order('role', { ascending: true })
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      setRows([])
      return
    }
    setRows(data || [])
    const next = {}
    for (const r of data || []) {
      next[r.role] = new Set(r.visible_page_keys || [])
    }
    // Ensure every known role has a draft (so toggling works even if
    // the role wasn't in the seed for some reason).
    for (const { value } of ROLES) {
      if (!next[value]) {
        next[value] = new Set(ROLE_DEFAULTS[value] || [])
      }
    }
    setDrafts(next)
  }

  function toggle(role, key) {
    setDrafts((prev) => {
      const next = { ...prev }
      const set = new Set(next[role] || [])
      // Toggling the '*' wildcard: if it was on, replace with nothing;
      // if it was off, just set to '*' (clears explicit keys).
      if (key === '*') {
        if (set.has('*')) {
          set.delete('*')
        } else {
          set.clear()
          set.add('*')
        }
      } else {
        // Toggling a real key — drop the wildcard if it was there since
        // explicit keys + wildcard is redundant.
        set.delete('*')
        if (set.has(key)) set.delete(key)
        else set.add(key)
      }
      next[role] = set
      return next
    })
  }

  async function saveRole(role) {
    setSaving(role)
    setFlash(null)
    const keys = Array.from(drafts[role] || [])
    // Upsert: insert if missing, update if present.
    const { error } = await supabase
      .from('role_settings')
      .upsert(
        { role, visible_page_keys: keys, updated_at: new Date().toISOString() },
        { onConflict: 'role' },
      )
    setSaving(null)
    if (error) {
      setFlash({ kind: 'error', text: error.message })
      return
    }
    setFlash({ kind: 'success', text: `Saved visibility for ${labelOf(role)}.` })
    await load()
    // If the current logged-in persona matches this role, refresh their
    // visibility live so they don't have to switch out and back in.
    await refreshVisibility()
  }

  function resetRole(role) {
    const defaults = ROLE_DEFAULTS[role] || []
    setDrafts((prev) => ({ ...prev, [role]: new Set(defaults) }))
  }

  const initiallyByRole = useMemo(() => {
    const m = {}
    for (const r of rows || []) m[r.role] = new Set(r.visible_page_keys || [])
    return m
  }, [rows])

  if (rows === null) return <p className="text-sm text-slate-500">Loading…</p>

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Personas</h1>
        <p className="mt-2 text-slate-600">
          Pick which pages each role can access. Unchecked pages are hidden from the role's nav{' '}
          <strong>and</strong> blocked when navigated to directly — anyone who tries to open the
          URL lands on a "Not in your view" screen. Same flexibility as the notifications grid on{' '}
          <code className="rounded bg-slate-100 px-1 text-xs">/notifications</code> — toggle
          anything, save per role, changes are live.
        </p>
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <strong>This is role-based gating, not auth.</strong> Anyone can still click "Switch" in
          the nav badge and pick a different persona (e.g. Admin) to gain that role's access.
          There's no password. If you ever want a real PIN/login layer, that's a separate build —
          but for now this prevents the active persona from drifting into pages outside their job.
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Home is always visible to every role (so nobody lands on a blank screen). All other
          pages are toggleable — including this one, which by default is admin + HR only.
        </p>
      </header>

      {flash && (
        <div
          className={
            'rounded-md border p-3 text-sm ' +
            (flash.kind === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-800')
          }
        >
          {flash.text}
        </div>
      )}

      <ul className="space-y-4">
        {ROLES.map(({ value: role, label }) => {
          const draft = drafts[role] || new Set()
          const original = initiallyByRole[role] || new Set()
          const isDirty = !setsEqual(draft, original)
          const wildcard = draft.has('*')
          return (
            <li
              key={role}
              className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-slate-900">{label}</h2>
                  <p className="text-xs text-slate-500">
                    {wildcard
                      ? 'Sees every page (including ones added later).'
                      : `${draft.size} page${draft.size === 1 ? '' : 's'} visible`}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => resetRole(role)}
                    disabled={saving === role}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    Reset to defaults
                  </button>
                  <button
                    type="button"
                    onClick={() => saveRole(role)}
                    disabled={!isDirty || saving === role}
                    className="rounded-md bg-slate-800 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-40"
                  >
                    {saving === role ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </div>

              <label className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={wildcard}
                  onChange={() => toggle(role, '*')}
                  className="h-4 w-4"
                />
                <span>
                  <strong>See everything</strong> — ignore the page checkboxes below; admin-style
                  full access. Future pages auto-appear.
                </span>
              </label>

              <div className={'grid gap-2 sm:grid-cols-2 ' + (wildcard ? 'opacity-50' : '')}>
                {PAGES.map((p) => {
                  const isAlways = ALWAYS_VISIBLE.has(p.key)
                  const checked = wildcard || isAlways || draft.has(p.key)
                  return (
                    <label
                      key={p.key}
                      className={
                        'flex items-center gap-2 rounded-md border px-3 py-2 text-sm ' +
                        (checked
                          ? 'border-emerald-200 bg-emerald-50'
                          : 'border-slate-200 bg-white')
                      }
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={wildcard || isAlways}
                        onChange={() => toggle(role, p.key)}
                        className="h-4 w-4"
                      />
                      <span className="flex-1">
                        {p.label}
                        {p.menu && p.menu !== 'top' && (
                          <span className="ml-1 text-[10px] uppercase tracking-wide text-slate-400">
                            ({p.menu})
                          </span>
                        )}
                      </span>
                      {isAlways && (
                        <span className="text-[10px] italic text-slate-500">always</span>
                      )}
                    </label>
                  )
                })}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false
  for (const x of a) if (!b.has(x)) return false
  return true
}

function labelOf(role) {
  return ROLES.find((r) => r.value === role)?.label || role
}
