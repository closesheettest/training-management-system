// Transactional email sender via Resend.
//
// Matches the pattern used in ccg-claims-docs/send-email.js — same SDK, same
// env var names — so credentials and verified-domain setup carry over.
//
// Required env vars:
//   RESEND_API_KEY  — Resend API key (rs_...)
//   EMAIL_FROM      — verified "From" address on your Resend domain.
//                     e.g. "Training System <notify@yourverifieddomain.com>"
//                     Falls back to "Training System <onboarding@resend.dev>"
//                     (Resend's sandbox — works without domain verification
//                     but only delivers to the Resend account owner's email).
//
// Never throws — returns { ok, step?, error? } so callers can aggregate.

import { Resend } from 'resend'

let _client = null
function client() {
  if (_client) return _client
  if (!process.env.RESEND_API_KEY) return null
  _client = new Resend(process.env.RESEND_API_KEY)
  return _client
}

export async function sendEmail(toAddress, subject, body) {
  if (!toAddress) return { ok: false, step: 'precheck', error: 'No email address provided' }
  const r = client()
  if (!r) return { ok: false, step: 'precheck', error: 'RESEND_API_KEY not configured' }

  const from = process.env.EMAIL_FROM || 'Training System <onboarding@resend.dev>'

  try {
    const result = await r.emails.send({
      from,
      to: [toAddress],
      subject,
      html: wrapHtml(body),
      text: body,
    })
    if (result.error) {
      return {
        ok: false,
        step: 'resend_send',
        error: result.error.message || JSON.stringify(result.error),
      }
    }
    return { ok: true, id: result.data?.id || null }
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
