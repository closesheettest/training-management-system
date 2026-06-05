// Returns a single graduate's .vcf (vCard) so a manager can tap the
// rep's name on the handoff page and save them straight to their phone.
//
// No auth — same admin/manager-only convention as
// download-graduation-report.js. Reachable only via the handoff page
// link, which itself is texted only to managers.
//
// Usage:
//   GET /.netlify/functions/graduation-handoff-vcard?trainee_id=<uuid>
//     → .vcf download (iOS/Android open "Add Contact")
//
// Required env vars: SUPABASE_URL, SUPABASE_SECRET_KEY.

import { createClient } from '@supabase/supabase-js'

export const handler = async (event) => {
  const missing = []
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY']) {
    if (!process.env[k]) missing.push(k)
  }
  if (missing.length) return text(500, `Missing env vars: ${missing.join(', ')}`)

  const params = event.queryStringParameters || {}
  const traineeId = String(params.trainee_id || '').trim()
  if (!traineeId) return text(400, 'Missing trainee_id')

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  const { data: rep } = await supabase
    .from('trainees')
    .select('id, first_name, last_name, phone, email, company_email')
    .eq('id', traineeId)
    .maybeSingle()
  if (!rep) return text(404, 'Rep not found.')

  const contact = {
    display_name: `${rep.first_name || ''} ${rep.last_name || ''}`.trim() || 'Sales Rep',
    organization: 'U.S. Shingle & Metal LLC',
    phone: rep.phone || null,
    email: rep.company_email || rep.email || null,
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

// Same vCard 3.0 builder as regional-manager-rep-vcard.js — kept in
// lock-step so iOS / Android behavior matches across every vCard.
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
