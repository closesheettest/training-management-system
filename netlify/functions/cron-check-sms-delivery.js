// cron-check-sms-delivery.js
//
// Safety net for the "GoHighLevel accepted the text but the carrier silently
// dropped it" case — exactly what happened to Lisa's Day 1 homework. When we
// send homework we record the GHL message id; this cron asks GHL whether each
// one actually DELIVERED, and texts the admins about any that didn't.
//
// For each recent homework send not yet resolved:
//   • delivered / read              → mark resolved, no alert
//   • undelivered / failed / etc.   → mark resolved + ALERT admins
//   • still queued/sent after the   → treat as not delivered + ALERT
//     grace window (STALE_MIN)
//   • still pending within grace    → leave for the next run
//
// Idempotent: once a send is resolved (status stored) it's never re-checked or
// re-alerted, so admins get at most one text per dropped message.
//
// Schedule: every 15 min, 18:00–23:59 UTC (≈2–8 PM ET) — covers the homework
// dismissal window (2–4 PM ET) plus the grace period. Manual GET = dry run (no
// alerts) unless ?send=1; ?id=<messageId> just prints that message's raw status.
//
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN, GHL_LOCATION_ID.

import { createClient } from '@supabase/supabase-js'
import { getSmsStatus, sendSmsViaGhl } from './_ghl.js'
import { recipientsForEvent } from './_recipients.js'

const STALE_MIN = 25            // minutes after which a still-pending send is treated as failed
const LOOKBACK_HOURS = 6        // only inspect sends from the last few hours
const DELIVERED = ['delivered', 'read']
const FAILED = ['undelivered', 'failed', 'rejected', 'error', 'bounced']

export const handler = async (event) => {
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'GHL_PIT_TOKEN', 'GHL_LOCATION_ID']) {
    if (!process.env[k]) return json(500, { ok: false, error: `Missing env: ${k}` })
  }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const qp = (event && event.queryStringParameters) || {}
  const isManual = event && event.httpMethod === 'GET'
  const willAlert = isManual ? ['1', 'true', 'yes'].includes(String(qp.send || '').toLowerCase()) : true

  // Debug helper: ?id=<messageId> prints GHL's raw status for one message.
  if (qp.id) {
    const s = await getSmsStatus(qp.id)
    return json(200, { ok: true, debug: s })
  }

  const sinceIso = new Date(Date.now() - LOOKBACK_HOURS * 3600_000).toISOString()

  // Both training texts that carry a GHL message id: homework (afternoon) and
  // quiz (morning). Same delivery check for each.
  const KINDS = [
    { label: 'homework', idCol: 'homework_message_id', statusCol: 'homework_delivery_status', checkedCol: 'homework_delivery_checked_at', sentCol: 'homework_sent_at' },
    { label: 'quiz', idCol: 'quiz_message_id', statusCol: 'quiz_delivery_status', checkedCol: 'quiz_delivery_checked_at', sentCol: 'quiz_sent_at' },
  ]

  const checked = []
  const failures = []
  let inspected = 0
  for (const k of KINDS) {
    const { data: rows, error } = await supabase
      .from('training_day_attempts')
      .select(`id, trainee_id, day_number, ${k.sentCol}, ${k.idCol}, trainees(first_name, last_name, phone)`)
      .not(k.idCol, 'is', null)
      .is(k.statusCol, null)
      .gte(k.sentCol, sinceIso)
    if (error) return json(500, { ok: false, error: `${k.label}: ${error.message}` })
    inspected += (rows || []).length
    for (const r of (rows || [])) {
      const s = await getSmsStatus(r[k.idCol])
      if (!s.ok) { checked.push({ kind: k.label, id: r.id, lookup_error: s.error }); continue } // retry next run
      const status = s.status || ''
      const ageMin = (Date.now() - new Date(r[k.sentCol]).getTime()) / 60000

      let resolved = null   // final status to store, or null = leave pending
      let failed = false
      if (DELIVERED.includes(status)) resolved = status
      else if (FAILED.includes(status)) { resolved = status; failed = true }
      else if (ageMin >= STALE_MIN) { resolved = status ? `stale:${status}` : 'stale:no_status'; failed = true }

      if (resolved == null) { checked.push({ kind: k.label, id: r.id, status, pending: true }); continue }

      await supabase.from('training_day_attempts')
        .update({ [k.statusCol]: resolved, [k.checkedCol]: new Date().toISOString() })
        .eq('id', r.id)

      const t = r.trainees || {}
      const who = `${t.first_name || ''} ${t.last_name || ''}`.trim() || 'a trainee'
      checked.push({ kind: k.label, id: r.id, who, status: resolved, failed })
      if (failed) failures.push({ kind: k.label, who, phone: t.phone || '(no phone)', day: r.day_number, status: resolved })
    }
  }

  // Alert admins about any non-delivery.
  let alerted = []
  if (failures.length && willAlert) {
    const lines = ['⚠️ Training text NOT delivered:']
    failures.forEach((f) => lines.push(`• Day ${f.day} ${f.kind} → ${f.who} (${f.phone}) — ${f.status}`))
    lines.push('', 'GHL accepted it but the carrier did not deliver — usually an SMS opt-out (DND) on their contact. Clear DND / have them text START, then resend.')
    const msg = lines.join('\n')

    let recipients = []
    try { recipients = (await recipientsForEvent(supabase, 'sms_delivery_failure', { legacyRole: 'admin' })).recipients || [] } catch { /* */ }
    for (const rc of recipients) {
      if (!rc.phone || rc.notify_via_sms === false) continue
      try { await sendSmsViaGhl(rc.phone, msg, { firstName: rc.name || 'Admin', lastName: '' }); alerted.push(rc.phone) } catch { /* best-effort */ }
    }
  }

  return json(200, {
    ok: true,
    inspected,
    failures: failures.length,
    alerted: willAlert ? alerted : 'dry-run',
    detail: checked,
  })
}

function json(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

// Every 15 min, 13:00–23:59 UTC (≈9 AM–7 PM ET) — covers the morning QUIZ send
// and the afternoon HOMEWORK send + their grace windows.
export const config = { schedule: '*/15 13-23 * * *' }
