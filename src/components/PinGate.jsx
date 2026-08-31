// A real PIN lock for an admin page. The app's persona system isn't auth (anyone
// can switch persona), so a page holding company sales + pay is gated here against
// a server-side access list (CCG regional-admin-pin) where EACH user has their own
// unique PIN. Unlock lasts for the browser session only, so closing the tab
// re-locks. Managing who can get in needs the master manager PIN (Neal, 2026-08-31).
import { useEffect, useState } from 'react'

const LB_ORIGIN = 'https://free-roof-inspections.netlify.app/.netlify/functions/'

export default function PinGate({ storageKey = 'rm_admin_ok', title = 'Regional Managers', children }) {
  const [unlocked, setUnlocked] = useState(() => {
    try { return sessionStorage.getItem(storageKey) === '1' } catch { return false }
  })
  const [who, setWho] = useState(() => { try { return sessionStorage.getItem(storageKey + '_name') || '' } catch { return '' } })
  const [isSet, setIsSet] = useState(null)      // does anyone have access yet?
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [showAdmin, setShowAdmin] = useState(false)

  useEffect(() => {
    fetch(LB_ORIGIN + 'regional-admin-pin').then((r) => r.json())
      .then((d) => { if (d && d.ok) setIsSet(!!d.is_set) }).catch(() => setIsSet(false))
  }, [])

  const unlock = async (e) => {
    e?.preventDefault?.()
    setBusy(true); setErr('')
    try {
      const res = await fetch(LB_ORIGIN + 'regional-admin-pin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', pin }),
      })
      const d = await res.json()
      if (d && d.ok && d.valid) {
        try { sessionStorage.setItem(storageKey, '1'); sessionStorage.setItem(storageKey + '_name', d.name || '') } catch { /* private mode */ }
        setWho(d.name || ''); setUnlocked(true); setPin('')
      } else setErr('That PIN isn’t on the access list.')
    } catch { setErr('Network error.') }
    setBusy(false)
  }

  const lock = () => {
    try { sessionStorage.removeItem(storageKey); sessionStorage.removeItem(storageKey + '_name') } catch { /* ignore */ }
    setUnlocked(false); setWho('')
  }

  if (unlocked) {
    return (
      <div>
        <div className="mb-3 flex items-center justify-end gap-3 text-xs">
          {who && <span className="text-slate-500">Unlocked as <span className="font-semibold text-slate-700">{who}</span></span>}
          <button type="button" onClick={() => setShowAdmin((v) => !v)} className="font-semibold text-slate-500 hover:text-brand-navy">Manage access</button>
          <button type="button" onClick={lock} className="rounded-md border border-slate-300 px-2 py-1 font-semibold text-slate-600 hover:bg-slate-50">🔒 Lock</button>
        </div>
        {showAdmin && <div className="mb-4"><AccessAdmin onClose={() => setShowAdmin(false)} onChanged={() => setIsSet(true)} /></div>}
        {children}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md py-16">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-center">
          <div className="text-4xl">🔒</div>
          <h1 className="mt-2 text-xl font-bold text-brand-navy">{title} — admin only</h1>
          <p className="mt-1 text-sm text-slate-500">
            {isSet === false
              ? 'No one has access yet. An admin can add the first person below (needs the manager PIN).'
              : 'Enter your PIN to view this page.'}
          </p>
        </div>

        {isSet !== false && (
          <form onSubmit={unlock} className="mt-5 flex flex-col items-center gap-2">
            <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)}
              placeholder="Your PIN" autoFocus
              className="w-44 rounded-md border border-slate-300 px-3 py-2 text-center text-lg tracking-widest" />
            <button type="submit" disabled={busy || !pin}
              className="w-44 rounded-md bg-brand-navy px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
              {busy ? 'Checking…' : 'Unlock'}
            </button>
            {err && <p className="text-sm font-semibold text-red-600">{err}</p>}
          </form>
        )}

        <div className="mt-5 border-t border-slate-100 pt-4">
          {isSet === false ? (
            <AccessAdmin startOpen onChanged={() => setIsSet(true)} />
          ) : (
            <>
              <button type="button" onClick={() => setShowAdmin((v) => !v)} className="text-xs font-semibold text-slate-500 hover:text-brand-navy">
                {showAdmin ? 'Hide' : 'Admin: manage who can access'}
              </button>
              {showAdmin && <div className="mt-3"><AccessAdmin onChanged={() => setIsSet(true)} /></div>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// The admin function: add or remove people, each with their own unique PIN.
// Gated by the master manager PIN — entered once to load the list, then reused.
function AccessAdmin({ startOpen = false, onClose, onChanged }) {
  const [master, setMaster] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [users, setUsers] = useState([])
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const call = async (payload) => {
    const res = await fetch(LB_ORIGIN + 'regional-admin-pin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ master, ...payload }),
    })
    return res.json()
  }
  const loadList = async () => {
    setBusy(true); setErr(''); setMsg('')
    try {
      const d = await call({ action: 'list' })
      if (!d.ok) { setErr(d.error || 'Could not load.'); setBusy(false); return }
      setUsers(d.users || []); setLoaded(true)
    } catch { setErr('Network error.') }
    setBusy(false)
  }
  const add = async () => {
    setErr(''); setMsg('')
    if (!name.trim()) { setErr('Enter a name.'); return }
    if (pin.trim().length < 4) { setErr('PIN must be at least 4 digits.'); return }
    setBusy(true)
    try {
      const d = await call({ action: 'add', name, pin })
      if (!d.ok) { setErr(d.error || 'Could not save.'); setBusy(false); return }
      setMsg(`Saved ${name}.`); setName(''); setPin(''); onChanged && onChanged()
      await loadList()
    } catch { setErr('Network error.'); setBusy(false) }
  }
  const remove = async (n) => {
    setBusy(true); setErr(''); setMsg('')
    try {
      const d = await call({ action: 'remove', name: n })
      if (!d.ok) { setErr(d.error || 'Could not remove.'); setBusy(false); return }
      await loadList()
    } catch { setErr('Network error.'); setBusy(false) }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-left">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-brand-navy">Who can access this page</h3>
        {onClose && <button type="button" onClick={onClose} className="text-xs font-semibold text-slate-400 hover:text-slate-600">✕</button>}
      </div>

      {!loaded ? (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-[11px] text-slate-500">Enter the manager PIN to manage the access list.</p>
          <div className="flex items-center gap-2">
            <input type="password" inputMode="numeric" value={master} onChange={(e) => setMaster(e.target.value)}
              placeholder="Manager PIN" className="w-40 rounded-md border border-slate-300 px-2 py-1 text-sm" />
            <button type="button" onClick={loadList} disabled={busy || !master}
              className="rounded-md bg-brand-navy px-3 py-1 text-xs font-bold text-white disabled:opacity-60">
              {busy ? '…' : 'Continue'}
            </button>
          </div>
          {err && <span className="text-xs font-semibold text-red-600">{err}</span>}
        </div>
      ) : (
        <div className="mt-2">
          {users.length > 0 ? (
            <ul className="mb-3 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
              {users.map((u) => (
                <li key={u.name} className="flex items-center justify-between px-3 py-1.5 text-sm">
                  <span><span className="font-semibold text-slate-700">{u.name}</span> <span className="ml-2 text-[11px] tabular-nums text-slate-400">PIN {u.pin}</span></span>
                  <button type="button" onClick={() => remove(u.name)} disabled={busy} className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50">Remove</button>
                </li>
              ))}
            </ul>
          ) : <p className="mb-3 text-[11px] text-slate-500">No one added yet.</p>}

          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col">
              <label className="text-[10px] font-semibold uppercase text-slate-400">Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam"
                className="w-36 rounded-md border border-slate-300 px-2 py-1 text-sm" />
            </div>
            <div className="flex flex-col">
              <label className="text-[10px] font-semibold uppercase text-slate-400">Their PIN</label>
              <input type="text" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="unique PIN"
                className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm tabular-nums" />
            </div>
            <button type="button" onClick={add} disabled={busy || !name || !pin}
              className="rounded-md bg-brand-navy px-3 py-1 text-xs font-bold text-white disabled:opacity-60">
              {busy ? 'Saving…' : 'Add / update'}
            </button>
            {msg && <span className="text-xs font-semibold text-emerald-600">{msg}</span>}
            {err && <span className="text-xs font-semibold text-red-600">{err}</span>}
          </div>
          <p className="mt-2 text-[11px] text-slate-400">Each person needs their own unique PIN. Remove someone and their PIN stops working immediately.</p>
        </div>
      )}
    </div>
  )
}
