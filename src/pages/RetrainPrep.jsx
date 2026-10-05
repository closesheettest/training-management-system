// /prep/:token — a retraining rep's own page (Neal, 2026-10-05: "one link that says click on this to
// find out what you need to do. And then on that page, it lists everything"). The text they get
// is just this link. Shows the sessions with a Join button and the homework, in order: slides 1–5
// and their points, the full script, the practice test (✓ once done). Data: meet.js retrain_page.
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

const fmtDay = (iso) => new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'short', day: 'numeric' })
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).replace(':00', '')

export default function RetrainPrep() {
  const { token } = useParams()
  const [d, setD] = useState(null)
  useEffect(() => {
    fetch('/.netlify/functions/meet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'retrain_page', token }) })
      .then((r) => r.json()).then(setD).catch(() => setD({ ok: false, error: 'Network error. Try again.' }))
  }, [token])
  useEffect(() => { document.title = d?.title ? `${d.title} · Your homework` : 'Your homework' }, [d?.title])
  const wrap = (c) => <div className="min-h-screen bg-slate-100 px-4 py-6"><div className="mx-auto max-w-xl">{c}</div></div>
  if (!d) return wrap(<p className="text-center text-slate-500">Loading…</p>)
  if (!d.ok) return wrap(<p className="rounded-xl bg-white p-6 text-center text-slate-700 shadow">{d.error}</p>)
  const first = d.sessions[0]
  const due = first ? `${fmtDay(first.start)} at ${fmtTime(first.start)}` : 'the first session'
  const Step = ({ n, title, sub, href, done, cta }) => (
    <a href={href} target="_blank" rel="noreferrer" className={`flex items-center gap-4 rounded-xl border-2 bg-white p-4 no-underline shadow-sm ${done ? 'border-emerald-400' : 'border-slate-200 hover:border-brand-navy'}`}>
      <span className={`flex h-10 w-10 flex-none items-center justify-center rounded-full text-lg font-extrabold text-white ${done ? 'bg-emerald-500' : 'bg-brand-navy'}`}>{done ? '✓' : n}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-bold text-slate-900">{title}</span>
        <span className="block text-sm text-slate-600">{sub}</span>
      </span>
      <span className="flex-none rounded-md bg-brand-navy px-3 py-1.5 text-sm font-bold text-white">{cta}</span>
    </a>
  )
  return wrap(
    <>
      <div className="text-center">
        <div className="inline-block rounded-xl bg-white px-4 py-2 shadow-sm"><img src="/uss-logo.png" alt="U.S. Shingle & Metal" className="h-14" /></div>
        <h1 className="mt-4 text-2xl font-extrabold text-brand-navy">{d.first ? `${d.first}, here's` : "Here's"} what you need to do</h1>
        <p className="mt-1 text-slate-600">You're signed up for <b>{d.title}</b>{d.topic ? ` (${d.topic})` : ''}.</p>
      </div>

      <h2 className="mt-6 text-sm font-bold uppercase tracking-wider text-slate-500">📅 When</h2>
      <div className="mt-2 rounded-xl bg-white p-4 shadow-sm">
        {d.sessions.map((x) => (
          <div key={x.start} className="flex justify-between border-b border-slate-100 py-1.5 text-slate-800 last:border-0">
            <span className="font-semibold">{fmtDay(x.start)}</span><span>{fmtTime(x.start)}–{fmtTime(x.end)} <span className="text-slate-400">Eastern</span></span>
          </div>
        ))}
        <a href={d.join} target="_blank" rel="noreferrer" className="mt-3 block rounded-lg bg-emerald-600 px-4 py-3 text-center text-base font-extrabold text-white no-underline">▶ Join the training</a>
        <p className="mt-2 text-center text-xs text-slate-500">Use this same button each day. It opens 15 minutes early. Camera on, quiet room, not driving.</p>
      </div>

      <h2 className="mt-6 text-sm font-bold uppercase tracking-wider text-slate-500">📝 Homework: done before {due}</h2>
      <div className="mt-2 space-y-3">
        <Step n="1" title="Learn slides 1–5" sub="Tap each slide to read the script and the points to bring out. Say it out loud." href={d.slides} cta="Open" />
        <Step n="2" title="The full sales script" sub="The whole presentation, word for word." href={d.script} cta="Read" />
        <Step n="3" title="Practice test: slides 1–5" sub={d.practice_done ? 'Done. Nice work.' : 'Present slides 1–5 out loud to an AI homeowner. Use a laptop or tablet in Chrome, ideally with headphones.'} href={d.practice} done={d.practice_done} cta={d.practice_done ? 'See it' : 'Start'} />
      </div>
      <p className="mt-6 text-center text-xs text-slate-400">Keep this page: it's your link for the whole retraining.</p>
    </>
  )
}
