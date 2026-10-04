// cron-meet-recordings-cleanup.js — deletes meeting recordings older than each room's
// "keep recordings" setting (30 / 60 / 90 days; 0 = forever), so storage doesn't pile up
// (Neal, 2026-10-04). Daily. Marks them deleted in the room's recordings list.
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY.
import { createClient } from '@supabase/supabase-js'

export const handler = async () => {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const get = async (k) => { const { data } = await sb.from('app_settings').select('value').eq('key', k).maybeSingle(); try { return data ? JSON.parse(data.value) : null } catch { return null } }
  const rooms = (await get('meet_rooms')) || []
  let removed = 0
  for (const r of rooms) {
    const days = Number(r.rec_keep_days ?? 90)
    if (!days) continue
    const cutoff = Date.now() - days * 864e5
    const logKey = `meet_recordings_${r.slug}`
    const log = (await get(logKey)) || []
    const old = log.filter((x) => !x.deleted && x.file && Date.parse(x.started) < cutoff)
    if (!old.length) continue
    const { error } = await sb.storage.from('meeting-recordings').remove(old.map((x) => x.file))
    if (error) continue
    for (const x of old) x.deleted = new Date().toISOString()
    removed += old.length
    await sb.from('app_settings').upsert({ key: logKey, value: JSON.stringify(log), updated_at: new Date().toISOString() }, { onConflict: 'key' })
  }
  return { statusCode: 200, body: JSON.stringify({ ok: true, removed }) }
}

export const config = { schedule: '30 8 * * *' }
