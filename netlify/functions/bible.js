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

// Book name → the code API.Bible uses (USFM), any common spelling (Neal, 2026-10-04: "philippians
// 4:6-9" wasn't found — their search endpoint misses plain references, so we build the passage id).
const BOOKS = {}
'GEN Genesis Gen Ge Gn|EXO Exodus Exod Ex|LEV Leviticus Lev Lv|NUM Numbers Num Nm|DEU Deuteronomy Deut Dt|JOS Joshua Josh|JDG Judges Judg Jdg|RUT Ruth Ru|1SA 1Samuel 1Sam 1Sa|2SA 2Samuel 2Sam 2Sa|1KI 1Kings 1Kgs 1Ki|2KI 2Kings 2Kgs 2Ki|1CH 1Chronicles 1Chr 1Ch|2CH 2Chronicles 2Chr 2Ch|EZR Ezra Ezr|NEH Nehemiah Neh|EST Esther Esth Est|JOB Job Jb|PSA Psalms Psalm Ps Psa Pss|PRO Proverbs Prov Pr Prv|ECC Ecclesiastes Eccl Ecc Qoh|SNG SongofSolomon SongofSongs Song Sos Canticles|ISA Isaiah Isa Is|JER Jeremiah Jer Je|LAM Lamentations Lam La|EZK Ezekiel Ezek Eze Ezk|DAN Daniel Dan Dn|HOS Hosea Hos Ho|JOL Joel Jl|AMO Amos Am|OBA Obadiah Obad Ob|JON Jonah Jon Jnh|MIC Micah Mic Mi|NAM Nahum Nah Na|HAB Habakkuk Hab|ZEP Zephaniah Zeph Zep|HAG Haggai Hag Hg|ZEC Zechariah Zech Zec|MAL Malachi Mal Ml|MAT Matthew Matt Mt|MRK Mark Mk Mrk|LUK Luke Lk Luk|JHN John Jn Jhn|ACT Acts Ac|ROM Romans Rom Ro Rm|1CO 1Corinthians 1Cor 1Co|2CO 2Corinthians 2Cor 2Co|GAL Galatians Gal Ga|EPH Ephesians Eph|PHP Philippians Phil Php Pp|COL Colossians Col|1TH 1Thessalonians 1Thess 1Th|2TH 2Thessalonians 2Thess 2Th|1TI 1Timothy 1Tim 1Ti|2TI 2Timothy 2Tim 2Ti|TIT Titus Tit|PHM Philemon Phlm Phm|HEB Hebrews Heb|JAS James Jas Jm|1PE 1Peter 1Pet 1Pe 1Pt|2PE 2Peter 2Pet 2Pe 2Pt|1JN 1John 1Jn 1Jo|2JN 2John 2Jn 2Jo|3JN 3John 3Jn 3Jo|JUD Jude Jud|REV Revelation Revelations Rev Re Rv'.split('|').forEach((row) => { const [code, ...names] = row.split(' '); for (const n of names) BOOKS[n.toLowerCase()] = code })
// "philippians 4:6-9", "1 John 1:9", "Ps 23", "John 3:16-4:2" → "PHP.4.6-PHP.4.9"
function passageId(ref) {
  const m = String(ref).trim().match(/^((?:[123]|i{1,3})\s*)?([a-z ]+?)\.?\s+(\d+)(?::(\d+))?(?:\s*[-–]\s*(?:(\d+):)?(\d+))?$/i)
  if (!m) return null
  const num = (m[1] || '').trim().toLowerCase().replace(/^iii$/, '3').replace(/^ii$/, '2').replace(/^i$/, '1')
  const code = BOOKS[(num + m[2]).toLowerCase().replace(/\s+/g, '')]
  if (!code) return null
  const ch = m[3], v1 = m[4], ch2 = m[5] || ch, v2 = m[6]
  if (!v1) return `${code}.${ch}` // whole chapter
  return v2 ? `${code}.${ch}.${v1}-${code}.${ch2}.${v2}` : `${code}.${ch}.${v1}`
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
    // Just a book name ("philippians") → ask for the chapter instead of a dead end.
    const bookOnly = ref.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^iii/, '3').replace(/^ii/, '2')
    if (BOOKS[bookOnly]) { const nice = ref.trim().replace(/\b\w/g, (c) => c.toUpperCase()); return json(200, { ok: false, error: `Add the chapter and verses, like ${nice} 4:6-9 (or just ${nice} 4 for the whole chapter).` }) }
    // Build the passage id ourselves; only if we can't read the reference, ask their search.
    let pass = { id: passageId(ref) }
    if (!pass.id) {
      const s = await (await fetch(`https://rest.api.bible/v1/bibles/${id}/search?query=${encodeURIComponent(ref)}`, { headers: H })).json()
      pass = s.data?.passages?.[0]
      if (!pass) return json(200, { ok: false, error: "Couldn't find that passage. Try like: Psalm 23:1-6" })
    }
    const p = await (await fetch(`https://rest.api.bible/v1/bibles/${id}/passages/${encodeURIComponent(pass.id)}?content-type=text&include-notes=false&include-titles=false&include-chapter-numbers=false&include-verse-numbers=true&include-verse-spans=false`, { headers: H })).json()
    const verses = splitBracketed(p.data?.content || pass.content || '')
    if (!verses.length) return json(200, { ok: false, error: "Couldn't find that passage. Check the book, chapter and verses (like Philippians 4:6-9)." })
    return json(200, { ok: true, ref: p.data?.reference || pass.reference || ref, version: v, verses })
  } catch (e) {
    return json(200, { ok: false, error: `Lookup failed: ${e.message}` })
  }
}
