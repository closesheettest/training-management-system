// HD MEETING BACKGROUND (Neal, 2026-10-06: "I can be on a Zoom and it looks much better than it does on
// this"). Same job as smartBackground.js, three fixes for what made ours look worse than Zoom:
//   1. WIDE MODEL — Google's landscape selfie model on a 256×144 frame (public/bg-worker2.js). The old one
//      squashed the 16:9 camera into a 256×256 square, so the outline came back stretched and loose.
//   2. EDGE SNAPPED TO THE REAL PICTURE — the small mask is enlarged on the graphics chip with a
//      "joint bilateral" filter: each pixel only borrows the mask from neighbours that LOOK like it in the
//      full-size camera image, so the edge lands on your actual hairline / shoulder instead of being a
//      stretched, blurry halo. This is the step Zoom / Meet do and we didn't.
//   3. REAL BLUR, WITHOUT YOU IN IT — the room is blurred with a proper gaussian, and you're cut out of it
//      first, so your colours don't smear into the background around you.
// Everything runs on the GPU (WebGL2); the person-finder runs in a worker so the camera never waits.
// LiveKit track-processor interface (name / init / restart / destroy / processedTrack), like the old one.

const MODEL_SIZE = { landscape: [256, 144], multiclass: [256, 256] }

const VS = `#version 300 es
in vec2 p; out vec2 uv; uniform float flip;
void main(){ uv = vec2(p.x * 0.5 + 0.5, flip > 0.5 ? 0.5 - p.y * 0.5 : p.y * 0.5 + 0.5); gl_Position = vec4(p, 0.0, 1.0); }`

// Room without the person (premultiplied by "how much background"), at quarter size.
const FS_DOWN = `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform sampler2D cam, mask;
void main(){ float m = smoothstep(0.25, 0.65, texture(mask, uv).r); float b = 1.0 - m; o = vec4(texture(cam, uv).rgb * b, b); }`

// Separable gaussian (9 taps).
const FS_BLUR = `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform sampler2D src; uniform vec2 dir;
void main(){
  float w[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  vec4 s = texture(src, uv) * w[0];
  for (int i = 1; i < 5; i++) { s += texture(src, uv + dir * float(i)) * w[i]; s += texture(src, uv - dir * float(i)) * w[i]; }
  o = s;
}`

// Edge refinement + composite.
const FS_FINAL = `#version 300 es
precision highp float; in vec2 uv; out vec4 o;
uniform sampler2D cam, mask, bg; uniform vec2 mt; uniform int mode; uniform vec2 bgScale, bgOff; uniform float lo, hi, sr;
void main(){
  vec3 c = texture(cam, uv).rgb;
  float ws = 0.0, acc = 0.0;
  for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
    vec2 q = uv + vec2(float(x), float(y)) * mt;
    vec3 d = c - texture(cam, q).rgb;
    float w = exp(-float(x * x + y * y) / 4.5) * exp(-dot(d, d) / (2.0 * sr * sr));
    ws += w; acc += w * texture(mask, q).r;
  }
  float a = smoothstep(lo, hi, acc / max(ws, 1e-4));
  vec3 b;
  if (mode == 0) { vec4 bl = texture(bg, uv); b = bl.a > 0.02 ? bl.rgb / bl.a : c; }
  else b = texture(bg, uv * bgScale + bgOff).rgb;
  o = vec4(mix(b, c, a), 1.0);
}`

export const smartBackgroundHDSupported = () => {
  try { return typeof window !== 'undefined' && !!document.createElement('canvas').getContext('webgl2') && typeof createImageBitmap === 'function' && typeof Worker !== 'undefined' } catch { return false }
}

const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = src })

export class SmartBackgroundHD {
  name = 'smart-background-hd'
  // opts: { mode: 'blur' } | { mode: 'image', imagePath } ; model: 'landscape' (default) | 'multiclass'
  constructor(opts, model = 'landscape') { this.opts = opts; this.model = MODEL_SIZE[model] ? model : 'landscape'; this.bgImg = null; this.ready = false; this.busy = false; this.haveMask = false }

  async setOptions(opts) {
    this.opts = opts
    this.bgImg = opts.mode === 'image' && opts.imagePath ? await loadImg(opts.imagePath).catch(() => null) : null
    this.bgDirty = true
  }

  startWorker() {
    if (this.worker) return
    this.worker = new Worker('/bg-worker2.js')
    this.worker.onmessage = (e) => {
      const m = e.data
      if (m.type === 'ready') { this.ready = true; return }
      if (m.type === 'mask') this.uploadMask(m.alpha, m.w, m.h)
      this.busy = false
    }
    this.worker.postMessage({ type: 'init', model: this.model })
  }

