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
  useTracks, useRoomInfo, useSpeakingParticipants, useParticipants, useLocalParticipant, useCreateLayoutContext, isTrackReference, useRoomContext,
} from '@livekit/components-react'
import { Track, RoomEvent } from 'livekit-client'
import '@livekit/components-styles'
import MeetPractice from '../components/MeetPractice.jsx'
import ScripturePanel from '../components/ScripturePanel.jsx'
import { ScriptureSlide } from '../components/Scripture.jsx'
import { PodcastStage } from '../components/PodcastStage.jsx'
import CompanyLobby from '../components/CompanyLobby.jsx'
import { PracticeStage } from '../components/PracticeStage.jsx'
import { decksFor, DeckView, deckOf } from '../components/Decks.jsx'
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
  const ctx = useRoomContext()
  const info = useRoomInfo()
  const stage = useMemo(() => { try { return JSON.parse(info.metadata || '{}').stage || [] } catch { return [] } }, [info.metadata])
  const [msg, setMsg] = useState('')
  const setStage = async (next, label) => {
    setMsg('')
    const j = await call({ action: 'set_stage', room: room.slug, stage: next, ...auth }).catch(() => ({}))
    setMsg(j.ok ? label : (j.error || 'Did not work'))
  }
  // UNMUTE (Neal, 2026-10-04): the host's page tells that person's device to turn its own mic
  // back on (a server can't switch someone's mic on). Receivers only obey a host.
  const unmute = async (identities, label) => {
    setMsg('')
    try {
      await ctx.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ type: 'unmute' })), { reliable: true, topic: 'host', ...(identities ? { destinationIdentities: identities } : {}) })
      setMsg(`${label} ✓`)
    } catch { setMsg('Did not work') }
  }
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
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <button onClick={() => act('mute_all', null, 'Everyone muted')} style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: 'none', background: '#b91c1c', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>🔇 Mute everyone</button>
        <button onClick={() => unmute(null, 'Everyone unmuted')} style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: 'none', background: '#15803d', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>🎙 Unmute everyone</button>
      </div>
      <div style={{ fontSize: 12.5, color: '#94a3b8', margin: '2px 0 6px' }}>🎙 <b style={{ color: '#e5e7eb' }}>Podcast mode</b>: tap ⭐ to put up to 4 people on stage. Everyone sees only them; everyone else is muted.</div>
      {stage.length > 0 && <button onClick={() => setStage([], 'Back to the normal view')} style={{ width: '100%', padding: '7px 10px', marginBottom: 8, borderRadius: 8, border: '1px solid #f59e0b', background: '#422006', color: '#fcd34d', fontWeight: 800, cursor: 'pointer' }}>⏹ Leave podcast mode ({stage.length} on stage)</button>}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 13.5 }}>
        <input type="checkbox" checked={circle} onChange={(e) => setCircle(e.target.checked)} /> Show my camera as a circle on my shared screen
      </label>
      {msg && <div style={{ fontSize: 12.5, color: '#fcd34d', marginBottom: 6 }}>{msg}</div>}
      {people.map((p) => {
        const me = p.isLocal
        return (
          <div key={p.identity} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0', borderTop: '1px solid #1f2937' }}>
            <button title={stage.includes(p.identity) ? 'Take off stage' : 'Put on stage'} onClick={() => {
              const on = stage.includes(p.identity)
              if (!on && stage.length >= 4) { setMsg('Up to 4 people on stage'); return }
              setStage(on ? stage.filter((x) => x !== p.identity) : [...stage, p.identity], on ? `${p.name} off stage` : `${p.name} on stage`)
            }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, padding: 0, opacity: stage.includes(p.identity) ? 1 : 0.35 }}>⭐</button>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {p.name || p.identity}{me ? ' (you)' : ''}
              <span style={{ marginLeft: 6, fontSize: 12 }}>{p.isCameraEnabled ? '📷' : '🚫📷'}</span>
              <span style={{ marginLeft: 6, fontSize: 11.5, fontWeight: 800, padding: '1px 6px', borderRadius: 999, background: p.isMicrophoneEnabled ? '#14532d' : '#7f1d1d', color: '#fff' }}>{p.isMicrophoneEnabled ? '🎙️ on' : '🔇 muted'}</span>
            </span>
            {!me && (p.isMicrophoneEnabled
              ? <button onClick={() => act('mute', p.identity, `${p.name} muted`)} style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid #4b5563', background: '#1f2937', color: '#fff', cursor: 'pointer' }}>Mute</button>
              : <button onClick={() => unmute([p.identity], `${p.name} unmuted`)} style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid #15803d', background: '#14532d', color: '#fff', cursor: 'pointer' }}>Unmute</button>)}
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
  const [deckPanel, setDeckPanel] = useState(false)
  const deckApi = useRef(null)
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
  // A host asked us to unmute → turn our own mic on (only a host's request counts).
  const roomCtx = useRoomContext()
  useEffect(() => {
    const onData = (payload, from, _k, topic) => {
      if (topic !== 'host' || !from || !metaOf(from).host) return
      let m = {}; try { m = JSON.parse(new TextDecoder().decode(payload)) } catch { return }
      if (m.type === 'unmute') roomCtx.localParticipant.setMicrophoneEnabled(true).catch(() => {})
    }
    roomCtx.on(RoomEvent.DataReceived, onData)
    return () => { roomCtx.off(RoomEvent.DataReceived, onData) }
  }, [roomCtx])
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
  // 🎙 Podcast mode: only the people on stage, side by side. Being put on stage unmutes you.
  const stageIds = Array.isArray(rmeta.stage) ? rmeta.stage : []
  const amOnStage = !!localParticipant && stageIds.includes(localParticipant.identity)
  const wasOnStage = useRef(false)
  useEffect(() => { if (amOnStage && !wasOnStage.current) localParticipant.setMicrophoneEnabled(true).catch(() => {}); wasOnStage.current = amOnStage }, [amOnStage]) // eslint-disable-line react-hooks/exhaustive-deps
  const speakingIds = new Set(speakers.map((x) => x.identity))
  const stagePeople = stageIds.map((id) => {
    const cam = cams.find((t) => t.participant.identity === id)
    const part = cam?.participant
    return part ? { identity: id, name: part.name || id, track: isTrackReference(cam) && !cam.publication?.isMuted ? cam : null, speaking: speakingIds.has(id) } : null
  }).filter(Boolean)
  const podcast = stagePeople.length > 0 && !sc && !(share && !galleryDuringShare) && view !== 'gallery-override'
  const scCam = sc ? cams.find((t) => t.participant.identity === sc.by && isTrackReference(t) && !t.publication?.isMuted) : null
  const setScripture = async (next) => { await call({ action: 'set_scripture', room: room.slug, scripture: next, identity: localParticipant?.identity, ...auth }).catch(() => {}) }
  const scriptureRoom = room.kind === 'prayer' || room.look === 'devotional'
  // 🎭 Practice on stage: the slide full screen, presenter circle, "say hi" for the presenter.
  const pr = rmeta.practice && rmeta.practice.showing ? rmeta.practice : null
  const prCam = pr ? cams.find((t) => t.participant.identity === pr.presenter && isTrackReference(t) && !t.publication?.isMuted) : null
  const [prTalked, setPrTalked] = useState(false)
  useEffect(() => { if (!pr) setPrTalked(false); else if (speakers.some((x) => x.identity === pr.presenter)) setPrTalked(true) }, [pr?.presenter, pr?.showing, speakers]) // eslint-disable-line react-hooks/exhaustive-deps
  // 📊 The deck being presented (Week A day decks / Week B), and whether I'm the one driving it.
  const dk = rmeta.deck && rmeta.deck.showing && deckOf(rmeta.deck.key) ? rmeta.deck : null
  const iPresent = !!dk && isHost && dk.by === localParticipant?.identity
  const dkCam = dk ? cams.find((t) => t.participant.identity === dk.by && isTrackReference(t) && !t.publication?.isMuted) : null
  const setDeck = (next) => call({ action: 'set_deck', room: room.slug, deck: next, identity: localParticipant?.identity, ...auth }).catch(() => {})
  useEffect(() => {
    if (!iPresent) return
    const onKey = (e) => { if (/INPUT|TEXTAREA/.test(e.target.tagName)) return; if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); deckApi.current?.next() } if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); deckApi.current?.prev() } }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [iPresent])
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
          {isHost && !scriptureRoom && <button onClick={() => setDeckPanel((x) => !x)} style={{ ...btn(deckPanel), background: dk ? '#1e40af' : '#2563eb', border: 'none', marginRight: 6 }}>📊 {dk ? 'Presenting' : 'Present'}</button>}
          {isHost && scriptureRoom && <button onClick={() => setScripturePanel((x) => !x)} style={{ ...btn(scripturePanel), background: sc ? '#92400e' : '#B8893D', border: 'none', marginRight: 6 }}>📖 {sc ? 'Scripture on' : 'Scripture'}</button>}
          {recNote && <span style={{ fontSize: 12.5, color: '#fcd34d', marginRight: 6 }}>{recNote}</span>}
          {isHost && room.recording_enabled && <button disabled={recBusy} onClick={toggleRec} style={{ ...btn(false), background: rmeta.recording ? '#7f1d1d' : '#dc2626', border: 'none', marginRight: 6 }}>{recBusy ? '…' : rmeta.recording ? '⏹ Stop recording' : '⏺ Record'}</button>}
          {isHost && auth.pin && !scriptureRoom && <button onClick={() => setPractice((x) => !x)} style={{ ...btn(practice), background: '#b45309', border: 'none', marginRight: 6 }}>🎭 Practice</button>}
          {isHost && <button onClick={() => setPanel((x) => !x)} style={{ ...btn(panel), background: '#7c3aed', border: 'none' }}>👥 Host controls</button>}
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
            {pr ? (
              <PracticeStage pr={pr} camTrack={prCam} me={localParticipant?.identity === pr.presenter} homeownerTalking={speakers.some((x) => /^homeowner/.test(x.identity))} presenterTalked={prTalked} />
            ) : sc ? (
              <ScriptureSlide sc={sc} look={lookOf(room)} camTrack={scCam} />
            ) : dk ? (
              <DeckView deck={dk.key} pos={dk.pos} host={iPresent} apiRef={deckApi} camTrack={dkCam} onMove={(pos) => setDeck({ ...dk, pos, showing: true })} />
            ) : podcast ? (
              <PodcastStage people={stagePeople} look={lookOf(room)} watching={Math.max(0, cams.length - stagePeople.length)} />
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
            {isHost && deckPanel && (
              <div style={{ position: 'absolute', top: 8, left: 12, zIndex: 60, width: 320, maxHeight: '80vh', overflow: 'auto', background: '#111827', border: '1px solid #2563eb', borderRadius: 12, padding: 12, color: '#e5e7eb', fontSize: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}><b style={{ flex: 1 }}>📊 Present</b><button onClick={() => setDeckPanel(false)} style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: 18, cursor: 'pointer' }}>×</button></div>
                {dk && (
                  <>
                    <div style={{ fontWeight: 800, marginBottom: 6 }}>{deckOf(dk.key)?.label}</div>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                      <button onClick={() => deckApi.current?.prev()} style={{ flex: 1, padding: '8px', borderRadius: 8, border: 'none', background: '#1f2937', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>◀ Back</button>
                      <button onClick={() => deckApi.current?.next()} style={{ flex: 2, padding: '8px', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>Next ▶</button>
                    </div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>Arrow keys work too. Everyone's screen follows you.</div>
                    <button onClick={() => setDeck({ ...dk, showing: false })} style={{ width: '100%', padding: '8px', borderRadius: 8, border: 'none', background: '#b91c1c', color: '#fff', fontWeight: 800, cursor: 'pointer', marginBottom: 10 }}>⏹ Stop presenting</button>
                  </>
                )}
                <div style={{ fontSize: 12.5, color: '#94a3b8', marginBottom: 6 }}>{dk ? 'Switch to:' : 'Pick what to show everyone:'}</div>
                {decksFor(room).map((d) => (
                  <button key={d.key} onClick={() => setDeck({ key: d.key, pos: d.type === 'images' ? { n: d.start } : { h: 0, v: 0, f: -1 }, showing: true })} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', marginBottom: 6, borderRadius: 8, border: '1px solid #374151', background: dk?.key === d.key ? '#1e3a8a' : '#0b1220', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>{d.label}</button>
                ))}
              </div>
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

// The one-off meeting's invite page: when it is, and ✅ I'll be there / ❌ Can't make it.
function Rsvp({ door, slug, who, nextAt, L, big, hTitle }) {
  const [st, setSt] = useState(null)
  const [first, setFirst] = useState('')
  useEffect(() => { call({ action: 'rsvp_status', room: slug, ...who }).then((j) => { if (j.ok) { setSt(j.rsvp?.status || ''); setFirst(j.first || '') } }).catch(() => {}) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const answer = async (status) => { const j = await call({ action: 'rsvp', room: slug, status, ...who }).catch(() => ({})); if (j.ok) setSt(j.status) }
  const when = nextAt ? new Date(nextAt).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
  return (
    <div style={{ maxWidth: 480, width: '100%', textAlign: 'center' }}>
      <div style={{ display: 'inline-block', background: '#fff', borderRadius: 14, padding: '8px 16px' }}><img src="/uss-logo.png" alt="U.S. Shingle & Metal" style={{ height: 70, display: 'block' }} /></div>
      <div style={{ marginTop: 14, fontSize: 14, letterSpacing: '.14em', textTransform: 'uppercase', color: L.muted, fontWeight: 700 }}>{first ? `${first}, you're invited to` : "You're invited to"}</div>
      <h1 style={{ ...hTitle, fontSize: 30, marginTop: 4 }}>{door.title}</h1>
      {when && <div style={{ fontSize: 18, fontWeight: 800, marginTop: 6 }}>{when} <span style={{ color: L.muted, fontWeight: 600 }}>(Eastern)</span></div>}
      {door.topic && <div style={{ marginTop: 6, color: L.muted }}>{door.topic}</div>}
      {st === 'yes' ? <div style={{ marginTop: 20, padding: 16, borderRadius: 12, background: 'rgba(22,163,74,.2)', border: '2px solid #16a34a', fontSize: 18, fontWeight: 800 }}>✅ You're confirmed. See you there. Use this same link to join.</div>
        : st === 'no' ? <div style={{ marginTop: 20, padding: 16, borderRadius: 12, background: 'rgba(185,28,28,.2)', border: '2px solid #b91c1c', fontSize: 18, fontWeight: 800 }}>❌ Got it, you can't make it.</div> : null}
      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
        <button onClick={() => answer('yes')} style={{ ...big, flex: 2, background: '#16a34a' }}>✅ I'll be there</button>
        <button onClick={() => answer('no')} style={{ ...big, flex: 1, background: '#475569' }}>❌ Can't make it</button>
      </div>
      <div style={{ marginTop: 12, fontSize: 13, color: L.muted }}>Come back to this link at meeting time. It opens 15 minutes early.</div>
    </div>
  )
}

export default function Meet() {
  const { room: slug } = useParams()
  const [sp] = useSearchParams()
  const t = sp.get('t') || ''
  const g = sp.get('g') || '' // an outside invitee's key (one-off meetings)
  const [door, setDoor] = useState(null) // the room's public info, before signing in
  const [auth, setAuth] = useState(() => (getS(PIN_KEY) ? { pin: getS(PIN_KEY) } : t ? { t } : g ? { g } : null))
  const [guest, setGuest] = useState(() => { try { return JSON.parse(getS(GUEST_KEY, localStorage) || 'null') || { name: '', email: '', opt_in: false } } catch { return { name: '', email: '', opt_in: false } } })
  const [hostMode, setHostMode] = useState(false)
  const [codeInput, setCodeInput] = useState('')
  const [hostName, setHostName] = useState('')
  const [join, setJoin] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [choices, setChoices] = useState(null)
  const [notOpen, setNotOpen] = useState(null) // { next_at } — no meeting on right now
  const [checkin, setCheckin] = useState(() => { try { return JSON.parse(getS('meet_checkin', localStorage) || 'null') || { first: '', last: '', email: '' } } catch { return { first: '', last: '', email: '' } } })
  // ?preview=onboarding shows the onboarding screen exactly as a trainee sees it (nothing sent,
  // nothing saved) — for checking the wording (Neal, 2026-10-04).
  const [gate, setGate] = useState(() => (sp.get('preview') === 'onboarding' ? { first: 'Sam', preview: true, url: sp.get('mode') === 'sent' ? null : '#', banking: sp.get('mode') === 'banking' } : null)) // { first } — onboarding paperwork not signed yet
  const [resent, setResent] = useState('')
  const [effort, setEffort] = useState(() => (sp.get('preview') === 'effort' ? { average: 8.3, needed: 30, week_monday: '2026-10-05', so_far: 0, so_far_days: 1, preview: true } : null))
  const [locked, setLocked] = useState(() => (sp.get('preview') === 'late1' ? { title: 'Training has already started', message: 'Training has already started. You will have to call Brent to reschedule.', phone: '' } : sp.get('preview') === 'late' ? { title: 'Training has already started', message: 'Being on time is part of being a professional. Training started without you today, and the doors are now closed. We wish you the best in your future endeavors.' } : null))
  const [removed, setRemoved] = useState(() => (sp.get('preview') === 'removed' ? "We wish you the best, but attendance is important for success. You didn't show up yesterday. So good luck in your future endeavors." : ''))
  const [lastBody, setLastBody] = useState(null)

  // Waiting on onboarding: look again every 20 seconds and let them in as soon as it's signed.
  useEffect(() => {
    if (!gate || !lastBody) return
    const iv = setInterval(() => { call({ action: 'join', room: slug, ...lastBody }).then((j) => { if (j.ok) { setJoin(j); setGate(null) } }).catch(() => {}) }, 20000)
    return () => clearInterval(iv)
  }, [gate, lastBody]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { document.title = `${join?.room?.title || door?.title || 'Meeting'} · Meeting` }, [join, door])
  useEffect(() => { call({ action: 'info', room: slug }).then((j) => { if (j.ok) setDoor({ ...j.room, host_code: j.host_code }); else setErr(j.error || 'No such room') }).catch(() => {}) }, [slug])

  const doJoin = async (body) => {
    setBusy(true); setErr('')
    const j = await call({ action: 'join', ...body, room: slug }).catch(() => ({ error: 'Network error — try again.' }))
    setBusy(false)
    if (j.ok) { setJoin(j); setNotOpen(null); setGate(null); return true }
    if (j.removed) { setRemoved(j.message || ''); return false }
    if (j.locked) { setLocked(j); return false }
    if (j.effort) { setEffort(j); return false }
    if (j.onboarding) { setLastBody(body); setGate({ first: j.first || '', url: j.onboarding_url || null, banking: !!j.banking }); return false }
    if (j.not_open) { setLastBody(body); setNotOpen({ next_at: j.room?.next_at || null }); return false }
    setErr(j.error || 'Could not join')
    if (body.pin) { try { sessionStorage.removeItem(PIN_KEY) } catch { /* ignore */ } setAuth(null) }
    return false
  }
  // ?confirm=1 on a trainee's link (the "training is virtual" notice): ask them to confirm first.
  const [confirmStep, setConfirmStep] = useState(() => (sp.get('confirm') === '1' && t ? { loading: true } : null))
  useEffect(() => {
    if (!confirmStep?.loading) return
    call({ action: 'class_confirm', room: slug, t, tag: sp.get('tag') || '' }).then((j) => setConfirmStep(j.ok ? { ...j } : null)).catch(() => setConfirmStep(null))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Their own link, or a PIN already entered this session → straight in.
  useEffect(() => {
    if (sp.get('confirm') === '1' && t) return // the confirm card comes first
    if (auth?.pin) doJoin({ pin: auth.pin })
    else if (auth?.t) doJoin({ t: auth.t })
    else if (auth?.g) doJoin({ g: auth.g })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const L = lookOf(join?.room || door)
  const shell = (children) => (
    <div data-lk-theme="default" style={{ minHeight: '100vh', background: L.bg, color: L.text, fontFamily: L.fontBody, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}><FontsFor look={L} />{children}</div>
  )
  const input = { width: '100%', padding: '10px 12px', borderRadius: 8, border: `1px solid ${L.fieldBorder}`, background: L.field, color: L.fieldText, fontSize: 16, marginBottom: 8 }
  const big = { width: '100%', padding: '11px 12px', borderRadius: 8, border: 'none', background: L.button, color: '#fff', fontWeight: 800, fontSize: 15, cursor: 'pointer' }
  const hTitle = { fontSize: L.light ? 34 : 22, fontWeight: L.light ? 600 : 900, fontFamily: L.fontHead, color: L.head, lineHeight: 1.15 }
  // TRAINING ROOMS (Neal, 2026-10-04): the company logo and "U.S. Shingle & Metal welcomes you to
  // First Week Training" on the sign-in, onboarding and no-class screens.
  const welcome = (r) => r?.kind === 'training' ? (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'inline-block', background: '#fff', borderRadius: 14, padding: '10px 18px', boxShadow: '0 6px 20px rgba(0,0,0,.25)' }}>
        <img src="/uss-logo.png" alt="U.S. Shingle & Metal" style={{ height: 96, display: 'block' }} />
      </div>
      <div style={{ marginTop: 14, fontSize: 15, letterSpacing: '.14em', textTransform: 'uppercase', color: L.muted, fontWeight: 700 }}>U.S. Shingle &amp; Metal welcomes you to</div>
      <h1 style={{ ...hTitle, fontSize: 30, marginTop: 4 }}>{r.title}</h1>
    </div>
  ) : null
  const bannerImg = (r) => r?.banner_url ? <img src={r.banner_url} alt="" style={{ width: '100%', borderRadius: 14, boxShadow: '0 10px 30px rgba(0,0,0,.18)', marginBottom: 14 }} /> : null
  const schedLine = (r) => r?.schedule ? <div style={{ color: L.accent || L.muted, fontSize: 13, fontWeight: 700, letterSpacing: '.18em', textTransform: 'uppercase', marginTop: 4 }}>{r.schedule}</div> : null

  // DIDN'T SHOW THE EFFORT for Week B — with the way back (Neal, 2026-10-04).
  if (!join && effort) {
    const friday = new Date(Date.parse(`${effort.week_monday}T12:00:00Z`) + 4 * 864e5).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' })
    return (
      <div style={{ minHeight: '100vh', background: 'radial-gradient(circle at 50% 15%, #3a2a06 0%, #0b0b0f 70%)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: 'system-ui, sans-serif' }}>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Oswald:wght@600;700&display=swap" />
        <div style={{ maxWidth: 580, width: '100%', textAlign: 'center' }}>
          <div style={{ fontFamily: "'Oswald', 'Arial Narrow', sans-serif", fontSize: 'clamp(28px, 6vw, 42px)', fontWeight: 700, letterSpacing: '.03em', textTransform: 'uppercase', color: '#fbbf24', lineHeight: 1.08 }}>You didn't show the effort to qualify for Week B</div>
          <div style={{ marginTop: 18, padding: '18px 20px', borderRadius: 14, background: 'rgba(120,53,15,.35)', border: '2px solid #d97706', fontSize: 18, lineHeight: 1.55 }}>
            Week B takes an average of <b>{effort.needed} doors a day</b> on DoorDispatcher during Week A's field days.
            <div style={{ marginTop: 10, fontFamily: "'Oswald', sans-serif", fontSize: 40, fontWeight: 700, color: '#fca5a5' }}>You averaged {effort.average}</div>
          </div>
          {!effort.committed ? (<>
            <div style={{ marginTop: 22, fontSize: 20, fontWeight: 900, color: '#fff' }}>Still want it? Click below to tell us you're going to prove it.</div>
            <button onClick={async () => { const j = await call({ action: 'effort_commit', room: slug, ...(lastBody || {}) }).catch(() => ({})); if (j.ok || effort.preview) setEffort({ ...effort, committed: true }) }}
              style={{ marginTop: 12, width: '100%', padding: '18px 16px', borderRadius: 14, border: 'none', background: 'linear-gradient(90deg,#16a34a,#15803d)', color: '#fff', fontSize: 'clamp(18px, 2.6vw, 22px)', fontWeight: 900, cursor: 'pointer', boxShadow: '0 10px 30px rgba(22,163,74,.35)' }}>
              🔥 CLICK HERE if you still want Week B<br /><span style={{ fontSize: '.85em', fontWeight: 800 }}>and you're going to prove it this week</span>
            </button>
            <div style={{ marginTop: 10, fontSize: 14, color: '#9ca3af' }}>If you don't click, we'll know you've decided training isn't for you.</div>
          </>) : (<>
            <div style={{ marginTop: 16, padding: '18px 20px', borderRadius: 14, background: 'rgba(20,83,45,.4)', border: '2px solid #16a34a', fontSize: 18, lineHeight: 1.55 }}>
              <div style={{ fontWeight: 900, fontSize: 22, color: '#86efac', marginBottom: 6 }}>🔥 You're in. Now prove it.</div>
              Average <b>{effort.needed} doors a day, Monday through Friday</b>, and you'll be <b>automatically enrolled</b> in next week's Week B.
              {effort.so_far_days > 0 && <div style={{ marginTop: 10, fontSize: 15.5, color: '#d1fae5' }}>So far this week: <b>{effort.so_far}</b> a day. We'll check on {friday}.</div>}
            </div>
            <div style={{ marginTop: 16, fontSize: 17.5, lineHeight: 1.6, color: '#e5e7eb' }}>
              Your manager will still be available to you throughout the week to help you.
              <div style={{ marginTop: 8, fontWeight: 800, color: '#fde68a' }}>Remember: we don't care about the results, only the effort. We can fix results. We can't fix effort.</div>
            </div>
          </>)}
        </div>
      </div>
    )
  }

  // LATE: the doors closed 2 minutes after the trainer arrived (Neal, 2026-10-04).
  if (!join && locked) {
    return (
      <div style={{ minHeight: '100vh', background: 'radial-gradient(circle at 50% 20%, #3b0a0a 0%, #0b0b0f 70%)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: 'system-ui, sans-serif' }}>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Oswald:wght@600;700&display=swap" />
        <div style={{ maxWidth: 560, width: '100%', textAlign: 'center' }}>
          <div style={{ width: 92, height: 92, margin: '0 auto 18px', borderRadius: '50%', background: '#b91c1c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 50, boxShadow: '0 0 0 8px rgba(185,28,28,.25), 0 0 40px rgba(220,38,38,.55)' }}>⏰</div>
          <div style={{ fontFamily: "'Oswald', 'Arial Narrow', sans-serif", fontSize: 'clamp(28px, 6vw, 44px)', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: '#f87171', lineHeight: 1.05 }}>{locked.title}</div>
          <div style={{ marginTop: 6, fontSize: 14, letterSpacing: '.2em', textTransform: 'uppercase', color: '#9ca3af', fontWeight: 700 }}>{door?.title || 'Training'}</div>
          <div style={{ marginTop: 22, padding: '22px', borderRadius: 14, background: 'rgba(127,29,29,.35)', border: '2px solid #dc2626', fontSize: 'clamp(18px, 2.6vw, 22px)', fontWeight: 700, lineHeight: 1.5, color: '#fee2e2' }}>{locked.message}</div>
          {locked.phone && <a href={`tel:${String(locked.phone).replace(/[^\d+]/g, '')}`} style={{ display: 'inline-block', marginTop: 18, padding: '12px 22px', borderRadius: 10, background: '#fff', color: '#7f1d1d', fontWeight: 900, fontSize: 18, textDecoration: 'none' }}>📞 Call {String(locked.message).match(/call (\w+)/)?.[1] || ''} {locked.phone}</a>}
        </div>
      </div>
    )
  }

  // MISSED A DAY: their link no longer lets them in. Neal's wording; made to look final — "you
  // screwed up, you're not serious" (2026-10-04): red, stark, no buttons, no way forward.
  if (!join && removed) {
    return (
      <div style={{ minHeight: '100vh', background: 'radial-gradient(circle at 50% 20%, #3b0a0a 0%, #0b0b0f 70%)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: 'system-ui, sans-serif' }}>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Oswald:wght@600;700&display=swap" />
        <div style={{ maxWidth: 560, width: '100%', textAlign: 'center' }}>
          <div style={{ width: 92, height: 92, margin: '0 auto 18px', borderRadius: '50%', background: '#b91c1c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 52, fontWeight: 900, boxShadow: '0 0 0 8px rgba(185,28,28,.25), 0 0 40px rgba(220,38,38,.55)' }}>✕</div>
          <div style={{ fontFamily: "'Oswald', 'Arial Narrow', sans-serif", fontSize: 'clamp(30px, 6vw, 46px)', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: '#f87171', lineHeight: 1.05 }}>Access closed</div>
          <div style={{ marginTop: 6, fontSize: 14, letterSpacing: '.2em', textTransform: 'uppercase', color: '#9ca3af', fontWeight: 700 }}>{door?.title || 'Training'}</div>
          <div style={{ marginTop: 22, padding: '22px 22px', borderRadius: 14, background: 'rgba(127,29,29,.35)', border: '2px solid #dc2626', fontSize: 'clamp(18px, 2.6vw, 22px)', fontWeight: 700, lineHeight: 1.5, color: '#fee2e2' }}>{removed}</div>
          <div style={{ marginTop: 16, fontSize: 13, color: '#6b7280' }}>This link no longer gives access to training.</div>
        </div>
      </div>
    )
  }

  // ONBOARDING FIRST (Neal, 2026-10-04 — virtual Week A): the paperwork was just sent; they get in
  // once it's signed. Wording is Neal's.
  if (!join && gate) {
    return shell(
      <div style={{ maxWidth: 480, width: '100%', textAlign: 'center' }}>
        {door?.kind === 'training' ? welcome(door) : door?.badge && <img src={door.badge} alt="" style={{ height: 64, marginBottom: 6 }} />}
        <h1 style={door?.kind === 'training' ? { ...hTitle, fontSize: 22 } : hTitle}>{gate.first ? `Welcome, ${gate.first}!` : 'Welcome!'}</h1>
        {gate.url ? (
          // Signed in with their own email/link → the paperwork opens right here, then back to class.
          <div style={{ marginTop: 14, padding: '18px 16px', borderRadius: 12, background: L.card, border: `1px solid ${L.border}`, lineHeight: 1.55 }}>
            {gate.banking ? <>
              <div style={{ fontSize: 18, fontWeight: 900, color: L.head, marginBottom: 6 }}>Before training today, add your direct deposit details.</div>
              <div style={{ fontSize: 15 }}>Your bank name, routing number and account number, so you get paid. It takes a minute, then you'll come straight back into training.</div>
              <a href={gate.url} style={{ ...big, display: 'block', marginTop: 14, textDecoration: 'none', boxSizing: 'border-box' }}>🏦 Add my direct deposit</a>
            </> : <>
              <div style={{ fontSize: 18, fontWeight: 900, color: L.head, marginBottom: 6 }}>Before training, finish your onboarding paperwork.</div>
              <div style={{ fontSize: 15 }}>Your W-9 and Independent Contractor Agreement. It takes about 5 minutes. When you've signed, you'll come straight back into training.</div>
              <a href={gate.url} style={{ ...big, display: 'block', marginTop: 14, textDecoration: 'none', boxSizing: 'border-box' }}>📝 Start my onboarding paperwork</a>
            </>}
          </div>
        ) : (
        <div style={{ marginTop: 14, padding: '18px 16px', borderRadius: 12, background: L.card, border: `1px solid ${L.border}`, textAlign: 'left', lineHeight: 1.55 }}>
          <div style={{ fontSize: 19, fontWeight: 900, color: L.head, marginBottom: 8 }}>📩 Check your email and/or text for your onboarding paperwork.</div>
          <div style={{ fontSize: 15.5 }}>If you didn't get a text and you don't see it in your email, <b>check your junk mail</b>.</div>
          <div style={{ fontSize: 15.5, marginTop: 8 }}>Once you finish onboarding, it'll let you into training.</div>
        </div>
        )}
        {!gate.url && <div style={{ marginTop: 10, fontSize: 13, color: L.muted }}>This page checks on its own every 20 seconds.</div>}
        {gate.preview && <div style={{ marginTop: 10, padding: '6px 10px', borderRadius: 8, background: '#fef3c7', color: '#92400e', fontSize: 13, fontWeight: 700 }}>Preview only: nothing was sent.</div>}
        {!gate.url && <button onClick={() => (gate.preview ? null : doJoin(lastBody || {}))} style={{ ...big, marginTop: 14 }}>✅ I've finished, let me in</button>}
        {lastBody?.first && !gate.url && <button onClick={async () => { setResent('Sending…'); const j = await call({ action: 'onboarding_resend', room: slug, ...lastBody }).catch(() => ({})); setResent(j.ok && j.sent ? 'Sent again. Check your text and email (and junk mail).' : (j.error || 'Could not send. Text your trainer.')) }} style={{ marginTop: 10, background: 'none', border: 'none', color: L.button, fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }}>Didn't get it? Send it again</button>}
        {resent && <div style={{ marginTop: 6, fontSize: 13.5, color: L.text }}>{resent}</div>}
        {err && <p style={{ color: '#fca5a5', marginTop: 10 }}>{err}</p>}
      </div>
    )
  }

  // CONFIRM ATTENDANCE (the virtual notice link).
  if (!join && confirmStep && !confirmStep.loading) {
    const when = confirmStep.next_at ? new Date(confirmStep.next_at).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
    const answer = async (status) => { const j = await call({ action: 'class_confirm', room: slug, t, status }).catch(() => ({})); if (j.ok) setConfirmStep({ ...confirmStep, status: j.status }) }
    return shell(
      <div style={{ maxWidth: 480, width: '100%', textAlign: 'center' }}>
        {welcome({ ...(door || confirmStep.room), kind: 'training', title: (door || confirmStep.room)?.title })}
        <div style={{ fontSize: 18, fontWeight: 800 }}>{confirmStep.first ? `${confirmStep.first}, training` : 'Training'} is <span style={{ color: '#f87171' }}>virtual</span>.</div>
        {when && <div style={{ fontSize: 17, marginTop: 6 }}>Starts <b>{when}</b> (Eastern)</div>}
        {confirmStep.status === 'confirmed' ? (
          <div style={{ marginTop: 18, padding: 16, borderRadius: 12, background: 'rgba(22,163,74,.2)', border: '2px solid #16a34a', fontSize: 17, fontWeight: 700, lineHeight: 1.5 }}>✅ You're confirmed. Open <b>this same link</b> about 15 minutes before class. It takes you through your paperwork, then into training.</div>
        ) : confirmStep.status === 'declined' ? (
          <div style={{ marginTop: 18, padding: 16, borderRadius: 12, background: 'rgba(185,28,28,.2)', border: '2px solid #b91c1c', fontSize: 17, fontWeight: 700 }}>❌ Got it, you can't make it. Changed your mind? Tap "I'll be there".</div>
        ) : <div style={{ marginTop: 14, fontSize: 16 }}>Please confirm you'll be there:</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button onClick={() => answer('yes')} style={{ ...big, flex: 2, background: '#16a34a' }}>✅ I'll be there</button>
          <button onClick={() => answer('no')} style={{ ...big, flex: 1, background: '#475569' }}>❌ Can't make it</button>
        </div>
        {confirmStep.status === 'confirmed' && <button onClick={() => { setConfirmStep(null); doJoin({ t }) }} style={{ marginTop: 14, background: 'none', border: 'none', color: L.muted, textDecoration: 'underline', cursor: 'pointer', fontSize: 14 }}>Do my onboarding paperwork now</button>}
      </div>
    )
  }

  // ONE-OFF MEETING, not started yet: confirm you'll be there (Neal, 2026-10-04).
  if (!join && notOpen && !hostMode && door?.kind === 'oneoff') {
    return shell(<Rsvp door={door} slug={slug} who={lastBody || {}} nextAt={notOpen.next_at} L={L} big={big} hTitle={hTitle} />)
  }

  // TRAINING, PAPERWORK DONE, CLASS NOT OPEN YET → the company lobby slideshow, which lets them in
  // by itself when the room opens (Neal, 2026-10-04). Reaching "not open" means onboarding passed.
  if (!join && (notOpen || sp.get('preview') === 'lobby') && !hostMode && door?.kind === 'training') {
    return <CompanyLobby title={door.title} nextAt={notOpen?.next_at || (sp.get('preview') === 'lobby' ? new Date(Date.now() + 47 * 60000).toISOString() : null)} first={sp.get('preview') === 'lobby' ? 'Sam' : (lastBody?.first || '')} onCheck={sp.get('preview') === 'lobby' ? null : () => doJoin(lastBody || {})} />
  }

  // NO MEETING ON RIGHT NOW (Neal, 2026-10-04): say when the next one is, instead of an empty room.
  if (!join && notOpen && !hostMode) {
    const when = notOpen.next_at ? new Date(notOpen.next_at).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null
    return shell(
      <div style={{ maxWidth: door?.banner_url ? 620 : 420, width: '100%', textAlign: 'center' }}>
        {door?.kind === 'training' ? welcome(door) : <>
          {bannerImg(door)}
          {door?.badge && <img src={door.badge} alt="" style={{ height: 64, marginBottom: 6 }} />}
          <h1 style={hTitle}>{door?.title || 'Meeting'}</h1>
          {schedLine(door)}
        </>}
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
    const header = door && door.kind === 'training' ? welcome(door) : door && (
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
        {busy || (!hostMode && auth && (auth.t || auth.pin || auth.g) && !err) ? <p style={{ color: '#9ca3af' }}>Getting your seat…</p>
          : door?.kind === 'training' && !hostMode ? (
            <>
              <p style={{ color: L.muted, marginBottom: 12 }}>Sign in for training with the name and email you registered with.</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={checkin.first} onChange={(e) => setCheckin({ ...checkin, first: e.target.value })} placeholder="First name" autoComplete="given-name" style={input} />
                <input value={checkin.last} onChange={(e) => setCheckin({ ...checkin, last: e.target.value })} placeholder="Last name" autoComplete="family-name" style={input} />
              </div>
              <input type="email" value={checkin.email} onChange={(e) => setCheckin({ ...checkin, email: e.target.value })} placeholder="Email" autoComplete="email" style={input} />
              <button disabled={busy} onClick={() => { setS('meet_checkin', JSON.stringify(checkin), localStorage); doJoin({ action: 'checkin', ...checkin }) }} style={big}>Submit</button>
              <button onClick={() => { setErr(''); setHostMode(true) }} style={{ marginTop: 14, background: 'none', border: 'none', color: '#64748b', fontSize: 13, cursor: 'pointer' }}>I'm the trainer</button>
            </>
          ) : door?.public && !hostMode ? (
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
        {join.room?.kind === 'training' && (
          <div style={{ margin: '0 auto 12px', maxWidth: 480, padding: '12px 16px', borderRadius: 12, background: L.card, border: `2px solid ${L.button}` }}>
            <div style={{ fontWeight: 900, color: L.head, marginBottom: 6 }}>Before you join, please make sure:</div>
            {['Your camera is on', "You're in a quiet room", "You're not driving", "You're ready to learn"].map((x) => <div key={x} style={{ fontSize: 15.5, fontWeight: 700, margin: '3px 0' }}><span style={{ color: '#16a34a', marginRight: 8 }}>✔</span>{x}</div>)}
          </div>
        )}
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
