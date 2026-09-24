// Sales Training Customer: grade one practice session against the sales script,
// word for word, and save the report card on the row. A background function
// (the "-background" name) because a full presentation's transcript can take
// well past the 10-second limit of a normal function. Called by practice-api.
//
// POST { id, secret }   secret = CRON_SECRET
// Env: GEMINI_API_KEY, GEMINI_TEXT_MODEL (optional, default gemini-3.8-flash),
//      SUPABASE_URL, SUPABASE_SECRET_KEY, CRON_SECRET.
import { createClient } from '@supabase/supabase-js'
import { scriptForSection } from './_sales-script.js'
import { personaByKey, sectionByKey } from '../../src/lib/salesPractice.js'

const REPORT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    score: { type: 'INTEGER', description: '0-100 overall' },
    summary: { type: 'STRING', description: '2-3 sentences, plain words, for the trainer to read out' },
    outcome: { type: 'STRING', description: 'What the homeowner decided at the end, or where it stopped' },
    strengths: { type: 'ARRAY', items: { type: 'STRING' } },
    top_fixes: { type: 'ARRAY', items: { type: 'STRING' }, description: 'The 3 most important things to fix, most important first' },
    parts: {
      type: 'ARRAY',
      description: 'One entry per script part that was in scope (e.g. Intro, Customer Survey, Slide 1 ... , Ask for the Business)',
      items: {
        type: 'OBJECT',
        properties: {
          part: { type: 'STRING' },
          score: { type: 'INTEGER', description: '0-10' },
          covered: { type: 'ARRAY', items: { type: 'STRING' } },
          missed: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['part', 'score', 'covered', 'missed'],
      },
    },
    verbatim: {
      type: 'ARRAY',
      description: 'Key script lines the rep paraphrased or got wrong',
      items: {
        type: 'OBJECT',
        properties: { script_says: { type: 'STRING' }, rep_said: { type: 'STRING' } },
        required: ['script_says', 'rep_said'],
      },
    },
    objections: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          objection: { type: 'STRING' },
          handled: { type: 'STRING', description: 'well | partly | poorly | missed' },
          what_rep_said: { type: 'STRING' },
          say_instead: { type: 'STRING', description: 'Use the script / deck wording where it applies' },
        },
        required: ['objection', 'handled', 'what_rep_said', 'say_instead'],
      },
    },
    used_their_answers: { type: 'STRING', description: 'Did the rep tie back what the homeowner told them in the survey (insurance cost, electric bill, allergies, forever home...)? Examples.' },
  },
  required: ['score', 'summary', 'outcome', 'strengths', 'top_fixes', 'parts', 'verbatim', 'objections', 'used_their_answers'],
}

export const handler = async (event) => {
  let body
  try { body = JSON.parse(event.body || '{}') } catch { return }
  if (!process.env.CRON_SECRET || body.secret !== process.env.CRON_SECRET || !body.id) return
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const fail = (msg) => sb.from('sales_practice_sessions').update({ grade_status: 'failed', grade_error: String(msg).slice(0, 500) }).eq('id', body.id)

  const { data: row } = await sb.from('sales_practice_sessions').select('*').eq('id', body.id).maybeSingle()
  if (!row) return
  if (!process.env.GEMINI_API_KEY) { await fail('GEMINI_API_KEY is not set in Netlify.'); return }

  const persona = personaByKey(row.persona_key)
  const section = sectionByKey(row.section)
  const lines = (row.transcript || []).map((t) =>
    t.who === 'slide' ? `   [${t.text}]` : `${t.who === 'rep' ? 'REP' : 'HOMEOWNER'}: ${t.text}`).join('\n')
  const silence = row.close_silence
    ? `\nMEASURED AT THE CLOSE: after the rep asked for the decision, they ${row.close_silence.held ? `stayed silent until the homeowner answered (${row.close_silence.seconds}s)` : `spoke again after ${row.close_silence.seconds}s, before the homeowner answered`}. The script says: stop speaking, do NOT speak again for ANY reason until after they do.`
    : ''

  const prompt = `You are a strict but encouraging sales trainer at U.S. Shingle, a Florida roofing company. Grade a new rep's practice IN-HOME PRESENTATION (kitchen table, both spouses present) against the company sales script. The talk tracks are meant to be delivered WORD FOR WORD, so paraphrasing a key line counts against them, but reward the rep for adapting naturally to what the homeowner said.

WHAT WAS PRACTICED: ${section.label}. Grade only the parts of the script that fall in this section; do not mark down parts that were out of scope.

THE HOMEOWNER (an AI role-play): ${persona.name}, "${persona.tagline}". ${persona.blurb}
What a good rep does with this homeowner: ${persona.close}

THE SCRIPT (in scope):
"""
${scriptForSection(row.section)}
"""

THE TRANSCRIPT (speech-to-text, so ignore small transcription errors; [brackets] are the slide the rep had on screen):
"""
${lines}
"""
${silence}

Grade it. Scores: 90+ = ready for a real kitchen table, 75-89 = close, 60-74 = needs work, under 60 = go back to the script. Be specific and quote the rep. For every "say instead", use the script's own words where one applies. Write in plain, direct language a trainer can read out to the rep.`

  try {
    const model = process.env.GEMINI_TEXT_MODEL || 'gemini-3.8-flash'
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: REPORT_SCHEMA, temperature: 0.2 },
      }),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { await fail(`Gemini: ${d.error?.message || r.status}`); return }
    const text = (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('')
    const report = JSON.parse(text)
    const score = Math.max(0, Math.min(100, Math.round(Number(report.score) || 0)))
    await sb.from('sales_practice_sessions').update({ grade_status: 'done', grade_error: null, score, report }).eq('id', body.id)
  } catch (e) {
    await fail(e.message || 'grading failed')
  }
}
