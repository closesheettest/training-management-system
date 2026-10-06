// 💻 RECORD TO THE HOST'S COMPUTER (Neal, 2026-10-06: "Zoom records to that person's computer — why
// can't we?"). For rooms set to "Save recordings to: the host's computer". The host's browser records
// the meeting tab (what they see) plus their own mic, and the file lands in their Downloads.
//   • Chrome asks once which tab to record (this tab is pre-picked) — browsers never allow silent capture.
//   • Tab audio = everyone else; the host's own mic is mixed in (tab capture never includes it).
//   • Chunks are written to the browser's private disk as they arrive (OPFS), not held in memory, so a
//     crash at minute 40 keeps 40 minutes: the next visit to a meeting offers "⬇ Save it".
//   • Output is .webm (plays in Chrome, VLC; QuickTime needs converting).
const DIR = 'meet-recordings'

async function opfsDir() {
  try { const root = await navigator.storage.getDirectory(); return await root.getDirectoryHandle(DIR, { create: true }) } catch { return null }
}

export const localRecordSupported = () => typeof window !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia && typeof MediaRecorder !== 'undefined'

export class LocalRecorder {
  constructor({ fileName, micTrack, folderId }) { this.fileName = fileName; this.micTrack = micTrack || null; this.folderId = folderId ? String(folderId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) : null; this.chunks = []; this.onStopped = null }

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
    const type = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || ''
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
    this.startedAt = Date.now()
  }

  async stop() {
    if (this.stopping) return this.stopping
    // SAVE AS (Neal, 2026-10-06: "what folder… how you name the file"): pressing Stop opens Chrome's Save
    // box with the name filled in, so the host picks the folder and can rename it. Must open right away
    // (it needs the click); if it can't (stopped by someone else / the browser bar), it downloads instead.
    let saveTo = null
    if (window.showSaveFilePicker) {
      // id = remember the folder per room: after the first save, the box opens straight to that folder
      // (e.g. a shared iCloud / Google Drive "Devotional Recordings" folder Dianne can see) — just press Save.
      try { saveTo = await window.showSaveFilePicker({ id: this.folderId || 'meet-recordings', startIn: 'videos', suggestedName: this.fileName, types: [{ description: 'Video (WebM)', accept: { 'video/webm': ['.webm'] } }] }) } catch { saveTo = null }
    }
    this.stopping = (async () => {
      if (this.rec && this.rec.state !== 'inactive') await new Promise((res) => { this.rec.onstop = res; this.rec.stop() })
      try { this.display?.getTracks().forEach((t) => t.stop()) } catch { /* fine */ }
      try { await this.ctx?.close() } catch { /* fine */ }
      await this.queue
      let blob
      if (this.writable) { try { await this.writable.close() } catch { /* fine */ } blob = await this.handle.getFile() }
      else blob = new Blob(this.chunks, { type: 'video/webm' })
      if (saveTo) { try { const w = await saveTo.createWritable(); await w.write(blob); await w.close() } catch { download(blob, this.fileName) } }
      else download(blob, this.fileName)
      // Downloaded → remove the private copy a minute later (the download has its own file by then).
      if (this.handle) setTimeout(async () => { try { const dir = await opfsDir(); await dir.removeEntry(this.handle.name) } catch { /* fine */ } }, 60000)
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
