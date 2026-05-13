// Transactional email sender via Resend (https://resend.com).
//
// Required env vars:
//   RESEND_API_KEY            — Resend API key (rs_...)
//   NOTIFICATION_FROM_EMAIL   — Verified "from" address on your Resend domain.
//                                e.g. "Training System <notify@yourdomain.com>"
//                                Falls back to "Training System <onboarding@resend.dev>"
//                                which works without domain verification (Resend test mode)
//                                but can only deliver to the account owner's email.
//
// Never throws — returns { ok, step?, error? } so callers can aggregate.

export async function sendEmail(toAddress, subject, body) {
  if (!toAddress) return { ok: false, step: 'precheck', error: 'No email address provided' }
  if (!process.env.RESEND_API_KEY) {
    return { ok: false, step: 'precheck', error: 'RESEND_API_KEY not configured' }
  }
  const from =
    process.env.NOTIFICATION_FROM_EMAIL ||
    'Training System <onboarding@resend.dev>'

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [toAddress],
        subject,
        html: wrapHtml(body),
        text: body,
      }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      return {
        ok: false,
        step: 'resend_send',
        error: `${res.status}: ${j.message || j.name || JSON.stringify(j)}`,
      }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, step: 'exception', error: err.message || 'Unknown' }
  }
}

// Wrap a plain-text body in a minimal HTML shell. Newlines become <br>;
// http(s) URLs become clickable links.
function wrapHtml(body) {
  if (typeof body !== 'string') return ''
  const escaped = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const withLinks = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" style="color:#13294b;">$1</a>',
  )
  const lines = withLinks.split('\n').join('<br>')
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#0f172a;max-width:600px;padding:16px;">${lines}</div>`
}
