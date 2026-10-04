// /meet/:room — the company's own meeting room (LiveKit), in place of Zoom (Neal, 2026-10-04).
//
// Who gets in:
//   • reps / trainees / managers — their own link (?t=<their TMS token>); the name is theirs
//   • an admin — their PIN (host)
//   • a room's own host code — for a host who isn't in TMS (the prayer leader)
//   • PUBLIC rooms (the prayer call) — anyone, with name + email; that's the host's email list
//
// On screen: a title bar (team badge + name for a zone room, the room title, and the host's
// TOPIC line — "Today: Psalm 23" — that changes live for everyone), each person's own choice
// of Gallery or Speaker view (like Zoom), screen share with the PRESENTER CIRCLE (the host's
// camera in the bottom-right of the shared screen, the corner the slides keep empty), chat,
// and host controls.
import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import {
  LiveKitRoom, PreJoin, GridLayout, CarouselLayout, FocusLayout, FocusLayoutContainer, ParticipantTile,
  ControlBar, Chat, RoomAudioRenderer, LayoutContextProvider, ConnectionStateToast, VideoTrack,
  useTracks, useRoomInfo, useSpeakingParticipants, useParticipants, useLocalParticipant, useCreateLayoutContext, isTrackReference,
} from '@livekit/components-react'
import { Track } from 'livekit-client'
import '@livekit/components-styles'

