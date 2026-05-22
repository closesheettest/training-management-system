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
      'id, first_name, last_name, phone, company_email, region, rep_level, company_number',
    )
    .eq('is_active_sales_rep', true)
    .order('last_name', { ascending: true })
    .order('first_name', { ascending: true })

  if (error) return json(500, { error: `Supabase: ${error.message}` })

  return json(200, { reps: data || [] })
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  }
}
