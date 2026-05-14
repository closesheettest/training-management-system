import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { NOTIFICATION_EVENTS } from '../lib/notification_events.js'

// Samples mirror the templates inside netlify/functions/*. If you change
// a message body in a function, update the matching entry here so this
// preview page doesn't lie about what trainees / staff actually receive.
//
// Placeholders are realistic-looking values so the previews read naturally;
// real values get substituted at send time.
const SAMPLE = {
  region: 'St Pete',
  location: 'U.S. Shingle and Metal LLC Corporate Office',
  weekStart: '2026-05-11',
  weekRange: 'May 11 – 15, 2026',
  provisionedCount: 12,
  trainee: 'Addison Miller',
  email: 'addison.miller@shingleusa.com',
  setupLink: 'https://trainingmanagementsys.netlify.app/setup/<class-id>',
  provisionLink: 'https://trainingmanagementsys.netlify.app/provision/<class-id>',
  credentialsLink: 'https://trainingmanagementsys.netlify.app/credentials/<token>',
  registerLink: 'https://trainingmanagementsys.netlify.app/register/<token>',
}

const MESSAGES = {
  day_2_provision_due: {
    triggers: ['Cron (hourly 7–11 AM Eastern, fires on first day-2 sign-in or 11 AM fallback)', 'Manual: Class detail → Send day-2 IT reminder text now'],
    sms: `[Training] Day 2 trainees have started checking in. Time to create company emails for ${SAMPLE.region} · ${SAMPLE.location}. Open the Provision page and click "Mark provisioning complete" when done: ${SAMPLE.provisionLink}`,
    emailSubject: `Create company emails for ${SAMPLE.region} (week of ${SAMPLE.weekStart})`,
    emailBody:
      `Day 2 trainees have started checking in.\n\n` +
      `Time to create company emails for ${SAMPLE.region} · ${SAMPLE.location} (week of ${SAMPLE.weekStart}).\n\n` +
      `Open the Provision page and click "Mark provisioning complete" when done:\n${SAMPLE.provisionLink}\n\n` +
      `— Training System`,
  },
  day_2_provision_complete: {
    triggers: ['Sent when IT clicks the legacy "Save & send credentials" button (advanced/manual path)'],
    sms: `[Training System] Company emails provisioned for ${SAMPLE.region} · ${SAMPLE.location} (week of ${SAMPLE.weekStart}). 12 credential texts sent.`,
    emailSubject: `Credentials texts sent — ${SAMPLE.region} (week of ${SAMPLE.weekStart})`,
    emailBody: `Company emails provisioned for ${SAMPLE.region} · ${SAMPLE.location} (week of ${SAMPLE.weekStart}). 12 credential texts sent.`,
  },
  it_emails_provisioned: {
    triggers: ['IT clicks "✅ Mark provisioning complete" on the Provision page'],
    sms: `[Training] IT just provisioned ${SAMPLE.provisionedCount} company emails for ${SAMPLE.region} · ${SAMPLE.location} (week of ${SAMPLE.weekStart}). View the list and confirm setup progress here: ${SAMPLE.setupLink}`,
    emailSubject: `Email list ready — ${SAMPLE.region} (week of ${SAMPLE.weekStart})`,
    emailBody:
      `IT just provisioned ${SAMPLE.provisionedCount} company emails for ${SAMPLE.region} · ${SAMPLE.location} (week of ${SAMPLE.weekStart}).\n\n` +
      `Open the list and confirm setup progress:\n${SAMPLE.setupLink}\n\n` +
      `— Training System`,
  },
  va_setup_due: {
    triggers: ['Fires alongside IT-completed event — VAs are notified to start RepCard/JN/SA setup'],
    sms: `[Training] ${SAMPLE.provisionedCount} new trainees need to be set up in RepCard, JobNimbus, and Sales Academy for ${SAMPLE.region} (week of ${SAMPLE.weekStart}). Check them off as you go: ${SAMPLE.setupLink}`,
    emailSubject: `Set up ${SAMPLE.provisionedCount} trainees — ${SAMPLE.region}`,
    emailBody:
      `${SAMPLE.provisionedCount} new trainees need accounts created in RepCard, JobNimbus, and Sales Academy for ${SAMPLE.region} (week of ${SAMPLE.weekStart}).\n\n` +
      `Open the checklist (each platform tracks per-trainee progress):\n${SAMPLE.setupLink}\n\n` +
      `— Training System`,
  },
  hotel_noshow_alert: {
    triggers: ['Daily cron at 10:30 AM Eastern (configured in cron-job.org)'],
    sms: `[Training] ${SAMPLE.trainee} (${SAMPLE.region} at ${SAMPLE.location}) hasn't checked in by 10:30 AM on Wed, May 13. They need a hotel — consider cancelling their room.`,
    emailSubject: `Hotel no-show alert — 1 trainee`,
    emailBody: `${SAMPLE.trainee} (${SAMPLE.region} at ${SAMPLE.location}) hasn't checked in by 10:30 AM on Wed, May 13. They need a hotel — consider cancelling their room.`,
  },
  trainee_dropout_delete_email: {
    triggers: ['Daily cron — provisioned trainee no-showed during the class week'],
    sms: `[Training] Dropout on Wed, May 13: ${SAMPLE.trainee} — ${SAMPLE.email} (${SAMPLE.region} · ${SAMPLE.location}). Please delete the Google Workspace account.`,
    emailSubject: `Delete 1 Google Workspace account — dropout on Wed, May 13`,
    emailBody:
      `The following provisioned trainee no-showed on Wed, May 13 and appears to have dropped out. Please delete their company email account:\n\n` +
      `• ${SAMPLE.trainee} — ${SAMPLE.email} (${SAMPLE.region} · ${SAMPLE.location})\n\n` +
      `— Training System`,
  },
  trainee_dropout_delete_apps: {
    triggers: ['Fires alongside the IT version — same dropout, separate audience'],
    sms: `[Training] Dropout on Wed, May 13: ${SAMPLE.trainee} — ${SAMPLE.email} (${SAMPLE.region} · ${SAMPLE.location}). Please remove from RepCard, JobNimbus, and Sales Academy.`,
    emailSubject: `Remove 1 dropout from apps — Wed, May 13`,
    emailBody:
      `The following provisioned trainee no-showed on Wed, May 13 and appears to have dropped out. Please remove their account from RepCard, JobNimbus, and Sales Academy:\n\n` +
      `• ${SAMPLE.trainee} — ${SAMPLE.email} (${SAMPLE.region} · ${SAMPLE.location})\n\n` +
      `— Training System`,
  },
  location_tbd_reminder: {
    triggers: ['Daily cron at 10 AM Eastern. Fires every day for upcoming classes within 2 weeks that don\'t have a location yet. Stops once a location is picked.'],
    sms: `[Training] Still no location booked for ${SAMPLE.region} training week of May 25, 2026 (11 days away). Pick one: https://trainingmanagementsys.netlify.app/class/<id>`,
    emailSubject: `Training location still TBD — week of May 25, 2026`,
    emailBody:
      `The following upcoming class doesn't have a training location assigned yet:\n\n` +
      `• ${SAMPLE.region} — week of May 25, 2026 (11 days away)\n  → https://trainingmanagementsys.netlify.app/class/<id>\n\n` +
      `The reminder will keep firing every day at 10 AM until a location is selected.\n\n— Training System`,
  },
  trainee_handoff_contacts: {
    triggers: ['Fires automatically right after a trainee submits their final test. Sent to the trainee\'s personal phone via SMS. Skipped silently if no handoff contacts have been added on /handoff-contacts. One-time only (dedup via handoff_contacts_sent_at).'],
    sms: `[Training] Sample, congrats on finishing your final test! Tap to save your team contacts to your phone in one go: https://trainingmanagementsys.netlify.app/.netlify/functions/trainee-contacts-vcard?trainee_id=<id>`,
    emailSubject: '(this one is text-only — the vCard link is the whole point)',
    emailBody: '(no email; trainee taps the link and their phone offers to add Sales Manager + Helpline + any region-matched contacts in one confirmation)',
  },
  trainee_review_request: {
    triggers: [
      'Fires automatically right after a trainee submits their final test. Sent to the trainee\'s personal email.',
      'Asks for FOUR reviews — Google + Yelp for U.S. Shingle, Google + Yelp for Neal Scoppettuolo (Corporate Trainer).',
      'Sections 1 & 2 use essays flagged "🏢 Use for client business review"; sections 3 & 4 use essays flagged "⭐ Use for Neal\'s brand testimonials". Each section is pre-filled with the trainee\'s longest (then second-longest) qualifying essay so they only click + paste.',
    ],
    sms: '(this one is email-only — sent to the trainee\'s personal email after submitting their final test)',
    emailSubject: `Thanks for completing your training, Sample — 4 quick reviews?`,
    emailBody:
      `Hi Sample,\n\n` +
      `Thanks so much for finishing your final assessment — that's a real accomplishment.\n\n` +
      `One ask before you go: would you leave 4 quick reviews so the next class of trainees can find us? Two for U.S. Shingle & Metal (the company you're joining) and two for Neal Scoppettuolo (your corporate trainer). I've pre-picked one of your own essay answers for each — just click the link, then paste the answer.\n\n` +
      `────────────────────────────────────────\n` +
      `⭐ #1 OF 4 — GOOGLE REVIEW FOR U.S. SHINGLE & METAL\n` +
      `Step 1 — click: https://www.google.com/maps/place/U.S.+Shingle+%26+Metal/...\n` +
      `Step 2 — copy & paste this answer of yours below.\n` +
      `(You wrote it in response to: "<longest client-review question>")\n\n` +
      `"<longest U.S. Shingle essay response>"\n\n` +
      `────────────────────────────────────────\n` +
      `⭐ #2 OF 4 — YELP REVIEW FOR U.S. SHINGLE & METAL\n` +
      `Step 1 — click: https://www.yelp.com/writeareview/biz/us-shingle-clearwater\n` +
      `Step 2 — copy & paste this answer of yours below.\n` +
      `(You wrote it in response to: "<2nd client-review question>")\n\n` +
      `"<2nd-longest U.S. Shingle essay response>"\n\n` +
      `────────────────────────────────────────\n` +
      `⭐ #3 OF 4 — GOOGLE REVIEW FOR NEAL SCOPPETTUOLO — CORPORATE TRAINER\n` +
      `Step 1 — click: https://g.page/r/.../review\n` +
      `Step 2 — copy & paste this answer of yours below.\n` +
      `(You wrote it in response to: "<longest testimonial question>")\n\n` +
      `"<longest Neal-brand essay response>"\n\n` +
      `────────────────────────────────────────\n` +
      `⭐ #4 OF 4 — YELP REVIEW FOR NEAL SCOPPETTUOLO — CORPORATE TRAINER\n` +
      `Step 1 — click: https://www.yelp.com/writeareview/biz/...\n` +
      `Step 2 — copy & paste this answer of yours below.\n` +
      `(You wrote it in response to: "<2nd testimonial question>")\n\n` +
      `"<2nd-longest Neal-brand essay response>"\n\n` +
      `────────────────────────────────────────\n` +
      `That's everything. Each review takes about a minute and really does help.\n\n` +
      `Congratulations on graduating training!\n\n` +
      `— U.S. Shingle & Metal Training Team`,
  },
  graduation_class_report: {
    triggers: ['Cron ~every 15 min — fires once every enrolled trainee submits their final test'],
    sms: '(this event is email-only — PDF can\'t be sent via SMS)',
    emailSubject: `Graduating training week of ${SAMPLE.weekRange}`,
    emailBody:
      `Attached is the graduating class report for ${SAMPLE.region} · ${SAMPLE.location} (week of ${SAMPLE.weekRange}).\n\n` +
      `12 graduates.\n\n` +
      `Filename: graduating-class-st-pete-${SAMPLE.weekStart}.pdf\n\n` +
      `— Training System`,
  },
}

