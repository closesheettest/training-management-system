import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

// /field-trainee — one-off sends for a field-trained hire (someone the
// regional manager is training in the field instead of in a class).
//
//   1. Search for / pick the person.
//   2. "Send full-week homework" → one link to /full-week-homework/ (all days).
//   3. "Send final test" → the multiple-choice-only test (no essays), sent
//      once the manager says they're ready.
//
// Reads trainees directly via the supabase client (this page is behind the
// app's persona-gated nav); the two sends hit /field-send.

export default function FieldTrainee() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState(null)
  const [busy, setBusy] = useState(null)        // 'homework' | 'test' | null
  const [flash, setFlash] = useState(null)      // { kind, text }

  // Debounced name search across trainees.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setResults([]); return }
    let cancelled = false
    setSearching(true)
    const id = setTimeout(async () => {
      const { data } = await supabase
        .from('trainees')
        .select('id, first_name, last_name, phone, email, registration_token, is_active_sales_rep, classes!class_id(region, week_start_date, cancelled_at)')
        .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`)
        .order('last_name', { ascending: true })
        .limit(25)
      if (!cancelled) { setResults(data || []); setSearching(false) }
    }, 300)
    return () => { cancelled = true; clearTimeout(id) }
  }, [query])

  async function send(what) {
    if (!selected) return
    if (what === 'test' && !confirm(`Send the FINAL TEST (no essays) to ${selected.first_name} ${selected.last_name}? Only do this once their manager says they're ready.`)) return
    setBusy(what); setFlash(null)
    try {
      const res = await fetch('/.netlify/functions/field-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trainee_id: selected.id, what }),
      })
      const o = await res.json()
      if (!o.ok) throw new Error(o.error || 'Send failed')
      const label = what === 'homework' ? 'Full-week homework' : 'Final test'
      setFlash({ kind: 'success', text: `${label} sent to ${selected.first_name} via ${(o.channels || []).join(' + ') || 'no channel'}.` })
    } catch (e) {
      setFlash({ kind: 'error', text: e.message || 'Send failed' })
    }
    setBusy(null)
  }

  const fullName = (t) => `${t.first_name || ''} ${t.last_name || ''}`.trim()

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Field Trainee</h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          One-off sends for someone being trained in the field by a regional manager (not in a class).
          Send them the whole week of homework in one link, then send the final test once their
          manager says they're ready.
        </p>
      </header>

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <label className="block text-sm font-medium text-slate-700">
          Find the person
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a first or last name…"
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            autoFocus
          />
        </label>

        {searching && <p className="mt-3 text-sm text-slate-400">Searching…</p>}

        {results.length > 0 && (
          <ul className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-200">
            {results.map((t) => {
              const cls = t.classes
              const tag = cls ? `${cls.region} · ${cls.week_start_date}${cls.cancelled_at ? ' (cancelled)' : ''}` : 'No class'
              const isSel = selected?.id === t.id
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => { setSelected(t); setFlash(null) }}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50 ${isSel ? 'bg-sky-50' : ''}`}
                  >
                    <span>
                      <span className="font-semibold text-slate-900">{fullName(t)}</span>
                      <span className="ml-2 text-slate-500">{t.phone || 'no phone'} · {t.email || 'no email'}</span>
                    </span>
                    <span className="shrink-0 text-xs text-slate-400">{tag}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {selected && (
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">{fullName(selected)}</h2>
          <p className="mt-0.5 text-sm text-slate-500">{selected.phone || 'no phone'} · {selected.email || 'no email'}</p>
          {!selected.phone && !selected.email && (
            <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              No phone or email on file — add one on their record before sending.
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => send('homework')}
              disabled={busy !== null}
              className="rounded-md bg-brand-navy px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-navy-dark disabled:opacity-50"
            >
              {busy === 'homework' ? 'Sending…' : '📚 Send full-week homework'}
            </button>
            <button
              type="button"
              onClick={() => send('test')}
              disabled={busy !== null}
              className="rounded-md bg-red-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-red-800 disabled:opacity-50"
            >
              {busy === 'test' ? 'Sending…' : '📝 Send final test (no essays)'}
            </button>
          </div>

          <p className="mt-3 text-xs text-slate-500">
            Homework links to the full-week page (all days in one). The final test is multiple-choice
            only — no essay questions — and skips the usual registration/zone gates.
          </p>

          {flash && (
            <div className={`mt-4 rounded-md border p-3 text-sm ${flash.kind === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
              {flash.text}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
