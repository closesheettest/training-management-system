// Registry of standalone HTML pages we've published in public/.
//
// These are pages that get a "hidden URL" — not linked from the main
// navigation, but reachable if you know the path. Typical use: one-off
// resource pages (sales pitch + downloadable docs) that Neal texts to
// trainees, or single-page docs (system overview).
//
// Whenever we ship a new standalone page, add an entry here so it
// shows up on /hosted-pages and Neal can find the link later. Keep
// entries newest-first.
//
// Fields:
//   slug         short ID for React keys
//   title        what the page is, in 1 line
//   url          path from site root (starts with `/`)
//   description  1-3 sentences explaining what the page is for + when
//                we created it and who it was sent to
//   created      'YYYY-MM-DD' — the day the commit landed
//   category     'Sales resources' | 'Internal docs' | 'Public form'
//                (free-form; drives the colored chip)

export const HOSTED_PAGES = [
  {
    slug: 'day-2-homework',
    title: 'Day 2 homework — Why U.S. Shingle + Products',
    url: '/day-2-homework/',
    description:
      'Tonight\'s 3-part assignment for Day 2 of training: the 4 "Why U.S. Shingle" talking points ' +
      'with explicit framing (experience matters → trust → social proof → 3rd-party finance), ' +
      'Products PDF download for review, and a pointer to slides 1-5 of the in-home deck. ' +
      'Quiz on this material fires Day 3 morning at kiosk sign-in.',
    created: '2026-05-27',
    category: 'Trainee resources',
  },
  {
    slug: 'sales-pitch',
    title: 'Free Inspection — sales pitch + resources',
    url: '/sales-pitch/',
    description:
      'Hosts the door pitch (.docx), the in-home sales script (PDF), ' +
      'and the "Why U.S. Shingle" slide deck (PDF). All three are downloadable. ' +
      'SMS\'d to the Miami training class on 2026-05-26.',
    created: '2026-05-26',
    category: 'Sales resources',
  },
  {
    slug: 'apps',
    title: 'Install your apps — RepCard + JobNimbus',
    url: '/apps',
    description:
      'Public install guide trainees see right after they get their company credentials. ' +
      'Auto-detects iOS vs Android and shows the right app-store link for RepCard + JobNimbus, ' +
      'plus the password-reset workaround for the JobNimbus app. Linked from /credentials.',
    created: '2026-05-13',
    category: 'Trainee resources',
  },
  {
    slug: 'welcome',
    title: 'Welcome — quick links for new reps',
    url: '/welcome',
    description:
      'Public quick-links page texted to every new rep daily for 7 days after they graduate. ' +
      'Cards for Sales Rep Dashboard, How-to Videos, Daily Sales Meeting, Daily Prayer Call, ' +
      'Sales Academy, and the Free Roof Inspection app. Edit the cards on /welcome-links.',
    created: '2026-05-15',
    category: 'Trainee resources',
  },
  {
    slug: 'directory',
    title: 'Team directory (public)',
    url: '/directory',
    description:
      'Public phone-book of the whole team. Filterable by department/territory; ' +
      'each person controls which of their fields are visible. Managed via Sales Team → Manage directory.',
    created: '2026-05-22',
    category: 'Internal docs',
  },
  {
    slug: 'system-overview',
    title: 'TMS system overview',
    url: '/system-overview.html',
    description:
      'Single-page executive summary of how the Training Management System ' +
      'works end-to-end — every cron, every text, every page. Also linked from ' +
      'the Settings dropdown.',
    created: '2026-05-13',
    category: 'Internal docs',
  },
]
