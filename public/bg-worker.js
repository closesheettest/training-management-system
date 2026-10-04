// Background worker for the meeting background (src/lib/smartBackground.js). Finds the person in
// each small (256×256) frame OFF the main thread, so the video itself never waits on it — that
// wait was what dropped the camera to ~17 fps and made movement look blurry (Neal, 2026-10-04).
// In: { type:'init' } then { type:'frame', bitmap, ts }. Out: { type:'mask', alpha: Uint8ClampedArray(256*256) }.
// A CLASSIC worker (not type:'module'): MediaPipe loads its engine with importScripts, which
// module workers don't allow. So the library comes in as its CommonJS build (our own copy:
// jsdelivr serves .cjs with a type workers refuse). Our code sits in its own scope below so its
// names can't clash with the library's globals.
self.exports = {}
self.document = self.document || {} // MediaPipe peeks at document.ontouchend (iPad check); a worker has no document
importScripts('/mediapipe/vision_bundle.js')

;(() => {
const { FilesetResolver, ImageSegmenter } = self.exports
const M = 256
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite'
let seg = null, prev = null, lastTs = 0
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }


async function init() {
  const fs = await FilesetResolver.forVisionTasks(WASM)
  const opts = (delegate) => ({ baseOptions: { modelAssetPath: MODEL, delegate }, canvas: new OffscreenCanvas(1, 1), runningMode: 'VIDEO', outputCategoryMask: false, outputConfidenceMasks: true })
  try { seg = await ImageSegmenter.createFromOptions(fs, opts('GPU')) } catch { seg = await ImageSegmenter.createFromOptions(fs, opts('CPU')) }
  prev = null
  postMessage({ type: 'ready' })
}

function frame(bitmap, ts) {
  if (!seg) { bitmap.close(); return postMessage({ type: 'skip' }) }
  if (ts <= lastTs) ts = lastTs + 1
  lastTs = ts
  let alpha = null
  seg.segmentForVideo(bitmap, ts, (res) => {
    const ms = res.confidenceMasks || []
    if (ms.length < 6) return
    // Person = hair + body + face + clothes; "others" (a laptop/mug in front of you) only in the
    // lower part of the frame — up top it picked up bits of the room.
    const bgc = ms[0].getAsFloat32Array(), oth = ms[5].getAsFloat32Array(), low = Math.round(M * 0.55) * M
    const first = !prev
    if (first) prev = new Float32Array(M * M)
    alpha = new Uint8ClampedArray(M * M)
    for (let i = 0; i < M * M; i++) {
      const p = Math.min(1, Math.max(0, 1 - bgc[i] - (i < low ? oth[i] : 0)))
      // Steady the edge on small wobble, follow at once on real movement.
      const s = first ? p : prev[i] + (p - prev[i]) * (Math.abs(p - prev[i]) > 0.25 ? 1 : 0.6)
      prev[i] = s
      alpha[i] = 255 * smooth(0.42, 0.78, s)
    }
  })
  bitmap.close()
  if (alpha) postMessage({ type: 'mask', alpha }, [alpha.buffer]); else postMessage({ type: 'skip' })
}

self.onmessage = (e) => {
  const m = e.data
  if (m.type === 'init') init().catch((err) => postMessage({ type: 'error', error: String(err) }))
  else if (m.type === 'frame') { try { frame(m.bitmap, m.ts) } catch (err) { postMessage({ type: 'skip', error: String(err) }) } }
  else if (m.type === 'close') { try { seg?.close() } catch { /* fine */ } seg = null; close() }
}
})()
