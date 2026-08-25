// sms-status.js
//
// DIAGNOSTIC (read-only). What did GoHighLevel actually do with a message?
//
// sendSmsViaGhl returning { ok: true } means GHL ACCEPTED the send, not that a
// phone received it. When Jennifer said she got nothing and the send had
// reported ok with a messageId, there was no way to tell "delivered and missed"
// from "never delivered" — cron-check-sms-delivery can do it but Netlify 403s
// any HTTP call to a scheduled function (Neal, 2026-08-25).
//
//   GET ?id=<messageId>   → { ok, status, raw }
//
// Env: GHL_PIT_TOKEN.

import { getSmsStatus } from './_ghl.js'

export const handler = async (event) => {
  const id = String((event.queryStringParameters || {}).id || '').trim()
  if (!id) return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'pass ?id=<messageId>' }) }
  const s = await getSmsStatus(id)
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s, null, 2) }
}
