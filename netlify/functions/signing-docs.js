// signing-docs.js — DOCUMENTS SENT FOR SIGNING (Neal, 2026-10-01).
//
// One page for every document we send reps to e-sign, grouped by document, with each
// rep's trail (sent → opened → signed → countersigned), a resend, and where the signed
// copies go. Used by /signing-docs (TMS), which sits on Neal's and Jenn's My Tools.
//
// Documents:
//   comp        Draw Program + Inspection Compensation Plan   /comp-agreement/<token>
//   onboarding  Day-1: W-9 + Independent Contractor Agreement  /onboarding/<token>
//
// Every call carries the admin PIN (the same per-person PINs as the Regional Managers
// page, CCG regional-admin-pin) and is re-checked here: the page holds phones, emails
// and links to signed pay documents.
//
//   POST { pin, action:'list' }                                → { ok, docs:[…] }
//   POST { pin, action:'resend', doc, ids:[trainee_id] }       → { ok, results:[…] }
//   POST { pin, action:'copy_to', doc, emails:[…] }            → { ok, copy_to }
//   POST { pin, action:'contact', id, phone, email }           → { ok, contact }   (send-to override)
//   POST { pin, action:'sms_help', id }                        → { ok, blocked, from_number, last }  ("not getting texts")
//
// Resends are logged (app_settings signing_sends) so the trail shows every send.
// Where signed copies go: app_settings signing_copy_to_<doc> (comp-agreement-api and
// trainee-onboarding-api read it; empty = their built-in default).
//
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY, URL, + the GHL / Resend keys for sending.
import { createClient } from '@supabase/supabase-js'
import { sendEmail } from './_email.js'
import { sendSmsViaGhl } from './_ghl.js'

const BUCKET = 'trainee-docs'
const PIN_URL = 'https://free-roof-inspections.netlify.app/.netlify/functions/regional-admin-pin'
const SITE = (process.env.URL || 'https://trainingmanagementsys.netlify.app').replace(/\/$/, '')
const json = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) })

export const DOCS = {
  comp: {
    title: 'Draw Program + Inspection Compensation Plan',
    blurb: 'Two signatures on one form. Sent to every rep and that week’s class on 9/11; since 10/1 it is part of Day-1 onboarding (it follows the W-9 + contractor agreement). Only active reps and trainees still in class are listed.',
    default_copy_to: ['JennV@shingleusa.com'],
    path: (t) => `/comp-agreement/${t}`,
    sms: (first, link, firstTime) => `Hi ${first}, this is the corporate office. ${firstTime ? 'Please sign' : 'You still need to sign'} the Draw Program and Inspection Compensation Plan — it takes two minutes and two signatures: ${link}\nYour signed copy goes to Jenn automatically.`,
    subject: 'Please sign: Draw Program + Inspection Compensation Plan',
    email: 'You still need to sign the <b>Draw Program</b> and the <b>Inspection Compensation Plan</b>. It takes two minutes and two signatures. Your signed copy goes to Jenn automatically.',
  },
  onboarding: {
    title: 'Day-1 paperwork: W-9 + Independent Contractor Agreement',
    blurb: 'Sent when a trainee checks in on Day 1. The rep signs, then Jenn countersigns.',
    default_copy_to: [], // empty = the HR/admin notification recipients, as before
    path: (t) => `/onboarding/${t}`,
    sms: (first, link) => `Hi ${first}, this is the corporate office. We still need your W-9 and Independent Contractor Agreement — it only takes a few minutes: ${link}`,
    subject: 'We still need your U.S. Shingle paperwork',
    email: 'We still need your <b>W-9</b> and <b>Independent Contractor Agreement</b>. It only takes a few minutes.',
  },
}

async function adminOk(pin) {
  if (!pin) return null
  try {
    const r = await fetch(PIN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'verify', pin: String(pin) }) })
    const d = await r.json()
    return d.valid ? (d.name || 'admin') : null
  } catch { return null }
}

