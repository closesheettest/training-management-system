// High-level fan-out: send the right channels to each recipient.
//
// For every recipient:
//   - If notify_via_sms && phone is set      → send SMS  (via GHL)
//   - If notify_via_email && email is set    → send email (via Resend)
// Returns aggregate counts + per-recipient errors so callers can surface
// useful results to the UI.

import { sendSmsViaGhl } from './_ghl.js'
import { sendEmail } from './_email.js'

export async function notifyAll(recipients, { smsBody, emailSubject, emailBody, contactLabel = 'Notify' }) {
  const result = {
    sms_sent: 0,
    sms_attempted: 0,
    email_sent: 0,
    email_attempted: 0,
    errors: [],
  }

  for (const r of recipients) {
    const wantsSms = r.notify_via_sms && !!r.phone
    const wantsEmail = r.notify_via_email && !!r.email

    if (wantsSms && smsBody) {
      result.sms_attempted++
      const smsRes = await sendSmsViaGhl(r.phone, smsBody, { firstName: contactLabel })
      if (smsRes.ok) result.sms_sent++
      else result.errors.push({ recipient: r.name, channel: 'sms', step: smsRes.step, error: smsRes.error })
    }

    if (wantsEmail && emailSubject && emailBody) {
      result.email_attempted++
      const emailRes = await sendEmail(r.email, emailSubject, emailBody)
      if (emailRes.ok) result.email_sent++
      else result.errors.push({ recipient: r.name, channel: 'email', step: emailRes.step, error: emailRes.error })
    }
  }
  return result
}
