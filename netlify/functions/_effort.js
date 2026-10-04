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

// Days they rode with William (CCG ride_alongs: rep_id "trainee:<tms id>", or their name) are
// TRAINING, not knocking — those days come out of the average (Neal, 2026-10-04).
async function rideDays(c, t, days) {
  const { data } = await c.from('ride_alongs').select('rep_id, rep_name, ride_date, refused_to_ride').gte('ride_date', days[0]).lte('ride_date', days[days.length - 1])
  const nm = nameKey(`${t.first_name} ${t.last_name}`)
  return new Set((data || []).filter((r) => !r.refused_to_ride && (r.rep_id === `trainee:${t.id}` || nameKey(r.rep_name) === nm)).map((r) => r.ride_date))
}

// Doors per day for one trainee over the given ET days, leaving out days with William →
// { perDay:{day:n}, rideDays:[…], counted, total, average (null when every day was a ride) }
export async function doorsFor(t, days) {
  const c = ccg()
  const rides = days.length ? await rideDays(c, t, days).catch(() => new Set()) : new Set()
  const toks = await tokensFor(c, t)
  const perDay = Object.fromEntries(days.map((d) => [d, 0]))
  if (toks.length && days.length) {
    const from = etMidnightUtc(days[0]), to = etMidnightUtc(addDays(days[days.length - 1], 1))
    const { data } = await c.from('canvass_activity').select('pin_id, created_at').in('rep_token', toks).in('kind', ['visit', 'status']).gte('created_at', from).lt('created_at', to).limit(20000)
    const seen = {}
    for (const a of data || []) { if (!a.pin_id) continue; const d = etDay(Date.parse(a.created_at)); if (!(d in perDay)) continue; (seen[d] = seen[d] || new Set()).add(a.pin_id) }
    for (const d of Object.keys(seen)) perDay[d] = seen[d].size
  }
  const counted = days.filter((d) => !rides.has(d))
  const total = counted.reduce((a, d) => a + (perDay[d] || 0), 0)
  return { perDay, rideDays: days.filter((d) => rides.has(d)), counted: counted.length, total, average: counted.length ? Math.round((total / counted.length) * 10) / 10 : null, linked: toks.length > 0 }
}

// Week A field days for a class that started on `start` (Mon): Thu, Fri, Sat.
export const weekAFieldDays = (start) => [addDays(start, 3), addDays(start, 4), addDays(start, 5)]
