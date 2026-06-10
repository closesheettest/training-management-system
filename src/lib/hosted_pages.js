// Registry of standalone HTML pages we've published in public/.
//
// These are pages that get a "hidden URL" — not linked from the main
// navigation, but reachable if you know the path. Typical use: one-off
// resource pages (sales pitch + downloadable docs) that Neal texts to
// trainees, or single-page docs (system overview).
//
// Whenever we ship a new standalone page, add an entry here so it
// shows up on /hosted-pages and Neal can find the link later.
//
// Fields:
//   slug         short ID for React keys
//   title        what the page is, in 1 line
//   url          path from site root (starts with `/`)
//   description  1-3 sentences explaining what the page is for + when
//                we created it and who it was sent to
//   created      'YYYY-MM-DD' — the day the commit landed
//   category     drives grouping on /hosted-pages — see CATEGORIES
//                below for the canonical set + render order.
//
// Adding a new page? Pick the most specific category that fits. If it
// belongs to a particular training day, use 'Day N'. Reference pages
// that all three days use go in 'Training overview & resources'. Anything
// only the admin/dev cares about goes in 'Internal admin'.

// Canonical category list + render order on /hosted-pages. The page
// groups entries by category and renders the groups in this order.
// Anything with a category not listed here falls into "Other".
export const CATEGORIES = [
  'Day 1',
  'Day 2',
  'Day 3',
  'Day 4',
  'Training overview & resources',
  'Trainee-facing (post-grad)',
  'Internal admin',
]

