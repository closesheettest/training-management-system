// A real sign-in for an admin page. The app's persona system isn't auth (anyone
// can switch persona), so a page holding company sales + pay is gated here against
// a server-side list (CCG regional-admin-pin) where EACH person signs in by NAME
// with their OWN PIN. First time for a name → create a PIN (enter + confirm);
// after that → name + PIN. No shared PIN. Unlock is session-only, so closing the
// tab re-locks (Neal, 2026-08-31).
import { useEffect, useState } from 'react'

const LB_ORIGIN = 'https://free-roof-inspections.netlify.app/.netlify/functions/'

export default function PinGate({ storageKey = 'rm_admin_ok', title = 'Regional Managers', children }) {
  const [unlocked, setUnlocked] = useState(() => {
    try { return sessionStorage.getItem(storageKey) === '1' } catch { return false }
  })
  const [who, setWho] = useState(() => { try { return sessionStorage.getItem(storageKey + '_name') || '' } catch { return '' } })

  const [step, setStep] = useState('name')      // name → enter | create
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [showReset, setShowReset] = useState(false)

  const call = (payload) => fetch(LB_ORIGIN + 'regional-admin-pin', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  }).then((r) => r.json())

  const doUnlock = (nm) => {
    try { sessionStorage.setItem(storageKey, '1'); sessionStorage.setItem(storageKey + '_name', nm || '') } catch { /* private mode */ }
    setWho(nm || ''); setUnlocked(true); setPin(''); setConfirm('')
  }

  const checkName = async (e) => {
    e?.preventDefault?.()
    if (!name.trim()) return
    setBusy(true); setErr('')
    try {
      const d = await call({ action: 'status', name })
      if (!d.ok) { setErr(d.error || 'Something went wrong.'); setBusy(false); return }
      setStep(d.exists ? 'enter' : 'create'); setPin(''); setConfirm('')
    } catch { setErr('Network error.') }
    setBusy(false)
  }

  const doEnter = async (e) => {
    e?.preventDefault?.()
    setBusy(true); setErr('')
    try {
      const d = await call({ action: 'verify', name, pin })
      if (d.ok && d.valid) doUnlock(d.name || name)
      else setErr('Wrong PIN for that name.')
    } catch { setErr('Network error.') }
    setBusy(false)
  }

  const doCreate = async (e) => {
    e?.preventDefault?.()
    setErr('')
    if (pin.trim().length < 4) { setErr('Pick a PIN of at least 4 digits.'); return }
    if (pin !== confirm) { setErr('The two PINs don’t match.'); return }
    setBusy(true)
    try {
      const d = await call({ action: 'enroll', name, pin })
      if (d.ok) doUnlock(d.name || name)
      else if (d.error && /already has a PIN/i.test(d.error)) { setErr('That name already has a PIN — enter it.'); setStep('enter') }
      else setErr(d.error || 'Could not set your PIN.')
    } catch { setErr('Network error.') }
    setBusy(false)
  }

  const lock = () => {
    try { sessionStorage.removeItem(storageKey); sessionStorage.removeItem(storageKey + '_name') } catch { /* ignore */ }
    setUnlocked(false); setStep('name'); setName(''); setPin(''); setConfirm(''); setErr('')
  }
  const startOver = () => { setStep('name'); setPin(''); setConfirm(''); setErr('') }

  if (unlocked) {
    return (
      <div>
        <div className="mb-3 flex items-center justify-end gap-3 text-xs">
          {who && <span className="text-slate-500">Signed in as <span className="font-semibold text-slate-700">{who}</span></span>}
          <button type="button" onClick={lock} className="rounded-md border border-slate-300 px-2 py-1 font-semibold text-slate-600 hover:bg-slate-50">🔒 Lock</button>
        </div>
        {children}
      </div>
    )
  }

  const inputCls = 'w-56 rounded-md border border-slate-300 px-3 py-2 text-center text-lg'

  return (
    <div className="mx-auto max-w-md py-16">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-center">
          <div className="text-4xl">🔒</div>
          <h1 className="mt-2 text-xl font-bold text-brand-navy">{title} — admin sign in</h1>
        </div>

        {step === 'name' && (
          <form onSubmit={checkName} className="mt-5 flex flex-col items-center gap-2">
            <p className="text-sm text-slate-500">Enter your name to sign in.</p>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoFocus className={inputCls} />
            <button type="submit" disabled={busy || !name.trim()} className="w-56 rounded-md bg-brand-navy px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
              {busy ? '…' : 'Continue'}
            </button>
            {err && <p className="text-sm font-semibold text-red-600">{err}</p>}
          </form>
        )}

        {step === 'enter' && (
          <form onSubmit={doEnter} className="mt-5 flex flex-col items-center gap-2">
            <p className="text-sm text-slate-500">Welcome back, <span className="font-semibold text-slate-700">{name}</span>. Enter your PIN.</p>
            <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="Your PIN" autoFocus className={inputCls + ' tracking-widest'} />
            <button type="submit" disabled={busy || !pin} className="w-56 rounded-md bg-brand-navy px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
              {busy ? 'Checking…' : 'Sign in'}
            </button>
            {err && <p className="text-sm font-semibold text-red-600">{err}</p>}
            <button type="button" onClick={startOver} className="text-xs font-semibold text-slate-400 hover:text-slate-600">← Not you? Use a different name</button>
          </form>
        )}

        {step === 'create' && (
          <form onSubmit={doCreate} className="mt-5 flex flex-col items-center gap-2">
            <p className="text-sm text-slate-500">First time, <span className="font-semibold text-slate-700">{name}</span> — set your own PIN.</p>
            <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="Create a PIN (4+ digits)" autoFocus className={inputCls + ' tracking-widest'} />
            <input type="password" inputMode="numeric" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm PIN" className={inputCls + ' tracking-widest'} />
            <button type="submit" disabled={busy || !pin || !confirm} className="w-56 rounded-md bg-brand-navy px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
              {busy ? 'Saving…' : 'Set my PIN & sign in'}
            </button>
            {err && <p className="text-sm font-semibold text-red-600">{err}</p>}
            <button type="button" onClick={startOver} className="text-xs font-semibold text-slate-400 hover:text-slate-600">← Back</button>
          </form>
        )}

        <div className="mt-5 border-t border-slate-100 pt-4 text-center">
          <button type="button" onClick={() => setShowReset((v) => !v)} className="text-xs font-semibold text-slate-400 hover:text-brand-navy">
            {showReset ? 'Hide' : 'Forgot your PIN? (admin reset)'}
          </button>
          {showReset && <div className="mt-3 text-left"><ResetPanel onDone={startOver} /></div>}
        </div>
      </div>
    </div>
  )
}

