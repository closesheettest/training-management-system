// _offboard-notify.js — ONE place that builds + sends the "rep needs
// off-boarding cleanup" alert, so every path that marks a rep Quit / Fired
// (regional-manager-api deactivate_rep AND the admin Active-Reps page via
// notify-offboarding.js) fires the exact same text. Edit the wording here
// only.
//
// Subscribers are whoever opted into the `rep_marked_offboarding` event on
// the /notifications page (falls back to legacy 'admin' role). The text
// names the rep, who flagged them, the reason, and links to the hosted
// step-by-step off-boarding page.

import { recipientPhonesForEvent } from './_recipients.js'
import { sendSmsViaGhl } from './_ghl.js'

const OFFBOARD_GUIDE_URL = 'https://trainingmanagementsys.netlify.app/offboarding'

export async function notifyOffboarding(supabase, { repName, region, flaggedBy, reason }) {
  const name = (repName || '').trim() || 'A rep'
  const where = region ? ` (${region})` : ''
  const by = flaggedBy ? ` by ${flaggedBy}` : ''
  const why = reason ? ` Reason: ${reason}.` : ''
  const msg =
    `🚪 Off-boarding needed: ${name}${where} was marked Quit / Fired${by}.${why} ` +
    `Please remove them from GHL, Google Workspace, RepCard, JobNimbus & Sales Academy. ` +
    `Step-by-step: ${OFFBOARD_GUIDE_URL}`

  let sent = 0
  try {
    const { phones } = await recipientPhonesForEvent(supabase, 'rep_marked_offboarding', {
      legacyRole: 'admin',
    })
    for (const ph of phones) {
      await sendSmsViaGhl(ph, msg, { firstName: 'Off-boarding', lastName: 'Cleanup' })
      sent++
    }
  } catch (e) {
    console.warn('notifyOffboarding failed:', e?.message || e)
  }
  return { sent }
}
