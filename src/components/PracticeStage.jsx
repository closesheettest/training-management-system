// 🎭 PRACTICE ON STAGE (Neal, 2026-10-04): while a trainee practises with the AI homeowner, everyone
// sees the practice slide full screen, the presenter as a circle, and who the homeowner is. The
// presenter alone gets "🎤 You're up — say hi to start" until they start talking.
import { VideoTrack } from '@livekit/components-react'

export function PracticeStage({ pr, camTrack, me, homeownerTalking, presenterTalked }) {
  const img = pr.page ? `/practice-slides/s-${String(pr.page).padStart(2, '0')}.jpg` : null
  const first = (pr.presenterName || '').split(' ')[0]
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#05080f', overflow: 'hidden' }}>
      {img ? <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
        : (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff', textAlign: 'center', padding: 20 }}>
            <div style={{ fontSize: 'clamp(14px,1.6vw,18px)', letterSpacing: '.3em', textTransform: 'uppercase', color: '#f87171', fontWeight: 800 }}>{pr.section}</div>
            <div style={{ fontFamily: "'Oswald','Arial Narrow',sans-serif", fontSize: 'clamp(34px,6vw,70px)', fontWeight: 700, margin: '10px 0' }}>{pr.door ? '🚪' : '🛋️'} {pr.presenterName} → {pr.homeowner}</div>
          </div>
        )}
      <div style={{ position: 'absolute', left: 14, top: 12, padding: '6px 14px', borderRadius: 10, background: 'rgba(15,23,42,.85)', color: '#fff', fontWeight: 800, fontSize: 15, borderLeft: `4px solid ${homeownerTalking ? '#4ade80' : '#f59e0b'}` }}>
        🏠 {pr.homeowner}{homeownerTalking ? ' · talking…' : ''}
      </div>
      {camTrack && (
        <div style={{ position: 'absolute', right: '2.5%', bottom: '4%', width: 'min(20%, 230px)', aspectRatio: '1 / 1', borderRadius: '50%', overflow: 'hidden', border: '3px solid #f59e0b', boxShadow: '0 6px 20px rgba(0,0,0,.5)', background: '#000' }}>
          <VideoTrack trackRef={camTrack} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      )}
      {me && !presenterTalked && (
        <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 'min(92%, 640px)', padding: '22px 24px', borderRadius: 18, background: 'rgba(22,101,52,.95)', color: '#fff', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,.6)', border: '3px solid #4ade80' }}>
          <div style={{ fontSize: 'clamp(26px,4vw,40px)', fontWeight: 900 }}>🎤 You're up{first ? `, ${first}` : ''}!</div>
          <div style={{ fontSize: 'clamp(16px,2.2vw,22px)', marginTop: 8, lineHeight: 1.4 }}>You're presenting to <b>{pr.homeowner}</b>.<br />{pr.door ? 'Knock knock. Say hi when they open the door.' : 'Say hi to start.'}</div>
          <div style={{ fontSize: 13.5, marginTop: 10, opacity: 0.85 }}>Your microphone is on. Everyone else is muted.</div>
        </div>
      )}
    </div>
  )
}
