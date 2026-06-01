// Returns a single rep's .vcf (vCard) file so a regional manager can
// tap "Save to phone" on any rep in their zone and add them to their
// phone contacts in one go.
//
// Public — no auth header — but token-gated:
//   1. The manager_access_token from the URL must resolve to a trainee
//      with a managed_region set (revoked managers can't pull anything).
//   2. The requested trainee_id must belong to a rep in the manager's
//      zone (region match). Otherwise 403 — managers can't reach into
//      other zones via this endpoint.
//
// Usage:
//   GET /.netlify/functions/regional-manager-rep-vcard
//       ?token=<manager_token>
//       &trainee_id=<rep_uuid>
//     → .vcf download
//
//   GET ?...&preview=1
//     → JSON preview (for the UI to render a confirm card before
//       triggering the download).

import { createClient } from '@supabase/supabase-js'

export const handler = async (event) => {
  const missing = []
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY']) {
    if (!process.env[k]) missing.push(k)
  }
  if (missing.length) return text(500, `Missing env vars: ${missing.join(', ')}`)

  const params = event.queryStringParameters || {}
  const token = String(params.token || '').trim()
  const traineeId = String(params.trainee_id || '').trim()
  if (!token || !traineeId) return text(400, 'Missing token or trainee_id')

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  // Resolve the manager from their access token.
  const { data: manager } = await supabase
    .from('trainees')
    .select('id, managed_region')
    .eq('manager_access_token', token)
    .maybeSingle()
  if (!manager || !manager.managed_region) {
    return text(404, 'Invalid or revoked manager link.')
  }

  // Pull the requested rep — narrowly, only the fields we put on the
  // vCard plus region for the zone gate.
  const { data: rep } = await supabase
    .from('trainees')
    .select('id, first_name, last_name, phone, email, company_email, region')
    .eq('id', traineeId)
    .maybeSingle()
  if (!rep) return text(404, 'Rep not found.')

  // Zone gate — manager can only pull vCards for reps in their own zone.
  // Without this, a manager-token holder could iterate trainee IDs and
  // exfiltrate every rep's contact info system-wide. With it, they're
  // strictly limited to their team.
  if (rep.region !== manager.managed_region) {
    return text(403, 'That rep is not in your zone.')
  }

  // Prefer company email on the vCard — that's the "work me" address.
  // Personal email falls back if no company one exists.
  const contact = {
    display_name: `${rep.first_name || ''} ${rep.last_name || ''}`.trim() || 'Sales Rep',
    organization: 'U.S. Shingle & Metal LLC',
    phone: rep.phone || null,
    email: rep.company_email || rep.email || null,
  }

  if (params.preview === '1' || params.preview === 'true') {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
      body: JSON.stringify({ ok: true, rep: contact }),
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

// Same vCard 3.0 builder as regional-manager-vcard.js and
// trainee-contacts-vcard.js — kept in lock-step so iOS / Android
// behavior matches across every vCard the system emits.
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
