// A live voice conversation with Gemini, straight from the browser, for the
// Sales Training Customer page. The mic goes up as 16 kHz PCM; the homeowner's
// voice comes back as 24 kHz PCM and is played in order. Both sides also come
// back as text (transcription), which is what gets graded.
//
// Auth is a one-use token from /.netlify/functions/practice-token, so the real
// API key never reaches the browser. Google recycles a Live connection every
// ~10 minutes (it sends goAway first); we reconnect with a fresh token and the
// resumption handle, so a 60-minute presentation carries on as one conversation.
//
// Close-hold: the script says that after asking for the business the rep must
// not speak again until the homeowner does. The model answers the instant the rep
// pauses, so we hold the homeowner's first reply for CLOSE_HOLD_MS after an ask
// and measure whether the rep broke the silence first.

const WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained'
const CLOSE_HOLD_MS = 5000
const VOICE_RMS = 0.02 // mic level that counts as the rep talking

function toBase64(int16) {
  const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
function fromBase64Pcm(b64) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const i16 = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2))
  const f32 = new Float32Array(i16.length)
  for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768
  return f32
}

// The first message of a Live session. Shared with the server-side smoke test
// (practice-token { check:'live' }) so what we test is what the page sends.
export function liveSetup({ model, systemPrompt, voice, handle }) {
  return {
    setup: {
      model: `models/${model}`,
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
      systemInstruction: { parts: [{ text: systemPrompt }] },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      contextWindowCompression: { slidingWindow: {} },
      sessionResumption: handle ? { handle } : {},
    },
  }
}

export const LIVE_WS_URL = WS_URL

export class LiveHomeowner {
  // getToken: async () => ({ token, model })
  // on: { status(s), transcript(entries), level(0..1), error(msg), closeSilence({held,seconds}) }
  constructor({ getToken, systemPrompt, voice, on }) {
    this.getToken = getToken
    this.systemPrompt = systemPrompt
    this.voice = voice
    this.on = on || {}
    this.entries = []           // [{who, text, at}]
    this.handle = null
    this.closedByUser = false
    this.playing = new Set()
    this.nextPlay = 0
    this.pcmBuf = []
    this.pcmLen = 0
    this.lastVoiceAt = 0
    this.armedClose = false      // rep just asked for the decision
    this.holding = null          // { askEndAt, chunks:[] } while holding the reply
    this.closeSilence = null
  }

