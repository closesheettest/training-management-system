import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'

function detectPlatform() {
  if (typeof navigator === 'undefined') return 'iphone'
  const ua = (navigator.userAgent || '').toLowerCase()
  if (/iphone|ipad|ipod/.test(ua)) return 'iphone'
  if (/android/.test(ua)) return 'android'
  return 'iphone' // sensible default
}

export default function Credentials() {
  const { token } = useParams()
  const [status, setStatus] = useState('loading') // loading | not_found | ready | not_provisioned
  const [trainee, setTrainee] = useState(null)
  const [platform, setPlatform] = useState(detectPlatform())
  const [revealPassword, setRevealPassword] = useState(false)

  useEffect(() => {
    if (!token) {
      setStatus('not_found')
      return
    }
    load()
  }, [token])

  async function load() {
    setStatus('loading')
    const { data, error } = await supabase
      .from('trainees')
      .select('id, first_name, last_name, company_email, company_email_password, email_assigned_at, credentials_viewed_at')
      .eq('registration_token', token)
      .maybeSingle()
    if (error || !data) {
      setStatus('not_found')
      return
    }
    setTrainee(data)
    if (!data.company_email) {
      setStatus('not_provisioned')
      return
    }
    // Stamp viewed_at on first load (best-effort)
    if (!data.credentials_viewed_at) {
      supabase
        .from('trainees')
        .update({ credentials_viewed_at: new Date().toISOString() })
        .eq('id', data.id)
        .then(() => {})
    }
    setStatus('ready')
  }

  if (status === 'loading') return <p className="text-slate-500">Loading…</p>

  if (status === 'not_found') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center">
        <h1 className="text-2xl font-semibold text-red-900">Link not found</h1>
        <p className="mt-2 text-red-800">
          This link may have expired. Please contact your training manager.
        </p>
      </div>
    )
  }

  if (status === 'not_provisioned') {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-8 text-center">
        <h1 className="text-2xl font-semibold text-amber-900">Email not assigned yet</h1>
        <p className="mt-2 text-amber-800">
          Your company email hasn't been set up yet. Try again later, or check with your training
          manager.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-brand-navy">
          Your company email is ready
          {trainee?.first_name ? `, ${trainee.first_name}` : ''}!
        </h1>
        <p className="mt-2 text-slate-600">
          Below are your login details and step-by-step instructions for adding this account to your
          phone. <strong>Save your password somewhere safe</strong> — you'll be asked to change it
          when you first sign in.
        </p>
      </div>

      {/* Credentials card */}
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <CredentialField
          label="Email"
          value={trainee.company_email}
          copyLabel="Copy email"
        />
        <CredentialField
          label="Password"
          value={trainee.company_email_password}
          copyLabel="Copy password"
          masked={!revealPassword}
          onToggleReveal={() => setRevealPassword((v) => !v)}
          revealed={revealPassword}
        />
      </div>

      {/* Platform tabs */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex border-b border-slate-200">
          <PlatformTab active={platform === 'iphone'} onClick={() => setPlatform('iphone')}>
            📱 iPhone
          </PlatformTab>
          <PlatformTab active={platform === 'android'} onClick={() => setPlatform('android')}>
            🤖 Android
          </PlatformTab>
        </div>
        <div className="p-6">
          {platform === 'iphone' ? <IphoneSteps /> : <AndroidSteps />}
        </div>
      </div>

      {/* Next step: install the two apps we use every day */}
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-brand-navy">Next: install your apps</h2>
        <p className="mt-1 text-sm text-slate-600">
          Once your email is set up, install RepCard and JobNimbus — the two apps you'll use every
          day.
        </p>
        <Link
          to="/apps"
          className="mt-4 inline-flex items-center justify-center rounded-md bg-brand-red px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90"
        >
          Click here for app downloads →
        </Link>
      </div>

      {/* Footer note */}
      <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        Trouble signing in? Make sure you typed the password exactly as shown (it's case-sensitive).
        If you're still stuck, ask your training manager for help.
      </div>
    </div>
  )
}

function CredentialField({ label, value, copyLabel, masked = false, onToggleReveal, revealed }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(value || '')
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      window.prompt(`${label}:`, value || '')
    }
  }
  return (
    <div>
      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</label>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 break-all rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-base text-slate-900">
          {masked ? '••••••••••' : value}
        </div>
        {onToggleReveal && (
          <button
            type="button"
            onClick={onToggleReveal}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            {revealed ? 'Hide' : 'Show'}
          </button>
        )}
        <button
          type="button"
          onClick={copy}
          className="rounded-md bg-brand-navy px-3 py-2 text-xs font-semibold text-white hover:bg-brand-navy-dark"
        >
          {copied ? 'Copied!' : copyLabel}
        </button>
      </div>
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

function IphoneSteps() {
  return (
    <ol className="space-y-3 text-sm text-slate-700">
      <Step n={1}>
        Open the <strong>Settings</strong> app on your iPhone.
      </Step>
      <Step n={2}>
        Scroll down and tap <strong>Mail</strong> (or <strong>Apps</strong> → <strong>Mail</strong> on
        newer iOS).
      </Step>
      <Step n={3}>
        Tap <strong>Mail Accounts</strong>.
      </Step>
      <Step n={4}>
        Tap <strong>Add Account</strong>.
      </Step>
      <Step n={5}>
        Tap <strong>Google</strong>.
      </Step>
      <Step n={6}>
        Tap <strong>Continue</strong> if asked, then sign in with your <strong>company email</strong>{' '}
        and <strong>password</strong> shown above.
      </Step>
      <Step n={7}>
        Choose which items to sync (turn on <strong>Mail</strong> at minimum — Calendar and Contacts
        recommended). Tap <strong>Save</strong>.
      </Step>
      <Step n={8}>
        Open the <strong>Mail</strong> app — your company inbox should appear within a minute.
      </Step>
      <Tip>
        You'll be prompted to change your password the first time you sign in. Pick something
        you'll remember, and write it down.
      </Tip>
    </ol>
  )
}

function AndroidSteps() {
  return (
    <ol className="space-y-3 text-sm text-slate-700">
      <Step n={1}>
        Open the <strong>Gmail</strong> app.
      </Step>
      <Step n={2}>
        Tap your <strong>profile picture</strong> in the top-right corner.
      </Step>
      <Step n={3}>
        Tap <strong>Add another account</strong>.
      </Step>
      <Step n={4}>
        Tap <strong>Google</strong>.
      </Step>
      <Step n={5}>
        Enter your <strong>company email</strong> shown above, tap <strong>Next</strong>.
      </Step>
      <Step n={6}>
        Enter your <strong>password</strong> shown above, tap <strong>Next</strong>.
      </Step>
      <Step n={7}>
        Accept the terms when prompted.
      </Step>
      <Step n={8}>
        Your company inbox will now appear. Tap your profile picture again to switch between your
        personal and company accounts.
      </Step>
      <Tip>
        You'll be prompted to change your password the first time you sign in. Pick something
        you'll remember, and write it down.
      </Tip>
    </ol>
  )
}

function Step({ n, children }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-navy text-xs font-bold text-white">
        {n}
      </span>
      <span className="flex-1 pt-1">{children}</span>
    </li>
  )
}

function Tip({ children }) {
  return (
    <li className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
      💡 <strong>Tip:</strong> {children}
    </li>
  )
}
