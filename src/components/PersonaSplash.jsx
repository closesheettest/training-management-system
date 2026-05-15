import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { usePersona } from '../lib/PersonaContext.jsx'
import { roleLabel } from '../lib/personas.js'

// Splash screen — "Who are you?". First thing a user sees if they don't
// have a persona stored in localStorage. Pulls names from
// notification_recipients (active only) so HR can manage the list of
// people the same way they manage notification subscribers.

export default function PersonaSplash() {
  const { pickPersona } = usePersona()
  const [recipients, setRecipients] = useState(null)
  const [picked, setPicked] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    const { data, error: err } = await supabase
      .from('notification_recipients')
      .select('id, name, role, email, phone')
      .eq('active', true)
      .order('role', { ascending: true })
      .order('name', { ascending: true })
    if (err) {
      setError(err.message)
      setRecipients([])
      return
    }
    setRecipients(data || [])
  }

  async function go() {
    if (!picked) return
    setWorking(true)
    await pickPersona(picked)
    setWorking(false)
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="h-1 bg-red-600" />
      <div className="mx-auto flex max-w-md flex-col items-center px-6 py-16">
        <div className="text-center">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            U.S. Shingle &amp; Metal
          </div>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Training Management</h1>
          <p className="mt-4 text-slate-600">Welcome. Who are you?</p>
          <p className="mt-1 text-xs text-slate-500">
            Pick your name so we can show you just the pages that apply to your role. You can
            switch later anytime.
          </p>
        </div>

        {error && (
          <div className="mt-6 w-full rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {recipients === null ? (
          <p className="mt-8 text-sm text-slate-500">Loading…</p>
        ) : recipients.length === 0 ? (
          <div className="mt-8 w-full rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">No team members in the system yet.</p>
            <p className="mt-1">
              Add people on the Notifications page first. (Admin → /notifications)
            </p>
            <Link
              to="/notifications"
              className="mt-3 inline-block rounded-md bg-amber-700 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-800"
            >
              Go to Notifications →
            </Link>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              go()
            }}
            className="mt-8 w-full space-y-4"
          >
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Your name</span>
              <select
                value={picked}
                onChange={(e) => setPicked(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
                required
              >
                <option value="">— Pick your name —</option>
                {recipients.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · {roleLabel(r.role)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={!picked || working}
              className="w-full rounded-md bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-900 disabled:opacity-50"
            >
              {working ? 'Loading…' : 'Continue →'}
            </button>
          </form>
        )}

        <p className="mt-8 max-w-sm text-center text-xs text-slate-400">
          This is just personalization, not a login. The system doesn't track who's doing
          what — anyone here can still see anything by typing the URL.
        </p>
      </div>
    </div>
  )
}
