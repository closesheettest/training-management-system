// The two-week (A / B) training timetable — single source of truth for the UI.
//
// Lifted out of Confirm.jsx so the class page can show the week a person is
// actually looking at, instead of the whole 3-week cohort span. The crons keep
// their own copy in netlify/functions/_schedule.js (Netlify functions can't
// import from src/) — if you change the timetable, change both.
export const SCHEDULES = {
  A: {
    label: 'Week A',
    short: 'Mon 2–4pm · Tue 2–4pm + field · Wed 10–12 + field · Thu–Sat field from home',
    signoff: { name: 'Brent Davidson', title: 'Hiring Manager' },
    days: [
      { day: 'Monday', blocks: ['2:00 – 4:00 PM · Classroom'] },
      { day: 'Tuesday', blocks: ['2:00 – 4:00 PM · Classroom', '5:00 – 8:00 PM · Field'] },
      { day: 'Wednesday', blocks: ['10:00 AM – 12:00 PM · Classroom', 'Field continues until 8:00 PM · in your home market'] },
      { day: 'Thursday – Saturday', blocks: ['Working in the field from home'] },
    ],
  },
  B: {
    label: 'Week B',
    short: 'Mon 11–1 · Tue 10–1 · Wed 1–4 · Thu 10–1',
    signoff: { name: 'U.S. Shingle & Metal Training', title: '' },
    days: [
      { day: 'Monday', blocks: ['11:00 AM – 1:00 PM · Classroom'] },
      { day: 'Tuesday', blocks: ['10:00 AM – 1:00 PM · Classroom'] },
      { day: 'Wednesday', blocks: ['1:00 – 4:00 PM · Classroom'] },
      { day: 'Thursday', blocks: ['10:00 AM – 1:00 PM · Classroom'] },
    ],
  },
}

// Week A runs Mon–Fri of week_start_date; Week B the following Mon–Thu.
export function weekWindow(weekStartDate, phase, addDays) {
  return phase === 'B'
    ? { start: addDays(weekStartDate, 7), end: addDays(weekStartDate, 10) }   // Mon–Thu
    : { start: weekStartDate, end: addDays(weekStartDate, 4) }                 // Mon–Fri
}
