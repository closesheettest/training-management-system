// bible.js — scripture text for the 📖 Scripture slide (Neal, 2026-10-04: NIV by default, and
// it should fill in by itself, not be pasted).
//   GET ?ref=Psalm 23:1-6&v=NIV → { ok, ref, verses:[{ n, text }], version }
// Sources, all free for the non-commercial 9:15 Devotional:
//   NIV / NLT / NKJV (+ others picked on the plan) → API.Bible Starter plan  (BIBLE_API_KEY)
//   ESV → Crossway's own ESV API                                             (ESV_API_KEY)
//   KJV / WEB / ASV → bible-api.com (public domain), also used in the browser.
// The slide shows each translation's copyright line (required by both providers).
const json = (code, b) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(b) })
let bibleIds = null // abbreviation → API.Bible id, looked up once per warm function

const clean = (t) => String(t || '').replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim()
// "[1] The LORD … [2] He makes …" → verses
const splitBracketed = (txt) => {
  const parts = String(txt || '').split(/\[(\d{1,3})\]/)
  const out = []
  // Text before the first verse number is a heading ("Psalm 23", "A psalm of David") — only keep
  // it when there are no numbered verses at all.
  if (clean(parts[0]) && parts.length < 3) out.push({ n: null, text: clean(parts[0]) })
  for (let i = 1; i < parts.length; i += 2) { const t = clean(parts[i + 1]); if (t) out.push({ n: Number(parts[i]), text: t }) }
  return out
}

export const handler = async (event) => {
  const q = event.queryStringParameters || {}
  const ref = String(q.ref || '').trim().slice(0, 60), v = String(q.v || 'NIV').toUpperCase()
  // ?list=1 → which Bibles our key can see (names only), for setup.
  if (q.list) {
    const key = (process.env.BIBLE_API_KEY || '').trim()
    const r = await fetch('https://rest.api.bible/v1/bibles', { headers: { 'api-key': key } })
    const j = await r.json().catch(() => ({}))
    return json(200, { ok: r.ok, status: r.status, key_len: key.length, message: j.message || j.error || null, bibles: (j.data || []).map((b) => `${b.abbreviationLocal || b.abbreviation} — ${b.nameLocal || b.name}`) })
  }
  if (!ref) return json(400, { ok: false, error: 'Type the passage, e.g. Psalm 23:1-6' })
  try {
    if (v === 'ESV') {
      const key = (process.env.ESV_API_KEY || '').trim()
      if (!key) return json(200, { ok: false, error: 'ESV isn\'t connected yet — paste the verses for now.' })
      const r = await fetch(`https://api.esv.org/v3/passage/text/?q=${encodeURIComponent(ref)}&include-headings=false&include-footnotes=false&include-short-copyright=false&include-passage-references=false&include-verse-numbers=true`, { headers: { Authorization: `Token ${key}` } })
      const j = await r.json()
      if (!j.passages?.length || !String(j.passages[0]).trim()) return json(200, { ok: false, error: "Couldn't find that passage. Try like: Psalm 23:1-6" })
      return json(200, { ok: true, ref: j.canonical || ref, version: 'ESV', verses: splitBracketed(j.passages.join(' ')) })
    }
    const key = (process.env.BIBLE_API_KEY || '').trim()
    if (!key) return json(200, { ok: false, error: `${v} isn't connected yet — paste the verses for now.` })
    const H = { 'api-key': key }
    if (!bibleIds) {
      const j = await (await fetch('https://rest.api.bible/v1/bibles?language=eng', { headers: H })).json()
      bibleIds = {}
      for (const b of j.data || []) {
        const ab = String(b.abbreviationLocal || b.abbreviation || '').toUpperCase().replace(/\d+$/, '')
        if (ab && !bibleIds[ab]) bibleIds[ab] = b.id
      }
    }
    const id = bibleIds[v]
    if (!id) return json(200, { ok: false, error: `${v} isn't on our plan — pick it on API.Bible, or paste the verses.` })
    // The search endpoint understands a reference like "Psalm 23:1-6" and returns the passage.
    const s = await (await fetch(`https://rest.api.bible/v1/bibles/${id}/search?query=${encodeURIComponent(ref)}`, { headers: H })).json()
    const pass = s.data?.passages?.[0]
    if (!pass) return json(200, { ok: false, error: "Couldn't find that passage. Try like: Psalm 23:1-6" })
    const p = await (await fetch(`https://rest.api.bible/v1/bibles/${id}/passages/${encodeURIComponent(pass.id)}?content-type=text&include-notes=false&include-titles=false&include-chapter-numbers=false&include-verse-numbers=true&include-verse-spans=false`, { headers: H })).json()
    const verses = splitBracketed(p.data?.content || pass.content)
    if (!verses.length) return json(200, { ok: false, error: "Couldn't read that passage." })
    return json(200, { ok: true, ref: p.data?.reference || pass.reference || ref, version: v, verses })
  } catch (e) {
    return json(200, { ok: false, error: `Lookup failed: ${e.message}` })
  }
}
