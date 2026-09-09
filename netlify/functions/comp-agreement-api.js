// comp-agreement-api.js
//
// The rep side of the pay-document signing: /comp-agreement/<registration_token>.
// One form, two documents, a separate signature on each (Neal, 2026-09-09).
//
//   POST { action: 'load',   token }
//     → { ok, rep_name, documents, signed_at }   documents = the text to render
//   POST { action: 'submit', token, draw_sign_name, draw_signature,
//                                   comp_sign_name, comp_signature }
//     → { ok, signed_at }
//
// Auth = the rep's OWN registration_token — the same token Group messages
// already puts in {link} for /update-info, so a company-wide send needs no new
// links minted and no new list to keep in step.
//
// The page renders from DOCUMENTS in _comp-agreements.js and so does the PDF, so
// what they read and what they sign cannot drift apart.
//
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY.

import { createClient } from '@supabase/supabase-js'
import { DOCUMENTS, renderCompAgreementsPdf } from './_comp-agreements.js'

const BUCKET = 'trainee-docs'
const json = (code, obj) => ({
  statusCode: code,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(obj),
})

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method Not Allowed' })
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY']) {
    if (!process.env[k]) return json(500, { ok: false, error: `Missing env var: ${k}` })
  }

  let body
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { ok: false, error: 'Invalid JSON' }) }
  const token = String(body.token || '').trim()
  if (!token) return json(400, { ok: false, error: 'Missing link token' })

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  const { data: t } = await supabase
    .from('trainees')
    .select('id, first_name, last_name, email, company_email')
    .eq('registration_token', token)
    .maybeSingle()
  // Deliberately the same message for a bad token and a missing person: this URL
  // is handed out in a company-wide blast and a probe should learn nothing.
  if (!t) return json(404, { ok: false, error: 'This link is not valid. Ask the office to resend it.' })

  const repName = [t.first_name, t.last_name].filter(Boolean).join(' ')

  // Onboarding row may not exist yet for someone imported straight into the
  // field rather than through a training class — create it rather than refuse.
  const ensureRow = async () => {
    const { data } = await supabase.from('trainee_onboarding').select('*').eq('trainee_id', t.id).maybeSingle()
    if (data) return data
    const { data: made } = await supabase.from('trainee_onboarding')
      .insert({ trainee_id: t.id }).select('*').maybeSingle()
    return made || {}
  }

  if (body.action === 'load') {
    const row = await ensureRow()
    if (!row.comp_opened_at) {
      await supabase.from('trainee_onboarding')
        .update({ comp_opened_at: new Date().toISOString() }).eq('trainee_id', t.id)
    }
    return json(200, {
      ok: true,
      rep_name: repName,
      documents: DOCUMENTS.map((d) => ({ key: d.key, title: d.title, blocks: d.blocks })),
      signed_at: row.comp_signed_at || null,
    })
  }

  if (body.action !== 'submit') return json(400, { ok: false, error: 'Unknown action' })

  // Both signatures are required. Refusing here rather than storing a half-signed
  // record is the whole point of splitting them: a row with one signature would
  // look signed in any list that checks comp_signed_at.
  const drawName = String(body.draw_sign_name || '').trim()
  const compName = String(body.comp_sign_name || '').trim()
  const drawSig = String(body.draw_signature || '')
  const compSig = String(body.comp_signature || '')
  if (!drawName || !drawSig.startsWith('data:image')) {
    return json(400, { ok: false, error: 'Please print your name and sign the Draw Program.' })
  }
  if (!compName || !compSig.startsWith('data:image')) {
    return json(400, { ok: false, error: 'Please print your name and sign the Inspection Compensation Plan.' })
  }

  const row = await ensureRow()
  if (row.comp_signed_at) return json(200, { ok: true, signed_at: row.comp_signed_at, already: true })

  const now = new Date().toISOString()
  const ip = (event.headers['x-nf-client-connection-ip'] || event.headers['client-ip']
    || String(event.headers['x-forwarded-for'] || '').split(',')[0] || '').trim() || null

  const signed = {
    comp_draw_sign_name: drawName, comp_draw_signed_at: now, comp_draw_signature: drawSig,
    comp_plan_sign_name: compName, comp_plan_signed_at: now, comp_plan_signature: compSig,
    comp_signed_at: now, comp_sign_ip: ip,
  }

  // Store the signatures FIRST, render the PDF after. A PDF failure must never
  // lose a signature the rep already gave — that is the failure mode that made
  // "signed but no document" records unrecoverable on the inspection side.
  const { error: upErr } = await supabase.from('trainee_onboarding').update(signed).eq('trainee_id', t.id)
  if (upErr) return json(500, { ok: false, error: `Could not save your signature: ${upErr.message}` })

  let pdfPath = null, pdfError = null
  try {
    const buf = await renderCompAgreementsPdf({
      rep_name: repName, sign_ip: ip, signed_at: now,
      draw_sign_name: drawName, draw_signature: drawSig, draw_signed_at: now,
      comp_sign_name: compName, comp_signature: compSig, comp_signed_at: now,
    })
    const path = `${t.id}/pay-agreements_${Date.now()}.pdf`
    const { error } = await supabase.storage.from(BUCKET).upload(path, buf, { contentType: 'application/pdf', upsert: true })
    if (error) throw error
    pdfPath = path
  } catch (e) { pdfError = e?.message || 'render failed' }

  await supabase.from('trainee_onboarding')
    .update({ comp_agreement_pdf_path: pdfPath, comp_pdf_error: pdfError }).eq('trainee_id', t.id)

  return json(200, { ok: true, signed_at: now, pdf: !!pdfPath })
}
