// cron-onboarding-banking.js
//
// Daily chase for direct-deposit details.
//
// Banking is the one part of Day-1 paperwork people genuinely can't do on the
// spot — they don't have their account numbers on them. Neal's call: don't hold
// the class for it, take it later. So the signing page lets them skip it, and
// this nags them once a day, by TEXT AND EMAIL, until it's filled in.
//
// Who gets chased: anyone who has SIGNED their agreement but whose banking is
// still incomplete. Not chased before they've signed — they'd be getting two
// different "finish your paperwork" messages at once.
//
// Stops on its own the moment banking_completed_at is set. Gives up after
// MAX_REMINDERS so it never becomes an infinite nag; after that it's a
// conversation for the office.
//
// Schedule: daily 10:30 AM ET (14:30 UTC) — after the morning sends, well
// before the field day ends.
//
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN, GHL_LOCATION_ID,
//      RESEND_API_KEY, URL

import { createClient } from '@supabase/supabase-js'
import { sendSmsViaGhl } from './_ghl.js'
import { sendEmail } from './_email.js'

export const config = { schedule: '30 14 * * *' }

const MAX_REMINDERS = 14
const SITE = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://trainingmanagementsys.netlify.app'

export const handler = async (event) => {
  const params = (event && event.queryStringParameters) || {}
  const dryRun = params.dry_run === '1'
  if (event?.httpMethod === 'GET' && process.env.CRON_SECRET && params.secret !== process.env.CRON_SECRET) {
    return json(401, { ok: false, error: 'Unauthorized' })
  }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  const { data: rows, error } = await supabase
    .from('trainee_onboarding')
    .select('trainee_id, banking_reminded_at, banking_reminders_sent, trainees!trainee_id(first_name, phone, email, enrolled, declined_at, dropped_out_at, registration_token)')
    .is('banking_completed_at', null)
    .not('signed_at', 'is', null)
  if (error) return json(500, { ok: false, error: error.message })

  const now = Date.now()
  const due = (rows || []).filter((r) => {
    const t = r.trainees
    if (!t || t.enrolled === false || t.declined_at || t.dropped_out_at) return false
    if (!t.phone && !t.email) return false
    if ((r.banking_reminders_sent || 0) >= MAX_REMINDERS) return false
    // once a day, with a little slack so a cron that fires early still counts
    if (r.banking_reminded_at && now - new Date(r.banking_reminded_at).getTime() < 20 * 3600 * 1000) return false
    return true
  })

  if (dryRun) {
    return json(200, {
      ok: true, dry_run: true, due: due.length,
      people: due.map((r) => ({ name: r.trainees.first_name, reminders_so_far: r.banking_reminders_sent || 0 })),
    })
  }

  const results = []
  for (const r of due) {
    const t = r.trainees
    const link = `${SITE}/onboarding/${t.registration_token}`
    const msg =
      `Hi ${t.first_name || 'there'} — we still need your direct deposit details so U.S. Shingle can pay you. ` +
      `It takes a minute: ${link}`
    const channels = []
    if (t.email) {
      try {
        const e = await sendEmail(t.email, 'We still need your direct deposit details', msg)
        if (e && e.ok !== false) channels.push('email')
      } catch { /* keep going — SMS may still land */ }
    }
    if (t.phone) {
      try {
        const s = await sendSmsViaGhl(t.phone, msg)
        if (s && s.ok !== false) channels.push('sms')
      } catch { /* email may have landed */ }
    }
    if (channels.length) {
      await supabase.from('trainee_onboarding').update({
        banking_reminded_at: new Date().toISOString(),
        banking_reminders_sent: (r.banking_reminders_sent || 0) + 1,
      }).eq('trainee_id', r.trainee_id)
    }
    results.push({ name: t.first_name, channels })
  }

  return json(200, { ok: true, chased: results.length, results })
}

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}
