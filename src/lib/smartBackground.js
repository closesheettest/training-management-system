// SMART BACKGROUND — our own camera background processor (Neal, 2026-10-04: LiveKit's stock one
// "looks very bad… Zoom and Google work way, way better"). The stock one cuts a hard yes/no
// outline from a small mask and redraws it from scratch every frame, so the edge shimmers and the
// real wall shows as a halo. This one:
//   • uses Google's multiclass selfie model (hair, face, body, clothes) and its SOFT confidence
//     mask, so the edge fades instead of stepping;
//   • steadies the mask from frame to frame, follows at once when you really move;
//   • tightens the edge slightly so the room behind you doesn't leak through as an outline;
//   • finds the person in a background worker (public/bg-worker.js), so the camera never waits
//     for it. Doing it in line took ~38 ms a frame on Neal's Mac (17 fps → blurry when moving);
//     now each frame only gets the quick final drawing, with the newest mask.
// It plugs into LiveKit as a normal track processor, so everyone (and the recording) sees it.
// Chrome/Edge use the insertable-streams path (keeps running when the tab is in the background);
// other browsers fall back to a canvas loop.
const M = 256

const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = src })

export const smartBackgroundSupported = () => typeof window !== 'undefined' && !!window.WebGL2RenderingContext && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function' && typeof Worker !== 'undefined'

// opts: { mode: 'blur' } | { mode: 'image', imagePath }
export class SmartBackground {
  name = 'smart-background'
  constructor(opts) { this.opts = opts; this.bg = null; this.busy = false; this.haveMask = false; this.ready = false }

  async setOptions(opts) {
    this.opts = opts
    this.bg = opts.mode === 'image' && opts.imagePath ? await loadImg(opts.imagePath).catch(() => null) : null
  }

  startWorker() {
    if (this.worker) return
    this.worker = new Worker('/bg-worker.js')
    this.worker.onmessage = (e) => {
      const m = e.data
      if (m.type === 'ready') { this.ready = true; return }
      if (m.type === 'mask') { this.fillMask(m.alpha); this.haveMask = true }
      this.busy = false
    }
    this.worker.postMessage({ type: 'init' })
  }

  fillMask(alpha) {
    const d = this.maskData.data
    for (let i = 0; i < alpha.length; i++) d[i * 4 + 3] = alpha[i]
    this.mctx.putImageData(this.maskData, 0, 0)
  }

  async init({ track }) {
    await this.setOptions(this.opts)
    this.mask = document.createElement('canvas'); this.mask.width = M; this.mask.height = M
    this.mctx = this.mask.getContext('2d')
    this.maskData = this.mctx.createImageData(M, M)
    this.tiny = document.createElement('canvas'); this.tiny.width = 96; this.tiny.height = 54 // cheap blur
    this.tctx = this.tiny.getContext('2d')
    this.out = document.createElement('canvas')
    this.octx = this.out.getContext('2d')
    this.haveMask = false; this.busy = false
    this.startWorker()
    if (typeof window.MediaStreamTrackProcessor === 'function' && typeof window.MediaStreamTrackGenerator === 'function') {
      const proc = new window.MediaStreamTrackProcessor({ track })
      const gen = new window.MediaStreamTrackGenerator({ kind: 'video' })
      this.abort = new AbortController()
      const tf = new TransformStream({
        transform: (frame, ctl) => {
          try {
            this.draw(frame, frame.displayWidth, frame.displayHeight)
            ctl.enqueue(new VideoFrame(this.out, { timestamp: frame.timestamp }))
          } catch { ctl.enqueue(frame.clone()) } finally { frame.close() }
        },
      })
      proc.readable.pipeThrough(tf, { signal: this.abort.signal }).pipeTo(gen.writable, { signal: this.abort.signal }).catch(() => {})
      this.processedTrack = gen
    } else {
      const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.srcObject = new MediaStream([track]); await v.play().catch(() => {})
      this.video = v
      const loop = () => { if (!this.video) return; if (v.videoWidth) this.draw(v, v.videoWidth, v.videoHeight); this.raf = requestAnimationFrame(loop) }
      loop()
      this.processedTrack = this.out.captureStream(30).getVideoTracks()[0]
    }
  }

  async restart(opts) { await this.stopPipeline(); await this.init(opts) }

  async stopPipeline() {
    try { this.abort?.abort() } catch { /* already stopped */ }
    if (this.raf) cancelAnimationFrame(this.raf)
    if (this.video) { this.video.srcObject = null; this.video = null }
    try { this.processedTrack?.stop() } catch { /* fine */ }
  }

  async destroy() {
    await this.stopPipeline()
    try { this.worker?.postMessage({ type: 'close' }) } catch { /* fine */ }
    this.worker = null; this.ready = false
  }

  draw(src, w, h) {
    if (this.out.width !== w || this.out.height !== h) { this.out.width = w; this.out.height = h }
    // Hand the worker the newest frame whenever it's free (it never holds this frame up).
    if (this.ready && !this.busy) {
      this.busy = true
      createImageBitmap(src, { resizeWidth: M, resizeHeight: M, resizeQuality: 'low' })
        .then((bitmap) => { if (this.worker) this.worker.postMessage({ type: 'frame', bitmap, ts: performance.now() }, [bitmap]); else this.busy = false })
        .catch(() => { this.busy = false })
    }
    const c = this.octx
    if (!this.haveMask) { c.globalCompositeOperation = 'copy'; c.drawImage(src, 0, 0, w, h); return } // before the first mask
    c.save()
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'
    // Person = camera image cut by the mask (scaled up smoothly, which softens the edge).
    c.globalCompositeOperation = 'copy'
    c.drawImage(this.mask, 0, 0, w, h)
    c.globalCompositeOperation = 'source-in'
    c.drawImage(src, 0, 0, w, h)
    // The new background behind.
    c.globalCompositeOperation = 'destination-over'
    if (this.bg) {
      const s = Math.max(w / this.bg.width, h / this.bg.height), bw = this.bg.width * s, bh = this.bg.height * s
      c.drawImage(this.bg, (w - bw) / 2, (h - bh) / 2, bw, bh)
    } else {
      // Blur = draw the room tiny, then stretch it back up (cheap, smooth).
      this.tctx.drawImage(src, 0, 0, this.tiny.width, this.tiny.height)
      c.drawImage(this.tiny, 0, 0, w, h)
    }
    c.restore()
  }
}
