// cron-week-b-probation.js — the Week B second chance (Neal, 2026-10-04). A trainee turned away from
// Week B for not averaging 30 doors a day was told: "average 30 a day Monday–Friday this week and
// you'll be automatically enrolled in next week's Week B." Every Saturday morning this checks them:
//   made it → moved into the class whose Week B starts Monday (the class that was in Week A this
//             week), let into Week B (week_b_force), and sent their Week B link by text AND email;
//   didn't  → recorded as not qualified (no message).
// Records live in app_settings week_b_probation { trainee_id: { week_monday, from_class, … } }.
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY (+ CCG_* via _effort, GHL/Resend via the senders).
import { createClient } from '@supabase/supabase-js'
import { doorsFor, EFFORT_DOORS, addDays } from './_effort.js'
import { sendSmsViaGhl } from './_ghl.js'
import { sendEmail } from './_email.js'

const SITE = 'https://trainingmanagementsys.netlify.app'
const etDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

export const handler = async () => {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const get = async (k) => { const { data } = await sb.from('app_settings').select('value').eq('key', k).maybeSingle(); try { return data ? JSON.parse(data.value) : null } catch { return null } }
  const prob = (await get('week_b_probation')) || {}
  const rooms = (await get('meet_rooms')) || []
  const wkB = rooms.find((r) => r.kind === 'training' && r.training_week === 'B')
  const today = etDay(), results = []
  for (const [tid, p] of Object.entries(prob)) {
    if (p.result) continue
    const friday = addDays(p.week_monday, 4)
    if (today <= friday) continue
    if (!p.committed_at) { p.result = 'did_not_commit'; continue } // never clicked "I still want it" — gone
    const { data: t } = await sb.from('trainees').select('id, first_name, last_name, phone, email, registration_token').eq('id', tid).maybeSingle()
    if (!t) { p.result = 'gone'; continue }
    const eff = await doorsFor(t, [0, 1, 2, 3, 4].map((k) => addDays(p.week_monday, k)))
    p.week_avg = eff.average; p.checked_at = new Date().toISOString()
    if (eff.average !== null && eff.average < EFFORT_DOORS) { p.result = 'did_not_qualify'; results.push(`${t.first_name}: ${eff.average} — not enough`); continue }
    const { data: cl } = await sb.from('classes').select('id, week_start_date').eq('week_start_date', p.week_monday).is('cancelled_at', null).limit(1).maybeSingle()
    if (!cl) { p.result = 'no_class'; results.push(`${t.first_name}: qualified but no class found`); continue }
    await sb.from('trainees').update({ class_id: cl.id, rescheduled_from_class_id: p.from_class || null, week_b_force: true, enrolled: true }).eq('id', tid)
    p.result = 'enrolled'; p.class_id = cl.id
    const monday = new Date(Date.parse(`${addDays(p.week_monday, 7)}T12:00:00Z`)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' })
    const link = wkB ? `${SITE}/meet/${wkB.slug}?t=${t.registration_token}` : ''
    const msg = `${t.first_name}, you showed the effort: ${eff.average} doors a day this week. You're enrolled in Week B training starting ${monday}.${link ? ` Your link (yours only, use it every day): ${link}` : ''} Be on time.`
    try { if (t.phone) await sendSmsViaGhl(t.phone, msg, { firstName: t.first_name, lastName: t.last_name }) } catch { /* email still goes */ }
    try { if (t.email) await sendEmail(t.email, `You're in: Week B training starts ${monday}`, msg) } catch { /* logged below */ }
    results.push(`${t.first_name}: ${eff.average} — ENROLLED`)
  }
  await sb.from('app_settings').upsert({ key: 'week_b_probation', value: JSON.stringify(prob), updated_at: new Date().toISOString() }, { onConflict: 'key' })
  return { statusCode: 200, body: JSON.stringify({ ok: true, results }) }
}

export const config = { schedule: '0 14 * * 6' }
