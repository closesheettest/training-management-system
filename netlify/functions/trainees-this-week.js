// Public-ish endpoint: THIS WEEK's field trainees who are NOT yet active reps —
// for CCG's field-training picker (William takes trainees out Thu/Fri before
// they graduate). A trainee is "this week" when today falls inside their class's
// week_start_date..week_end_date, and "in training" when is_active_sales_rep is
// not true. When they pass and flip to active, they drop off this list and join
// the normal rep rotation (their ride history is re-linked CCG-side by phone).
//
//   GET /.netlify/functions/trainees-this-week
//     → { ok, count, trainees:[{ id, name, first_name, last_name, phone }] }
//
// CORS: open (same as rep-zones — names + phones only).

import { createClient } from '@supabase/supabase-js'

const SB_URL = process.env.SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SECRET_KEY

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return cors(200, '')
  if (event.httpMethod !== 'GET') return cors(405, JSON.stringify({ ok: false, error: 'Method Not Allowed' }))
  if (!SB_URL || !SB_KEY) return cors(500, JSON.stringify({ ok: false, error: 'Missing SUPABASE env vars' }))

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) // YYYY-MM-DD ET
  const supabase = createClient(SB_URL, SB_KEY)

  // 1) In-training (not yet active), non-declined trainees who have a class.
  const { data: ts, error: e1 } = await supabase
    .from('trainees')
    .select('id, first_name, last_name, phone, is_active_sales_rep, declined_at, class_id')
    .is('declined_at', null)
    .order('last_name', { ascending: true })
  if (e1) return cors(500, JSON.stringify({ ok: false, error: e1.message }))
  const inTraining = (ts || []).filter((t) => t.is_active_sales_rep !== true && t.class_id)

  // 2) Keep only those whose class's week window contains today.
  let currentClassIds = new Set()
  const classIds = [...new Set(inTraining.map((t) => t.class_id))]
  if (classIds.length) {
    const { data: cs } = await supabase
      .from('classes')
      .select('id, week_start_date, week_end_date')
      .in('id', classIds)
      .lte('week_start_date', today)
      .gte('week_end_date', today)
    currentClassIds = new Set((cs || []).map((c) => c.id))
  }

  const trainees = inTraining
    .filter((t) => currentClassIds.has(t.class_id))
    .map((t) => ({
      id: t.id,
      name: `${t.first_name || ''} ${t.last_name || ''}`.trim(),
      first_name: t.first_name || '',
      last_name: t.last_name || '',
      phone: t.phone || null,
    }))

  return cors(200, JSON.stringify({ ok: true, generated_at: new Date().toISOString(), count: trainees.length, trainees }))
}

function cors(status, body) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
    body,
  }
}
