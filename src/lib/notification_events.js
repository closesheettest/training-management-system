// Catalog of every automated SMS the system can fire.
// Each recipient (on the /notifications page) opts in to specific event keys
// via the `subscribed_events` array on notification_recipients.
//
// Adding a new event: add an entry here, then wire it up in the Netlify
// function that sends it. The Notifications page surfaces every event in
// this list as a checkbox on each recipient.

export const NOTIFICATION_EVENTS = [
  {
    key: 'day_2_provision_due',
    label: 'Day 2 reminder — IT, please create emails',
    desc:
      'Cron checks hourly between 7–11 AM Eastern. Fires the moment a trainee signs in on day 2 of the class, or at 11 AM as a fallback. Subscribers = IT.',
  },
  {
    key: 'day_2_provision_complete',
    label: 'IT submitted emails on Provision page',
    desc:
      'Fires when IT clicks Save on /provision/:class_id (legacy). Subscribers usually = admin/HR. Use the "Mark provisioning complete" button below for the full HR+VA fan-out.',
  },
  {
    key: 'it_emails_provisioned',
    label: 'IT marked provisioning complete — emails ready for HR',
    desc:
      'Fires when IT clicks "Mark provisioning complete" on the Provision page. Subscribers usually = HR (so they can review the list and share with VAs).',
  },
  {
    key: 'va_setup_due',
    label: 'Setup required in RepCard / JobNimbus / Sales Academy',
    desc:
      'Fires at the same time as the HR notification, on IT completion. Subscribers usually = the Virtual Assistant(s) who set up trainees in the three platforms.',
  },
  {
    key: 'hotel_noshow_alert',
    label: 'Hotel no-show alert (10:30 AM)',
    desc:
      'Daily cron: if a hotel-needing trainee hasn\'t checked in by 10:30 AM, subscribers are texted so they can cancel the room.',
  },
  {
    key: 'trainee_dropout_delete_email',
    label: 'Trainee dropped out — delete their company email',
    desc:
      'Daily cron: a provisioned trainee no-showed during their class week. Subscribers usually = IT (delete the Google Workspace account).',
  },
  {
    key: 'trainee_dropout_delete_apps',
    label: 'Trainee dropped out — remove from RepCard / JobNimbus / Sales Academy',
    desc:
      'Fires alongside the IT version. Subscribers usually = HR or the VA (remove the trainee from the three platforms).',
  },
  {
    key: 'graduation_class_report',
    label: 'Graduating class report (PDF)',
    desc:
      'Fires once every enrolled trainee in a class has submitted their final test. Emails a PDF report (roster, attendance, test scores, platform setup) to subscribers. Email-only — PDFs can\'t be sent via SMS.',
  },
  // Future events (will be wired in Commit B/C):
  // {
  //   key: 'va_setup_complete',
  //   label: 'VA finished setting up the entire class',
  //   desc: 'Fires when every enrolled trainee is marked complete for RepCard, JobNimbus, and Sales Academy.',
  // },
]

export function eventLabel(key) {
  return NOTIFICATION_EVENTS.find((e) => e.key === key)?.label || key
}
