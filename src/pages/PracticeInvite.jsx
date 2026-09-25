// /practice/:token — Sales Training Customer from a PRACTICE LINK. A trainer set
// the session up on /sales-practice and texted + emailed this link (the owner, a
// rep on Zoom). No PIN: the token opens this one session only, for 48 hours and
// until it is done; after that it shows the person their own report card.
// Everything else is the trainer page's LiveSession and Report.
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { LiveSession, Report } from './SalesPractice.jsx'
import { personaByKey, sectionByKey } from '../lib/salesPractice.js'

const call = (token, payload) => fetch('/.netlify/functions/practice-invite', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token, ...payload }),
}).then((r) => r.json()).catch(() => ({ ok: false, error: 'Network error. Check the connection and try again.' }))

export default function PracticeInvite() {
  const { token } = useParams()
  const [inv, setInv] = useState(null)
  const [err, setErr] = useState('')
  const [stage, setStage] = useState('intro') // intro | live | report

  useEffect(() => { document.title = 'Sales practice — U.S. Shingle & Metal' }, [])
  useEffect(() => {
    call(token, { action: 'load' }).then((d) => {
      if (!d.ok) { setErr(d.error || 'This practice link is not valid.'); return }
      setInv(d)
      if (d.status === 'done') setStage('report')
    })
  }, [token])

  const wrap = (children) => <div className="min-h-screen bg-slate-50 px-4 py-6">{children}</div>
  if (err) return wrap(<div className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-6 text-center text-slate-700">{err}</div>)
  if (!inv) return wrap(<div className="p-6 text-center text-slate-500">Loading…</div>)

  const persona = personaByKey(inv.persona_key)
  const section = sectionByKey(inv.section)

  if (stage === 'report') {
    return wrap(<Report id={token} load={(t) => call(t, { action: 'get' })} canRegrade={false} />)
  }
  if (stage === 'live') {
    return wrap(
      <LiveSession
        persona={persona} section={section} trainee={{ id: null, name: inv.name, class_id: null }}
        fetchToken={async () => {
          const d = await call(token, { action: 'live' })
          if (!d.ok) throw new Error(d.error || 'Could not start the practice.')
          return d
        }}
        saveSession={(session) => call(token, { action: 'save', session })}
        onDone={(saved) => setStage(saved === null ? 'intro' : 'report')}
      />,
    )
  }
  if (inv.status === 'expired') {
    return wrap(<div className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-6 text-center text-slate-700">This practice link has expired. Ask {inv.sent_by || 'your trainer'} for a new one.</div>)
  }

  const first = String(inv.name || '').split(/\s+/)[0]
  return wrap(
    <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">U.S. Shingle &amp; Metal · Sales practice</div>
      <h1 className="mt-1 text-2xl font-bold text-brand-navy">Hi {first}, you’re up.</h1>
      <p className="mt-3 text-slate-700">
        {inv.sent_by ? `${inv.sent_by} set this up for you. ` : ''}You’ll present <b>{section.label}</b> out loud to an AI homeowner,
        <b> {persona.name}</b> ({persona.tagline.toLowerCase()}). They can hear you and they talk back.
        {section.seconds ? ` It runs for ${Math.round(section.seconds / 60)} minutes, then ends on its own.` : ''} When you’re done you get a report card.
      </p>
      <p className="mt-2 text-sm text-slate-600">{persona.blurb}</p>
      <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-700">
        <li>Use <b>Chrome</b> on a laptop or tablet, somewhere quiet. <b>Headphones</b> work best.</li>
        <li>When Chrome asks to use the <b>microphone</b>, click <b>Allow</b>.</li>
        {section.door
          ? <li>You’re at their <b>front door</b>: they got our mailer but weren’t expecting you. Get a yes to the free roof inspection. When you finish, click <b>End &amp; grade</b>.</li>
          : <>
            <li>The slides are on screen: use <b>Next / Back</b> (or the arrow keys) as you present.</li>
            <li>Talk to them like you’re at their kitchen table. When you finish, click <b>End &amp; grade</b>.</li>
          </>}
      </ul>
      <button type="button" onClick={() => setStage('live')} className="mt-6 w-full rounded-lg bg-brand-red px-6 py-3 text-lg font-bold text-white shadow hover:bg-brand-red-dark">
        🏠 Start the practice
      </button>
      <p className="mt-2 text-center text-xs text-slate-400">This link is just for you and works once.</p>
    </div>,
  )
}
