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
