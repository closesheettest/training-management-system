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
    url: '/register/<token>',
    public: true,
  },
  {
    label: 'Credentials page',
    desc: 'Day-2 link with their company email + password and step-by-step iPhone/Android Gmail setup. Auto-detects platform from user-agent.',
    url: '/credentials/<token>',
    public: true,
  },
  {
    label: 'App downloads',
    desc: 'RepCard + JobNimbus install instructions. Linked from the credentials page button. Public — no token needed.',
    url: '/apps',
    public: true,
    linkable: true,
  },
  {
    label: 'Final test',
    desc: 'Last-day assessment. Multiple-choice + essay/testimonial questions. Score and retention % are saved to test_attempts.',
    url: '/test/<token>',
    public: true,
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
            One-page Letter PDF: class header, stats card (graduates / tests submitted / avg
            retention), roster table with name, company email, days attended, test score, correct
            answers, and RepCard / JobNimbus / Sales Academy setup status. Attached to the email
            subscribers receive after the last trainee submits their final test.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            To preview a real one, run the function manually from your terminal or hit the
            dry-run URL:{' '}
            <code className="rounded bg-slate-100 px-1 font-mono text-[0.85em]">
              /.netlify/functions/send-graduation-report?secret=&lt;CRON_SECRET&gt;&amp;dry_run=1
            </code>
          </p>
        </div>
      </section>
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
