// /meetings — every meeting room on one page, each with ● LIVE / Next and a Join button
// (Neal, 2026-10-04: a "My meeting rooms" tile on My Tools instead of a tile per room).
// New rooms appear here by themselves. Hosts sign in with their PIN inside the room.
import { useEffect, useState } from 'react'

const when = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export default function MeetingLauncher() {
  const [rooms, setRooms] = useState(null)
  const load = () => fetch('/.netlify/functions/meet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'room_list' }) })
    .then((r) => r.json()).then((j) => setRooms(j.ok ? j.rooms : [])).catch(() => setRooms([]))
  useEffect(() => { document.title = 'My Meeting Rooms'; load(); const t = setInterval(load, 60000); return () => clearInterval(t) }, [])
  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', padding: '24px 16px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <h1 style={{ fontSize: 26, fontWeight: 900, color: '#0f2a4a', margin: '0 0 4px' }}>🎥 My Meeting Rooms</h1>
        <p style={{ color: '#64748b', margin: '0 0 16px', fontSize: 14 }}>Tap Join, then "I'm the host" with your PIN to run a meeting. <a href="/meeting-rooms" style={{ color: '#1d4ed8' }}>Set up rooms →</a></p>
        {rooms === null && <p style={{ color: '#64748b' }}>Loading…</p>}
        {rooms && !rooms.length && <p style={{ color: '#64748b' }}>No rooms yet.</p>}
        {(rooms || []).map((r) => (
          <div key={r.slug} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', marginBottom: 10, borderRadius: 12, background: '#0f172a', color: '#fff', borderLeft: `6px solid ${r.live ? '#dc2626' : r.color || (r.look === 'devotional' ? '#B8893D' : '#334155')}` }}>
            {r.badge ? <img src={r.badge} alt="" style={{ width: 42, height: 42, objectFit: 'contain' }} /> : <span style={{ fontSize: 28 }}>{r.kind === 'prayer' ? '🙏' : r.kind === 'company' ? '🏢' : '🎥'}</span>}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{r.team && <span style={{ color: r.color, marginRight: 6 }}>{r.team}</span>}{r.title}</div>
              <div style={{ fontSize: 12.5, opacity: 0.85 }}>{r.schedule || (r.public ? 'Open to the public' : '')}</div>
              {r.live ? <span style={{ display: 'inline-block', marginTop: 3, padding: '1px 8px', borderRadius: 999, background: '#dc2626', fontSize: 11.5, fontWeight: 900 }}>● LIVE NOW</span>
                : r.scheduled ? <div style={{ fontSize: 12.5, color: '#fcd34d', fontWeight: 700, marginTop: 2 }}>{r.next_at ? `Next: ${when(r.next_at)}` : 'Nothing scheduled yet'}</div> : null}
            </div>
            <a href={r.link} target="_blank" rel="noreferrer" style={{ flexShrink: 0, padding: '9px 16px', borderRadius: 10, background: r.live || r.open ? '#16a34a' : '#475569', color: '#fff', fontWeight: 900, textDecoration: 'none' }}>🎥 Join</a>
          </div>
        ))}
      </div>
    </div>
  )
}
