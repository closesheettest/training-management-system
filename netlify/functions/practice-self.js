// Sales Training Customer, REP SELF-SERVE (Neal, 2026-10-09): reps practice whenever they want from their
// own Personal Dashboard (CCG ?mode=rep). "Stupid easy": the dashboard already knows who they are, so they only
// pick a LEVEL (very easy → very hard) and WHAT (one slide / the control drill / the full presentation). They
// never pick the homeowner — one is drawn at random from the level. All rep practice together is capped at
// $100 a week (Mon–Sun, Eastern); trainer sessions in class don't count toward it.
//
// Identity: the rep's Personal Dashboard session (CCG rep-pin), checked with CCG on every call.
//
// POST { session, action:'status' }                         → { ok, name, open, spent, cap, slides }
// POST { session, action:'start', level, what, slide? }     → { ok, token }   then open /practice/<token>
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'crypto'
import { json } from './_practice-auth.js'
import { PERSONAS } from '../../src/lib/salesPractice.js'

const CCG = 'https://free-roof-inspections.netlify.app/.netlify/functions'
const WEEK_CAP = 100                 // dollars, all reps together
const HOURS = 3                      // a self-serve link is for now, not for later
const LEVELS = ['Very easy', 'Easy', 'Medium', 'Hard', 'Very hard']

// The slides a rep can pick: the same Slide Points list the trainer's one-slide picker uses (training_days rows
// whose subject is "Slide N"), in order. Slide 12 (Permalock) isn't offered any more.
async function slideList(sb) {
  const { data } = await sb.from('training_days').select('title, subject').order('position')
  const out = [], seen = new Set()
  for (const d of data || []) {
    const m = String(d.subject || '').trim().match(/^Slides?\s*(\d+)/); if (!m) continue
    const n = parseInt(m[1], 10); if (n === 12 || seen.has(n)) continue
    seen.add(n); out.push({ n, title: String(d.title || '').slice(0, 60) })
  }
  return out
}

// Monday 00:00 Eastern, as an ISO string.
function weekStartIso() {
  const now = new Date()
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const back = (et.getDay() + 6) % 7
  const offsetMs = now.getTime() - et.getTime()      // ET → UTC
  const mon = new Date(et.getFullYear(), et.getMonth(), et.getDate() - back)
  return new Date(mon.getTime() + offsetMs).toISOString()
}

async function whoIs(session) {
  if (!session) return null
  const r = await fetch(`${CCG}/rep-pin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'check', session }) }).then((x) => x.json()).catch(() => null)
  return r?.ok && r.jnid ? { jnid: String(r.jnid) } : null
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' })
  let body
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { ok: false, error: 'bad JSON' }) }
  const who = await whoIs(String(body.session || ''))
  if (!who) return json(401, { ok: false, error: 'Open this from your Personal Dashboard.' })
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  const { data: t } = await sb.from('trainees').select('id, first_name, last_name, class_id')
    .eq('jobnimbus_id', who.jnid).order('created_at', { ascending: false }).limit(1).maybeSingle()
  const name = t ? `${t.first_name || ''} ${t.last_name || ''}`.trim() : ''

  // What rep self-practice has cost this week (talk + grading, saved on each run).
  const { data: wk } = await sb.from('sales_practice_sessions').select('report')
    .gte('created_at', weekStartIso()).filter('report->invite->>self', 'eq', 'true')
  const spent = Math.round((wk || []).reduce((n, r) => n + (Number(r.report?.cost) || 0), 0) * 100) / 100
  const open = spent < WEEK_CAP

  const SLIDES = await slideList(sb)
  if (body.action === 'status') return json(200, { ok: true, name: name || null, open, spent, cap: WEEK_CAP, slides: SLIDES, levels: LEVELS })

  if (body.action === 'start') {
    if (!open) return json(429, { ok: false, error: 'Practice is full for this week. It opens again Monday.' })
    if (!name) return json(400, { ok: false, error: "Your name isn't set up for practice yet. Ask your manager." })
    const level = LEVELS.includes(body.level) ? body.level : null
    if (!level) return json(400, { ok: false, error: 'Pick a level.' })
    let section
    if (body.what === 'full') section = 'full'
    else if (body.what === 'slide' || body.what === 'control') {
      const n = parseInt(body.slide, 10)
      if (!SLIDES.some((s) => s.n === n)) return json(400, { ok: false, error: 'Pick a slide.' })
      section = `${body.what}:${n}`
    } else return json(400, { ok: false, error: 'Pick what to practice.' })
    const pool = PERSONAS.filter((p) => p.difficulty === level)
    const persona = pool[Math.floor(Math.random() * pool.length)] || PERSONAS[0]
    const token = randomBytes(18).toString('base64url')
    const { error } = await sb.from('sales_practice_sessions').insert({
      trainee_id: t?.id || null, trainee_name: name, class_id: t?.class_id || null,
      trainer_name: 'Self practice', persona_key: persona.key, section,
      grade_status: 'invited', transcript: [],
      report: { invite: { token, self: true, jnid: who.jnid, level, expires_at: new Date(Date.now() + HOURS * 3600 * 1000).toISOString(), sent_by: 'Self practice' } },
    })
    if (error) return json(500, { ok: false, error: error.message })
    return json(200, { ok: true, token })
  }
  return json(400, { ok: false, error: 'unknown action' })
}
