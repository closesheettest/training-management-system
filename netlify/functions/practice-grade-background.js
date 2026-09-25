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
import { liveCost, gradeCost } from './_practice-prices.js'
import { scriptForSection } from './_sales-script.js'
import { personaByKey, sectionByKey, DECK, OBJECTION_METHOD } from '../../src/lib/salesPractice.js'

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
    control: {
      type: 'OBJECT',
      description: 'WHO CONTROLLED THE CONVERSATION. The person asking the questions is the person in control.',
      properties: {
        score: { type: 'INTEGER', description: '0-10: how much the REP controlled the conversation' },
        who: { type: 'STRING', description: 'rep | homeowner | even' },
        summary: { type: 'STRING', description: '1-2 sentences on who was steering and how' },
        lost_moments: {
          type: 'ARRAY',
          description: 'Moments the homeowner took control (asking the questions, the rep answering or defending). Up to 4, most important first.',
          items: {
            type: 'OBJECT',
            properties: {
              homeowner_said: { type: 'STRING' },
              rep_did: { type: 'STRING' },
              take_it_back: { type: 'STRING', description: 'A QUESTION the rep could have asked to take control back' },
            },
            required: ['homeowner_said', 'rep_did', 'take_it_back'],
          },
        },
      },
      required: ['score', 'who', 'summary', 'lost_moments'],
    },
    good_questions: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Questions the rep asked that got the homeowner to arrive at a point themselves (quote them)' },
    objections: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          objection: { type: 'STRING' },
          handled: { type: 'STRING', description: 'well | partly | poorly | missed, judged ONLY by the objection method' },
          parked: { type: 'BOOLEAN', description: 'true if the rep parked it for later instead of answering on the spot' },
          came_back: { type: 'STRING', description: 'For parked ones: yes (answered later) | no (reached that part, never answered) | not reached. For answered-on-the-spot ones: n/a' },
          what_rep_said: { type: 'STRING' },
          say_instead: { type: 'STRING', description: 'How to handle it by the method (often a park + question), using the deck/script facts where they apply' },
        },
        required: ['objection', 'handled', 'what_rep_said', 'say_instead'],
      },
    },
    used_their_answers: { type: 'STRING', description: 'Did the rep tie back what the homeowner told them in the survey (insurance cost, electric bill, allergies, forever home...)? Examples.' },
  },
  required: ['score', 'summary', 'outcome', 'strengths', 'top_fixes', 'parts', 'control', 'facts_wrong', 'good_questions', 'objections', 'used_their_answers'],
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
// The front-door free-roof-inspection pitch, as points (what has to land at the door).
const DOOR_POINTS = [
  'Opener: who they are, and that we sent them something in the mail about their roof',
  'Why: county records put them at high risk of the insurance company dropping them just because of the roof\'s age',
  'The question: if the insurance letter came tomorrow, only paying out of pocket, or also an inspection report that makes them leave you alone?',
  'The offer: a no-cost roof inspection; no damage = an official certificate of 5+ years of life left, which keeps the insurance off their back',
  'The 3 outcomes: no damage (protected) · wear and tear (options) · storm damage (a public adjuster fights to get insurance to pay)',
  'Pre-close: if the PA finds storm damage, do they want to start right away? If yes, the PA forms need the insurance company + policy number',
  'Commitment: if the policy info is not handy, do the inspection anyway and come back for it. Leave with a yes (time kills all deals)',
]
const CLOSE_EXTRA = [
  'Ask for the business: roof only vs. the whole package, as a choice between two, then SILENCE until they answer',
  'If they want more estimates: confirm they are serious, liked you / the company / the product, get the number that earns it today, "if I can do this, will you do that?" before calling the manager',
]
// How far the rep got: the highest script slide number they put on screen.
// A run that ends at slide 4 is graded on slides 1-4, not failed on 5-23
// (Neal's first run scored 0/10 on nineteen slides he never reached).
export function furthestSlide(transcript) {
  // A slide counts as reached only if the rep SPOKE while it was up. Flipping to
  // slide 4 and ending the session a second later is not presenting slide 4.
  let max = 0, current = 0
  for (const t of transcript || []) {
    if (t.who === 'slide') {
      const page = parseInt((String(t.text).match(/deck page (\d+)/) || [])[1], 10)
      const d = DECK.find((x) => x.page === page)
      current = parseInt((String(d?.script || '').match(/\d+/) || [])[0], 10) || (page >= 30 ? 23 : 0)
    } else if (t.who === 'rep' && String(t.text || '').trim().split(/\s+/).length >= 4 && current > max) {
      max = current
    }
  }
  return max
}