  async start() {
    this.startedAt = new Date()
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    })
    this.inCtx = new AudioContext({ sampleRate: 16000 })
    this.outCtx = new AudioContext({ sampleRate: 24000 })
    await this.inCtx.audioWorklet.addModule('/practice-mic-worklet.js')
    const src = this.inCtx.createMediaStreamSource(this.stream)
    this.tap = new AudioWorkletNode(this.inCtx, 'mic-tap')
    this.tap.port.onmessage = (e) => this.onMic(e.data)
    src.connect(this.tap)
    await this.connect()
  }

  async connect() {
    this.status('connecting')
    const { token, model } = await this.getToken()
    const ws = new WebSocket(`${WS_URL}?access_token=${encodeURIComponent(token)}`)
    this.ws = ws
    ws.onopen = () => {
      ws.send(JSON.stringify(liveSetup({ model, systemPrompt: this.systemPrompt, voice: this.voice, handle: this.handle })))
    }
    ws.onmessage = async (ev) => {
      const raw = typeof ev.data === 'string' ? ev.data : await ev.data.text()
      let m
      try { m = JSON.parse(raw) } catch { return }
      this.onServer(m)
    }
    ws.onerror = () => {}
    ws.onclose = (ev) => {
      if (this.ws !== ws) return
      this.ready = false
      if (this.closedByUser) return
      // Recycled connection (goAway) or a drop: carry on from the handle.
      if (this.reconnects > 6) { this.fail(`Lost the connection (${ev.code} ${ev.reason || ''}).`); return }
      this.reconnects = (this.reconnects || 0) + 1
      if (!this.handle && !this.everReady) { this.fail(`Could not start the homeowner: ${ev.reason || ev.code}`); return }
      this.connect().catch((e) => this.fail(e.message))
    }
  }

  onServer(m) {
    if (m.setupComplete) {
      const first = !this.everReady
      this.ready = true; this.everReady = true
      this.status('listening')
      // A slide put up before the connection was ready (the opening slide).
      if (first && this.pendingSlide) { this.sendSlide(this.pendingSlide); this.pendingSlide = null }
      return
    }
    if (m.sessionResumptionUpdate?.resumable && m.sessionResumptionUpdate.newHandle) this.handle = m.sessionResumptionUpdate.newHandle
    if (m.goAway) { try { this.ws.close() } catch { /* reconnect in onclose */ } return }
    const sc = m.serverContent
    if (!sc) return
    if (sc.interrupted) this.stopPlayback()
    if (sc.inputTranscription?.text) this.addText('rep', sc.inputTranscription.text)
    if (sc.outputTranscription?.text) this.addText('homeowner', sc.outputTranscription.text)
    for (const p of sc.modelTurn?.parts || []) {
      if (p.inlineData?.data) this.onAudio(p.inlineData.data)
    }
    if (sc.turnComplete && !this.holding) this.status('listening')
  }

  addText(who, text) {
    const last = this.entries[this.entries.length - 1]
    if (last && last.who === who) last.text += text
    else this.entries.push({ who, text: text.replace(/^\s+/, ''), at: new Date().toISOString() })
    // The ask: "So which would you prefer, just the roof ... or everything ...?"
    if (who === 'rep' && this.closeZone && !this.closeSilence) {
      const cur = this.entries[this.entries.length - 1].text
      if (/which (would you|do you) prefer|would you prefer|which one would you|which option/i.test(cur)) this.armedClose = true
    }
    this.on.transcript?.([...this.entries])
  }

  // The slide on the rep's screen changed: tell the homeowner silently, and log it.
  showSlide(label, seen, inCloseZone) {
    this.closeZone = !!inCloseZone
    this.entries.push({ who: 'slide', text: label, at: new Date().toISOString() })
    this.on.transcript?.([...this.entries])
    if (this.ready) this.sendSlide(seen)
    else this.pendingSlide = seen
  }

  sendSlide(seen) {
    this.ws.send(JSON.stringify({
      clientContent: { turns: [{ role: 'user', parts: [{ text: `[Slide now showing: ${seen}] (stage info only: do not respond to this)` }] }], turnComplete: false },
    }))
  }

  onMic(f32) {
    let sum = 0
    for (let i = 0; i < f32.length; i++) sum += f32[i] * f32[i]
    const rms = Math.sqrt(sum / f32.length)
    this.on.level?.(Math.min(1, rms * 8))
    const now = performance.now()
    if (rms > VOICE_RMS) {
      this.lastVoiceAt = now
      // Rep broke the silence while we were holding the homeowner's answer.
      if (this.holding && now - this.holding.askEndAt > 400) {
        this.recordClose(false, (now - this.holding.askEndAt) / 1000)
        this.holding = null // the model will be interrupted by the rep's speech; drop the held reply
      }
    }
    this.pcmBuf.push(f32); this.pcmLen += f32.length
    if (this.pcmLen < 1600) return // ~100 ms per message
    const out = new Int16Array(this.pcmLen)
    let o = 0
    for (const chunk of this.pcmBuf) for (let i = 0; i < chunk.length; i++) out[o++] = Math.max(-1, Math.min(1, chunk[i])) * 0x7fff
    this.pcmBuf = []; this.pcmLen = 0
    if (this.ready && this.ws?.readyState === 1 && !this.muted) {
      this.ws.send(JSON.stringify({ realtimeInput: { audio: { data: toBase64(out), mimeType: 'audio/pcm;rate=16000' } } }))
    }
  }

  onAudio(b64) {
    if (this.armedClose && !this.closeSilence && !this.holding) {
      this.armedClose = false
      this.holding = { askEndAt: this.lastVoiceAt || performance.now(), chunks: [] }
      this.status('silence')
      const h = this.holding
      setTimeout(() => {
        if (this.holding !== h) return
        this.recordClose(true, (performance.now() - h.askEndAt) / 1000)
        this.holding = null
        for (const c of h.chunks) this.play(c)
      }, Math.max(0, CLOSE_HOLD_MS - (performance.now() - h.askEndAt)))
    }
    if (this.holding) { this.holding.chunks.push(b64); return }
    this.play(b64)
  }

  recordClose(held, seconds) {
    this.closeSilence = { held, seconds: Math.round(seconds * 10) / 10 }
    this.on.closeSilence?.(this.closeSilence)
  }

  play(b64) {
    const f32 = fromBase64Pcm(b64)
    if (!f32.length) return
    const buf = this.outCtx.createBuffer(1, f32.length, 24000)
    buf.copyToChannel(f32, 0)
    const node = this.outCtx.createBufferSource()
    node.buffer = buf
    node.connect(this.outCtx.destination)
    const at = Math.max(this.outCtx.currentTime + 0.02, this.nextPlay)
    node.start(at)
    this.nextPlay = at + buf.duration
    this.playing.add(node)
    this.status('speaking')
    node.onended = () => { this.playing.delete(node); if (!this.playing.size) this.status('listening') }
  }

  stopPlayback() {
    for (const n of this.playing) { try { n.stop() } catch { /* already done */ } }
    this.playing.clear()
    this.nextPlay = 0
    if (this.holding) this.holding.chunks = []
  }

  setMuted(v) { this.muted = !!v }

  status(s) { if (s !== this._s) { this._s = s; this.on.status?.(s) } }
  fail(msg) { this.status('error'); this.on.error?.(msg); this.stop() }

  stop() {
    this.closedByUser = true
    try { this.ws?.close() } catch { /* ignore */ }
    this.stopPlayback()
    try { this.tap?.disconnect() } catch { /* ignore */ }
    for (const t of this.stream?.getTracks() || []) t.stop()
    try { this.inCtx?.close() } catch { /* ignore */ }
    try { this.outCtx?.close() } catch { /* ignore */ }
    return { entries: this.entries.filter((e) => e.text && e.text.trim()), startedAt: this.startedAt, endedAt: new Date(), closeSilence: this.closeSilence }
  }
}
