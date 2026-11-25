// The training timetable (one week since 2026-11-24; was two weeks, A / B).
//
// ONE source of truth: app_settings.training_timetable. It used to live in three
// places — this file, netlify/functions/_schedule.js and locations.schedule_template
// — so changing the hours meant remembering all three. Miss the cron copy and it
// still waits for the old start time, then flags everyone present-but-not-yet-due
// as a no-show, which unenrols them and cancels their hotel rooms.
//
// Edit it at /timetable. The values below are only a fallback for when the row
// can't be read, so a database hiccup renders today's hours rather than nothing.
import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'

// ONE-WEEK TRAINING (Neal, 2026-11-24): "we're only going to have one week of training. We're not going to do
// week A and week B anymore... it's going to follow week B's schedule." The one week lives under the "A" key so
// every page and cron that reads the timetable keeps working; "B" is kept only for two-week classes that started
// before the switch (the last was the 11/23 class).
export const DEFAULT_TIMETABLE = {
  A: {
    label: 'Training Week',
    days: [
      { dow: 1, day: 'Monday', start: 12, blocks: ['12:00 – 4:00 PM · Classroom'] },
      { dow: 2, day: 'Tuesday', start: 10, blocks: ['10:00 AM – 2:00 PM · Classroom'] },
      { dow: 3, day: 'Wednesday', start: 10, blocks: ['10:00 AM – 2:00 PM · Classroom'] },
      { dow: 4, day: 'Thursday', start: 10, blocks: ['10:00 AM – 2:00 PM · Classroom'] },
      { dow: 5, day: 'Friday', start: 9, blocks: ['9:00 – 11:00 AM · Test + graduation'] },
    ],
  },
  B: {
    label: 'Week B (old two-week classes only)',
    days: [
      { dow: 1, day: 'Monday', start: 11, blocks: ['11:00 AM – 1:00 PM · Classroom'] },
      { dow: 2, day: 'Tuesday', start: 10, blocks: ['10:00 AM – 1:00 PM · Classroom'] },
      { dow: 3, day: 'Wednesday', start: 13, blocks: ['1:00 – 4:00 PM · Classroom'] },
      { dow: 4, day: 'Thursday', start: 10, blocks: ['10:00 AM – 1:00 PM · Classroom'] },
    ],
  },
}

// Signatures the trainee-facing pages sign off with. Not scheduling data, so it
// stays in code rather than cluttering the editable timetable.
export const SIGNOFF = {
  A: { name: 'Brent Davidson', title: 'Hiring Manager' },
  B: { name: 'U.S. Shingle & Metal Training', title: '' },
}

// VIRTUAL (Zoom) classes: app_settings.virtual_class_ids. Nobody travels, so no
// hotel is booked, shown or asked for (Neal, 2026-09-28: "virtual does not send
// Jenn anything that says she needs to get a hotel").
export async function fetchVirtualClassIds() {
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'virtual_class_ids').maybeSingle()
    return new Set(String(data?.value || '').split(',').map((x) => x.trim()).filter(Boolean))
  } catch { return new Set() }
}

export async function fetchTimetable() {
  try {
    const { data } = await supabase
      .from('app_settings').select('value').eq('key', 'training_timetable').maybeSingle()
    const parsed = data?.value ? JSON.parse(data.value) : null
    return parsed?.A?.days?.length ? parsed : DEFAULT_TIMETABLE
  } catch {
    return DEFAULT_TIMETABLE
  }
}

// Renders with the fallback immediately, then swaps in the saved row — so the
// page never blocks on the fetch and never shows an empty schedule.
export function useTimetable() {
  const [tt, setTt] = useState(DEFAULT_TIMETABLE)
  useEffect(() => { let live = true; fetchTimetable().then((t) => live && setTt(t)); return () => { live = false } }, [])
  return tt
}

// "Mon 2–4pm · Tue 2–4pm + field · Wed 10–12 + field · Thu–Sat field from home"
export function shortLine(phase, tt = DEFAULT_TIMETABLE) {
  const wk = tt?.[phase] || DEFAULT_TIMETABLE[phase]
  return (wk?.days || []).map((d) => `${d.day.split(' – ')[0].slice(0, 3)} ${d.blocks[0].split(' · ')[0]}`).join(' · ')
}

// The training week (A) runs Mon–Fri of week_start_date; a legacy Week B the following Mon–Thu.
export function weekWindow(weekStartDate, phase, addDays) {
  return phase === 'B'
    ? { start: addDays(weekStartDate, 7), end: addDays(weekStartDate, 10) }
    : { start: weekStartDate, end: addDays(weekStartDate, 4) }
}
