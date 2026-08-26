// trainee-onboarding-api.js
//
// Day-1 paperwork for reps: the W-9 and the Independent Contractor Agreement
// (+ Exhibit A). Replaces the HomeMaxx funnel the kiosk used to text out.
//
// The trainee signs in at the kiosk → send-onboarding-sms texts AND emails them
// a link to /onboarding/<registration_token> → they fill this in and e-sign →
// we fill the official IRS W-9, render the signed agreement, store both in the
// private 'trainee-docs' bucket, and email a copy to the rep and to the office.
//
//   POST { action: 'load',   token }   → their saved draft (SSN/bank NEVER returned)
//   POST { action: 'save',   token, fields }   → partial save as they type
//   POST { action: 'submit', token, fields, signature }
//   POST { action: 'roster', class_id }        → who's done, for the class gate
//
// EVERYTHING goes through the service key: trainee_onboarding has RLS on with no
// policies because it holds SSNs and bank account numbers, so the browser can
// never read it directly.
//
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY, RESEND_API_KEY (email), URL.

import { createClient } from '@supabase/supabase-js'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import W9_B64 from './assets/w9-template-b64.js'
import { renderAgreementPdf } from './_ic-agreement.js'
import { sendEmail } from './_email.js'
import { sendSmsViaGhl as sendSms } from './_ghl.js'

// Who signs for the company. One place, so changing it is one edit.
const COUNTERSIGNER = { name: 'Jennifer VonGraupen', phone: '(941) 718-0032', email: 'JennV@shingleusa.com' }

const BUCKET = 'trainee-docs'

