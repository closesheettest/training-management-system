// cron-offboarding-reminder.js — daily 10 AM EDT nag until the cleanup
// list is empty.
//
// Every morning it finds reps still flagged for off-boarding cleanup
// (is_active_sales_rep = false, left_company_at set, cleanup_done_at NULL)
// and texts the cleanup crew ONE summary listing everyone still pending +
// the step-by-step link. Repeats daily until the list is clear — same
// "won't be ignored" pattern as the location-TBD reminder. Silent on days
// when nothing is pending.
//
// This is in ADDITION to the instant alert that fires the moment a rep is
// marked Quit / Fired (see _offboard-notify.js): instant notice, then a
// daily reminder so nobody sits un-scrubbed in GHL / Google / RepCard /
// JobNimbus / Sales Academy.
//
// Native Netlify scheduled function (export config.schedule). Permissive
// auth like the leaderboard/welcome crons: a WRONG secret is rejected, but
// scheduled runs (and no-secret calls) are allowed. Manual dry run:
//   GET /.netlify/functions/cron-offboarding-reminder?dry=1
//
// Required env: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN, GHL_LOCATION_ID.

import { createClient } from '@supabase/supabase-js'
import { recipientPhonesForEvent } from './_recipients.js'
import { sendSmsViaGhl } from './_ghl.js'

const OFFBOARD_GUIDE_URL = 'https://trainingmanagementsys.netlify.app/offboarding'

export const config = { schedule: '0 14 * * *' }

export const handler = async (event) => {
  const provided =
    event?.headers?.['x-cron-secret'] ||
    event?.headers?.['X-Cron-Secret'] ||
    event?.queryStringParameters?.secret
  if (provided && process.env.CRON_SECRET && provided !== process.env.CRON_SECRET) {
    return json(401, { error: 'Unauthorized' })
  }

  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'GHL_PIT_TOKEN', 'GHL_LOCATION_ID']) {
    if (!process.env[k]) return json(500, { error: `Missing env var: ${k}` })
  }

  const dry = event?.queryStringParameters?.dry === '1' || event?.queryStringParameters?.dry === 'true'
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  // Everyone still waiting to be cleared out of the outside systems.
  const { data: pending, error } = await supabase
    .from('trainees')
    .select('first_name, last_name, region, left_company_at')
    .eq('is_active_sales_rep', false)
    .not('left_company_at', 'is', null)
    .is('cleanup_done_at', null)
    .order('left_company_at', { ascending: true })
  if (error) return json(500, { error: error.message })

  if (!pending || pending.length === 0) {
    return json(200, { ok: true, pending: 0, sent: 0, note: 'Nothing pending — silent.' })
  }

  // Build a readable list: "• Jane Doe (Zone 2)".
  const lines = pending.map((r) => {
    const name = `${r.first_name || ''} ${r.last_name || ''}`.trim() || 'A rep'
    return `• ${name}${r.region ? ` (${r.region})` : ''}`
  })
  const n = pending.length
  const msg =
    `🚪 Off-boarding cleanup — ${n} rep${n === 1 ? '' : 's'} still need${n === 1 ? 's' : ''} removing from ` +
    `GHL, Google Workspace, RepCard, JobNimbus & Sales Academy:\n` +
    `${lines.join('\n')}\n` +
    `Steps: ${OFFBOARD_GUIDE_URL}`

  if (dry) {
    return json(200, { ok: true, dry: true, pending: n, names: lines, message: msg })
  }

  let sent = 0
  try {
    const { phones } = await recipientPhonesForEvent(supabase, 'rep_marked_offboarding', {
      legacyRole: 'admin',
    })
    for (const ph of phones) {
      await sendSmsViaGhl(ph, msg, { firstName: 'Off-boarding', lastName: 'Reminder' })
      sent++
    }
  } catch (e) {
    console.warn('cron-offboarding-reminder send failed:', e?.message || e)
  }

  return json(200, { ok: true, pending: n, sent })
}

function json(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) }
}
