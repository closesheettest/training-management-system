// /recordings/:room?k=<key> — a meeting room's recordings, each with a Download button
// (Neal, 2026-10-04: "devotional will have devotional recordings"). The link (with its key) is
// shared with whoever downloads them — DeWayne's cousin edits the 9:15 Devotional. Dressed in
// the room's own look. Links are fresh for an hour each time the page loads.
import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { lookOf, FontsFor } from '../lib/meetLooks.jsx'

const when = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

export default function RecordingsPage() {
  const { room } = useParams()
  const [sp] = useSearchParams()
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const load = () => fetch('/.netlify/functions/meet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'rec_list', room, k: sp.get('k') || '' }) })
    .then((r) => r.json()).then((j) => { if (j.ok) setD(j); else setErr(j.error || 'Could not load') }).catch(() => setErr('Network error'))
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // 🗑 Delete (Neal, 2026-10-06) — anyone with this page's private link can delete; just confirm.
  const del = async (id, all) => {
    if (!window.confirm(all ? `Delete ALL ${d.recordings.length} recordings for ${d.room.title}? This can't be undone.` : "Delete this recording? This can't be undone.")) return
    const j = await fetch('/.netlify/functions/meet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'rec_delete', room, k: sp.get('k') || '', ...(all ? { all: true } : { id }) }) }).then((r) => r.json()).catch(() => ({ error: 'Network error' }))
    if (!j.ok) { window.alert(j.error || 'Could not delete.'); return }
    load()
  }
  useEffect(() => { document.title = d ? `${d.room.title} · Recordings` : 'Recordings' }, [d])
  const L = lookOf(d?.room)
  return (
    <div style={{ minHeight: '100vh', background: L.bg, color: L.text, fontFamily: L.fontBody, padding: '28px 16px' }}>
      <FontsFor look={L} />
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        {d?.room?.banner_url && <img src={d.room.banner_url} alt="" style={{ width: '100%', borderRadius: 14, boxShadow: '0 10px 30px rgba(0,0,0,.15)', marginBottom: 18 }} />}
        <h1 style={{ fontFamily: L.fontHead, color: L.head, fontSize: L.light ? 38 : 28, fontWeight: L.light ? 600 : 900, margin: 0 }}>{d ? `${d.room.title} Recordings` : 'Recordings'}</h1>
        {d && <p style={{ color: L.muted, marginTop: 6 }}>Tap Download to save a recording. {d.keep_days ? `Recordings are kept for ${d.keep_days} days.` : ''}
          {d.recordings.length > 0 && <button onClick={() => del(null, true)} style={{ marginLeft: 10, padding: '4px 10px', borderRadius: 8, border: '1px solid #fca5a5', background: 'transparent', color: '#b91c1c', fontWeight: 700, cursor: 'pointer' }}>🗑 Delete all</button>}</p>}
        {err && <p style={{ color: '#b91c1c', fontWeight: 700 }}>{err}</p>}
        {!d && !err && <p style={{ color: L.muted }}>Loading…</p>}
        {d && !d.recordings.length && <p style={{ color: L.muted, marginTop: 18 }}>No recordings yet.</p>}
        {d && d.recordings.map((x, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 12, padding: '14px 16px', borderRadius: 12, background: L.card, border: `1px solid ${L.border}` }}>
            <span style={{ fontSize: 26 }}>🎞</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: L.head, fontFamily: L.light ? L.fontHead : 'inherit', fontSize: L.light ? 20 : 15.5 }}>{when(x.started)}</div>
              <div style={{ fontSize: 13, color: L.muted }}>{x.kind === 'raw' ? "Host's camera only" : 'The meeting as people saw it'}{x.seconds != null ? ` · ${x.seconds < 60 ? `${x.seconds} sec` : `${Math.round(x.seconds / 60)} min`}` : x.minutes ? ` · ${x.minutes} min` : ''}{x.mb ? ` · ${x.mb} MB` : ''}</div>
            </div>
            {x.link ? <a href={x.link} style={{ flexShrink: 0, padding: '10px 16px', borderRadius: 10, background: L.button, color: '#fff', fontWeight: 800, textDecoration: 'none' }}>⬇ Download</a>
              : x.deleted ? <span style={{ fontSize: 13, color: L.muted }}>Deleted (past keep date)</span>
              : x.error ? <span style={{ fontSize: 13, color: '#b91c1c' }}>Didn't save</span>
              : <span style={{ fontSize: 13, color: L.accent || L.muted }}>Processing… <button onClick={load} style={{ marginLeft: 6, background: 'none', border: 'none', color: L.button, textDecoration: 'underline', cursor: 'pointer' }}>refresh</button></span>}
            {x.id && <button title="Delete this recording" onClick={() => del(x.id, false)} style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 10, border: '1px solid #fca5a5', background: 'transparent', color: '#b91c1c', fontSize: 16, cursor: 'pointer' }}>🗑</button>}
          </div>
        ))}
      </div>
    </div>
  )
}
