// _effort.js — "did they show the effort?" (Neal, 2026-10-04). Week B needs an AVERAGE OF 30 DOORS A
// DAY on DoorDispatcher across Week A's field days (Thu, Fri, Sat). A door = a distinct pin they
// visited or set a status on that day (the same count the rep attendance report uses).
// Trainees use the map through a CCG sales_reps row (harvest_level 'trainee'), matched to TMS by
// phone, then by name — the same matching the CCG trainee-access grant uses.
// Env: CCG_SUPABASE_URL, CCG_SUPABASE_SECRET_KEY.
import { createClient } from '@supabase/supabase-js'

export const EFFORT_DOORS = 30
const ccg = () => createClient(process.env.CCG_SUPABASE_URL, process.env.CCG_SUPABASE_SECRET_KEY)
const digits = (p) => String(p || '').replace(/\D/g, '').slice(-10)
const nameKey = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '')
const etDay = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const etMidnightUtc = (day) => { const g = new Date(`${day}T12:00:00Z`); const off = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' }).formatToParts(g).find((x) => x.type === 'timeZoneName')?.value.match(/GMT([+-]\d+)/); return new Date(Date.parse(`${day}T00:00:00Z`) - (off ? Number(off[1]) : -4) * 3600000).toISOString() }
export const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10)

// Their map token(s): every CCG sales_reps row that is them (phone or name).
async function tokensFor(c, t) {
  const { data } = await c.from('sales_reps').select('name, phone, harvest_token').not('harvest_token', 'is', null)
  const ph = digits(t.phone), nm = nameKey(`${t.first_name} ${t.last_name}`)
  return (data || []).filter((r) => (ph && digits(r.phone) === ph) || nameKey(r.name) === nm).map((r) => r.harvest_token)
}

// Doors per day for one trainee over the given ET days → { perDay:{day:n}, total, average }
export async function doorsFor(t, days) {
  const c = ccg()
  const toks = await tokensFor(c, t)
  const perDay = Object.fromEntries(days.map((d) => [d, 0]))
  if (toks.length && days.length) {
    const from = etMidnightUtc(days[0]), to = etMidnightUtc(addDays(days[days.length - 1], 1))
    const { data } = await c.from('canvass_activity').select('pin_id, created_at').in('rep_token', toks).in('kind', ['visit', 'status']).gte('created_at', from).lt('created_at', to).limit(20000)
    const seen = {}
    for (const a of data || []) { if (!a.pin_id) continue; const d = etDay(Date.parse(a.created_at)); if (!(d in perDay)) continue; (seen[d] = seen[d] || new Set()).add(a.pin_id) }
    for (const d of Object.keys(seen)) perDay[d] = seen[d].size
  }
  const total = Object.values(perDay).reduce((a, b) => a + b, 0)
  return { perDay, total, average: days.length ? Math.round((total / days.length) * 10) / 10 : 0, linked: toks.length > 0 }
}

// Week A field days for a class that started on `start` (Mon): Thu, Fri, Sat.
export const weekAFieldDays = (start) => [addDays(start, 3), addDays(start, 4), addDays(start, 5)]
