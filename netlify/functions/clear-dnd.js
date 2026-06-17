// netlify/functions/clear-dnd.js
//
// Clears a trainee's SMS "Do Not Disturb" / opt-out on their GoHighLevel
// contact, so the app's texts deliver again. (When a contact is DND, GHL
// accepts every send but silently drops it — the "Lisa" case. A manual text
// from a personal phone still works, which is the tell.)
//
// POST { trainee_id }  (or { phone })
// → { ok, cleared, contact_id, phone } | { ok:false, error }
//
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN, GHL_LOCATION_ID.

import { createClient } from '@supabase/supabase-js'
import { ghlHeaders } from './_ghl.js'

const GHL = 'https://services.leadconnectorhq.com'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' })
  for (const k of ['GHL_PIT_TOKEN', 'GHL_LOCATION_ID']) {
    if (!process.env[k]) return json(500, { ok: false, error: `Missing env: ${k}` })
  }
  let body
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { ok: false, error: 'Invalid JSON' }) }

  let phone = (body.phone || '').trim()
  let firstName = 'Trainee', lastName = ''
  if (body.trainee_id) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) return json(500, { ok: false, error: 'Missing SUPABASE env' })
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
    const { data: t } = await supabase.from('trainees').select('first_name, last_name, phone').eq('id', body.trainee_id).maybeSingle()
    if (!t) return json(404, { ok: false, error: 'Trainee not found' })
    phone = (t.phone || '').trim()
    firstName = t.first_name || 'Trainee'; lastName = t.last_name || ''
  }
  if (!phone) return json(400, { ok: false, error: 'No phone on file for this trainee' })

  try {
    // 1. Find (or create) the GHL contact by phone.
    const up = await fetch(`${GHL}/contacts/upsert`, {
      method: 'POST', headers: ghlHeaders(),
      body: JSON.stringify({ locationId: process.env.GHL_LOCATION_ID, phone, firstName, lastName }),
    })
    const cj = await up.json().catch(() => ({}))
    if (!up.ok) return json(502, { ok: false, error: `contact lookup ${up.status}: ${cj.message || ''}` })
    const cid = cj.contact?.id || cj.id
    if (!cid) return json(502, { ok: false, error: 'No contact id returned' })

    // 2. Clear DND — turn off the master flag AND re-activate each channel.
    const active = { status: 'active', message: '', code: '' }
    let put = await fetch(`${GHL}/contacts/${cid}`, {
      method: 'PUT', headers: ghlHeaders(),
      body: JSON.stringify({ dnd: false, dndSettings: { SMS: active, Email: active, Call: active, WhatsApp: active, GMB: active, FB: active } }),
    })
    if (!put.ok) {
      // Some accounts reject the dndSettings shape — fall back to the master flag only.
      put = await fetch(`${GHL}/contacts/${cid}`, { method: 'PUT', headers: ghlHeaders(), body: JSON.stringify({ dnd: false }) })
    }
    if (!put.ok) {
      const pj = await put.json().catch(() => ({}))
      return json(502, { ok: false, error: `DND clear ${put.status}: ${pj.message || ''}`, contact_id: cid })
    }
    return json(200, { ok: true, cleared: true, contact_id: cid, phone })
  } catch (e) {
    return json(500, { ok: false, error: e.message || 'error' })
  }
}

function json(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}
