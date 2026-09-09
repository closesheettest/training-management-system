// /comp-agreement/:token — the Draw Program + Inspection Compensation Plan.
//
// ONE form, TWO documents, a SEPARATE signature on each (Neal, 2026-09-09).
// The Draw Program is money we advance and they repay; the Compensation Plan is
// how they get paid. A single signature under a combined page would leave it
// arguable which one they agreed to, so each closes with its own name +
// signature and the form refuses to submit until both are done.
//
// The text is served by comp-agreement-api from _comp-agreements.js — the same
// source the PDF renders from, so what they read here and what they sign cannot
// drift apart.
//
// The token is the rep's existing registration_token, the one Group messages
// already substitutes into {link}, so a company-wide send needs no new links.
import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import { useParams } from 'react-router-dom'

const API = '/.netlify/functions/comp-agreement-api'
const input = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-base'

export default function CompAgreement() {
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(null)
  const [names, setNames] = useState({ draw: '', comp: '' })
  const [agreed, setAgreed] = useState(false)
  const pads = { draw: useRef(null), comp: useRef(null) }

  useEffect(() => { document.title = 'Pay Agreements — U.S. Shingle & Metal' }, [])
  useEffect(() => {
    fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'load', token }) })
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) { setErr(j.error); return }
        setData(j)
        if (j.signed_at) setDone(j.signed_at)
        // Pre-fill both printed names with the name we already have. They can
        // change it — the name they sign under is theirs to state.
        setNames({ draw: j.rep_name || '', comp: j.rep_name || '' })
      })
      .catch(() => setErr('Could not load the agreements. Check your connection and try again.'))
  }, [token])

  async function submit() {
    setErr('')
    const drawSig = pads.draw.current?.dataUrl()
    const compSig = pads.comp.current?.dataUrl()
    // Named per document so a rep who missed one knows WHICH one.
    if (!names.draw.trim()) return setErr('Please print your name under the Draw Program.')
    if (!drawSig) return setErr('Please sign the Draw Program.')
    if (!names.comp.trim()) return setErr('Please print your name under the Inspection Compensation Plan.')
    if (!compSig) return setErr('Please sign the Inspection Compensation Plan.')
    if (!agreed) return setErr('Please tick the box confirming you have read both documents.')
    setSaving(true)
    try {
      const r = await fetch(API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'submit', token,
          draw_sign_name: names.draw.trim(), draw_signature: drawSig,
          comp_sign_name: names.comp.trim(), comp_signature: compSig,
        }),
      })
      const j = await r.json()
      if (!j.ok) { setErr(j.error || 'Could not submit.'); setSaving(false); return }
      setDone(j.signed_at)
    } catch { setErr('Could not submit — check your connection and try again.') }
    setSaving(false)
  }

  if (err && !data) return <Shell><p className="text-red-600">{err}</p></Shell>
  if (!data) return <Shell><p className="text-slate-500">Loading…</p></Shell>

  if (done) return (
    <Shell>
      <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-5">
        <h2 className="text-lg font-bold text-emerald-900">✅ Signed — thank you</h2>
        <p className="mt-1 text-sm text-emerald-800">
          Both documents were signed on {new Date(done).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET.
          The office has your copy on file. You can close this page.
        </p>
      </div>
    </Shell>
  )

  return (
    <Shell>
      <h1 className="text-2xl font-bold text-slate-900">Pay Agreements</h1>
      <p className="mt-1 text-sm text-slate-600">
        Two documents, {data.rep_name ? <><b>{data.rep_name}</b> — </> : null}
        please read each one and sign it. <b>Both signatures are required.</b>
      </p>

      {data.documents.map((doc) => (
        <section key={doc.key} className="mt-6 rounded-lg border border-slate-300 bg-white p-5">
          {doc.blocks.map((b, i) => (
            b.h ? <h2 key={i} className="mb-3 text-center text-xl font-bold text-slate-900">{b.h}</h2>
            : b.h2 ? <h3 key={i} className="mt-4 mb-1 text-base font-bold text-slate-900">{b.h2}</h3>
            : b.li ? <li key={i} className="ml-5 list-disc text-[15px] leading-relaxed text-slate-800">{b.li}</li>
            : <p key={i} className="mb-2 text-[15px] leading-relaxed text-slate-800">{b.p}</p>
          ))}

          <div className="mt-5 border-t border-slate-200 pt-4">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Sign for the {doc.title}
            </p>
            <label className="mt-2 block text-sm font-medium text-slate-700">
              Printed name *
              <input className={input} value={names[doc.key]}
                onChange={(e) => setNames((n) => ({ ...n, [doc.key]: e.target.value }))} />
            </label>
            <p className="mt-3 text-sm font-medium text-slate-700">Signature *</p>
            <SignaturePad ref={pads[doc.key]} />
          </div>
        </section>
      ))}

      <label className="mt-6 flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" className="mt-1" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>I have read and agree to both the Draw Program and the Inspection Compensation Plan.</span>
      </label>

      {err && <p className="mt-3 rounded-md bg-red-50 p-3 text-sm font-medium text-red-700">{err}</p>}

      <button onClick={submit} disabled={saving}
        className="mt-4 w-full rounded-md bg-slate-900 px-4 py-3 text-base font-bold text-white disabled:opacity-50">
        {saving ? 'Submitting…' : 'Sign both and submit'}
      </button>
      <p className="mt-2 text-xs text-slate-500">
        Your typed name, signature, the time and your IP address form your electronic signature.
      </p>
    </Shell>
  )
}

function Shell({ children }) {
  return <div className="mx-auto max-w-3xl px-4 py-8">{children}</div>
}

// Finger/mouse signature. Kept as a PNG data URL so the PDF can be re-rendered
// later if a document is ever lost. Same component as the IC agreement's.
const SignaturePad = forwardRef(function SignaturePad(_props, ref) {
  const cvs = useRef(null)
  const drawing = useRef(false)
  const dirty = useRef(false)

  useImperativeHandle(ref, () => ({
    dataUrl: () => (dirty.current ? cvs.current.toDataURL('image/png') : null),
  }))

  useEffect(() => {
    const c = cvs.current
    const ctx = c.getContext('2d')
    const scale = window.devicePixelRatio || 1
    c.width = c.offsetWidth * scale
    c.height = c.offsetHeight * scale
    ctx.scale(scale, scale)
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#0f172a'
  }, [])

  const pos = (e) => {
    const r = cvs.current.getBoundingClientRect()
    const p = e.touches ? e.touches[0] : e
    return { x: p.clientX - r.left, y: p.clientY - r.top }
  }
  const start = (e) => { e.preventDefault(); drawing.current = true; dirty.current = true; const ctx = cvs.current.getContext('2d'); const { x, y } = pos(e); ctx.beginPath(); ctx.moveTo(x, y) }
  const move = (e) => { if (!drawing.current) return; e.preventDefault(); const ctx = cvs.current.getContext('2d'); const { x, y } = pos(e); ctx.lineTo(x, y); ctx.stroke() }
  const end = () => { drawing.current = false }
  const clear = () => { const c = cvs.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); dirty.current = false }

  return (
    <div>
      <canvas
        ref={cvs}
        className="h-32 w-full touch-none rounded-md border-2 border-dashed border-slate-400 bg-white"
        onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end}
      />
      <button type="button" onClick={clear} className="mt-1 text-xs text-slate-500 underline">Clear signature</button>
    </div>
  )
})
