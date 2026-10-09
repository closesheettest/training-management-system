// THE AUDIO REPORT (Neal, 2026-10-09: "no sales rep and no manager is going to read that very, very long report").
// When a practice is graded, two short spoken summaries are made from the report and saved as audio:
//   • rep     (~60–90 s) — the encouragement the rep already sees, said out loud: what went well, the 2–3 things to
//                          take to the next level, the one practice to do next. No score, no negatives.
//   • manager (~60 s)    — the coaching plan: the one thing to work on, what practice to assign, what to watch on a
//                          ride-along, and the score.
// A text model writes each script, Google's text-to-speech reads it, and the WAV goes to the private
// practice-audio bucket (report.audio.{rep,manager} = storage path). Pages fetch a short-lived signed link.
// Its cost is added to the run's cost (so a rep's own practice counts toward the weekly $100).
//
// POST { id, secret }   (called by practice-grade-background after a grade; secret = CRON_SECRET)
import { createClient } from '@supabase/supabase-js'
import { personaByKey, sectionByKey } from '../../src/lib/salesPractice.js'

const BUCKET = 'practice-audio'
const TTS_MODELS = () => [...new Set([process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts', 'gemini-2.5-flash-preview-tts'])]
const TEXT_MODELS = () => [...new Set([process.env.GEMINI_TEXT_MODEL || 'gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-flash-latest'])]
// USD per 1M tokens. Text = the grader's Flash price; speech = Google's TTS output price (audio tokens). Estimates
// for the weekly cap — check Cloud Billing for the real bill.
const PRICE = { textIn: 0.75, textOut: 3.75, ttsIn: 0.5, ttsOut: 10.0 }
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))
const key = () => process.env.GEMINI_API_KEY

async function gemini(model, body) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST', headers: { 'x-goog-api-key': key(), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  return { r, j, busy: r.status === 429 || r.status >= 500 || /demand|overload|unavailable|try again/i.test(j.error?.message || '') }
}

async function writeScripts(prompt, cost) {
  let last = ''
  for (const model of TEXT_MODELS()) for (const wait of [0, 8000, 25000]) {
    if (wait) await sleep(wait)
    const { r, j, busy } = await gemini(model, {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json', temperature: 0.4,
        responseSchema: { type: 'OBJECT', properties: { rep: { type: 'STRING' }, manager: { type: 'STRING' } }, required: ['rep', 'manager'] },
      },
    })
    if (r.ok) {
      const u = j.usageMetadata || {}
      cost.usd += ((u.promptTokenCount || 0) * PRICE.textIn + ((u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0)) * PRICE.textOut) / 1e6
      return JSON.parse((j.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join(''))
    }
    last = `${model}: ${j.error?.message || r.status}`
    if (!busy) break
  }
  throw new Error(`script: ${last}`)
}