const TRAINEE_FACING = [
  {
    label: 'Registration form',
    desc: 'First text the trainee gets after enrollment. They confirm name, set sales-experience tag, fill home address. Pre-filled with whatever HR entered.',
    url: '/register/demo',
    linkable: true,
    note: 'Live preview opens with a fake "Sample Attendee" — submits go nowhere.',
  },
  {
    label: 'Credentials page',
    desc: 'Day-2 link with their company email + password and step-by-step iPhone/Android Gmail setup. Auto-detects platform from user-agent.',
    url: '/credentials/demo',
    linkable: true,
    note: 'Live preview shows a fake login (sample.attendee@shingleusa.com / BlueCat12!).',
  },
  {
    label: 'App downloads',
    desc: 'RepCard + JobNimbus install instructions. Linked from the credentials page button. Public — no token needed.',
    url: '/apps',
    linkable: true,
  },
  {
    label: 'Final test',
    desc: 'Last-day assessment. Multiple-choice + essay/testimonial questions. Score and retention % are saved to test_attempts.',
    url: '/test/<token>',
    note: 'No demo mode yet — requires a real trainee. Open one from a Class detail page.',
  },
]

const ADMIN_TOOLS = [
  {
    label: 'Provision page (IT)',
    desc: 'Where IT lands from the day-2 reminder text. Pre-filled email list, Download CSV for Google Workspace bulk-upload, then Mark provisioning complete.',
    url: '/class/<class-id>',
    linkable: false,
    note: 'Click "Provision emails" from any class on the Schedule page.',
  },
  {
    label: 'Setup checklist (HR/VA)',
    desc: 'Where HR and the VA land from the IT-completed notification. Shows email list + per-trainee checkboxes for RepCard, JobNimbus, Sales Academy.',
    url: '/setup/<class-id>',
  },
]

