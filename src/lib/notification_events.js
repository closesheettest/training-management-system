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
  {
    key: 'location_tbd_reminder',
    label: 'Training location still TBD (2 weeks out)',
    desc:
      'Daily cron at 10 AM Eastern. Fires for every upcoming class within 2 weeks where no training location has been assigned. Repeats every morning until a location is selected.',
  },
  {
    key: 'trainee_review_request',
    label: 'Trainee review request (Google + Yelp)',
    desc:
      'Trainee-facing automated email — fires once, right after the trainee submits their final test. Sent to the trainee\'s own email with the Google + Yelp review links. Not configurable in /notifications since it goes to the trainee, not staff.',
  },
  {
    key: 'trainee_handoff_contacts',
    label: 'Trainee handoff contacts (vCard text)',
    desc:
      'Trainee-facing automated text — fires once, right after the trainee submits their final test. Sent to the trainee\'s personal phone with a tap-to-save vCard link containing their Sales Manager, Helpline, and any region-matched contacts (managed at /handoff-contacts). Not configurable in /notifications since it goes to the trainee, not staff.',
  },
  {
    key: 'trainee_itinerary',
    label: 'Trainee training itinerary email',
    desc:
      'Trainee-facing automated email — fires daily at 10 AM Eastern via cron. Sent once per trainee, only after they\'ve registered AND their class location is no longer TBD. Includes the location address, the schedule from the location/class, and the hiring manager\'s signature. Body and subject are editable at /message-templates. Not configurable in /notifications since it goes to the trainee, not staff.',
  },
  {
    key: 'trainee_hotel_info',
    label: 'Trainee hotel room info text',
    desc:
      'Trainee-facing text — fires when HR captures a trainee\'s hotel stay on the /hotels page and clicks "Send" (or "Send all unsent" for a whole class at once). Pre-fills with the hotel name, address, phone, check-in/out dates, confirmation number, and guest name. Body editable at /message-templates. Not configurable in /notifications since it goes to the trainee, not staff.',
  },
  {
    key: 'trainee_declined',
    label: 'Trainee declined / withdrew from training',
    desc:
      'Fires when a trainee taps "Can\'t make it" on their registration page and confirms. Includes their name, class week, and any reason they typed in. Subscribers should be Hiring Manager + Admin so they can fill the spot or follow up.',
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
