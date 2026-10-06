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
import { Component, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import {
  LiveKitRoom, PreJoin, GridLayout, CarouselLayout, FocusLayout, FocusLayoutContainer, ParticipantTile,
  ControlBar, Chat, RoomAudioRenderer, TrackToggle, MediaDeviceMenu, ChatToggle, DisconnectButton, StartMediaButton, ChatIcon, LeaveIcon, LayoutContextProvider, ConnectionStateToast, VideoTrack,
  useTracks, useRoomInfo, useSpeakingParticipants, useParticipants, useLocalParticipant, useCreateLayoutContext, isTrackReference, useRoomContext,
} from '@livekit/components-react'
import { Track, RoomEvent, ParticipantEvent, VideoPresets } from 'livekit-client'
import '@livekit/components-styles'
import MeetPractice from '../components/MeetPractice.jsx'
import ScripturePanel from '../components/ScripturePanel.jsx'
import { ScriptureSlide } from '../components/Scripture.jsx'
import { PodcastStage } from '../components/PodcastStage.jsx'
import CompanyLobby, { READY } from '../components/CompanyLobby.jsx'
import { PracticeStage } from '../components/PracticeStage.jsx'
import { decksFor, DeckView, deckOf } from '../components/Decks.jsx'
import { useBackground, BackgroundPanel } from '../components/BackgroundPicker.jsx'
import { LOOKS, lookOf, FontsFor } from '../lib/meetLooks.jsx'

const FN = '/.netlify/functions/meet'
const PIN_KEY = 'meet_host_pin'
const GUEST_KEY = 'meet_guest'
const call = async (body) => (await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()
const getS = (k, s) => { try { return (s || sessionStorage).getItem(k) || '' } catch { return '' } }
const setS = (k, v, s) => { try { (s || sessionStorage).setItem(k, v) } catch { /* private mode */ } }
const metaOf = (p) => { try { return JSON.parse(p?.metadata || '{}') } catch { return {} } }

// The bar across the top: badge, team, title, and the topic line (host can edit it live).
// 🎥 REMEMBER MY CAMERA + MIC (Neal, 2026-10-06: "once you pick your camera in the meeting, it remembers
// it… I pick the camera, then when I hit Join meeting I had to pick the camera again"). The pre-join pick
// is now the one the meeting actually opens (forced as exact once connected — the browser treated it as a
// suggestion and fell back to the default camera), and any switch made inside the meeting is saved too.
// Stored on this device only (localStorage meet_devices); the name is never stored.
const DEV_KEY = 'meet_devices'
const savedDevices = () => { try { const d = JSON.parse(localStorage.getItem(DEV_KEY) || '{}'); return { ...(d.videoDeviceId ? { videoDeviceId: d.videoDeviceId } : {}), ...(d.audioDeviceId ? { audioDeviceId: d.audioDeviceId } : {}) } } catch { return {} } }
const saveDevices = (c) => { try { const d = JSON.parse(localStorage.getItem(DEV_KEY) || '{}'); if (c.videoDeviceId) d.videoDeviceId = c.videoDeviceId; if (c.audioDeviceId) d.audioDeviceId = c.audioDeviceId; localStorage.setItem(DEV_KEY, JSON.stringify(d)) } catch { /* private mode */ } }
function KeepDevices({ choices }) {
  const room = useRoomContext()
  useEffect(() => {
    if (!room) return
    const done = new Set()
    const apply = async (pub) => {
      const kind = pub?.source === Track.Source.Camera ? 'videoinput' : pub?.source === Track.Source.Microphone ? 'audioinput' : null
      if (!kind || done.has(kind)) return
      done.add(kind)
      const id = kind === 'videoinput' ? choices?.videoDeviceId : choices?.audioDeviceId
      if (id && id !== 'default' && room.getActiveDevice(kind) !== id) await room.switchActiveDevice(kind, id, true).catch(() => {})
    }
    const onChange = (kind, id) => { if (kind === 'videoinput') saveDevices({ videoDeviceId: id }); if (kind === 'audioinput') saveDevices({ audioDeviceId: id }) }
    room.on(RoomEvent.LocalTrackPublished, apply)
    room.on(RoomEvent.ActiveDeviceChanged, onChange)
    return () => { room.off(RoomEvent.LocalTrackPublished, apply); room.off(RoomEvent.ActiveDeviceChanged, onChange) }
  }, [room]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

// 🎛 THE BOTTOM BAR (Neal, 2026-10-06: "the microphone and camera should list which one you're using by
// looking at it, not having to click it"). LiveKit's ControlBar, rebuilt from its own parts so each button
// shows the device in use under its name ("Camera · FaceTime HD Camera"); the ⌄ menu still switches it.
const cleanDevice = (l) => String(l || '').replace(/^Default\s*-\s*/i, '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim()
function MeetControls({ mic, screenShare }) {
  const room = useRoomContext()
  const [names, setNames] = useState({})
  useEffect(() => {
    if (!room) return
    let dead = false
    const load = async () => {
      const devs = await navigator.mediaDevices?.enumerateDevices?.().catch(() => []) || []
      const nameOf = (kind, source) => {
        const live = room.localParticipant?.getTrackPublication(source)?.track?.mediaStreamTrack
        const id = live?.getSettings?.().deviceId || room.getActiveDevice(kind) || 'default'
        const d = devs.find((x) => x.kind === kind && x.deviceId === id) || devs.find((x) => x.kind === kind && x.deviceId === 'default')
        return cleanDevice(d?.label || live?.label || '')
      }
      if (!dead) setNames({ mic: nameOf('audioinput', Track.Source.Microphone), cam: nameOf('videoinput', Track.Source.Camera) })
    }
    load()
    const evs = [RoomEvent.ActiveDeviceChanged, RoomEvent.MediaDevicesChanged, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished]
    for (const e of evs) room.on(e, load)
    navigator.mediaDevices?.addEventListener?.('devicechange', load)
    return () => { dead = true; for (const e of evs) room.off(e, load); navigator.mediaDevices?.removeEventListener?.('devicechange', load) }
  }, [room])
  const label = (title, dev) => (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.15 }}>
      <span>{title}</span>
      {dev && <span title={dev} style={{ fontSize: 11, fontWeight: 500, opacity: 0.75, maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dev}</span>}
    </span>
  )
  return (
    <div className="lk-control-bar">
      {mic && (
        <div className="lk-button-group">
          <TrackToggle source={Track.Source.Microphone} showIcon>{label('Microphone', names.mic)}</TrackToggle>
          <div className="lk-button-group-menu"><MediaDeviceMenu kind="audioinput" /></div>
        </div>
      )}
      <div className="lk-button-group">
        <TrackToggle source={Track.Source.Camera} showIcon>{label('Camera', names.cam)}</TrackToggle>
        <div className="lk-button-group-menu"><MediaDeviceMenu kind="videoinput" /></div>
      </div>
      {screenShare && <TrackToggle source={Track.Source.ScreenShare} captureOptions={{ audio: true, selfBrowserSurface: 'include' }} showIcon>Share screen</TrackToggle>}
      <ChatToggle><ChatIcon />Chat</ChatToggle>
      <DisconnectButton><LeaveIcon />Leave</DisconnectButton>
      <StartMediaButton />
    </div>
  )
}

// 📝 HOST NOTES — A PRIVATE TELEPROMPTER (DeWayne via Neal, 2026-10-06: "a notes section … showing on his
// but doesn't show on anybody else's, so it's almost like his own teleprompter"). Host-only button; the
// notes live on the server per room (meet.js get_notes / set_notes, host-only), so they can be written
// ahead of time on any device. Works while presenting or not; it's a floating panel on the host's screen
// only — never part of the room, the slides or the recording. Drag it by its top bar (put it right under
// your camera so your eyes stay up). Auto-scroll with speed, bigger/smaller text; remembered per device.
function NotesPrompter({ room, auth, me, onClose }) {
  const pref = (() => { try { return JSON.parse(localStorage.getItem('meet_prompter') || '{}') } catch { return {} } })()
  const [text, setText] = useState(null)
  // Which meeting these notes are for: a date (YYYY-MM-DD, Eastern) or '' = every meeting.
  const todayEt = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const [day, setDay] = useState(todayEt)
  const [days, setDays] = useState([])
  const fmtDay = (d) => d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) : 'Every meeting'
  const [edit, setEdit] = useState(false)
  const [saved, setSaved] = useState('')
  const [size, setSize] = useState(pref.size || 26)
  const [speed, setSpeed] = useState(pref.speed || 2)
  const [rolling, setRolling] = useState(false)
  const [pos, setPos] = useState(pref.pos || { x: null, y: 70 })
  // RESIZE (Neal, 2026-10-06: "adjust the window size, length, width"): drag the bottom-right corner.
  const [dim, setDim] = useState(pref.dim || null)
  const box = useRef(null), scroller = useRef(null), timer = useRef(null)
  // Load the chosen day's notes. Opening on today with nothing written for today falls back to the
  // "every meeting" notes if there are any.
  const first = useRef(true)
  useEffect(() => {
    setText(null); setRolling(false)
    call({ action: 'get_notes', room: room.slug, day, ...auth }).then(async (j) => {
      setDays(j?.days || [])
      let t = j?.notes?.text || ''
      if (!t && first.current && day) {
        const g = await call({ action: 'get_notes', room: room.slug, day: '', ...auth }).catch(() => null)
        if (g?.notes?.text) { first.current = false; setDay(''); return }
      }
      first.current = false
      setText(t); setEdit(!t)
    }).catch(() => setText(''))
  }, [day]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { localStorage.setItem('meet_prompter', JSON.stringify({ size, speed, pos, dim })) } catch { /* private mode */ } }, [size, speed, pos, dim])
  useEffect(() => {
    const el = box.current; if (!el || typeof ResizeObserver !== 'function') return
    let t
    const ro = new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => setDim({ w: el.offsetWidth, h: el.offsetHeight }), 250) })
    ro.observe(el)
    return () => { ro.disconnect(); clearTimeout(t) }
  }, [])
  const save = (t) => { clearTimeout(timer.current); setSaved('Saving…'); timer.current = setTimeout(() => call({ action: 'set_notes', room: room.slug, day, text: t, by: me, ...auth }).then((j) => setSaved(j?.ok ? 'Saved' : 'Not saved — try again')).catch(() => setSaved('Not saved — try again')), 900) }
  // Auto-scroll: px per frame from speed (1–10).
  useEffect(() => {
    if (!rolling || edit) return
    let id, last = performance.now()
    const step = (t) => { const el = scroller.current; if (el) { el.scrollTop += (speed * 12 * (t - last)) / 1000; if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) setRolling(false) } last = t; id = requestAnimationFrame(step) }
    id = requestAnimationFrame(step)
    return () => cancelAnimationFrame(id)
  }, [rolling, edit, speed])
  const drag = (e) => {
    const r = box.current.getBoundingClientRect(), ox = e.clientX - r.left, oy = e.clientY - r.top
    const move = (ev) => setPos({ x: Math.max(0, Math.min(window.innerWidth - r.width, ev.clientX - ox)), y: Math.max(0, Math.min(window.innerHeight - 80, ev.clientY - oy)) })
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }
  const b = { padding: '5px 10px', borderRadius: 8, border: 'none', background: '#334155', color: '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer' }
  return (
    <div ref={box} style={{ position: 'fixed', zIndex: 90, top: pos.y, left: pos.x ?? '50%', transform: pos.x == null ? 'translateX(-50%)' : 'none', width: dim?.w ? Math.min(dim.w, window.innerWidth) : 'min(680px, 92vw)', height: dim?.h ? Math.min(dim.h, window.innerHeight) : '42vh', minWidth: 280, minHeight: 140, resize: 'both', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: 'rgba(2,6,23,.5)', border: '2px solid #f59e0b', borderRadius: 14, boxShadow: '0 12px 40px rgba(0,0,0,.6)', color: '#fff' }}>
      <div onMouseDown={drag} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', cursor: 'move', borderBottom: '1px solid #334155', flexWrap: 'wrap' }}>
        <b style={{ flex: 1, fontSize: 13.5 }}>📝 My notes <span style={{ fontWeight: 600, color: '#94a3b8', fontSize: 11.5 }}>· only you see this</span></b>
        {!edit && <button onMouseDown={(e) => e.stopPropagation()} onClick={() => setRolling((x) => !x)} style={{ ...b, background: rolling ? '#b45309' : '#16a34a' }}>{rolling ? '⏸ Pause' : '▶ Scroll'}</button>}
        {!edit && <><button onMouseDown={(e) => e.stopPropagation()} onClick={() => setSpeed((x) => Math.max(1, x - 1))} style={b}>🐢</button><span style={{ fontSize: 12, minWidth: 14, textAlign: 'center' }}>{speed}</span><button onMouseDown={(e) => e.stopPropagation()} onClick={() => setSpeed((x) => Math.min(10, x + 1))} style={b}>🐇</button></>}
        <button onMouseDown={(e) => e.stopPropagation()} onClick={() => setSize((x) => Math.max(14, x - 3))} style={b}>A−</button>
        <button onMouseDown={(e) => e.stopPropagation()} onClick={() => setSize((x) => Math.min(60, x + 3))} style={b}>A+</button>
        <button onMouseDown={(e) => e.stopPropagation()} onClick={() => { setEdit((x) => !x); setRolling(false) }} style={{ ...b, background: edit ? '#2563eb' : '#334155' }}>{edit ? '✓ Done' : '✏️ Edit'}</button>
        <button onMouseDown={(e) => e.stopPropagation()} onClick={onClose} style={{ ...b, background: 'transparent', fontSize: 16 }}>×</button>
      </div>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderBottom: '1px solid #334155', fontSize: 12.5, flexWrap: 'wrap' }}>
        <span style={{ color: '#fcd34d', fontWeight: 800 }}>Notes for:</span>
        <select value={day} onChange={(e) => { if (e.target.value === 'pick') return; setDay(e.target.value) }} style={{ background: '#0f172a', color: '#fff', border: '1px solid #475569', borderRadius: 6, padding: '2px 6px', fontWeight: 700 }}>
          <option value="">Every meeting</option>
          {[...new Set([todayEt, ...days, ...(day ? [day] : [])])].sort().map((d) => <option key={d} value={d}>{d === todayEt ? `Today · ${fmtDay(d)}` : fmtDay(d)}{days.includes(d) ? ' ✓' : ''}</option>)}
        </select>
        <input type="date" title="Write notes for another day" value="" min={todayEt} onChange={(e) => { if (e.target.value) { setDay(e.target.value); setEdit(true) } }} style={{ background: '#0f172a', color: '#94a3b8', border: '1px solid #475569', borderRadius: 6, padding: '1px 4px', colorScheme: 'dark' }} />
        <span style={{ color: '#94a3b8' }}>← pick a day to plan ahead</span>
      </div>
      {text === null ? <div style={{ padding: 16, color: '#94a3b8' }}>Loading your notes…</div> : edit ? (
        <>
          <textarea autoFocus value={text} onChange={(e) => { setText(e.target.value); save(e.target.value) }} placeholder={`Notes for ${fmtDay(day)}. Type or paste what you want to say. Only you (and other hosts of this room) can see it.`}
            style={{ flex: 1, margin: 8, padding: 10, borderRadius: 10, border: '1px solid #334155', background: 'rgba(15,23,42,.5)', color: '#fff', fontSize: 15, lineHeight: 1.45, resize: 'none' }} />
          <div style={{ fontSize: 11.5, color: '#94a3b8', padding: '0 10px 6px' }}>{saved || 'Saves as you type.'}</div>
        </>
      ) : (
        <div ref={scroller} onClick={() => setRolling((x) => !x)} style={{ flex: 1, overflowY: 'auto', padding: '12px 22px 40vh', fontSize: size, lineHeight: 1.4, fontWeight: 600, whiteSpace: 'pre-wrap', cursor: 'pointer', textShadow: '0 1px 3px rgba(0,0,0,.9), 0 0 2px #000' /* readable over a see-through panel */ }}>
          {text || <span style={{ color: '#94a3b8' }}>No notes yet. Press ✏️ Edit.</span>}
        </div>
      )}
    </div>
  )
}

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
    const j = await call({ action: 'set_stage', room: room.slug, stage: next, ...(room.auto_stage ? { auto_off: true } : {}), ...auth }).catch(() => ({}))
    setMsg(j.ok ? label : (j.error || 'Did not work'))
  }
  const autoOff = useMemo(() => { try { return !!JSON.parse(info.metadata || '{}').auto_off } catch { return false } }, [info.metadata])
  // UNMUTE (Neal, 2026-10-04): the host's page tells that person's device to turn its own mic
  // back on (a server can't switch someone's mic on). Receivers only obey a host.
  const unmute = async (identities, label) => {
    setMsg('')
    // 🔇 Locked-mic room: give them the mic first, then tell their device to turn it on.
    if (room.mic_lock) await call({ action: 'allow_mic', room: room.slug, ...(identities ? { identities } : { all: true }), ...auth }).catch(() => {})
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
      {room.auto_stage && autoOff && <button onClick={async () => { await call({ action: 'set_stage', room: room.slug, stage: [], auto_off: false, ...auth }).catch(() => {}); setMsg('Automatic podcast view is back on') }} style={{ width: '100%', padding: '7px 10px', marginBottom: 8, borderRadius: 8, border: '1px solid #60a5fa', background: '#0b1f3a', color: '#bfdbfe', fontWeight: 800, cursor: 'pointer' }}>🎙 Back to automatic podcast view (hosts side by side)</button>}
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
function Stage({ room, auth, isHost, micLocked = false }) {
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
  // 🔇 Locked mics: has the host given me my mic? (TrackSource 2 = microphone.) Re-checked whenever
  // my permissions change.
  const micOk = () => { const src = localParticipant?.permissions?.canPublishSources; return !micLocked || (Array.isArray(src) && (src.length === 0 || src.includes(2))) }
  const [micAllowed, setMicAllowed] = useState(!micLocked)
  useEffect(() => {
    if (!localParticipant) return
    const upd = () => setMicAllowed(micOk())
    upd(); localParticipant.on(ParticipantEvent.ParticipantPermissionsChanged, upd)
    return () => { localParticipant.off(ParticipantEvent.ParticipantPermissionsChanged, upd) }
  }, [localParticipant, micLocked]) // eslint-disable-line react-hooks/exhaustive-deps
  const bg = useBackground(localParticipant)
  const [bgPanel, setBgPanel] = useState(false)
  const [sharePanel, setSharePanel] = useState(false)
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
  const gridTracks = share ? [share, ...cams] : cams
  // Presenter circle: the sharer's own camera in the corner of their shared screen — for a host
  // who has it on and whose camera is on.
  const sharerCam = share ? cams.find((t) => t.participant.identity === share.participant.identity && isTrackReference(t) && !t.publication?.isMuted) : null
  // A host sharing their screen: their camera is shown WITH the share (circle / split / stacked,
  // same choices as slides), so it isn't repeated in the strip down the side (Neal, 2026-10-05).
  const shareCamOk = !!(focus && focus === share && sharerCam && metaOf(share.participant).host)
  const others = focus ? cams.filter((t) => t !== focus && !(shareCamOk && t.participant.identity === share.participant.identity)) : cams
  const circleOn = share ? (share.participant.isLocal ? circle : share.participant.attributes?.circle !== 'off') : false
  const showCircle = !!(focus && focus === share && sharerCam && circleOn && metaOf(share.participant).host)

  // 📖 Scripture on screen: a full-screen slide for everyone, the sharing host as a circle.
  const sc = rmeta.scripture && rmeta.scripture.showing ? rmeta.scripture : null
  // 🎙 Podcast mode: only the people on stage, side by side. Being put on stage unmutes you.
  const stageIds = Array.isArray(rmeta.stage) ? rmeta.stage : []
  const amOnStage = !!localParticipant && stageIds.includes(localParticipant.identity)
  // Podcast view switched OFF in setup but the room still has the stage it set → clear it (Neal,
  // 2026-10-05: "I got rid of the podcast view … every time I go back in, it still goes to it").
  useEffect(() => {
    if (room.auto_stage || !isHost || !rmeta.stage_auto || !stageIds.length) return
    call({ action: 'set_stage', room: room.slug, stage: [], no_mute: true, ...auth }).catch(() => {})
  }, [room.auto_stage, isHost, rmeta.stage_auto, stageIds.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  // Presenter-camera layout for slides / scripture, picked by a host, the same on every screen.
  const layout = { side: 'split', stack: 'stack_top' }[rmeta.layout] || (['circle', 'split', 'stack_top', 'stack_bottom'].includes(rmeta.layout) ? rmeta.layout : 'circle')
  const pickLayout = (l) => call({ action: 'set_layout', room: room.slug, layout: l, ...auth }).catch(() => {})
  // 🎙 AUTOMATIC PODCAST VIEW (Neal, 2026-10-04: "two hosts so it focuses on those, almost like a
  // podcast"). Rooms with auto_stage: once 2+ hosts are in, they go side by side on stage for
  // everyone; nobody is muted. One host's page (the first by name order) keeps it in step as hosts
  // come and go. A host changing the stage by hand switches it off until they turn it back on.
  const hostIdsNow = [...new Set(cams.map((t) => t.participant).filter((p) => { try { return JSON.parse(p.metadata || '{}').host } catch { return false } }).map((p) => p.identity))].sort().slice(0, 4)
  useEffect(() => {
    if (!room.auto_stage || !isHost || rmeta.auto_off || hostIdsNow[0] !== localParticipant?.identity) return
    const want = hostIdsNow.length >= 2 ? hostIdsNow : []
    if (want.join('|') === stageIds.join('|')) return
    call({ action: 'set_stage', room: room.slug, stage: want, no_mute: true, auto: true, ...auth }).catch(() => {})
  }, [hostIdsNow.join('|'), stageIds.join('|'), rmeta.auto_off, isHost]) // eslint-disable-line react-hooks/exhaustive-deps
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
  // 👀 EVERYONE DOWN THE LEFT WHILE PRESENTING (Neal, 2026-10-06: "in all of them … when you go to
  // presentation, you can see everybody in the room down the left") — slides, scripture and practice.
  // The host gets the strip; everyone else keeps the presentation full size. (Screen share and podcast
  // already show the room in a side strip for everyone.)
  const hostFaces = (el) => {
    const faces = cams.filter((t) => t.participant.identity !== localParticipant?.identity && !/^homeowner/.test(t.participant.identity))
    return isHost && faces.length ? <FocusLayoutContainer style={{ height: '100%' }}><CarouselLayout tracks={faces}><ParticipantTile /></CarouselLayout><div style={{ position: 'relative', height: '100%', width: '100%' }}>{el}</div></FocusLayoutContainer> : el
  }
  // 📲 🆕 New flow: DoorDispatcher access for every trainee in the meeting (panel button + the deck's last slide).
  const sendDdAccess = async () => {
                    if (!window.confirm('Send DoorDispatcher access to every trainee in this meeting right now?\n\nEach one gets a text and an email with their link. They watch the one video, then take the test.')) return
                    const j = await call({ action: 'dd_access_live', room: room.slug, ...auth }).catch(() => ({ ok: false, error: 'Network error' }))
                    if (!j.ok) { window.alert(j.error || 'Did not work.'); return }
                    if (!j.results?.length) { window.alert(j.note || 'No trainees were found in the meeting.'); return }
                    const good = j.results.filter((r) => r.ok), bad = j.results.filter((r) => !r.ok)
                    window.alert(`✅ DoorDispatcher access sent to ${good.length}:\n${good.map((r) => `• ${r.name}${r.sms ? ' 📱' : ''}${r.email ? ' ✉️' : ''}${!r.sms && !r.email ? ' (text + email both failed — resend from Rep Links)' : ''}`).join('\n')}${bad.length ? `\n\n⚠️ Not sent:\n${bad.map((r) => `• ${r.name}: ${r.error}`).join('\n')}` : ''}`)
                  }
  const setDeck = (next) => call({ action: 'set_deck', room: room.slug, deck: next, identity: localParticipant?.identity, ...auth }).catch(() => {})
  useEffect(() => {
    if (!iPresent) return
    const onKey = (e) => { if (/INPUT|TEXTAREA/.test(e.target.tagName)) return; if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); deckApi.current?.next() } if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); deckApi.current?.prev() } }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [iPresent])
  // ⌨ SHORTCUTS for Stream Deck buttons (Neal, 2026-10-04: Elgato Stream Deck → a "Hotkey" button
  // per action). All are Control+Option (Ctrl+Alt on Windows) + a key, so they never fire while
  // typing in chat. The meeting window has to be the one in front.
  const [kbNote, setKbNote] = useState('')
  const [kbHelp, setKbHelp] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const kbRef = useRef({})
  kbRef.current = { dk, sc, iPresent, isHost, room, auth, bg, setDeck, setScripture, toggleRec, pickView, localParticipant, roomCtx, stageIds, recording: rmeta.recording }
  useEffect(() => {
    const say = (t) => { setKbNote(t); clearTimeout(say.t); say.t = setTimeout(() => setKbNote(''), 1800) }
    const onKey = async (e) => {
      if (!(e.ctrlKey && e.altKey) || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return
      const k = kbRef.current, lp = k.localParticipant, code = e.code
      const step = (d) => {
        if (k.sc && k.isHost && k.sc.mode !== 'all') { k.setScripture({ ...k.sc, idx: Math.max(0, Math.min(k.sc.verses.length - 1, (k.sc.idx || 0) + d)) }); return say(d > 0 ? 'Next verse' : 'Previous verse') }
        if (k.iPresent) { d > 0 ? deckApi.current?.next() : deckApi.current?.prev(); return say(d > 0 ? 'Next slide' : 'Back a slide') }
      }
      const host = async (action, label) => { if (!k.isHost) return say('Host only'); const j = await call({ action, room: k.room.slug, ...k.auth }).catch(() => ({})); say(j.ok ? label : (j.error || 'Did not work')) }
      const map = {
        ArrowRight: () => step(1), ArrowLeft: () => step(-1),
        KeyS: () => { if (k.sc && k.isHost) { k.setScripture({ ...k.sc, showing: false }); say('Scripture off') } else if (k.dk && k.isHost) { k.setDeck({ ...k.dk, showing: false }); say('Stopped presenting') } },
        KeyM: async () => { const on = lp.isMicrophoneEnabled; await lp.setMicrophoneEnabled(!on).catch(() => {}); say(on ? '🔇 You are muted' : '🎙 Mic on') },
        KeyV: async () => { const on = lp.isCameraEnabled; await lp.setCameraEnabled(!on).catch(() => {}); say(on ? 'Camera off' : 'Camera on') },
        KeyE: () => host('mute_all', '🔇 Everyone muted'),
        KeyU: async () => { if (!k.isHost) return say('Host only'); await lp.publishData(new TextEncoder().encode(JSON.stringify({ type: 'unmute' })), { reliable: true, topic: 'host' }).catch(() => {}); say('🎙 Asked everyone to unmute') },
        KeyR: () => { if (!k.isHost || !k.room.recording_enabled) return say('Recording is off for this room'); k.toggleRec(); say(k.recording ? 'Stopping recording…' : 'Starting recording…') },
        KeyG: () => { k.pickView('gallery'); say('Gallery view') },
        KeyK: () => { k.pickView('speaker'); say('Speaker view') },
        KeyP: () => { if (!k.isHost || !k.stageIds.length) return say('Podcast mode is not on'); host('set_stage', 'Left podcast mode') },
        Digit1: () => { k.bg.pick('uss-white'); say('Background: white, logo right') },
        Digit2: () => { k.bg.pick('uss-white-center'); say('Background: white, logo top') },
        Digit3: () => { k.bg.pick('uss-navy'); say('Background: navy') },
        Digit9: () => { k.bg.pick('blur'); say('Background: blur') },
        Digit0: () => { k.bg.pick('none'); say('Background: none') },
        Slash: () => setKbHelp((x) => !x),
      }
      const f = map[code]
      if (!f) return
      e.preventDefault()
      await f()
    }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [])
  const btn = (on) => ({ padding: '6px 12px', borderRadius: 8, border: '1px solid #475569', background: on ? '#2563eb' : '#1f2937', color: '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer' })
  return (
    <LayoutContextProvider value={layoutContext} onWidgetChange={(w) => setShowChat(!!w.showChat)}>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <TitleBar room={room} auth={auth} isHost={isHost} />
        <div style={{ display: 'flex', gap: 6, padding: '6px 12px', alignItems: 'center', background: lookOf(room).bg }}>
          <span style={{ color: '#94a3b8', fontSize: 13, marginRight: 4 }}>View:</span>
          <button onClick={() => pickView('gallery')} style={btn(share ? galleryDuringShare : view === 'gallery')}>▦ Gallery</button>
          <button onClick={() => pickView('speaker')} style={btn(share ? !galleryDuringShare : view === 'speaker')}>{share ? '🖥 Shared screen' : '◧ Speaker'}</button>
          <button onClick={() => setBgPanel((x) => !x)} style={btn(bgPanel)}>🖼 Background</button>
          {(room.public || isHost) && <button onClick={() => setSharePanel((x) => !x)} style={btn(sharePanel)}>🔗 Share meeting</button>}
          <button title="Keyboard shortcuts (for Stream Deck)" onClick={() => setKbHelp((x) => !x)} style={btn(kbHelp)}>⌨</button>
          {isHost && <button title="Your private notes / teleprompter — only you see it" onClick={() => setNotesOpen((x) => !x)} style={{ ...btn(notesOpen), ...(notesOpen ? {} : { borderColor: '#f59e0b' }) }}>📝 My notes</button>}
          <span style={{ flex: 1 }} />
          {isHost && !scriptureRoom && (decksFor(room).length > 0 || !!dk) && <button onClick={() => setDeckPanel((x) => !x)} style={{ ...btn(deckPanel), background: dk ? '#1e40af' : '#2563eb', border: 'none', marginRight: 6 }}>📊 {dk ? 'Presenting' : 'Present'}</button>}
          {isHost && scriptureRoom && <button onClick={() => setScripturePanel((x) => !x)} style={{ ...btn(scripturePanel), background: sc ? '#92400e' : '#B8893D', border: 'none', marginRight: 6 }}>📖 {sc ? 'Scripture on' : 'Scripture'}</button>}
          {/* ONE-CLICK ON / OFF (Neal, 2026-10-06: "scripture on, scripture off … right now I have two clicks").
              Off hides the passage and you're straight back in your view (split / circle / stacked — that
              choice isn't touched). On brings back the last passage you shared, right where you left it. */}
          {isHost && scriptureRoom && (sc
            ? <button title="Hide the scripture (Ctrl+Alt+S)" onClick={() => { setScripture({ ...sc, showing: false }); setScripturePanel(false) }} style={{ ...btn(false), background: '#b91c1c', border: 'none', marginRight: 6 }}>⏹ Scripture off</button>
            : rmeta.scripture && (rmeta.scripture.verses || []).length > 0
              ? <button title={`Show ${rmeta.scripture.ref || 'the last passage'} again`} onClick={() => setScripture({ ...rmeta.scripture, showing: true })} style={{ ...btn(false), background: '#15803d', border: 'none', marginRight: 6 }}>▶ Scripture on</button>
              : null)}
          {recNote && <span style={{ fontSize: 12.5, color: '#fcd34d', marginRight: 6 }}>{recNote}</span>}
          {isHost && room.recording_enabled && <button disabled={recBusy} onClick={toggleRec} style={{ ...btn(false), background: rmeta.recording ? '#7f1d1d' : '#dc2626', border: 'none', marginRight: 6 }}>{recBusy ? '…' : rmeta.recording ? '⏹ Stop recording' : '⏺ Record'}</button>}
          {isHost && auth.pin && !scriptureRoom && <button onClick={() => setPractice((x) => !x)} style={{ ...btn(practice), background: '#b45309', border: 'none', marginRight: 6 }}>🎭 Practice</button>}
          {isHost && <button onClick={() => setPanel((x) => !x)} style={{ ...btn(panel), background: '#7c3aed', border: 'none' }}>👥 Host controls</button>}
        </div>
        {/* Only this middle area can grow; it never pushes the bottom bar off screen (Neal, 2026-10-06:
            "the bottom should freeze so if you have to scroll that doesn't move"). */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
          <div style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden' }}>
            {/* SCREEN SHARE, WHOLE SCREEN (Neal, 2026-10-05: a trainee "couldn't see the full screen"): the
                shared screen is fitted inside the window, never cropped, and anyone can go full screen. */}
            <style>{'.lk-participant-tile[data-lk-source="screen_share"] video, .lk-focus-layout video[data-lk-source="screen_share"] { object-fit: contain !important; background: #000; }'}</style>
            {share && !dk && !sc && !pr && (
              <button onClick={() => { const el = document.querySelector('.lk-focus-layout') || document.documentElement; (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el) }}
                style={{ position: 'absolute', top: 8, right: 8, zIndex: 30, padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,.4)', background: 'rgba(15,23,42,.8)', color: '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>⛶ Full screen</button>
            )}
            {pr ? (
              hostFaces(<PracticeStage pr={pr} camTrack={prCam} me={localParticipant?.identity === pr.presenter} homeownerTalking={speakers.some((x) => /^homeowner/.test(x.identity))} presenterTalked={prTalked} />)
            ) : sc ? (
              hostFaces(<PresenterFrame layout={layout} cam={scCam} isHost={isHost} onLayout={pickLayout}><ScriptureSlide sc={sc} look={lookOf(room)} camTrack={layout === 'circle' ? scCam : null} /></PresenterFrame>)
            ) : dk ? (
              (() => {
                // 👀 FACES WHILE PRESENTING (Neal, 2026-10-05: "on the left-hand side the gallery … I want to
                // see their faces as I'm training them"). The host sees everyone in a strip beside the
                // slides; everyone else still gets the slides full size.
                const deckEl = (
              <PresenterFrame layout={layout} cam={dkCam} isHost={isHost} onLayout={pickLayout}><DeckView deck={dk.key} pos={dk.pos} host={iPresent} apiRef={deckApi} onEndAction={sendDdAccess} camTrack={layout === 'circle' ? dkCam : null} onMove={(pos) => { try { localStorage.setItem(`deck_pos_${room.slug}_${dk.key}`, JSON.stringify(pos)) } catch { /* private */ } setDeck({ ...dk, pos, showing: true }) }} /></PresenterFrame>
                )
                return hostFaces(deckEl)
              })()
            ) : podcast ? (
              (() => {
                // Everyone not on stage in a strip down the side (Neal: "it didn't show a gallery of people").
                const audience = cams.filter((t) => !stageIds.includes(t.participant.identity))
                const stageView = <PodcastStage people={stagePeople} look={lookOf(room)} watching={Math.max(0, cams.length - stagePeople.length)} />
                return audience.length ? <FocusLayoutContainer style={{ height: '100%' }}><CarouselLayout tracks={audience}><ParticipantTile /></CarouselLayout><div style={{ position: 'relative', height: '100%', width: '100%' }}>{stageView}</div></FocusLayoutContainer> : stageView
              })()
            ) : !focus ? (
              <GridLayout tracks={gridTracks} style={{ height: '100%' }}><ParticipantTile /></GridLayout>
            ) : (
              (() => {
                const main = shareCamOk ? (
                  <PresenterFrame layout={layout} cam={sharerCam} isHost={isHost} onLayout={pickLayout}>
                    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
                      <FocusLayout trackRef={focus} style={{ height: '100%' }} />
                      {layout === 'circle' && showCircle && (
                        <div style={{ position: 'absolute', right: '2.5%', bottom: '4%', width: 'min(22%, 230px)', aspectRatio: '1 / 1', borderRadius: '50%', overflow: 'hidden', border: '3px solid rgba(255,255,255,.85)', boxShadow: '0 6px 20px rgba(0,0,0,.5)', zIndex: 5, background: '#000' }}>
                          <VideoTrack trackRef={sharerCam} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        </div>
                      )}
                    </div>
                  </PresenterFrame>
                ) : null
                if (main && !others.length) return <div style={{ height: '100%' }}>{main}</div>
                if (main) return <FocusLayoutContainer style={{ height: '100%' }}><CarouselLayout tracks={others}><ParticipantTile /></CarouselLayout>{main}</FocusLayoutContainer>
                return null
              })() || (
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
              )
            )}
            {isHost && deckPanel && (
              <div style={{ position: 'absolute', top: 8, left: 12, zIndex: 60, width: 320, maxHeight: '80vh', overflow: 'auto', background: '#111827', border: '1px solid #2563eb', borderRadius: 12, padding: 12, color: '#e5e7eb', fontSize: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}><b style={{ flex: 1 }}>📊 Present</b><button onClick={() => setDeckPanel(false)} style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: 18, cursor: 'pointer' }}>×</button></div>
                {dk && (
                  <>
                    <div style={{ fontWeight: 800, marginBottom: 6 }}>{deckOf(dk.key)?.label}</div>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                      <button onClick={() => deckApi.current?.prev()} style={{ flex: 1, padding: '8px', borderRadius: 8, border: 'none', background: '#1f2937', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>{deckOf(dk.key)?.type === 'video' ? '⏪ 10 s' : '◀ Back'}</button>
                      <button onClick={() => deckApi.current?.next()} style={{ flex: 2, padding: '8px', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>{deckOf(dk.key)?.type === 'video' ? '⏯ Play / Pause' : 'Next ▶'}</button>
                    </div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>Arrow keys work too. Everyone's screen follows you.</div>
                    <button onClick={() => setDeck({ ...dk, showing: false })} style={{ width: '100%', padding: '8px', borderRadius: 8, border: 'none', background: '#b91c1c', color: '#fff', fontWeight: 800, cursor: 'pointer', marginBottom: 10 }}>⏹ Stop presenting</button>
                  </>
                )}
                <LayoutPick layout={layout} onLayout={pickLayout} />
                {room.kind === 'training' && room.training_week !== 'B' && (
                  // 🆕 NEW FLOW (Oct 6): after the DoorDispatcher video + deck, one press gives every trainee
                  // in the meeting their DoorDispatcher link (text + email). See meet.js dd_access_live.
                  <button onClick={sendDdAccess} style={{ display: 'block', width: '100%', padding: '10px', marginBottom: 10, borderRadius: 8, border: '2px solid #22c55e', background: '#14532d', color: '#fff', fontWeight: 900, cursor: 'pointer' }}>
                    📲 Send DoorDispatcher access to trainees in this meeting <span style={{ fontWeight: 600, fontSize: 11, opacity: 0.8 }}>(🆕 new flow)</span>
                  </button>
                )}
                <div style={{ fontSize: 12.5, color: '#94a3b8', marginBottom: 6 }}>{dk ? 'Switch to:' : 'Pick what to show everyone:'}</div>
                {decksFor(room).map((d) => (
                  <button key={d.key} onClick={() => {
                    // RESUME (Neal, 2026-10-05: stop presenting on slide 37, start again → back on 37). The room
                    // keeps the last position after Stop; this device remembers it too.
                    let last = rmeta.deck && rmeta.deck.key === d.key && rmeta.deck.pos ? rmeta.deck.pos : null
                    if (!last) { try { last = JSON.parse(localStorage.getItem(`deck_pos_${room.slug}_${d.key}`) || 'null') } catch { /* none */ } }
                    setDeck({ key: d.key, pos: d.type === 'video' ? { t: Number(last?.t) || 0, play: false } : last || (d.type === 'images' ? { n: d.start } : { h: 0, v: 0, f: -1 }), showing: true })
                  }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', marginBottom: 6, borderRadius: 8, border: '1px solid #374151', background: dk?.key === d.key ? '#1e3a8a' : '#0b1220', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>{d.label}</button>
                ))}
              </div>
            )}
            {bgPanel && <BackgroundPanel bg={bg} onClose={() => setBgPanel(false)} />}
            {sharePanel && <SharePanel room={room} onClose={() => setSharePanel(false)} />}
            {isHost && notesOpen && <NotesPrompter room={room} auth={auth} me={localParticipant?.name || ''} onClose={() => setNotesOpen(false)} />}
            {kbHelp && <ShortcutHelp isHost={isHost} onClose={() => setKbHelp(false)} />}
            {kbNote && <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 70, background: 'rgba(15,23,42,.92)', color: '#fff', padding: '8px 16px', borderRadius: 10, fontWeight: 800, fontSize: 15, pointerEvents: 'none' }}>{kbNote}</div>}
            {isHost && scripturePanel && <ScripturePanel current={rmeta.scripture} onSet={setScripture} onClose={() => setScripturePanel(false)} layoutPick={<LayoutPick layout={layout} onLayout={pickLayout} />} />}
            {isHost && auth.pin && practice && <MeetPractice roomSlug={room.slug} pin={auth.pin} onClose={() => setPractice(false)} />}
            {isHost && panel && <HostPanel room={room} auth={auth} onClose={() => setPanel(false)} circle={circle} setCircle={setCircle} />}
          </div>
          <Chat style={{ display: showChat ? 'grid' : 'none', width: 320 }} />
        </div>
        {micLocked && !micAllowed && <div style={{ textAlign: 'center', padding: '6px 10px', background: '#1e293b', color: '#cbd5e1', fontSize: 13.5, fontWeight: 700 }}>🔇 Your mic is off. The trainer will unmute you when it's your turn.</div>}
        <MeetControls mic={micAllowed} screenShare={!micLocked || isHost} />
      </div>
      <RoomAudioRenderer />
      <ConnectionStateToast />
    </LayoutContextProvider>
  )
}

// The one-off meeting's invite page: when it is, and ✅ I'll be there / ❌ Can't make it.
function Rsvp({ door, slug, who, nextAt, L, big, hTitle, onJoin }) {
  const [st, setSt] = useState(null)
  // A real Join button on this page (Neal, 2026-10-04: DeWayne confirmed and was told to "use this
  // same link" — he was already on it, with nothing to press). It unlocks by itself 15 min early.
  const [, tick] = useState(0)
  useEffect(() => { const iv = setInterval(() => tick((x) => x + 1), 15000); return () => clearInterval(iv) }, [])
  const opensAt = nextAt ? Date.parse(nextAt) - 15 * 60000 : null
  const isOpen = !opensAt || Date.now() >= opensAt
  const opensTxt = opensAt ? new Date(opensAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) : ''
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
      {st === 'yes' ? <div style={{ marginTop: 20, padding: 16, borderRadius: 12, background: 'rgba(22,163,74,.2)', border: '2px solid #16a34a', fontSize: 18, fontWeight: 800 }}>✅ You're confirmed. See you there.</div>
        : st === 'no' ? <div style={{ marginTop: 20, padding: 16, borderRadius: 12, background: 'rgba(185,28,28,.2)', border: '2px solid #b91c1c', fontSize: 18, fontWeight: 800 }}>❌ Got it, you can't make it.</div> : null}
      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
        <button onClick={() => answer('yes')} style={{ ...big, flex: 2, background: '#16a34a' }}>✅ I'll be there</button>
        <button onClick={() => answer('no')} style={{ ...big, flex: 1, background: '#475569' }}>❌ Can't make it</button>
      </div>
      {isOpen
        ? <button onClick={onJoin} style={{ ...big, width: '100%', marginTop: 14, background: '#2563eb', fontSize: 20 }}>▶ Join the meeting</button>
        : <button disabled style={{ ...big, width: '100%', marginTop: 14, background: '#334155', color: '#cbd5e1', cursor: 'default' }}>▶ Join opens at {opensTxt}</button>}
      <div style={{ marginTop: 10, fontSize: 13, color: L.muted }}>{isOpen ? 'Tap Join to go in.' : `Keep this page open (the Join button turns on at ${opensTxt}), or open the link from your text again then.`}</div>
    </div>
  )
}

export default function Meet() {
  const { room: slug } = useParams()
  const [sp] = useSearchParams()
  const t = sp.get('t') || ''
  // ?as=attendee: an admin's PIN joins without host controls (Meeting Room Setup → Join as attendee).
  const asAttendee = sp.get('as') === 'attendee'
  const g = sp.get('g') || '' // an outside invitee's key (one-off meetings)
  const [door, setDoor] = useState(null) // the room's public info, before signing in
  const [auth, setAuth] = useState(() => (getS(PIN_KEY) ? { pin: getS(PIN_KEY) } : t ? { t } : g ? { g } : null))
  const [guest, setGuest] = useState(() => { try { return JSON.parse(getS(GUEST_KEY, localStorage) || 'null') || { name: '', email: '', opt_in: false } } catch { return { name: '', email: '', opt_in: false } } })
  const [hostMode, setHostMode] = useState(asAttendee)
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
  // Combined with another team today → go straight to that room, keeping their own link (?t=…).
  useEffect(() => { call({ action: 'info', room: slug }).then((j) => { if (j.ok && j.room?.merged_into) { window.location.replace(`/meet/${j.room.merged_into}${window.location.search}`); return } if (j.ok) setDoor({ ...j.room, host_code: j.host_code }); else setErr(j.error || 'No such room') }).catch(() => {}) }, [slug])

  const doJoin = async (body) => {
    setBusy(true); setErr('')
    const j = await call({ action: 'join', ...body, ...(asAttendee ? { attendee: true } : {}), room: slug }).catch(() => ({ error: 'Network error — try again.' }))
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
    // Class starting within the hour (or on now) and they've already confirmed → straight in, no card
    // (Neal, 2026-10-05: 13 minutes before class nobody was in — the card told confirmed trainees to
    // "open this same link 15 minutes before class" while they were ON it, and stopped there).
    call({ action: 'class_confirm', room: slug, t, tag: sp.get('tag') || '' }).then((j) => {
      const soon = j?.next_at && Date.parse(j.next_at) - Date.now() < 60 * 60000
      if (j?.ok && j.status === 'confirmed' && soon) { setConfirmStep(null); doJoin({ t }); return }
      setConfirmStep(j.ok ? { ...j, soon } : null)
    }).catch(() => setConfirmStep(null))
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
          {/* THE DECISION (Neal, 2026-10-04: Santiago opened it and did nothing — "make it super
              clear"). One question, two answers; the why sits underneath. */}
          {!effort.committed && !effort.declined ? (<>
            {lastBody?.first && <div style={{ fontSize: 18, fontWeight: 800, color: '#fde68a' }}>{String(lastBody.first).split(' ')[0]}, we need an answer from you</div>}
            <div style={{ marginTop: 6, fontFamily: "'Oswald', 'Arial Narrow', sans-serif", fontSize: 'clamp(34px, 8vw, 52px)', fontWeight: 700, textTransform: 'uppercase', color: '#fff', lineHeight: 1.05 }}>Do you still want <span style={{ whiteSpace: 'nowrap' }}>Week B?</span></div>
            <div style={{ marginTop: 8, fontSize: 16, color: '#d1d5db' }}>Tap one. Not answering counts as a no.</div>
            <button onClick={async () => { const j = await call({ action: 'effort_commit', room: slug, ...(lastBody || {}) }).catch(() => ({})); if (j.ok || effort.preview) setEffort({ ...effort, committed: true }) }}
              style={{ marginTop: 18, width: '100%', padding: '22px 16px', borderRadius: 16, border: '3px solid #86efac', background: 'linear-gradient(90deg,#16a34a,#15803d)', color: '#fff', fontSize: 'clamp(22px, 3.4vw, 28px)', fontWeight: 900, cursor: 'pointer', boxShadow: '0 12px 34px rgba(22,163,74,.45)' }}>
              🔥 YES, I want it<br /><span style={{ fontSize: '.72em', fontWeight: 800 }}>and I'll prove it this week</span>
            </button>
            <button onClick={async () => { if (!window.confirm("Are you sure? This tells us training isn't for you.")) return; const j = await call({ action: 'effort_decline', room: slug, ...(lastBody || {}) }).catch(() => ({})); if (j.ok || effort.preview) setEffort({ ...effort, declined: true }) }}
              style={{ marginTop: 12, width: '100%', padding: '14px 16px', borderRadius: 14, border: '2px solid #4b5563', background: 'transparent', color: '#d1d5db', fontSize: 17, fontWeight: 800, cursor: 'pointer' }}>
              No, training isn't for me
            </button>
            <div style={{ marginTop: 22, padding: '14px 18px', borderRadius: 14, background: 'rgba(120,53,15,.3)', border: '1px solid #b45309', fontSize: 16, lineHeight: 1.5, color: '#fde68a', textAlign: 'left' }}>
              <b>Why you're being asked:</b> Week B takes an average of <b>{effort.needed} doors a day</b> on DoorDispatcher during Week A's field days. <b>You averaged {effort.average}.</b> Tap YES and you get this week to show it: {effort.needed} a day, Monday through Friday, and you're automatically enrolled.
            </div>
          </>) : effort.declined ? (
            <div style={{ padding: '22px 20px', borderRadius: 14, background: 'rgba(31,41,55,.7)', border: '2px solid #4b5563', fontSize: 18, lineHeight: 1.55 }}>
              <div style={{ fontWeight: 900, fontSize: 22, marginBottom: 6 }}>Thanks for letting us know.</div>
              We wish you the best. If you change your mind, talk to your manager.
            </div>
          ) : (<>
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
    const answer = async (status) => {
      const j = await call({ action: 'class_confirm', room: slug, t, status }).catch(() => ({}))
      if (!j.ok) return
      // Saying yes right before class → go straight in.
      if (j.status === 'confirmed' && confirmStep.soon) { setConfirmStep(null); doJoin({ t }); return }
      setConfirmStep({ ...confirmStep, status: j.status })
    }
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
        {confirmStep.status === 'confirmed' && <button onClick={() => { setConfirmStep(null); doJoin({ t }) }} style={{ ...big, marginTop: 14, background: '#2563eb' }}>▶ Go to training now (paperwork first if it's not done)</button>}
      </div>
    )
  }

  // ONE-OFF MEETING, not started yet: confirm you'll be there (Neal, 2026-10-04).
  if (!join && notOpen && !hostMode && door?.kind === 'oneoff') {
    return shell(<Rsvp door={door} slug={slug} who={lastBody || {}} nextAt={notOpen.next_at} L={L} big={big} hTitle={hTitle} onJoin={() => doJoin(lastBody || {})} />)
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
          {(door?.host_names || []).length > 0 && <p style={{ color: L.text, marginTop: 4, fontSize: 15, fontWeight: 700 }}>👤 Hosted by {door.host_names.join(' & ')}</p>}
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
        {(door.host_names || []).length > 0 && <p style={{ color: L.text, marginTop: 4, fontSize: 15, fontWeight: 700 }}>👤 Hosted by {door.host_names.join(' & ')}</p>}
        {door.welcome && <p style={{ color: L.text, marginTop: 8, fontSize: 16, lineHeight: 1.5 }}>{door.welcome}</p>}
        {door.topic && <p style={{ color: L.head, marginTop: 8, fontFamily: L.fontHead, fontSize: L.light ? 22 : 16, fontWeight: 600 }}>{door.topic}</p>}
      </div>
    )
    const hostJoin = async () => {
      const c = codeInput.trim(); if (!c) { setErr(door?.host_code ? 'Type your host code or admin PIN first.' : 'Type your admin PIN first.'); return }
      // Try it as an admin PIN first, then as this room's own host code.
      setBusy(true); setErr('')
      const asPin = await call({ action: 'join', room: slug, pin: c, ...(asAttendee ? { attendee: true } : {}) }).catch(() => ({}))
      setBusy(false)
      if (asPin.ok) { setS(PIN_KEY, c); setAuth({ pin: c }); setJoin(asPin); return }
      // Right PIN, but an attendee can't come in before the meeting opens: say when, not "not recognised".
      if (asPin.not_open) { setS(PIN_KEY, c); setAuth({ pin: c }); setLastBody({ pin: c }); setNotOpen({ next_at: asPin.room?.next_at || null }); return }
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
              {asAttendee ? <p style={{ color: '#9ca3af', marginBottom: 12 }}>Admin: your PIN puts you in as an attendee, with no host controls.</p>
                : !door?.public && <p style={{ color: '#9ca3af', marginBottom: 12 }}>Reps and trainees: open the meeting from the link we texted you. Hosting? Sign in below.</p>}
              <input type="password" value={codeInput} onChange={(e) => setCodeInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') hostJoin() }} placeholder={door?.host_code ? 'Host code or admin PIN' : 'Admin PIN'} style={input} />
              {door?.host_code && <input value={hostName} onChange={(e) => setHostName(e.target.value)} placeholder="Your name (shown on your tile)" style={input} />}
              <button disabled={busy} onClick={hostJoin} style={big}>{asAttendee ? 'Join as attendee' : 'Join as host'}</button>
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
        {/* Training, sales (team, managers, everyone) and company meetings get the checklist
            (Neal, 2026-10-05: same list everywhere, plus "fully dressed"). Not the devotional. */}
        {['training', 'zone', 'managers', 'everyone', 'company'].includes(join.room?.kind) && (
          <div style={{ margin: '0 auto 12px', maxWidth: 480, padding: '12px 16px', borderRadius: 12, background: L.card, border: `2px solid ${L.button}` }}>
            <div style={{ fontWeight: 900, color: L.head, marginBottom: 6 }}>Before you join, please make sure:</div>
            {READY.map((x) => <div key={x} style={{ fontSize: 15.5, fontWeight: 700, margin: '3px 0' }}><span style={{ color: '#16a34a', marginRight: 8 }}>✔</span>{x}</div>)}
          </div>
        )}
        {!join.host && (lastBody?.t || lastBody?.g) && <TextMeBox slug={slug} who={lastBody} L={L} />}
        <PreJoin defaults={{ username: join.name, videoEnabled: true, audioEnabled: !join.mic_locked, ...savedDevices() }} persistUserChoices={false}
          onValidate={() => true} onSubmit={(c) => { saveDevices(c || {}); setChoices(c || {}) }} joinLabel="Join meeting" userLabel="Your name" />
      </div>
    )
  }

  return (
    <div data-lk-theme="default" style={{ height: '100dvh', overflow: 'hidden', background: L.bg, fontFamily: L.fontBody }}>
      <FontsFor look={L} />
      <LiveKitRoom serverUrl={join.url} token={join.token} connect
        // SMOOTH VIDEO (Neal, 2026-10-05: "when I move … it seems choppy"). 720p at 30 fps from the camera;
        // when the connection or computer is stretched, keep the FRAME RATE and soften the picture
        // instead of stuttering; a little more bitrate; viewers only get the size they display.
        options={{
          adaptiveStream: true, dynacast: true,
          videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
          publishDefaults: { videoEncoding: { maxBitrate: 2_500_000, maxFramerate: 30 }, videoSimulcastLayers: [VideoPresets.h360, VideoPresets.h540], degradationPreference: 'maintain-framerate' },
        }}
        video={choices.videoEnabled ? { deviceId: choices.videoDeviceId } : false}
        audio={choices.audioEnabled && !join.mic_locked ? { deviceId: choices.audioDeviceId } : false}
        onDisconnected={() => setChoices(null)} style={{ height: '100%' }}>
        <KeepDevices choices={choices} />
        <MeetErrorBoundary slug={slug}><Stage room={join.room || { slug, title: join.title }} auth={auth || {}} isHost={join.host} micLocked={!!join.mic_locked} /></MeetErrorBoundary>
      </LiveKitRoom>
    </div>
  )
}

// The ⌨ list — what to put on each Stream Deck "Hotkey" button.
const SHORTCUTS = [
  ['→', 'Next slide / next verse', false], ['←', 'Back a slide / previous verse', false], ['S', 'Stop presenting / scripture off', true],
  ['M', 'Mute / unmute me', false], ['V', 'Camera on / off', false], ['E', 'Mute everyone', true], ['U', 'Unmute everyone', true],
  ['R', 'Start / stop recording', true], ['G', 'Gallery view', false], ['K', 'Speaker view', false], ['P', 'Leave podcast mode', true],
  ['1', 'Background: white, logo right', false], ['2', 'Background: white, logo top', false], ['3', 'Background: navy', false], ['9', 'Background: blur', false], ['0', 'Background: none', false],
]
function ShortcutHelp({ isHost, onClose }) {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
  const pre = mac ? '⌃ Control + ⌥ Option +' : 'Ctrl + Alt +'
  return (
    <div style={{ position: 'absolute', top: 8, right: 12, zIndex: 60, width: 340, maxHeight: '80vh', overflow: 'auto', background: '#111827', border: '1px solid #2563eb', borderRadius: 12, padding: 12, color: '#e5e7eb', fontSize: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}><b style={{ flex: 1 }}>⌨ Shortcuts (Stream Deck)</b><button onClick={onClose} style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: 18, cursor: 'pointer' }}>×</button></div>
      <div style={{ fontSize: 12.5, color: '#94a3b8', marginBottom: 8 }}>Hold <b>{pre}</b> the key. On the Stream Deck, drag a <b>Hotkey</b> action onto a button and press the same keys. Keep the meeting window in front.</div>
      {SHORTCUTS.filter((x) => isHost || !x[2]).map(([k, label]) => (
        <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0', borderTop: '1px solid #1f2937' }}>
          <span style={{ minWidth: 34, textAlign: 'center', padding: '2px 6px', borderRadius: 6, background: '#1f2937', border: '1px solid #374151', fontWeight: 800 }}>{k}</span>
          <span>{label}</span>
        </div>
      ))}
    </div>
  )
}

// 🖼 PRESENTER LAYOUTS (Neal, 2026-10-05: "he can be a small circle, or split screen, or one on top
// of the other, or side by side" — for every room). Wraps the slides / scripture; in 'circle' the
// content draws its own corner circle. Hosts get a small picker in the top-right corner.
const LAYOUTS = [['circle', '◉ Circle'], ['split', '◧ Split'], ['stack_top', '⬒ Stacked: you on top'], ['stack_bottom', '⬓ Stacked: you underneath']]
function PresenterFrame({ layout, cam, isHost, onLayout, children }) {
  const camBox = cam && layout !== 'circle' ? (
    <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 14, background: '#000', minWidth: 0, minHeight: 0, ...(layout === 'split' ? { flex: '1 1 50%' } : { flex: '0 0 34%' }) }}>
      <VideoTrack trackRef={cam} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
    </div>
  ) : null
  const body = <div style={{ position: 'relative', minWidth: 0, minHeight: 0, ...(camBox ? { flex: layout === 'split' ? '1 1 50%' : '1 1 auto' } : { width: '100%', height: '100%' }) }}>{children}</div>
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#000' }}>
      {camBox ? (
        <div style={{ display: 'flex', flexDirection: layout === 'split' ? 'row' : 'column', gap: 8, padding: 8, width: '100%', height: '100%' }}>
          {layout === 'stack_top' ? <>{camBox}{body}</> : <>{body}{camBox}</>}
        </div>
      ) : body}
      {isHost && (
        <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 30, display: 'flex', gap: 4, background: 'rgba(15,23,42,.85)', padding: 4, borderRadius: 10 }}>
          {LAYOUTS.map(([k, l]) => (
            <button key={k} onClick={() => onLayout(k)} style={{ padding: '5px 9px', borderRadius: 7, border: 'none', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', background: layout === k ? '#2563eb' : '#334155', color: '#fff' }}>{l}</button>
          ))}
        </div>
      )}
    </div>
  )
}

// 📱 Only got the email, never the text? (Neal, 2026-10-05) Text START to our number, then tap to
// get your own link by text — proves texts reach you again.
function TextMeBox({ slug, who, L }) {
  const [st, setSt] = useState(null)
  const go = async () => {
    setSt({ busy: true })
    const j = await call({ action: 'text_me', room: slug, ...(who.t ? { t: who.t } : { g: who.g }) }).catch(() => ({ error: 'Network error' }))
    setSt(j)
  }
  return (
    <div style={{ margin: '0 auto 12px', maxWidth: 480, padding: '10px 14px', borderRadius: 12, background: L.card, border: '1px solid #475569', fontSize: 14, lineHeight: 1.45 }}>
      <div style={{ fontWeight: 800, color: L.head }}>📱 Only got the email, not our text?</div>
      <div style={{ marginTop: 4, color: L.text }}>1) From your phone, text <b>START</b> to <a href="sms:+17273493584&body=START" style={{ color: '#60a5fa', fontWeight: 800 }}>(727) 349-3584</a>.<br />2) Then tap:</div>
      <button onClick={go} disabled={st?.busy} style={{ marginTop: 6, padding: '7px 14px', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>{st?.busy ? 'Sending…' : '📲 Text me my link'}</button>
      {st && !st.busy && <div style={{ marginTop: 6, fontWeight: 700, color: st.ok ? '#4ade80' : '#fbbf24' }}>{st.ok ? `✅ Sent to your phone ending ${st.last4}. If it doesn't arrive in a minute, tell your manager.` : `${st.error}${st.last4 ? ` (Phone on file ends ${st.last4}.)` : ''}`}</div>}
    </div>
  )
}

// The same choice inside the Present / Scripture panels, so it's set BEFORE presenting (Neal,
// 2026-10-05: "you don't want to be switching back and forth while you're in a presentation").
function LayoutPick({ layout, onLayout }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12.5, color: '#94a3b8', marginBottom: 4 }}>Your camera while presenting:</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
        {LAYOUTS.map(([k, l]) => (
          <button key={k} onClick={() => onLayout(k)} style={{ padding: '6px 8px', borderRadius: 7, border: 'none', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', background: layout === k ? '#2563eb' : '#334155', color: '#fff' }}>{l}</button>
        ))}
      </div>
    </div>
  )
}

// 🔗 SHARE MEETING (Neal, 2026-10-05: "just like Zoom has"): the room's link to copy and paste,
// or send by text / email. A public room (the devotional) — anyone with it can join. A private room
// — it's the door; team members still sign in with their own link or name.
function SharePanel({ room, onClose }) {
  const link = `https://trainingmanagementsys.netlify.app/meet/${room.slug}`
  const [copied, setCopied] = useState(false)
  const copy = async () => { try { await navigator.clipboard.writeText(link) } catch { const t = document.createElement('textarea'); t.value = link; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove() } setCopied(true); setTimeout(() => setCopied(false), 2000) }
  return (
    <div style={{ position: 'absolute', top: 8, right: 12, zIndex: 60, width: 360, background: '#111827', border: '1px solid #2563eb', borderRadius: 12, padding: 14, color: '#e5e7eb', fontSize: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}><b style={{ flex: 1 }}>🔗 Share {room.title}</b><button onClick={onClose} style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: 18, cursor: 'pointer' }}>×</button></div>
      <div style={{ padding: '8px 10px', borderRadius: 8, background: '#0b1220', border: '1px solid #374151', fontFamily: 'ui-monospace, monospace', fontSize: 13, wordBreak: 'break-all' }}>{link}</div>
      <button onClick={copy} style={{ marginTop: 8, width: '100%', padding: '9px', borderRadius: 8, border: 'none', background: copied ? '#16a34a' : '#2563eb', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>{copied ? '✓ Copied. Paste it anywhere' : '📋 Copy link'}</button>
      <div style={{ marginTop: 8, fontSize: 12, color: '#94a3b8' }}>{room.public ? 'Anyone with this link can join (they put in their name and email).' : 'People from the company sign in with their own link; this link is the way in.'}</div>
    </div>
  )
}

// NO WHITE SCREENS (Neal, 2026-10-05: joining the Managers Meeting white-screened). If anything in the
// meeting view throws, show a Rejoin button instead of a blank page, and report the error so it can
// be fixed (meet.js client_error → app_settings meet_client_errors).
class MeetErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null } }
  static getDerivedStateFromError(err) { return { err } }
  componentDidCatch(err, info) {
    try { fetch('/.netlify/functions/meet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'client_error', room: this.props.slug, message: String(err?.message || err).slice(0, 500), stack: String(err?.stack || '').slice(0, 1500), where: String(info?.componentStack || '').slice(0, 1500), ua: navigator.userAgent.slice(0, 200) }) }) } catch { /* best effort */ }
  }
  render() {
    if (!this.state.err) return this.props.children
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0b1220', color: '#fff', textAlign: 'center', padding: 20 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 900 }}>Something went wrong on this screen</div>
          <div style={{ marginTop: 8, color: '#94a3b8' }}>You're still in the meeting. Tap Rejoin to bring it back.</div>
          <button onClick={() => window.location.reload()} style={{ marginTop: 16, padding: '12px 22px', borderRadius: 10, border: 'none', background: '#16a34a', color: '#fff', fontWeight: 900, fontSize: 16, cursor: 'pointer' }}>↻ Rejoin</button>
        </div>
      </div>
    )
  }
}