export async function pointsForSection(sb, sectionKey, maxSlide = 99) {
  const { data } = await sb.from('training_days').select('position, title, subject, on_slide').order('position')
  const slides = (data || [])
    .filter((d) => /^Slides?\s*\d/.test(String(d.subject || '').trim()) && String(d.on_slide || '').trim())
    .map((d) => ({ n: parseInt(String(d.subject).match(/\d+/)[0], 10), label: `${d.subject}: ${d.title}`, pts: String(d.on_slide).split(/\s*·\s*/).filter(Boolean) }))
  const block = (label, pts) => `${label}\n${pts.map((x) => `  - ${x}`).join('\n')}`
  const range = sectionByKey(sectionKey).range || [0, -1]
  const out = []
  // Full is the slide show only: the warm-up is taken as done and never graded there.
  if (sectionKey === 'survey') out.push(block('Intro', INTRO_POINTS), block('Customer Survey', SURVEY_POINTS))
  if (sectionKey === 'door') out.push(block('The door pitch (free roof inspection)', DOOR_POINTS))
  for (const sl of slides) if (sl.n >= range[0] && sl.n <= Math.min(range[1], maxSlide)) out.push(block(sl.label, sl.pts))
  if (range[1] >= 23 && Math.min(range[1], maxSlide) >= 22) out.push(block('Closing the deal', CLOSE_EXTRA))
  // A slide with no Slide Points row yet: grade the ideas of its script section.
  if (!out.length && range[1] >= range[0]) out.push('No Slide Points checklist exists for this part yet. Judge whether the rep brought out the KEY IDEAS of THE SCRIPT section below (not its wording).')
  return out.join('\n\n')
}

// BUSY IS NORMAL. The first real grading run (25 Sep) came back "This model is
// currently experiencing high demand". A background function has 15 minutes,
// so wait and retry, then fall back to another Flash model, before giving up.
// Grading tokens used by this invocation (one grade per background run).
const lastGradeUsage = { in: 0, out: 0 }
// Keep what the run cost to talk (saved by practice-api) and ADD this grade to
// it: a re-grade costs money too.
function withCost(report, prev) {
  const u = prev?.usage || {}
  const grades = [...(u.grades || []), { in: lastGradeUsage.in, out: lastGradeUsage.out }]
  const total = liveCost(u.live) + grades.reduce((n, g) => n + gradeCost(g.in, g.out), 0)
  return { ...report, ...(prev?.invite ? { invite: prev.invite } : {}), usage: { ...u, grades }, cost: Math.round(total * 10000) / 10000 }
}

async function geminiJson(prompt, schema) {
  const models = [...new Set([process.env.GEMINI_TEXT_MODEL || 'gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-flash-latest'])]
  const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))
  let lastErr = ''
  for (const model of models) {
    for (const wait of [0, 8000, 25000]) {
      if (wait) await sleep(wait)
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.2 },
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (r.ok) {
        const um = j.usageMetadata || {}
        lastGradeUsage.in += um.promptTokenCount || 0
        lastGradeUsage.out += (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0)
        return JSON.parse((j.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join(''))
      }
      lastErr = `${model}: ${j.error?.message || r.status}`
      const busy = r.status === 429 || r.status >= 500 || /demand|overload|unavailable|try again/i.test(j.error?.message || '')
      if (!busy) break // a real error (bad request, unknown model): next model, no point retrying this one
    }
  }
  throw new Error(`Gemini: ${lastErr}`)
}

