import { useState } from 'react'
import { Link } from 'react-router-dom'

function detectPlatform() {
  if (typeof navigator === 'undefined') return 'iphone'
  const ua = (navigator.userAgent || '').toLowerCase()
  if (/iphone|ipad|ipod/.test(ua)) return 'iphone'
  if (/android/.test(ua)) return 'android'
  return 'iphone' // sensible default
}

const APPS = [
  {
    key: 'repcard',
    name: 'RepCard',
    tagline: 'Digital business cards + follow-up automation for field sales.',
    ios: 'https://apps.apple.com/us/app/repcard-field-sales-platform/id1372990002',
    android: 'https://play.google.com/store/apps/details?id=com.rocket.repcard',
    note: null,
  },
  {
    key: 'jobnimbus',
    name: 'JobNimbus',
    tagline: 'All-in-one CRM — contacts, jobs, and tasks on the go.',
    ios: 'https://apps.apple.com/us/app/jobnimbus-all-in-one-roof-app/id1571207100',
    android: 'https://play.google.com/store/apps/details?id=com.jobnimbus.leadssalesprojects',
    note: (
      <>
        <strong>If the JobNimbus app says your password is wrong:</strong> tap{' '}
        <strong>Forgot password</strong> in the app, then go back to your email and click the{' '}
        <strong>new</strong> reset link. Set the password again (use{' '}
        <code className="rounded bg-slate-100 px-1 font-mono text-[0.85em]">BlueCat12!</code>),
        then come back to the app and sign in.
      </>
    ),
  },
]

export default function AppDownloads() {
  const [platform, setPlatform] = useState(detectPlatform())

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-brand-navy">
          Install your apps
        </h1>
        <p className="mt-2 text-slate-600">
          You'll use <strong>RepCard</strong> and <strong>JobNimbus</strong> every day. Follow the
          steps below carefully — the order matters.
        </p>
      </div>

      {/* CRITICAL: do the email-link sign-in first, THEN download the app */}
      <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-5">
        <h2 className="text-base font-bold text-amber-900">
          ⚠️ Read this first — sign in through the email link, not the app
        </h2>
        <p className="mt-2 text-sm text-amber-900">
          You'll get a separate invitation email from each app. <strong>Click the link in the
          email first</strong> to set your password in a web browser. <em>Only after that</em>{' '}
          should you download the app and sign in. If you skip ahead and try to sign in inside the
          app, it won't work.
        </p>
        <ol className="mt-4 space-y-2.5 text-sm text-amber-900">
          <FlowStep n={1}>
            Open the <strong>invitation email</strong> from the app (RepCard or JobNimbus).
          </FlowStep>
          <FlowStep n={2}>
            Tap the <strong>sign-in / activate link</strong> in the email — it opens in your
            phone's web browser.
          </FlowStep>
          <FlowStep n={3}>
            Set your password to{' '}
            <code className="rounded bg-white px-1.5 py-0.5 font-mono text-[0.9em]">
              BlueCat12!
            </code>{' '}
            (keep it the same as your other logins if you can). Finish signing in on the browser.
          </FlowStep>
          <FlowStep n={4}>
            <strong>Now</strong> download the app below and open it.
          </FlowStep>
          <FlowStep n={5}>
            Sign in to the app with the <strong>same email and password</strong> you just set.
          </FlowStep>
        </ol>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex border-b border-slate-200">
          <PlatformTab active={platform === 'iphone'} onClick={() => setPlatform('iphone')}>
            📱 iPhone
          </PlatformTab>
          <PlatformTab active={platform === 'android'} onClick={() => setPlatform('android')}>
            🤖 Android
          </PlatformTab>
        </div>
        <div className="divide-y divide-slate-200">
          {APPS.map((app) => (
            <AppRow key={app.key} app={app} platform={platform} />
          ))}
        </div>
      </div>

      <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        Installation problems? Make sure you're signed into the App Store (iPhone) or Google Play
        (Android) with your personal Apple ID / Google account — not your new company email.
      </div>

      <div className="pt-2">
        <Link
          to={-1}
          className="text-sm text-slate-500 hover:text-slate-700 hover:underline"
        >
          ← Back
        </Link>
      </div>
    </div>
  )
}

function AppRow({ app, platform }) {
  const storeUrl = platform === 'android' ? app.android : app.ios
  const storeLabel = platform === 'android' ? 'Get it on Google Play' : 'Download on the App Store'

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start gap-4">
        <AppIcon name={app.name} />
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold text-brand-navy">{app.name}</h2>
          <p className="mt-1 text-sm text-slate-600">{app.tagline}</p>
        </div>
      </div>

      <a
        href={storeUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex w-full items-center justify-center gap-2 rounded-md bg-brand-navy px-4 py-3 text-sm font-semibold text-white hover:bg-brand-navy-dark"
      >
        {platform === 'android' ? '▶' : ''} {storeLabel}
      </a>
      <a
        href={platform === 'android' ? app.ios : app.android}
        target="_blank"
        rel="noopener noreferrer"
        className="block text-center text-xs text-slate-500 hover:text-slate-700 hover:underline"
      >
        On the other phone? {platform === 'android' ? 'Open App Store link' : 'Open Google Play link'}
      </a>

      {app.note && (
        <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
          💡 {app.note}
        </div>
      )}
    </div>
  )
}

function FlowStep({ n, children }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-900 text-xs font-bold text-amber-50">
        {n}
      </span>
      <span className="flex-1 pt-0.5">{children}</span>
    </li>
  )
}

function AppIcon({ name }) {
  const initial = (name || '?').charAt(0).toUpperCase()
  return (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-brand-navy text-2xl font-bold text-white">
      {initial}
    </div>
  )
}

function PlatformTab({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'flex-1 border-b-2 border-brand-red px-4 py-3 text-sm font-semibold text-brand-navy'
          : 'flex-1 border-b-2 border-transparent px-4 py-3 text-sm font-medium text-slate-600 hover:text-slate-900'
      }
    >
      {children}
    </button>
  )
}
