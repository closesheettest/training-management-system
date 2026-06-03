import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { teamLabel } from '../lib/zones.js'

// Public regional-manager page — the ONLY thing the regional sales
// manager sees. No navigation, no admin chrome, no menus. They get a
// link in a text and land here. From here they can:
//   1. See the active field reps in their region (with contact info
//      AND home address so the manager knows where they live).
//   2. See a Leaflet map of their team — pins for each geocoded rep,
//      hover for name + address.
//   3. Mark someone as departed (fired / quit) — that flips
//      is_active_sales_rep off and stamps left_company_at so the
//      regular admin cleanup workflow can take it from there.
//   4. Blast their region with SMS, email, or both.
//   5. Read + answer replies their reps text back (Team Replies inbox).
//      Reps reply through the company GHL line; this mirrors the thread
//      so the manager has ONE place to see and answer it. GHL stays the
//      source of truth — they can always open it there too.
//
// All actions go through /.netlify/functions/regional-manager-api
// which gates every request by the token in the URL. The manager can't
// reach reps outside their own region — that's enforced server-side.
//
// Route: /regional-manager/:token (registered in App.jsx, gated route
// excluded — public).

const LEVEL_LABEL = {
  junior: 'Junior',
  senior: 'Senior',
  non_field: 'Non-field',
}

// Centroids for each Zone — used to drop a sensible map center if all
// reps in the zone are missing lat/lng (rare but worth handling). Same
// values seeded by the 2026-05-31-zones.sql migration so admin doesn't
// see a Florida-wide pan when the zone has zero geocoded reps yet.
const ZONE_CENTERS = {
  'Zone 1': [29.6516, -82.3248],
  'Zone 2': [28.0395, -81.9498],
  'Zone 3': [27.3364, -82.5307],
  'Zone 4': [26.1224, -80.1373],
}

