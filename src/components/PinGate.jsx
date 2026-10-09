// A real sign-in for an admin page. The app's persona system isn't auth (anyone
// can switch persona), so a page holding company sales + pay is gated here against
// a server-side list (CCG regional-admin-pin) where EACH person signs in by NAME
// with their OWN PIN. First time for a name → create a PIN (enter + confirm);
// after that → name + PIN. No shared PIN. Unlock is session-only, so closing the
// tab re-locks (Neal, 2026-08-31).
import { useEffect, useState } from 'react'

const LB_ORIGIN = 'https://free-roof-inspections.netlify.app/.netlify/functions/'

// keepPin: also hold the PIN for this tab so the page can hand it to its own
// server functions, which re-check it (Sales Training Customer spends Gemini
// money per call). Session-only, cleared on Lock.
// acceptMt: opened from My Tools with #mt=<base64 {name, pin}> (the person's My Tools sign-in) — checked with CCG,
// then the page is unlocked without a second PIN (Neal, 2026-10-09). The page's server functions must accept
// "mt:<…>" as the PIN (Sales Training Customer: _practice-auth verifyTrainerPin). Wiped from the address bar at once.
const MT_URL = 'https://free-roof-inspections.netlify.app/.netlify/functions/manager-dashboard'
// ONE SIGN-IN (Neal, 2026-10-09: "a pin just to get in and you have access to all the stuff you have access to"):
// whichever gated page someone signs into, the sign-in is kept for 12 hours on this device and every other gated
// page (any tab) opens with it. The servers accept it the same way (admin PIN or My Tools sign-in). Lock clears it.
const SHARED = 'tms_signin', SHARED_HOURS = 12
const readShared = () => { try { const v = JSON.parse(localStorage.getItem(SHARED) || 'null'); return v && v.exp > Date.now() && v.cred ? v : null } catch { return null } }
const saveShared = (name, cred) => { try { localStorage.setItem(SHARED, JSON.stringify({ name: name || '', cred, exp: Date.now() + SHARED_HOURS * 3600 * 1000 })) } catch { /* private mode */ } }
export default function PinGate({ storageKey = 'rm_admin_ok', title = 'Regional Managers', keepPin = false, acceptMt = true, children }) {
  const [unlocked, setUnlocked] = useState(() => {
    try {
      if (sessionStorage.getItem(storageKey) === '1') return true
      const sh = readShared()   // signed in on another page → this one too (its own keys seeded for the page's code)
      if (sh) { sessionStorage.setItem(storageKey, '1'); sessionStorage.setItem(storageKey + '_name', sh.name); sessionStorage.setItem(storageKey + '_pin', sh.cred); return true }
      return false
    } catch { return false }
  })
  const [who, setWho] = useState(() => { try { return sessionStorage.getItem(storageKey + '_name') || '' } catch { return '' } })
  // Coming from My Tools: say so instead of flashing the PIN screen while CCG checks the sign-in.
  const [mtChecking, setMtChecking] = useState(() => { try { return acceptMt && /mt=/.test(window.location.hash) } catch { return false } })

  const [step, setStep] = useState('pin')       // pin (returning) → create (first time)
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [showReset, setShowReset] = useState(false)

  useEffect(() => {
    if (!acceptMt) return
    let raw = ''
    try { const m = window.location.hash.match(/mt=([^&]+)/); if (m) { raw = m[1]; window.history.replaceState(null, '', window.location.pathname + window.location.search) } } catch { /* */ }
    if (!raw) return
    let mt = null
    try { mt = JSON.parse(decodeURIComponent(atob(raw))) } catch { setMtChecking(false); return }
    ;(async () => {
      try {
      const has = await fetch(`${MT_URL}?manager=${encodeURIComponent(mt.name || '')}`).then((r) => r.json()).catch(() => ({}))
      if (!has.pin_set) return
      const ok = await fetch(MT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'auth', manager: mt.name, pin: mt.pin }) }).then((r) => r.json()).catch(() => ({}))
      if (!ok.ok) return
      try {
        sessionStorage.setItem(storageKey, '1'); sessionStorage.setItem(storageKey + '_name', mt.name || '')
        if (keepPin) sessionStorage.setItem(storageKey + '_pin', 'mt:' + raw)
      } catch { /* private mode */ }
      saveShared(mt.name, 'mt:' + raw)
      setWho(mt.name || ''); setUnlocked(true)
      } finally { setMtChecking(false) }
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const call = (payload) => fetch(LB_ORIGIN + 'regional-admin-pin', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  }).then((r) => r.json())

  const doUnlock = (nm) => {
    try {
      sessionStorage.setItem(storageKey, '1'); sessionStorage.setItem(storageKey + '_name', nm || '')
      if (keepPin) sessionStorage.setItem(storageKey + '_pin', pin)
    } catch { /* private mode */ }
    if (pin) saveShared(nm, pin)
    setWho(nm || ''); setUnlocked(true); setPin(''); setConfirm(''); setName('')
  }

  // Returning user: just their PIN — it identifies them (PINs are unique).
  const doEnter = async (e) => {
    e?.preventDefault?.()
    if (!pin.trim()) return
    setBusy(true); setErr('')
    try {
      const d = await call({ action: 'verify', pin })
      if (d.ok && d.valid) doUnlock(d.name || '')
      else setErr('That PIN isn’t recognized.')
    } catch { setErr('Network error.') }
    setBusy(false)
  }

  const doCreate = async (e) => {
    e?.preventDefault?.()
    setErr('')
    if (!name.trim()) { setErr('Enter your name.'); return }
    if (pin.trim().length < 4) { setErr('Pick a PIN of at least 4 digits.'); return }
    if (pin !== confirm) { setErr('The two PINs don’t match.'); return }
    setBusy(true)
    try {
      const d = await call({ action: 'enroll', name, pin })
      if (d.ok) doUnlock(d.name || name)
      else if (d.error && /already has a PIN/i.test(d.error)) { setErr('That name already has a PIN — just enter your PIN below.'); setStep('pin'); setPin(''); setConfirm('') }
      else setErr(d.error || 'Could not set your PIN.')
    } catch { setErr('Network error.') }
    setBusy(false)
  }

  const lock = () => {
    try { sessionStorage.removeItem(storageKey); sessionStorage.removeItem(storageKey + '_name'); sessionStorage.removeItem(storageKey + '_pin'); localStorage.removeItem(SHARED) } catch { /* ignore */ }
    setUnlocked(false); setStep('pin'); setName(''); setPin(''); setConfirm(''); setErr('')
  }
  const startOver = () => { setStep('pin'); setPin(''); setConfirm(''); setName(''); setErr('') }

  if (!unlocked && mtChecking) return <div className="p-10 text-center text-slate-500">Signing you in from My Tools…</div>
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

        {step === 'pin' && (
          <form onSubmit={doEnter} className="mt-5 flex flex-col items-center gap-2">
            <p className="text-sm text-slate-500">Enter your PIN.</p>
            <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="Your PIN" autoFocus className={inputCls + ' tracking-widest'} />
            <button type="submit" disabled={busy || !pin} className="w-56 rounded-md bg-brand-navy px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
              {busy ? 'Checking…' : 'Sign in'}
            </button>
            {err && <p className="text-sm font-semibold text-red-600">{err}</p>}
            <button type="button" onClick={() => { setStep('create'); setPin(''); setConfirm(''); setErr('') }} className="text-xs font-semibold text-slate-400 hover:text-brand-navy">
              First time here? Set up your PIN
            </button>
          </form>
        )}

        {step === 'create' && (
          <form onSubmit={doCreate} className="mt-5 flex flex-col items-center gap-2">
            <p className="text-sm text-slate-500">First time — enter your name and choose a PIN. After this you’ll only need the PIN.</p>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoFocus className={inputCls} />
            <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="Create a PIN (4+ digits)" className={inputCls + ' tracking-widest'} />
            <input type="password" inputMode="numeric" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm PIN" className={inputCls + ' tracking-widest'} />
            <button type="submit" disabled={busy || !name.trim() || !pin || !confirm} className="w-56 rounded-md bg-brand-navy px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
              {busy ? 'Saving…' : 'Set my PIN & sign in'}
            </button>
            {err && <p className="text-sm font-semibold text-red-600">{err}</p>}
            <button type="button" onClick={startOver} className="text-xs font-semibold text-slate-400 hover:text-slate-600">← Back to PIN sign-in</button>
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
