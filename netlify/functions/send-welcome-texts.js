// Thin trigger for the welcome drip. The external scheduler hits THIS URL
// (with ?secret / X-Cron-Secret). It validates the secret, then fires the
// BACKGROUND worker (send-welcome-texts-background) which does the actual
// sending — a full class is too many GHL sends to finish inside a regular
// function's ~10s limit (it was timing out and starving most of the list).
// The background function gets 15 minutes, so everyone eligible is reached.
//
// GET/POST ?secret=<CRON_SECRET>  (or X-Cron-Secret header). Returns 202.

export const handler = async (event) => {
  const provided =
    event.headers['x-cron-secret'] ||
    event.headers['X-Cron-Secret'] ||
    event.queryStringParameters?.secret
  if (!process.env.CRON_SECRET || provided !== process.env.CRON_SECRET) {
    return json(401, { error: 'Unauthorized' })
  }

  const base = (
    process.env.PUBLIC_SITE_URL ||
    process.env.URL ||
    process.env.DEPLOY_URL ||
    'https://trainingmanagementsys.netlify.app'
  ).replace(/\/$/, '')

  // Fire-and-forget the background worker (it returns 202 immediately and
  // runs up to 15 min). Pass the secret + any dry_run flag straight through.
  const qp = event.queryStringParameters || {}
  const url =
    `${base}/.netlify/functions/send-welcome-texts-background` +
    `?secret=${encodeURIComponent(provided)}` +
    (qp.dry_run ? `&dry_run=${encodeURIComponent(qp.dry_run)}` : '')
  try {
    await fetch(url, { method: 'POST' })
  } catch (e) {
    return json(502, { error: `Could not start background worker: ${e.message}` })
  }
  return json(202, { ok: true, triggered: true })
}

function json(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}
