// netlify/functions/_junior-promote.js
//
// JUNIOR → SENIOR, AUTOMATICALLY (Neal, 2026-11-02: "auto-promote Junior to Senior when all three are met";
// passing grade "80 or higher"). The plan agreed 2026-10-19: a junior becomes a senior (which turns on IQ leads)
// once they have
//   1. a passing practice grade: a FULL presentation run in Sales Practice whose presentation score (slide
//      points, report.points_score) is 80 or higher. Any one passing run counts.
//   2. 10 of the inspections they signed actually inspected (CCG: has a result, not cancelled).
//   3. 3 ride-alongs with a senior that SAT. A no-sit of any kind doesn't count; an appointment nobody has
//      statused yet stays "waiting" until it is.
// Then Neal and the junior's manager get a text.
//
// Ride-alongs are tracked here, not in JobNimbus: the manager adds a junior to a senior's appointment on the
// dashboard (Assign appointments → Today). Stored in app_settings 'junior_ride_alongs' as { items: [...] }
// (no new table needed). Appointment outcomes and inspected counts come from CCG (it holds the JobNimbus key
// and the inspections table) through manager-records-api 'junior-progress'.

export const PASS_GRADE = 80
export const NEED_INSPECTED = 10
export const NEED_RIDES = 3
const KEY = 'junior_ride_alongs'

const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v)

export async function loadRides(supabase) {
  const { data } = await supabase.from('app_settings').select('value').eq('key', KEY).maybeSingle()
  const v = data ? parse(data.value) : null
  return Array.isArray(v?.items) ? v.items : []
}

// Read-modify-write on a FRESH read, so a manager's add and the nightly check don't overwrite each other.
export async function updateRides(supabase, fn) {
  const items = fn(await loadRides(supabase))
  const { error } = await supabase.from('app_settings').upsert({ key: KEY, value: JSON.stringify({ items }), updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw new Error(error.message)
  return items
}

// Juniors in a zone (or every zone when region is null), active reps only.
export async function loadJuniors(supabase, region) {
  let q = supabase.from('trainees')
    .select('id, first_name, last_name, phone, jobnimbus_id, region, rep_level, is_active_sales_rep, dropped_out_at')
    .eq('rep_level', 'junior').eq('is_active_sales_rep', true).is('dropped_out_at', null)
  if (region) q = q.eq('region', region)
  const { data } = await q
  return (data || []).map((t) => ({ ...t, name: `${t.first_name || ''} ${t.last_name || ''}`.trim() }))
}

// Best full-presentation score per trainee.
async function bestPractice(supabase, ids) {
  const best = {}
  if (!ids.length) return best
  const { data } = await supabase.from('sales_practice_sessions')
    .select('trainee_id, score, report, started_at').in('trainee_id', ids).eq('grade_status', 'done').eq('section', 'full')
  for (const r of data || []) {
    const pts = r.report?.points_score
    const s = Number.isFinite(Number(pts)) && pts != null ? Number(pts) : null
    if (s == null) continue
    if (!best[r.trainee_id] || s > best[r.trainee_id].score) best[r.trainee_id] = { score: s, at: r.started_at }
  }
  return best
}

// ccg(payload) → { status, body } (regional-manager-api's ccgRecordsApi bound to a zone).
// Refreshes outcomes of ride-alongs whose appointment is 2+ hours past, then returns each junior's progress.
export async function juniorProgress(supabase, region, ccg) {
  const juniors = await loadJuniors(supabase, region)
  const ids = new Set(juniors.map((j) => j.id))
  let rides = (await loadRides(supabase)).filter((r) => ids.has(r.junior_id))
  const due = rides.filter((r) => r.outcome === 'pending' && r.jn_job_id && new Date(r.appt_at).getTime() < Date.now() - 2 * 3600e3)
  const jnIds = juniors.map((j) => j.jobnimbus_id).filter(Boolean)
  const { body } = await ccg({ action: 'junior-progress', job_ids: due.map((r) => r.jn_job_id), jn_ids: jnIds })
  const outcomes = body?.outcomes || {}, inspected = body?.inspected || {}
  const changed = due.filter((r) => outcomes[r.jn_job_id] && outcomes[r.jn_job_id].outcome !== 'pending')
  if (changed.length) {
    const byId = Object.fromEntries(changed.map((r) => [r.id, outcomes[r.jn_job_id]]))
    const all = await updateRides(supabase, (items) => items.map((x) => (byId[x.id] && x.outcome === 'pending'
      ? { ...x, outcome: byId[x.id].outcome, status: byId[x.id].status, checked_at: new Date().toISOString() } : x)))
    rides = all.filter((r) => ids.has(r.junior_id))
  }
  const practice = await bestPractice(supabase, [...ids])
  return juniors.map((j) => {
    const mine = rides.filter((r) => r.junior_id === j.id).sort((a, b) => String(b.appt_at).localeCompare(String(a.appt_at)))
    const sat = mine.filter((r) => r.outcome === 'sat').length
    const p = practice[j.id] || null
    const insp = j.jobnimbus_id ? (inspected[j.jobnimbus_id] ?? null) : null
    return {
      id: j.id, name: j.name, phone: j.phone, jobnimbus_id: j.jobnimbus_id, region: j.region,
      practice: p ? p.score : null, practice_ok: !!p && p.score >= PASS_GRADE,
      inspected: insp, inspected_ok: insp != null && insp >= NEED_INSPECTED,
      rides_sat: sat, rides_ok: sat >= NEED_RIDES, rides: mine,
      ready: !!p && p.score >= PASS_GRADE && insp != null && insp >= NEED_INSPECTED && sat >= NEED_RIDES,
    }
  })
}

// Make them a senior (TMS rep_level, confirmed → IQ leads on), flip CCG's map tag, text Neal + their manager.
export async function promote(supabase, j, ccg, sendSms) {
  const { data: done, error } = await supabase.from('trainees')
    .update({ rep_level: 'senior', rep_level_confirmed_at: new Date().toISOString() }).eq('id', j.id).eq('rep_level', 'junior').select('id')
  if (error) throw new Error(error.message)
  if (!done?.length) return null   // someone else already promoted them: no second text
  if (j.jobnimbus_id) await ccg({ action: 'junior-promoted', jnid: j.jobnimbus_id }).catch(() => {})
  const { data: mgrs } = await supabase.from('trainees').select('first_name, phone').eq('managed_region', j.region)
  const msg = `🎉 ${j.name} is now a SENIOR rep (auto-promoted): practice ${j.practice}, ${j.inspected} inspections inspected, ${j.rides_sat} ride-alongs that sat. IQ leads are on for them.`
  const phones = new Set([process.env.NEAL_PHONE || '7275037017', ...(mgrs || []).map((m) => m.phone)].filter(Boolean).map((p) => String(p).replace(/\D/g, '').slice(-10)))
  for (const ph of phones) await sendSms(ph, msg).catch(() => {})
  return msg
}
