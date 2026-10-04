// set-class-virtual.js — adds a class to (or takes it off) app_settings.virtual_class_ids.
// Called by the calendar's "Add a training week" form, where Virtual is ticked by default
// (Neal, 2026-10-04: training is virtual now). Only classes that haven't started yet can be
// changed here, so nothing in the past gets re-labelled.
import { createClient } from '@supabase/supabase-js'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: '' }
  let b = {}
  try { b = JSON.parse(event.body || '{}') } catch { return { statusCode: 400, body: 'bad json' } }
  const id = String(b.class_id || '')
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { statusCode: 400, body: 'bad class_id' }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const { data: cls } = await sb.from('classes').select('id, week_start_date').eq('id', id).maybeSingle()
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  if (!cls) return { statusCode: 404, body: 'no such class' }
  if (cls.week_start_date < today) return { statusCode: 400, body: 'class already started' }
  const { data } = await sb.from('app_settings').select('value').eq('key', 'virtual_class_ids').maybeSingle()
  const ids = new Set(String(data?.value || '').split(',').map((x) => x.trim()).filter(Boolean))
  if (b.virtual === false) ids.delete(id); else ids.add(id)
  await sb.from('app_settings').upsert({ key: 'virtual_class_ids', value: [...ids].join(','), updated_at: new Date().toISOString() }, { onConflict: 'key' })
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, virtual: ids.has(id) }) }
}
