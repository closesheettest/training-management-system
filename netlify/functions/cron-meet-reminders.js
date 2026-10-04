// cron-meet-reminders.js — every 5 minutes: texts + emails everyone invited to a meeting room that
// has "⏰ Remind everyone 5 minutes before" on, with their own join link (Neal, 2026-10-04).
// The work lives in meet.js (runMeetReminders), next to the schedule it reads.
import { runMeetReminders } from './meet.js'

export const handler = async () => {
  const sent = await runMeetReminders().catch((e) => { console.error('reminders', e); return [] })
  return { statusCode: 200, body: JSON.stringify({ ok: true, sent }) }
}

export const config = { schedule: '*/5 * * * *' }
