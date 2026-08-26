// netlify/functions/cron-week-a-presentation.js
//
// Thin SCHEDULED wrapper — holds the cron, calls the worker over HTTP.
// The split exists because Netlify 403s HTTP calls to a scheduled function,
// which would make the worker impossible to test or re-fire by hand.
//
// Fires 18:00 UTC = 2 PM EDT, Wednesdays — Week A dismissal. The worker re-checks the day in
// Eastern Time, so a DST shift moves the send by an hour but can never send it
// on the wrong day. When clocks go back to EST in November, change the schedule
// to '0 19 * * 3' to stay at 2 PM ET.

const SITE = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://trainingmanagementsys.netlify.app'

export const handler = async () => {
  try {
    const r = await fetch(`${SITE}/.netlify/functions/send-week-a-presentation`)
    return { statusCode: r.ok ? 200 : 502, headers: { 'Content-Type': 'application/json' }, body: await r.text() }
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: e.message || 'wrapper failed' }) }
  }
}
