// netlify/functions/_practice-cap-alert.js
//
// 💸 Rep self-practice hit its weekly $100 (Neal, 2026-10-19: "on every personal dashboard, but make sure you alert if
// we reach $100.00 each week"). Texts and emails Neal ONCE per week, the first time the week's spend is at or over the
// cap. Practice pauses at the cap anyway (practice-self.js WEEK_CAP) and reopens Monday.
import { sendSmsViaGhl } from './_ghl.js'
import { sendEmail } from './_email.js'

const NEAL = { phone: '7275037017', email: 'neals@shingleusa.com' }

export async function capAlert(sb, { spent, cap, weekStart }) {
  if (!(spent >= cap)) return { sent: false }
  const { data } = await sb.from('app_settings').select('value').eq('key', 'practice_cap_alert').maybeSingle()
  let v = data?.value; try { if (typeof v === 'string') v = JSON.parse(v) } catch { v = null }
  if (v?.week === weekStart) return { sent: false, already: true }
  await sb.from('app_settings').upsert({ key: 'practice_cap_alert', value: JSON.stringify({ week: weekStart, spent, at: new Date().toISOString() }), updated_at: new Date().toISOString() }, { onConflict: 'key' })
  const msg = `Heads up: rep practice (the AI homeowner) has hit $${spent.toFixed(2)} this week, the $${cap} weekly limit. It's paused for every rep until Monday. Reply if you want the limit raised.`
  await Promise.allSettled([
    sendSmsViaGhl(NEAL.phone, msg, { firstName: 'Practice', lastName: 'Budget' }),
    sendEmail(NEAL.email, `Rep practice hit $${cap} this week`, msg),
  ])
  return { sent: true }
}
