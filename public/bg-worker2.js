// Background worker for the HD meeting background (src/lib/smartBackgroundHD.js, Neal 2026-10-06:
// "I can be on a Zoom and it looks much better"). Differences from bg-worker.js:
//   • Google's LANDSCAPE selfie model — built for video calls, takes a 256×144 (16:9) frame, so the
//     camera picture is no longer squashed into a square before we look for the person;
//   • sends the RAW soft confidence (0–255) — the edge is decided later, on the graphics chip, against
//     the full-size camera picture (that's where the sharpness comes from).
// In: { type:'init', model? } then { type:'frame', bitmap, ts }. Out: { type:'mask', alpha, w, h }.
// Classic worker (MediaPipe loads with importScripts); our code in its own scope.
self.exports = {}
self.document = self.document || {}
importScripts('/mediapipe/vision_bundle.js')

;(() => {
const { FilesetResolver, ImageSegmenter } = self.exports
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
const MODELS = {
  landscape: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite',
  multiclass: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite',
}
let seg = null, prev = null, lastTs = 0, kind = 'landscape'

async function init(model) {
  kind = MODELS[model] ? model : 'landscape'
  const fs = await FilesetResolver.forVisionTasks(WASM)
  const opts = (delegate) => ({ baseOptions: { modelAssetPath: MODELS[kind], delegate }, canvas: new OffscreenCanvas(1, 1), runningMode: 'VIDEO', outputCategoryMask: false, outputConfidenceMasks: true })
  try { seg = await ImageSegmenter.createFromOptions(fs, opts('GPU')) } catch { seg = await ImageSegmenter.createFromOptions(fs, opts('CPU')) }
  prev = null
  postMessage({ type: 'ready', model: kind })
}

function frame(bitmap, ts) {
  if (!seg) { bitmap.close(); return postMessage({ type: 'skip' }) }
  if (ts <= lastTs) ts = lastTs + 1
  lastTs = ts
  const w = bitmap.width, h = bitmap.height
  let alpha = null
  seg.segmentForVideo(bitmap, ts, (res) => {
    const ms = res.confidenceMasks || []
    if (!ms.length) return
    const n = w * h
    let person
    if (ms.length >= 6) {
      // multiclass: person = 1 − background − (objects, lower part of the frame only)
      const bgc = ms[0].getAsFloat32Array(), oth = ms[5].getAsFloat32Array(), low = Math.round(h * 0.55) * w
      person = new Float32Array(n)
      for (let i = 0; i < n; i++) person[i] = Math.min(1, Math.max(0, 1 - bgc[i] - (i < low ? oth[i] : 0)))
    } else {
      // landscape selfie: one mask = how sure it is this pixel is the person (2 masks → [bg, person])
      person = (ms.length === 2 ? ms[1] : ms[0]).getAsFloat32Array()
    }
    if (!prev || prev.length !== n) prev = null
    const first = !prev
    if (first) prev = new Float32Array(n)
    alpha = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      const p = person[i]
      // Steady small wobble, follow at once on real movement.
      const s = first ? p : prev[i] + (p - prev[i]) * (Math.abs(p - prev[i]) > 0.2 ? 1 : 0.55)
      prev[i] = s
      alpha[i] = Math.round(255 * s)
    }
  })
  bitmap.close()
  if (alpha) postMessage({ type: 'mask', alpha, w, h }, [alpha.buffer]); else postMessage({ type: 'skip' })
}

self.onmessage = (e) => {
  const m = e.data
  if (m.type === 'init') init(m.model).catch((err) => postMessage({ type: 'error', error: String(err) }))
  else if (m.type === 'frame') { try { frame(m.bitmap, m.ts) } catch (err) { postMessage({ type: 'skip', error: String(err) }) } }
  else if (m.type === 'close') { try { seg?.close() } catch { /* fine */ } seg = null; close() }
}
})()
