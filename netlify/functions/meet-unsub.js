// meet-unsub.js — the unsubscribe link at the bottom of a public room's list emails.
//   GET ?r=<room>&h=<guest hash>&s=<signature> → turns that guest's "email me" off, shows a page.
// The signature (meet-email-background unsubSig) means nobody can unsubscribe someone else.
import { createClient } from '@supabase/supabase-js'
import { unsubSig } from './meet-email-background.js'

const page = (msg) => ({ statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' },
  body: `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed</title><body style="font-family:Georgia,serif;background:#FAF7F2;color:#1A4870;display:flex;align-items:center;justify-content:center;min-height:90vh;text-align:center;padding:20px"><div><h1 style="font-weight:600">${msg}</h1></div></body>` })

export const handler = async (event) => {
  const q = event.queryStringParameters || {}
  if (q.h === 'test') return page('This is how the unsubscribe page looks. (Test email — nothing changed.)')
  if (!q.r || !q.h || !q.s || q.s !== unsubSig(q.r, q.h)) return page('That unsubscribe link is not valid.')
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const key = `meet_guest_${q.r}_${q.h}`
  const { data } = await sb.from('app_settings').select('value').eq('key', key).maybeSingle()
  if (!data) return page('You are not on this list.')
  let g = {}; try { g = JSON.parse(data.value) } catch { /* keep empty */ }
  g.opt_in = false; g.unsubscribed_at = new Date().toISOString()
  await sb.from('app_settings').upsert({ key, value: JSON.stringify(g), updated_at: new Date().toISOString() }, { onConflict: 'key' })
  return page("You're unsubscribed. You won't get these emails anymore.")
}