const getSetting = async (sb, key, fallback) => {
  const { data } = await sb.from('app_settings').select('value').eq('key', key).maybeSingle()
  if (!data) return fallback
  try { return typeof data.value === 'string' ? JSON.parse(data.value) : data.value } catch { return fallback }
}
const putSetting = (sb, key, value) => sb.from('app_settings').upsert({ key, value: JSON.stringify(value), updated_at: new Date().toISOString() }, { onConflict: 'key' })

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false })
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  let body = {}
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { ok: false, error: 'bad JSON' }) }
  const who = await adminOk(body.pin)
  if (!who) return json(401, { ok: false, error: 'Sign in again (PIN not recognised).' })
  const sends = await getSetting(sb, 'signing_sends', {}) // { doc: { trainee_id: [{at,by,sms,email}] } }

  // WHERE TO SEND IT (Neal, 2026-10-01): a rep who isn't getting it can be given another
  // phone / email for these documents. Stored as an override (app_settings
  // signing_contacts) — their main record and every other message are untouched. Blank both
  // to go back to what's on file.
  const contacts = await getSetting(sb, 'signing_contacts', {})
  if (body.action === 'contact') {
    const id = String(body.id || '')
    if (!id) return json(400, { ok: false, error: 'id required' })
    const phone = String(body.phone || '').trim(), email = String(body.email || '').trim()
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { ok: false, error: 'That email doesn’t look right.' })
    if (phone && String(phone).replace(/\D/g, '').length < 10) return json(400, { ok: false, error: 'That phone number looks too short.' })
    if (!phone && !email) delete contacts[id]
    else contacts[id] = { phone: phone || null, email: email || null, by: who, at: new Date().toISOString() }
    await putSetting(sb, 'signing_contacts', contacts)
    return json(200, { ok: true, contact: contacts[id] || null })
  }

  // "THEY SAY THEY'RE NOT GETTING THE TEXTS" (Neal, 2026-10-01). Almost always they once
  // replied STOP, which turns on Do-Not-Disturb in GoHighLevel, and every text since has been
  // dropped. The cure is the rep texting START to the number our texts come from — and GHL
  // picks that number per person, so look it up rather than guess.
  if (body.action === 'sms_help') {
    const { data: t } = await sb.from('trainees').select('id, phone').eq('id', String(body.id || '')).maybeSingle()
    const phone = contacts[body.id]?.phone || t?.phone
    if (!phone) return json(200, { ok: true, found: false, reason: 'No phone number on file.' })
    const GHL = 'https://services.leadconnectorhq.com', loc = process.env.GHL_LOCATION_ID
    const H = { Authorization: `Bearer ${process.env.GHL_PIT_TOKEN}`, Accept: 'application/json' }
    try {
      const dup = await (await fetch(`${GHL}/contacts/search/duplicate?locationId=${encodeURIComponent(loc)}&number=${encodeURIComponent(phone)}`, { headers: { ...H, Version: '2021-07-28' } })).json()
      const cid = dup?.contact?.id
      if (!cid) return json(200, { ok: true, found: false, phone, reason: 'That number isn’t in GoHighLevel yet — the next send will add it.' })
      const c = (await (await fetch(`${GHL}/contacts/${cid}`, { headers: { ...H, Version: '2021-07-28' } })).json())?.contact || {}
      const smsDnd = c.dndSettings?.SMS?.status === 'active'
      const blocked = !!(c.dnd || smsDnd)
      let fromNumber = null, last = null
      const cs = await (await fetch(`${GHL}/conversations/search?locationId=${encodeURIComponent(loc)}&contactId=${cid}`, { headers: { ...H, Version: '2021-04-15' } })).json()
      const conv = (cs.conversations || [])[0]
      if (conv) {
        const md = await (await fetch(`${GHL}/conversations/${conv.id}/messages?limit=20`, { headers: { ...H, Version: '2021-04-15' } })).json()
        const msgs = Array.isArray(md.messages) ? md.messages : (md.messages?.messages || [])
        const out = msgs.find((m) => m.direction === 'outbound' && /sms/i.test(String(m.messageType || m.type || 'sms')))
        if (out) { fromNumber = out.from || out.fromNumber || null; last = { at: out.dateAdded || null, status: out.status || null } }
      }
      return json(200, { ok: true, found: true, phone, blocked, from_number: fromNumber || '+17277615200', from_is_default: !fromNumber, last })
    } catch (e) { return json(200, { ok: false, error: `Couldn’t check GoHighLevel: ${e.message}` }) }
  }

  if (body.action === 'copy_to') {
    const doc = DOCS[body.doc]
    if (!doc) return json(400, { ok: false, error: 'unknown document' })
    const emails = [...new Set((body.emails || []).map((e) => String(e).trim()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))]
    await putSetting(sb, `signing_copy_to_${body.doc}`, emails)
    return json(200, { ok: true, copy_to: emails })
  }

  if (body.action === 'resend') {
    const doc = DOCS[body.doc]
    if (!doc) return json(400, { ok: false, error: 'unknown document' })
    const ids = (body.ids || []).map(String).slice(0, 100)
    const { data: people } = await sb.from('trainees').select('id, first_name, last_name, phone, email, company_email, registration_token').in('id', ids)
    const results = []
    for (const t of people || []) {
      if (!t.registration_token) { results.push({ id: t.id, name: `${t.first_name} ${t.last_name}`, error: 'no signing link on file' }); continue }
      const link = `${SITE}${doc.path(t.registration_token)}`
      const first = (t.first_name || 'there').trim()
      const ov = contacts[t.id] || {}
      const phoneTo = ov.phone || t.phone
      const firstTime = !((sends[body.doc] || {})[t.id] || []).length && !!(body.first_ids || []).includes(t.id)
      const sms = phoneTo ? await sendSmsViaGhl(phoneTo, doc.sms(first, link, firstTime), { firstName: first, lastName: t.last_name || '' }).catch((e) => ({ ok: false, error: e.message })) : { ok: false, error: 'no phone' }
      const to = ov.email || t.company_email || t.email
      const html = `<div style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.5"><p>Hi ${first},</p><p>This is the U.S. Shingle corporate office. ${doc.email}</p><p><a href="${link}" style="display:inline-block;background:#1a2e5a;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700">Open and sign</a></p><p>— U.S. Shingle corporate office</p></div>`
      const em = to ? await sendEmail(to, doc.subject, html).catch((e) => ({ ok: false, error: e.message })) : { ok: false, error: 'no email' }
      const entry = { at: new Date().toISOString(), by: who, sms: !!sms?.ok, email: !!(em && em.ok !== false), to_phone: phoneTo || null, to_email: to || null }
      ;((sends[body.doc] = sends[body.doc] || {})[t.id] = sends[body.doc][t.id] || []).push(entry)
      results.push({ id: t.id, name: `${t.first_name} ${t.last_name}`, ...entry })
    }
    await putSetting(sb, 'signing_sends', sends)
    return json(200, { ok: true, results })
  }

  // ── list ─────────────────────────────────────────────────────────────────
  const out = []
  // ONLY PEOPLE STILL HERE (Neal, 2026-10-01): an active rep, a field trainee, or someone in
  // a class right now (Day-1 link sent in the last 14 days). Past-class people who left or
  // never started are dropped, so "Resend to all outstanding" can never text them.
  const stillHere = async (ids) => {
    if (!ids.length) return new Set()
    const { data } = await sb.from('trainees').select('id, is_active_sales_rep, is_field_trainee, dropped_out_at, declined_at, enrolled, onboarding_sms_sent_at').in('id', ids)
    const recent = Date.now() - 14 * 86400000
    return new Set((data || []).filter((t) => !t.dropped_out_at && !t.declined_at && t.enrolled !== false
      && (t.is_active_sales_rep === true || t.is_field_trainee === true || (t.onboarding_sms_sent_at && Date.parse(t.onboarding_sms_sent_at) > recent))).map((t) => t.id))
  }
  // COMP — the same roster and states as comp-agreement-audit (field reps + the recent
  // classes' last-day attendance), so the two can never disagree.
  try {
    const a = await (await fetch(`${SITE}/.netlify/functions/comp-agreement-audit`)).json()
    const here = await stillHere((a.reps || []).map((r) => r.id))
    // NOT SENT YET (Neal, 2026-10-01): someone on the active roster who has never opened it
    // and has no recorded send. Every send since 10/1 is logged, and new trainees get it inside
    // onboarding (which stamps "opened"), so no log + never opened = it never reached them. The
    // 9/11 blast predates the log, so a field rep with no trail is counted as sent on 9/11.
    const SENT_911 = '2026-09-11T16:00:00.000Z'
    const reps = (a.reps || []).filter((r) => here.has(r.id)).map((r) => ({
      id: r.id, name: r.name, group: r.group, phone: contacts[r.id]?.phone || r.phone, email: contacts[r.id]?.email || r.email,
      on_file: { phone: r.phone, email: r.email }, override: contacts[r.id] || null, pdf: r.pdf, pdf_error: r.pdf_error,
      state: r.state === 'not_opened' && !((sends.comp || {})[r.id] || []).length && (/^Class /.test(r.group) ? r.group.slice(6) > '2026-09-11' : false) ? 'not_sent' : r.state,
      trail: [
        ...(r.opened_at ? [{ at: r.opened_at, what: 'Opened the link' }] : []),
        ...(r.draw_signed_at ? [{ at: r.draw_signed_at, what: 'Signed the Draw Program' }] : []),
        ...(r.plan_signed_at ? [{ at: r.plan_signed_at, what: 'Signed the Compensation Plan' }] : []),
        ...(r.signed_at ? [{ at: r.signed_at, what: 'Fully signed — copy emailed' }] : []),
        ...((sends.comp || {})[r.id] || []).map((s) => ({ at: s.at, what: `Re-sent by ${s.by} (${[s.sms && `text to ${s.to_phone || '?'}`, s.email && `email to ${s.to_email || '?'}`].filter(Boolean).join(' + ') || 'failed'})` })),
        ...(contacts[r.id] ? [{ at: contacts[r.id].at, what: `Send-to changed by ${contacts[r.id].by}: ${[contacts[r.id].phone, contacts[r.id].email].filter(Boolean).join(' · ')}` }] : []),
      ].sort((x, y) => String(x.at).localeCompare(String(y.at))),
    }))
    out.push({ key: 'comp', title: DOCS.comp.title, blurb: DOCS.comp.blurb, copy_to: await getSetting(sb, 'signing_copy_to_comp', DOCS.comp.default_copy_to), reps })
  } catch (e) { out.push({ key: 'comp', title: DOCS.comp.title, error: e.message, reps: [] }) }

  // ONBOARDING — everyone sent the Day-1 link in the last 150 days who is still with us.
  try {
    const since = new Date(Date.now() - 150 * 86400000).toISOString()
    const { data: tr } = await sb.from('trainees')
      .select('id, first_name, last_name, phone, email, company_email, registration_token, onboarding_sms_sent_at, dropped_out_at, declined_at, enrolled')
      .gte('onboarding_sms_sent_at', since).order('onboarding_sms_sent_at', { ascending: false }).limit(500)
    const here = await stillHere((tr || []).map((t) => t.id))
    const live = (tr || []).filter((t) => here.has(t.id))
    const { data: ob } = live.length ? await sb.from('trainee_onboarding')
      .select('trainee_id, created_at, signed_at, countersign_sent_at, company_signed_at, banking_completed_at, agreement_pdf_path, w9_pdf_path, pdf_error')
      .in('trainee_id', live.map((t) => t.id)) : { data: [] }
    const byId = new Map((ob || []).map((r) => [r.trainee_id, r]))
    const reps = []
    for (const t of live) {
      const o = byId.get(t.id) || {}
      const state = o.company_signed_at ? 'signed' : o.signed_at ? 'countersign' : o.created_at ? 'opened' : 'not_opened'
      let pdf = null
      const path = o.agreement_pdf_path
      if (path) { const { data: s } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600); pdf = s?.signedUrl || null }
      reps.push({
        id: t.id, name: `${t.first_name || ''} ${t.last_name || ''}`.trim(), group: 'Trainee',
        phone: contacts[t.id]?.phone || t.phone, email: contacts[t.id]?.email || t.company_email || t.email,
        on_file: { phone: t.phone, email: t.company_email || t.email }, override: contacts[t.id] || null,
        state, pdf, pdf_error: o.pdf_error || null,
        trail: [
          { at: t.onboarding_sms_sent_at, what: 'Link sent (text + email)' },
          ...(o.created_at ? [{ at: o.created_at, what: 'Opened and started' }] : []),
          ...(o.signed_at ? [{ at: o.signed_at, what: 'Rep signed the W-9 + agreement' }] : []),
          ...(o.countersign_sent_at ? [{ at: o.countersign_sent_at, what: 'Sent to Jenn to countersign' }] : []),
          ...(o.company_signed_at ? [{ at: o.company_signed_at, what: 'Countersigned — complete' }] : []),
          ...(o.banking_completed_at ? [{ at: o.banking_completed_at, what: 'Direct deposit added' }] : []),
          ...((sends.onboarding || {})[t.id] || []).map((s) => ({ at: s.at, what: `Re-sent by ${s.by} (${[s.sms && `text to ${s.to_phone || '?'}`, s.email && `email to ${s.to_email || '?'}`].filter(Boolean).join(' + ') || 'failed'})` })),
          ...(contacts[t.id] ? [{ at: contacts[t.id].at, what: `Send-to changed by ${contacts[t.id].by}: ${[contacts[t.id].phone, contacts[t.id].email].filter(Boolean).join(' · ')}` }] : []),
        ].sort((x, y) => String(x.at).localeCompare(String(y.at))),
      })
    }
    const order = { opened: 0, not_opened: 1, countersign: 2, signed: 3 }
    reps.sort((a, b) => order[a.state] - order[b.state] || a.name.localeCompare(b.name))
    out.push({ key: 'onboarding', title: DOCS.onboarding.title, blurb: DOCS.onboarding.blurb, copy_to: await getSetting(sb, 'signing_copy_to_onboarding', DOCS.onboarding.default_copy_to), reps })
  } catch (e) { out.push({ key: 'onboarding', title: DOCS.onboarding.title, error: e.message, reps: [] }) }

  return json(200, { ok: true, who, docs: out })
}
