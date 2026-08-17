// Slide-by-slide homework — the in-home presentation, one slide per row, tap to
// get the script.
//
// Replaces the long scrolling Day-2 homework page, which had two problems: you
// had to hunt for the slide you wanted, and it went from Slide 1 straight to
// Slide 6 — Licensed, Fully Insured, You Already Need It and Experience Matters
// were missing entirely (Neal caught it, 2026-08-17). Reading the slides from
// `training_days` fixes that at the root: it's the same manual-sourced content
// the slide-a-day curriculum uses, so there's ONE place the script lives and the
// homework can't drift from it again.
//
// Trainee-facing, so the manager-only fields (`coach`, `drill`) are deliberately
// not rendered — a rep gets the point and the words, not the notes for the person
// running the drill.
//
//   /homework/slides            → every active slide
//   /homework/slides?to=16      → slides 1-16 (Day 2's scope: "memorize 1-16")
//   /homework/slides?from=6&to=16

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'

export default function HomeworkSlides() {
  const [params] = useSearchParams()
  const from = Number(params.get('from') || 1)
  const to = Number(params.get('to') || 999)
  const [days, setDays] = useState(null)
  const [err, setErr] = useState('')
  const [openId, setOpenId] = useState(null)

  useEffect(() => {
    supabase
      .from('training_days')
      .select('id, position, title, subject, on_slide, theme, point, script')
      .eq('status', 'active')
      .order('position', { ascending: true })
      .then(({ data, error }) => (error ? setErr(error.message) : setDays(data || [])))
  }, [])

  const rows = useMemo(
    () => (days || []).filter((d) => d.position >= from && d.position <= to),
    [days, from, to],
  )

  if (err) return <Shell><p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{err}</p></Shell>
  if (!days) return <Shell><p className="py-10 text-center text-sm text-slate-500">Loading…</p></Shell>
  if (!rows.length) return <Shell><p className="py-10 text-center text-sm text-slate-500">No slides are active yet.</p></Shell>

  return (
    <Shell>
      <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Tonight&rsquo;s homework</p>
      <h1 className="text-2xl font-bold tracking-tight text-brand-navy sm:text-3xl">The in-home presentation</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-slate-600">
        {rows.length} slides. <strong>Tap any one to read the script.</strong> Say it out loud until you can run it
        without looking — that&rsquo;s the whole job tonight.
      </p>

      <div className="mt-5 space-y-2">
        {rows.map((d) => {
          const isOpen = openId === d.id
          const say = Array.isArray(d.script) ? d.script : []
          return (
            <div key={d.id} className={'overflow-hidden rounded-xl border bg-white ' + (isOpen ? 'border-brand-navy shadow-sm' : 'border-slate-200')}>
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? null : d.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[13px] font-bold text-slate-600">
                  {d.position}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-bold leading-tight text-slate-900">{d.title}</span>
                  {d.on_slide && <span className="mt-0.5 block truncate text-[12px] text-slate-500">{d.on_slide}</span>}
                </span>
                {d.subject && <span className="shrink-0 text-[11.5px] font-semibold text-slate-400">{d.subject}</span>}
                <span className="shrink-0 text-slate-400">{isOpen ? '▾' : '▸'}</span>
              </button>

              {isOpen && (
                <div className="border-t border-slate-100 px-4 pb-4 pt-3">
                  {d.point && (
                    <div className="mb-3">
                      <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">The point</p>
                      <p className="text-[14px] leading-relaxed text-slate-700">{d.point}</p>
                    </div>
                  )}
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">The script</p>
                  <div className="rounded-r-xl border-l-4 border-brand-navy bg-slate-50 p-4">
                    {say.length ? say.map((seg, k) =>
                      // Anything not tagged "say" is a stage direction — how to
                      // deliver it, what they'll answer — so it reads differently
                      // from the words the rep actually speaks.
                      seg && seg.k === 'say'
                        ? <p key={k} className="mb-2 text-[15px] leading-relaxed text-slate-800">{seg.t}</p>
                        : <p key={k} className="mb-2 border-l-2 border-slate-300 pl-3 text-[13.5px] italic text-slate-500">{seg && seg.t}</p>,
                    ) : <p className="text-[13.5px] italic text-slate-500">No script recorded for this slide yet.</p>}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <p className="mt-6 text-center text-[12.5px] text-slate-400">
        Straight from the sales manual. If a slide reads wrong, tell your trainer — don&rsquo;t improvise it.
      </p>
    </Shell>
  )
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto w-full max-w-2xl">{children}</div>
    </div>
  )
}