// Fields the signing page may write. Anything else is ignored, so a tampered
// payload can't set signed_at, pdf paths, etc.
const WRITABLE = [
  'first_name', 'last_name', 'preferred_name', 'shirt_size',
  'agent_email', 'agent_phone', 'agent_dob', 'agent_address', 'agent_legal_name',
  'emergency_name', 'emergency_phone', 'pay_direction',
  'w9_name', 'w9_business_name', 'w9_tax_classification', 'w9_llc_class',
  'w9_address', 'w9_city_state_zip', 'w9_tin_type', 'w9_tin',
  'business_name', 'business_ein', 'business_address',
  'bank_name', 'bank_account_name', 'bank_routing', 'bank_wire_routing', 'bank_account_number',
  'sign_name', 'sign_title', 'agent_initials',
]
// Never echoed back to the browser once saved.
const SECRET = ['w9_tin', 'bank_account_number', 'bank_routing', 'bank_wire_routing', 'business_ein']

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return cors(200, {})
  if (event.httpMethod !== 'POST') return cors(405, { ok: false, error: 'POST only' })
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY']) {
    if (!process.env[k]) return cors(500, { ok: false, error: `Missing ${k}` })
  }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  let body = {}
  try { body = JSON.parse(event.body || '{}') } catch { return cors(400, { ok: false, error: 'Bad JSON' }) }
  const action = String(body.action || '').toLowerCase()

  // ── what everyone in a class filled in on their paperwork ──────────────────
  //
  // The roster action only covers people who have CHECKED IN, because it exists
  // to gate a class starting. The class page needs the same details for the whole
  // roster — the office looks up a shirt size or an emergency contact for someone
  // who has not turned up yet just as often (Neal, 2026-08-25).
  //
  // Never the SECRET columns: no TIN, no account number, no routing.
  if (action === 'details') {
    const classId = String(body.class_id || '')
    if (!classId) return cors(400, { ok: false, error: 'class_id required' })
    const { data: trainees } = await supabase.from('trainees').select('id').eq('class_id', classId)
    const ids = (trainees || []).map((t) => t.id)
    if (!ids.length) return cors(200, { ok: true, byTrainee: {} })
    const COLS = 'trainee_id, preferred_name, shirt_size, agent_legal_name, agent_phone, agent_email, agent_dob, ' +
      'agent_address, emergency_name, emergency_phone, sign_title, business_name, bank_name, agent_initials, pay_direction, ' +
      'signed_at, banking_completed_at, company_signed_at'
    let rows = []
    const { data, error } = await supabase.from('trainee_onboarding').select(COLS).in('trainee_id', ids)
    if (error) {
      // A pending migration costs the extra columns, never the whole lookup.
      const { data: basic } = await supabase.from('trainee_onboarding')
        .select(COLS.split(', ').filter((c) => !error.message.includes(c)).join(', ')).in('trainee_id', ids)
      rows = basic || []
    } else rows = data || []
    return cors(200, { ok: true, byTrainee: Object.fromEntries(rows.map((r) => [r.trainee_id, r])) })
  }

  // ── the class gate: who still owes paperwork ───────────────────────────────
  if (action === 'roster') {
    const classId = String(body.class_id || '')
    if (!classId) return cors(400, { ok: false, error: 'class_id required' })
    const week = String(body.week || 'A').toUpperCase() === 'B' ? 'B' : 'A'
    const { data: trainees } = await supabase
      .from('trainees')
      .select('id, first_name, last_name, phone, email, enrolled, declined_at, dropped_out_at, left_company_at, attendance(attendance_date, confirmed)')
      .eq('class_id', classId)
    // left_company_at too — offboarding sets it, and leaving it out is why a
    // fired rep kept reappearing on the roster (Neal, 2026-08-25).
    let live = (trainees || []).filter((t) => t.enrolled !== false && !t.declined_at && !t.dropped_out_at && !t.left_company_at)
    // WHO IS ACTUALLY IN THE CLASS. The paperwork link is sent when someone signs
    // in at the kiosk, so a person who has never signed in cannot owe it — listing
    // them reads as outstanding paperwork that will never arrive. A Week A class
    // of 2 was showing "waiting on 3 of 7", and all three had never attended a
    // single day (Neal, 2026-08-19). Same has-checked-in rule the zone-assignment
    // card uses.
    // Present on the most recent day this class actually met — not merely "came
    // once". Someone who attended Monday and stopped is out of the class, and
    // listing them reads as outstanding paperwork from a person who has gone.
    {
      const lastMet = live.reduce((mx, t) =>
        (t.attendance || []).reduce((m, a) => (a && a.confirmed && (!m || a.attendance_date > m) ? a.attendance_date : m), mx), null)
      live = lastMet
        ? live.filter((t) => (t.attendance || []).some((a) => a && a.confirmed && a.attendance_date === lastMet))
        : []
    }
    // A WEEK B page is about the people continuing — those present on the last
    // day their Week A recorded attendance. Listing the whole roster meant 22
    // names when 4 are coming, which reads as 18 people owing paperwork they
    // will never owe. Same rule as _week-a.js and the Schedule page.
    if (week === 'B') {
      const { data: cls } = await supabase.from('classes').select('week_start_date').eq('id', classId).maybeSingle()
      const start = cls?.week_start_date
      if (start) {
        const end = new Date(new Date(`${start}T12:00:00Z`).getTime() + 6 * 86400000).toISOString().slice(0, 10)
        const inWeekA = (a) => a.confirmed && a.attendance_date >= start && a.attendance_date <= end
        let lastDay = null
        for (const t of live) for (const a of t.attendance || []) {
          if (inWeekA(a) && (!lastDay || a.attendance_date > lastDay)) lastDay = a.attendance_date
        }
        live = lastDay
          ? live.filter((t) => (t.attendance || []).some((a) => a.confirmed && a.attendance_date === lastDay))
          : []
      }
    }
    // CORE FIRST, DETAILS SECOND.
    //
    // These were one select. Adding agent_initials to it — a column whose
    // migration had not been run — made the whole query error, `rows` came back
    // undefined, and every trainee on the page read as "has not signed". A class
    // of four who had all signed showed "Waiting on 4 of 4 to sign" (Neal,
    // 2026-08-25).
    //
    // The signed/banking state is what gates a class starting, so it is fetched
    // on its own and cannot be taken down by an optional field. The details are a
    // second, best-effort query that degrades to nothing.
    const ids = live.map((t) => t.id).length ? live.map((t) => t.id) : ['00000000-0000-0000-0000-000000000000']
    const { data: rows } = await supabase
      .from('trainee_onboarding')
      .select('trainee_id, signed_at, banking_completed_at, w9_pdf_path, agreement_pdf_path, company_signed_at')
      .in('trainee_id', ids)

    // NEVER the SECRET columns: no TIN, no bank account, no routing.
    const DETAIL_COLS = 'trainee_id, preferred_name, shirt_size, agent_legal_name, agent_phone, agent_email, ' +
      'agent_dob, agent_address, emergency_name, emergency_phone, sign_title, business_name, bank_name, agent_initials'
    let detail = []
    {
      const { data, error } = await supabase.from('trainee_onboarding').select(DETAIL_COLS).in('trainee_id', ids)
      if (error) {
        // Drop whatever the database does not have yet and try once more, so a
        // pending migration costs the extra fields and nothing else.
        const { data: basic } = await supabase.from('trainee_onboarding')
          .select(DETAIL_COLS.split(', ').filter((c) => !error.message.includes(c)).join(', '))
          .in('trainee_id', ids)
        detail = basic || []
        console.warn('roster details fell back:', error.message)
      } else detail = data || []
    }
    const detailById = Object.fromEntries(detail.map((r) => [r.trainee_id, r]))
    const byId = Object.fromEntries((rows || []).map((r) => [r.trainee_id, r]))
    const people = live.map((t) => {
      const r = byId[t.id] || {}
      return {
        trainee_id: t.id,
        name: `${t.first_name || ''} ${t.last_name || ''}`.trim(),
        phone: t.phone, email: t.email,
        signed: !!r.signed_at, signed_at: r.signed_at || null,
        banking_done: !!r.banking_completed_at,
        has_docs: !!(r.w9_pdf_path && r.agreement_pdf_path),
        countersigned: !!r.company_signed_at,
        details: (() => { const r = detailById[t.id] || {}; return {
          preferred_name: r.preferred_name || null,
          shirt_size: r.shirt_size || null,
          legal_name: r.agent_legal_name || null,
          phone: r.agent_phone || null,
          email: r.agent_email || null,
          dob: r.agent_dob || null,
          address: r.agent_address || null,
          emergency_name: r.emergency_name || null,
          emergency_phone: r.emergency_phone || null,
          initials: r.agent_initials || null,
          title: r.sign_title || null,
          business_name: r.business_name || null,
          // The bank NAME only — never the account. Enough to say direct deposit
          // is set up with someone, without putting the numbers on a screen.
          bank_name: r.bank_name || null,
        } })(),
      }
    }).sort((a, b) => Number(a.signed) - Number(b.signed) || a.name.localeCompare(b.name))
    return cors(200, {
      ok: true,
      total: people.length,
      signed: people.filter((p) => p.signed).length,
      // The GATE is the signed paperwork only. Banking is chased separately —
      // people genuinely turn up without their bank details and the class isn't
      // held for it.
      outstanding: people.filter((p) => !p.signed).length,
      banking_outstanding: people.filter((p) => p.signed && !p.banking_done).length,
      people,
    })
  }

  // ── regenerate: rebuild the PDFs from the stored fields + signature ───────
  // The drawn signature is kept precisely so a document can be rebuilt without
  // asking anyone to sign again — after a data correction, or if a render ever
  // failed and left pdf_error set. Signed_at and the signature are untouched, so
  // the rebuilt document attests to the same act of signing.
  if (action === 'regenerate') {
    const traineeId = String(body.trainee_id || '')
    if (!traineeId) return cors(400, { ok: false, error: 'trainee_id required' })
    const { data: row } = await supabase.from('trainee_onboarding').select('*').eq('trainee_id', traineeId).maybeSingle()
    if (!row) return cors(404, { ok: false, error: 'No paperwork on file.' })
    if (!row.signed_at) return cors(400, { ok: false, error: "That person hasn't signed yet." })
    let w9Path = row.w9_pdf_path, agPath = row.agreement_pdf_path, err = null
    try { w9Path = await storeFile(supabase, `${traineeId}/w9_${Date.now()}.pdf`, await fillW9Pdf(row)) }
    catch (e) { err = `w9: ${e.message}` }
    try { agPath = await storeFile(supabase, `${traineeId}/agreement_${Date.now()}.pdf`, await renderAgreementPdf(row)) }
    catch (e) { err = `${err ? err + '; ' : ''}agreement: ${e.message}` }
    await supabase.from('trainee_onboarding')
      .update({ w9_pdf_path: w9Path, agreement_pdf_path: agPath, pdf_error: err })
      .eq('trainee_id', traineeId)
    return cors(200, { ok: true, regenerated: true, pdf_error: err })
  }

  // ── docs: short-lived links to a trainee's signed PDFs ────────────────────
  // The bucket is private, so the office can't just open a URL. This mints
  // signed links that expire in 10 minutes — long enough to read or download,
  // short enough that a copied link is worthless tomorrow.
  if (action === 'docs') {
    const traineeId = String(body.trainee_id || '')
    if (!traineeId) return cors(400, { ok: false, error: 'trainee_id required' })
    const { data: row } = await supabase
      .from('trainee_onboarding')
      .select('w9_pdf_path, agreement_pdf_path, signed_at, sign_name, sign_ip, pdf_error')
      .eq('trainee_id', traineeId).maybeSingle()
    if (!row) return cors(404, { ok: false, error: 'No paperwork on file for that person.' })
    const sign = async (path) => {
      if (!path) return null
      const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600)
      return data?.signedUrl || null
    }
    return cors(200, {
      ok: true,
      signed_at: row.signed_at, sign_name: row.sign_name, sign_ip: row.sign_ip,
      pdf_error: row.pdf_error || null,
      agreement_url: await sign(row.agreement_pdf_path),
      w9_url: await sign(row.w9_pdf_path),
    })
  }

  // ── chase: re-send the paperwork link to people who haven't signed ────────
  // Built for the Aug-10 cohort, who started Week B without ever doing Day-1
  // paperwork, but it's reusable: any class, any time, only the unsigned.
  if (action === 'chase') {
    const classId = String(body.class_id || '')
    if (!classId) return cors(400, { ok: false, error: 'class_id required' })
    const onlyIds = Array.isArray(body.trainee_ids) && body.trainee_ids.length ? body.trainee_ids : null
    const { data: trainees } = await supabase
      .from('trainees')
      .select('id, first_name, last_name, phone, email, registration_token, enrolled, declined_at, dropped_out_at, left_company_at')
      .eq('class_id', classId)
    const { data: rows } = await supabase
      .from('trainee_onboarding').select('trainee_id, signed_at').eq('class_id', classId)
    const signed = new Set((rows || []).filter((r) => r.signed_at).map((r) => r.trainee_id))
    const targets = (trainees || []).filter((t) =>
      t.enrolled !== false && !t.declined_at && !t.dropped_out_at && !t.left_company_at &&
      !signed.has(t.id) && (t.phone || t.email) &&
      (!onlyIds || onlyIds.includes(t.id)))

    const site = process.env.URL || 'https://trainingmanagementsys.netlify.app'
    const note = String(body.message || '').trim()
    const sent = []
    for (const t of targets) {
      const link = `${site}/onboarding/${t.registration_token}`
      const msg = (note
        ? `Hi ${t.first_name || 'there'}, ${note}`
        : `Hi ${t.first_name || 'there'}, we still need your paperwork.`) + `\n\n${link}`
      if (body.dry_run) { sent.push({ name: `${t.first_name} ${t.last_name}`, preview: msg }); continue }
      const channels = []
      if (t.email) { try { const r = await sendEmail(t.email, 'We still need your U.S. Shingle paperwork', msg); if (r?.ok !== false) channels.push('email') } catch { /* sms may land */ } }
      if (t.phone) { try { const r = await sendSms(t.phone, msg); if (r?.ok !== false) channels.push('sms') } catch { /* email may have landed */ } }
      sent.push({ name: `${t.first_name} ${t.last_name}`, channels })
    }
    // Report who we skipped as counts by reason, not a roster of people who
    // stopped coming — the same wall of dead names the Week B receipt grew.
    const skipped = {}
    for (const t of (trainees || [])) {
      if (targets.some((x) => x.id === t.id)) continue
      const why = t.declined_at ? 'declined' : t.dropped_out_at ? 'dropped out'
        : t.enrolled === false ? 'not enrolled' : signed.has(t.id) ? 'already signed'
        : (!t.phone && !t.email) ? 'no phone or email' : 'not in this send'
      skipped[why] = (skipped[why] || 0) + 1
    }
    return cors(200, { ok: true, dry_run: !!body.dry_run, count: sent.length, sent, skipped_summary: skipped })
  }

  // ── everything else is trainee-facing and keyed by their token ─────────────
  const token = String(body.token || '').trim()
  if (!token) return cors(400, { ok: false, error: 'token required' })
  const { data: trainee } = await supabase
    .from('trainees')
    .select('id, first_name, last_name, phone, email, class_id, street_address, city, state, zip')
    .eq('registration_token', token)
    .maybeSingle()
  if (!trainee) return cors(404, { ok: false, error: 'That link is not valid. Ask your trainer for a new one.' })

  const { data: existing } = await supabase
    .from('trainee_onboarding').select('*').eq('trainee_id', trainee.id).maybeSingle()

  // "See you tomorrow" only if that's true. Week A starts on the class's own
  // Monday; Week B a week later. Anything else and we name the day instead of
  // guessing.
  const { data: cls } = trainee.class_id
    ? await supabase.from('classes').select('week_start_date').eq('id', trainee.class_id).maybeSingle()
    : { data: null }
  const nextSession = nextSessionLabel(cls?.week_start_date)

  if (action === 'load') {
    const safe = { ...(existing || {}) }
    for (const k of SECRET) if (safe[k]) safe[k] = '' // never send these back down
    return cors(200, {
      ok: true,
      trainee: {
        first_name: trainee.first_name, last_name: trainee.last_name,
        phone: trainee.phone, email: trainee.email,
        street_address: trainee.street_address, city: trainee.city, state: trainee.state, zip: trainee.zip,
      },
      saved: safe,
      next_session: nextSession,
      signed: !!existing?.signed_at,
      banking_done: !!existing?.banking_completed_at,
      secrets_on_file: Object.fromEntries(SECRET.map((k) => [k, !!existing?.[k]])),
    })
  }

  const fields = body.fields && typeof body.fields === 'object' ? body.fields : {}
  const patch = {}
  for (const k of WRITABLE) {
    if (!(k in fields)) continue
    const v = fields[k]
    // A blank secret means "leave what's already saved" — the page never sees
    // the stored value, so an empty box must not wipe it.
    if (SECRET.includes(k) && !String(v || '').trim()) continue
    patch[k] = v === '' ? null : v
  }
  patch.trainee_id = trainee.id
  patch.class_id = trainee.class_id
  patch.updated_at = new Date().toISOString()
  if (bankingComplete({ ...(existing || {}), ...patch }) && !existing?.banking_completed_at) {
    patch.banking_completed_at = new Date().toISOString()
  }

  if (action === 'save') {
    const { error } = await supabase.from('trainee_onboarding').upsert(patch, { onConflict: 'trainee_id' })
    if (error) return cors(500, { ok: false, error: error.message })
    return cors(200, { ok: true, saved: true, next_session: nextSession })
  }

  if (action === 'submit') {
    if (existing?.signed_at) return cors(200, { ok: true, already_signed: true })
    const missing = []
    if (!patch.sign_name && !existing?.sign_name) missing.push('your printed name')
    if (!patch.w9_name && !existing?.w9_name) missing.push('the W-9 name')
    if (!patch.w9_tin && !existing?.w9_tin) missing.push('your SSN or EIN')
    if (!body.signature) missing.push('your signature')
    if (missing.length) return cors(400, { ok: false, error: `Still needed: ${missing.join(', ')}.` })

    const nowIso = new Date().toISOString()
    const ip = event.headers?.['x-nf-client-connection-ip'] || event.headers?.['client-ip'] || null
    const merged = { ...(existing || {}), ...patch, signature: body.signature, signed_at: nowIso, sign_ip: ip }

    // Render both PDFs. Best-effort, deliberately: a rendering failure must
    // never lose a signature we've already collected — we save the submission
    // and record pdf_error so it can be regenerated from the stored fields.
    let w9Path = null, agreementPath = null, pdfError = null
    try {
      const w9 = await fillW9Pdf(merged)
      w9Path = await storeFile(supabase, `${trainee.id}/w9_${Date.now()}.pdf`, w9)
    } catch (e) { pdfError = `w9: ${e.message}` }
    // THE AGREEMENT PDF IS NOT RENDERED HERE ANY MORE.
    //
    // It is a contract between two parties and this is only one of them. Rendering
    // it the moment the rep signs filed a document with the U.S. Shingle side of
    // the signature block blank — not an executed agreement (Neal, 2026-08-24).
    // countersign-agreement.js renders it once Jennifer has signed too.
    //
    // The W-9 above is unaffected: that one genuinely is the rep's alone.

    const { error } = await supabase.from('trainee_onboarding').upsert({
      ...patch, signature: body.signature, signed_at: nowIso, sign_ip: ip,
      w9_pdf_path: w9Path, agreement_pdf_path: agreementPath, pdf_error: pdfError,
    }, { onConflict: 'trainee_id' })
    if (error) return cors(500, { ok: false, error: error.message })

    // Text Jennifer to countersign. Best-effort on purpose: a failed text must
    // never cost us a signature the rep has already given, and the link can be
    // resent. Fetch the token that the row's default generated.
    let countersignSent = false
    try {
      const { data: fresh, error: tokErr } = await supabase.from('trainee_onboarding')
        .select('countersign_token').eq('trainee_id', trainee.id).maybeSingle()
      const tok = fresh?.countersign_token
      // SAY SO WHEN THERE IS NO TOKEN. Monday's Week A class signed while
      // sql/ic_countersign.sql was still unrun: the column did not exist, this
      // select errored, `tok` came back undefined, and the whole notify block
      // was skipped without a sound. Nine agreements sat signed by one party
      // with Jennifer never told there was anything to sign (Neal, 2026-08-25).
      if (!tok) {
        console.error('COUNTERSIGN NOT SENT — no token for', trainee.id,
          tokErr ? `(${tokErr.message} — has sql/ic_countersign.sql been run?)` : '(token column is null)')
      }
      if (tok) {
        const site = (process.env.PUBLIC_SITE_URL || process.env.URL || 'https://trainingmanagementsys.netlify.app').replace(/\/$/, '')
        const who = `${trainee.first_name || ''} ${trainee.last_name || ''}`.trim() || merged.sign_name || 'A new rep'
        const link = `${site}/.netlify/functions/countersign-agreement?t=${tok}`
        // BOTH channels, as everything else here does — a text alone misses
        // anyone on DND or opted out of the GHL number, and this one holds up an
        // agreement until it is answered.
        await Promise.allSettled([
          sendSms(COUNTERSIGNER.phone,
            `${who} just signed their Independent Contractor Agreement. It needs your signature to be complete:\n\n${link}`,
            { firstName: 'Training', lastName: 'System' }),
          sendEmail(COUNTERSIGNER.email,
            `Countersign needed — ${who}`,
            [`${who} has just signed their Independent Contractor Agreement.`, '',
             'It is not complete until U.S. Shingle signs it too, and the PDF is not created until you do.', '',
             'Sign here:', link, '',
             'It takes a few seconds and works on your phone.', '',
             '— Training System'].join('\n')),
        ])
        await supabase.from('trainee_onboarding').update({ countersign_sent_at: new Date().toISOString() }).eq('trainee_id', trainee.id)
        countersignSent = true
      }
    } catch { /* the office can resend; never block the rep */ }

    await deliver(supabase, trainee, { ...merged, _next_session: nextSession }, { w9Path, agreementPath }).catch(() => {})
    return cors(200, { ok: true, signed: true, pdf_error: pdfError, next_session: nextSession, countersign_sent: countersignSent })
  }

  return cors(400, { ok: false, error: `Unknown action: ${action}` })
}

