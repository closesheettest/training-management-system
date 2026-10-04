// 🎙 PODCAST MODE (Neal, 2026-10-04: "a guest speaker or guest host … just shows those two
// people"). The host puts 1–4 people "on stage"; everyone sees only them, side by side with name
// plates in the room's look, and the recording films the same view. Everyone else stays in the
// room (muted), shown as "watching".
import { VideoTrack } from '@livekit/components-react'

export function PodcastStage({ people, look: L, watching, topic }) {
  const n = people.length
  const cols = n <= 1 ? 1 : n === 2 ? 2 : 2
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: L.light ? L.bg : '#070b14', display: 'flex', flexDirection: 'column', padding: '2.5%', boxSizing: 'border-box', gap: '2%' }}>
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gridAutoRows: '1fr', gap: '2.5%' }}>
        {people.map((p) => (
          <div key={p.identity} style={{ position: 'relative', borderRadius: 18, overflow: 'hidden', background: '#000', border: `3px solid ${L.accent || 'rgba(255,255,255,.18)'}`, boxShadow: '0 10px 30px rgba(0,0,0,.35)' }}>
            {p.track ? <VideoTrack trackRef={p.track} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 64, fontWeight: 800 }}>{(p.name || '?').slice(0, 1)}</div>}
            <div style={{ position: 'absolute', left: 16, bottom: 16, padding: '6px 14px', borderRadius: 10, background: L.light ? 'rgba(26,72,112,.92)' : 'rgba(15,23,42,.85)', color: '#fff', fontFamily: L.fontHead && L.fontHead !== 'inherit' ? L.fontHead : 'inherit', fontSize: 'clamp(15px, 1.7vw, 24px)', fontWeight: 700, borderLeft: `4px solid ${L.accent || '#2563eb'}` }}>
              {p.name}{p.speaking ? ' 🎙' : ''}
            </div>
          </div>
        ))}
      </div>
      {watching > 0 && <div style={{ position: 'absolute', right: '3%', top: '3%', padding: '4px 12px', borderRadius: 999, background: 'rgba(0,0,0,.55)', color: '#fff', fontSize: 13, fontWeight: 700 }}>👥 {watching} watching</div>}
    </div>
  )
}
