// netlify/functions/junior-promote-check.js
//
// NIGHTLY JUNIOR → SENIOR CHECK (Neal, 2026-11-02). Worker for cron-junior-promote (Netlify 403s HTTP calls to a
// scheduled function, so the schedule lives in that thin wrapper and this stays callable by hand).
// For every zone with juniors: refresh their ride-along outcomes from JobNimbus, and promote anyone who now has
// all three (practice 80+, 10 inspected, 3 ride-alongs that sat). Rules and texts: _junior-promote.js.
// GET ?dry=1 → only reports, promotes nobody.
import { createClient } from '@supabase/supabase-js'
import { juniorProgress, promote, loadJuniors } from './_junior-promote.js'
import { sendSmsViaGhl } from './_ghl.js'

const CCG_SB_URL = process.env.CCG_SUPABASE_URL
const CCG_SB_KEY = process.env.CCG_SUPABASE_ANON_KEY
const CCG_BOARD_URL = process.env.CCG_BOARD_URL || 'https://free-roof-inspections.netlify.app'

// Same as regional-manager-api's ccgRecordsApi: CCG's manager-records-api, signed in with the zone's board token.
async function ccgFor(zone) {
  const r = await fetch(`${CCG_SB_URL}/rest/v1/regional_managers?zone=eq.${encodeURIComponent(zone)}&select=token&limit=1`, { headers: { apikey: CCG_SB_KEY, Authorization: `Bearer ${CCG_SB_KEY}` } })
  const tok = r.ok ? (await r.json())[0]?.token : null
  return async (payload) => {
    if (!tok) return { status: 502, body: { ok: false, error: 'No CCG board for this zone' } }
    const x = await fetch(`${CCG_BOARD_URL}/.netlify/functions/manager-records-api`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, token: tok }) })
    return { status: x.status, body: await x.json().catch(() => ({})) }
  }
}

export const handler = async (event) => {
  const dry = event.queryStringParameters?.dry === '1'
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const zones = [...new Set((await loadJuniors(sb, null)).map((j) => j.region).filter(Boolean))]
  const out = []
  for (const zone of zones) {
    const ccg = await ccgFor(zone)
    const list = await juniorProgress(sb, zone, ccg)
    for (const j of list) {
      let promoted = false
      if (j.ready && !dry) promoted = !!(await promote(sb, j, ccg, (ph, m) => sendSmsViaGhl(ph, m)).catch(() => null))
      out.push({ zone, name: j.name, practice: j.practice, inspected: j.inspected, rides_sat: j.rides_sat, ready: j.ready, promoted })
    }
  }
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, dry, juniors: out }) }
}