export const HOSTED_PAGES = [
  // ─────────────────────── Day 1 ───────────────────────
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
    category: 'Day 1',
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
    category: 'Day 1',
  },
  // The legacy 118-slide "Day 1 Retail Training" PDF entry used to live
  // here. Removed 2026-06-02 per Neal — superseded by the new
  // /day-1-slides Reveal deck + /day-1-homework page (the scripts) +
  // /day-2-homework (the four talking points). The PDF file itself
  // still lives at /training/day-1-retail-training.pdf because the
  // homework pages and the active Day 1 SMS body link to it; do a
  // sweep before deleting the file (see grep day-1-retail-training).

  // ─────────────────────── Day 2 ───────────────────────
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
    category: 'Day 2',
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
    category: 'Day 2',
  },

  // ─────────────────────── Day 3 ───────────────────────
  {
    slug: 'day-3-slides',
    title: 'Day 3 slides — Make-it-yours morning + Tech afternoon',
    url: '/day-3-slides/',
    description:
      'Reveal.js slide deck for Day 3 Retail Training. Morning (10-12) is the ' +
      '"verbatim out, your voice in" shift — drills of the Free Inspection, Retail Go-Back, ' +
      'and the full in-home pitch Slides 1-16, but the scripts on screen become a CHECKLIST ' +
      '(beats to hit), not a teleprompter. Trainees keep the information + structure ' +
      '(importance question → why → summary using control point) and bring their own phrasing. ' +
      'Afternoon is the tech introduction: the 3 tools (JobNimbus / RepCard / Roofr), ' +
      'JobNimbus Sections 1-5 walkthrough (Contact / Job / Appt / Estimate / Edit Job), ' +
      'common gotchas, and a pointer to /tools-training/ for the full reference. End-of-day ' +
      'wrap previews tonight\'s apps-setup + practice-deal homework (sent via SMS).',
    created: '2026-06-02',
    category: 'Day 3',
  },
  {
    slug: 'day-3-homework',
    title: 'Day 3 homework — Apps setup + practice deal',
    url: '/day-3-homework/',
    description:
      'Tonight\'s directive: get email/Job Nimbus/RepCard set up, then run a full practice deal in Job Nimbus. ' +
      'Contact (location=test) → Job → Appt tomorrow 5:30 PM → estimate ($39,450 across Exposed Fastener / ' +
      'Insulation / Radiant Barrier) → Edit Job fields (1 story, Black, Upgrade financing). ' +
      'Linked from the nightly Day 3 homework SMS.',
    created: '2026-05-28',
    category: 'Day 3',
  },
  {
    slug: 'tools-training',
    title: 'Tools reference — Job Nimbus · RepCard · Roofr',
    url: '/tools-training/',
    description:
      'Mobile-friendly deep-dive on the 3 tools every rep uses daily: JobNimbus (CRM), ' +
      'RepCard (digital business card + follow-up automation), Roofr (measurements + ' +
      'proposals). Each tool gets feature breakdowns, U.S. Shingle workflow notes, ' +
      'common pitfalls, setup steps. Introduced in Day 3 afternoon; reps return to ' +
      'this page while running the Day 3 practice deal homework.',
    created: '2026-05-28',
    category: 'Day 3',
  },

  // ─────────────────────── Day 4 (last teaching day) ───────────────────────
  {
    slug: 'finance-slides',
    title: 'Financing slides — finance waterfall + whole-week recap',
    url: '/finance-slides/',
    description:
      'Reveal.js slide deck for the last teaching day (Day 5 on a full week, Day 4 on a ' +
      'short week — always the Friday before the final exam). Covers the financing waterfall: ' +
      'WHO we use, each lender\'s criteria, and the ORDER we submit in — Upgrade Financial ' +
      '(soft pull, always first) → Service Finance (manual override + cosigners) → PACE ' +
      '(equity-based FL statute) → credit-repair fallback, plus a no-prepayment-penalty ' +
      'explainer. Then a whole-week recap section (Day 1 psychology, Day 2 products, Day 3 ' +
      'tools/JN, Day 4 objections, financing) that runs right before the test — gold ' +
      'highlights = the exact testable facts. Open on the projector, F for fullscreen, ' +
      'advance with a clicker.',
    created: '2026-06-05',
    category: 'Day 4',
  },

  // ─────────────────────── Training overview & resources ───────────────────────
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
    category: 'Training overview & resources',
  },
  {
    slug: 'sales-pitch',
    title: 'Free Inspection — sales pitch + resources (legacy)',
    url: '/sales-pitch/',
    description:
      'Hosts the door pitch (.docx), the in-home sales script (PDF), ' +
      'and the "Why U.S. Shingle" slide deck (PDF). All three are downloadable. ' +
      'SMS\'d to the Miami training class on 2026-05-26. Kept around because some ' +
      'old SMS threads still link here; new classes get the day-specific pages above.',
    created: '2026-05-26',
    category: 'Training overview & resources',
  },

  // ─────────────────────── Trainee-facing (post-grad) ───────────────────────
  {
    slug: 'welcome',
    title: 'Welcome — quick links for new reps',
    url: '/welcome',
    description:
      'Public quick-links page texted to every new rep daily for 7 days after they graduate. ' +
      'Cards for Sales Rep Dashboard, How-to Videos, Daily Sales Meeting, Daily Prayer Call, ' +
      'Sales Academy, and the Free Roof Inspection app. Edit the cards on /welcome-links.',
    created: '2026-05-15',
    category: 'Trainee-facing (post-grad)',
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
    category: 'Trainee-facing (post-grad)',
  },
  {
    slug: 'directory',
    title: 'Team directory (public)',
    url: '/directory',
    description:
      'Public phone-book of the whole team. Filterable by department/territory; ' +
      'each person controls which of their fields are visible. Managed via Sales Team → Manage directory.',
    created: '2026-05-22',
    category: 'Trainee-facing (post-grad)',
  },

  // ─────────────────────── Internal admin ───────────────────────
  {
    slug: 'handoff-contacts',
    title: 'Handoff contacts — vCard config (Helpline + Anthony etc.)',
    url: '/handoff-contacts',
    description:
      'Admin page for the contacts that auto-SMS to a trainee on graduation as vCards (Save All to phone in one tap). ' +
      'Set up Helpline, Anthony, the Sales Manager, region-specific people — each row has name, phone, role, and an enabled toggle. ' +
      'The SMS link the trainee taps is /.netlify/functions/trainee-contacts-vcard?trainee_id=<id> (fired by send-handoff-contacts-sms).',
    created: '2026-05-29',
    category: 'Internal admin',
  },
  {
    slug: 'offboarding',
    title: 'Off-boarding a rep — cleanup steps',
    url: '/offboarding/',
    description:
      'Step-by-step guide for clearing a rep who was marked Quit / Fired out of every ' +
      'outside system (GHL, Google Workspace, RepCard, JobNimbus, Sales Academy), then ' +
      'marking cleanup done on Active Sales Reps. Texted to the cleanup crew automatically ' +
      'the moment a rep is flagged, and again every morning at 10 AM until the Cleanup ' +
      'pending list is empty (rep_marked_offboarding event — set who gets it on /notifications).',
    created: '2026-06-10',
    category: 'Internal admin',
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
    category: 'Internal admin',
  },
]
