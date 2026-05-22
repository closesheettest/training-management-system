// Read-only roster for the public /directory page.
//
// Returns every active person on the team (is_active_sales_rep = true)
// with ONLY the fields safe to share company-wide. Personal data like
// street_address, latitude/longitude, personal email, and registration
// tokens are deliberately omitted. The page that consumes this is the
// shared phone-book that gets posted on the company dashboard.
//
// Filtering: includes Junior, Senior, AND Non-field staff so the
// directory works as a full company phone book.
//
// Required env vars: SUPABASE_URL, SUPABASE_SECRET_KEY

import { createClient } from '@supabase/supabase-js'

export const handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method Not Allowed' })
  }
  const missing = []
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY']) {
    if (!process.env[k]) missing.push(k)
  }
  if (missing.length > 0) {
    return json(500, { error: `Server missing env: ${missing.join(', ')}` })
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY,
    { auth: { persistSession: false } },
  )

  const { data, error } = await supabase
    .from('trainees')
    .select(
      'id, first_name, last_name, phone, company_phone, company_email, region, department, rep_level, birthday, directory_hidden, directory_note',
    )
    .eq('is_active_sales_rep', true)
    .order('last_name', { ascending: true })
    .order('first_name', { ascending: true })

  if (error) return json(500, { error: `Supabase: ${error.message}` })

  // Apply per-person privacy: anything keyed "true" in directory_hidden
  // gets stripped before the browser sees it. directory_hidden itself
  // is also dropped from the response — admin tooling on /active-reps
  // is where it's managed.
  const FIELD_MAP = {
    phone: 'phone',
    company_phone: 'company_phone',
    email: 'company_email',
    region: 'region',
    department: 'department',
    level: 'rep_level',
    birthday: 'birthday',
  }
  const reps = (data || []).map((r) => {
    const hidden = (r.directory_hidden && typeof r.directory_hidden === 'object') ? r.directory_hidden : {}
    const out = { ...r }
    for (const [key, col] of Object.entries(FIELD_MAP)) {
      if (hidden[key]) out[col] = null
    }

    // Phones support sub-modes: '<key>_call' or '<key>_text' set true
    // means that specific action is blocked. Compute per-phone action
    // flags. If BOTH actions are blocked (or the phone is fully hidden)
    // null the phone too so it falls off the card entirely.
    function phoneActions(key) {
      if (hidden[key]) return { call: false, text: false }
      const call = !hidden[`${key}_call`]
      const text = !hidden[`${key}_text`]
      return { call, text }
    }
    out.phone_actions = phoneActions('phone')
    out.company_phone_actions = phoneActions('company_phone')
    if (!out.phone_actions.call && !out.phone_actions.text) out.phone = null
    if (!out.company_phone_actions.call && !out.company_phone_actions.text) out.company_phone = null

    // Strip the birth YEAR before sending to the browser — month + day
    // only is what the public directory shows. Year stays in the DB for
    // HR records but never leaves the server.
    if (out.birthday) {
      const parts = String(out.birthday).slice(0, 10).split('-')
      if (parts.length === 3) {
        out.birthday = `2000-${parts[1]}-${parts[2]}`
      }
    }
    delete out.directory_hidden
    return out
  })

  return json(200, { reps })
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  }
}
