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
  },
  {
    key: 'jobnimbus',
    name: 'JobNimbus',
    tagline: 'All-in-one CRM — contacts, jobs, and tasks on the go.',
    ios: 'https://apps.apple.com/us/app/jobnimbus-all-in-one-roof-app/id1571207100',
    android: 'https://play.google.com/store/apps/details?id=com.jobnimbus.leadssalesprojects',
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
          Download the two apps you'll be using every day. Tap the store button that matches your
          phone.
        </p>
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

      {/* Specific instructions for {app.name} go here — fill in once provided. */}
    </div>
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
