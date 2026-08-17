// Every slide's points, on one page, editable in place.
//
// The points live on each slide in Ongoing Training, but editing them there
// means opening one slide's full form at a time — fine for a correction, painful
// for authoring twenty slides in a sitting. This is the bulk view: every slide,
// its points, type and save.
//
// The points are what a trainee sees as the checklist on /homework/slides, and
// what the daily sign-in test will draw from — so getting all twenty to a clean
// three is the job this page exists for.
//
// Stored in `training_days.on_slide` as a " · "-separated line, the shape that
// column already used, so no migration and nothing already authored is lost.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'

const TARGET = 3

export function splitPoints(raw) {
  const s = String(raw || '').trim().replace(/\.$/, '')
  if (!s) return []
  let parts = s.split(/·|;/).map((x) => x.trim()).filter(Boolean)
  // Older rows wrote them as a comma list after an em dash.
  if (parts.length === 1 && s.includes('—')) {
    const commas = s.split('—').slice(1).join('—').split(',').map((x) => x.trim()).filter(Boolean)
    if (commas.length > 1) parts = commas
  }
  return parts
}
export function joinPoints(list) {
  return (list || []).map((x) => String(x || '').trim()).filter(Boolean).join(' · ')
}

export default function SlidePoints() {
  const [rows, setRows] = useState(null)
  const [draft, setDraft] = useState({})     // id → string[]
  const [saving, setSaving] = useState(null)
  const [saved, setSaved] = useState({})     // id → true, briefly
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    const { data, error } = await supabase
      .from('training_days')
      .select('id, position, title, subject, on_slide, status')
      .order('position', { ascending: true })
    if (error) return setErr(error.message)
    setRows(data || [])
    const d = {}
    for (const r of data || []) d[r.id] = splitPoints(r.on_slide)
    setDraft(d)
  }

  const set = (id, i, v) => setDraft((s) => { const n = [...(s[id] || [])]; n[i] = v; return { ...s, [id]: n } })
  const add = (id) => setDraft((s) => ({ ...s, [id]: [...(s[id] || []), ''] }))
  const del = (id, i) => setDraft((s) => ({ ...s, [id]: (s[id] || []).filter((_, k) => k !== i) }))

  async function save(r) {
    setSaving(r.id); setErr('')
    const { error } = await supabase
      .from('training_days')
      .update({ on_slide: joinPoints(draft[r.id]) || null })
      .eq('id', r.id)
    setSaving(null)
    if (error) return setErr(error.message)
    setSaved((s) => ({ ...s, [r.id]: true }))
    setTimeout(() => setSaved((s) => ({ ...s, [r.id]: false })), 2000)
  }

  if (err) return <Wrap><p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{err}</p></Wrap>
  if (!rows) return <Wrap><p className="py-10 text-center text-sm text-slate-500">Loading…</p></Wrap>

  const done = rows.filter((r) => (draft[r.id] || []).filter(Boolean).length === TARGET).length

  return (
    <Wrap>
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight text-brand-navy">Slide points</h1>
        <p className="mt-1 text-sm text-slate-600">
          The points a rep has to make on each slide. These show as the checklist on the trainee&rsquo;s
          homework, and they&rsquo;re what the daily sign-in test will ask for.
        </p>
        <p className="mt-2 text-[13px] font-semibold text-slate-500">
          <span className={done === rows.length ? 'text-emerald-700' : 'text-amber-700'}>{done} of {rows.length}</span> slides
          have a clean {TARGET}. · <Link to="/homework/slides" className="text-brand-navy underline">see what the trainee sees</Link>
        </p>
      </div>

      <div className="space-y-3">
        {rows.map((r) => {
          const pts = draft[r.id] || []
          const filled = pts.filter(Boolean).length
          const ok = filled === TARGET
          return (
            <div key={r.id} className={'rounded-xl border bg-white p-4 ' + (ok ? 'border-emerald-200' : 'border-slate-200')}>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[12px] font-bold text-slate-600">{r.position}</span>
                <span className="text-[15px] font-bold text-slate-900">{r.title}</span>
                {r.subject && <span className="text-[11.5px] font-semibold text-slate-400">{r.subject}</span>}
                {r.status !== 'active' && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-bold uppercase text-slate-500">{r.status}</span>}
                <span className={'ml-auto text-[11.5px] font-bold ' + (ok ? 'text-emerald-700' : 'text-amber-700')}>
                  {filled} of {TARGET}
                </span>
              </div>

              <div className="space-y-2">
                {pts.map((pt, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-navy text-[11px] font-bold text-white">{i + 1}</span>
                    <input
                      type="text" value={pt}
                      onChange={(e) => set(r.id, i, e.target.value)}
                      placeholder={`Point ${i + 1} — e.g. "15 years in business — experience matters"`}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                    <button type="button" onClick={() => del(r.id, i)} title="Remove"
                      className="shrink-0 rounded-md border border-slate-300 px-2 py-1.5 text-xs font-bold text-slate-500 hover:border-red-300 hover:text-red-600">✕</button>
                  </div>
                ))}
                <div className="flex items-center gap-2 pt-1">
                  <button type="button" onClick={() => add(r.id)}
                    className="rounded-md border border-dashed border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-brand-navy">
                    + Add a point
                  </button>
                  <button type="button" onClick={() => save(r)} disabled={saving === r.id}
                    className="rounded-md bg-brand-navy px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50">
                    {saving === r.id ? 'Saving…' : 'Save'}
                  </button>
                  {saved[r.id] && <span className="text-[12px] font-bold text-emerald-700">✓ Saved</span>}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </Wrap>
  )
}

function Wrap({ children }) {
  return <div className="mx-auto w-full max-w-3xl">{children}</div>
}
