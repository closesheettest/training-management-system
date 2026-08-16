// The two-week (A / B) training timetable.
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

export const DEFAULT_TIMETABLE = {
  A: {
    label: 'Week A',
    days: [
      { dow: 1, day: 'Monday', start: 14, blocks: ['2:00 – 4:00 PM · Classroom'] },
      { dow: 2, day: 'Tuesday', start: 14, blocks: ['2:00 – 4:00 PM · Classroom', '5:00 – 8:00 PM · Field'] },
      { dow: 3, day: 'Wednesday', start: 10, blocks: ['10:00 AM – 12:00 PM · Classroom', 'Field continues until 8:00 PM · in your home market'] },
      { dow: null, day: 'Thursday – Saturday', start: null, blocks: ['Working in the field from home'] },
    ],
  },
  B: {
    label: 'Week B',
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

// Week A runs Mon–Fri of week_start_date; Week B the following Mon–Thu.
export function weekWindow(weekStartDate, phase, addDays) {
  return phase === 'B'
    ? { start: addDays(weekStartDate, 7), end: addDays(weekStartDate, 10) }
    : { start: weekStartDate, end: addDays(weekStartDate, 4) }
}
