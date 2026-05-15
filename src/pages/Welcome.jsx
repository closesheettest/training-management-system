import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

// Public welcome page for newly-graduated reps. The system texts the
// link to this page daily for 7 days after they finish training.
//
// One job: cut down on "where do I find X" phone calls during their
// first week. Big tap-targets, mobile-first layout, plus simple
// Google sign-in instructions since two of the links require it.

export default function Welcome() {
  const [resources, setResources] = useState(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    const { data, error } = await supabase
      .from('welcome_resources')
      .select('*')
      .eq('active', true)
      .order('display_order', { ascending: true })
    if (error) {
      setResources([])
      return
    }
    setResources(data || [])
  }

  if (resources === null) {
    return <p className="text-sm text-slate-500">Loading…</p>
  }

  return (
    <div className="space-y-6">
      <header className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Welcome to U.S. Shingle &amp; Metal!
        </h1>
        <p className="mt-2 text-slate-600">
          Your quick-links page. Save this text on your phone — these are the things you'll
          need most during your first week.
        </p>
      </header>

      <SignInNote />

      {resources.length === 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          No resources have been added yet. Admin can manage these on /welcome-links.
        </div>
      ) : (
        <ul className="space-y-3">
          {resources.map((r) => (
            <li key={r.id}>
              <a
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className={
                  'block overflow-hidden rounded-lg shadow-sm hover:shadow-md ' +
                  (r.mandatory
                    ? 'border-4 border-red-600 bg-white'
                    : 'border border-slate-200 bg-white hover:border-brand-navy')
                }
              >
                {r.mandatory && (
                  <div className="bg-red-600 px-3 py-2 text-center text-sm font-extrabold uppercase tracking-wide text-white sm:text-base">
                    ⚠️ {r.mandatory_note || 'MANDATORY'}
                  </div>
                )}
                <div className="flex items-start gap-3 p-4">
                  {r.icon && (
                    <span
                      className={r.mandatory ? 'text-3xl leading-none' : 'text-2xl leading-none'}
                      aria-hidden="true"
                    >
                      {r.icon}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={
                          r.mandatory
                            ? 'text-xl font-extrabold text-red-700 sm:text-2xl'
                            : 'text-base font-semibold text-brand-navy'
                        }
                      >
                        {r.label}
                      </span>
                      <span
                        className={r.mandatory ? 'text-red-500' : 'text-slate-400'}
                        aria-hidden="true"
                      >
                        ↗
                      </span>
                    </div>
                    {r.description && (
                      <p
                        className={
                          r.mandatory
                            ? 'mt-1 text-sm font-medium text-slate-800'
                            : 'mt-1 text-sm text-slate-600'
                        }
                      >
                        {r.description}
                      </p>
                    )}
                    {r.requires_google_signin && (
                      <p className="mt-2 inline-block rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                        🔐 Sign in to Google with your @shingleusa.com email first
                      </p>
                    )}
                  </div>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}

      <footer className="rounded-md border border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-500">
        After this week, the daily texts will stop. You'll find everything here on your
        Sales Rep Dashboard. Save that link.
      </footer>
    </div>
  )
}

// Quick instructions for getting signed in to the company Google account
// so the Sales Rep Dashboard + Drive videos open without an "access
// denied" page.
//
// Open by default — first-time users need to actually read this before
// tapping the Google-sign-in-required links below. Big bold amber
// header so it's impossible to scroll past on a phone. Trainees can
// collapse it if they've already done the steps.
function SignInNote() {
  const [open, setOpen] = useState(true)
  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.target.open)}
      className="overflow-hidden rounded-xl border-4 border-amber-400 bg-amber-50 shadow-md"
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 bg-amber-200 px-4 py-4 text-base font-extrabold uppercase tracking-wide text-amber-900 sm:text-lg">
        <span aria-hidden="true" className="text-2xl">⚠️</span>
        <span className="flex-1 leading-tight">
          Start here — sign in to your @shingleusa.com Google account FIRST
        </span>
        <span aria-hidden="true" className="ml-2 text-xl text-amber-700">
          {open ? '▾' : '▸'}
        </span>
      </summary>
      <div className="space-y-4 p-4 text-sm text-amber-950">
        <p className="text-base font-semibold">
          Two of the links below (Sales Rep Dashboard + How-to Videos) only open when you're
          signed in to Google with your <strong>@shingleusa.com</strong> email — the one IT
          set up for you during training. Do this first or you'll get "Access denied."
        </p>

        <div className="rounded-md bg-white p-3">
          <div className="text-base font-bold">📱 On iPhone</div>
          <ol className="ml-5 mt-2 list-decimal space-y-1.5">
            <li>
              Open the <strong>Chrome</strong> app (download from the App Store if you don't
              have it).
            </li>
            <li>Tap the circle with your photo / initial in the top right.</li>
            <li>
              Tap <strong>"Add another account"</strong> (or <strong>"Sign in"</strong> if no
              account is there yet).
            </li>
            <li>
              Enter your <strong>@shingleusa.com</strong> email + the password IT gave you.
            </li>
            <li>If you have multiple accounts, tap the photo again and switch to this one.</li>
            <li>Come back to this page and tap the links below — they'll open right up.</li>
          </ol>
        </div>

        <div className="rounded-md bg-white p-3">
          <div className="text-base font-bold">🤖 On Android</div>
          <ol className="ml-5 mt-2 list-decimal space-y-1.5">
            <li>Open the <strong>Chrome</strong> app (already installed on most Androids).</li>
            <li>Tap the three dots in the top right → <strong>Settings</strong>.</li>
            <li>Tap your name / email at the top of Settings.</li>
            <li>
              Tap <strong>"Add account"</strong> and sign in with your{' '}
              <strong>@shingleusa.com</strong> email.
            </li>
            <li>
              Back on the main Chrome screen, tap your account avatar (top right) and switch
              to the company account.
            </li>
            <li>Come back here and tap the links below.</li>
          </ol>
        </div>

        <p className="text-sm font-semibold">
          Stuck? Text your hiring manager — they can walk you through it.
        </p>
      </div>
    </details>
  )
}
