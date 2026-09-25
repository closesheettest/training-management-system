// Sales Training Customer: grade one practice session and save the report card.
//
// GRADED ON POINTS, NOT WORDS. It is question-based selling: a conversation, not
// a recital. What counts is whether the rep brought out each slide's POINTS (the
// list the office keeps on the Slide Points page, training_days.on_slide), in
// their own words, in any order, adapted to the homeowner. The first version
// graded the script word for word and Neal (who wrote it) scored 0/10 on slides
// he covered in his own words (25 Sep). The script is kept only as the source
// of FACTS: a wrong number or promise is flagged, a paraphrase never is. A background function
// (the "-background" name) because a full presentation's transcript can take
// well past the 10-second limit of a normal function. Called by practice-api.
//
// POST { id, secret }   secret = CRON_SECRET
// Env: GEMINI_API_KEY, GEMINI_TEXT_MODEL (optional, default gemini-3.8-flash),
//      SUPABASE_URL, SUPABASE_SECRET_KEY, CRON_SECRET.
import { createClient } from '@supabase/supabase-js'
import { scriptForSection } from './_sales-script.js'
import { personaByKey, sectionByKey, DECK } from '../../src/lib/salesPractice.js'

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
      description: 'One entry per part in scope, in the order given in THE POINTS. covered/missed are POINTS (short), not script lines.',
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
    facts_wrong: {
      type: 'ARRAY',
      description: 'ONLY things the rep said that are factually wrong vs the script (a wrong number, coverage amount, warranty term, promise). Never a paraphrase of a correct point. Empty if none.',
      items: {
        type: 'OBJECT',
        properties: { rep_said: { type: 'STRING' }, correct: { type: 'STRING' } },
        required: ['rep_said', 'correct'],
      },
    },
    good_questions: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Questions the rep asked that got the homeowner to arrive at a point themselves (quote them)' },
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
  required: ['score', 'summary', 'outcome', 'strengths', 'top_fixes', 'parts', 'facts_wrong', 'good_questions', 'objections', 'used_their_answers'],
}

// The checklist the rep is graded on. Slides come from the Slide Points page
// (training_days.on_slide, " · "-separated). The intro and the customer survey
// have no slide there, so their points are the PURPOSE of each part of the
// script, not its wording.
const INTRO_POINTS = [
  'Set the agenda: who we are, take photos, show all the options, guaranteed 30-day price',
  'Ask permission to ask questions first, so the estimate fits what they want ("Fair enough?")',
  'Not here to sell them a roof: they already know they need one',
]
const SURVEY_POINTS = [
  'What caught their eye (mailer / Facebook ad)',
  'How long they have owned it and how old the roof was when they bought',
  'Why this home / neighborhood; forever home or moving soon',
  'Upgrades done or planned',
  'How they feel about their homeowners insurance, and what they pay',
  'Highest and lowest electric bill (with the "sounds unrelated, I will explain" setup)',
  'How long the roof has been a concern, and why they had us out today',
  'The 2 most important qualities when choosing a company',
  'Which problems they have (leaks, mold, insurance cost, damage, maintenance, energy cost, quality)',
  'Pre-close: would they want to know about saving by starting sooner; opposed to starting right away if the price or term fits?',
]
const CLOSE_EXTRA = [
  'Ask for the business: roof only vs. the whole package, as a choice between two, then SILENCE until they answer',
  'If they want more estimates: confirm they are serious, liked you / the company / the product, get the number that earns it today, "if I can do this, will you do that?" before calling the manager',
]
// How far the rep got: the highest script slide number they put on screen.
// A run that ends at slide 4 is graded on slides 1-4, not failed on 5-23
// (Neal's first run scored 0/10 on nineteen slides he never reached).
export function furthestSlide(transcript) {
  let max = 0
  for (const t of transcript || []) {
    if (t.who !== 'slide') continue
    const page = parseInt((String(t.text).match(/deck page (\d+)/) || [])[1], 10)
    const d = DECK.find((x) => x.page === page)
    const n = parseInt((String(d?.script || '').match(/\d+/) || [])[0], 10) || (page >= 30 ? 23 : 0)
    if (n > max) max = n
  }
  return max
}