export default function Messages() {
  const [subsByEvent, setSubsByEvent] = useState({})

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('notification_recipients')
      .select('name, subscribed_events, active, notify_via_sms, notify_via_email, phone, email')
      .eq('active', true)
    const byEvent = {}
    for (const r of data || []) {
      for (const key of r.subscribed_events || []) {
        if (!byEvent[key]) byEvent[key] = []
        byEvent[key].push(r)
      }
    }
    setSubsByEvent(byEvent)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Message center</h1>
        <p className="mt-2 text-slate-600">
          Every automated text, email, and trainee-facing page the system can produce. Useful for
          previewing copy, training new staff, or showing leadership what trainees experience.
        </p>
      </header>

      {/* Automated messages */}
      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">Automated text + email messages</h2>
          <p className="mt-1 text-sm text-slate-500">
            Real templates from the system, rendered with sample values. Subscribed people see in
            the right column of each card.
          </p>
        </div>
        {NOTIFICATION_EVENTS.map((e) => (
          <EventCard
            key={e.key}
            event={e}
            messages={MESSAGES[e.key]}
            subscribers={subsByEvent[e.key] || []}
          />
        ))}
      </section>

      {/* Trainee-facing pages */}
      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">What trainees see</h2>
          <p className="mt-1 text-sm text-slate-500">
            Public pages trainees land on from the texts above. Pages needing a personal token
            (registration, credentials, test) only work for real trainees — open one from the
            Class detail page if you need to see them with live data.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {TRAINEE_FACING.map((p) => (
            <PageCard key={p.label} page={p} />
          ))}
        </div>
      </section>

      {/* Admin tools */}
      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">Internal staff pages</h2>
          <p className="mt-1 text-sm text-slate-500">
            Pages staff land on from the workflow texts.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {ADMIN_TOOLS.map((p) => (
            <PageCard key={p.label} page={p} />
          ))}
        </div>
      </section>

      {/* Reports */}
      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">Reports</h2>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-semibold">Graduating class report (PDF)</h3>
          <p className="mt-1 text-sm text-slate-600">
            One-page Letter PDF: class header, two totals (graduates count, total days attended),
            and a simple numbered list of graduates with their name, company email, and days
            attended. Attached to the email subscribers receive after the last trainee submits
            their final test.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            To preview a real one, hit the dry-run URL:{' '}
            <code className="rounded bg-slate-100 px-1 font-mono text-[0.85em]">
              /.netlify/functions/send-graduation-report?secret=&lt;CRON_SECRET&gt;&amp;dry_run=1
            </code>
          </p>
        </div>
      </section>

      {/* Social posts */}
      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">Social posts</h2>
          <p className="mt-1 text-sm text-slate-500">
            Auto-posts to your personal brand pages. Generic copy — never mentions the client
            company name — so the same posts work no matter who you're training for.
          </p>
        </div>
        <SocialTestCard />
        <SocialQueueCard />
        <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-semibold">📘 Facebook + 🔷 LinkedIn — class graduated</h3>
          <p className="mt-1 text-xs text-slate-500">
            Auto-fires <strong>immediately</strong> (no queueing) when the last trainee in a class
            submits the final test — this is the headliner, alongside the graduation-report email.
            Attaches a random photo from the venue's photo library (manage at /locations) when
            available.
          </p>
          <pre className="mt-3 whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800 font-sans leading-snug">{`🎓 Just wrapped another training week at the Hilton in Orlando.

12 new sales reps graduated this week — proud of this group's hustle and how much they soaked up.

Onto the next class.

#SalesTraining #FieldSales #SalesCoaching`}</pre>
        </article>
        <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-semibold">📘 Facebook + 🔷 LinkedIn — new testimonial <span className="ml-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">paced 1/day</span></h3>
          <p className="mt-1 text-xs text-slate-500">
            When a trainee submits, the system pulls every essay they marked as a testimonial,
            sorts them longest-first, and <strong>queues</strong> them: longest essay for Facebook,
            second-longest for LinkedIn (different essays per platform, so the same trainee shows
            up twice — once on each network). One item per platform fires per day at 9 AM
            Eastern. A class of 12 trainees with 2 essays each → ~12 days of paced content on
            each network instead of 24 simultaneous posts.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Essays go out <strong>verbatim</strong> — exactly as the trainee typed them — never
            SEO-rewritten. Same venue photo logic as the graduation post. If a trainee only has
            one testimonial-eligible essay, Facebook gets it and LinkedIn is skipped to avoid
            duplicate quotes.
          </p>
          <pre className="mt-3 whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800 font-sans leading-snug">{`Asked one of this week's sales trainees:
"What was the most valuable part of this week's sales training?"

In their own words:

"It was a pivotal life-changing training moment where I now have a set of skills to take with me through all conversations and relationships — watch out world!"

— Kortni K. · 20+ yrs in sales

Real impact. That's why I do this. 🙌

#SalesTraining #SalesCoaching`}</pre>
        </article>
        <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-semibold">🔷 LinkedIn note — personal profile</h3>
          <p className="mt-1 text-xs text-slate-500">
            Posts to your personal LinkedIn profile (not the Company Page — that requires
            LinkedIn's Community Management API approval, ~1–2 weeks). Token expires every 60
            days — when it does, you'll need to re-run the OAuth dance from the Auth tab of the
            LinkedIn dev app (about 5 minutes). Image upload uses LinkedIn's 3-step CDN flow so
            the venue photo travels with the post.
          </p>
        </article>
      </section>
    </div>
  )
}

