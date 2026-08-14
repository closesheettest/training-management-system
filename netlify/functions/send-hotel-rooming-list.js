// send-hotel-rooming-list.js
//
// Emails a hotel their rooming list — the names + dates HR needs rooms for.
// Jen often reads the hotel a list of guests over the phone; this sends the
// same list in writing to the contact she's dealing with.
//
// Request:
//   POST { stay_ids: [...], contact_email, hotel_name? }
//
// Response: { ok, sent, to } | { ok:false, error }
//
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY (+ Resend via _email.js).

import { createClient } from '@supabase/supabase-js'
import { sendEmail } from './_email.js'

const SB_URL = process.env.SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SECRET_KEY

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method Not Allowed' })
  if (!SB_URL || !SB_KEY) return json(500, { ok: false, error: 'Missing SUPABASE env vars' })

  let body
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { ok: false, error: 'Invalid JSON' }) }
  const stayIds = Array.isArray(body.stay_ids) ? body.stay_ids : []
  const to = String(body.contact_email || '').trim()
  if (!stayIds.length) return json(400, { ok: false, error: 'stay_ids required' })
  if (!to || !to.includes('@')) return json(400, { ok: false, error: 'A valid hotel contact email is required' })

  const supabase = createClient(SB_URL, SB_KEY)
  const { data: stays, error } = await supabase
    .from('trainee_hotel_stays')
    .select('id, hotel_name, guest_name, check_in_date, check_out_date, trainees(first_name, last_name)')
    .in('id', stayIds)
  if (error) return json(500, { ok: false, error: error.message })
  if (!stays || !stays.length) return json(200, { ok: false, error: 'No bookings found' })

  const hotelName = body.hotel_name || stays[0].hotel_name || 'your hotel'
  const rows = stays
    .map((s) => {
      const nm = s.guest_name || `${s.trainees?.first_name || ''} ${s.trainees?.last_name || ''}`.trim() || 'Guest'
      const ci = fmt(s.check_in_date)
      const co = fmt(s.check_out_date)
      const dates = ci && co ? `${ci} → ${co}` : ci ? `check-in ${ci}` : ''
      return { nm, dates }
    })
    .sort((a, b) => a.nm.localeCompare(b.nm))

  const list = rows.map((r, i) => `${i + 1}. ${r.nm}${r.dates ? ` — ${r.dates}` : ''}`).join('\n')
  const subject = `Rooming list — U.S. Shingle & Metal (${rows.length} room${rows.length === 1 ? '' : 's'})`
  // Plain text; _email.js wraps newlines into HTML for the pretty version.
  const bodyText =
    `Hello,\n\n` +
    `Here is our rooming list for ${hotelName} — ${rows.length} room${rows.length === 1 ? '' : 's'} for U.S. Shingle & Metal:\n\n` +
    `${list}\n\n` +
    `Please confirm availability and send a confirmation number for each.\n\nThank you!\n— U.S. Shingle & Metal`

  const r = await sendEmail(to, subject, bodyText)
  if (r && r.ok === false) return json(500, { ok: false, error: r.error || 'send failed' })
  return json(200, { ok: true, sent: rows.length, to })
}

function fmt(iso) {
  if (!iso) return ''
  const [y, m, d] = String(iso).split('T')[0].split('-').map(Number)
  if (!y) return iso
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}
