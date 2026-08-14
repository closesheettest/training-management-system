// Scheduled WRAPPER — fires Fri 18:00 UTC (2 PM EDT / 1 PM EST) and triggers the
// Week B confirmation send by hitting send-week-b-confirmation.js's secured GET
// path. (send-week-b-confirmation is an HTTP function so the class-page button
// works — Netlify returns 403 for HTTP calls to a native scheduled function, so
// the two responsibilities are split.)
//
// Env: CRON_SECRET (shared with send-week-b-confirmation), URL/PUBLIC_SITE_URL.

export const config = { schedule: '0 18 * * 5' }

export const handler = async () => {
  const base = (process.env.PUBLIC_SITE_URL || process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://trainingmanagementsys.netlify.app').replace(/\/$/, '')
  const secret = process.env.CRON_SECRET
  if (!secret) return json(500, { ok: false, error: 'CRON_SECRET not set' })
  try {
    const r = await fetch(`${base}/.netlify/functions/send-week-b-confirmation?secret=${encodeURIComponent(secret)}`)
    const body = await r.json().catch(() => ({}))
    return json(200, { ok: true, triggered: true, downstream: body })
  } catch (e) {
    return json(500, { ok: false, error: e.message || 'trigger failed' })
  }
}

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}