// Text → 16-bit PCM (24 kHz mono) → WAV bytes.
async function speak(text, voice, cost) {
  let last = ''
  for (const model of TTS_MODELS()) for (const wait of [0, 8000, 25000]) {
    if (wait) await sleep(wait)
    const { r, j, busy } = await gemini(model, {
      contents: [{ parts: [{ text }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
    })
    const part = (j.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data)
    if (r.ok && part) {
      const u = j.usageMetadata || {}
      cost.usd += ((u.promptTokenCount || 0) * PRICE.ttsIn + (u.candidatesTokenCount || 0) * PRICE.ttsOut) / 1e6
      const rate = parseInt((String(part.inlineData.mimeType || '').match(/rate=(\d+)/) || [])[1], 10) || 24000
      return wav(Buffer.from(part.inlineData.data, 'base64'), rate)
    }
    last = `${model}: ${j.error?.message || (r.ok ? 'no audio returned' : r.status)}`
    if (!busy && !r.ok) break
  }
  throw new Error(`voice: ${last}`)
}

function wav(pcm, rate) {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12)
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24)
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}

function promptFor(row) {
  const r = row.report || {}, first = String(row.trainee_name || 'the rep').split(/\s+/)[0]
  const persona = personaByKey(row.persona_key), sec = sectionByKey(row.section)
  const missed = (r.parts || []).flatMap((p) => (p.missed || []).map((m) => `${p.part}: ${m}`)).slice(0, 8)
  return `You write two SHORT spoken audio summaries of a sales-practice run at U.S. Shingle & Metal (a Florida roofing company). They will be read aloud by a text-to-speech voice, so write how a person talks: short sentences, no lists, no symbols, no headings, no markdown, numbers as words where natural. Don't read out slide numbers in a robotic way ("slide six" is fine).

THE RUN: ${first} practiced "${sec.label}" with an AI homeowner (${persona.name}, ${persona.difficulty}, ${persona.tagline}).
${r.drill ? 'It was the CONTROL DRILL: the homeowner kept asking questions; the skill is keeping control (answer short, lead back with a question, park what does not belong on this slide).' : ''}

FOR THE REP (what they were already told in writing):
${JSON.stringify(r.encouragement || {})}
Points they didn't get to: ${JSON.stringify(missed)}

FOR THE MANAGER:
Score: ${row.score ?? 'n/a'} out of 100. Summary: ${r.summary || ''}
Coaching plan: ${JSON.stringify(r.manager_plan || {})}

Write:
"rep": spoken TO ${first}, warm and encouraging, like a good coach in the car after a call. 130 to 190 words (about a minute). Open with one specific thing they did well, then the two or three things to take it to the next level (each with the angle to try, from the level_up points), then the ONE practice to do next. NEVER say a score, grade, number out of 100, "missed", "wrong", "failed" or "poorly". End with one short encouraging line.
"manager": spoken to ${first}'s MANAGER, direct and practical. 110 to 160 words. Say the score, the one thing ${first} most needs to work on, the practice to assign and why, and what to watch for on the next ride-along. No fluff.`
}

export const handler = async (event) => {
  let body
  try { body = JSON.parse(event.body || '{}') } catch { return { statusCode: 400 } }
  if (!process.env.CRON_SECRET || body.secret !== process.env.CRON_SECRET) return { statusCode: 401 }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const { data: row } = await sb.from('sales_practice_sessions').select('*').eq('id', body.id).maybeSingle()
  if (!row || row.grade_status !== 'done' || !row.report) return { statusCode: 200 }

  const mark = async (audio) => {
    const { data: cur } = await sb.from('sales_practice_sessions').select('report').eq('id', row.id).maybeSingle()
    await sb.from('sales_practice_sessions').update({ report: { ...(cur?.report || {}), audio } }).eq('id', row.id)
  }
  try {
    await sb.storage.createBucket(BUCKET, { public: false }).catch(() => {})
    const cost = { usd: 0 }
    const scripts = await writeScripts(promptFor(row), cost)
    const out = { made_at: new Date().toISOString(), scripts }
    for (const [who, voice] of [['rep', 'Charon'], ['manager', 'Kore']]) {
      const bytes = await speak(String(scripts[who] || '').slice(0, 2500), voice, cost)
      const path = `${row.id}/${who}-${Date.now()}.wav`
      const { error } = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: 'audio/wav', upsert: true })
      if (error) throw new Error(`upload: ${error.message}`)
      out[who] = path
    }
    out.cost = Math.round(cost.usd * 10000) / 10000
    // Add it to the run's cost, so rep self-practice audio counts toward the weekly cap.
    const { data: cur } = await sb.from('sales_practice_sessions').select('report').eq('id', row.id).maybeSingle()
    const rep = cur?.report || {}
    await sb.from('sales_practice_sessions').update({ report: { ...rep, audio: out, cost: Math.round(((Number(rep.cost) || 0) + cost.usd) * 10000) / 10000 } }).eq('id', row.id)
  } catch (e) {
    await mark({ error: String(e.message || e).slice(0, 300), made_at: new Date().toISOString() })
  }
  return { statusCode: 200 }
}
