// ica-resign-api.js
//
// The rep side of re-signing the NEW Independent Contractor Agreement (v3, Exhibit A
// built in): /sign-ica/<registration_token> (Neal, 2026-11-19).
//
// Why a separate page: the v3 agreement went into Day-1 onboarding on 2026-11-16, so
// new reps already sign it. Everyone hired before that signed the old agreement plus
// the separate pay documents. Neal wants to send v3 to every active rep, but only
// after the owner OKs it, so /signing-docs holds the send until it is released.
// The old onboarding record is never touched: a rep's original signed agreement
// stays exactly where it was.
//
//   POST { action: 'load',   token }  → { ok, rep_name, harvester, prefill, signed_at }
//   POST { action: 'submit', token, agent_legal_name, agent_phone, agent_email,
//          agent_dob, agent_address, agent_initials, sign_name, sign_title, signature }
//     → { ok, signed_at }
//
// Record: app_settings ica_v3_resign_<trainee_id>, one key per rep, so two reps
// signing at the same moment can never overwrite each other's row. The signature
// is saved there FIRST and the PDF rendered after, so a PDF failure can never lose
// a signature (the lesson from the inspection-agreement losses).
//
// The text the rep reads (src/lib/agreementText.js) and the PDF (_ic-agreement.js)
// are the same v3 text that Day-1 onboarding uses.
//
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY.
import { createClient } from '@supabase/supabase-js'
import { renderAgreementPdf, isHarvesterDepts } from './_ic-agreement.js'
import { sendEmail } from './_email.js'

