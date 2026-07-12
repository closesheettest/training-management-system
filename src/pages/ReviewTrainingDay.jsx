import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

// Public reviewer page — DeWayne & Neal open this from the "new training
// day submitted" SMS/email. The review token in the URL is the credential;
// every action posts to training-day-review-api.js which re-checks it.
//
// Pending day  → edit, then Activate (go live) or Decline.
// Active day   → edit, then Save changes (or Archive / re-order elsewhere).

function parseScript(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (/^\(.*\)$/.test(l) ? { k: 'dir', t: l } : { k: 'say', t: l }))
}
function scriptToText(script) {
  return (Array.isArray(script) ? script : []).map((s) => s.t).join('\n')
}

async function api(action, token, extra = {}) {
  const res = await fetch('/.netlify/functions/training-day-review-api', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, token, ...extra }),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || !j.ok) throw new Error(j.error || `Request failed (${res.status})`)
  return j
}

const STATUS_BADGE = {
  active: 'bg-emerald-100 text-emerald-800',
  pending: 'bg-amber-100 text-amber-800',
  archived: 'bg-slate-200 text-slate-600',
}

export default function ReviewTrainingDay() {
  const { token } = useParams()
  const [day, setDay] = useState(null)
  const [f, setF] = useState(null)          // editable fields
  const [loadErr, setLoadErr] = useState(null)
  const [busy, setBusy] = useState('')       // '', 'save', 'activate', 'decline'
  const [flash, setFlash] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { day } = await api('load', token)
        if (cancelled) return
        setDay(day)
        setF(fieldsFrom(day))
      } catch (e) {
        if (!cancelled) setLoadErr(e.message)
      }
    })()
    return () => { cancelled = true }
  }, [token])

  function fieldsFrom(d) {
    return {
      title: d.title || '',
      subject: d.subject || '',
      on_slide: d.on_slide || '',
      point: d.point || '',
      scriptText: scriptToText(d.script),
      coach: d.coach || '',
      drill: d.drill || '',
    }
  }

  function payloadFields() {
    return {
      title: f.title.trim(),
      subject: f.subject.trim(),
      theme: f.subject.trim(),
      on_slide: f.on_slide.trim(),
      point: f.point.trim(),
      script: parseScript(f.scriptText),
      coach: f.coach.trim(),
      drill: f.drill.trim(),
    }
  }

  async function run(action) {
    if (!f.title.trim() || !f.point.trim() || !f.scriptText.trim()) {
      setFlash({ kind: 'error', text: 'Title, The point, and The script can\'t be empty.' })
      return
    }
    setBusy(action); setFlash(null)
    try {
      const extra = action === 'decline' ? {} : { fields: payloadFields() }
      const { day } = await api(action, token, extra)
      setDay(day); setF(fieldsFrom(day))
      setFlash({
        kind: 'success',
        text: action === 'activate' ? '✅ Activated — this day is now live.'
          : action === 'decline' ? 'Declined — moved to archived. You can re-activate anytime.'
          : 'Saved.',
      })
    } catch (e) {
      setFlash({ kind: 'error', text: e.message })
    }
    setBusy('')
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="h-1 w-full bg-brand-navy" />
      <div className="mx-auto max-w-3xl px-5 py-8">
        <div className="mb-6">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">U.S. Shingle &amp; Metal · Training Review</div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-brand-navy">Review a training day</h1>
        </div>

        {loadErr && (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">{loadErr}</div>
        )}

        {!loadErr && !day && <p className="text-sm text-slate-500">Loading…</p>}

        {day && f && (
          <>
            <div className="mb-4 flex items-center gap-2">
              <span className={'rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ' + (STATUS_BADGE[day.status] || 'bg-slate-100 text-slate-600')}>
                {day.status}
              </span>
              {day.submitted_by_name && day.source === 'submission' && (
                <span className="text-xs text-slate-500">Submitted by {day.submitted_by_name}</span>
              )}
            </div>

            {flash && (
              <div className={'mb-4 rounded-md border p-3 text-sm ' + (flash.kind === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-red-200 bg-red-50 text-red-800')}>
                {flash.text}
              </div>
            )}

            <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <Field label="Title">
                <input type="text" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Subject / topic">
                  <input type="text" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                </Field>
                <Field label="On the slide">
                  <input type="text" value={f.on_slide} onChange={(e) => setF({ ...f, on_slide: e.target.value })}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                </Field>
              </div>
              <Field label="The point">
                <textarea rows={2} value={f.point} onChange={(e) => setF({ ...f, point: e.target.value })}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </Field>
              <Field label="The script" hint="One line per line. Wrap a line in (parentheses) for a stage direction.">
                <textarea rows={8} value={f.scriptText} onChange={(e) => setF({ ...f, scriptText: e.target.value })}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono" />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Coach your team">
                  <textarea rows={3} value={f.coach} onChange={(e) => setF({ ...f, coach: e.target.value })}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                </Field>
                <Field label="Run the drill">
                  <textarea rows={3} value={f.drill} onChange={(e) => setF({ ...f, drill: e.target.value })}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                </Field>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              {day.status !== 'active' ? (
                <button type="button" onClick={() => run('activate')} disabled={!!busy}
                  className="rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                  {busy === 'activate' ? 'Activating…' : '✅ Save & Activate (go live)'}
                </button>
              ) : (
                <button type="button" onClick={() => run('save')} disabled={!!busy}
                  className="rounded-md bg-slate-800 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-900 disabled:opacity-50">
                  {busy === 'save' ? 'Saving…' : 'Save changes'}
                </button>
              )}

              {day.status === 'pending' && (
                <button type="button" onClick={() => run('save')} disabled={!!busy}
                  className="rounded-md border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                  {busy === 'save' ? 'Saving…' : 'Save draft (keep pending)'}
                </button>
              )}

              {day.status !== 'archived' && (
                <button type="button" onClick={() => run('decline')} disabled={!!busy}
                  className="rounded-md border border-red-300 px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">
                  {busy === 'decline' ? 'Declining…' : day.status === 'pending' ? 'Decline' : 'Archive'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}
