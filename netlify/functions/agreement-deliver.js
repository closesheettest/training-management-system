// agreement-deliver.js
//
// Send the fully executed Independent Contractor Agreement to the people who
// should hold a copy: the countersigner, the rep, and hr/admin.
//
// Countersigning used to render the PDF, file it in storage and tell nobody.
// Danny Robinson's and Aidan Begley's agreements were signed by both parties
// before that was fixed, so the documents exist and no one has them. This sends
// them after the fact, and stays useful whenever a send fails (Neal, 2026-08-25).
//
//   GET                    list what could be delivered, send nothing
//   POST                   deliver every countersigned agreement that has a PDF
//   POST ?only=a,b         deliver only these trainee_ids
//
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY.

import { createClient } from '@supabase/supabase-js'
import { sendEmail } from './_email.js'

const COUNTERSIGNER_EMAIL = 'JennV@shingleusa.com'
const BUCKET = 'trainee-docs'
const json = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj, null, 2) })

export const handler = async (event) => {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const qp = event.queryStringParameters || {}
  const dry = event.httpMethod === 'GET'
  const only = String(qp.only || '').split(',').map((x) => x.trim()).filter(Boolean)

  const { data: rows, error } = await supabase
    .from('trainee_onboarding')
    .select('trainee_id, sign_name, agent_legal_name, agent_email, signed_at, company_signed_at, company_sign_name, agreement_pdf_path')
    .not('company_signed_at', 'is', null)
    .order('company_signed_at', { ascending: true })
  if (error) return json(500, { ok: false, error: error.message })

  const named = (r) => (r.agent_legal_name || r.sign_name || r.trainee_id || 'the rep').trim()
  let list = (rows || []).filter((r) => r.agreement_pdf_path)
  const noPdf = (rows || []).filter((r) => !r.agreement_pdf_path).map(named)
  if (only.length) list = list.filter((r) => only.includes(r.trainee_id))

  if (dry) {
    return json(200, {
      ok: true, dry_run: true,
      deliverable: list.map((r) => ({ trainee_id: r.trainee_id, who: named(r), to_rep: r.agent_email || null, countersigned: r.company_signed_at })),
      countersigned_without_a_pdf: noPdf,
    })
  }

  const { data: office } = await supabase.from('notification_recipients').select('email, role, active').in('role', ['hr', 'admin'])
  const hr = [...new Set((office || []).filter((r) => r.active !== false && r.email).map((r) => r.email))]

  const out = []
  for (const r of list) {
    const who = named(r)
    const { data: file } = await supabase.storage.from(BUCKET).download(r.agreement_pdf_path)
    if (!file) { out.push({ who, error: 'PDF could not be read from storage' }); continue }
    const content = Buffer.from(await file.arrayBuffer()).toString('base64')
    const attachments = [{ filename: `Independent-Contractor-Agreement-${who.replace(/[^A-Za-z0-9]+/g, '-')}.pdf`, content }]
    const body = (greeting) =>
      `${greeting}\n\nAttached is the fully executed Independent Contractor Agreement for ${who}, signed by them on ` +
      `${new Date(r.signed_at).toLocaleDateString('en-US')} and countersigned by ${r.company_sign_name || 'U.S. Shingle'} on ` +
      `${new Date(r.company_signed_at).toLocaleDateString('en-US')}.\n\n— U.S. Shingle & Metal`

    const targets = [[COUNTERSIGNER_EMAIL, `Countersigned — ${who}`, body('Your signed copy, for your records.')]]
    if (r.agent_email) targets.push([r.agent_email, 'Your Independent Contractor Agreement', body(`Hi ${(r.sign_name || '').split(' ')[0] || 'there'},`)])
    for (const a of hr) targets.push([a, `Fully executed — ${who}`, body(`${who}'s agreement is complete.`)])

    const sent = [], failed = []
    for (const [to, subject, text] of targets) {
      const res = await sendEmail(to, subject, text, { attachments }).catch((e) => ({ ok: false, error: e.message }))
      if (res && res.ok) sent.push(to); else failed.push({ to, error: res && res.error })
    }
    out.push({ who, sent, failed })
  }
  return json(200, { ok: true, delivered: out, countersigned_without_a_pdf: noPdf })
}
