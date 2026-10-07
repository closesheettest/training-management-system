// 💻 RECORD TO THE HOST'S COMPUTER (Neal, 2026-10-06: "Zoom records to that person's computer — why
// can't we?"). For rooms set to "Save recordings to: the host's computer". The host's browser records
// the meeting tab (what they see) plus their own mic, and the file lands in their Downloads.
//   • Chrome asks once which tab to record (this tab is pre-picked) — browsers never allow silent capture.
//   • Tab audio = everyone else; the host's own mic is mixed in (tab capture never includes it).
//   • Chunks are written to the browser's private disk as they arrive (OPFS), not held in memory, so a
//     crash at minute 40 keeps 40 minutes: the next visit to a meeting offers "⬇ Save it".
//   • Output is .mp4 where the browser can (recent Chrome), else .webm (plays in Chrome, VLC; YouTube takes both).
const DIR = 'meet-recordings'

async function opfsDir() {
  try { const root = await navigator.storage.getDirectory(); return await root.getDirectoryHandle(DIR, { create: true }) } catch { return null }
}

// The one recording running on this page. Kept OUTSIDE the meeting screen so it survives the screen
// re-drawing itself (a reconnect) — before, the screen forgot it and lost its Stop button (Neal, 2026-10-06).
let ACTIVE = null
export const activeRecorder = () => ACTIVE

export const localRecordSupported = () => typeof window !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia && typeof MediaRecorder !== 'undefined'

export class LocalRecorder {
  constructor({ fileName, micTrack, folderId, camTrack, liveRoom, cropEl, onlyEl }) { this.cropEl = cropEl || null; this.onlyEl = onlyEl || null; this.fileName = fileName; this.micTrack = micTrack || null; this.camTrack = camTrack || null; this.liveRoom = liveRoom || null; this.folderId = folderId ? String(folderId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) : null; this.chunks = []; this.onStopped = null }