// Friendly sentence about when they're next due in — "See you tomorrow" when
// that's literally true, otherwise the day, so a confirmation is never wrong.
function nextSessionLabel(weekStartDate) {
  if (!weekStartDate) return 'See you in class.'
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const today = new Date(Date.UTC(et.getFullYear(), et.getMonth(), et.getDate()))
  const weekA = new Date(`${weekStartDate}T00:00:00Z`)
  const weekB = new Date(weekA.getTime() + 7 * 86400000)
  const next = [weekA, weekB].find((d) => d >= today)
  if (!next) return 'See you in class.'
  const days = Math.round((next - today) / 86400000)
  if (days === 0) return 'See you today.'
  if (days === 1) return 'See you tomorrow.'
  return `See you ${next.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })}.`
}

// Banking counts as done only with the pieces payroll actually needs.
function bankingComplete(d) {
  return !!(d.bank_name && d.bank_account_name && d.bank_routing && d.bank_account_number)
}

async function storeFile(supabase, path, base64) {
  const { error } = await supabase.storage.from(BUCKET)
    .upload(path, Buffer.from(base64, 'base64'), { contentType: 'application/pdf', upsert: true })
  if (error) throw new Error(error.message)
  return path
}

// Email the signed pair to the rep and to the office (Jenn). Attachments come
// straight from the bucket so what's sent is exactly what's stored.
async function deliver(supabase, trainee, d, { w9Path, agreementPath }) {
  const attachments = []
  for (const [name, path] of [['Independent-Contractor-Agreement.pdf', agreementPath], ['W-9.pdf', w9Path]]) {
    if (!path) continue
    const { data } = await supabase.storage.from(BUCKET).download(path)
    if (data) attachments.push({ filename: name, content: Buffer.from(await data.arrayBuffer()).toString('base64') })
  }
  const who = `${d.sign_name || trainee.first_name} ${trainee.last_name || ''}`.trim()
  const nowIso = new Date().toISOString()

  if (trainee.email) {
    await sendEmail(trainee.email, 'Your signed U.S. Shingle paperwork',
      `Hi ${trainee.first_name || 'there'},\n\nThank you — we've got everything. ${d._next_session || 'See you in class.'}\n\n` +
      // The agreement is NOT attached here any more: it is not rendered until the
      // company countersigns, so this promised a document it could not carry.
      // countersign-agreement emails the executed copy when Jennifer signs.
      `Attached is your W-9. Keep it for your records.\n\n` +
      `Your Independent Contractor Agreement goes to our office for signature — once it is countersigned we'll email you the completed copy with both signatures on it.\n\n` +
      (d.banking_completed_at ? '' : 'One thing still outstanding: we don\'t have your direct deposit details yet. You can add them any time using the same link — we\'ll send a reminder each day until they\'re in, so you get paid on time.\n\n') +
      '— U.S. Shingle & Metal Training', { attachments }).catch(() => {})
    await supabase.from('trainee_onboarding').update({ emailed_rep_at: nowIso }).eq('trainee_id', trainee.id)
  }

  const { data: office } = await supabase
    .from('notification_recipients').select('email, role, active')
    .in('role', ['hr', 'admin'])
  const to = [...new Set((office || []).filter((r) => r.active !== false && r.email).map((r) => r.email))]
  for (const addr of to) {
    await sendEmail(addr, `Signed paperwork — ${who}`,
      `${who} signed their W-9 and Independent Contractor Agreement just now. The agreement is waiting on the company countersignature — the executed copy follows once it is signed.\n\n` +
      `Phone: ${d.agent_phone || trainee.phone || '—'}\nEmail: ${d.agent_email || trainee.email || '—'}\n` +
      `Direct deposit: ${d.banking_completed_at ? 'on file' : 'NOT YET PROVIDED — they\'ll be reminded daily until it is'}\n\n` +
      'Both documents are attached.', { attachments }).catch(() => {})
  }
  if (to.length) await supabase.from('trainee_onboarding').update({ emailed_office_at: nowIso }).eq('trainee_id', trainee.id)
}

