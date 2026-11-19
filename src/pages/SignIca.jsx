// /sign-ica/:token — current reps re-sign the NEW Independent Contractor Agreement
// (v3, Exhibit A built in) (Neal, 2026-11-19).
//
// Same text as Day-1 onboarding (src/lib/agreementText.js), and the PDF renders
// from the same v3 copy (_ic-agreement.js), so what they read is what they sign.
// The token is the rep's registration_token. Saved by ica-resign-api.
import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import { useParams } from 'react-router-dom'
import { AGREEMENT_BLOCKS, EXHIBIT_BLOCKS, HARVESTER_EXHIBIT_BLOCKS } from '../lib/agreementText.js'

const API = '/.netlify/functions/ica-resign-api'
const input = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-base'

export default function SignIca() {
  const { token } = useParams()
  // Office preview from /signing-docs: shows the page, records nothing, cannot be signed.
  const preview = (() => { try { return new URLSearchParams(window.location.search).get('preview') === '1' } catch { return false } })()
  const [data, setData] = useState(null)
  const [f, setF] = useState({})
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(null)
  const [agreed, setAgreed] = useState(false)
  const pad = useRef(null)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))

  useEffect(() => { document.title = 'New Contractor Agreement · U.S. Shingle & Metal' }, [])
  useEffect(() => {
    fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'load', token, preview }) })
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) { setErr(j.error); return }
        setData(j); setF(j.prefill || {})
        if (j.signed_at) setDone(j.signed_at)
      })
      .catch(() => setErr('Could not load the agreement. Check your connection and try again.'))
  }, [token])

  async function submit() {
    setErr('')
    const signature = pad.current?.dataUrl()
    const need = [['agent_legal_name', 'your legal name'], ['agent_phone', 'your phone'], ['agent_email', 'your email'],
      ['agent_dob', 'your date of birth'], ['agent_address', 'your home address'], ['agent_initials', 'your initials for Exhibit A'],
      ['sign_name', 'your printed name']].filter(([k]) => !String(f[k] || '').trim()).map(([, l]) => l)
    // Social/EIN required (Jenn, 2026-11-19). On file from onboarding = may stay blank.
    const tinDigits = String(f.w9_tin || '').replace(/\D/g, '')
    if (!tinDigits && !data.tin_on_file) need.push('your Social Security Number or EIN')
    if (need.length) return setErr(`Please fill in ${need.join(', ')}.`)
    if (tinDigits && tinDigits.length !== 9) return setErr('Your Social Security Number or EIN must be 9 digits.')
    if (!agreed) return setErr('Please tick the box confirming you have read the agreement and Exhibit A.')
    if (!signature) return setErr('Please sign in the box.')
    setSaving(true)
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'submit', token, preview, ...f, signature }) })
      const j = await r.json()
      if (!j.ok) { setErr(j.error || 'Could not submit.'); setSaving(false); return }
      setDone(j.signed_at)
    } catch { setErr('Could not submit. Check your connection and try again.') }
    setSaving(false)
  }

  if (err && !data) return <Shell><p className="text-red-600">{err}</p></Shell>
  if (!data) return <Shell><p className="text-slate-500">Loading…</p></Shell>
  if (done) return (
    <Shell>
      <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-5">
        <h2 className="text-lg font-bold text-emerald-900">✅ Signed, thank you</h2>
        <p className="mt-1 text-sm text-emerald-800">
          You signed the new Independent Contractor Agreement on {new Date(done).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET.
          Once the company countersigns, we'll email you the completed copy with both signatures. You can close this page.
        </p>
      </div>
    </Shell>
  )

  return (
    <Shell>
      {data.test && !preview && <p className="mb-4 rounded-md border-2 border-violet-400 bg-violet-50 p-3 text-sm font-bold text-violet-900">🧪 TEST: you are on the office list, so this signing is marked as a test. Jenn will be told it is a test.</p>}
      {preview && <p className="mb-4 rounded-md border-2 border-amber-400 bg-amber-50 p-3 text-sm font-bold text-amber-900">Office preview: this is what the rep sees. Nothing you do here is saved or signed.</p>}
      <p className="text-sm text-slate-700">
        {data.rep_name ? <>Hi <b>{data.rep_name.split(' ')[0]}</b>. </> : null}
        This is our updated Independent Contractor Agreement. Exhibit A (your pay schedule, including the Draw Program and
        the Inspection Program) is now part of it, so it replaces the separate pay documents. Please read it, check your details, and sign.
      </p>

      <section className="mt-5 rounded-lg border border-slate-300 bg-white p-4">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Your details</h2>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <L t="Legal name *"><input className={input} value={f.agent_legal_name || ''} onChange={set('agent_legal_name')} /></L>
          <L t="Phone *"><input className={input} inputMode="tel" value={f.agent_phone || ''} onChange={set('agent_phone')} /></L>
          <L t="Email *"><input className={input} type="email" value={f.agent_email || ''} onChange={set('agent_email')} /></L>
          <L t="Date of birth *"><input className={input} type="date" value={f.agent_dob || ''} onChange={set('agent_dob')} /></L>
        </div>
        <div className="mt-3"><L t="Home address *"><input className={input} value={f.agent_address || ''} onChange={set('agent_address')} /></L></div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <L t="SSN or EIN? *">
            <select className={input} value={f.w9_tin_type || data.tin_type || 'ssn'} onChange={set('w9_tin_type')}>
              <option value="ssn">Social Security Number</option>
              <option value="ein">Employer ID Number (EIN)</option>
            </select>
          </L>
          <L t={`${(f.w9_tin_type || data.tin_type) === 'ein' ? 'EIN' : 'Social Security Number'} *${data.tin_on_file ? ` (on file, ending ${data.tin_last4}: leave blank to keep)` : ''}`}>
            <input className={input} inputMode="numeric" autoComplete="off" maxLength={11} value={f.w9_tin || ''} onChange={set('w9_tin')} placeholder={data.tin_on_file ? '•••••' + data.tin_last4 : '9 digits'} />
          </L>
        </div>
      </section>

      <section className="mt-5 rounded-lg border border-slate-300 bg-white p-4">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Independent Contractor Agreement + Exhibit A</h2>
        <div className="mt-2 max-h-[28rem] overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-800">
          {[...AGREEMENT_BLOCKS, ...(data.harvester ? HARVESTER_EXHIBIT_BLOCKS : EXHIBIT_BLOCKS)].map((b, i) =>
            b.h ? <h4 key={i} className="mb-2 mt-3 text-center text-base font-bold text-slate-900">{b.h}</h4>
            : b.h2 ? <h5 key={i} className="mb-1 mt-3 text-center text-xs font-bold uppercase tracking-wide text-slate-800">{b.h2}</h5>
            : (b.intro || b.exhibitIntro || b.exhibitSign) ? null
            : b.li ? <p key={i} className="mb-2 pl-5">{/^[a-z]\.\s/.test(b.li) ? null : <>•&nbsp;&nbsp;</>}{b.li}</p>
            : b.p ? <p key={i} className="mb-2">{b.n ? <strong>{b.n} </strong> : null}{b.p}</p> : null,
          )}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <L t="Printed name *"><input className={input} value={f.sign_name || ''} onChange={set('sign_name')} /></L>
          <L t="Title"><input className={input} placeholder="Independent Contractor" value={f.sign_title || ''} onChange={set('sign_title')} /></L>
          <L t="Your initials (for Exhibit A) *">
            <input className={input} maxLength={5} placeholder="e.g. NM" value={f.agent_initials || ''}
              onChange={(e) => setF((x) => ({ ...x, agent_initials: e.target.value.toUpperCase() }))} />
          </L>
        </div>
        <label className="mt-4 flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-1" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>I have read and agree to the Independent Contractor Agreement and Exhibit A, and the details above are correct.</span>
        </label>
        <p className="mt-4 text-sm font-medium text-slate-700">Sign here *</p>
        <SignaturePad ref={pad} />
      </section>

      {err && <p className="mt-3 rounded-md bg-red-50 p-3 text-sm font-medium text-red-700">{err}</p>}
      <button onClick={submit} disabled={saving || preview}
        className="mt-4 w-full rounded-md bg-slate-900 px-4 py-3 text-base font-bold text-white disabled:opacity-50">
        {saving ? 'Submitting…' : 'Sign and submit'}
      </button>
      <p className="mt-2 text-center text-xs text-slate-500">Your typed name, signature, the time and your IP address form your electronic signature.</p>
    </Shell>
  )
}

