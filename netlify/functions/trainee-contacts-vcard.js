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

  const vcardBody = (contacts || []).map(toVCard).join('\r\n')

  // Some phones won't auto-recognize the file as contacts unless the
  // Content-Type is text/vcard and the filename has .vcf. The download
  // header keeps it consistent across iOS, Android, and desktop browsers.
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/vcard; charset=utf-8',
      'Content-Disposition': 'inline; filename="team-contacts.vcf"',
      'Cache-Control': 'no-store',
    },
    body: vcardBody,
  }
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