// Fill the official IRS Form W-9 so the stored copy keeps the government layout.
async function fillW9Pdf(c) {
  const pdf = await PDFDocument.load(Buffer.from(W9_B64, 'base64'))
  const form = pdf.getForm()
  const P = 'topmostSubform[0].Page1[0].'
  const B = P + 'Boxes3a-b_ReadOrder[0].'
  const set = (n, v) => { try { const f = form.getTextField(n); f.setText(String(v ?? '')); f.setFontSize(9) } catch { /* absent */ } }
  const check = (n) => { try { form.getCheckBox(n).check() } catch { /* absent */ } }

  set(P + 'f1_01[0]', c.w9_name)
  set(P + 'f1_02[0]', c.w9_business_name || c.business_name)
  set(P + 'Address_ReadOrder[0].f1_07[0]', c.w9_address)
  set(P + 'Address_ReadOrder[0].f1_08[0]', c.w9_city_state_zip)

  const cls = String(c.w9_tax_classification || '').toLowerCase()
  if (cls.includes('individual') || cls.includes('sole')) check(B + 'c1_1[0]')
  else if (cls.includes('c corp')) check(B + 'c1_1[1]')
  else if (cls.includes('s corp')) check(B + 'c1_1[2]')
  else if (cls.includes('partnership')) check(B + 'c1_1[3]')
  else if (cls.includes('trust') || cls.includes('estate')) check(B + 'c1_1[4]')
  else if (cls === 'llc' || cls.includes('limited liability')) { check(B + 'c1_1[5]'); set(B + 'f1_03[0]', c.w9_llc_class) }
  else if (cls) { check(B + 'c1_1[6]'); set(B + 'f1_04[0]', c.w9_tax_classification) }

  const digits = String(c.w9_tin || '').replace(/\D/g, '')
  if (c.w9_tin_type === 'ein') { set(P + 'f1_14[0]', digits.slice(0, 2)); set(P + 'f1_15[0]', digits.slice(2, 9)) }
  else { set(P + 'f1_11[0]', digits.slice(0, 3)); set(P + 'f1_12[0]', digits.slice(3, 5)); set(P + 'f1_13[0]', digits.slice(5, 9)) }

  try {
    const page = pdf.getPage(0)
    const dt = new Date(c.signed_at || Date.now())
    let drew = false
    if (c.signature && String(c.signature).startsWith('data:image')) {
      try {
        const png = await pdf.embedPng(Buffer.from(String(c.signature).replace(/^data:image\/\w+;base64,/, ''), 'base64'))
        const w = 145, h = Math.min((png.height / png.width) * w, 24)
        page.drawImage(png, { x: 128, y: 196, width: w, height: h })
        drew = true
      } catch { /* fall back to typed */ }
    }
    const helv = await pdf.embedFont(StandardFonts.Helvetica)
    if (!drew && c.sign_name) page.drawText(String(c.sign_name), { x: 130, y: 200, size: 10, font: helv })
    page.drawText(`${dt.getMonth() + 1}/${dt.getDate()}/${dt.getFullYear()}`, { x: 470, y: 200, size: 9, font: helv })
  } catch { /* signature stamp is cosmetic — never fail the fill for it */ }

  form.flatten()
  return Buffer.from(await pdf.save()).toString('base64')
}

function cors(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
    body: JSON.stringify(body),
  }
}