const BUCKET = 'trainee-docs'
const DEFAULT_COPY_TO = ['JennV@shingleusa.com']
const json = (code, obj) => ({
  statusCode: code,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(obj),
})
export const resignKey = (id) => `ica_v3_resign_${id}`

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method Not Allowed' })
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY']) {
    if (!process.env[k]) return json(500, { ok: false, error: `Missing env var: ${k}` })
  }
  let body
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { ok: false, error: 'Invalid JSON' }) }
  const token = String(body.token || '').trim()
  if (!token) return json(400, { ok: false, error: 'Missing link token' })

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const { data: t } = await sb.from('trainees')
    .select('id, first_name, last_name, email, company_email, phone, street_address, city, state, zip, departments')
    .eq('registration_token', token).maybeSingle()
  if (!t) return json(404, { ok: false, error: 'This link is not valid. Ask the office to resend it.' })

  const repName = [t.first_name, t.last_name].filter(Boolean).join(' ')
  const harvester = isHarvesterDepts(t.departments)
  const key = resignKey(t.id)
  const getRec = async () => {
    const { data } = await sb.from('app_settings').select('value').eq('key', key).maybeSingle()
    if (!data) return null
    try { return typeof data.value === 'string' ? JSON.parse(data.value) : data.value } catch { return null }
  }
  const putRec = (v) => sb.from('app_settings').upsert({ key, value: JSON.stringify(v), updated_at: new Date().toISOString() }, { onConflict: 'key' })

  if (body.action === 'load') {
    const rec = (await getRec()) || {}
    // ?preview=1 (the office looking from /signing-docs) must not count as the rep opening it.
    if (!rec.opened_at && !body.preview) { rec.opened_at = new Date().toISOString(); await putRec(rec) }
    // Pre-fill from what they gave us at onboarding; they can correct any of it.
    const { data: ob } = await sb.from('trainee_onboarding')
      .select('agent_legal_name, agent_phone, agent_email, agent_dob, agent_address, agent_initials, sign_title')
      .eq('trainee_id', t.id).maybeSingle()
    const o = ob || {}
    return json(200, {
      ok: true, rep_name: repName, harvester, signed_at: rec.signed_at || null,
      prefill: {
        agent_legal_name: o.agent_legal_name || repName,
        agent_phone: o.agent_phone || t.phone || '',
        agent_email: o.agent_email || t.company_email || t.email || '',
        agent_dob: o.agent_dob || '',
        agent_address: o.agent_address || [t.street_address, t.city, t.state, t.zip].filter(Boolean).join(', '),
        agent_initials: o.agent_initials || '',
        sign_name: repName,
        sign_title: o.sign_title || '',
      },
    })
  }

  if (body.action !== 'submit') return json(400, { ok: false, error: 'Unknown action' })
  if (body.preview) return json(400, { ok: false, error: 'This is a preview. Nothing was signed.' })

  const s = (k) => String(body[k] || '').trim()
  const f = {
    agent_legal_name: s('agent_legal_name'), agent_phone: s('agent_phone'), agent_email: s('agent_email'),
    agent_dob: s('agent_dob'), agent_address: s('agent_address'), agent_initials: s('agent_initials').toUpperCase().slice(0, 5),
    sign_name: s('sign_name'), sign_title: s('sign_title'),
  }
  const signature = String(body.signature || '')
  const missing = [['agent_legal_name', 'your legal name'], ['agent_phone', 'your phone'], ['agent_email', 'your email'],
    ['agent_dob', 'your date of birth'], ['agent_address', 'your home address'], ['agent_initials', 'your initials for Exhibit A'],
    ['sign_name', 'your printed name']].filter(([k]) => !f[k]).map(([, l]) => l)
  if (missing.length) return json(400, { ok: false, error: `Please fill in ${missing.join(', ')}.` })
  if (!signature.startsWith('data:image')) return json(400, { ok: false, error: 'Please sign the agreement.' })

  const rec = (await getRec()) || {}
  if (rec.signed_at) return json(200, { ok: true, signed_at: rec.signed_at, already: true })

  const now = new Date().toISOString()
  const ip = (event.headers['x-nf-client-connection-ip'] || event.headers['client-ip']
    || String(event.headers['x-forwarded-for'] || '').split(',')[0] || '').trim() || null
  const signed = { ...rec, ...f, signature, signed_at: now, sign_ip: ip, harvester }
  const { error: upErr } = await putRec(signed)
  if (upErr) return json(500, { ok: false, error: `Could not save your signature: ${upErr.message}` })

  let pdfPath = null, pdfError = null, buf = null
  try {
    // renderAgreementPdf returns base64 (that is what the onboarding emails attach).
    buf = await renderAgreementPdf({ ...f, signature, signed_at: now, sign_ip: ip, harvester })
    const path = `${t.id}/ica-v3-resign_${Date.now()}.pdf`
    const { error } = await sb.storage.from(BUCKET).upload(path, Buffer.from(buf, 'base64'), { contentType: 'application/pdf', upsert: true })
    if (error) throw error
    pdfPath = path
  } catch (e) { pdfError = e?.message || 'render failed' }
  await putRec({ ...signed, pdf_path: pdfPath, pdf_error: pdfError })

  // Copy to the office (editable on /signing-docs: app_settings signing_copy_to_ica3).
  // Best-effort and after the signature is saved.
  if (buf) {
    try {
      let copyTo = DEFAULT_COPY_TO
      const { data: st } = await sb.from('app_settings').select('value').eq('key', 'signing_copy_to_ica3').maybeSingle()
      const v = st ? (typeof st.value === 'string' ? JSON.parse(st.value) : st.value) : null
      if (Array.isArray(v) && v.length) copyTo = v
      const safe = String(repName || 'Rep').replace(/[^A-Za-z0-9]+/g, '-')
      for (const addr of copyTo) await sendEmail(addr,
        `Signed NEW Independent Contractor Agreement (v3) — ${repName}`,
        `${repName} signed the new Independent Contractor Agreement with Exhibit A on ${new Date(now).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET.\n\n`
        + `Signed as: ${f.sign_name}\nInitials on Exhibit A: ${f.agent_initials}\n\nThe signed PDF is attached.`,
        { attachments: [{ filename: `ICA-v3-${safe}.pdf`, content: buf }] })
    } catch (e) { console.warn('ica resign: could not email the signed copy:', e?.message) }
  }

  return json(200, { ok: true, signed_at: now, pdf: !!pdfPath })
}
