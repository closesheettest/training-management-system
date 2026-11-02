// netlify/functions/cron-junior-promote.js
//
// Thin SCHEDULED wrapper for junior-promote-check (Neal, 2026-11-02). Fires 01:30 UTC = 8:30 PM EST, after the
// day's appointments are statused. In EDT (March–November) it lands at 9:30 PM, which is fine for a nightly check.
const SITE = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://trainingmanagementsys.netlify.app'

export const handler = async () => {
  try {
    const r = await fetch(`${SITE}/.netlify/functions/junior-promote-check`)
    return { statusCode: r.ok ? 200 : 502, headers: { 'Content-Type': 'application/json' }, body: await r.text() }
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: e.message || 'wrapper failed' }) }
  }
}
