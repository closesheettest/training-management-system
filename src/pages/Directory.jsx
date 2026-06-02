import { useEffect, useMemo, useState } from 'react'
import { teamLabel } from '../lib/zones.js'

// Public-ish company directory — a shareable lookup of every active
// team member with their phone, company email, region, level, and
// company number. Deliberately a standalone page with NO admin nav:
// people in the company get this URL on the dashboard and can find
// each other; they can't navigate into anything sensitive from here.
//
// Data comes from /.netlify/functions/list-directory-reps which returns
// only the safe public fields (no personal email, no home address, no
// tokens). The "Sales Academy"-style minimal chrome on this page is
// intentional — it should feel like a phone book, not an admin app.

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

export default function Directory() {
  const [reps, setReps] = useState(null) // null = loading
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [regionFilter, setRegionFilter] = useState('')
  const [deptFilter, setDeptFilter] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/.netlify/functions/list-directory-reps')
        const body = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) {
          setError(body.error || `HTTP ${res.status}`)
          setReps([])
          return
        }
        setReps(body.reps || [])
      } catch (err) {
        if (cancelled) return
        setError(err.message)
        setReps([])
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const regions = useMemo(() => {
    if (!reps) return []
    const set = new Set()
    for (const r of reps) if (r.region) set.add(r.region)
    return Array.from(set).sort()
  }, [reps])

  const departments = useMemo(() => {
    if (!reps) return []
    const set = new Set()
    for (const r of reps) {
      const list = Array.isArray(r.departments) ? r.departments : []
      for (const d of list) if (d) set.add(d)
    }
    return Array.from(set).sort()
  }, [reps])

  // Privacy default: the full roster doesn't appear until the visitor
  // narrows by typing a name or picking a department / territory. Keeps
  // the directory from doubling as a one-tap dump of everyone's contact
  // info for anyone who happens to load the URL.
  const hasFilter = !!search.trim() || !!deptFilter || !!regionFilter

  const filtered = useMemo(() => {
    if (!reps) return []
    if (!hasFilter) return []
    const s = search.trim().toLowerCase()
    return reps.filter((r) => {
      const depts = Array.isArray(r.departments) ? r.departments : []
      if (regionFilter && r.region !== regionFilter) return false
      if (deptFilter && !depts.includes(deptFilter)) return false
      if (!s) return true
      const hay = `${r.first_name || ''} ${r.last_name || ''} ${r.phone || ''} ${r.company_phone || ''} ${r.company_email || ''} ${depts.join(' ')}`.toLowerCase()
      return hay.includes(s)
    })
  }, [reps, search, regionFilter, deptFilter, hasFilter])

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="h-1 w-full bg-brand-red" />
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-4xl px-6 py-5">
          <h1 className="text-2xl font-bold tracking-tight text-brand-navy">
            U.S. Shingle &amp; Metal — Team Directory
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Phone book for every active person on the team. Click a phone number to call, an email
            to send mail.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, phone, email, or department…"
            className="w-full max-w-md rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          {regions.length > 0 && (
            <select
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">All territories</option>
              {regions.map((r) => (
                <option key={r} value={r}>{teamLabel(r)}</option>
              ))}
            </select>
          )}
          {departments.length > 0 && (
            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          )}
          <div className="ml-auto text-xs text-slate-500">
            {reps === null
              ? 'Loading…'
              : !hasFilter
                ? `${reps.length} people on the team`
                : `${filtered.length} match${filtered.length === 1 ? '' : 'es'}`}
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            Couldn't load the directory: {error}
          </div>
        )}

        {reps !== null && !hasFilter && !error && (
          <div className="rounded-md border border-dashed border-slate-300 bg-white px-4 py-10 text-center">
            <div className="text-3xl">🔎</div>
            <p className="mt-2 text-sm font-medium text-slate-700">
              Pick a department above or start typing a name to find someone.
            </p>
            <p className="mt-1 text-xs text-slate-500">
              The full team list stays hidden until you narrow your search.
            </p>
          </div>
        )}

        {reps !== null && hasFilter && filtered.length === 0 && !error && (
          <p className="rounded-md border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
            No matches.
          </p>
        )}

        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {filtered.map((r) => (
            <li
              key={r.id}
              className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900">
                    {r.first_name} {r.last_name}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                    {r.region && <span>📍 {teamLabel(r.region)}</span>}
                    {Array.isArray(r.departments) && r.departments.map((d) => (
                      <span key={d}>🏷 {d}</span>
                    ))}
                    {r.birthday && <span>🎂 {formatBirthdayShort(r.birthday)}</span>}
                  </div>
                </div>
                {r.rep_level && (
                  <span
                    className={
                      'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ' +
                      (LEVEL_BADGE_CLS[r.rep_level] || 'bg-slate-100 text-slate-700')
                    }
                  >
                    {LEVEL_LABEL[r.rep_level] || r.rep_level}
                  </span>
                )}
              </div>
              <dl className="mt-3 space-y-1.5 text-sm">
                {r.phone && (r.phone_actions?.call || r.phone_actions?.text) && (
                  <ContactRow label="Personal">
                    {r.phone_actions?.call && <ActionLink href={`tel:${r.phone}`} icon="📞" text="Call" />}
                    {r.phone_actions?.text && <ActionLink href={`sms:${r.phone}`} icon="💬" text="Text" />}
                  </ContactRow>
                )}
                {r.company_phone && (r.company_phone_actions?.call || r.company_phone_actions?.text) && (
                  <ContactRow label="Work">
                    {r.company_phone_actions?.call && <ActionLink href={`tel:${r.company_phone}`} icon="📞" text="Call" />}
                    {r.company_phone_actions?.text && <ActionLink href={`sms:${r.company_phone}`} icon="💬" text="Text" />}
                  </ContactRow>
                )}
                {r.company_email && (
                  <ContactRow label="Email">
                    <ActionLink href={`mailto:${r.company_email}`} icon="📧" text="Send email" />
                  </ContactRow>
                )}
              </dl>
              {renderNotes(r.directory_note, deptFilter)}
            </li>
          ))}
        </ul>

        <p className="mt-8 text-center text-xs text-slate-400">
          Need to update someone's info? Reach out to HR.
        </p>
      </main>
    </div>
  )
}

