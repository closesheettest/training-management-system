// Returns a .vcf (vCard) file containing the trainee's handoff contacts —
// sales manager, helpline, etc. Tapping the link in a text on iPhone/Android
// opens the native "Add to Contacts" sheet. One file can hold multiple
// VCARD blocks; phones import them all in one confirmation.
//
// Public — no auth. The URL is shared via SMS to the trainee right after
// they submit their final test. URL contains the trainee_id so we can
// route region-specific contacts (e.g. the St Pete Sales Manager for a
// St Pete class).
//
// Usage:
//   GET /.netlify/functions/trainee-contacts-vcard?trainee_id=<uuid>
//     → looks up the trainee's class.region, returns vCards matching that
//       region PLUS all "universal" (region IS NULL) contacts.
//   GET /.netlify/functions/trainee-contacts-vcard?region=St+Pete
//     → same but region passed explicitly (for previewing).
//   GET /.netlify/functions/trainee-contacts-vcard
//     → all active contacts regardless of region (for previewing).

import { createClient } from '@supabase/supabase-js'

export const handler = async (event) => {
  const missing = []
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY']) {
    if (!process.env[k]) missing.push(k)
  }
  if (missing.length) {
    return text(500, `Missing env vars: ${missing.join(', ')}`)
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const params = event.queryStringParameters || {}

  // Figure out which region (if any) we're serving for.
  let region = params.region || null
  if (!region && params.trainee_id) {
    const { data: trainee } = await supabase
      .from('trainees')
      .select('classes!class_id(region)')
      .eq('id', params.trainee_id)
      .maybeSingle()
    region = trainee?.classes?.region || null
  }

  // Load contacts: every active "universal" (region IS NULL), plus every
  // active contact whose region matches the trainee's class region.
  let q = supabase
    .from('trainee_handoff_contacts')
    .select('display_name, title, organization, phone, email, region, display_order')
    .eq('active', true)
    .order('display_order', { ascending: true })
    .order('display_name', { ascending: true })

  // PostgREST OR: region.is.null OR region.eq.X
  if (region) {
    q = q.or(`region.is.null,region.eq.${escapeOr(region)}`)
  } else if (!params.trainee_id && !params.region) {
    // No filter → return everything (preview mode)
  } else {
    // We were given trainee_id/region but couldn't resolve a region.
    // Fall back to universals only.
    q = q.is('region', null)
  }

  const { data: contacts, error } = await q
  if (error) return text(500, `Supabase: ${error.message}`)

  const list = contacts || []

  // ── vCard download path ──────────────────────────────────────────
  // ?vcf=1 returns the .vcf file (single or all). When iOS hits the
  // landing page and the trainee taps a "Save to Phone" button, the
  // button links here with ?vcf=1&idx=N for a single contact — iOS
  // gets a clean one-contact dialog instead of the multi-contact
  // file where it would only show the first card.
  if (params.vcf === '1' || params.vcf === 'true') {
    const idxRaw = params.idx
    const idx = idxRaw != null ? parseInt(idxRaw, 10) : null
    const slice = (idx != null && !isNaN(idx) && idx >= 0 && idx < list.length) ? [list[idx]] : list
    const vcardBody = slice.map(toVCard).join('\r\n')
    const filename = slice.length === 1
      ? `${(slice[0].display_name || 'contact').replace(/[^a-zA-Z0-9-]/g, '-')}.vcf`
      : 'team-contacts.vcf'
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/vcard; charset=utf-8',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
      body: vcardBody,
    }
  }

  // ── HTML landing page (default) ──────────────────────────────────
  // Trainee sees each contact as its own card with a big tap-target
  // "Save to Phone" button. iOS only shows the first contact in a
  // multi-vcard file, so showing each one as a separate single-vcard
  // link bypasses that limitation entirely.
  const queryBase = new URLSearchParams()
  if (params.trainee_id) queryBase.set('trainee_id', params.trainee_id)
  else if (params.region) queryBase.set('region', params.region)

  const cards = list.map((c, i) => {
    const q = new URLSearchParams(queryBase)
    q.set('vcf', '1')
    q.set('idx', String(i))
    const href = `?${q.toString()}`
    const initial = (c.display_name || '?').trim().charAt(0).toUpperCase()
    return `
      <article class="card">
        <div class="avatar">${esc(initial)}</div>
        <div class="body">
          <div class="name">${esc(c.display_name || '')}</div>
          ${c.title ? `<div class="title">${esc(c.title)}</div>` : ''}
          ${c.organization ? `<div class="org">${esc(c.organization)}</div>` : ''}
          <div class="links">
            ${c.phone ? `<a class="tel" href="tel:${esc(c.phone)}">📞 ${esc(c.phone)}</a>` : ''}
            ${c.email ? `<a class="mail" href="mailto:${esc(c.email)}">✉️ ${esc(c.email)}</a>` : ''}
          </div>
          <a class="save" href="${esc(href)}" download>
            <span>💾</span> Save to phone
          </a>
        </div>
      </article>`
  }).join('\n')

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>Your U.S. Shingle team contacts</title>
<style>
  :root {
    --navy: #13294b;
    --red: #b8324f;
    --bg: #f8fafc;
    --card: #fff;
    --border: #e2e8f0;
    --muted: #64748b;
    --text: #0f172a;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, sans-serif; -webkit-text-size-adjust: 100%; }
  .stripe { height: 4px; background: var(--red); }
  .page { max-width: 540px; margin: 0 auto; padding: 22px 18px 64px; }
  header h1 { margin: 0 0 4px; color: var(--navy); font-size: 22px; }
  header p  { margin: 0 0 18px; color: var(--muted); font-size: 14px; line-height: 1.5; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 16px; margin-bottom: 12px; display: grid; grid-template-columns: 56px 1fr; gap: 14px; }
  .avatar { width: 56px; height: 56px; border-radius: 50%; background: var(--navy); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 22px; }
  .name { font-weight: 700; font-size: 16px; color: var(--navy); }
  .title { font-size: 13px; color: var(--muted); margin-top: 2px; line-height: 1.35; }
  .org { font-size: 12px; color: var(--muted); margin-top: 2px; }
  .links { margin: 8px 0; display: flex; flex-wrap: wrap; gap: 10px; }
  .links a { color: var(--navy); text-decoration: none; font-size: 13px; font-weight: 600; }
  .save { display: inline-flex; align-items: center; gap: 8px; margin-top: 8px; padding: 12px 16px; background: var(--navy); color: #fff !important; text-decoration: none; border-radius: 10px; font-weight: 700; font-size: 15px; }
  .save:active { background: #0a1730; }
  .empty { color: var(--muted); padding: 20px 4px; }
  .foot { color: var(--muted); font-size: 11px; text-align: center; margin-top: 22px; }
</style>
</head>
<body>
<div class="stripe"></div>
<div class="page">
  <header>
    <h1>📇 Your team contacts</h1>
    <p>Tap <strong>Save to phone</strong> on each card. iPhone / Android will open the native "Add Contact" dialog so you can save them one by one.</p>
  </header>
  ${list.length === 0 ? '<div class="empty">No contacts configured yet.</div>' : cards}
  <div class="foot">U.S. Shingle &amp; Metal LLC</div>
</div>
</body>
</html>`

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
    body: html,
  }
}

// HTML escaping for safe template injection.
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Build a single VCARD 3.0 block. Each phone is tagged CELL,VOICE so iPhone
// labels it "mobile" by default; orgs/titles fill the company line on the
// contact card.
function toVCard(c) {
  // Split display_name into FN + N components. The N field is structured —
  // Last;First;Middle;Prefix;Suffix. We do a naive 1- or 2-word split.
  const parts = (c.display_name || '').trim().split(/\s+/)
  const first = parts[0] || ''
  const last = parts.slice(1).join(' ') || ''

  const lines = []
  lines.push('BEGIN:VCARD')
  lines.push('VERSION:3.0')
  lines.push(`FN:${vEsc(c.display_name)}`)
  lines.push(`N:${vEsc(last)};${vEsc(first)};;;`)
  if (c.organization) lines.push(`ORG:${vEsc(c.organization)}`)
  if (c.title) lines.push(`TITLE:${vEsc(c.title)}`)
  if (c.phone) lines.push(`TEL;TYPE=CELL,VOICE:${vEsc(c.phone)}`)
  if (c.email) lines.push(`EMAIL;TYPE=INTERNET:${vEsc(c.email)}`)
  lines.push('END:VCARD')
  return lines.join('\r\n')
}

// vCard field escaping per RFC 6350. Backslash, comma, semicolon, newline.
function vEsc(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\r?\n/g, '\\n')
}

// Inside a PostgREST or() the value can't contain commas or parens unquoted.
// Wrap with double quotes if it has anything funky.
function escapeOr(v) {
  if (/[,()'"\s]/.test(v)) return `"${String(v).replace(/"/g, '\\"')}"`
  return v
}

function text(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body,
  }
}
