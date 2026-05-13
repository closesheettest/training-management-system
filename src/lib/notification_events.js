// Catalog of every automated SMS the system can fire.
// Each recipient (on the /notifications page) opts in to specific event keys
// via the `subscribed_events` array on notification_recipients.
//
// Adding a new event: add an entry here, then wire it up in the Netlify
// function that sends it. The Notifications page surfaces every event in
// this list as a checkbox on each recipient.

export const NOTIFICATION_EVENTS = [
  {
    key: 'day_2_provision_complete',
    label: 'IT submitted emails on Provision page',
    desc:
      'Fires when IT clicks Save on /provision/:class_id. Subscribers usually = HR (so they can share the email list with the VA).',
  },
  {
    key: 'hotel_noshow_alert',
    label: 'Hotel no-show alert (10:30 AM)',
    desc:
      'Daily cron: if a hotel-needing trainee hasn\'t checked in by 10:30 AM, subscribers are texted so they can cancel the room.',
  },
  // Future events (will be wired in subsequent phases):
  // {
  //   key: 'day_2_noon_provision_due',
  //   label: 'Day 2 at noon — IT reminder to create emails',
  //   desc: 'Daily cron at noon: if today is day 2 of a class, ping IT to provision emails.',
  // },
  // {
  //   key: 'hr_shared_list_with_va',
  //   label: 'HR shared the email list with a VA',
  //   desc: 'Fires when HR clicks the Share button on the HR list page.',
  // },
  // {
  //   key: 'va_setup_complete',
  //   label: 'VA finished setting up all 3 platforms',
  //   desc: 'Fires when every enrolled trainee is marked complete for RepCard, JobNimbus, and Sales Academy.',
  // },
]

export function eventLabel(key) {
  return NOTIFICATION_EVENTS.find((e) => e.key === key)?.label || key
}