// Render the "how to reach me" callout. Notes are department-scoped:
// they only appear when the visitor has filtered by a department that
// matches one of the person's notes. Without a filter, no note shows —
// keeps the directory clean by default and surfaces guidance only when
// the visitor's context warrants it.
function renderNotes(raw, deptFilter) {
  if (!raw || !deptFilter) return null
  // Tolerate the legacy text-column shape so old rows still render
  // even before the per-department migration has been applied.
  const notes = typeof raw === 'string' ? {} : (typeof raw === 'object' ? raw : {})
  const text = notes[deptFilter]
  if (!text || typeof text !== 'string' || !text.trim()) return null
  return (
    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">
        💡 How to reach me ({deptFilter})
      </div>
      <p className="mt-0.5 whitespace-pre-wrap">{text}</p>
    </div>
  )
}

// Format 'YYYY-MM-DD' as "Mar 15" — month + day only, no year. Used
// on the public directory so birthdays can be celebrated without
// revealing the year. Component-wise parse avoids `new Date(s)` UTC
// shifts that can flip the day in some timezones.
function formatBirthdayShort(s) {
  if (!s) return ''
  const parts = String(s).slice(0, 10).split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return ''
  const d = new Date(parts[0], parts[1] - 1, parts[2])
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// One row of the contact dl — a label on the left and one or more
// action buttons on the right. Keeps spacing consistent across the
// four contact types (personal / work / email / company #).
function ContactRow({ label, children }) {
  return (
    <div className="flex items-center gap-2">
      <dt className="w-20 shrink-0 text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-1.5">{children}</dd>
    </div>
  )
}

// Pill-style action link that triggers the device's native handler
// (tel: → dialer, sms: → messages app, mailto: → mail client). The
// raw phone number / email never appears in the DOM text — viewers
// see the action label and just tap to act. Privacy plus cleaner UI.
function ActionLink({ href, icon, text }) {
  return (
    <a
      href={href}
      className="inline-flex items-center gap-1 rounded-full border border-brand-navy/30 bg-brand-navy/5 px-2.5 py-1 text-xs font-semibold text-brand-navy hover:bg-brand-navy hover:text-white"
    >
      <span aria-hidden="true">{icon}</span> {text}
    </a>
  )
}