function L({ t, children }) {
  return <label className="block text-sm font-medium text-slate-700">{t}{children}</label>
}

function Shell({ children }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold text-slate-900">U.S. Shingle &amp; Metal: new Independent Contractor Agreement</h1>
      <div className="mt-4">{children}</div>
    </div>
  )
}

// Finger/mouse signature, kept as a PNG data URL. Same pad as the other signing pages.
const SignaturePad = forwardRef(function SignaturePad(_props, ref) {
  const cvs = useRef(null)
  const drawing = useRef(false)
  const dirty = useRef(false)
  useImperativeHandle(ref, () => ({ dataUrl: () => (dirty.current ? cvs.current.toDataURL('image/png') : null) }))
  useEffect(() => {
    const c = cvs.current, ctx = c.getContext('2d'), scale = window.devicePixelRatio || 1
    c.width = c.offsetWidth * scale; c.height = c.offsetHeight * scale
    ctx.scale(scale, scale); ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#0f172a'
  }, [])
  const pos = (e) => { const r = cvs.current.getBoundingClientRect(); const p = e.touches ? e.touches[0] : e; return { x: p.clientX - r.left, y: p.clientY - r.top } }
  const start = (e) => { e.preventDefault(); drawing.current = true; dirty.current = true; const ctx = cvs.current.getContext('2d'); const { x, y } = pos(e); ctx.beginPath(); ctx.moveTo(x, y) }
  const move = (e) => { if (!drawing.current) return; e.preventDefault(); const ctx = cvs.current.getContext('2d'); const { x, y } = pos(e); ctx.lineTo(x, y); ctx.stroke() }
  const end = () => { drawing.current = false }
  const clear = () => { const c = cvs.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); dirty.current = false }
  return (
    <div>
      <canvas ref={cvs} className="h-32 w-full touch-none rounded-md border-2 border-dashed border-slate-400 bg-white"
        onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end} />
      <button type="button" onClick={clear} className="mt-1 text-xs text-slate-500 underline">Clear signature</button>
    </div>
  )
})
