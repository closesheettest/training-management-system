// Netlify Function: public JSON feed of testimonial-eligible essay responses.
// Designed to be embedded in nealscoppettuolo.com (GoDaddy Website Builder).
//
// Public — no auth. CORS allows any origin since this is meant to be embedded.
//
// Required env vars: SUPABASE_URL, SUPABASE_SECRET_KEY
//
// Response: {
//   testimonials: [
//     { id, question, answer, name, years_in_sales, region, week_start_date }
//   ],
//   count: number,
//   generated_at: iso string
// }

import { createClient } from '@supabase/supabase-js'

export const handler = async () => {
  const missing = []
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY']) {
    if (!process.env[k]) missing.push(k)
  }
  if (missing.length) {
    return jsonCors(500, { error: `Missing env vars: ${missing.join(', ')}` })
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  const { data, error } = await supabase
    .from('test_responses')
    .select(`
      id,
      question_prompt,
      essay_response,
      created_at,
      test_attempts(
        submitted_at,
        trainees(first_name, last_name, years_in_sales),
        classes(region, week_start_date)
      )
    `)
    .eq('question_type', 'essay')
    .eq('use_for_testimonial', true)
    .not('essay_response', 'is', null)
    .order('created_at', { ascending: false })

  if (error) return jsonCors(500, { error: error.message })

  const testimonials = (data || [])
    .filter((r) => r.essay_response?.trim() && r.test_attempts?.submitted_at)
    .map((r) => {
      const t = r.test_attempts?.trainees
      const c = r.test_attempts?.classes
      const firstName = capitalize(t?.first_name)
      const lastInitial = (t?.last_name || '').charAt(0).toUpperCase()
      return {
        id: r.id,
        question: r.question_prompt,
        answer: r.essay_response.trim(),
        name: t ? `${firstName} ${lastInitial}.` : 'Anonymous',
        years_in_sales: t?.years_in_sales || null,
        region: c?.region || null,
        week_start_date: c?.week_start_date || null,
      }
    })

  return jsonCors(200, {
    testimonials,
    count: testimonials.length,
    generated_at: new Date().toISOString(),
  })
}

function capitalize(s) {
  if (!s) return ''
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

function jsonCors(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      // Public feed — anyone can embed it. Cache 5 min so GoDaddy page loads are snappy.
      'Cache-Control': 'public, max-age=300, s-maxage=300',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    },
    body: JSON.stringify(body),
  }
}
