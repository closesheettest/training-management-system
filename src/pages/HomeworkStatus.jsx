import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Daily homework board: for each active class, every training day with whether
// homework has gone out, plus a "Send now" button to fire today's homework
// early (e.g. you dismissed class sooner than the scheduled time). The send
// reuses cron-training-homework (?force=1&class_id=…) — idempotent per trainee.

const FN = '/.netlify/functions'

function ymdET(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
  return f.format(d) // YYYY-MM-DD
}
function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return dt.toISOString().slice(0, 10)
}
function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5)
}
function pretty(ymd) {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
}

export default function HomeworkStatus() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [sending, setSending] = useState('')
  const today = ymdET()

  const load = async () => {
    setErr('')
    try {
      const { data: classes } = await supabase
        .from('classes')
        .select('id, region, week_start_date, week_end_date')
        .lte('week_start_date', today).gte('week_end_date', today).eq('attendance_only', false)
        .order('week_start_date', { ascending: true })
      const { data: lessons } = await supabase
        .from('training_day_lessons').select('day_number, homework_sms_body, enabled')
      const lessonByDay = {}
      for (const l of lessons || []) lessonByDay[l.day_number] = l

      const out = []
      for (const c of classes || []) {
        const lastDay = daysBetween(c.week_start_date, c.week_end_date) + 1   // grad day
        const todayDay = daysBetween(c.week_start_date, today) + 1
        const [{ data: attempts }, { count: attendedToday }] = await Promise.all([
          supabase.from('training_day_attempts').select('day_number, homework_sent_at').eq('class_id', c.id),
          supabase.from('attendance').select('trainee_id', { count: 'exact', head: true })
            .eq('class_id', c.id).eq('attendance_date', today).eq('confirmed', true),
        ])
        const sentByDay = {}
        for (const a of attempts || []) if (a.homework_sent_at) sentByDay[a.day_number] = (sentByDay[a.day_number] || 0) + 1
        const days = []
        for (let d = 1; d < lastDay; d++) {   // homework days = all but graduation
          days.push({
            day: d, date: addDays(c.week_start_date, d - 1), sent: sentByDay[d] || 0,
            isToday: d === todayDay, hasBody: !!(lessonByDay[d]?.enabled && (lessonByDay[d]?.homework_sms_body || '').trim()),
          })
        }
        out.push({ ...c, todayDay, lastDay, attendedToday: attendedToday || 0, days })
      }
      setData(out)
    } catch (e) { setErr(e.message || 'Could not load.') }
  }
  useEffect(() => { load() }, [])

  const sendNow = async (classId) => {
    setSending(classId); setErr('')
    try {
      const r = await fetch(`${FN}/cron-training-homework?force=1&class_id=${encodeURIComponent(classId)}`)
      const o = await r.json().catch(() => ({}))
      if (!r.ok || o.ok === false) throw new Error(o.error || 'Send failed')
      await load()
      alert(`Sent: ${o.sent ?? 0} trainee(s).` + (o.skipped?.length ? ` Skipped ${o.skipped.length} (already sent / no contact).` : ''))
    } catch (e) { setErr(e.message) }
    setSending('')
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-brand-navy">Homework</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          Whether each day's homework went out (SMS + email to everyone who attended). Use <b>Send now</b> if you dismissed class early and want it to go before the scheduled time.
        </p>
      </header>

      {err && <div className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
      {data === null ? <p className="text-sm text-slate-400">Loading…</p>
        : !data.length ? <p className="text-sm text-slate-500">No active training class today.</p>
        : <div className="space-y-4">
            {data.map((c) => {
              const td = c.days.find((d) => d.isToday)
              const isGradToday = c.todayDay >= c.lastDay
              return (
                <div key={c.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                  <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3">
                    <div>
                      <span className="font-bold text-brand-navy">{c.region}</span>
                      <span className="ml-2 text-xs text-slate-500">{pretty(c.week_start_date)} – {pretty(c.week_end_date)} · Today: {isGradToday ? 'Graduation' : `Day ${c.todayDay}`}</span>
                    </div>
                    {td && (
                      <button onClick={() => sendNow(c.id)} disabled={sending === c.id}
                        className="rounded-md bg-brand-navy px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
                        {sending === c.id ? 'Sending…' : td.sent > 0 ? 'Re-send today' : 'Send now'}
                      </button>
                    )}
                  </div>
                  <table className="w-full text-sm">
                    <thead><tr className="text-[10px] uppercase tracking-wide text-slate-400">
                      <th className="px-4 py-1.5 text-left">Day</th><th className="px-2 py-1.5 text-left">Date</th>
                      <th className="px-2 py-1.5 text-left">Homework</th><th className="px-2 py-1.5 text-right">Sent</th><th className="px-4 py-1.5 text-right">Status</th>
                    </tr></thead>
                    <tbody>
                      {c.days.map((d) => (
                        <tr key={d.day} className={'border-t border-slate-100 ' + (d.isToday ? 'bg-amber-50' : '')}>
                          <td className="px-4 py-2 font-semibold">Day {d.day}{d.isToday && <span className="ml-1 text-[10px] font-bold text-amber-600">TODAY</span>}</td>
                          <td className="px-2 py-2 text-slate-500">{pretty(d.date)}</td>
                          <td className="px-2 py-2">{d.hasBody ? <span className="text-slate-600">authored</span> : <span className="text-amber-600">no body</span>}</td>
                          <td className="px-2 py-2 text-right font-semibold">{d.sent || '—'}</td>
                          <td className="px-4 py-2 text-right">
                            {d.sent > 0 ? <span className="font-semibold text-emerald-600">✓ sent</span>
                              : d.isToday ? <span className="text-slate-500">{c.attendedToday} attended · not sent</span>
                              : d.date < today ? <span className="text-slate-400">not sent</span>
                              : <span className="text-slate-300">upcoming</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })}
          </div>}
    </div>
  )
}
