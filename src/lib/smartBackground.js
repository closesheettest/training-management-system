// SMART BACKGROUND — our own camera background processor (Neal, 2026-10-04: LiveKit's stock one
// "looks very bad… Zoom and Google work way, way better"). The stock one cuts a hard yes/no
// outline from a small mask and redraws it from scratch every frame, so the edge shimmers and the
// real wall shows as a halo. This one:
//   • uses Google's multiclass selfie model (hair, face, body, clothes) and its SOFT confidence
//     mask, so the edge fades instead of stepping;
//   • smooths the mask from frame to frame (follows quickly when you really move, steadies the
//     edge when you're still), which is what stops the flicker;
//   • tightens the edge slightly so the room behind you doesn't leak through as an outline.
// It plugs into LiveKit as a normal track processor, so everyone (and the recording) sees it.
// Chrome/Edge use the insertable-streams path (keeps running when the tab is in the background);
// other browsers fall back to a canvas loop.
import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision'

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite'
const M = 256 // the model works at 256×256

let filesetP = null
const fileset = () => (filesetP ||= FilesetResolver.forVisionTasks(WASM))
async function makeSegmenter() {
  const fs = await fileset()
  const opts = (delegate) => ({ baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', outputCategoryMask: false, outputConfidenceMasks: true })
  try { return await ImageSegmenter.createFromOptions(fs, opts('GPU')) } catch { return ImageSegmenter.createFromOptions(fs, opts('CPU')) }
}
const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = src })
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

export const smartBackgroundSupported = () => typeof window !== 'undefined' && !!window.WebGL2RenderingContext && typeof HTMLCanvasElement !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype

// opts: { mode: 'blur' } | { mode: 'image', imagePath }
export class SmartBackground {
  name = 'smart-background'
  constructor(opts) { this.opts = opts; this.bg = null; this.prev = new Float32Array(M * M); this.hasPrev = false; this.lastTs = 0 }

  async setOptions(opts) {
    this.opts = opts
    this.bg = opts.mode === 'image' && opts.imagePath ? await loadImg(opts.imagePath).catch(() => null) : null
  }

  async init({ track }) {
    await this.setOptions(this.opts)
    this.seg = this.seg || (await makeSegmenter())
    this.small = document.createElement('canvas'); this.small.width = M; this.small.height = M
    this.sctx = this.small.getContext('2d', { willReadFrequently: true })
    this.mask = document.createElement('canvas'); this.mask.width = M; this.mask.height = M
    this.mctx = this.mask.getContext('2d')
    this.maskData = this.mctx.createImageData(M, M)
    this.out = document.createElement('canvas')
    this.octx = this.out.getContext('2d')
    this.hasPrev = false
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

  async destroy() { await this.stopPipeline(); try { this.seg?.close() } catch { /* fine */ } this.seg = null }

  draw(src, w, h) {
    if (this.out.width !== w || this.out.height !== h) { this.out.width = w; this.out.height = h }
    const c = this.octx
    // 1) The person mask, softened and steadied.
    this.sctx.drawImage(src, 0, 0, M, M)
    let ts = performance.now(); if (ts <= this.lastTs) ts = this.lastTs + 1; this.lastTs = ts
    this.seg.segmentForVideo(this.small, ts, (res) => {
      // Person = hair + body skin + face skin + clothes (classes 1–4), plus class 5 ("others": a
      // laptop or mug in front of you) only in the lower part of the frame — up top it was
      // picking up bits of the room (a ceiling fan floating by your head).
      const ms = res.confidenceMasks || []
      if (ms.length < 5) return
      const parts = [1, 2, 3, 4, 5].map((k) => ms[k].getAsFloat32Array()), lowStart = Math.round(M * 0.55) * M
      const prev = this.prev, d = this.maskData.data, first = !this.hasPrev
      for (let i = 0; i < prev.length; i++) {
        const p = Math.min(1, parts[0][i] + parts[1][i] + parts[2][i] + parts[3][i] + (i >= lowStart ? parts[4][i] : 0))
        // Follow fast on a real change (you moved), steady on small wobble (edge noise).
        const s = first ? p : prev[i] + (p - prev[i]) * (Math.abs(p - prev[i]) > 0.3 ? 0.9 : 0.5)
        prev[i] = s
        d[i * 4 + 3] = 255 * smooth(0.45, 0.8, s) // tighten: no room-coloured outline
      }
      this.hasPrev = true
    })
    this.mctx.putImageData(this.maskData, 0, 0)
    // 2) Person = camera image cut by the (scaled-up, feathered) mask.
    c.save()
    c.globalCompositeOperation = 'copy'
    c.filter = `blur(${Math.max(1, Math.round(w / 640))}px)`
    c.drawImage(this.mask, 0, 0, w, h)
    c.filter = 'none'
    c.globalCompositeOperation = 'source-in'
    c.drawImage(src, 0, 0, w, h)
    // 3) The new background behind.
    c.globalCompositeOperation = 'destination-over'
    if (this.bg) {
      const s = Math.max(w / this.bg.width, h / this.bg.height), bw = this.bg.width * s, bh = this.bg.height * s
      c.drawImage(this.bg, (w - bw) / 2, (h - bh) / 2, bw, bh)
    } else {
      c.filter = `blur(${Math.round(w / 90)}px)`
      c.drawImage(src, 0, 0, w, h)
      c.filter = 'none'
    }
    c.restore()
  }
}