function SocialTestCard() {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  async function fire() {
    if (!confirm('Post a test message to your Facebook Page AND your LinkedIn profile right now? Safe to delete from both after.')) return
    setBusy(true)
    setResult(null)
    try {
      const res = await fetch('/.netlify/functions/post-social-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const body = await res.json().catch(() => ({}))
      const fb = body.facebook || {}
      const li = body.linkedin || {}
      const fbLine = fb.ok ? `✓ Facebook (${fb.post_id})` : `✗ Facebook: ${fb.error || 'unknown'}`
      const liLine = li.ok ? `✓ LinkedIn (${li.post_id || 'posted'})` : `✗ LinkedIn: ${li.error || 'unknown'}`
      const allOk = fb.ok && li.ok
      setResult({
        kind: allOk ? 'success' : fb.ok || li.ok ? 'partial' : 'error',
        lines: [fbLine, liLine],
      })
    } catch (err) {
      setResult({ kind: 'error', lines: [err.message || 'Network error'] })
    } finally {
      setBusy(false)
    }
  }
  const toneCls =
    result?.kind === 'success' ? 'text-emerald-800' :
    result?.kind === 'partial' ? 'text-amber-800' :
    result?.kind === 'error' ? 'text-red-700' : ''
  return (
    <div className="rounded-lg border-2 border-dashed border-sky-300 bg-sky-50 p-5">
      <h3 className="font-semibold text-sky-900">🧪 Send a test post to Facebook + LinkedIn</h3>
      <p className="mt-1 text-sm text-sky-900">
        Posts a one-off "if you can see this, it works" message to both your Facebook Page and your
        LinkedIn personal profile. Safe to delete from both afterward.
      </p>
      <button
        type="button"
        onClick={fire}
        disabled={busy}
        className="mt-3 rounded-md bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-50"
      >
        {busy ? 'Posting…' : 'Send test post'}
      </button>
      {result && (
        <ul className={'mt-3 space-y-0.5 text-sm ' + toneCls}>
          {result.lines.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      )}
    </div>
  )
}

// Live status of the paced testimonial queue (one row per platform) plus a
// "post next item now" override button. Reads social_post_queue directly via
// Supabase RLS — same as other admin reads on this page.
function SocialQueueCard() {
  const [rows, setRows] = useState(null) // null = loading, [] = empty
  const [busy, setBusy] = useState(null) // 'facebook' | 'linkedin' | null
  const [flashMsg, setFlashMsg] = useState(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('social_post_queue')
      .select('id, platform, scheduled_post_at, posted_at, post_id, last_error, message, created_at')
      .order('scheduled_post_at', { ascending: true })
      .limit(200)
    if (error) {
      setRows([])
      return
    }
    setRows(data || [])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function postNext(platform) {
    if (!confirm(`Post the next queued ${platform} testimonial NOW (skipping its scheduled date)?`)) return
    setBusy(platform)
    setFlashMsg(null)
    try {
      const res = await fetch('/.netlify/functions/flush-social-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform }),
      })
      const body = await res.json().catch(() => ({}))
      const r = (body.results || []).find((x) => x.platform === platform) || {}
      if (r.ok && r.posted_item_id) {
        setFlashMsg({ kind: 'success', text: `✓ Posted ${platform} (post id ${r.post_id || 'n/a'})` })
      } else if (r.ok && r.skipped) {
        setFlashMsg({ kind: 'info', text: `Nothing queued for ${platform}.` })
      } else {
        setFlashMsg({ kind: 'error', text: `✗ ${platform}: ${r.error || 'unknown'}` })
      }
      await load()
    } catch (err) {
      setFlashMsg({ kind: 'error', text: err.message || 'Network error' })
    } finally {
      setBusy(null)
    }
  }

  if (rows === null) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">
        Loading queue status…
      </div>
    )
  }

  const platforms = ['facebook', 'linkedin']
  const summary = {}
  for (const p of platforms) {
    const pending = rows.filter((r) => r.platform === p && !r.posted_at)
      .sort((a, b) => new Date(a.scheduled_post_at) - new Date(b.scheduled_post_at))
    const posted = rows.filter((r) => r.platform === p && r.posted_at)
    summary[p] = {
      pending,
      posted,
      next: pending[0] || null,
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="font-semibold">📅 Paced testimonial queue</h3>
      <p className="mt-1 text-xs text-slate-500">
        The daily 9 AM Eastern cron picks the next pending item per platform. "Post next item
        now" skips the scheduled date and fires immediately — useful for clearing a backlog or
        testing.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {platforms.map((p) => (
          <div key={p} className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold capitalize text-slate-800">
                {p === 'facebook' ? '📘 Facebook' : '🔷 LinkedIn'}
              </div>
              <button
                type="button"
                onClick={() => postNext(p)}
                disabled={busy !== null || summary[p].pending.length === 0}
                className="rounded-md bg-slate-800 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-40"
              >
                {busy === p ? 'Posting…' : 'Post next now'}
              </button>
            </div>
            <ul className="mt-2 space-y-0.5 text-xs text-slate-700">
              <li><strong>{summary[p].pending.length}</strong> pending</li>
              <li><strong>{summary[p].posted.length}</strong> posted</li>
              {summary[p].next ? (
                <li className="text-slate-500">
                  Next: {formatScheduled(summary[p].next.scheduled_post_at)}
                </li>
              ) : (
                <li className="text-slate-400">Queue empty.</li>
              )}
            </ul>
          </div>
        ))}
      </div>
      {flashMsg && (
        <div
          className={
            'mt-3 rounded-md border px-3 py-2 text-sm ' +
            (flashMsg.kind === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : flashMsg.kind === 'info'
                ? 'border-slate-200 bg-slate-100 text-slate-700'
                : 'border-red-200 bg-red-50 text-red-800')
          }
        >
          {flashMsg.text}
        </div>
      )}
      {rows.some((r) => r.last_error) && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-semibold text-amber-800">
            ⚠ {rows.filter((r) => r.last_error && !r.posted_at).length} item(s) with last_error — click to view
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-slate-700">
            {rows
              .filter((r) => r.last_error && !r.posted_at)
              .map((r) => (
                <li key={r.id} className="rounded border border-amber-200 bg-amber-50 p-2">
                  <span className="font-semibold capitalize">{r.platform}</span>{' '}
                  · scheduled {formatScheduled(r.scheduled_post_at)} ·{' '}
                  <span className="text-red-700">{r.last_error}</span>
                </li>
              ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function formatScheduled(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }) + ' ET'
  } catch {
    return iso
  }
}

function EventCard({ event, messages, subscribers }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-slate-900">{event.label}</h3>
          {event.desc && <p className="mt-1 text-sm text-slate-600">{event.desc}</p>}
          {messages?.triggers && (
            <ul className="mt-2 space-y-0.5 text-xs text-slate-500">
              {messages.triggers.map((t, i) => (
                <li key={i}>↳ {t}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="shrink-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Subscribed</div>
          {subscribers.length === 0 ? (
            <p className="mt-1 text-xs text-amber-700">⚠ Nobody yet</p>
          ) : (
            <ul className="mt-1 space-y-0.5 text-xs text-slate-700">
              {subscribers.map((s, i) => (
                <li key={i}>
                  {s.name}{' '}
                  <span className="text-slate-400">
                    ({s.notify_via_sms && s.phone ? '📱 ' : ''}
                    {s.notify_via_email && s.email ? '✉️' : ''})
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {messages ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">📱 Text</div>
            <pre className="whitespace-pre-wrap text-xs text-slate-800 font-sans leading-snug">{messages.sms}</pre>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">✉️ Email</div>
            <p className="text-xs font-semibold text-slate-800">Subject: <span className="font-normal">{messages.emailSubject}</span></p>
            <pre className="mt-1 whitespace-pre-wrap text-xs text-slate-800 font-sans leading-snug">{messages.emailBody}</pre>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-400">Template not yet documented in /messages.</p>
      )}
    </article>
  )
}

function PageCard({ page }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-slate-900">{page.label}</h3>
        <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600">{page.url}</code>
      </div>
      <p className="mt-1 text-sm text-slate-600">{page.desc}</p>
      {page.note && <p className="mt-1 text-xs text-slate-500 italic">{page.note}</p>}
      {page.linkable && (
        <Link
          to={page.url}
          className="mt-2 inline-block rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Open live page →
        </Link>
      )}
    </div>
  )
}
