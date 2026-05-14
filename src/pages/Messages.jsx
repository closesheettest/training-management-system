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
  trainee_review_request: {
    triggers: ['Fires automatically right after a trainee submits their final test. Sent to the trainee\'s personal email (not via /notifications). Pre-picks two of their own essay answers — one for Google, one for Yelp.'],
    sms: '(this one is email-only — sent to the trainee\'s personal email after submitting their final test)',
    emailSubject: `Thanks for completing your training, Sample — 30-second favor?`,
    emailBody:
      `Hi Sample,\n\n` +
      `Thanks so much for finishing your final assessment — that's a real accomplishment.\n\n` +
      `One small ask: would you take 30 seconds to leave a quick review? We've pre-picked one of your own essay answers for each site — just click the link, then paste the answer below.\n\n` +
      `────────────────────────────────────────\n` +
      `⭐ GOOGLE REVIEW\n` +
      `Step 1 — click: https://g.page/r/.../review\n` +
      `Step 2 — copy & paste this answer of yours:\n\n` +
      `"<longest essay response goes here>"\n\n` +
      `────────────────────────────────────────\n` +
      `⭐ YELP REVIEW\n` +
      `Step 1 — click: https://www.yelp.com/writeareview/biz/...\n` +
      `Step 2 — copy & paste this different answer of yours:\n\n` +
      `"<second-longest essay response goes here>"\n\n` +
      `────────────────────────────────────────\n` +
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
        <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-semibold">📘 Facebook — class graduated</h3>
          <p className="mt-1 text-xs text-slate-500">
            Auto-fires when the last trainee in a class submits the final test (alongside the
            graduation-report email). Attaches a random photo from the venue's photo library
            (manage at /locations) when available.
          </p>
          <pre className="mt-3 whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800 font-sans leading-snug">{`🎓 Just wrapped another training week at the Hilton in Orlando.

12 new sales reps graduated this week — proud of this group's hustle and how much they soaked up.

Onto the next class.

#SalesTraining #FieldSales #SalesCoaching`}</pre>
        </article>
        <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-semibold">📘 Facebook — new testimonial</h3>
          <p className="mt-1 text-xs text-slate-500">
            Auto-fires the instant a trainee submits their final test, IF they wrote a
            "use-for-testimonial" essay. Uses the longest one. Same photo logic as graduation post.
          </p>
          <pre className="mt-3 whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800 font-sans leading-snug">{`One of this week's trainees, in their own words:

"It was a pivotal life-changing training moment where I now have a set of skills to take with me through all conversations and relationships — watch out world!"

— Kortni K. · 20+ yrs in sales

Real impact. That's why I do this. 🙌

#SalesTraining #SalesCoaching`}</pre>
        </article>
        <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-semibold">🔷 LinkedIn — same copy, fires alongside Facebook</h3>
          <p className="mt-1 text-xs text-slate-500">
            Posts to your personal LinkedIn profile (not the Company Page — that requires
            LinkedIn's Community Management API approval, ~1–2 weeks). Same generic copy as
            Facebook. Token expires every 60 days — when it does, you'll need to re-run the OAuth
            dance from the Auth tab of the LinkedIn dev app (about 5 minutes).
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Posts include the same venue photo as Facebook when available — LinkedIn uploads it
            to their own CDN automatically.
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
