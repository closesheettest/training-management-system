// /meet/:room — the company's own meeting room (LiveKit), in place of Zoom (Neal, 2026-10-04).
// Reps/trainees arrive from their own link (?t=<their TMS token>) so the name on their tile
// is their real name; the host signs in with their admin PIN and gets host controls.
// Gallery / speaker view, screen share, chat and the control bar are LiveKit's VideoConference.
import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { LiveKitRoom, VideoConference, PreJoin, useParticipants } from '@livekit/components-react'
import '@livekit/components-styles'

const FN = '/.netlify/functions/meet'
const PIN_KEY = 'meet_host_pin'
const call = async (body) => (await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()

// Host-only panel: everyone in the room, with Mute and Remove, plus Mute everyone.
function HostPanel({ room, pin, onClose }) {
  const people = useParticipants()
  const [msg, setMsg] = useState('')
  const act = async (action, identity, label) => {
    setMsg('')
    const j = await call({ action, room, pin, identity }).catch(() => ({}))
    setMsg(j.ok ? `${label} ✓` : (j.error || 'Did not work'))
  }
  return (
    <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 50, width: 300, maxHeight: '70vh', overflow: 'auto', background: '#111827', border: '1px solid #374151', borderRadius: 12, padding: 12, color: '#e5e7eb', fontSize: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <b style={{ flex: 1 }}>👥 In the room ({people.length})</b>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: 18, cursor: 'pointer' }}>×</button>
      </div>
      <button onClick={() => act('mute_all', null, 'Everyone muted')} style={{ width: '100%', padding: '8px 10px', marginBottom: 8, borderRadius: 8, border: 'none', background: '#b91c1c', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>🔇 Mute everyone</button>
      {msg && <div style={{ fontSize: 12.5, color: '#fcd34d', marginBottom: 6 }}>{msg}</div>}
      {people.map((p) => {
        const me = p.isLocal
        return (
          <div key={p.identity} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0', borderTop: '1px solid #1f2937' }}>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {p.name || p.identity}{me ? ' (you)' : ''}
              <span style={{ marginLeft: 6, fontSize: 12 }}>{p.isCameraEnabled ? '📷' : '🚫📷'}{p.isMicrophoneEnabled ? ' 🎙️' : ' 🔇'}</span>
            </span>
            {!me && <button onClick={() => act('mute', p.identity, `${p.name} muted`)} style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid #4b5563', background: '#1f2937', color: '#fff', cursor: 'pointer' }}>Mute</button>}
            {!me && <button onClick={() => { if (window.confirm(`Remove ${p.name} from the meeting?`)) act('remove', p.identity, `${p.name} removed`) }} style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid #7f1d1d', background: '#450a0a', color: '#fecaca', cursor: 'pointer' }}>Remove</button>}
          </div>
        )
      })}
    </div>
  )
}

export default function Meet() {
  const { room } = useParams()
  const [sp] = useSearchParams()
  const t = sp.get('t') || ''
  const [pin, setPin] = useState(() => { try { return sessionStorage.getItem(PIN_KEY) || '' } catch { return '' } })
  const [pinInput, setPinInput] = useState('')
  const [join, setJoin] = useState(null) // { url, token, name, host, title }
  const [err, setErr] = useState('')
  const [choices, setChoices] = useState(null) // camera/mic picked on the pre-join screen
  const [panel, setPanel] = useState(false)

  useEffect(() => { document.title = join?.title ? `${join.title} · Meeting` : 'Meeting · U.S. Shingle' }, [join])
  useEffect(() => {
    if (join || (!t && !pin)) return
    call({ action: 'join', room, t: pin ? undefined : t, pin: pin || undefined })
      .then((j) => { if (j.ok) setJoin(j); else { setErr(j.error || 'Could not join'); if (pin) { try { sessionStorage.removeItem(PIN_KEY) } catch { /* ignore */ } setPin('') } } })
      .catch(() => setErr('Network error — try again.'))
  }, [room, t, pin]) // eslint-disable-line react-hooks/exhaustive-deps

  const shell = (children) => (
    <div data-lk-theme="default" style={{ minHeight: '100vh', background: '#0b0f17', color: '#e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>{children}</div>
  )

  if (!join) {
    return shell(
      <div style={{ maxWidth: 380, width: '100%', textAlign: 'center' }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>🎥 Meeting</h1>
        {err && <p style={{ color: '#fca5a5', marginBottom: 12 }}>{err}</p>}
        {(t || pin) && !err ? <p style={{ color: '#9ca3af' }}>Getting your seat…</p> : (
          <>
            {!t && <p style={{ color: '#9ca3af', marginBottom: 12 }}>Reps and trainees: open the meeting from the link we texted you. Hosting? Enter your PIN.</p>}
            <input type="password" inputMode="numeric" value={pinInput} onChange={(e) => setPinInput(e.target.value)} placeholder="Host PIN"
              onKeyDown={(e) => { if (e.key === 'Enter' && pinInput.trim()) { setErr(''); try { sessionStorage.setItem(PIN_KEY, pinInput.trim()) } catch { /* ignore */ } setPin(pinInput.trim()) } }}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #374151', background: '#111827', color: '#fff', fontSize: 16, marginBottom: 8 }} />
            <button onClick={() => { if (!pinInput.trim()) return; setErr(''); try { sessionStorage.setItem(PIN_KEY, pinInput.trim()) } catch { /* ignore */ } setPin(pinInput.trim()) }}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>Join as host</button>
          </>
        )}
      </div>
    )
  }

  // Pre-join: check camera and microphone before going in (the name is fixed — it's theirs).
  if (!choices) {
    return shell(
      <div style={{ width: '100%', maxWidth: 560 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, textAlign: 'center', marginBottom: 4 }}>{join.title}</h1>
        <p style={{ textAlign: 'center', color: '#9ca3af', marginBottom: 10 }}>Joining as <b style={{ color: '#fff' }}>{join.name}</b>{join.host ? ' · host' : ''}. Cameras on, please.</p>
        <PreJoin defaults={{ username: join.name, videoEnabled: true, audioEnabled: true }} persistUserChoices={false}
          onSubmit={(c) => setChoices(c)} joinLabel="Join meeting" userLabel="Your name" />
      </div>
    )
  }

  return (
    <div data-lk-theme="default" style={{ height: '100vh', background: '#0b0f17', position: 'relative' }}>
      <LiveKitRoom serverUrl={join.url} token={join.token} connect
        video={choices.videoEnabled ? { deviceId: choices.videoDeviceId } : false}
        audio={choices.audioEnabled ? { deviceId: choices.audioDeviceId } : false}
        onDisconnected={() => { setChoices(null) }} style={{ height: '100%' }}>
        <VideoConference />
        {join.host && !panel && (
          <button onClick={() => setPanel(true)} style={{ position: 'absolute', top: 12, right: 12, zIndex: 50, padding: '8px 12px', borderRadius: 8, border: 'none', background: '#7c3aed', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>👥 Host controls</button>
        )}
        {join.host && panel && <HostPanel room={room} pin={pin} onClose={() => setPanel(false)} />}
      </LiveKitRoom>
    </div>
  )
}
