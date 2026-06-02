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
    slug: 'day-2-slides',
    title: 'Day 2 slides — Roleplay morning + Products afternoon',
    url: '/day-2-slides/',
    description:
      'Reveal.js slide deck for Day 2 Retail Training. Morning (10–12) walks the class through ' +
      'three roleplay drills — Free Inspection Script, Retail Go-Back Script, and the In-Home ' +
      'Warm Up — with verbatim refreshers for each so trainees can check phrasing between rounds. ' +
      'Afternoon is the products walkthrough: framing (both energy sides equal weight), the 5 ' +
      'shared benefits, the Energy Package upgrades, then every product family (Asphalt · GAF + ' +
      'Tamko Titan, Exposed Fastener Metal · Ultra Rib + PBR, Standing Seam · TCM Lok, Stone ' +
      'Coated Metal, Permalock, Tilcor, Tile) with wind/warranty/pitch specs and the insurance ' +
      'category badge. Closes on the cheat-sheet table and the tomorrow-morning quiz reminder.',
    created: '2026-05-31',
    category: 'Internal docs',
  },
  {
    slug: 'day-1-slides',
    title: 'Day 1 slides — clicker-driven projector deck',
    url: '/day-1-slides/',
    description:
      'Reveal.js slide deck for Day 1 Retail Training. Open on the laptop hooked to the projector, ' +
      'press F for fullscreen, advance with a clicker (forward = PageDown, back = PageUp — any cheap ' +
      'Logitech/Amazon presenter works). Includes the NEW free-inspection harvesting script ' +
      '(replaces the old Instant Roof Quote pitch). Deep-link to any slide via #/N (e.g. /day-1-slides/#/30 ' +
      'jumps to the harvesting script). Trainees can also pull it up on their phones for review.',
    created: '2026-05-30',
    category: 'Internal docs',
  },
  {
    slug: 'handoff-contacts',
    title: 'Handoff contacts — vCard config (Helpline + Anthony etc.)',
    url: '/handoff-contacts',
    description:
      'Admin page for the contacts that auto-SMS to a trainee on graduation as vCards (Save All to phone in one tap). ' +
      'Set up Helpline, Anthony, the Sales Manager, region-specific people — each row has name, phone, role, and an enabled toggle. ' +
      'The SMS link the trainee taps is /.netlify/functions/trainee-contacts-vcard?trainee_id=<id> (fired by send-handoff-contacts-sms).',
    created: '2026-05-29',
    category: 'Internal docs',
  },
  {
    slug: 'day-3-homework',
    title: 'Day 3 homework — Apps setup + practice deal',
    url: '/day-3-homework/',
    description:
      'Tonight\'s directive: get email/Job Nimbus/RepCard set up, then run a full practice deal in Job Nimbus. ' +
      'Contact (location=test) → Job → Appt tomorrow 5:30 PM → estimate ($39,450 across Exposed Fastener / ' +
      'Insulation / Radiant Barrier) → Edit Job fields (1 story, Black, Upgrade financing). ' +
      'Linked from the nightly Day 3 homework SMS at 7 PM EDT.',
    created: '2026-05-28',
    category: 'Trainee resources',
  },
  {
    slug: 'tools-training',
    title: 'Tools Training — Job Nimbus · RepCard · Roofr',
    url: '/tools-training/',
    description:
      'Mobile-friendly deep-dive on the 3 tools every rep uses daily: JobNimbus (CRM), ' +
      'RepCard (digital business card + follow-up automation), Roofr (measurements + ' +
      'proposals). Each tool gets feature breakdowns, U.S. Shingle workflow notes, ' +
      'common pitfalls, setup steps. Closes with a workflow diagram showing how the ' +
      'three chain together from door-knock to install handoff.',
    created: '2026-05-28',
    category: 'Trainee resources',
  },
  {
    slug: 'day-1-retail-training',
    title: 'Day 1 Retail Training — the whole curriculum',
    url: '/training/day-1-retail-training.pdf',
    description:
      'The complete 118-slide Day 1 training deck Neal walks trainees through. ' +
      'Source of truth for the 5-step framework, the 4 emotional drivers (HSN tactics), ' +
      'Control Points, the Harvesting Script, slides 1-16 of the in-home pitch, the Energy ' +
      'Package, the Ask, and the R.I.S.C objection-handling flow. Anything pitch-related ' +
      'should match this document verbatim.',
    created: '2026-05-27',
    category: 'Internal docs',
  },
  {
    slug: 'training-itinerary',
    title: 'Training Week Itinerary — Day-by-day schedule + auto-fires',
    url: '/training-itinerary/',
    description:
      'One-page itinerary covering the full retail training week — class hours by ' +
      'week-start day (Mon-start vs Tue-start), what\'s covered each day, what the ' +
      'system auto-fires (onboarding SMS, IT provisioning, morning quizzes, end-of-day ' +
      'homework, graduation activation), and links to each day\'s slides + homework. ' +
      'Print-friendly so admin can hand it to new trainees on Day 1.',
    created: '2026-06-02',
    category: 'Trainee resources',
  },
  {
    slug: 'day-1-homework',
    title: 'Day 1 homework — Scripts + Slide 1 + full training manual',
    url: '/day-1-homework/',
    description:
      'Tonight\'s directive: memorize three things — the Free Roof Inspection script ' +
      '(opening pitch at the door), the Retail Roof Go-Back script (the wear-&-tear ' +
      'second-yes pitch), and Slide 1 (15 Years in Business — the in-home pitch opener). ' +
      'Verbatim from Day 1 slides 30, 31, 31c-31e plus training page 37. Also bundles the ' +
      'full 118-slide training manual PDF as a download (same send-with-pitch pattern as ' +
      'last week). Includes Save-as-PDF for the scripts. SMS\'d at 4:30 PM after Day 1 ' +
      'ends; quiz on this content fires Day 2 morning at kiosk sign-in.',
    created: '2026-06-01',
    category: 'Trainee resources',
  },
  {
    slug: 'day-2-homework',
    title: 'Day 2 homework — Memorize slides 1-16',
    url: '/day-2-homework/',
    description:
      'Tonight\'s directive: memorize the full in-home pitch — slides 1-16, including the ' +
      'four talking points (Slides 1-5) they started on Day 1. Page surfaces the verbatim ' +
      'slide 1-5 quotes from training pages 37-41, plus links to the Products PDF and the ' +
      'full Day 1 training deck. Quiz on Products fires Day 3 morning at kiosk sign-in.',
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