export async function pointsForSection(sb, sectionKey, maxSlide = 99) {
  const { data } = await sb.from('training_days').select('position, title, subject, on_slide').order('position')
  const slides = (data || [])
    .filter((d) => /^Slides?\s*\d/.test(String(d.subject || '').trim()) && String(d.on_slide || '').trim())
    .map((d) => ({ n: parseInt(String(d.subject).match(/\d+/)[0], 10), label: `${d.subject}: ${d.title}`, pts: String(d.on_slide).split(/\s*·\s*/).filter(Boolean) }))
  const block = (label, pts) => `${label}\n${pts.map((x) => `  - ${x}`).join('\n')}`
  const range = { survey: [0, 0], why_today: [6, 7], close: [22, 23], full: [1, 99] }[sectionKey] || [1, 99]
  const out = []
  // Full is the slide show only: the warm-up is taken as done and never graded there.
  if (sectionKey === 'survey') out.push(block('Intro', INTRO_POINTS), block('Customer Survey', SURVEY_POINTS))
  for (const sl of slides) if (sl.n >= range[0] && sl.n <= Math.min(range[1], maxSlide)) out.push(block(sl.label, sl.pts))
  if (sectionKey === 'close' || (sectionKey === 'full' && maxSlide >= 23)) out.push(block('Closing the deal', CLOSE_EXTRA))
  return out.join('\n\n')
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

  const reached = row.section === 'full' ? furthestSlide(row.transcript) : 99
  const points = await pointsForSection(sb, row.section, reached)
  const notReached = row.section === 'full' && reached < 23 ? `Slides ${reached + 1}–23 and the close` : ''

  const prompt = `You are an encouraging, honest sales trainer at U.S. Shingle, a Florida roofing company. Grade a rep's practice IN-HOME PRESENTATION (kitchen table, both spouses present).

HOW WE SELL: question-based selling. It is a conversation, not a script. The rep's job on each part is to BRING OUT ITS POINTS so the homeowner understands and agrees with them, ideally by asking questions that let the homeowner get there themselves. Every homeowner is different, so the order, the wording and the route will differ every time.

SO GRADE ON POINTS, NOT WORDS:
- A point is COVERED if the homeowner clearly got the idea, however the rep said it: their own words, a story, a question, any order, even out of the slide it belongs to.
- NEVER mark anything down for not matching the script's wording. Do not quote script lines at the rep as "what you should have said" unless they missed the point entirely.
- DO flag facts that are WRONG (a wrong statistic, coverage amount, warranty term, price promise). The script below is the source of the facts, not of the wording.
- Reward: good questions, tie-downs that get agreement, using what the homeowner said in the survey later (their insurance cost, electric bill, forever home, allergies), adapting to this personality, handling objections, keeping control of the conversation without being rude, and a professional tone.

WHAT WAS PRACTICED: ${section.label}.${row.section === 'full' ? ' The warm-up and customer survey were ALREADY DONE before this started (the homeowner has answered them); never grade or mention them as missing. The rep may still use what the homeowner told them in the survey.' : ''}${notReached ? ` The run ended at slide ${reached}: ${notReached} were NOT REACHED. Do not grade them, list them, or count them against the score; judge the parts that were reached.` : ''} Grade only the parts listed in THE POINTS; nothing outside them.

THE HOMEOWNER (an AI role-play): ${persona.name}, "${persona.tagline}". ${persona.blurb}
What a good rep does with this homeowner: ${persona.close}

THE POINTS (the checklist for each part):
${points}

THE SCRIPT (reference for FACTS only):
"""
${scriptForSection(row.section)}
"""

THE TRANSCRIPT (speech-to-text, so ignore small transcription errors; [brackets] are the slide the rep had on screen):
"""
${lines}
"""
${silence}

Score = how well the points were brought out plus how well the conversation was handled. 90+ = ready for a real kitchen table, 75-89 = close, 60-74 = needs work, under 60 = go back and practice. Per part, 10/10 means every point landed with the homeowner; words do not matter. Be specific and quote the rep. For "say instead" on an objection, give a natural, question-led way to handle it (the script's approach where it has one). Write in plain, direct language a trainer can read out to the rep.`

  try {
    // BUSY IS NORMAL. The first real grading run (25 Sep) came back "This model is
    // currently experiencing high demand". A background function has 15 minutes,
    // so wait and retry, then fall back to another Flash model, before giving up.
    const models = [...new Set([process.env.GEMINI_TEXT_MODEL || 'gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-flash-latest'])]
    const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))
    let d = null, lastErr = ''
    outer: for (const model of models) {
      for (const wait of [0, 8000, 25000]) {
        if (wait) await sleep(wait)
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json', responseSchema: REPORT_SCHEMA, temperature: 0.2 },
          }),
        })
        const j = await r.json().catch(() => ({}))
        if (r.ok) { d = j; break outer }
        lastErr = `${model}: ${j.error?.message || r.status}`
        const busy = r.status === 429 || r.status >= 500 || /demand|overload|unavailable|try again/i.test(j.error?.message || '')
        if (!busy) break // a real error (bad request, unknown model): next model, no point retrying this one
      }
    }
    if (!d) { await fail(`Gemini: ${lastErr}`); return }
    const text = (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('')
    const report = JSON.parse(text)
    const score = Math.max(0, Math.min(100, Math.round(Number(report.score) || 0)))
    if (notReached) report.not_reached = notReached
    await sb.from('sales_practice_sessions').update({ grade_status: 'done', grade_error: null, score, report }).eq('id', body.id)
  } catch (e) {
    await fail(e.message || 'grading failed')
  }
}
