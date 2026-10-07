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
  constructor({ fileName, micTrack, folderId, camTrack }) { this.fileName = fileName; this.micTrack = micTrack || null; this.camTrack = camTrack || null; this.folderId = folderId ? String(folderId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) : null; this.chunks = []; this.onStopped = null }

  // MUST be called straight from a click (the browser requires it for the "share this tab" box).
  async start() {
    const display = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 }, audio: { suppressLocalAudioPlayback: false },
      preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude', systemAudio: 'include',
    })
    this.display = display
    // Mix the tab's sound (everyone else) with the host's own mic.
    const ctx = new AudioContext(), dest = ctx.createMediaStreamDestination()
    for (const t of [...display.getAudioTracks(), ...(this.micTrack ? [this.micTrack] : [])]) {
      try { ctx.createMediaStreamSource(new MediaStream([t])).connect(dest) } catch { /* track gone */ }
    }
    this.ctx = ctx
    const stream = new MediaStream([...display.getVideoTracks(), ...dest.stream.getAudioTracks()])
    // MP4 FIRST (Neal, 2026-10-07: can it go to YouTube, can it be edited?): recent Chrome records MP4, which opens in
    // QuickTime / iMovie / any editor and uploads to YouTube. Older browsers fall back to WebM (YouTube takes that too).
    const type = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,opus', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || ''
    this.ext = type.startsWith('video/mp4') ? 'mp4' : 'webm'; this.mime = type.startsWith('video/mp4') ? 'video/mp4' : 'video/webm'
    this.fileName = this.fileName.replace(/\.(webm|mp4)$/i, '') + '.' + this.ext
    this.rec = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: 2_500_000 })
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
