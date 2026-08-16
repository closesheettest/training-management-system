import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { DEFAULT_TIMETABLE, fetchTimetable } from '../lib/schedule.js'

// The ONE place the two-week schedule is defined. Saving here changes what
// trainees are told (confirm page, itinerary email, class page) AND the hour the
// no-show automations wait for — they used to be separate copies, so a schedule
// change could leave the crons policing the old start time and flagging people
// who were present but not yet due.
const HOURS = [
  [null, 'No classroom that day'],
  [8, '8:00 AM'], [9, '9:00 AM'], [10, '10:00 AM'], [11, '11:00 AM'], [12, '12:00 PM'],
  [13, '1:00 PM'], [14, '2:00 PM'], [15, '3:00 PM'], [16, '4:00 PM'], [17, '5:00 PM'],
]
const inputCls = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm'

export default function Timetable() {
  const [tt, setTt] = useState(null)
  const [msg, setMsg] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchTimetable().then(setTt) }, [])

  function setDay(phase, i, patch) {
    setTt((prev) => {
      const next = structuredClone(prev)
      next[phase].days[i] = { ...next[phase].days[i], ...patch }
      return next
    })
  }

  async function save() {
    setSaving(true); setMsg(null)
    const { error } = await supabase.from('app_settings')
      .upsert({ key: 'training_timetable', value: JSON.stringify(tt), updated_at: new Date().toISOString() },
              { onConflict: 'key' })
    setSaving(false)
    setMsg(error
      ? { type: 'error', text: error.message }
      : { type: 'success', text: 'Saved. Trainee pages, the itinerary email and the no-show automations all use this now.' })
  }

  if (!tt) return <p className="text-sm text-slate-500">Loading…</p>

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Training timetable</h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          The two-week schedule, defined once. This drives what trainees are told on the confirm page and
          in their itinerary email, the hours on the class page — and the time the no-show automations wait
          for before flagging anyone. Set a day to <em>No classroom that day</em> and nobody is expected,
          so nobody is flagged.
        </p>
      </header>

      {msg && (
        <div className={msg.type === 'success'
          ? 'rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800'
          : 'rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800'}>
          {msg.text}
        </div>
      )}

      {['A', 'B'].map((phase) => (
        <section key={phase} className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">
            <span className={`mr-2 rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${
              phase === 'B' ? 'bg-indigo-100 text-indigo-800' : 'bg-emerald-100 text-emerald-800'}`}>
              {tt[phase].label}
            </span>
          </h2>
          <div className="space-y-4">
            {tt[phase].days.map((d, i) => (
              <div key={i} className="grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-[1fr_170px_2fr]">
                <label className="block text-xs font-medium text-slate-600">
                  Day
                  <input value={d.day} onChange={(e) => setDay(phase, i, { day: e.target.value })} className={inputCls} />
                </label>
                <label className="block text-xs font-medium text-slate-600">
                  Classroom starts
                  <select
                    value={d.start == null ? '' : String(d.start)}
                    onChange={(e) => setDay(phase, i, {
                      start: e.target.value === '' ? null : Number(e.target.value),
                      dow: e.target.value === '' ? null : (d.dow ?? i + 1),
                    })}
                    className={inputCls}
                  >
                    {HOURS.map(([v, label]) => (
                      <option key={String(v)} value={v == null ? '' : String(v)}>{label}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-medium text-slate-600">
                  What they see (one line each)
                  <textarea
                    rows={2}
                    value={(d.blocks || []).join('\n')}
                    onChange={(e) => setDay(phase, i, { blocks: e.target.value.split('\n').filter(Boolean) })}
                    className={inputCls}
                  />
                </label>
              </div>
            ))}
          </div>
        </section>
      ))}

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving}
          className="rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy-dark disabled:opacity-50">
          {saving ? 'Saving…' : 'Save timetable'}
        </button>
        <button onClick={() => setTt(structuredClone(DEFAULT_TIMETABLE))}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Reset to built-in
        </button>
      </div>
    </div>
  )
}
