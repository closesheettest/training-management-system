// company-reviews.js — real Google reviews of U.S. Shingle & Metal for the training lobby slideshow
// (Neal, 2026-10-04: "we have plenty of Google, so read a bunch of those"). Google's Places API
// gives up to 5 reviews per request, so we ask for the most relevant AND the newest and merge
// (up to 10), 5-star only, cached a day in app_settings. Shown with Google credit, as required.
//   GET → { ok, rating, total, reviews:[{ name, stars, text, when }] }
// Env: GOOGLE_MAPS_API_KEY (Places API), SUPABASE_URL, SUPABASE_SECRET_KEY.
import { createClient } from '@supabase/supabase-js'

const json = (c, b) => ({ statusCode: c, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }, body: JSON.stringify(b) })
const QUERY = 'U.S. Shingle & Metal 12910 Automobile Blvd Clearwater FL'

export const handler = async (event) => {
  const key = (process.env.GOOGLE_MAPS_API_KEY || '').trim()
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const fresh = (event.queryStringParameters || {}).fresh === '1'
  const { data: cached } = await sb.from('app_settings').select('value, updated_at').eq('key', 'company_reviews').maybeSingle()
  if (cached && !fresh && Date.now() - Date.parse(cached.updated_at) < 864e5) { try { return json(200, JSON.parse(cached.value)) } catch { /* refetch */ } }
  if (!key) return json(200, { ok: false, error: 'no key' })
  try {
    const f = await (await fetch(`https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(QUERY)}&inputtype=textquery&fields=place_id,name&key=${key}`)).json()
    const pid = f.candidates?.[0]?.place_id
    if (!pid) return json(200, { ok: false, error: f.status || 'place not found' })
    const get = (sort) => fetch(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${pid}&fields=name,rating,user_ratings_total,reviews&reviews_sort=${sort}&reviews_no_translations=true&key=${key}`).then((r) => r.json())
    const [a, b] = await Promise.all([get('most_relevant'), get('newest')])
    const seen = new Set(), reviews = []
    for (const r of [...(a.result?.reviews || []), ...(b.result?.reviews || [])]) {
      const k = `${r.author_name}|${r.time}`
      if (seen.has(k) || r.rating < 5 || String(r.text || '').trim().length < 40) continue
      seen.add(k)
      reviews.push({ name: String(r.author_name || '').split(' ').map((w, i) => (i ? `${w[0]}.` : w)).join(' '), stars: r.rating, text: String(r.text).trim(), when: r.relative_time_description || '' })
    }
    // PAST TRAINEES (Neal, 2026-10-04): their answers to "is Neal's training worth my time?" from the
    // final test, ones the office marked for testimonials — word for word (never reworded), and
    // short enough to read on a slide.
    const { data: tr } = await sb.from('test_responses').select('essay_response, question_prompt, test_attempts(trainees(first_name, last_name))')
      .eq('question_type', 'essay').eq('use_for_testimonial', true).not('essay_response', 'is', null).ilike('question_prompt', '%worth my time%').order('created_at', { ascending: false }).limit(200)
    const trainees = (tr || []).map((x) => ({ text: String(x.essay_response || '').trim(), t: x.test_attempts?.trainees }))
      .filter((x) => x.text.length >= 60 && x.text.length <= 420 && x.t?.first_name)
      .map((x) => ({ name: `${x.t.first_name} ${String(x.t.last_name || '').slice(0, 1)}${x.t.last_name ? '.' : ''}`.trim(), text: x.text }))
      .slice(0, 30)
    const out = { ok: true, name: a.result?.name || '', rating: a.result?.rating || null, total: a.result?.user_ratings_total || null, reviews, trainees }
    await sb.from('app_settings').upsert({ key: 'company_reviews', value: JSON.stringify(out), updated_at: new Date().toISOString() }, { onConflict: 'key' })
    return json(200, out)
  } catch (e) { return json(200, { ok: false, error: e.message }) }
}