// CONTROL DRILL (Neal, 25 Sep): five minutes on one slide with a homeowner who
// keeps asking questions to take control. Every homeowner question is paired
// with the rep's reply HERE (so none can be skipped) and the model only rules on
// each pair. The score is plain arithmetic: kept ÷ total.
const DRILL_SCHEMA = {
  type: 'OBJECT',
  properties: {
    verdicts: {
      type: 'ARRAY',
      description: 'Exactly one entry per numbered exchange, in order',
      items: {
        type: 'OBJECT',
        properties: {
          n: { type: 'INTEGER' },
          verdict: { type: 'STRING', description: 'kept | gave_up | off_topic' },
          why: { type: 'STRING', description: 'One short sentence' },
          better_question: { type: 'STRING', description: 'For gave_up / off_topic: a RELEVANT question the rep could have come back with. Empty for kept.' },
        },
        required: ['n', 'verdict', 'why', 'better_question'],
      },
    },
    summary: { type: 'STRING', description: '2-3 plain sentences on how the rep handled the pressure' },
    tips: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Up to 3 habits to build, most important first' },
  },
  required: ['verdicts', 'summary', 'tips'],
}

async function gradeDrill(sb, row, persona, section, id) {
  const turns = (row.transcript || []).filter((t) => t.who === 'rep' || t.who === 'homeowner')
  const pairs = []
  turns.forEach((t, i) => {
    if (t.who !== 'homeowner' || !String(t.text || '').includes('?')) return
    const reply = turns.slice(i + 1).find((x) => x.who === 'rep')
    const next = turns[i + 1]
    // The rep's reply is the rep turn right after this question (not one after a
    // later homeowner turn, which would pair the wrong exchange).
    if (!reply || next !== reply) return
    // Where the rep went over the next few turns: a question that looks out of
    // the blue is fine if it is the first step of a line of questions that gets
    // to a point (Neal's mortgage questions landing on "the banks vetted us").
    const after = turns.slice(i + 2, i + 7).map((x) => `${x.who === 'rep' ? 'REP' : 'HOMEOWNER'}: ${String(x.text).trim().slice(0, 220)}`)
    pairs.push({ homeowner: String(t.text).trim(), rep: String(reply.text).trim(), after })
  })
  if (!pairs.length) {
    const report = { drill: true, pairs: [], kept: 0, gave_up: 0, off_topic: 0, total: 0, summary: 'The homeowner never got a question answered in this run (nothing to score). Run it again for the full five minutes.', tips: [] }
    await sb.from('sales_practice_sessions').update({ grade_status: 'done', grade_error: null, score: null, report: withCost(report, row.report) }).eq('id', id)
    return
  }
  const prompt = `You are judging a CONTROL DRILL for a roofing sales rep at U.S. Shingle. For five minutes on ${section.label}, an AI homeowner (${persona.name}, "${persona.tagline}") kept asking questions to take control of the conversation. In our method the person asking the questions controls the conversation.

For EACH numbered exchange below (a homeowner question, then the rep's reply), give one verdict:
- "kept": the rep answered (briefly is best) and then took control back WITH A QUESTION OF THEIR OWN that is RELEVANT to what is being discussed, steering toward their point or the slide.
- "gave_up": the rep just answered, explained, defended or argued, with no question back. Control handed to the homeowner.
- "off_topic": the rep asked a question back that had nothing to do with the conversation AND did not lead anywhere: a random deflection. This also gives up control.
IMPORTANT: a question that looks unrelated is NOT off-topic if it is the first step of a line of questions that gets to a point within the next few exchanges (e.g. asking how long their mortgage took to get approved, then how many times the bank came back for more paperwork, then landing on "so the finance companies that approved us put us through the same thing: they did your homework for you"). Read WHERE THE REP WENT NEXT for each exchange; if the question was building to a point, it is "kept".
A tie-down on the point just made ("that makes sense, doesn't it?") counts as kept. PARKING counts as kept: acknowledging the question, saying when it will be covered, and asking the homeowner to hold it ("can we hold that till we get there?"), then back to the point with a question. Ignore small speech-to-text errors. For every gave_up / off_topic, write a RELEVANT question the rep could have come back with.

THE EXCHANGES:
${pairs.map((p, i) => `${i + 1}. HOMEOWNER: ${p.homeowner}\n   REP: ${p.rep}${p.after.length ? `\n   (where the rep went next: ${p.after.join(' | ')})` : ''}`).join('\n')}`
  const out = await geminiJson(prompt, DRILL_SCHEMA)
  const byN = new Map((out.verdicts || []).map((v) => [Number(v.n), v]))
  const scored = pairs.map((p, i) => {
    const v = byN.get(i + 1) || {}
    const verdict = ['kept', 'gave_up', 'off_topic'].includes(v.verdict) ? v.verdict : 'gave_up'
    const { after, ...pp } = p // eslint-disable-line no-unused-vars
    return { ...pp, verdict, why: v.why || '', better_question: verdict === 'kept' ? '' : (v.better_question || '') }
  })
  const kept = scored.filter((x) => x.verdict === 'kept').length
  const report = {
    drill: true, pairs: scored, total: scored.length, kept,
    gave_up: scored.filter((x) => x.verdict === 'gave_up').length,
    off_topic: scored.filter((x) => x.verdict === 'off_topic').length,
    summary: out.summary || '', tips: out.tips || [],
  }
  await sb.from('sales_practice_sessions').update({ grade_status: 'done', grade_error: null, score: Math.round((100 * kept) / scored.length), report: withCost(report, row.report) }).eq('id', id)
}