  // MUST be called straight from a click (the browser requires it for the "share this tab" box).
  async start() {
    const display = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 }, audio: { suppressLocalAudioPlayback: false },
      preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude', systemAudio: 'include',
    })
    this.display = display
    // EVERYONE'S VOICE (Neal, 2026-10-07: the recording had only his voice). The tab's own sound often doesn't come with
    // "share this tab", so with the meeting at hand every voice is taken straight from it — each attendee's audio
    // plus the host's mic — and anyone who joins (or unmutes) later is added as they arrive. Without the meeting, the
    // old way: the tab's sound + the mic.
    const ctx = new AudioContext(), dest = ctx.createMediaStreamDestination()
    const added = new Set()
    // Chrome only feeds a REMOTE WebRTC track into Web Audio while a media element is playing that same stream —
    // otherwise it mixes in silence (still no attendee voice after the first fix, 2026-10-07; same trick as MeetPractice).
    this.keepAlive = []
    const add = (t, remote) => {
      if (!t || added.has(t.id) || t.readyState !== 'live') return; added.add(t.id)
      try {
        const ms = new MediaStream([t])
        if (remote) { const a = new Audio(); a.muted = true; a.srcObject = ms; a.play().catch(() => {}); this.keepAlive.push(a) }
        ctx.createMediaStreamSource(ms).connect(dest)
      } catch { /* track gone */ }
    }
    const R = this.liveRoom
    if (R) {
      const each = () => {
        for (const p of R.remoteParticipants?.values?.() || []) for (const pub of p.audioTrackPublications?.values?.() || []) add(pub.track?.mediaStreamTrack, true)
        for (const pub of R.localParticipant?.audioTrackPublications?.values?.() || []) add(pub.track?.mediaStreamTrack)
      }
      each(); add(this.micTrack)
      this.onRoomTrack = () => each()
      for (const ev of ['trackSubscribed', 'localTrackPublished', 'trackUnmuted']) R.on(ev, this.onRoomTrack)
    } else for (const t of [...display.getAudioTracks(), ...(this.micTrack ? [this.micTrack] : [])]) add(t)
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    this.ctx = ctx
    // STEADY 30 FPS (Neal, 2026-10-07: the meeting-view MP4 played as a frozen still with the sound running). A captured
    // tab only sends a frame when the screen changes; MP4 players freeze on that. Redrawn onto a canvas 30 times a
    // second, the recorder gets an even stream of frames.
    let vTrack = display.getVideoTracks()[0]
    // JUST THE MEETING PICTURE (Neal, 2026-10-07: "yes for sure" — leave the toolbars out). Chrome's Region Capture
    // crops this tab's capture to one element: the stage between the top toolbar and the mic/camera bar.
    // Best: Element Capture records ONLY the meeting view — anything floating on top of it (notes, Present, Host
    // controls) is left out even where it covers the video. Older Chrome: Region Capture crops to the stage instead.
    let restricted = false
    if (this.onlyEl && window.RestrictionTarget && vTrack.restrictTo) {
      try { await vTrack.restrictTo(await window.RestrictionTarget.fromElement(this.onlyEl)); restricted = true } catch { /* crop instead */ }
    }
    if (!restricted && this.cropEl && window.CropTarget && vTrack.cropTo) {
      try { await vTrack.cropTo(await window.CropTarget.fromElement(this.cropEl)) } catch { /* whole tab then */ }
    }
    try {
      // FRAMES STRAIGHT FROM THE CAPTURE (2026-10-07: still frozen — a video element that isn't on the page can stop
      // updating, so the canvas kept drawing the first frame). MediaStreamTrackProcessor hands over every frame the tab
      // sends; the newest one is drawn 30 times a second. Where that isn't available, the video element is put ON the
      // page (tiny and see-through) so Chrome keeps it playing.
      let latest = null
      if (typeof window.MediaStreamTrackProcessor === 'function') {
        try {
          const reader = new window.MediaStreamTrackProcessor({ track: vTrack }).readable.getReader()
          this.frameReader = reader
          ;(async () => { for (;;) { const { value, done } = await reader.read(); if (done) break; const old = latest; latest = value; try { old?.close() } catch { /* fine */ } } })().catch(() => {})
          this.closeFrame = () => { try { latest?.close() } catch { /* fine */ } latest = null }
        } catch { latest = null }
      }
      const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.srcObject = new MediaStream([vTrack])
      v.style.cssText = 'position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1'
      document.body.appendChild(v)
      await v.play()
      const cv = document.createElement('canvas'); const g = cv.getContext('2d')
      const st = vTrack.getSettings ? vTrack.getSettings() : {}
      // At most 1920×1080 (even sizes): a Retina tab is ~3000 wide, more than an MP4 player expects.
      const fit = (w, h) => { const k = Math.min(1, 1920 / (w || 1280), 1080 / (h || 720)); return [Math.round(((w || 1280) * k) / 2) * 2, Math.round(((h || 720) * k) / 2) * 2] }
      // ALWAYS 1920×1080 (2026-10-07: a narrow window recorded at 1228×1080 — Chrome's MP4 encoder corrupted it and
      // QuickTime couldn't decode a single frame). The tab is fitted inside, black bars on the sides / top as needed.
      cv.width = 1920; cv.height = 1080; void fit; void st
      this.drawTimer = setInterval(() => {
        try {
          const src = latest || v
          const sw = latest ? latest.displayWidth : v.videoWidth, sh = latest ? latest.displayHeight : v.videoHeight
          if (!sw || !sh) return
          const k = Math.min(1920 / sw, 1080 / sh), dw = Math.round(sw * k), dh = Math.round(sh * k)
          g.fillStyle = '#000'; g.fillRect(0, 0, 1920, 1080)
          g.drawImage(src, Math.round((1920 - dw) / 2), Math.round((1080 - dh) / 2), dw, dh)
        } catch { /* a frame skipped */ }
      }, 1000 / 30)
      this.drawVideo = v
      vTrack = cv.captureStream(30).getVideoTracks()[0] || vTrack
    } catch { /* fall back to the raw tab frames */ }
    const stream = new MediaStream([vTrack, ...dest.stream.getAudioTracks()])
    // MP4 FIRST (Neal, 2026-10-07: can it go to YouTube, can it be edited?): recent Chrome records MP4, which opens in
    // QuickTime / iMovie / any editor and uploads to YouTube. Older browsers fall back to WebM (YouTube takes that too).
    // HIGH PROFILE (avc1.640028 = level 4.0, up to 1080p). The baseline 42E01E only covers ~720×576, so a full-size tab
    // came out as one frame and silence-for-video in QuickTime (2026-10-07).
    const type = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.4d0028,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,opus', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || ''
    this.ext = type.startsWith('video/mp4') ? 'mp4' : 'webm'; this.mime = type.startsWith('video/mp4') ? 'video/mp4' : 'video/webm'
    this.fileName = this.fileName.replace(/\.(webm|mp4)$/i, '') + '.' + this.ext
    this.rec = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: 5_000_000 })
    const dir = await opfsDir()
    if (dir) {
      this.handle = await dir.getFileHandle(`${Date.now()}__${this.fileName}`, { create: true })
      this.writable = await this.handle.createWritable()
    }
    this.queue = Promise.resolve()
    this.rec.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return
      if (this.writable) this.queue = this.queue.then(() => this.writable.write(e.data)).catch(() => { this.chunks.push(e.data) })
      else this.chunks.push(e.data)
    }
    // The browser's own "Stop sharing" bar ends the recording too.
    display.getVideoTracks()[0].addEventListener('ended', () => { if (this.rec?.state === 'recording') this.stop() })
    this.rec.start(2000)
    // THE HOST'S CAMERA ON ITS OWN (the room's two-file setting): its own recorder + private file, saved next to the meeting.
    if (this.camTrack && this.camTrack.readyState === 'live') {
      try {
        const camStream = new MediaStream([this.camTrack.clone(), ...(this.micTrack ? [this.micTrack.clone()] : [])])
        this.camRec = new MediaRecorder(camStream, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: 4_000_000 })
        this.camName = this.fileName.replace(/\.(webm|mp4)$/i, '') + ' - camera.' + this.ext
        if (dir) { this.camHandle = await dir.getFileHandle(`${Date.now()}__${this.camName}`, { create: true }); this.camWritable = await this.camHandle.createWritable() }
        this.camChunks = []; this.camQueue = Promise.resolve()
        this.camRec.ondataavailable = (e) => {
          if (!e.data || !e.data.size) return
          if (this.camWritable) this.camQueue = this.camQueue.then(() => this.camWritable.write(e.data)).catch(() => { this.camChunks.push(e.data) })
          else this.camChunks.push(e.data)
        }
        this.camRec.start(2000)
      } catch { this.camRec = null }
    }
    this.startedAt = Date.now()
    ACTIVE = this
  }

  async stop() {
    if (this.stopping) return this.stopping
    // SAVE AS (Neal, 2026-10-06: "what folder… how you name the file"): pressing Stop opens Chrome's Save
    // box with the name filled in, so the host picks the folder and can rename it. Must open right away
    // (it needs the click); if it can't (stopped by someone else / the browser bar), it downloads instead.
    let saveTo = null, saveDir = null
    // Two files → pick the FOLDER once and both land in it (a second Save box can't open without another click).
    if (this.camRec && window.showDirectoryPicker) {
      try { saveDir = await window.showDirectoryPicker({ id: this.folderId || 'meet-recordings', mode: 'readwrite', startIn: 'videos' }) } catch { saveDir = null }
    } else if (window.showSaveFilePicker) {
      // id = remember the folder per room: after the first save, the box opens straight to that folder
      // (e.g. a shared iCloud / Google Drive "Devotional Recordings" folder Dianne can see) — just press Save.
      try { saveTo = await window.showSaveFilePicker({ id: this.folderId || 'meet-recordings', startIn: 'videos', suggestedName: this.fileName, types: [this.ext === 'mp4' ? { description: 'Video (MP4)', accept: { 'video/mp4': ['.mp4'] } } : { description: 'Video (WebM)', accept: { 'video/webm': ['.webm'] } }] }) } catch { saveTo = null }
    }
    this.stopping = (async () => {
      if (this.rec && this.rec.state !== 'inactive') await new Promise((res) => { this.rec.onstop = res; this.rec.stop() })
      if (this.camRec && this.camRec.state !== 'inactive') await new Promise((res) => { this.camRec.onstop = res; this.camRec.stop() })
      try { this.display?.getTracks().forEach((t) => t.stop()) } catch { /* fine */ }
      clearInterval(this.drawTimer); try { this.drawVideo?.pause(); if (this.drawVideo) { this.drawVideo.srcObject = null; this.drawVideo.remove() } } catch { /* fine */ }
      try { this.frameReader?.cancel() } catch { /* fine */ } this.closeFrame?.()
      for (const a of this.keepAlive || []) { try { a.pause(); a.srcObject = null } catch { /* fine */ } }
      if (this.liveRoom && this.onRoomTrack) for (const ev of ['trackSubscribed', 'localTrackPublished', 'trackUnmuted']) { try { this.liveRoom.off(ev, this.onRoomTrack) } catch { /* fine */ } }
      try { await this.ctx?.close() } catch { /* fine */ }
      await this.queue
      let blob
      if (this.writable) { try { await this.writable.close() } catch { /* fine */ } blob = await this.handle.getFile() }
      else blob = new Blob(this.chunks, { type: this.mime || 'video/webm' })
      let camBlob = null
      if (this.camRec) {
        await this.camQueue
        if (this.camWritable) { try { await this.camWritable.close() } catch { /* fine */ } camBlob = await this.camHandle.getFile() }
        else camBlob = new Blob(this.camChunks, { type: this.mime || 'video/webm' })
      }
      // SAVE WITH PROGRESS (Neal, 2026-10-07: "Zoom gives me a progress bar … this doesn't, so I don't know how much is
      // saved"). Written in 8 MB pieces; onProgress(0–100) after each, across every file being saved.
      const total = blob.size + (camBlob ? camBlob.size : 0); let done = 0
      const tick = (n) => { done += n; this.onProgress?.(total ? Math.min(100, Math.round((100 * done) / total)) : 100) }
      const pour = async (w, b) => { const CH = 8 * 1048576; for (let o = 0; o < b.size; o += CH) { const part = b.slice(o, o + CH); await w.write(part); tick(part.size) } }
      const into = async (d, name, b) => { const fh = await d.getFileHandle(name, { create: true }); const w = await fh.createWritable(); await pour(w, b); await w.close() }
      this.savedWhere = saveDir ? saveDir.name : saveTo ? saveTo.name : 'Downloads'
      this.savedFiles = [this.fileName, ...(camBlob ? [this.camName] : [])]
      this.onProgress?.(0)
      if (saveDir) {
        try { await into(saveDir, this.fileName, blob) } catch { download(blob, this.fileName) }
        if (camBlob) { try { await into(saveDir, this.camName, camBlob) } catch { download(camBlob, this.camName) } }
      } else {
        if (saveTo) { try { const w = await saveTo.createWritable(); await pour(w, blob); await w.close() } catch { download(blob, this.fileName) } }
        else download(blob, this.fileName)
        if (camBlob) download(camBlob, this.camName)
      }
      if (this.camHandle) setTimeout(async () => { try { const dir = await opfsDir(); await dir.removeEntry(this.camHandle.name) } catch { /* fine */ } }, 60000)
      // Downloaded → remove the private copy a minute later (the download has its own file by then).
      if (this.handle) setTimeout(async () => { try { const dir = await opfsDir(); await dir.removeEntry(this.handle.name) } catch { /* fine */ } }, 60000)
      if (ACTIVE === this) ACTIVE = null
      this.onStopped?.()
    })()
    return this.stopping
  }
}

function download(blob, name) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 120000)
}

// Recordings left behind by a crash / closed tab (still in the private disk, never downloaded).
export async function leftoverRecordings() {
  const dir = await opfsDir(); if (!dir) return []
  const out = []
  try { for await (const [name, h] of dir.entries()) { if (h.kind === 'file') { const f = await h.getFile(); if (f.size > 0 && Date.now() - Number(name.split('__')[0]) > 90000) out.push({ name, size: f.size }) } } } catch { /* none */ }
  return out
}
export async function saveLeftover(name) {
  const dir = await opfsDir(); if (!dir) return
  const h = await dir.getFileHandle(name); const f = await h.getFile()
  download(f, name.split('__').slice(1).join('__') || 'recording.webm')
  setTimeout(async () => { try { await dir.removeEntry(name) } catch { /* fine */ } }, 60000)
}
export async function dropLeftover(name) { const dir = await opfsDir(); try { await dir.removeEntry(name) } catch { /* fine */ } }
