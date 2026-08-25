// countersign-resend.js
//
// Send Jennifer the countersign links for every agreement a rep has signed and
// the company has not.
//
// Monday's Week A class signed while sql/ic_countersign.sql was still unrun, so
// the notify step in trainee-onboarding-api found no token and skipped in
// silence. Those agreements are signed, stored, and waiting — but nobody told
// her. There was no way to send them after the fact, which is why this exists
// (Neal, 2026-08-25).
//
//   GET ?dry=1        list who is outstanding, send nothing
//   POST              send ONE digest listing every outstanding agreement
//   POST ?each=1      send a separate text+email per agreement
//
// The digest is the default on purpose: nine separate texts reads as a system
// malfunctioning, and she only needs one thing to work through.
//
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY.

import { createClient } from '@supabase/supabase-js'
import { sendEmail } from './_email.js'
import { sendSmsViaGhl as sendSms } from './_ghl.js'

const COUNTERSIGNER = { name: 'Jennifer VonGraupen', phone: '(941) 718-0032', email: 'JennV@shingleusa.com' }
const json = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj, null, 2) })

export const handler = async (event) => {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const qp = event.queryStringParameters || {}
  const dry = qp.dry === '1' || event.httpMethod === 'GET'
  const each = qp.each === '1'

  const { data: rows, error } = await supabase
    .from('trainee_onboarding')
    .select('trainee_id, sign_name, agent_legal_name, signed_at, countersign_token, countersign_sent_at')
    .not('signed_at', 'is', null)
    .is('company_signed_at', null)
    .order('signed_at', { ascending: true })

  if (error) {
    // The most likely cause by far, and worth saying rather than echoing a
    // bare Postgres error at whoever opened this.
    return json(500, { ok: false, error: error.message, hint: 'If this names a missing column, sql/ic_countersign.sql has not been run yet.' })
  }

  const site = (process.env.PUBLIC_SITE_URL || process.env.URL || 'https://trainingmanagementsys.netlify.app').replace(/\/$/, '')
  const link = (t) => `${site}/.netlify/functions/countersign-agreement?t=${t}`
  const named = (r) => (r.agent_legal_name || r.sign_name || r.trainee_id || 'A rep').trim()
  // ?skip=<trainee_id>,<trainee_id> — leave someone out without signing them.
  // Bret Dethlefsen was offboarded the week after he signed; countersigning is
  // the company EXECUTING that contract, so it should not happen by default for
  // someone who has left. His row just stays outstanding (Neal, 2026-08-25).
  const skip = new Set(String(qp.skip || '').split(',').map((x) => x.trim()).filter(Boolean))
  const ready = (rows || []).filter((r) => r.countersign_token && !skip.has(r.trainee_id))
  const skipped = (rows || []).filter((r) => skip.has(r.trainee_id)).map(named)
  const noToken = (rows || []).filter((r) => !r.countersign_token).map(named)

  if (dry) {
    return json(200, {
      ok: true, dry_run: true,
      outstanding: (rows || []).length,
      sendable: ready.length,
      skipped,
      missing_token: noToken,
      people: ready.map((r) => ({ who: named(r), signed_at: r.signed_at, already_told: r.countersign_sent_at, url: link(r.countersign_token) })),
    })
  }

  if (!ready.length) return json(200, { ok: true, sent: 0, note: 'nothing outstanding', missing_token: noToken })

  const sent = []
  if (each) {
    for (const r of ready) {
      const who = named(r)
      await Promise.allSettled([
        sendSms(COUNTERSIGNER.phone, `${who} signed their Independent Contractor Agreement. It needs your signature:\n\n${link(r.countersign_token)}`, { firstName: 'Training', lastName: 'System' }),
        sendEmail(COUNTERSIGNER.email, `Countersign needed — ${who}`, `${who} has signed. Sign here:\n\n${link(r.countersign_token)}`),
      ])
      sent.push(who)
    }
  } else {
    const lines = ready.map((r, i) => `${i + 1}. ${named(r)}\n   ${link(r.countersign_token)}`)
    const body = [
      `${ready.length} Independent Contractor Agreement${ready.length === 1 ? '' : 's'} ${ready.length === 1 ? 'is' : 'are'} waiting for your signature.`,
      '', 'Each one is signed by the rep already. The PDF is created once you sign.', '',
      ...lines, '', 'Each link takes a few seconds and works on your phone.', '', '— Training System',
    ].join('\n')
    await Promise.allSettled([
      sendSms(COUNTERSIGNER.phone, body, { firstName: 'Training', lastName: 'System' }),
      sendEmail(COUNTERSIGNER.email, `${ready.length} agreement${ready.length === 1 ? '' : 's'} need your signature`, body),
    ])
    sent.push(...ready.map(named))
  }

  const nowIso = new Date().toISOString()
  await supabase.from('trainee_onboarding').update({ countersign_sent_at: nowIso })
    .in('trainee_id', ready.map((r) => r.trainee_id))

  return json(200, { ok: true, sent: sent.length, mode: each ? 'one each' : 'digest', people: sent, skipped, missing_token: noToken })
}
