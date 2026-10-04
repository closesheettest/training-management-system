// /recorder/:room — the page LiveKit's recorder films (customBaseUrl in meet.js record_start),
// so the recording looks like the meeting: the room's look and banner, the 📖 scripture slide
// with the host as a circle, a shared screen with the presenter circle, or the speaker big.
// LiveKit opens it with ?url=&token= and starts filming when it logs START_RECORDING.
import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { LiveKitRoom, RoomAudioRenderer, VideoTrack, useTracks, useRoomInfo, useSpeakingParticipants, isTrackReference, useRoomContext } from '@livekit/components-react'
import { Track, RoomEvent } from 'livekit-client'
import '@livekit/components-styles'
import { lookOf, FontsFor } from '../lib/meetLooks.jsx'
import { ScriptureSlide } from '../components/Scripture.jsx'
import { PodcastStage } from '../components/PodcastStage.jsx'

const metaOf = (p) => { try { return JSON.parse(p?.metadata || '{}') } catch { return {} } }

function Filmed({ room }) {
  const L = lookOf(room)
  const ctx = useRoomContext()
  useEffect(() => {
    const go = () => console.log('START_RECORDING')
    if (ctx.state === 'connected') go(); else ctx.once(RoomEvent.Connected, go)
    const end = () => console.log('END_RECORDING')
    ctx.on(RoomEvent.Disconnected, end)
    return () => { ctx.off(RoomEvent.Disconnected, end) }
  }, [ctx])
  const info = useRoomInfo()
  const meta = useMemo(() => { try { return JSON.parse(info.metadata || '{}') } catch { return {} } }, [info.metadata])
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: false }, { source: Track.Source.ScreenShare, withPlaceholder: false }])
  const speakers = useSpeakingParticipants()
  const [last, setLast] = useState(null)
  useEffect(() => { const s = speakers[0]; if (s) setLast(s.identity) }, [speakers])
  const cams = tracks.filter((t) => t.source === Track.Source.Camera && isTrackReference(t) && !t.publication?.isMuted)
  const share = tracks.find((t) => t.source === Track.Source.ScreenShare && isTrackReference(t))
  const sc = meta.scripture && meta.scripture.showing ? meta.scripture : null
  const hostCam = (id) => cams.find((t) => t.participant.identity === id)
  const big = cams.find((t) => t.participant.identity === meta.spotlight) || cams.find((t) => t.participant.identity === last) || cams.find((t) => metaOf(t.participant).host) || cams[0]
  const shareCam = share ? hostCam(share.participant.identity) : null
  const topic = meta.topic !== undefined ? meta.topic : room.topic
  const bn = L.banner || { bg: room.color || '#2563eb', color: '#fff', font: "'Oswald', sans-serif", upper: true }
  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', background: L.bg, fontFamily: L.fontBody, overflow: 'hidden' }}>
      <FontsFor look={L} />
      {topic && !sc && (
        <div style={{ background: bn.bg, color: bn.color, textAlign: 'center', padding: '10px 16px', fontFamily: bn.font, fontSize: bn.upper ? 34 : 40, fontWeight: bn.upper ? 800 : 600, textTransform: bn.upper ? 'uppercase' : 'none', borderBottom: bn.rule ? `3px solid ${bn.rule}` : 'none' }}>{topic}</div>
      )}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {sc ? <ScriptureSlide sc={sc} look={L} camTrack={hostCam(sc.by)} />
          : (meta.stage || []).length && !share ? <PodcastStage look={L} watching={0} people={(meta.stage || []).map((id) => { const c = cams.find((t) => t.participant.identity === id); return c ? { identity: id, name: c.participant.name || id, track: c } : null }).filter(Boolean)} />
          : share ? (
            <div style={{ position: 'relative', width: '100%', height: '100%', background: '#000' }}>
              <VideoTrack trackRef={share} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              {shareCam && <div style={{ position: 'absolute', right: '2.5%', bottom: '4%', width: '20%', aspectRatio: '1 / 1', borderRadius: '50%', overflow: 'hidden', border: '4px solid rgba(255,255,255,.85)' }}><VideoTrack trackRef={shareCam} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></div>}
            </div>
          ) : big ? <VideoTrack trackRef={big} style={{ width: '100%', height: '100%', objectFit: 'cover', background: '#000' }} />
            : <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: L.muted, fontFamily: L.fontHead, fontSize: 40 }}>{room.title}</div>}
      </div>
      <RoomAudioRenderer />
    </div>
  )
}

export default function Recorder() {
  const { room: slug } = useParams()
  const [sp] = useSearchParams()
  const [room, setRoom] = useState(null)
  useEffect(() => {
    fetch('/.netlify/functions/meet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'info', room: slug }) })
      .then((r) => r.json()).then((j) => setRoom(j.ok ? j.room : { slug, title: '' })).catch(() => setRoom({ slug, title: '' }))
  }, [slug])
  if (!room || !sp.get('url') || !sp.get('token')) return null
  return (
    <LiveKitRoom serverUrl={sp.get('url')} token={sp.get('token')} connect audio={false} video={false} style={{ height: '100vh' }}>
      <Filmed room={room} />
    </LiveKitRoom>
  )
}
