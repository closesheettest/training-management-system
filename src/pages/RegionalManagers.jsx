import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { teamLabel, ZONE_COLORS } from '../lib/zones.js'

// Admin hub for the regional-manager program. One place to grab any
// manager's private dashboard link ("where do I go again?") and to see,
// at a glance, every tool we build for them and whether each manager's
// configurable pieces (Zoom / Help Line / CCG Records) are filled in.
//
// This page is read-only on purpose. The URLs themselves are edited on
// Active Reps → Edit Info (the manager record is the source of truth);
// here we just surface what's set and link out to fix what isn't.

// Everything a manager gets on their /regional-manager/:token dashboard.
// The three "configurable" tools map to admin-set URL columns; the rest
// are always on and need no setup.
const TOOLS = [
  { icon: '📹', name: 'Join Zone Zoom', field: 'manager_zoom_url',
    desc: "One tap into their zone's daily 9:30 AM sales-training room." },
  { icon: '🆘', name: 'Help Line', field: 'manager_helpline_url',
    desc: "Tap-to-call their zone's live support number." },
  { icon: '📄', name: 'CCG Records', field: null,
    desc: 'Their CCG deal board — Pending Signatures, per-deal status, Push to Job Nimbus. Auto-linked by zone (no setup). Always on.' },
  { icon: '🗺️', name: 'Zone Map', field: null,
    desc: 'Map of every rep in their zone, pinned by home address. Always on.' },
  { icon: '📣', name: 'Team Broadcast', field: null,
    desc: 'Text the whole zone. Reps can reply — replies land in Team Replies and the manager gets a heads-up text. Always on.' },
  { icon: '💬', name: 'Team Replies', field: null,
    desc: 'Inbox of rep replies, grouped per rep, with reply-from-here. Mirrored from GoHighLevel every minute. Always on.' },
  { icon: '👥', name: 'Roster + Edit info', field: null,
    desc: 'See their active reps, edit a rep’s phone / email / home address (office auto-texted the change), and mark anyone departed. Always on.' },
]

const CONFIG_TOOLS = TOOLS.filter((t) => t.field)

export default function RegionalManagers() {
  const [managers, setManagers] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    const { data, error } = await supabase
      .from('trainees')
      .select(
        'id, first_name, last_name, phone, managed_region, manager_access_token, manager_link_sent_at, manager_zoom_url, manager_helpline_url',
      )
      .not('managed_region', 'is', null)
      .order('managed_region', { ascending: true })
    if (error) {
      setError(error.message)
      return
    }
    setManagers(data || [])
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-brand-navy">Regional Managers</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          The control center for the regional-manager program. Grab any manager's private
          dashboard link, and see every tool they have plus what still needs setting up. Edit the
          URLs themselves on{' '}
          <Link to="/active-reps" className="font-semibold text-brand-navy underline">
            Active sales reps
          </Link>{' '}
          → Edit Info.
        </p>
      </header>

      <ToolsetReference />

      {error && (
        <div className="mt-6 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {managers === null ? (
        <p className="mt-6 text-sm text-slate-400">Loading managers…</p>
      ) : managers.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">
          No regional managers yet. Assign one on Active sales reps.
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {managers.map((m) => (
            <ManagerCard key={m.id} m={m} />
          ))}
        </div>
      )}
    </div>
  )
}

// Top reference block — the "every tool we're building for them" catalog,
// independent of any one manager.
function ToolsetReference() {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        What every manager gets
      </h2>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {TOOLS.map((t) => (
          <div key={t.name} className="flex gap-3 rounded-md bg-slate-50 p-3">
            <span className="text-2xl leading-none" aria-hidden="true">
              {t.icon}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-800">{t.name}</span>
                {t.soon ? (
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                    Coming soon
                  </span>
                ) : t.field ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                    Needs URL
                  </span>
                ) : (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                    Always on
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-slate-600">{t.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function ManagerCard({ m }) {
  const colors = ZONE_COLORS[m.managed_region] || { deep: '#64748b', light: '#f1f5f9' }
  const dashUrl = `${window.location.origin}/regional-manager/${m.manager_access_token}`

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-base font-bold text-slate-900">
            {m.first_name} {m.last_name}
          </div>
          <div className="text-xs text-slate-500">{m.phone || 'No phone on file'}</div>
        </div>
        <span
          className="rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide"
          style={{ background: colors.light, color: colors.deep }}
        >
          {teamLabel(m.managed_region)}
        </span>
      </div>

      {/* Private dashboard link — the "where do I go again?" answer. */}
      <div className="mt-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Private dashboard link
        </div>
        {m.manager_access_token ? (
          <>
            <div className="mt-1 break-all rounded-md bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">
              {dashUrl}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <a
                href={dashUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md bg-brand-navy px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
              >
                Open ↗
              </a>
              <CopyButton value={dashUrl} label="Copy link" />
            </div>
            <div className="mt-1.5 text-[11px] text-slate-400">
              {m.manager_link_sent_at
                ? `Texted to them ${new Date(m.manager_link_sent_at).toLocaleDateString()}`
                : 'Not yet texted to them'}{' '}
              · treat like a password
            </div>
          </>
        ) : (
          <div className="mt-1 text-xs text-amber-700">
            No access token — re-assign this manager on Active sales reps to generate one.
          </div>
        )}
      </div>

      {/* Per-tool setup status for the three configurable tools. */}
      <div className="mt-4 grid grid-cols-1 gap-1.5">
        {CONFIG_TOOLS.map((t) => {
          const val = m[t.field]
          const set = !!(val && String(val).trim())
          return (
            <div key={t.field} className="flex items-center gap-2 text-xs">
              <span aria-hidden="true">{t.icon}</span>
              <span className="font-medium text-slate-700">{t.name}</span>
              {set ? (
                <span className="ml-auto font-semibold text-emerald-600">Set ✓</span>
              ) : (
                <span className="ml-auto font-semibold text-amber-600">Missing</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CopyButton({ value, label = 'Copy' }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          /* clipboard blocked — no-op */
        }
      }}
      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
    >
      {copied ? 'Copied!' : label}
    </button>
  )
}