// Build a small leaflet pin colored to match the rep-map's "active"
// status. SVG via divIcon so we don't have to ship raster assets.
const REP_PIN = L.divIcon({
  html: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="24" height="32">
      <path d="M16 0C8.27 0 2 6.27 2 14c0 9.5 14 18 14 18s14-8.5 14-18c0-7.73-6.27-14-14-14z" fill="#10b981" stroke="white" stroke-width="2"/>
      <circle cx="16" cy="13" r="5" fill="white"/>
    </svg>
  `.trim(),
  className: '',
  iconSize: [24, 32],
  iconAnchor: [12, 32],
  popupAnchor: [0, -28],
})

// Single-line address joiner — skips empty parts so a partial address
// (just street, no zip) doesn't render with awkward "—, —, —" gaps.
function fmtAddress(t) {
  return [
    t.street_address,
    t.city,
    [t.state, t.zip].filter(Boolean).join(' '),
  ]
    .filter((s) => s && String(s).trim())
    .join(', ')
}

export default function RegionalManager() {
  const { token } = useParams()
  // null while loading; { manager, reps } when loaded; { error } on bad
  // token / network failure. Lets the render branch on a single value.
  const [state, setState] = useState({ status: 'loading' })

  const reload = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const res = await fetch('/.netlify/functions/regional-manager-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'whoami', token }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setState({ status: 'error', error: data?.error || 'Could not load.' })
        return
      }
      setState({ status: 'ready', manager: data.manager, reps: data.reps })
    } catch (e) {
      setState({ status: 'error', error: e?.message || 'Network error.' })
    }
  }, [token])

  useEffect(() => {
    reload()
  }, [reload])

  if (state.status === 'loading') {
    return <ShellFrame><p>Loading your dashboard…</p></ShellFrame>
  }
  if (state.status === 'error') {
    return (
      <ShellFrame>
        <p className="text-red-200">{state.error}</p>
        <p className="mt-3 text-sm text-slate-200/70">
          If you got this link in a text and it's not working, ask the office to re-send it.
        </p>
      </ShellFrame>
    )
  }

  const { manager } = state
  // Roster sorted alphabetically by first name — easiest for a manager
  // scanning for someone by the name they actually call them.
  const reps = [...state.reps].sort((a, b) =>
    (a.first_name || '').localeCompare(b.first_name || '', undefined, { sensitivity: 'base' }),
  )
  return (
    <ShellFrame>
      <header className="mb-6">
        <div className="text-sm text-slate-200/70">Welcome —</div>
        <h1 className="mt-1 text-3xl font-semibold">
          {manager.first_name} {manager.last_name}
        </h1>
        <div className="mt-1 text-sm text-amber-200/90">
          You're managing the <strong>{teamLabel(manager.region)}</strong> region.
        </div>
      </header>

      <QuickActions manager={manager} token={token} reps={reps} />

      <ZoneMap reps={reps} zoneName={manager.region} token={token} />

      <BlastTool token={token} region={manager.region} repCount={reps.length} />

      <TeamReplies token={token} />

      <RepsTable token={token} reps={reps} onChanged={reload} />

      <footer className="mt-8 text-center text-xs text-slate-200/60">
        Need help? Reply to the text you got with this link.
      </footer>
    </ShellFrame>
  )
}

// ── Shell ──────────────────────────────────────────────────────────
// Wraps everything in a navy / gold themed page so the manager doesn't
// see the admin app's chrome. Self-contained styling — no shared layout.

function ShellFrame({ children }) {
  return (
    <div className="min-h-screen bg-[#0a1730] text-white">
      <div className="h-1 bg-[#b8324f]" />
      <div className="mx-auto max-w-3xl px-4 py-8">{children}</div>
    </div>
  )
}

// ── Reps Table ─────────────────────────────────────────────────────
// One row per active rep in the manager's region. Each row has a
// "Mark as departed" button that opens a small inline confirm with an
// optional reason field.

// ── Quick Actions ──────────────────────────────────────────────────
// Two big touch-friendly buttons at the top of the page — the Zone
// Zoom and the Help Line. Each falls back to a non-clickable "Coming
// soon" pill when the underlying URL is still null on the manager
// record. Admin sets the URLs on /active-reps Edit Info.
function QuickActions({ manager, token, reps }) {
  const hasZoom = !!(manager.zoom_url && String(manager.zoom_url).trim())
  const hasRecords = !!(manager.ccg_records_url && String(manager.ccg_records_url).trim())
  // "Message a rep" composer toggle — replaces the old rep-facing Help
  // Line tile (managers don't call the help line; reps do). Lets the
  // manager start a 1:1 text with any one rep; the reply lands in Team
  // Replies below, so the whole thread stays in one place.
  const [composing, setComposing] = useState(false)
  return (
    <section className="mt-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ActionTile
          icon="📄"
          title="Roof Inspection Records"
          subtitle="Your team's deals · pending signatures · status"
          href={hasRecords ? manager.ccg_records_url : null}
          comingSoonNote="Deal board coming soon — admin is finalizing."
        />
        <ActionTile
          icon="📹"
          title="Join Zone Zoom"
          subtitle="Daily sales training · 9:30 AM Eastern"
          href={hasZoom ? manager.zoom_url : null}
          comingSoonNote="Zoom link coming soon — admin is finalizing."
        />
        <ActionTile
          icon="✉️"
          title="Message a rep"
          subtitle="Text one teammate directly"
          onClick={() => setComposing((v) => !v)}
          active={composing}
        />
      </div>
      {composing && (
        <MessageRepComposer
          token={token}
          reps={reps}
          onClose={() => setComposing(false)}
        />
      )}
    </section>
  )
}

// Inline composer for a 1:1 text to a single rep. Reuses the send_reply
// action (same path Team Replies uses), so the message goes out through
// the company GHL line and is mirrored into that rep's thread — the rep's
// answer comes back into Team Replies.
function MessageRepComposer({ token, reps, onClose }) {
  const [repId, setRepId] = useState('')
  const [msg, setMsg] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null) // { ok } | { error }

  async function send() {
    setResult(null)
    if (!repId) {
      setResult({ error: 'Pick a rep first.' })
      return
    }
    if (!msg.trim()) {
      setResult({ error: 'Type a message first.' })
      return
    }
    setSending(true)
    try {
      const res = await fetch('/.netlify/functions/regional-manager-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send_reply', token, trainee_id: repId, body: msg }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setResult({ error: data?.error || 'Could not send.' })
        return
      }
      setResult({ ok: true })
      setMsg('')
    } catch (e) {
      setResult({ error: e?.message || 'Network error.' })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-amber-300/30 bg-amber-50/5 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-amber-200">Message a rep</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-slate-300/70 hover:text-white"
        >
          Close
        </button>
      </div>
      <label className="mt-3 block text-xs font-medium text-slate-200/80">To</label>
      <select
        value={repId}
        onChange={(e) => setRepId(e.target.value)}
        className="mt-1 w-full rounded-md border border-white/20 bg-white/10 px-2 py-1.5 text-sm text-white"
      >
        <option value="" className="bg-[#0a1730]">
          Pick a rep…
        </option>
        {reps.map((r) => (
          <option key={r.id} value={r.id} className="bg-[#0a1730]">
            {r.first_name} {r.last_name}
            {r.phone ? '' : ' (no phone on file)'}
          </option>
        ))}
      </select>
      <label className="mt-3 block text-xs font-medium text-slate-200/80">Message</label>
      <textarea
        value={msg}
        onChange={(e) => setMsg(e.target.value)}
        rows={3}
        placeholder="Type your text…"
        className="mt-1 w-full rounded-md border border-white/20 bg-white/10 px-2 py-1.5 text-sm text-white placeholder:text-slate-400"
      />
      <div className="mt-1 text-[11px] text-slate-300/70">
        Their reply comes back into <strong>Team Replies</strong> below.
      </div>
      {result?.error && (
        <div className="mt-2 rounded-md bg-red-500/15 px-3 py-2 text-xs text-red-100">
          {result.error}
        </div>
      )}
      {result?.ok && (
        <div className="mt-2 rounded-md bg-emerald-500/15 px-3 py-2 text-xs text-emerald-100">
          Sent ✓
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={send}
          disabled={sending}
          className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-amber-950 hover:bg-amber-400 disabled:opacity-50"
        >
          {sending ? 'Sending…' : 'Send text'}
        </button>
      </div>
    </div>
  )
}

function ActionTile({ icon, title, subtitle, href, comingSoonNote, onClick, active }) {
  const interactive = !!href || !!onClick
  const inner = (
    <div className="flex items-center gap-3 p-4">
      <span className="text-3xl leading-none" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`text-base font-semibold ${interactive ? 'text-white' : 'text-slate-300'}`}>
            {title}
          </span>
          {!interactive && (
            <span className="rounded-full bg-amber-300/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900">
              Coming soon
            </span>
          )}
        </div>
        <div className={`mt-0.5 text-xs ${interactive ? 'text-white/70' : 'text-slate-400'}`}>
          {interactive ? subtitle : comingSoonNote}
        </div>
      </div>
      {href && <span className="text-2xl text-white/70">↗</span>}
      {onClick && <span className="text-2xl text-white/70">{active ? '×' : '✏️'}</span>}
    </div>
  )
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="block rounded-lg border border-amber-300/40 bg-amber-500/15 shadow-sm hover:bg-amber-500/25"
      >
        {inner}
      </a>
    )
  }
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`block w-full rounded-lg border text-left shadow-sm ${
          active
            ? 'border-amber-300/70 bg-amber-500/25'
            : 'border-amber-300/40 bg-amber-500/15 hover:bg-amber-500/25'
        }`}
      >
        {inner}
      </button>
    )
  }
  return (
    <div
      className="block cursor-default rounded-lg border border-dashed border-white/15 bg-white/5"
      aria-disabled="true"
    >
      {inner}
    </div>
  )
}

// ── Zone Map ───────────────────────────────────────────────────────
// Embedded Leaflet map showing every rep in the zone with a pin at
// their geocoded home address. Hover/tap shows name + address. Reps
// without lat/lng (haven't run /update-info or geocoding failed) are
// skipped from the map but still appear in the rep table below.
function ZoneMap({ reps, zoneName, token }) {
  const pinned = reps.filter(
    (r) => typeof r.latitude === 'number' && typeof r.longitude === 'number',
  )
  // Compute a sensible center: bounding box of pinned reps when there
  // are any, otherwise the zone centroid as a soft default.
  let center = ZONE_CENTERS[zoneName] || [27.9944, -81.7603]
  let zoom = 9
  if (pinned.length > 0) {
    const lats = pinned.map((r) => r.latitude)
    const lngs = pinned.map((r) => r.longitude)
    center = [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lngs) + Math.max(...lngs)) / 2]
    // Tighter zoom when reps cluster, wider when spread. Heuristic
    // based on the bbox diagonal.
    const span = Math.max(
      Math.max(...lats) - Math.min(...lats),
      Math.max(...lngs) - Math.min(...lngs),
    )
    zoom = span > 2 ? 7 : span > 1 ? 8 : span > 0.4 ? 9 : 10
  }

  return (
    <section className="mt-8 rounded-lg border border-white/10 bg-white/5 p-5">
      <h2 className="text-lg font-semibold text-amber-200">
        Map · {zoneName}
      </h2>
      <p className="mt-1 text-xs text-slate-200/70">
        {pinned.length} of {reps.length} rep{reps.length === 1 ? '' : 's'} pinned by home address.
        {pinned.length < reps.length && (
          <span className="ml-1 text-amber-200/80">
            The {reps.length - pinned.length} not shown haven't filled in / update-info yet.
          </span>
        )}
      </p>
      <div className="mt-3 overflow-hidden rounded-md border border-white/10" style={{ height: 420 }}>
        <MapContainer center={center} zoom={zoom} style={{ height: '100%', width: '100%' }} scrollWheelZoom={true}>
          <TileLayer
            attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {pinned.map((r) => (
            <Marker key={r.id} position={[r.latitude, r.longitude]} icon={REP_PIN}>
              <Popup closeButton={false} autoPan={false}>
                <div style={{ fontSize: 13, lineHeight: 1.4 }}>
                  <div style={{ fontWeight: 700 }}>
                    {r.first_name} {r.last_name}
                  </div>
                  <div style={{ color: '#475569', fontSize: 12 }}>
                    {r.phone || '—'}
                  </div>
                  {fmtAddress(r) && (
                    <div style={{ color: '#475569', fontSize: 12, marginTop: 4 }}>
                      {fmtAddress(r)}
                    </div>
                  )}
                  <a
                    href={vcardUrlFor(token, r.id)}
                    download
                    style={{
                      display: 'inline-block',
                      marginTop: 8,
                      padding: '4px 10px',
                      background: '#13294b',
                      color: '#fff',
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 600,
                      textDecoration: 'none',
                    }}
                  >
                    💾 Save to phone
                  </a>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </section>
  )
}

// Returns the URL for a single rep's vCard, scoped to the manager's
// token so the server can validate before serving. Used by the
// "Save to phone" button on each rep row.
function vcardUrlFor(token, repId) {
  return `/.netlify/functions/regional-manager-rep-vcard?token=${encodeURIComponent(token)}&trainee_id=${encodeURIComponent(repId)}`
}

function RepsTable({ token, reps, onChanged }) {
  const [confirming, setConfirming] = useState(null) // {rep, reason}
  const [submitting, setSubmitting] = useState(false)
  const [flash, setFlash] = useState(null)
  const [editing, setEditing] = useState(null) // {rep, phone, email}
  const [savingEdit, setSavingEdit] = useState(false)

  async function submitEdit() {
    if (!editing) return
    setSavingEdit(true)
    try {
      const repId = editing.rep.id
      const res = await fetch('/.netlify/functions/regional-manager-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_rep',
          token,
          trainee_id: repId,
          phone: editing.phone,
          email: editing.email,
          street_address: editing.street_address,
          city: editing.city,
          state: editing.state,
          zip: editing.zip,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setFlash({ kind: 'error', text: data?.error || 'Could not save.' })
      } else if (data.no_change) {
        setFlash({ kind: 'success', text: 'No changes to save.' })
        setEditing(null)
      } else {
        // Address changed → re-pin the map. Fire-and-forget, same as the
        // rep's own /update-info form; we don't block the save on it.
        if (data.address_changed) {
          fetch('/.netlify/functions/geocode-trainee', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trainee_id: repId, force: true }),
          }).catch(() => {})
        }
        setFlash({
          kind: 'success',
          text: `Saved. The office has been texted to update ${editing.rep.first_name}'s record.`,
        })
        setEditing(null)
        await onChanged()
      }
    } catch (e) {
      setFlash({ kind: 'error', text: e?.message || 'Network error.' })
    } finally {
      setSavingEdit(false)
    }
  }

  async function submitDeactivate() {
    if (!confirming) return
    setSubmitting(true)
    try {
      const res = await fetch('/.netlify/functions/regional-manager-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'deactivate_rep',
          token,
          trainee_id: confirming.rep.id,
          reason: confirming.reason,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setFlash({ kind: 'error', text: data?.error || 'Could not deactivate.' })
      } else {
        setFlash({
          kind: 'success',
          text: `${confirming.rep.first_name} ${confirming.rep.last_name} marked as departed.`,
        })
        setConfirming(null)
        await onChanged()
      }
    } catch (e) {
      setFlash({ kind: 'error', text: e?.message || 'Network error.' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="mt-8 rounded-lg border border-white/10 bg-white/5 p-5">
      <h2 className="text-lg font-semibold text-amber-200">
        Your reps ({reps.length})
      </h2>

      {flash && (
        <div
          className={`mt-3 rounded-md px-3 py-2 text-sm ${
            flash.kind === 'error'
              ? 'bg-red-500/20 text-red-100'
              : 'bg-emerald-500/20 text-emerald-100'
          }`}
        >
          {flash.text}
        </div>
      )}

      {reps.length === 0 ? (
        <p className="mt-3 text-sm text-slate-300">
          No active reps in your region yet.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-white/10">
          {reps.map((r) => {
            const level = !r.rep_level || !r.rep_level_confirmed_at
              ? 'Unassigned'
              : LEVEL_LABEL[r.rep_level] || r.rep_level
            return (
              <li key={r.id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <div className="text-base font-semibold">
                      {r.first_name} {r.last_name}
                    </div>
                    <div className="text-xs text-slate-300">
                      {r.phone || '—'}
                      {r.company_email && (
                        <span className="ml-2 opacity-80">· {r.company_email}</span>
                      )}
                      {r.company_number && (
                        <span className="ml-2 opacity-80">· #{r.company_number}</span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-amber-200/80">{level}</div>
                    {/* Home address — single-line, only renders if any
                        component is set. Blank rows skip the line entirely
                        rather than show "—" placeholders, which looks
                        broken on a public dashboard. */}
                    {fmtAddress(r) && (
                      <div className="mt-0.5 text-xs text-slate-200/70">
                        🏠 {fmtAddress(r)}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <a
                      href={vcardUrlFor(token, r.id)}
                      download
                      className="rounded-md border border-amber-300/40 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-100 hover:bg-amber-500/20"
                      title="Download this rep's contact card to your phone."
                    >
                      💾 Save to phone
                    </a>
                    <button
                      type="button"
                      onClick={() =>
                        setEditing({
                          rep: r,
                          phone: r.phone || '',
                          email: r.email || '',
                          street_address: r.street_address || '',
                          city: r.city || '',
                          state: r.state || '',
                          zip: r.zip || '',
                        })
                      }
                      className="rounded-md border border-sky-300/40 bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-100 hover:bg-sky-500/20"
                      title="Update this rep's phone, email, or home address. The office is texted the change."
                    >
                      ✏️ Edit info
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setConfirming((c) =>
                          c?.rep.id === r.id ? null : { rep: r, reason: '' },
                        )
                      }
                      className="rounded-md border border-red-300/40 bg-red-500/10 px-3 py-1 text-xs font-semibold text-red-100 hover:bg-red-500/20"
                    >
                      Mark as departed
                    </button>
                  </div>
                </div>

                {/* Inline edit — opens directly under THIS rep so the panel is
                    always in view next to the button that was clicked. */}
                {editing?.rep.id === r.id && (
                  <div className="mt-3 rounded-md border border-sky-400/50 bg-sky-950/40 p-4">
                    <div className="text-sm font-semibold">
                      Edit {editing.rep.first_name} {editing.rep.last_name}
                    </div>
                    <p className="mt-1 text-xs text-slate-200/80">
                      Update their phone, personal email, or home address. When you save,
                      the office is automatically texted exactly what changed so they can
                      update their other records (GHL, JobNimbus, RepCard).
                    </p>
                    <label className="mt-3 block text-xs font-medium text-slate-200/80">
                      Phone
                    </label>
                    <input
                      type="tel"
                      value={editing.phone}
                      onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
                      placeholder="(555) 123-4567"
                      className="mt-1 w-full rounded-md border border-white/20 bg-white/10 px-2 py-1.5 text-sm text-white placeholder:text-slate-400"
                    />
                    <label className="mt-3 block text-xs font-medium text-slate-200/80">
                      Personal email
                    </label>
                    <input
                      type="email"
                      value={editing.email}
                      onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                      placeholder="name@email.com"
                      className="mt-1 w-full rounded-md border border-white/20 bg-white/10 px-2 py-1.5 text-sm text-white placeholder:text-slate-400"
                    />
                    <label className="mt-3 block text-xs font-medium text-slate-200/80">
                      Street address
                    </label>
                    <input
                      type="text"
                      value={editing.street_address}
                      onChange={(e) =>
                        setEditing({ ...editing, street_address: e.target.value })
                      }
                      placeholder="123 Main St"
                      className="mt-1 w-full rounded-md border border-white/20 bg-white/10 px-2 py-1.5 text-sm text-white placeholder:text-slate-400"
                    />
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto]">
                      <div>
                        <label className="block text-xs font-medium text-slate-200/80">
                          City
                        </label>
                        <input
                          type="text"
                          value={editing.city}
                          onChange={(e) => setEditing({ ...editing, city: e.target.value })}
                          placeholder="Tampa"
                          className="mt-1 w-full rounded-md border border-white/20 bg-white/10 px-2 py-1.5 text-sm text-white placeholder:text-slate-400"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-200/80">
                          State
                        </label>
                        <input
                          type="text"
                          value={editing.state}
                          onChange={(e) => setEditing({ ...editing, state: e.target.value })}
                          placeholder="FL"
                          className="mt-1 w-full rounded-md border border-white/20 bg-white/10 px-2 py-1.5 text-sm text-white placeholder:text-slate-400 sm:w-20"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-200/80">
                          Zip
                        </label>
                        <input
                          type="text"
                          value={editing.zip}
                          onChange={(e) => setEditing({ ...editing, zip: e.target.value })}
                          placeholder="33601"
                          className="mt-1 w-full rounded-md border border-white/20 bg-white/10 px-2 py-1.5 text-sm text-white placeholder:text-slate-400 sm:w-28"
                        />
                      </div>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={submitEdit}
                        disabled={savingEdit}
                        className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
                      >
                        {savingEdit ? 'Saving…' : 'Save changes'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        disabled={savingEdit}
                        className="rounded-md border border-white/30 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Inline confirm — opens directly under THIS rep. */}
                {confirming?.rep.id === r.id && (
                  <div className="mt-3 rounded-md border border-red-400/50 bg-red-950/40 p-4">
                    <div className="text-sm font-semibold">
                      Mark {confirming.rep.first_name} {confirming.rep.last_name} as departed?
                    </div>
                    <p className="mt-1 text-xs text-slate-200/80">
                      This removes them from your team list and flags them for cleanup in the
                      office systems (GHL, RepCard, etc.). The office will see who you marked.
                    </p>
                    <label className="mt-3 block text-xs font-medium text-slate-200/80">
                      Reason (optional)
                    </label>
                    <input
                      type="text"
                      value={confirming.reason}
                      onChange={(e) =>
                        setConfirming({ ...confirming, reason: e.target.value })
                      }
                      placeholder="e.g. No-show 3 days in a row"
                      className="mt-1 w-full rounded-md border border-white/20 bg-white/10 px-2 py-1.5 text-sm text-white placeholder:text-slate-400"
                    />
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={submitDeactivate}
                        disabled={submitting}
                        className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        {submitting ? 'Saving…' : 'Yes, mark as departed'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming(null)}
                        disabled={submitting}
                        className="rounded-md border border-white/30 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// ── Blast Tool ─────────────────────────────────────────────────────
// SMS / email composer scoped to the manager's region. Mirrors the
// admin /group-messages UX but stripped down — they don't get to pick
// scope, the region is server-set from their token.

function BlastTool({ token, region, repCount }) {
  const [wantSms, setWantSms] = useState(true)
  const [wantEmail, setWantEmail] = useState(false)
  const [smsBody, setSmsBody] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null) // { counts, total }
  const [error, setError] = useState(null)

  async function sendAll() {
    setError(null)
    setResult(null)
    if (!wantSms && !wantEmail) {
      setError('Pick at least one channel.')
      return
    }
    if (wantSms && !smsBody.trim()) {
      setError('SMS body is empty.')
      return
    }
    if (wantEmail && !emailBody.trim()) {
      setError('Email body is empty.')
      return
    }

    setSending(true)
    // Send in batches — send-group-message returns next_offset until
    // there are no more recipients. We just keep calling until null.
    let offset = 0
    const totals = { sms_sent: 0, sms_failed: 0, email_sent: 0, email_failed: 0, recipients: 0 }
    let totalRecipients = repCount
    try {
      while (true) {
        const res = await fetch('/.netlify/functions/regional-manager-api', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'send_message',
            token,
            channels: {
              ...(wantSms ? { sms: true } : {}),
              ...(wantEmail ? { email: true } : {}),
            },
            sms_body: wantSms ? smsBody : undefined,
            email_subject: wantEmail ? emailSubject : undefined,
            email_body: wantEmail ? emailBody : undefined,
            offset,
          }),
        })
        const data = await res.json()
        if (!res.ok) {
          setError(data?.error || 'Send failed.')
          break
        }
        const c = data?.counts || {}
        totals.sms_sent += c.sms_sent || 0
        totals.sms_failed += c.sms_failed || 0
        totals.email_sent += c.email_sent || 0
        totals.email_failed += c.email_failed || 0
        totals.recipients += c.recipients || 0
        if (data?.total) totalRecipients = data.total
        if (data?.next_offset == null) break
        offset = data.next_offset
      }
      setResult({ counts: totals, total: totalRecipients })
    } catch (e) {
      setError(e?.message || 'Network error.')
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="rounded-lg border border-amber-300/30 bg-amber-50/5 p-5">
      <h2 className="text-lg font-semibold text-amber-200">
        Message your team
      </h2>
      <p className="mt-1 text-xs text-slate-200/70">
        Goes to every active rep in <strong>{teamLabel(region)}</strong> ({repCount} {repCount === 1 ? 'person' : 'people'}).
      </p>

      <div className="mt-4 flex flex-wrap gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={wantSms}
            onChange={(e) => setWantSms(e.target.checked)}
          />
          <span>SMS</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={wantEmail}
            onChange={(e) => setWantEmail(e.target.checked)}
          />
          <span>Email</span>
        </label>
      </div>

      {wantSms && (
        <div className="mt-4">
          <label className="text-xs font-medium text-slate-200/80">SMS body</label>
          <textarea
            value={smsBody}
            onChange={(e) => setSmsBody(e.target.value)}
            rows={4}
            placeholder="Quick team note…"
            className="mt-1 w-full rounded-md border border-white/20 bg-white/10 px-2 py-1.5 text-sm text-white placeholder:text-slate-400"
          />
          <div className="mt-1 text-[11px] text-slate-300/70">
            Tip: use <code>{'{firstName}'}</code> to personalize. Char count: {smsBody.length}.
          </div>

          <div className="mt-3 rounded-md border border-sky-300/30 bg-sky-500/10 px-3 py-2 text-[11px] text-sky-100/90">
            Reps can reply to this text. Their replies show up in <strong>Team Replies</strong> below,
            and we’ll text you whenever one comes in.
          </div>
        </div>
      )}

      {wantEmail && (
        <div className="mt-4 space-y-2">
          <div>
            <label className="text-xs font-medium text-slate-200/80">Email subject</label>
            <input
              type="text"
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              placeholder="Subject…"
              className="mt-1 w-full rounded-md border border-white/20 bg-white/10 px-2 py-1.5 text-sm text-white placeholder:text-slate-400"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-200/80">Email body</label>
            <textarea
              value={emailBody}
              onChange={(e) => setEmailBody(e.target.value)}
              rows={6}
              placeholder="What do you want to say?"
              className="mt-1 w-full rounded-md border border-white/20 bg-white/10 px-2 py-1.5 text-sm text-white placeholder:text-slate-400"
            />
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={sendAll}
          disabled={sending || repCount === 0}
          className="rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-[#0a1730] hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? 'Sending…' : `Send to ${repCount}`}
        </button>
      </div>

      {error && (
        <div className="mt-3 rounded-md bg-red-500/20 px-3 py-2 text-sm text-red-100">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-3 rounded-md bg-emerald-500/15 px-3 py-2 text-sm text-emerald-100">
          Sent to {result.total} {result.total === 1 ? 'rep' : 'reps'}.
          {' '}
          {result.counts.sms_sent > 0 && (
            <span>SMS: {result.counts.sms_sent} ok{result.counts.sms_failed ? `, ${result.counts.sms_failed} failed` : ''}. </span>
          )}
          {result.counts.email_sent > 0 && (
            <span>Email: {result.counts.email_sent} ok{result.counts.email_failed ? `, ${result.counts.email_failed} failed` : ''}. </span>
          )}
        </div>
      )}
    </section>
  )
}

// ── Team Replies inbox ─────────────────────────────────────────────
// The other side of the blast: when a rep texts back, GHL drops it in a
// company inbox the manager never opens. ghl-inbound-sms.js mirrors that
// reply into rep_messages; this panel renders it as per-rep threads the
// manager can read and answer right here. GHL remains the source of
// truth — this is just a window into it.
//
// Loads on mount and after every reply. No live push (a manager refresh
// or a reply re-pulls); the unread badge is driven by read_at on the
// inbound rows, cleared when the manager opens or answers a thread.

function TeamReplies({ token }) {
  const [threads, setThreads] = useState(null) // null=loading, []=none
  const [error, setError] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)
  const [flash, setFlash] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/.netlify/functions/regional-manager-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list_messages', token }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setError(data?.error || 'Could not load replies.')
        return
      }
      setThreads(data.threads || [])
    } catch (e) {
      setError(e?.message || 'Network error.')
    }
  }, [token])

  useEffect(() => {
    load()
  }, [load])

  // Opening a thread clears its unread badge server-side (and locally so
  // the UI updates without a full reload).
  async function openThread(t) {
    const next = openId === t.trainee_id ? null : t.trainee_id
    setOpenId(next)
    setReplyText('')
    setFlash(null)
    if (next && t.unread > 0) {
      setThreads((cur) =>
        (cur || []).map((x) => (x.trainee_id === t.trainee_id ? { ...x, unread: 0 } : x)),
      )
      try {
        await fetch('/.netlify/functions/regional-manager-api', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'mark_read', token, trainee_id: t.trainee_id }),
        })
      } catch {
        // Non-fatal — the badge is cleared locally; a reload re-syncs.
      }
    }
  }

  async function sendReply(t) {
    const text = replyText.trim()
    if (!text) return
    setSending(true)
    setFlash(null)
    try {
      const res = await fetch('/.netlify/functions/regional-manager-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send_reply', token, trainee_id: t.trainee_id, body: text }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setFlash({ kind: 'error', text: data?.error || 'Could not send.' })
      } else {
        setReplyText('')
        setFlash({ kind: 'success', text: `Reply sent to ${t.rep_name}.` })
        await load()
      }
    } catch (e) {
      setFlash({ kind: 'error', text: e?.message || 'Network error.' })
    } finally {
      setSending(false)
    }
  }

  const totalUnread = (threads || []).reduce((n, t) => n + (t.unread || 0), 0)

  return (
    <section className="mt-8 rounded-lg border border-white/10 bg-white/5 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-amber-200">
          Team Replies
          {totalUnread > 0 && (
            <span className="ml-2 rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white align-middle">
              {totalUnread} new
            </span>
          )}
        </h2>
        <button
          type="button"
          onClick={load}
          className="rounded-md border border-white/20 bg-white/5 px-2.5 py-1 text-xs font-semibold text-white/80 hover:bg-white/10"
          title="Check for new replies"
        >
          ↻ Refresh
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-200/70">
        Replies your reps text back. You can answer right here — it texts them from the
        company line. (These also live in GoHighLevel, the source of truth.)
      </p>

      {error && (
        <div className="mt-3 rounded-md bg-red-500/20 px-3 py-2 text-sm text-red-100">{error}</div>
      )}

      {threads === null ? (
        <p className="mt-3 text-sm text-slate-300">Loading…</p>
      ) : threads.length === 0 ? (
        <p className="mt-3 text-sm text-slate-300">No replies yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-white/10">
          {threads.map((t) => {
            const last = t.messages[t.messages.length - 1]
            const isOpen = openId === t.trainee_id
            return (
              <li key={t.trainee_id} className="py-3">
                <button
                  type="button"
                  onClick={() => openThread(t)}
                  className="flex w-full items-baseline justify-between gap-2 text-left"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="text-base font-semibold">{t.rep_name}</span>
                      {t.unread > 0 && (
                        <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          {t.unread}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-slate-300">
                      {last ? `${last.direction === 'outbound' ? 'You: ' : ''}${last.body}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">
                    {fmtWhen(t.last_at)} {isOpen ? '▾' : '▸'}
                  </span>
                </button>

                {isOpen && (
                  <div className="mt-3 rounded-md border border-white/10 bg-[#0a1730]/60 p-3">
                    <div className="max-h-72 space-y-2 overflow-y-auto">
                      {t.messages.map((m) => (
                        <div
                          key={m.id}
                          className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
                        >
                          <div
                            className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                              m.direction === 'outbound'
                                ? 'bg-amber-500/20 text-amber-50'
                                : 'bg-white/10 text-white'
                            }`}
                          >
                            <div className="whitespace-pre-wrap break-words">{m.body}</div>
                            <div className="mt-1 text-[10px] text-slate-300/70">
                              {m.direction === 'outbound' ? 'You' : t.rep_name} · {fmtWhen(m.created_at)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-3">
                      <textarea
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        rows={2}
                        placeholder={`Reply to ${t.rep_name}…`}
                        className="w-full rounded-md border border-white/20 bg-white/10 px-2 py-1.5 text-sm text-white placeholder:text-slate-400"
                      />
                      <div className="mt-2 flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => sendReply(t)}
                          disabled={sending || !replyText.trim()}
                          className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-[#0a1730] hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {sending ? 'Sending…' : 'Send reply'}
                        </button>
                        {flash && (
                          <span
                            className={`text-xs ${
                              flash.kind === 'error' ? 'text-red-200' : 'text-emerald-200'
                            }`}
                          >
                            {flash.text}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// Compact relative-ish timestamp for the inbox: time-of-day if today,
// otherwise short month/day. Keeps thread rows from wrapping.
function fmtWhen(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}
