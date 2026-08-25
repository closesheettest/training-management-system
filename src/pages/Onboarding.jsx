import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AGREEMENT_BLOCKS, EXHIBIT_BLOCKS } from '../lib/agreementText.js'

// Day-1 paperwork. The rep lands here from the text + email fired when they sign
// in at the kiosk. Everything the old HomeMaxx funnel collected is here, plus the
// W-9 and the Independent Contractor Agreement they e-sign.
//
// Banking is deliberately OPTIONAL: people turn up without their bank details and
// Neal doesn't hold the class for it — they get a daily reminder until it's in.

const API = '/.netlify/functions/trainee-onboarding-api'
const SHIRTS = ['S', 'M', 'L', 'XL', '2XL', '3XL']
const label = 'block text-sm font-medium text-slate-700'
const input = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-base'

export default function Onboarding() {
  const { token } = useParams()
  const [state, setState] = useState('loading')   // loading | form | done | error
  const [err, setErr] = useState(null)
  const [f, setF] = useState({})
  const [onFile, setOnFile] = useState({})
  const [saving, setSaving] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [nextSession, setNextSession] = useState('')
  const pad = useRef(null)

  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }))

  useEffect(() => {
    ;(async () => {
      try {
        const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'load', token }) })
        const b = await r.json()
        if (!b.ok) { setErr(b.error); setState('error'); return }
        if (b.signed && b.banking_done) { setState('done'); return }
        const t = b.trainee || {}
        setOnFile(b.secrets_on_file || {})
        setNextSession(b.next_session || '')
        setF({
          first_name: t.first_name || '', last_name: t.last_name || '',
          agent_phone: t.phone || '', agent_email: t.email || '',
          agent_address: [t.street_address, t.city, t.state, t.zip].filter(Boolean).join(', '),
          // The IRS wants these on two lines: street on one, "City, ST ZIP" on
          // the other. Left to type it themselves, the first person split it
          // wrongly and filed a W-9 with no city or state — so pre-fill both
          // from the parts we already hold.
          w9_address: t.street_address || '',
          w9_city_state_zip: [t.city, t.state].filter(Boolean).join(', ') + (t.zip ? ` ${t.zip}` : ''),
          w9_tax_classification: 'individual', w9_tin_type: 'ssn',
          sign_title: 'Independent Contractor',
          ...Object.fromEntries(Object.entries(b.saved || {}).filter(([, v]) => v != null && v !== '')),
        })
        setState(b.signed ? 'banking' : 'form')   // already signed → banking only
      } catch (e) { setErr(String(e.message || e)); setState('error') }
    })()
  }, [token])

  // Autosave the draft so a dropped signal doesn't cost them the form.
  useEffect(() => {
    if (state !== 'form' && state !== 'banking') return
    const id = setTimeout(() => {
      fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', token, fields: f }) }).catch(() => {})
    }, 1500)
    return () => clearTimeout(id)
  }, [f, state, token])

  async function submit() {
    setErr(null)
    const sig = pad.current?.dataUrl()
    if (!sig) { setErr('Please sign in the box before submitting.'); return }
    if (!agreed) { setErr('Please tick the box confirming you have read the agreement.'); return }
    setSaving(true)
    const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'submit', token, fields: f, signature: sig }) })
    const b = await r.json().catch(() => ({}))
    setSaving(false)
    if (!b.ok) { setErr(b.error || 'Something went wrong — try again.'); return }
    if (b.next_session) setNextSession(b.next_session)
    setState('done')
  }

  async function saveBankingOnly() {
    setSaving(true)
    await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', token, fields: f }) })
    setSaving(false)
    setState('done')
  }

  if (state === 'loading') return <Shell><p className="text-slate-500">Loading…</p></Shell>
  if (state === 'error') return <Shell><p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-red-800">{err}</p></Shell>
  if (state === 'done') return (
    <Shell>
      <div className="rounded-lg border-2 border-emerald-300 bg-emerald-50 p-6 text-center">
        <div className="text-4xl">✅</div>
        <h2 className="mt-2 text-xl font-bold text-emerald-900">Thank you — you're all set</h2>
        {nextSession && <p className="mt-1 text-lg font-semibold text-emerald-900">{nextSession}</p>}
        <p className="mt-2 text-emerald-800">
          Your signed W-9 and Independent Contractor Agreement have been emailed to you. Keep them for your records.
        </p>
      </div>
    </Shell>
  )

  const bankingOnly = state === 'banking'

  return (
    <Shell>
      {bankingOnly ? (
        <div className="mb-6 rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          Your paperwork is signed — thank you. All that's left is your <strong>direct deposit details</strong> so you get paid on time.
        </div>
      ) : (
        <p className="mb-6 text-slate-600">
          Please complete this before class starts. It takes about five minutes.
          {' '}<strong>Don't have your bank details on you?</strong> That's fine — leave that section blank and we'll remind you later.
        </p>
      )}

      {!bankingOnly && (
        <>
          <Section title="Your information">
            <Two>
              <L t="First name *"><input className={input} value={f.first_name || ''} onChange={set('first_name')} /></L>
              <L t="Last name *"><input className={input} value={f.last_name || ''} onChange={set('last_name')} /></L>
              <L t="Preferred name"><input className={input} value={f.preferred_name || ''} onChange={set('preferred_name')} /></L>
              <L t="Shirt size">
                <select className={input} value={f.shirt_size || ''} onChange={set('shirt_size')}>
                  <option value="">—</option>
                  {SHIRTS.map((s) => <option key={s}>{s}</option>)}
                </select>
              </L>
              <L t="Phone *"><input className={input} inputMode="tel" value={f.agent_phone || ''} onChange={set('agent_phone')} /></L>
              <L t="Email *"><input className={input} type="email" value={f.agent_email || ''} onChange={set('agent_email')} /></L>
              <L t="Date of birth *"><input className={input} type="date" value={f.agent_dob || ''} onChange={set('agent_dob')} /></L>
              <L t="Home address *"><input className={input} value={f.agent_address || ''} onChange={set('agent_address')} /></L>
              <L t="Emergency contact name"><input className={input} value={f.emergency_name || ''} onChange={set('emergency_name')} /></L>
              <L t="Emergency contact number"><input className={input} inputMode="tel" value={f.emergency_phone || ''} onChange={set('emergency_phone')} /></L>
            </Two>
          </Section>

          <Section title="Business / LLC" note="Only if you're contracting through a business. Most people leave this blank.">
            <Two>
              <L t="Business name"><input className={input} value={f.business_name || ''} onChange={set('business_name')} /></L>
              <L t={`EIN${onFile.business_ein ? ' (on file — leave blank to keep)' : ''}`}>
                <input className={input} value={f.business_ein || ''} onChange={set('business_ein')} placeholder={onFile.business_ein ? '•••••••••' : ''} />
              </L>
              <L t="Business address" wide><input className={input} value={f.business_address || ''} onChange={set('business_address')} /></L>
            </Two>
          </Section>

          <Section title="W-9" note="Required by the IRS so we can issue your 1099.">
            <Two>
              <L t="Name (as shown on your tax return) *"><input className={input} value={f.w9_name || ''} onChange={set('w9_name')} /></L>
              <L t="Federal tax classification *">
                <select className={input} value={f.w9_tax_classification || 'individual'} onChange={set('w9_tax_classification')}>
                  <option value="individual">Individual / sole proprietor</option>
                  <option value="c corp">C corporation</option>
                  <option value="s corp">S corporation</option>
                  <option value="partnership">Partnership</option>
                  <option value="trust">Trust / estate</option>
                  <option value="llc">Limited liability company</option>
                </select>
              </L>
              <L t="Street address *"><input className={input} placeholder="5236 46th Street Ct E" value={f.w9_address || ''} onChange={set('w9_address')} /></L>
              <L t="City, state, ZIP *"><input className={input} placeholder="Bradenton, FL 34203" value={f.w9_city_state_zip || ''} onChange={set('w9_city_state_zip')} /></L>
              <L t="SSN or EIN? *">
                <select className={input} value={f.w9_tin_type || 'ssn'} onChange={set('w9_tin_type')}>
                  <option value="ssn">Social Security Number</option>
                  <option value="ein">Employer ID Number (EIN)</option>
                </select>
              </L>
              <L t={`${f.w9_tin_type === 'ein' ? 'EIN' : 'Social Security Number'} *${onFile.w9_tin ? ' (on file — leave blank to keep)' : ''}`}>
                <input className={input} inputMode="numeric" value={f.w9_tin || ''} onChange={set('w9_tin')} placeholder={onFile.w9_tin ? '•••••••••' : ''} />
              </L>
            </Two>
          </Section>
        </>
      )}

      <Section title="Direct deposit" note="How you get paid. If you don't have these on you right now, skip it — we'll remind you each day until it's in.">
        <Two>
          <L t="Bank name"><input className={input} value={f.bank_name || ''} onChange={set('bank_name')} /></L>
          <L t="Name on account"><input className={input} value={f.bank_account_name || ''} onChange={set('bank_account_name')} /></L>
          <L t={`Routing number${onFile.bank_routing ? ' (on file)' : ''}`}><input className={input} inputMode="numeric" value={f.bank_routing || ''} onChange={set('bank_routing')} placeholder={onFile.bank_routing ? '•••••••••' : ''} /></L>
          <L t={`Wire routing number${onFile.bank_wire_routing ? ' (on file)' : ''}`}><input className={input} inputMode="numeric" value={f.bank_wire_routing || ''} onChange={set('bank_wire_routing')} placeholder={onFile.bank_wire_routing ? '•••••••••' : ''} /></L>
          <L t={`Account number${onFile.bank_account_number ? ' (on file)' : ''}`}><input className={input} inputMode="numeric" value={f.bank_account_number || ''} onChange={set('bank_account_number')} placeholder={onFile.bank_account_number ? '•••••••••' : ''} /></L>
        </Two>
      </Section>

      {bankingOnly ? (
        <div className="mt-6">
          {err && <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{err}</p>}
          <button onClick={saveBankingOnly} disabled={saving}
            className="w-full rounded-md bg-brand-navy px-6 py-3 text-base font-semibold text-white disabled:opacity-50">
            {saving ? 'Saving…' : 'Save my bank details'}
          </button>
        </div>
      ) : (
        <>
          <Section title="Independent Contractor Agreement" note="Please read this in full — it's what you're signing.">
            <div className="max-h-80 overflow-y-auto rounded-md border border-slate-300 bg-slate-50 p-4 text-xs leading-relaxed text-slate-700">
              {[...AGREEMENT_BLOCKS, ...EXHIBIT_BLOCKS].map((b, i) =>
                b.h ? <h4 key={i} className="mb-2 mt-3 text-center text-sm font-bold text-slate-900">{b.h}</h4>
                : b.li ? <p key={i} className="mb-2 pl-5">•&nbsp;&nbsp;{b.li}</p>
                : <p key={i} className="mb-2">{b.n ? <strong>{b.n} </strong> : null}{b.p}</p>,
              )}
            </div>
            <Two>
              <L t="Printed name *"><input className={input} value={f.sign_name || ''} onChange={set('sign_name')} /></L>
              <L t="Title"><input className={input} value={f.sign_title || ''} onChange={set('sign_title')} /></L>
            </Two>
            {/* Initials for Exhibit A — the commission schedule. Optional on
                purpose: agreements signed before this existed must not become
                incomplete for want of a field nobody was asked for
                (Neal, 2026-08-25). */}
            <Two>
              <L t="Your initials (for Exhibit A)">
                <input className={input} maxLength={5} placeholder="e.g. NM"
                  value={f.agent_initials || ''}
                  onChange={(e) => set('agent_initials')({ target: { value: e.target.value.toUpperCase() } })} />
              </L>
              <div />
            </Two>
            <label className="mt-4 flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" className="mt-1" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
              <span>I have read and agree to the Independent Contractor Agreement and Exhibit A, and I confirm the information above is correct.</span>
            </label>
            <div className="mt-4">
              <div className={label}>Sign here *</div>
              <SignaturePad ref={pad} />
            </div>
          </Section>

          <div className="mt-6">
            {err && <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{err}</p>}
            <button onClick={submit} disabled={saving}
              className="w-full rounded-md bg-brand-navy px-6 py-3 text-base font-semibold text-white disabled:opacity-50">
              {saving ? 'Submitting…' : 'Sign and submit'}
            </button>
            <p className="mt-2 text-center text-xs text-slate-500">
              Your typed name, signature, the time and your IP address form your electronic signature.
            </p>
          </div>
        </>
      )}
    </Shell>
  )
}

function Shell({ children }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold text-slate-900">U.S. Shingle &amp; Metal — new rep paperwork</h1>
      <div className="mt-4">{children}</div>
    </div>
  )
}
const Section = ({ title, note, children }) => (
  <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
    <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
    {note && <p className="mt-1 text-sm text-slate-500">{note}</p>}
    <div className="mt-4">{children}</div>
  </section>
)
const Two = ({ children }) => <div className="grid gap-4 sm:grid-cols-2">{children}</div>
const L = ({ t, wide, children }) => (
  <label className={`${label} ${wide ? 'sm:col-span-2' : ''}`}>{t}{children}</label>
)

// Finger/mouse signature. Kept as a PNG data URL so the PDF can be re-rendered
// later if a document is ever lost.
import { forwardRef, useImperativeHandle } from 'react'
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
