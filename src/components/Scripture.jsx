// 📖 SCRIPTURE ON SCREEN (Neal, 2026-10-04 — the 9:15 Devotional): the host types the passage,
// shares it, and everyone (and the recording) sees a full-screen scripture slide in the room's
// look with the host's camera as a circle. Verse by verse with ◀ ▶, or the whole passage.
//
// Translations: KJV / WEB / ASV are public domain and fill in automatically (bible-api.com).
// NIV (the default), ESV, NLT and NKJV are copyrighted — no free source supplies them, so the
// host pastes the verses from their Bible app, and the slide carries that translation's
// required copyright line.
import { VideoTrack } from '@livekit/components-react'

export const VERSIONS = [
  { key: 'NIV', label: 'NIV', auto: false, credit: 'Scripture quotations taken from The Holy Bible, New International Version® NIV®. Copyright © 1973, 1978, 1984, 2011 by Biblica, Inc.™ Used by permission. All rights reserved worldwide.' },
  { key: 'ESV', label: 'ESV', auto: false, credit: 'Scripture quotations are from the ESV® Bible (The Holy Bible, English Standard Version®), © 2001 by Crossway. Used by permission. All rights reserved.' },
  { key: 'NLT', label: 'NLT', auto: false, credit: 'Scripture quotations are taken from the Holy Bible, New Living Translation, copyright © 1996, 2004, 2015 by Tyndale House Foundation. Used by permission. All rights reserved.' },
  { key: 'NKJV', label: 'NKJV', auto: false, credit: 'Scripture taken from the New King James Version®. Copyright © 1982 by Thomas Nelson. Used by permission. All rights reserved.' },
  { key: 'KJV', label: 'KJV (fills in itself)', auto: 'kjv', credit: '' },
  { key: 'WEB', label: 'WEB (fills in itself)', auto: 'web', credit: '' },
  { key: 'ASV', label: 'ASV (fills in itself)', auto: 'asv', credit: '' },
]
export const versionOf = (k) => VERSIONS.find((v) => v.key === k) || VERSIONS[0]

// Free translations: look the passage up. → [{ n, text }] and the tidy reference.
export async function fetchPassage(ref, version) {
  const v = versionOf(version)
  if (!v.auto) throw new Error('Paste the verses for this translation.')
  const r = await fetch(`https://bible-api.com/${encodeURIComponent(ref.trim())}?translation=${v.auto}`)
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.verses?.length) throw new Error(j.error || "Couldn't find that passage. Try like: Psalm 23:1-6")
  return { ref: j.reference, verses: j.verses.map((x) => ({ n: x.verse, text: String(x.text).replace(/\s+/g, ' ').trim() })) }
}

// Pasted text → verses. Understands "1 The LORD is…", superscript ¹, and one-verse-per-line.
export function splitPasted(text) {
  const t = String(text || '').replace(/[¹²³⁰-⁹]+/g, (m) => ` ${[...m].map((c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(c) >= 0 ? '⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(c) : ({ '¹': 1, '²': 2, '³': 3 })[c]).join('')} `).replace(/\s+/g, ' ').trim()
  if (!t) return []
  const parts = t.split(/(?:^|\s)(\d{1,3})\s+(?=["“‘'(\[A-Za-z])/)
  const out = []
  if (parts.length > 2) {
    if (parts[0].trim()) out.push({ n: null, text: parts[0].trim() })
    for (let i = 1; i < parts.length; i += 2) out.push({ n: Number(parts[i]), text: (parts[i + 1] || '').trim() })
    return out.filter((x) => x.text)
  }
  const lines = String(text).split(/\n+/).map((x) => x.trim()).filter(Boolean)
  return lines.length > 1 ? lines.map((x) => ({ n: null, text: x })) : [{ n: null, text: t }]
}

// The slide itself — used in the meeting AND by the recorder, so the video matches the screen.
export function ScriptureSlide({ sc, look: L, camTrack }) {
  const v = versionOf(sc.version)
  const all = sc.mode === 'all'
  const shown = all ? sc.verses : [sc.verses[Math.min(sc.idx || 0, sc.verses.length - 1)]].filter(Boolean)
  const long = shown.reduce((t, x) => t + x.text.length, 0)
  const size = all ? (long > 900 ? 'clamp(16px, 2.1vw, 26px)' : long > 450 ? 'clamp(18px, 2.6vw, 32px)' : 'clamp(22px, 3.2vw, 40px)') : (long > 260 ? 'clamp(24px, 3.4vw, 44px)' : 'clamp(28px, 4.4vw, 58px)')
  return (
    <div style={{ position: 'relative', height: '100%', width: '100%', background: L.light ? L.bg : '#0b1220', color: L.light ? '#1f2937' : '#f8fafc', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '4% 22% 6% 7%', boxSizing: 'border-box', overflow: 'hidden' }}>
      <div style={{ color: L.accent || '#fbbf24', fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', fontSize: 'clamp(13px, 1.5vw, 20px)', marginBottom: '2.5%' }}>
        {sc.ref}{!all && sc.verses.length > 1 ? ` · verse ${shown[0]?.n ?? (sc.idx || 0) + 1}` : ''} · {v.key}
      </div>
      <div style={{ fontFamily: L.fontHead && L.fontHead !== 'inherit' ? L.fontHead : "'Cormorant Garamond', Georgia, serif", fontSize: size, lineHeight: 1.35, fontWeight: 500, color: L.light ? L.head : '#fff' }}>
        {shown.map((x, i) => (
          <span key={i}>{x.n != null && (all || sc.verses.length > 1) ? <sup style={{ fontSize: '.5em', color: L.accent || '#fbbf24', marginRight: 4, fontWeight: 700 }}>{x.n}</sup> : null}{x.text}{' '}</span>
        ))}
      </div>
      {v.credit && <div style={{ position: 'absolute', left: '7%', right: '30%', bottom: '2.5%', fontSize: 'clamp(8px, .8vw, 11px)', color: L.light ? '#6b7280' : '#94a3b8', lineHeight: 1.3 }}>{v.credit}</div>}
      {camTrack && (
        <div style={{ position: 'absolute', right: '3%', bottom: '5%', width: 'min(24%, 260px)', aspectRatio: '1 / 1', borderRadius: '50%', overflow: 'hidden', border: `4px solid ${L.accent || 'rgba(255,255,255,.85)'}`, boxShadow: '0 8px 24px rgba(0,0,0,.35)', background: '#000' }}>
          <VideoTrack trackRef={camTrack} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      )}
    </div>
  )
}
