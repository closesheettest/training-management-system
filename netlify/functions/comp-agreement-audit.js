// Who has signed the Draw Program + Inspection Compensation Plan, and who has not.
//
//   GET  → { ok, sent_to, counts, reps: [...] }
//
// Built because the documents went out to 28 reps and there was no way to see
// what came back. The only signal was Jenn's inbox filling up, and the only way
// to spot who ignored it was noticing who never appeared in it (Neal, 2026-09-11).
//
// FOUR states, not two. The two documents carry SEPARATE signatures, so a rep who
// signs the Draw Program, gets interrupted and never signs the Compensation Plan
// looks exactly like a rep who never opened the text — and they need completely
// different follow-ups. One needs a nudge, the other needs a phone call.
//
//   not_opened  the link has never been opened
//   opened      opened, nothing signed
//   partial     one document signed, the other not  ← the one worth catching
//   signed      both signed
//
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY.

import { createClient } from '@supabase/supabase-js'

const BUCKET = 'trainee-docs'
const json = (code, obj) => ({
  statusCode: code,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(obj),
})

// Excluded from the 11 Sep send: Neal himself, Jenn (who receives the signed
// copies), and two active inspectors who carry the sales-rep flag. Kept here so
// the audit counts the same people the message actually went to — an audit that
// silently uses a different list is worse than none.
// William Hernandez is the TRAINER, not a sales rep — he carries the
// is_active_sales_rep flag (which is why the 11 Sep send reached him) and tops
// the signing leaderboards, but he is not on the rep comp plan and has nothing
// to sign (Neal, 2026-09-11). Excluded here so he stops counting as outstanding
// and is never nudged; the flag itself is left alone because other reports read
// it and turning it off would quietly change them too.
const NOT_A_FIELD_REP = new Set([
  'neal scoppe', 'jennifer vongraupen', 'dewayne kohrn', 'nikki macella', 'william hernandez',
  // Dustin Hunt books inbound calls as a setter; he is not on the rep comp plan
  // either (Neal, 2026-09-11). Six people now carry is_active_sales_rep without
  // being field reps, which is the flag's problem rather than this list's — a
  // separate field-rep flag would stop every future send needing this list.
  'dustin hunt',
])

export const handler = async () => {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) return json(500, { ok: false, error: 'env missing' })
  const supabase = createClient(url, key)

  const { data: reps, error } = await supabase
    .from('trainees')
    .select('id, first_name, last_name, phone, email, company_email, registration_token')
    .eq('is_active_sales_rep', true)
    .order('first_name')
  if (error) return json(500, { ok: false, error: error.message })

  const field = (reps || []).filter(
    (r) => !NOT_A_FIELD_REP.has(`${r.first_name || ''} ${r.last_name || ''}`.trim().toLowerCase()),
  )
  // (field can legitimately be empty if every rep is excluded; classes still count)

  // TRAINEES TOO. The documents also went to the people who were in class this
  // week, and they carry no is_active_sales_rep flag — so the audit could see the
  // field reps and nothing else, and eleven signatures were only trackable by
  // watching Jenn's inbox (Neal, 2026-09-11).
  //
  // The roster is WHO SIGNED IN ON THE CLASS'S MOST RECENT TRAINING DAY, never who
  // enrolled. Enrollment counts people who never walked in the door: the class
  // that finished on 10 Sep had 9 enrolled, 6 who ever signed in, and 3 who
  // finished. Reading class_id alone would have this page chasing signatures from
  // six people who are, in Neal's words, dead to us.
  //
  // Picking it up from attendance rather than a stored list means the next class
  // appears here on its own, with no second list to keep in step.
  const since = new Date(Date.now() - 45 * 86400000).toLocaleDateString('en-CA')
  const { data: classes } = await supabase
    .from('classes')
    .select('id, week_start_date, week_end_date')
    .is('cancelled_at', null)
    .gte('week_end_date', since)
  const classRoster = []
  for (const cl of classes || []) {
    const { data: att } = await supabase
      .from('attendance').select('trainee_id, attendance_date').eq('class_id', cl.id)
    if (!att || !att.length) continue
    const lastDay = att.reduce((a, r) => (r.attendance_date > a ? r.attendance_date : a), '')
    const ids = [...new Set(att.filter((r) => r.attendance_date === lastDay).map((r) => r.trainee_id))]
    if (!ids.length) continue
    const { data: tr } = await supabase
      .from('trainees').select('id, first_name, last_name, phone, email, company_email, registration_token').in('id', ids)
    for (const t of tr || []) classRoster.push({ ...t, group: `Class ${cl.week_start_date}`, last_day: lastDay })
  }

  // A trainee already flagged as a field rep is one person, not two rows.
  const seen = new Set(field.map((r) => r.id))
  const everyone = [
    ...field.map((r) => ({ ...r, group: 'Field rep' })),
    ...classRoster.filter((r) => !seen.has(r.id) && (seen.add(r.id), true)),
  ]

  const { data: rows } = await supabase
    .from('trainee_onboarding')
    .select('trainee_id, comp_opened_at, comp_draw_signed_at, comp_plan_signed_at, comp_signed_at, comp_agreement_pdf_path, comp_pdf_error')
    .in('trainee_id', everyone.map((r) => r.id))
  const byId = new Map((rows || []).map((r) => [r.trainee_id, r]))

  const out = []
  for (const r of everyone) {
    const o = byId.get(r.id) || {}
    const draw = !!o.comp_draw_signed_at, plan = !!o.comp_plan_signed_at
    const state = o.comp_signed_at ? 'signed' : (draw || plan) ? 'partial' : o.comp_opened_at ? 'opened' : 'not_opened'
    // A signed PDF is the rep's own pay document — hand back a short-lived link
    // rather than a permanent public URL.
    let pdf = null
    if (o.comp_agreement_pdf_path) {
      const { data: s } = await supabase.storage.from(BUCKET).createSignedUrl(o.comp_agreement_pdf_path, 3600)
      pdf = (s && s.signedUrl) || null
    }
    out.push({
      id: r.id,
      name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
      group: r.group,
      phone: r.phone || null,
      email: r.company_email || r.email || null,
      state,
      draw_signed_at: o.comp_draw_signed_at || null,
      plan_signed_at: o.comp_plan_signed_at || null,
      opened_at: o.comp_opened_at || null,
      signed_at: o.comp_signed_at || null,
      pdf,
      // A signature saved with no document behind it is the failure worth seeing,
      // not hiding — it is recoverable only while somebody knows about it.
      pdf_error: o.comp_pdf_error || null,
      link: r.registration_token ? `/comp-agreement/${r.registration_token}` : null,
    })
  }

  const order = { partial: 0, opened: 1, not_opened: 2, signed: 3 };   // needs-attention first
  out.sort((a, b) => (order[a.state] - order[b.state]) || a.name.localeCompare(b.name))

  const counts = out.reduce((a, r) => ({ ...a, [r.state]: (a[r.state] || 0) + 1 }), {})
  return json(200, { ok: true, sent_to: out.length, counts, reps: out })
}
