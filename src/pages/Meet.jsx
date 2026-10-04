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
import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import {
  LiveKitRoom, PreJoin, GridLayout, CarouselLayout, FocusLayout, FocusLayoutContainer, ParticipantTile,
  ControlBar, Chat, RoomAudioRenderer, LayoutContextProvider, ConnectionStateToast, VideoTrack,
  useTracks, useRoomInfo, useSpeakingParticipants, useParticipants, useLocalParticipant, useCreateLayoutContext, isTrackReference,
} from '@livekit/components-react'
import { Track } from 'livekit-client'
import '@livekit/components-styles'
import MeetPractice from '../components/MeetPractice.jsx'
import ScripturePanel from '../components/ScripturePanel.jsx'
import { ScriptureSlide } from '../components/Scripture.jsx'
import { LOOKS, lookOf, FontsFor } from '../lib/meetLooks.jsx'

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
  const roomMeta = useMemo(() => { try { return JSON.parse(info.metadata || '{}') } catch { return {} } }, [info.metadata])
  const live = roomMeta.topic
  const topic = live !== undefined ? live : room.topic
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const save = async () => {
    setEditing(false)
    await call({ action: 'set_topic', room: room.slug, topic: draft, ...auth }).catch(() => {})
  }
  const color = room.color || '#2563eb'
  const L = lookOf(room)
  const bn = L.banner || { bg: `linear-gradient(90deg, ${color}, ${color}cc)`, color: '#fff', font: "'Oswald', 'Arial Narrow', sans-serif", upper: true }
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px', background: L.bar, color: L.text, borderBottom: L.light ? `1px solid ${L.border}` : 'none' }}>
        {room.banner_url && L.light && <img src={room.banner_url} alt="" style={{ height: 44, borderRadius: 6 }} />}
        {room.badge && <img src={room.badge} alt="" style={{ height: 40, width: 40, objectFit: 'contain' }} />}
        <div style={{ flex: 1, minWidth: 0, fontSize: L.light ? 24 : 17, fontWeight: L.light ? 600 : 900, fontFamily: L.fontHead, color: L.head, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {room.team && <span style={{ color, marginRight: 8 }}>{room.team}</span>}{room.title}
        </div>
        {roomMeta.recording && <span style={{ padding: '3px 10px', borderRadius: 999, background: '#dc2626', color: '#fff', fontWeight: 900, fontSize: 12.5, letterSpacing: '.05em', whiteSpace: 'nowrap', animation: 'recBlink 1.4s ease-in-out infinite' }}>● REC</span>}
        <style>{'@keyframes recBlink{0%,100%{opacity:1}50%{opacity:.45}}'}</style>
        {isHost && !editing && <button onClick={() => { setDraft(topic || ''); setEditing(true) }} style={{ background: 'none', border: '1px solid #334155', borderRadius: 8, padding: '5px 10px', color: '#93c5fd', cursor: 'pointer', fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap' }}>✏️ {topic ? 'Change' : 'Add'} today's topic</button>}
      </div>
      {editing && (
        <div style={{ display: 'flex', gap: 6, padding: '8px 14px', background: L.bar }}>
          <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
            placeholder="e.g. Stop Being Lazy" style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid #475569', background: '#111827', color: '#fff', fontSize: 16 }} />
          <button onClick={save} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#16a34a', color: '#fff', fontWeight: 900, cursor: 'pointer' }}>Show it</button>
          <button onClick={() => setEditing(false)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #475569', background: 'none', color: '#cbd5e1', cursor: 'pointer' }}>Cancel</button>
        </div>
      )}
      {/* TOPIC BANNER (Neal, 2026-10-04: "a banner going across, not this tiny little thing"):
          full width, the team's color, big — everyone sees it, and it changes live. */}
      {topic && !editing && (
        <div style={{ background: bn.bg, color: bn.color, textAlign: 'center', padding: '10px 16px', fontFamily: bn.font, fontSize: bn.upper ? 'clamp(20px, 3.2vw, 34px)' : 'clamp(24px, 3.6vw, 40px)', fontWeight: bn.upper ? 800 : 600, letterSpacing: bn.upper ? '.04em' : '.01em', textTransform: bn.upper ? 'uppercase' : 'none', textShadow: '0 2px 6px rgba(0,0,0,.35)', lineHeight: 1.15, borderTop: `${bn.rule ? 3 : 1}px solid ${bn.rule || 'rgba(255,255,255,.25)'}`, borderBottom: `${bn.rule ? 3 : 1}px solid ${bn.rule || 'rgba(0,0,0,.35)'}` }}>
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
  const [scripturePanel, setScripturePanel] = useState(false)
  const [practice, setPractice] = useState(false) // 🎭 AI homeowner practice (trainer PIN only)
  const [circle, setCircle] = useState(true) // presenter circle — the sharer's choice, on by default
  const [lastSpeaker, setLastSpeaker] = useState(null)
  const layoutContext = useCreateLayoutContext()
  const [showChat, setShowChat] = useState(false)
  const { localParticipant } = useLocalParticipant()
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }, { source: Track.Source.ScreenShare, withPlaceholder: false }], { onlySubscribed: false })
  const speakers = useSpeakingParticipants()
  // ⏺ RECORD: when the host starts recording, EVERYONE switches to speaker view on that host
  // (they can switch back themselves); everyone else is muted by the server.
  const info = useRoomInfo()
  const rmeta = useMemo(() => { try { return JSON.parse(info.metadata || '{}') } catch { return {} } }, [info.metadata])
  const prevRec = useRef(false)
  useEffect(() => {
    if (rmeta.recording && !prevRec.current) { setView('speaker'); setGalleryDuringShare(false); if (rmeta.spotlight) setLastSpeaker(rmeta.spotlight) }
    prevRec.current = !!rmeta.recording
  }, [rmeta.recording, rmeta.spotlight])
  const [recBusy, setRecBusy] = useState(false)
  const [recNote, setRecNote] = useState('')
  const toggleRec = async () => {
    setRecBusy(true); setRecNote('')
    const j = await call({ action: rmeta.recording ? 'record_stop' : 'record_start', room: room.slug, identity: localParticipant?.identity, ...auth }).catch(() => ({}))
    setRecBusy(false)
    if (!j.ok) setRecNote(j.error || 'Did not work'); else if (j.note) setRecNote(j.note)
  }
  useEffect(() => { const s = speakers.find((p) => !p.isLocal) || speakers[0]; if (s) setLastSpeaker(s.identity) }, [speakers])
  // A screen share TAKES OVER for everyone, people in a strip beside it, like Zoom (Neal,
  // 2026-10-04). Someone who presses Gallery during a share gets faces back until it ends.
  const [galleryDuringShare, setGalleryDuringShare] = useState(false)
  const pickView = (v) => { setView(v); setS('meet_view', v, localStorage); setGalleryDuringShare(v === 'gallery' && !!shareRef.current) }
  const shareRef = useRef(null)
  // Everyone's screen has to agree on the sharer's circle, so it rides on their attributes.
  useEffect(() => { localParticipant?.setAttributes?.({ circle: circle ? 'on' : 'off' })?.catch?.(() => {}) }, [circle, localParticipant])

  const share = tracks.find((t) => isTrackReference(t) && t.source === Track.Source.ScreenShare)
  shareRef.current = share || null
  useEffect(() => { if (!share) setGalleryDuringShare(false) }, [!!share]) // eslint-disable-line react-hooks/exhaustive-deps
  const cams = tracks.filter((t) => t.source === Track.Source.Camera)
  // A share shows big for everyone in Speaker view; in Gallery it joins the grid.
  const focus = share && !galleryDuringShare ? share
    : view === 'speaker' && !share ? ((rmeta.recording && cams.find((t) => t.participant.identity === rmeta.spotlight)) || cams.find((t) => t.participant.identity === lastSpeaker) || cams.find((t) => !t.participant.isLocal) || cams[0])
    : null
  const others = focus ? cams.filter((t) => t !== focus) : cams
  const gridTracks = share ? [share, ...cams] : cams
  // Presenter circle: the sharer's own camera in the corner of their shared screen — for a host
  // who has it on and whose camera is on.
  const sharerCam = share ? cams.find((t) => t.participant.identity === share.participant.identity && isTrackReference(t) && !t.publication?.isMuted) : null
  const circleOn = share ? (share.participant.isLocal ? circle : share.participant.attributes?.circle !== 'off') : false
  const showCircle = !!(focus && focus === share && sharerCam && circleOn && metaOf(share.participant).host)

  // 📖 Scripture on screen: a full-screen slide for everyone, the sharing host as a circle.
  const sc = rmeta.scripture && rmeta.scripture.showing ? rmeta.scripture : null
  const scCam = sc ? cams.find((t) => t.participant.identity === sc.by && isTrackReference(t) && !t.publication?.isMuted) : null
  const setScripture = async (next) => { await call({ action: 'set_scripture', room: room.slug, scripture: next, identity: localParticipant?.identity, ...auth }).catch(() => {}) }
  const scriptureRoom = room.kind === 'prayer' || room.look === 'devotional'
  const btn = (on) => ({ padding: '6px 12px', borderRadius: 8, border: '1px solid #475569', background: on ? '#2563eb' : '#1f2937', color: '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer' })
  return (
    <LayoutContextProvider value={layoutContext} onWidgetChange={(w) => setShowChat(!!w.showChat)}>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <TitleBar room={room} auth={auth} isHost={isHost} />
        <div style={{ display: 'flex', gap: 6, padding: '6px 12px', alignItems: 'center', background: lookOf(room).bg }}>
          <span style={{ color: '#94a3b8', fontSize: 13, marginRight: 4 }}>View:</span>
          <button onClick={() => pickView('gallery')} style={btn(share ? galleryDuringShare : view === 'gallery')}>▦ Gallery</button>
          <button onClick={() => pickView('speaker')} style={btn(share ? !galleryDuringShare : view === 'speaker')}>{share ? '🖥 Shared screen' : '◧ Speaker'}</button>
          <span style={{ flex: 1 }} />
          {isHost && scriptureRoom && <button onClick={() => setScripturePanel((x) => !x)} style={{ ...btn(scripturePanel), background: sc ? '#92400e' : '#B8893D', border: 'none', marginRight: 6 }}>📖 {sc ? 'Scripture on' : 'Scripture'}</button>}
          {recNote && <span style={{ fontSize: 12.5, color: '#fcd34d', marginRight: 6 }}>{recNote}</span>}
          {isHost && room.recording_enabled && <button disabled={recBusy} onClick={toggleRec} style={{ ...btn(false), background: rmeta.recording ? '#7f1d1d' : '#dc2626', border: 'none', marginRight: 6 }}>{recBusy ? '…' : rmeta.recording ? '⏹ Stop recording' : '⏺ Record'}</button>}
          {isHost && auth.pin && <button onClick={() => setPractice((x) => !x)} style={{ ...btn(practice), background: '#b45309', border: 'none', marginRight: 6 }}>🎭 Practice</button>}
          {isHost && <button onClick={() => setPanel((x) => !x)} style={{ ...btn(panel), background: '#7c3aed', border: 'none' }}>👥 Host controls</button>}
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
            {sc ? (
              <ScriptureSlide sc={sc} look={lookOf(room)} camTrack={scCam} />
            ) : !focus ? (
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
            {isHost && scripturePanel && <ScripturePanel current={rmeta.scripture} onSet={setScripture} onClose={() => setScripturePanel(false)} />}
            {isHost && auth.pin && practice && <MeetPractice roomSlug={room.slug} pin={auth.pin} onClose={() => setPractice(false)} />}
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
  const [notOpen, setNotOpen] = useState(null) // { next_at } — no meeting on right now
  const [lastBody, setLastBody] = useState(null)

  useEffect(() => { document.title = `${join?.room?.title || door?.title || 'Meeting'} · Meeting` }, [join, door])
  useEffect(() => { call({ action: 'info', room: slug }).then((j) => { if (j.ok) setDoor({ ...j.room, host_code: j.host_code }); else setErr(j.error || 'No such room') }).catch(() => {}) }, [slug])

  const doJoin = async (body) => {
    setBusy(true); setErr('')
    const j = await call({ action: 'join', room: slug, ...body }).catch(() => ({ error: 'Network error — try again.' }))
    setBusy(false)
    if (j.ok) { setJoin(j); setNotOpen(null); return true }
    if (j.not_open) { setLastBody(body); setNotOpen({ next_at: j.room?.next_at || null }); return false }
    setErr(j.error || 'Could not join')
    if (body.pin) { try { sessionStorage.removeItem(PIN_KEY) } catch { /* ignore */ } setAuth(null) }
    return false
  }
  // Their own link, or a PIN already entered this session → straight in.
  useEffect(() => {
    if (auth?.pin) doJoin({ pin: auth.pin })
    else if (auth?.t) doJoin({ t: auth.t })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const L = lookOf(join?.room || door)
  const shell = (children) => (
    <div data-lk-theme="default" style={{ minHeight: '100vh', background: L.bg, color: L.text, fontFamily: L.fontBody, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}><FontsFor look={L} />{children}</div>
  )
  const input = { width: '100%', padding: '10px 12px', borderRadius: 8, border: `1px solid ${L.fieldBorder}`, background: L.field, color: L.fieldText, fontSize: 16, marginBottom: 8 }
  const big = { width: '100%', padding: '11px 12px', borderRadius: 8, border: 'none', background: L.button, color: '#fff', fontWeight: 800, fontSize: 15, cursor: 'pointer' }
  const hTitle = { fontSize: L.light ? 34 : 22, fontWeight: L.light ? 600 : 900, fontFamily: L.fontHead, color: L.head, lineHeight: 1.15 }
  const bannerImg = (r) => r?.banner_url ? <img src={r.banner_url} alt="" style={{ width: '100%', borderRadius: 14, boxShadow: '0 10px 30px rgba(0,0,0,.18)', marginBottom: 14 }} /> : null
  const schedLine = (r) => r?.schedule ? <div style={{ color: L.accent || L.muted, fontSize: 13, fontWeight: 700, letterSpacing: '.18em', textTransform: 'uppercase', marginTop: 4 }}>{r.schedule}</div> : null

  // NO MEETING ON RIGHT NOW (Neal, 2026-10-04): say when the next one is, instead of an empty room.
  if (!join && notOpen && !hostMode) {
    const when = notOpen.next_at ? new Date(notOpen.next_at).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null
    return shell(
      <div style={{ maxWidth: door?.banner_url ? 620 : 420, width: '100%', textAlign: 'center' }}>
        {bannerImg(door)}
        {door?.badge && <img src={door.badge} alt="" style={{ height: 64, marginBottom: 6 }} />}
        <h1 style={hTitle}>{door?.title || 'Meeting'}</h1>
        {schedLine(door)}
        <div style={{ marginTop: 14, padding: '16px 14px', borderRadius: 12, background: L.card, border: `1px solid ${L.border}` }}>
          <div style={{ fontSize: L.light ? 22 : 17, fontWeight: L.light ? 600 : 800, fontFamily: L.light ? L.fontHead : 'inherit', color: L.head }}>There's no {door?.kind === 'company' ? 'company meeting' : door?.kind === 'prayer' ? 'live devotional' : 'meeting'} right now.</div>
          {when ? <div style={{ marginTop: 6, color: L.text, fontSize: 15.5 }}>The next one is <b style={{ color: L.head }}>{when}</b> (Eastern).<br />You can come in 15 minutes early.</div>
            : <div style={{ marginTop: 6, color: L.text }}>Nothing is scheduled yet. Check back later.</div>}
        </div>
        <button onClick={() => doJoin(lastBody || {})} style={{ marginTop: 14, padding: '10px 18px', borderRadius: 8, border: 'none', background: L.button, color: '#fff', fontWeight: 800, cursor: 'pointer' }}>↻ Check again</button>
        {door?.back_url && <div><a href={door.back_url} style={{ display: 'inline-block', marginTop: 10, padding: '10px 18px', borderRadius: 8, border: `2px solid ${L.button}`, color: L.light ? L.button : '#fff', fontWeight: 700, textDecoration: 'none' }}>{door.back_label || 'Watch past meetings'}</a></div>}
        <div><button onClick={() => { setErr(''); setHostMode(true) }} style={{ marginTop: 14, background: 'none', border: 'none', color: '#64748b', fontSize: 13, cursor: 'pointer' }}>I'm the host</button></div>
      </div>
    )
  }

  if (!join) {
    const header = door && (
      <div style={{ marginBottom: 14 }}>
        {bannerImg(door)}
        {door.badge && <img src={door.badge} alt="" style={{ height: 64, marginBottom: 6 }} />}
        {schedLine(door)}
        <h1 style={{ ...hTitle, marginTop: 6 }}>{door.team && <span style={{ color: door.color, marginRight: 8 }}>{door.team}</span>}{door.title}</h1>
        {door.welcome && <p style={{ color: L.text, marginTop: 8, fontSize: 16, lineHeight: 1.5 }}>{door.welcome}</p>}
        {door.topic && <p style={{ color: L.head, marginTop: 8, fontFamily: L.fontHead, fontSize: L.light ? 22 : 16, fontWeight: 600 }}>{door.topic}</p>}
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
      <div style={{ maxWidth: door?.banner_url ? 620 : 400, width: '100%', textAlign: 'center' }}>
        {header || <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>🎥 Meeting</h1>}
        {err && <p style={{ color: '#fca5a5', marginBottom: 12 }}>{err}</p>}
        {busy || (!hostMode && auth && (auth.t || auth.pin) && !err) ? <p style={{ color: '#9ca3af' }}>Getting your seat…</p>
          : door?.public && !hostMode ? (
            <>
              <p style={{ color: L.muted, marginBottom: 12 }}>Welcome! Tell us who you are to join.</p>
              <input value={guest.name} onChange={(e) => setGuest({ ...guest, name: e.target.value })} placeholder="Your name" autoComplete="name" style={input} />
              <input type="email" value={guest.email} onChange={(e) => setGuest({ ...guest, email: e.target.value })} placeholder="Your email" autoComplete="email" style={input} />
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', textAlign: 'left', fontSize: 13.5, color: L.text, margin: '2px 0 12px' }}>
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
        <h1 style={{ ...hTitle, textAlign: 'center', marginBottom: 4 }}>{join.room?.title || join.title}</h1>
        <p style={{ textAlign: 'center', color: '#9ca3af', marginBottom: 10 }}>Joining as <b style={{ color: L.head }}>{join.name}</b>{join.host ? ' · host' : ''}.{join.room?.cameras_required ? ' Cameras on, please.' : ''}</p>
        <PreJoin defaults={{ username: join.name, videoEnabled: true, audioEnabled: true }} persistUserChoices={false}
          onValidate={() => true} onSubmit={(c) => setChoices(c || {})} joinLabel="Join meeting" userLabel="Your name" />
      </div>
    )
  }

  return (
    <div data-lk-theme="default" style={{ height: '100vh', background: L.bg, fontFamily: L.fontBody }}>
      <FontsFor look={L} />
      <LiveKitRoom serverUrl={join.url} token={join.token} connect
        video={choices.videoEnabled ? { deviceId: choices.videoDeviceId } : false}
        audio={choices.audioEnabled ? { deviceId: choices.audioDeviceId } : false}
        onDisconnected={() => setChoices(null)} style={{ height: '100%' }}>
        <Stage room={join.room || { slug, title: join.title }} auth={auth || {}} isHost={join.host} />
      </LiveKitRoom>
    </div>
  )
}