  setupGL() {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false })
    if (!gl) throw new Error('no webgl2')
    this.canvas = canvas; this.gl = gl
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s }
    const prog = (fs) => {
      const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs))
      gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p)
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p))
      const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS)
      for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name] = gl.getUniformLocation(p, a.name) }
      return { p, u }
    }
    this.P = { down: prog(FS_DOWN), blur: prog(FS_BLUR), fin: prog(FS_FINAL) }
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    const tex = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v); return t }
    this.tex = tex
    this.tCam = tex(); this.tMask = tex(); this.tBg = tex()
    gl.bindTexture(gl.TEXTURE_2D, this.tMask)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]))
    this.maskW = 1; this.maskH = 1
    this.fbo = []; this.small = [0, 0]
  }

  uploadMask(alpha, w, h) {
    const gl = this.gl; if (!gl) return
    gl.bindTexture(gl.TEXTURE_2D, this.tMask)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, alpha)
    this.maskW = w; this.maskH = h; this.haveMask = true
  }

  ensureSmall(w, h) {
    const sw = Math.max(16, Math.round(w / 4)), sh = Math.max(9, Math.round(h / 4))
    if (this.small[0] === sw && this.small[1] === sh) return
    const gl = this.gl
    for (const f of this.fbo) { gl.deleteFramebuffer(f.fb); gl.deleteTexture(f.t) }
    this.fbo = [0, 1].map(() => {
      const t = this.tex(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, sw, sh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0)
      return { t, fb }
    })
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.small = [sw, sh]
  }

  async init({ track }) {
    await this.setOptions(this.opts)
    this.setupGL()
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
            ctl.enqueue(new VideoFrame(this.canvas, { timestamp: frame.timestamp }))
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
      this.processedTrack = this.canvas.captureStream(30).getVideoTracks()[0]
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
    try { this.gl?.getExtension('WEBGL_lose_context')?.loseContext() } catch { /* fine */ }
    this.gl = null
  }

  draw(src, w, h) {
    const gl = this.gl
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h }
    // Hand the worker the newest frame whenever it's free, at the model's own 16:9 size.
    if (this.ready && !this.busy) {
      this.busy = true
      const [mw, mh] = MODEL_SIZE[this.model]
      createImageBitmap(src, { resizeWidth: mw, resizeHeight: mh, resizeQuality: 'medium' })
        .then((bitmap) => { if (this.worker) this.worker.postMessage({ type: 'frame', bitmap, ts: performance.now() }, [bitmap]); else { bitmap.close(); this.busy = false } })
        .catch(() => { this.busy = false })
    }
    gl.bindTexture(gl.TEXTURE_2D, this.tCam)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)
    const mode = this.opts.mode === 'image' && this.bgImg ? 1 : this.opts.mode === 'blur' ? 0 : 2
    const bind = (unit, t) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t) }
    const pass = (P, fb, vw, vh, flip) => { gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.viewport(0, 0, vw, vh); gl.useProgram(P.p); gl.uniform1f(P.u.flip, flip ? 1 : 0) }

    if (mode === 2 || !this.haveMask) {
      // No background chosen yet / no mask yet: the camera as it is.
      const P = this.P.fin; pass(P, null, w, h, true)
      bind(0, this.tCam); bind(1, this.tMask); bind(2, this.tCam)
      gl.uniform1i(P.u.cam, 0); gl.uniform1i(P.u.mask, 1); gl.uniform1i(P.u.bg, 2); gl.uniform1i(P.u.mode, 1)
      gl.uniform2f(P.u.mt, 0, 0); gl.uniform2f(P.u.bgScale, 1, 1); gl.uniform2f(P.u.bgOff, 0, 0)
      gl.uniform1f(P.u.lo, -1); gl.uniform1f(P.u.hi, 0); gl.uniform1f(P.u.sr, 1)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      return
    }

    let bgTex = this.tBg, sx = 1, sy = 1
    if (mode === 0) {
      // Blurred room with the person taken out: quarter size, two rounds of gaussian.
      this.ensureSmall(w, h)
      const [sw, sh] = this.small, [A, B] = this.fbo
      let P = this.P.down; pass(P, A.fb, sw, sh, false)
      bind(0, this.tCam); bind(1, this.tMask); gl.uniform1i(P.u.cam, 0); gl.uniform1i(P.u.mask, 1)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      P = this.P.blur
      for (let k = 0; k < 2; k++) {
        pass(P, B.fb, sw, sh, false); bind(0, A.t); gl.uniform1i(P.u.src, 0); gl.uniform2f(P.u.dir, 1.6 / sw, 0); gl.drawArrays(gl.TRIANGLES, 0, 3)
        pass(P, A.fb, sw, sh, false); bind(0, B.t); gl.uniform1i(P.u.src, 0); gl.uniform2f(P.u.dir, 0, 1.6 / sh); gl.drawArrays(gl.TRIANGLES, 0, 3)
      }
      bgTex = A.t
    } else {
      if (this.bgDirty && this.bgImg) { gl.bindTexture(gl.TEXTURE_2D, this.tBg); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.bgImg); this.bgDirty = false }
      // Cover the frame (crop, never stretch).
      const out = w / h, pic = this.bgImg.width / this.bgImg.height
      if (out > pic) sy = pic / out; else sx = out / pic
    }
    const P = this.P.fin; pass(P, null, w, h, true)
    bind(0, this.tCam); bind(1, this.tMask); bind(2, bgTex)
    gl.uniform1i(P.u.cam, 0); gl.uniform1i(P.u.mask, 1); gl.uniform1i(P.u.bg, 2); gl.uniform1i(P.u.mode, mode)
    gl.uniform2f(P.u.mt, 1 / this.maskW, 1 / this.maskH)
    gl.uniform2f(P.u.bgScale, sx, sy); gl.uniform2f(P.u.bgOff, 0.5 - 0.5 * sx, 0.5 - 0.5 * sy)
    gl.uniform1f(P.u.lo, 0.38); gl.uniform1f(P.u.hi, 0.72); gl.uniform1f(P.u.sr, 0.1)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
}