const FN = '/.netlify/functions/meet'
const PIN_KEY = 'meet_host_pin'
const GUEST_KEY = 'meet_guest'
const call = async (body) => (await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()
const getS = (k, s) => { try { return (s || sessionStorage).getItem(k) || '' } catch { return '' } }
const setS = (k, v, s) => { try { (s || sessionStorage).setItem(k, v) } catch { /* private mode */ } }
const metaOf = (p) => { try { return JSON.parse(p?.metadata || '{}') } catch { return {} } }

// The bar across the top: badge, team, title, and the topic line (host can edit it live).
function TitleBar({ room, auth, isHost }) {
  const info = useRoomInfo()
  const live = useMemo(() => { try { return JSON.parse(info.metadata || '{}').topic } catch { return undefined } }, [info.metadata])
  const topic = live !== undefined ? live : room.topic
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const save = async () => {
    setEditing(false)
    await call({ action: 'set_topic', room: room.slug, topic: draft, ...auth }).catch(() => {})
  }
  const color = room.color || '#2563eb'
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px', background: '#0f172a', color: '#e5e7eb' }}>
        {room.badge && <img src={room.badge} alt="" style={{ height: 40, width: 40, objectFit: 'contain' }} />}
        <div style={{ flex: 1, minWidth: 0, fontSize: 17, fontWeight: 900, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {room.team && <span style={{ color, marginRight: 8 }}>{room.team}</span>}{room.title}
        </div>
        {isHost && !editing && <button onClick={() => { setDraft(topic || ''); setEditing(true) }} style={{ background: 'none', border: '1px solid #334155', borderRadius: 8, padding: '5px 10px', color: '#93c5fd', cursor: 'pointer', fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap' }}>✏️ {topic ? 'Change' : 'Add'} today's topic</button>}
      </div>
      {editing && (
        <div style={{ display: 'flex', gap: 6, padding: '8px 14px', background: '#0f172a' }}>
          <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
            placeholder="e.g. Stop Being Lazy" style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid #475569', background: '#111827', color: '#fff', fontSize: 16 }} />
          <button onClick={save} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#16a34a', color: '#fff', fontWeight: 900, cursor: 'pointer' }}>Show it</button>
          <button onClick={() => setEditing(false)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #475569', background: 'none', color: '#cbd5e1', cursor: 'pointer' }}>Cancel</button>
        </div>
      )}
      {/* TOPIC BANNER (Neal, 2026-10-04: "a banner going across, not this tiny little thing"):
          full width, the team's color, big — everyone sees it, and it changes live. */}
      {topic && !editing && (
        <div style={{ background: `linear-gradient(90deg, ${color}, ${color}cc)`, color: '#fff', textAlign: 'center', padding: '10px 16px', fontFamily: "'Oswald', 'Arial Narrow', sans-serif", fontSize: 'clamp(20px, 3.2vw, 34px)', fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', textShadow: '0 2px 6px rgba(0,0,0,.35)', lineHeight: 1.15, borderTop: '1px solid rgba(255,255,255,.25)', borderBottom: '1px solid rgba(0,0,0,.35)' }}>
          {topic}
        </div>
      )}
    </div>
  )
}

// Host-only panel: everyone in the room, with Mute and Remove, plus Mute everyone.
function HostPanel({ room, auth, onClose, circle, setCircle }) {
  const people = useParticipants()
  const [msg, setMsg] = useState('')
  const act = async (action, identity, label) => {
    setMsg('')
    const j = await call({ action, room: room.slug, identity, ...auth }).catch(() => ({}))
    setMsg(j.ok ? `${label} ✓` : (j.error || 'Did not work'))
  }
  return (
    <div style={{ position: 'absolute', top: 8, right: 12, zIndex: 50, width: 310, maxHeight: '70vh', overflow: 'auto', background: '#111827', border: '1px solid #374151', borderRadius: 12, padding: 12, color: '#e5e7eb', fontSize: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <b style={{ flex: 1 }}>👥 In the room ({people.length})</b>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: 18, cursor: 'pointer' }}>×</button>
      </div>
      <button onClick={() => act('mute_all', null, 'Everyone muted')} style={{ width: '100%', padding: '8px 10px', marginBottom: 8, borderRadius: 8, border: 'none', background: '#b91c1c', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>🔇 Mute everyone</button>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 13.5 }}>
        <input type="checkbox" checked={circle} onChange={(e) => setCircle(e.target.checked)} /> Show my camera as a circle on my shared screen
      </label>
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

// The stage. Each person picks their own view, like Zoom:
//   Gallery — everyone in tiles (pages when the class is big); a shared screen joins the grid
//   Speaker — whoever is talking big (or the shared screen), everyone else in a strip
function Stage({ room, auth, isHost }) {
  const [view, setView] = useState(() => getS('meet_view', localStorage) || 'gallery')
  const [panel, setPanel] = useState(false)
  const [circle, setCircle] = useState(true) // presenter circle — the sharer's choice, on by default
  const [lastSpeaker, setLastSpeaker] = useState(null)
  const layoutContext = useCreateLayoutContext()
  const [showChat, setShowChat] = useState(false)
  const { localParticipant } = useLocalParticipant()
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }, { source: Track.Source.ScreenShare, withPlaceholder: false }], { onlySubscribed: false })
  const speakers = useSpeakingParticipants()
  useEffect(() => { const s = speakers.find((p) => !p.isLocal) || speakers[0]; if (s) setLastSpeaker(s.identity) }, [speakers])
  const pickView = (v) => { setView(v); setS('meet_view', v, localStorage) }
  // Everyone's screen has to agree on the sharer's circle, so it rides on their attributes.
  useEffect(() => { localParticipant?.setAttributes?.({ circle: circle ? 'on' : 'off' })?.catch?.(() => {}) }, [circle, localParticipant])

  const share = tracks.find((t) => isTrackReference(t) && t.source === Track.Source.ScreenShare)
  const cams = tracks.filter((t) => t.source === Track.Source.Camera)
  // A share shows big for everyone in Speaker view; in Gallery it joins the grid.
  const focus = view === 'speaker'
    ? (share || cams.find((t) => t.participant.identity === lastSpeaker) || cams.find((t) => !t.participant.isLocal) || cams[0])
    : null
  const others = focus ? cams.filter((t) => t !== focus) : cams
  const gridTracks = share ? [share, ...cams] : cams
  // Presenter circle: the sharer's own camera in the corner of their shared screen — for a host
  // who has it on and whose camera is on.
  const sharerCam = share ? cams.find((t) => t.participant.identity === share.participant.identity && isTrackReference(t) && !t.publication?.isMuted) : null
  const circleOn = share ? (share.participant.isLocal ? circle : share.participant.attributes?.circle !== 'off') : false
  const showCircle = !!(focus && focus === share && sharerCam && circleOn && metaOf(share.participant).host)

  const btn = (on) => ({ padding: '6px 12px', borderRadius: 8, border: '1px solid #475569', background: on ? '#2563eb' : '#1f2937', color: '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer' })
  return (
    <LayoutContextProvider value={layoutContext} onWidgetChange={(w) => setShowChat(!!w.showChat)}>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <TitleBar room={room} auth={auth} isHost={isHost} />
        <div style={{ display: 'flex', gap: 6, padding: '6px 12px', alignItems: 'center', background: '#0b0f17' }}>
          <span style={{ color: '#94a3b8', fontSize: 13, marginRight: 4 }}>View:</span>
          <button onClick={() => pickView('gallery')} style={btn(view === 'gallery')}>▦ Gallery</button>
          <button onClick={() => pickView('speaker')} style={btn(view === 'speaker')}>◧ Speaker</button>
          <span style={{ flex: 1 }} />
          {isHost && <button onClick={() => setPanel((x) => !x)} style={{ ...btn(panel), background: '#7c3aed', border: 'none' }}>👥 Host controls</button>}
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
            {!focus ? (
              <GridLayout tracks={gridTracks} style={{ height: '100%' }}><ParticipantTile /></GridLayout>
            ) : (
              <FocusLayoutContainer style={{ height: '100%' }}>
                <CarouselLayout tracks={others}><ParticipantTile /></CarouselLayout>
                <div style={{ position: 'relative', height: '100%', width: '100%' }}>
                  <FocusLayout trackRef={focus} style={{ height: '100%' }} />
                  {showCircle && (
                    <div style={{ position: 'absolute', right: '2.5%', bottom: '4%', width: 'min(22%, 230px)', aspectRatio: '1 / 1', borderRadius: '50%', overflow: 'hidden', border: '3px solid rgba(255,255,255,.85)', boxShadow: '0 6px 20px rgba(0,0,0,.5)', zIndex: 5, background: '#000' }}>
                      <VideoTrack trackRef={sharerCam} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                  )}
                </div>
              </FocusLayoutContainer>
            )}
            {isHost && panel && <HostPanel room={room} auth={auth} onClose={() => setPanel(false)} circle={circle} setCircle={setCircle} />}
          </div>
          <Chat style={{ display: showChat ? 'grid' : 'none', width: 320 }} />
        </div>
        <ControlBar controls={{ chat: true, screenShare: true, camera: true, microphone: true, leave: true }} />
      </div>
      <RoomAudioRenderer />
      <ConnectionStateToast />
    </LayoutContextProvider>
  )
}

export default function Meet() {
  const { room: slug } = useParams()
  const [sp] = useSearchParams()
  const t = sp.get('t') || ''
  const [door, setDoor] = useState(null) // the room's public info, before signing in
  const [auth, setAuth] = useState(() => (getS(PIN_KEY) ? { pin: getS(PIN_KEY) } : t ? { t } : null))
  const [guest, setGuest] = useState(() => { try { return JSON.parse(getS(GUEST_KEY, localStorage) || 'null') || { name: '', email: '', opt_in: false } } catch { return { name: '', email: '', opt_in: false } } })
  const [hostMode, setHostMode] = useState(false)
  const [codeInput, setCodeInput] = useState('')
  const [hostName, setHostName] = useState('')
  const [join, setJoin] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [choices, setChoices] = useState(null)

  useEffect(() => { document.title = `${join?.room?.title || door?.title || 'Meeting'} · Meeting` }, [join, door])
  useEffect(() => { call({ action: 'info', room: slug }).then((j) => { if (j.ok) setDoor({ ...j.room, host_code: j.host_code }); else setErr(j.error || 'No such room') }).catch(() => {}) }, [slug])

  const doJoin = async (body) => {
    setBusy(true); setErr('')
    const j = await call({ action: 'join', room: slug, ...body }).catch(() => ({ error: 'Network error — try again.' }))
    setBusy(false)
    if (j.ok) { setJoin(j); return true }
    setErr(j.error || 'Could not join')
    if (body.pin) { try { sessionStorage.removeItem(PIN_KEY) } catch { /* ignore */ } setAuth(null) }
    return false
  }
  // Their own link, or a PIN already entered this session → straight in.
  useEffect(() => {
    if (auth?.pin) doJoin({ pin: auth.pin })
    else if (auth?.t) doJoin({ t: auth.t })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const shell = (children) => (
    <div data-lk-theme="default" style={{ minHeight: '100vh', background: '#0b0f17', color: '#e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>{children}</div>
  )
  const input = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #374151', background: '#111827', color: '#fff', fontSize: 16, marginBottom: 8 }
  const big = { width: '100%', padding: '11px 12px', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', fontWeight: 800, fontSize: 15, cursor: 'pointer' }

  if (!join) {
    const header = door && (
      <div style={{ marginBottom: 14 }}>
        {door.badge && <img src={door.badge} alt="" style={{ height: 64, marginBottom: 6 }} />}
        <h1 style={{ fontSize: 22, fontWeight: 900 }}>{door.team && <span style={{ color: door.color, marginRight: 8 }}>{door.team}</span>}{door.title}</h1>
        {door.topic && <p style={{ color: '#cbd5e1', marginTop: 4 }}>{door.topic}</p>}
        {door.schedule && <p style={{ color: '#94a3b8', fontSize: 13.5, marginTop: 2 }}>{door.schedule}</p>}
      </div>
    )
    const hostJoin = async () => {
      const c = codeInput.trim(); if (!c) return
      // Try it as an admin PIN first, then as this room's own host code.
      setBusy(true); setErr('')
      const asPin = await call({ action: 'join', room: slug, pin: c }).catch(() => ({}))
      setBusy(false)
      if (asPin.ok) { setS(PIN_KEY, c); setAuth({ pin: c }); setJoin(asPin); return }
      if (door?.host_code) { setAuth({ host_code: c }); doJoin({ host_code: c, name: hostName.trim() }) } else setErr('PIN not recognised.')
    }
    return shell(
      <div style={{ maxWidth: 400, width: '100%', textAlign: 'center' }}>
        {header || <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>🎥 Meeting</h1>}
        {err && <p style={{ color: '#fca5a5', marginBottom: 12 }}>{err}</p>}
        {busy || (auth && (auth.t || auth.pin) && !err) ? <p style={{ color: '#9ca3af' }}>Getting your seat…</p>
          : door?.public && !hostMode ? (
            <>
              <p style={{ color: '#9ca3af', marginBottom: 12 }}>Welcome! Tell us who you are to join.</p>
              <input value={guest.name} onChange={(e) => setGuest({ ...guest, name: e.target.value })} placeholder="Your name" autoComplete="name" style={input} />
              <input type="email" value={guest.email} onChange={(e) => setGuest({ ...guest, email: e.target.value })} placeholder="Your email" autoComplete="email" style={input} />
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', textAlign: 'left', fontSize: 13.5, color: '#cbd5e1', margin: '2px 0 12px' }}>
                <input type="checkbox" checked={!!guest.opt_in} onChange={(e) => setGuest({ ...guest, opt_in: e.target.checked })} style={{ marginTop: 3 }} />
                Email me the {door.title} link and updates. I can unsubscribe any time.
              </label>
              <button disabled={busy} onClick={() => { setS(GUEST_KEY, JSON.stringify(guest), localStorage); doJoin({ guest }) }} style={big}>Join</button>
              <button onClick={() => { setErr(''); setHostMode(true) }} style={{ marginTop: 14, background: 'none', border: 'none', color: '#64748b', fontSize: 13, cursor: 'pointer' }}>I'm the host</button>
            </>
          ) : (
            <>
              {!door?.public && <p style={{ color: '#9ca3af', marginBottom: 12 }}>Reps and trainees: open the meeting from the link we texted you. Hosting? Sign in below.</p>}
              <input type="password" value={codeInput} onChange={(e) => setCodeInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') hostJoin() }} placeholder={door?.host_code ? 'Host code or admin PIN' : 'Admin PIN'} style={input} />
              {door?.host_code && <input value={hostName} onChange={(e) => setHostName(e.target.value)} placeholder="Your name (shown on your tile)" style={input} />}
              <button disabled={busy} onClick={hostJoin} style={big}>Join as host</button>
              {door?.public && <button onClick={() => { setErr(''); setHostMode(false) }} style={{ marginTop: 14, background: 'none', border: 'none', color: '#64748b', fontSize: 13, cursor: 'pointer' }}>← Join as a guest</button>}
            </>
          )}
      </div>
    )
  }

  // Pre-join: check camera and microphone before going in (the name is fixed — it's theirs).
  if (!choices) {
    return shell(
      <div style={{ width: '100%', maxWidth: 560 }}>
        <style>{'.lk-prejoin .lk-username-container input, .lk-prejoin input#username { display: none !important; }'}</style>
        <h1 style={{ fontSize: 20, fontWeight: 800, textAlign: 'center', marginBottom: 4 }}>{join.room?.title || join.title}</h1>
        <p style={{ textAlign: 'center', color: '#9ca3af', marginBottom: 10 }}>Joining as <b style={{ color: '#fff' }}>{join.name}</b>{join.host ? ' · host' : ''}.{join.room?.cameras_required ? ' Cameras on, please.' : ''}</p>
        <PreJoin defaults={{ username: join.name, videoEnabled: true, audioEnabled: true }} persistUserChoices={false}
          onValidate={() => true} onSubmit={(c) => setChoices(c || {})} joinLabel="Join meeting" userLabel="Your name" />
      </div>
    )
  }

  return (
    <div data-lk-theme="default" style={{ height: '100vh', background: '#0b0f17' }}>
      <LiveKitRoom serverUrl={join.url} token={join.token} connect
        video={choices.videoEnabled ? { deviceId: choices.videoDeviceId } : false}
        audio={choices.audioEnabled ? { deviceId: choices.audioDeviceId } : false}
        onDisconnected={() => setChoices(null)} style={{ height: '100%' }}>
        <Stage room={join.room || { slug, title: join.title }} auth={auth || {}} isHost={join.host} />
      </LiveKitRoom>
    </div>
  )
}
