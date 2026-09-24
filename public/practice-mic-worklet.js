// Sales Training Customer: hands raw mic samples to the page (src/pages/SalesPractice.jsx),
// which packs them as 16 kHz 16-bit PCM for Gemini Live. Runs in an AudioContext
// created at 16000 Hz, so the browser has already resampled the mic.
class MicTap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch && ch.length) this.port.postMessage(ch.slice(0))
    return true
  }
}
registerProcessor('mic-tap', MicTap)
