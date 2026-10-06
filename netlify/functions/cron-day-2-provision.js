// Scheduled wrapper for notify-day-2-provision (Neal, 2026-10-06). Netlify scheduled functions can't be
// called over HTTP, so this one only knocks the callable worker. Every 15 minutes, 2–6 PM Eastern
// (18–22 UTC in EDT): the worker itself waits until the cohort's class start + 30 min and fires once.
export default async () => {
  const site = (process.env.URL || 'https://trainingmanagementsys.netlify.app').replace(/\/$/, '')
  if (!process.env.CRON_SECRET) return new Response('no secret', { status: 200 })
  const r = await fetch(`${site}/.netlify/functions/notify-day-2-provision?secret=${encodeURIComponent(process.env.CRON_SECRET)}`).catch(() => null)
  return new Response(r ? `worker ${r.status}` : 'worker unreachable', { status: 200 })
}
export const config = { schedule: '*/15 18-22 * * *' }
