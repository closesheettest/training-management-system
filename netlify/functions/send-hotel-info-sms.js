// Fired from the Hotels page (Setup ▾ → Hotels) when HR clicks
// "Send info". Sends each requested trainee their hotel-room SMS.
//
// Body comes from the editable 'hotel_room_info' template — the
// {hotelDetails} placeholder is built dynamically here so that
// fields HR didn't fill in (e.g. confirmation number) simply don't
// appear in the text, instead of leaving blank lines.
//
// Stamps trainee_hotel_stays.info_sent_at after a successful send so
// the UI can show "Sent: <timestamp>" vs "Not sent yet".
//
// Request body shape:
//   { stay_ids: ["uuid1", "uuid2", ...] }    — explicit list
//     OR
//   { class_id: "uuid", unsent_only: true }  — every stay for this class
//                                              that hasn't been sent yet
//
// No auth — admin-only page, same convention as other manual triggers.
//
// Required env vars: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN,
// GHL_LOCATION_ID.

import { createClient } from '@supabase/supabase-js'
import { sendSmsViaGhl } from './_ghl.js'
import { renderTemplate } from './_templates.js'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' })

  const missing = []
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'GHL_PIT_TOKEN', 'GHL_LOCATION_ID']) {
    if (!process.env[k]) missing.push(k)
  }
  if (missing.length) return json(500, { error: `Missing env vars: ${missing.join(', ')}` })

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  // Resolve which stays we're sending.
  let stayQuery = supabase
    .from('trainee_hotel_stays')
    .select(
      'id, hotel_name, hotel_street_address, hotel_city, hotel_state, hotel_zip, hotel_phone, check_in_date, check_out_date, confirmation_number, guest_name, room_number, notes, info_sent_at, trainees(id, first_name, phone), classes(id, week_start_date)',
    )

  if (Array.isArray(body.stay_ids) && body.stay_ids.length > 0) {
    stayQuery = stayQuery.in('id', body.stay_ids)
  } else if (body.class_id) {
    stayQuery = stayQuery.eq('class_id', body.class_id)
    if (body.unsent_only !== false) {
      stayQuery = stayQuery.is('info_sent_at', null)
    }
  } else {
    return json(400, { error: 'Either stay_ids[] or class_id is required' })
  }

  const { data: stays, error } = await stayQuery
  if (error) return json(500, { error: `Supabase: ${error.message}` })
  if (!stays || stays.length === 0) {
    return json(200, { ok: true, sent_count: 0, message: 'Nothing to send.' })
  }

  const results = []
  for (const s of stays) {
    const t = s.trainees
    if (!t?.phone) {
      results.push({ stay_id: s.id, ok: false, error: 'No trainee phone on file' })
      continue
    }
    if (!s.hotel_name) {
      results.push({ stay_id: s.id, ok: false, error: 'Hotel name is blank' })
      continue
    }

    const hotelDetails = buildDetailsBlock(s)
    const weekDate = formatDate(s.classes?.week_start_date)
    const message = await renderTemplate(supabase, 'hotel_room_info', {
      firstName: t.first_name || 'there',
      weekDate,
      hotelDetails,
    })

    const sms = await sendSmsViaGhl(t.phone, message, {
      firstName: t.first_name || 'Trainee',
      lastName: 'Hotel',
    })
    if (!sms.ok) {
      results.push({ stay_id: s.id, ok: false, error: sms.error, step: sms.step })
      continue
    }

    await supabase
      .from('trainee_hotel_stays')
      .update({ info_sent_at: new Date().toISOString() })
      .eq('id', s.id)

    results.push({ stay_id: s.id, ok: true })
  }

  return json(200, {
    ok: true,
    sent_count: results.filter((r) => r.ok).length,
    fail_count: results.filter((r) => !r.ok).length,
    results,
  })
}

// Build the multi-line hotel info block. Skips any field that's empty so
// the trainee doesn't get a text with "Confirmation: " trailing nowhere.
function buildDetailsBlock(s) {
  const lines = [s.hotel_name]
  const addr = formatAddress(s)
  if (addr) lines.push(addr)
  if (s.hotel_phone) lines.push(`Phone: ${s.hotel_phone}`)
  if (s.check_in_date) lines.push(`Check-in: ${formatDate(s.check_in_date)}`)
  if (s.check_out_date) lines.push(`Check-out: ${formatDate(s.check_out_date)}`)
  if (s.guest_name) lines.push(`Booked under: ${s.guest_name}`)
  if (s.confirmation_number) lines.push(`Confirmation #: ${s.confirmation_number}`)
  if (s.room_number) lines.push(`Room: ${s.room_number}`)
  if (s.notes && s.notes.trim()) lines.push(s.notes.trim())
  return lines.join('\n')
}

function formatAddress(s) {
  const cityState = [s.hotel_city, [s.hotel_state, s.hotel_zip].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ')
  return [s.hotel_street_address, cityState].filter(Boolean).join(', ')
}

function formatDate(iso) {
  if (!iso) return ''
  const [y, m, d] = String(iso).split('T')[0].split('-').map(Number)
  if (!y || !m || !d) return iso
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
