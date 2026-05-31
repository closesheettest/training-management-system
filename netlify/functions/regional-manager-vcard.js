// Returns a .vcf (vCard) file for a single regional sales manager so
// the reps in their zone can save them to their phone in one tap.
//
// Used by the announcement SMS / email — send-regional-manager-welcome
// puts a link to this endpoint in the body. The rep taps it, iOS or
// Android opens the native "Add to Contacts" sheet, done.
//
// Public — no auth. Returns only the name + phone + email + zone the
// rep would see in /directory anyway. Only resolves for trainees who
// actually have managed_region set (so revoked managers stop showing
// up immediately).
//
// Usage:
//   GET /.netlify/functions/regional-manager-vcard?id=<trainee_id>
//     → .vcf download for that manager. Filename: <Name>.vcf
//
//   GET /.netlify/functions/regional-manager-vcard?id=<trainee_id>&preview=1
//     → JSON preview (used by the admin UI's confirm modal so it can
//       show a card preview before firing the announcement).

import { createClient } from '@supabase/supabase-js'

export const handler = async (event) => {
  const missing = []
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY']) {
    if (!process.env[k]) missing.push(k)
  }
  if (missing.length) return text(500, `Missing env vars: ${missing.join(', ')}`)

  const params = event.queryStringParameters || {}
  const id = String(params.id || '').trim()
  if (!id) return text(400, 'Missing id')

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const { data: m } = await supabase
    .from('trainees')
    .select('id, first_name, last_name, phone, email, company_email, managed_region')
    .eq('id', id)
    .maybeSingle()
  if (!m || !m.managed_region) return text(404, 'Manager not found')

  // Prefer the company email on the vCard if we have one — that's the
  // address the rep is supposed to email about work, not the personal
  // address the manager registered with.
  const contact = {
    display_name: `${m.first_name || ''} ${m.last_name || ''}`.trim() || 'Sales Manager',
    title: `Regional Sales Manager — ${m.managed_region}`,
    organization: 'U.S. Shingle & Metal LLC',
    phone: m.phone || null,
    email: m.company_email || m.email || null,
  }

  if (params.preview === '1' || params.preview === 'true') {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
      body: JSON.stringify({ ok: true, manager: contact }),
    }
  }

  const vcard = toVCard(contact)
  const filename = `${contact.display_name.replace(/[^a-zA-Z0-9-]/g, '-')}.vcf`
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/vcard; charset=utf-8',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
    body: vcard,
  }
}

// vCard 3.0 — same format the trainee-contacts-vcard function uses so
// iOS and Android handle it consistently. CELL,VOICE label so it shows
// up as "mobile" on iPhone by default.
function toVCard(c) {
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

function vEsc(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\r?\n/g, '\\n')
}

function text(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body,
  }
}