export const handler = async (event) => {
  let body
  try { body = JSON.parse(event.body || '{}') } catch { return }
  if (!process.env.CRON_SECRET || body.secret !== process.env.CRON_SECRET || !body.id) return
  lastGradeUsage.in = 0; lastGradeUsage.out = 0 // a warm function instance is reused between runs
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const fail = (msg) => sb.from('sales_practice_sessions').update({ grade_status: 'failed', grade_error: String(msg).slice(0, 500) }).eq('id', body.id)

  const { data: row } = await sb.from('sales_practice_sessions').select('*').eq('id', body.id).maybeSingle()
  if (!row) return
  if (!process.env.GEMINI_API_KEY) { await fail('GEMINI_API_KEY is not set in Netlify.'); return }

  const persona = personaByKey(row.persona_key)
  const section = sectionByKey(row.section)
  if (section.drill) {
    try { await gradeDrill(sb, row, persona, section, body.id) } catch (e) { await fail(e.message || 'grading failed') }
    return
  }
  const lines = (row.transcript || []).map((t) =>
    t.who === 'slide' ? `   [${t.text}]` : `${t.who === 'rep' ? 'REP' : 'HOMEOWNER'}: ${t.text}`).join('\n')
  const silence = row.close_silence
    ? `\nMEASURED AT THE CLOSE: after the rep asked for the decision, they ${row.close_silence.held ? `stayed silent until the homeowner answered (${row.close_silence.seconds}s)` : `spoke again after ${row.close_silence.seconds}s, before the homeowner answered`}. The script says: stop speaking, do NOT speak again for ANY reason until after they do.`
    : ''

  // Grade what was reached: from the section's first slide to the furthest one
  // the rep actually presented. A drill that stops early is not failed on the rest.
  const rng = section.range
  let reached = 99
  if (rng && rng[1] > rng[0]) { const f = furthestSlide(row.transcript); reached = f >= rng[0] ? f : rng[1] }
  const points = await pointsForSection(sb, row.section, reached)
  // WHO ASKED THE QUESTIONS, counted, not judged: speech-to-text punctuates
  // questions, so count them per side. Whoever asks the questions is in control
  // of the conversation (Neal, 25 Sep); the model grades control with this in hand.
  const countQ = (who) => (row.transcript || []).filter((t) => t.who === who)
    .reduce((n, t) => n + (String(t.text || '').match(/\?/g) || []).length, 0)
  const questions = { rep: countQ('rep'), homeowner: countQ('homeowner') }
  // THE HOMEOWNER ASKED, THE REP JUST ANSWERED = control handed over (Neal,
  // 25 Sep). For every homeowner turn with a question in it, did the rep's next
  // turn ask one back? Counted here so the grade can't wave it through.
  const turns = (row.transcript || []).filter((t) => t.who === 'rep' || t.who === 'homeowner')
  const handovers = []
  let answeredWithQ = 0
  turns.forEach((t, i) => {
    if (t.who !== 'homeowner' || !String(t.text || '').includes('?')) return
    const reply = turns.slice(i + 1).find((x) => x.who === 'rep')
    if (!reply) return
    if (String(reply.text || '').includes('?')) answeredWithQ++
    else handovers.push({ homeowner: String(t.text).slice(0, 200), rep: String(reply.text).slice(0, 200) })
  })
  questions.answered_with_question = answeredWithQ
  questions.just_answered = handovers.length
  const notReached = rng && reached < rng[1] ? `Slides ${reached + 1}–${rng[1]}${rng[1] >= 23 ? ' and the close' : ''}` : ''

  const prompt = `You are an encouraging, honest sales trainer at U.S. Shingle, a Florida roofing company. Grade a rep's practice ${section.door ? 'FRONT-DOOR PITCH for a free roof inspection (a homeowner who did not expect them, standing in the doorway; the goal is a yes to the free inspection)' : 'IN-HOME PRESENTATION (kitchen table, both spouses present)'}.

HOW WE SELL: question-based selling. It is a conversation, not a script. The rep's job on each part is to BRING OUT ITS POINTS so the homeowner understands and agrees with them, ideally by asking questions that let the homeowner get there themselves. Every homeowner is different, so the order, the wording and the route will differ every time.

SO GRADE ON POINTS, NOT WORDS:
- A point is COVERED if the homeowner clearly got the idea, however the rep said it: their own words, a story, a question, any order, even out of the slide it belongs to.
- NEVER mark anything down for not matching the script's wording. Do not quote script lines at the rep as "what you should have said" unless they missed the point entirely.
- DO flag facts that are WRONG (a wrong statistic, coverage amount, warranty term, price promise). The script below is the source of the facts, not of the wording.
- CONTROL OF THE CONVERSATION is graded on its own and weighs heavily in the score. The person asking the questions is the person in control. A rep in control asks, listens, and steers the homeowner to each point; a rep who spends the meeting answering and defending while the homeowner fires questions has lost control, even if every point was covered. Counted questions in this transcript: REP ${questions.rep}, HOMEOWNER ${questions.homeowner}. Use the count, but judge it: a tie-down counts as control.
- WHEN THE HOMEOWNER ASKS A QUESTION, the rep must answer it and then take control back WITH A QUESTION of their own (or answer a question with a question). A rep who just answers, with no question back, has GIVEN UP CONTROL, and that must cost them on the control score. Of the homeowner's ${questions.answered_with_question + questions.just_answered} question turns, the rep came back with a question ${questions.answered_with_question} times and just answered ${questions.just_answered} times. The just-answered ones (homeowner, then the rep's reply):
${handovers.slice(0, 12).map((h, i) => `  ${i + 1}. HOMEOWNER: ${h.homeowner}\n     REP: ${h.rep}`).join('\n') || '  (none)'}
  Use these for "lost_moments", each with the question the rep should have come back with.
- OBJECTIONS are judged ONLY by the company's method:
${OBJECTION_METHOD}
  An objection is handled "well" only when all four steps happen. PARKING a concern that belongs to a later slide is the RIGHT move (it keeps control); never mark a rep down for not answering it on the spot. But a parked concern the rep never came back to, once they reached that part, is a miss. Answering early by jumping ahead to later material is a control mistake.
- Reward: good questions, tie-downs that get agreement, using what the homeowner said in the survey later (their insurance cost, electric bill, forever home, allergies), adapting to this personality, handling objections, keeping control of the conversation without being rude, and a professional tone.

WHAT WAS PRACTICED: ${section.label}.${rng ? ' The warm-up and customer survey were ALREADY DONE before this started (the homeowner has answered them); never grade or mention them as missing. The rep may still use what the homeowner told them in the survey.' : ''}${notReached ? ` The run ended at slide ${reached}: ${notReached} were NOT REACHED. Do not grade them, list them, or count them against the score; judge the parts that were reached.` : ''} Grade only the parts listed in THE POINTS; nothing outside them.

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

Score = roughly HALF how well the points landed, HALF who controlled the conversation (plus handling of objections and tone). 90+ = ready for a real kitchen table, 75-89 = close, 60-74 = needs work, under 60 = go back and practice. Per part, 10/10 means every point landed with the homeowner; words do not matter. Be specific and quote the rep. For "say instead" on an objection, give a natural, question-led way to handle it (the script's approach where it has one). Write in plain, direct language a trainer can read out to the rep.`

  try {
    const report = await geminiJson(prompt, REPORT_SCHEMA)
    const score = Math.max(0, Math.min(100, Math.round(Number(report.score) || 0)))
    if (notReached) report.not_reached = notReached
    report.questions = questions
    await sb.from('sales_practice_sessions').update({ grade_status: 'done', grade_error: null, score, report: withCost(report, row.report) }).eq('id', body.id)
  } catch (e) {
    await fail(e.message || 'grading failed')
  }
}