// Reset a forgotten PIN: an admin removes the name (with the master manager PIN)
// so that person can sign in again and set a fresh PIN.
function ResetPanel({ onDone }) {
  const [name, setName] = useState('')
  const [master, setMaster] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState(false)

  const reset = async () => {
    setErr(''); setOk(false)
    if (!name.trim()) { setErr('Enter the name to reset.'); return }
    setBusy(true)
    try {
      const res = await fetch(LB_ORIGIN + 'regional-admin-pin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove', master, name }),
      })
      const d = await res.json()
      if (!d.ok) { setErr(d.error || 'Could not reset.'); setBusy(false); return }
      setOk(true); setBusy(false)
    } catch { setErr('Network error.'); setBusy(false) }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-[11px] text-slate-500">Clears a person’s PIN so they can set a new one next time they sign in. Needs the master manager PIN.</p>
      <div className="mt-2 flex flex-col gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name to reset" className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
        <input type="password" inputMode="numeric" value={master} onChange={(e) => setMaster(e.target.value)} placeholder="Manager PIN" className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
        <div className="flex items-center gap-2">
          <button type="button" onClick={reset} disabled={busy || !name || !master} className="rounded-md bg-brand-navy px-3 py-1 text-xs font-bold text-white disabled:opacity-60">
            {busy ? '…' : 'Reset this PIN'}
          </button>
          {ok && <span className="text-xs font-semibold text-emerald-600">✓ Cleared — they can set a new PIN now</span>}
          {err && <span className="text-xs font-semibold text-red-600">{err}</span>}
        </div>
      </div>
    </div>
  )
}
