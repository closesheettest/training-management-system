// cron-retrain-homework.js — 7 PM Eastern (23:00 UTC; 6 PM in winter): everyone picked for a
// retraining whose next session is TOMORROW gets that day's page by text + email — tomorrow's time,
// join link, and tonight's homework (Neal, 2026-10-05). The work lives in meet.js.
import { runRetrainHomework } from './meet.js'

export const handler = async () => {
  const sent = await runRetrainHomework().catch((e) => { console.error('retrain homework', e); return [] })
  return { statusCode: 200, body: JSON.stringify({ ok: true, sent: sent.length }) }
}

export const config = { schedule: '0 23 * * *' }
