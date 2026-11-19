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
// is saved there FIRST. The PDF is rendered only after Jenn countersigns
// (countersign-agreement.js), with both signatures on it.
//
// The text the rep reads (src/lib/agreementText.js) and the PDF (_ic-agreement.js)
// are the same v3 text that Day-1 onboarding uses.
//
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY.
import { createClient } from '@supabase/supabase-js'
import { isHarvesterDepts } from './_ic-agreement.js'
import { NOT_A_FIELD_REP } from './_ica-v3.js'
import { sendSmsViaGhl as sendSms } from './_ghl.js'
import { sendEmail } from './_email.js'

const BUCKET = 'trainee-docs'
const COUNTERSIGNER = { phone: '(941) 718-0032', email: 'JennV@shingleusa.com' }   // Jennifer VonGraupen, as in trainee-onboarding-api
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
  // An office person (Neal, Jenn, DeWayne…) signing this is ALWAYS a test (Neal, 2026-11-19: "make sure
  // that it's just a test, and if it's going to Jen, let her know"). Flagged on the record and in every message.
  const isTest = NOT_A_FIELD_REP.has(repName.trim().toLowerCase())
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
      ok: true, rep_name: repName, harvester, test: isTest, signed_at: rec.signed_at || null,
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
  const signed = { ...rec, ...f, signature, signed_at: now, sign_ip: ip, harvester, ...(isTest ? { test: true } : {}) }
  const { error: upErr } = await putRec(signed)
  if (upErr) return json(500, { ok: false, error: `Could not save your signature: ${upErr.message}` })

  // JENN COUNTERSIGNS, THEN THE PDF IS MADE (Neal, 2026-11-19: "Yes, add countersign").
  // Same rule as Day-1 onboarding: a PDF with the U.S. Shingle side blank is not an
  // executed contract, so none is filed now. countersign-agreement.js (the page Jenn
  // already uses) renders it with both signatures and emails it to Jenn, the rep and
  // the copy-to list. Token = ica3_<trainee_id>_<random>, so that page knows which
  // record to open without a new table.
  const csToken = `ica3_${t.id}_${crypto.randomUUID().replace(/-/g, '')}`
  await putRec({ ...signed, countersign_token: csToken })
  try {
    const site = (process.env.URL || 'https://trainingmanagementsys.netlify.app').replace(/\/$/, '')
    const link = `${site}/.netlify/functions/countersign-agreement?t=${csToken}`
    // Both channels, like every other message here.
    const [smsR, emR] = await Promise.allSettled([
      sendSms(COUNTERSIGNER.phone,
        isTest
          ? `🧪 TEST ONLY, nothing real: ${repName} is testing the new Independent Contractor Agreement. You can countersign to see how it works, or ignore this:\n\n${link}`
          : `${repName} signed the NEW Independent Contractor Agreement (v3). It needs your signature to be complete:\n\n${link}`,
        { firstName: 'Training', lastName: 'System' }),
      sendEmail(COUNTERSIGNER.email, isTest ? `🧪 TEST ONLY — new agreement test by ${repName}` : `Countersign needed (new agreement) — ${repName}`,
        [...(isTest ? [`🧪 THIS IS A TEST. ${repName} is testing the new contractor agreement before it goes to the reps. Nothing here is real. You can countersign to see how it works, or ignore it.`, ''] : []),
          `${repName} has signed the new Independent Contractor Agreement (v3, with Exhibit A).`, '',
          'It is not complete until U.S. Shingle signs it too, and the PDF is not created until you do.', '',
          'Sign here:', link, '', '— Training System'].join('\n')),
    ])
    const okSms = smsR.status === 'fulfilled' && smsR.value?.ok !== false
    const okEm = emR.status === 'fulfilled' && emR.value?.ok !== false
    await putRec({ ...signed, countersign_token: csToken, countersign_sent_at: new Date().toISOString(), countersign_sent: { sms: okSms, email: okEm } })
  } catch (e) { console.warn('ica resign: countersign notice failed:', e?.message) }

  return json(200, { ok: true, signed_at: now })
}
