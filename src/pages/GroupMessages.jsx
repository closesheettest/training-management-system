import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { formatDateRange, parseLocalDate } from '../lib/dates.js'
import { useRegions } from '../lib/RegionsContext.jsx'

// Group Messages — admin's broadcast composer.
//
// Use case: every active rep in the field lives in trainees with
// is_active_sales_rep = true (auto-flipped on test submission, plus the
// bulk-imported initial cohort). Sometimes admin wants to text ALL of
// them (e.g. "tomorrow's company meeting at 9am") and sometimes just
// the people in a specific training class (e.g. day-of reminder for
// this week's cohort).
//
// The most common opener is "we just imported you — please fill in your
// personal email + home address". That's pre-seeded as the
// `update_info_request_sms` / `update_info_request_email` templates so
// admin picks it from a dropdown and clicks Send — no typing required.
//
// Flow:
//   1. Pick recipients: a single class OR every active sales rep.
//   2. Pick channels: SMS, Email, or both.
//   3. Pick a saved template (optional) — pre-fills the body/subject.
//      Or write custom text. {firstName} and {link} are substituted per
//      recipient at send time. The "Insert" buttons drop them in at the
//      cursor.
//   4. Live preview of the first matched recipient's substituted message.
//   5. Send → calls the function, surfaces per-channel sent/failed counts.

export default function GroupMessages() {
  const { regionNames } = useRegions()
  // Recipient picker
  const [scope, setScope] = useState('all_active_reps') // 'class' | 'all_active_reps'
  const [classes, setClasses] = useState([])
  const [selectedClassId, setSelectedClassId] = useState('')
  // Optional region filter — only applies when scope === 'all_active_reps'.
  // '' = no filter (all regions). Future: a regional manager persona could
  // default this to their own region.
  const [regionFilter, setRegionFilter] = useState('')

  // Channels
  const [wantSms, setWantSms] = useState(true)
  const [wantEmail, setWantEmail] = useState(false)

  // Templates
  const [templates, setTemplates] = useState([])
  const [smsTemplateKey, setSmsTemplateKey] = useState('')
  const [emailTemplateKey, setEmailTemplateKey] = useState('')

  // Bodies (editable)
  const [smsBody, setSmsBody] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')

  // Recipient preview
  const [recipients, setRecipients] = useState([])
  const [loadingRecipients, setLoadingRecipients] = useState(false)

  // Send state
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  // Live progress while batches are in flight: { processed, total } so the
  // user sees "Sending 23 of 83..." instead of a frozen "Sending..." button.
  const [progress, setProgress] = useState(null)
  // When admin clicks "Email these N instead" after an SMS broadcast,
  // we stash the targeted trainee_ids + a draft subject/body here so the
  // compose modal can open with those defaults. null = modal closed.
  const [emailFallback, setEmailFallback] = useState(null)
  const [emailFallbackSending, setEmailFallbackSending] = useState(false)
  const [emailFallbackResult, setEmailFallbackResult] = useState(null)

  useEffect(() => {
    loadClasses()
    loadTemplates()
  }, [])

  useEffect(() => {
    loadRecipients()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, selectedClassId, regionFilter])

  async function loadClasses() {
    const { data } = await supabase
      .from('classes')
      .select('id, region, week_start_date, week_end_date, attendance_only, locations(name)')
      .order('week_start_date', { ascending: false })
    setClasses(data || [])
  }

  async function loadTemplates() {
    const { data } = await supabase
      .from('message_templates')
      .select('key, label, body, subject, placeholders')
      .order('label', { ascending: true })
    setTemplates(data || [])
  }

  async function loadRecipients() {
    setLoadingRecipients(true)
    let q = supabase
      .from('trainees')
      .select('id, first_name, last_name, phone, email, company_email, registration_token, enrolled, declined_at, is_active_sales_rep, region')
      .order('last_name', { ascending: true })
    if (scope === 'class') {
      if (!selectedClassId) {
        setRecipients([])
        setLoadingRecipients(false)
        return
      }
      // Class scope: every cohort member except explicit declines/unenrolls.
      q = q.eq('class_id', selectedClassId).neq('enrolled', false).is('declined_at', null)
    } else {
      // All active reps: the durable "in the field" filter, optionally
      // sliced to one region.
      q = q.eq('is_active_sales_rep', true)
      if (regionFilter) q = q.eq('region', regionFilter)
    }
    const { data } = await q
    setRecipients(data || [])
    setLoadingRecipients(false)
  }

  // Filter templates by channel — SMS templates have no subject, email
  // templates do. That makes the dropdowns naturally scoped.
  const smsTemplates = useMemo(
    () => templates.filter((t) => !t.subject),
    [templates],
  )
  const emailTemplates = useMemo(
    () => templates.filter((t) => !!t.subject),
    [templates],
  )

  function applyTemplate(key, channel) {
    const t = templates.find((x) => x.key === key)
    if (!t) return
    if (channel === 'sms') {
      setSmsBody(t.body || '')
    } else {
      setEmailSubject(t.subject || '')
      setEmailBody(t.body || '')
    }
  }

  function onPickSmsTemplate(key) {
    setSmsTemplateKey(key)
    if (key) applyTemplate(key, 'sms')
  }
  function onPickEmailTemplate(key) {
    setEmailTemplateKey(key)
    if (key) applyTemplate(key, 'email')
  }

  // Insert a placeholder at the cursor in a textarea (or append if no ref).
  function insertAtCursor(setterName, value) {
    const id = `field-${setterName}`
    const el = document.getElementById(id)
    if (!el) return
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    const before = el.value.slice(0, start)
    const after = el.value.slice(end)
    const next = before + value + after
    if (setterName === 'sms_body') setSmsBody(next)
    else if (setterName === 'email_subject') setEmailSubject(next)
    else if (setterName === 'email_body') setEmailBody(next)
    // Restore cursor right after the inserted token on next tick.
    setTimeout(() => {
      const pos = start + value.length
      el.focus()
      el.setSelectionRange(pos, pos)
    }, 0)
  }

  // Live preview using the first recipient (or fake data if none).
  const preview = useMemo(() => {
    const r = recipients[0]
    const siteUrl = window.location.origin
    const vars = {
      firstName: r?.first_name || 'Sample',
      link: r?.registration_token
        ? `${siteUrl}/update-info/${r.registration_token}`
        : `${siteUrl}/update-info/demo`,
    }
    return {
      sms: applyPlaceholders(smsBody, vars),
      subject: applyPlaceholders(emailSubject, vars),
      body: applyPlaceholders(emailBody, vars),
    }
  }, [recipients, smsBody, emailSubject, emailBody])

  // Per-channel reachable counts. Email recipients have EITHER a
  // company email (preferred for graduates) OR a personal email (the
  // bulk-import fallback). Count both so we know who'd actually receive.
  const reach = useMemo(() => {
    const sms = recipients.filter((r) => !!r.phone).length
    const email = recipients.filter((r) => !!(r.company_email || r.email)).length
    const usingCompany = recipients.filter((r) => !!r.company_email).length
    const noRegion = recipients.filter((r) => !r.region).length
    return { sms, email, usingCompany, noRegion, total: recipients.length }
  }, [recipients])

  const validationError = useMemo(() => {
    if (!wantSms && !wantEmail) return 'Pick at least one channel (SMS or email).'
    if (scope === 'class' && !selectedClassId) return 'Pick a class.'
    if (recipients.length === 0) return 'No recipients matched — nobody to send to.'
    if (wantSms && !smsBody.trim()) return 'SMS body is empty.'
    if (wantEmail && !emailBody.trim()) return 'Email body is empty.'
    if (wantEmail && !emailSubject.trim()) return 'Email subject is empty.'
    return null
  }, [wantSms, wantEmail, scope, selectedClassId, recipients.length, smsBody, emailSubject, emailBody])

  async function send() {
    setSending(true)
    setResult(null)
    setProgress({ processed: 0, total: reach.total })
    setConfirmOpen(false)

    const basePayload = {
      scope, // 'class' | 'all_active_reps'
      ...(scope === 'class' ? { class_id: selectedClassId } : {}),
      ...(scope === 'all_active_reps' && regionFilter ? { region: regionFilter } : {}),
      channels: { sms: wantSms, email: wantEmail },
      ...(wantSms ? { sms_body: smsBody } : {}),
      ...(wantEmail ? { email_subject: emailSubject, email_body: emailBody } : {}),
    }

    // Batch loop: the function processes up to BATCH_SIZE recipients per
    // call (server-side constant — currently 20) and returns next_offset.
    // We accumulate counts + failures across batches so the user sees one
    // unified "X sent / Y failed" result at the end. Progress card updates
    // after every batch so they can watch a 90-recipient blast tick up
    // instead of staring at a frozen spinner.
    let offset = 0
    let total = reach.total
    const totals = { sms_sent: 0, sms_failed: 0, email_sent: 0, email_failed: 0, recipients: 0 }
    const allFailures = []
    try {
      // Cap iterations as a safety net — in theory we always exit when
      // next_offset is null, but if the server misbehaves we don't want
      // to loop forever.
      for (let iter = 0; iter < 200; iter++) {
        const res = await fetch('/.netlify/functions/send-group-message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...basePayload, offset }),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          setResult({ kind: 'error', message: body.error || `HTTP ${res.status}`, raw: body })
          return
        }
        // Accumulate
        totals.sms_sent += body.counts?.sms_sent || 0
        totals.sms_failed += body.counts?.sms_failed || 0
        totals.email_sent += body.counts?.email_sent || 0
        totals.email_failed += body.counts?.email_failed || 0
        totals.recipients += body.counts?.recipients || 0
        if (body.failures) allFailures.push(...body.failures)
        if (typeof body.total === 'number') total = body.total
        const processed = totals.recipients
        setProgress({ processed, total })
        if (body.next_offset == null) break
        offset = body.next_offset
      }
      setResult({ kind: 'success', counts: totals, failures: allFailures })
    } catch (err) {
      setResult({ kind: 'error', message: err.message || 'Network error' })
    } finally {
      setSending(false)
      setProgress(null)
    }
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Group messages</h1>
        <p className="mt-2 text-slate-600">
          Broadcast SMS or email to <Link to="/active-reps" className="underline">every active
          sales rep</Link> or just to the cohort in one training class. Common use: ad-hoc blasts
          ("company meeting tomorrow") or asking newly-imported reps to{' '}
          <Link to="/message-templates" className="underline">fill in their personal email + home address</Link>{' '}
          via the public <code className="rounded bg-slate-100 px-1 text-xs">/update-info</code> link.
        </p>
      </header>

      {/* Step 1 — Recipients */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">1. Who gets it</h2>
        <div className="mt-3 space-y-3">
          <label className="flex items-start gap-3">
            <input
              type="radio"
              name="scope"
              checked={scope === 'all_active_reps'}
              onChange={() => setScope('all_active_reps')}
              className="mt-1"
            />
            <div className="flex-1">
              <div className="text-sm font-medium text-slate-800">All active sales reps</div>
              <p className="text-xs text-slate-500">
                Everyone on the sales team in the field — the bulk-imported initial cohort plus
                every trainee who's graduated since. Auto-managed: each trainee who submits their
                final test joins this list. Use for "company meeting tomorrow" or any company-wide
                blast.{' '}
                <Link to="/active-reps" className="underline">Manage the list →</Link>
              </p>
              {scope === 'all_active_reps' && (
                <div className="mt-2">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Filter by region (optional)
                  </label>
                  <select
                    value={regionFilter}
                    onChange={(e) => setRegionFilter(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm sm:max-w-xs"
                  >
                    <option value="">All regions (company-wide)</option>
                    {regionNames.map((r) => (
                      <option key={r} value={r}>{r} only</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-500">
                    Pick a region for a regional-manager blast — only reps who've set their
                    region to this on <code>/update-info</code> will receive it.
                  </p>
                </div>
              )}
            </div>
          </label>
          <label className="flex items-start gap-3">
            <input
              type="radio"
              name="scope"
              checked={scope === 'class'}
              onChange={() => setScope('class')}
              className="mt-1"
            />
            <div className="flex-1">
              <div className="text-sm font-medium text-slate-800">Trainees in one class</div>
              <p className="text-xs text-slate-500">
                Everyone in a specific training week or meeting (regardless of registration or
                test status) — useful for day-of cohort reminders.
              </p>
              {scope === 'class' && (
                <select
                  value={selectedClassId}
                  onChange={(e) => setSelectedClassId(e.target.value)}
                  className="mt-2 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">— Pick a class —</option>
                  {classes.map((c) => {
                    const end = parseLocalDate(c.week_end_date)
                    const past = end && end < today
                    return (
                      <option key={c.id} value={c.id}>
                        {c.region} · {formatDateRange(c.week_start_date, c.week_end_date)}
                        {c.locations?.name ? ` · ${c.locations.name}` : ''}
                        {c.attendance_only ? ' · Meeting' : ''}
                        {past ? ' (past)' : ''}
                      </option>
                    )
                  })}
                </select>
              )}
            </div>
          </label>
        </div>

        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
          {loadingRecipients ? (
            <span className="text-slate-500">Loading recipients…</span>
          ) : (
            <>
              <strong>{reach.total}</strong> recipient{reach.total === 1 ? '' : 's'} matched ·{' '}
              <span className="text-slate-600">{reach.sms} have a phone</span> ·{' '}
              <span className="text-slate-600">{reach.email} have an email</span>
              {wantEmail && reach.usingCompany > 0 && (
                <span className="text-slate-500">
                  {' '}({reach.usingCompany} via @shingleusa.com,{' '}
                  {reach.email - reach.usingCompany} via personal email)
                </span>
              )}
              {wantSms && reach.sms < reach.total && (
                <div className="mt-1 text-xs text-amber-700">
                  ⚠ {reach.total - reach.sms} recipient{reach.total - reach.sms === 1 ? '' : 's'}{' '}
                  will be skipped for SMS (no phone on file).
                </div>
              )}
              {wantEmail && reach.email < reach.total && (
                <div className="mt-1 text-xs text-amber-700">
                  ⚠ {reach.total - reach.email} recipient{reach.total - reach.email === 1 ? '' : 's'}{' '}
                  will be skipped for email (no email on file) — perfect candidates for the SMS
                  "update your info" link.
                </div>
              )}
              {scope === 'all_active_reps' && !regionFilter && reach.noRegion > 0 && (
                <div className="mt-1 text-xs text-amber-700">
                  ⚠ {reach.noRegion} rep{reach.noRegion === 1 ? '' : 's'} haven't picked a region
                  yet — they'll get this company-wide blast, but they wouldn't be included in a
                  regional-only blast until they self-serve on <code>/update-info</code>.
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* Step 2 — Channels */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">2. How to reach them</h2>
        <div className="mt-3 flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={wantSms} onChange={(e) => setWantSms(e.target.checked)} />
            📱 SMS
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={wantEmail} onChange={(e) => setWantEmail(e.target.checked)} />
            ✉️ Email
          </label>
        </div>
        {wantSms && wantEmail && (
          <p className="mt-2 text-xs text-slate-500">
            Both channels selected — each recipient gets both (if they have phone AND email).
          </p>
        )}
      </section>

      {/* Step 3a — SMS body */}
      {wantSms && (
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">
            3. SMS body{' '}
            <span className="ml-2 inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
              📱 SMS
            </span>
          </h2>
          <div className="mt-3 space-y-3">
            <label className="block text-sm">
              <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Saved template (optional)
              </span>
              <select
                value={smsTemplateKey}
                onChange={(e) => onPickSmsTemplate(e.target.value)}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">— Write from scratch —</option>
                {smsTemplates.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-slate-500">
                Edit any template's default wording on{' '}
                <Link to="/message-templates" className="underline">Message templates</Link>.
              </span>
            </label>
            <PlaceholderToolbar onInsert={(v) => insertAtCursor('sms_body', v)} />
            <textarea
              id="field-sms_body"
              rows={4}
              value={smsBody}
              onChange={(e) => setSmsBody(e.target.value)}
              placeholder="Hi {firstName}, ..."
              className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
            />
            <p className="text-xs text-slate-500">
              {smsBody.length} characters
              {smsBody.length > 320 && (
                <span className="ml-2 text-amber-700">⚠ very long — carriers will split into multiple texts</span>
              )}
            </p>
          </div>
        </section>
      )}

      {/* Step 3b — Email body */}
      {wantEmail && (
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">
            {wantSms ? '4. ' : '3. '}Email body{' '}
            <span className="ml-2 inline-block rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-800">
              ✉️ Email
            </span>
          </h2>
          <div className="mt-3 space-y-3">
            <label className="block text-sm">
              <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Saved template (optional)
              </span>
              <select
                value={emailTemplateKey}
                onChange={(e) => onPickEmailTemplate(e.target.value)}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">— Write from scratch —</option>
                {emailTemplates.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Subject
              </span>
              <input
                id="field-email_subject"
                type="text"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                placeholder="Quick update — please confirm your info"
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
              />
            </label>
            <PlaceholderToolbar onInsert={(v) => insertAtCursor('email_body', v)} />
            <textarea
              id="field-email_body"
              rows={10}
              value={emailBody}
              onChange={(e) => setEmailBody(e.target.value)}
              placeholder="Hi {firstName},&#10;&#10;..."
              className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
            />
          </div>
        </section>
      )}

      {/* Live preview */}
      {(wantSms || wantEmail) && recipients.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-slate-50 p-5">
          <h2 className="text-lg font-semibold text-slate-900">Preview</h2>
          <p className="mt-1 text-xs text-slate-500">
            Showing how it'll render for the first recipient:{' '}
            <strong>{recipients[0].first_name} {recipients[0].last_name}</strong>.
            Each recipient gets their own substituted copy.
            {wantEmail && (
              <>
                {' '}Email routes to{' '}
                <code className="rounded bg-white px-1">
                  {recipients[0].company_email || recipients[0].email || '(no email on file)'}
                </code>
                {recipients[0].company_email ? ' (company)' : recipients[0].email ? ' (personal — no company email yet)' : ''}.
              </>
            )}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {wantSms && (
              <div className="rounded-md border border-slate-200 bg-white p-3">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  📱 SMS
                </div>
                <pre className="whitespace-pre-wrap text-xs text-slate-800 font-sans leading-snug">{preview.sms || '(empty)'}</pre>
              </div>
            )}
            {wantEmail && (
              <div className="rounded-md border border-slate-200 bg-white p-3">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  ✉️ Email
                </div>
                <p className="text-xs font-semibold text-slate-800">
                  Subject: <span className="font-normal">{preview.subject || '(empty)'}</span>
                </p>
                <pre className="mt-1 whitespace-pre-wrap text-xs text-slate-800 font-sans leading-snug">{preview.body || '(empty)'}</pre>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Send */}
      <section className="rounded-lg border-2 border-brand-navy bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Send</h2>
        {validationError ? (
          <p className="mt-2 text-sm text-amber-700">⚠ {validationError}</p>
        ) : (
          <p className="mt-2 text-sm text-slate-600">
            Ready to send to <strong>{reach.total}</strong> recipient{reach.total === 1 ? '' : 's'}{' '}
            via {[wantSms && '📱 SMS', wantEmail && '✉️ Email'].filter(Boolean).join(' + ')}.
          </p>
        )}
        <button
          type="button"
          disabled={!!validationError || sending}
          onClick={() => setConfirmOpen(true)}
          className="mt-3 rounded-md bg-brand-navy px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-navy-dark disabled:opacity-50"
        >
          {sending ? 'Sending…' : 'Send broadcast'}
        </button>

        {sending && progress && (
          <div className="mt-3 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
            <div className="flex items-center justify-between">
              <span>
                Sending in batches to stay under GHL's rate limit —{' '}
                <strong>{progress.processed}</strong> of <strong>{progress.total}</strong>{' '}
                processed.
              </span>
              <span className="text-xs text-sky-700">
                {Math.round((progress.processed / Math.max(1, progress.total)) * 100)}%
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-sky-200">
              <div
                className="h-full bg-sky-600 transition-all duration-200"
                style={{ width: `${Math.round((progress.processed / Math.max(1, progress.total)) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {result && (
          <div
            className={
              'mt-4 rounded-md border p-3 text-sm ' +
              (result.kind === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-red-200 bg-red-50 text-red-900')
            }
          >
            {result.kind === 'success' ? (
              <>
                <div className="font-semibold">Done.</div>
                <ul className="mt-1 space-y-0.5">
                  <li>📱 SMS sent: <strong>{result.counts?.sms_sent ?? 0}</strong>{result.counts?.sms_failed ? ` · ${result.counts.sms_failed} failed` : ''}</li>
                  <li>✉️ Email sent: <strong>{result.counts?.email_sent ?? 0}</strong>{result.counts?.email_failed ? ` · ${result.counts.email_failed} failed` : ''}</li>
                  <li className="text-xs text-slate-600">Recipients matched: {result.counts?.recipients ?? 0}</li>
                </ul>
                {result.failures && result.failures.length > 0 && (
                  <>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-semibold">
                        {result.failures.length} failure{result.failures.length === 1 ? '' : 's'} — click for details
                      </summary>
                      <ul className="mt-1 space-y-0.5 text-xs">
                        {result.failures.map((f, i) => (
                          <li key={i}>
                            {f.channel}: trainee {f.trainee_id} — {f.error || 'unknown'}
                          </li>
                        ))}
                      </ul>
                    </details>
                    {/* If any SMS failed (DND / unsubscribed / bad number)
                        let admin re-route to email in one click. Opens the
                        compose modal pre-filled with the SMS body. */}
                    {result.failures.some((f) => f.channel === 'sms') && (
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={() => setEmailFallback({
                            traineeIds: Array.from(new Set(
                              result.failures.filter((f) => f.channel === 'sms').map((f) => f.trainee_id),
                            )),
                            subject: 'Important update from U.S. Shingle Training',
                            body: smsBody || '',
                          })}
                          className="rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-50"
                        >
                          📧 Email these {result.failures.filter((f) => f.channel === 'sms').length} instead
                        </button>
                        <p className="mt-1 text-xs text-emerald-800">
                          DND / unsubscribed reps can't be texted. Email them the same message in
                          one click — opens a compose modal pre-filled with the SMS body so you
                          can tweak the wording for the email format.
                        </p>
                      </div>
                    )}
                  </>
                )}
              </>
            ) : (
              <>
                <div className="font-semibold">Send failed.</div>
                <p className="mt-1">{result.message}</p>
              </>
            )}
          </div>
        )}
      </section>

      {confirmOpen && (
        <ConfirmModal
          recipientCount={reach.total}
          channels={[wantSms && 'SMS', wantEmail && 'Email'].filter(Boolean)}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={send}
          sending={sending}
        />
      )}

      {emailFallback && (
        <EmailFallbackModal
          draft={emailFallback}
          setDraft={setEmailFallback}
          sending={emailFallbackSending}
          result={emailFallbackResult}
          onCancel={() => {
            if (emailFallbackSending) return
            setEmailFallback(null)
            setEmailFallbackResult(null)
          }}
          onSend={async () => {
            setEmailFallbackSending(true)
            setEmailFallbackResult(null)
            try {
              const res = await fetch('/.netlify/functions/send-group-message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  // trainee_ids overrides scope on the server, so the
                  // scope value is irrelevant — we still send a valid
                  // one to satisfy the validation branches.
                  scope: 'all_active_reps',
                  trainee_ids: emailFallback.traineeIds,
                  channels: { sms: false, email: true },
                  email_subject: emailFallback.subject,
                  email_body: emailFallback.body,
                }),
              })
              const body = await res.json().catch(() => ({}))
              if (!res.ok) {
                setEmailFallbackResult({ kind: 'error', text: body.error || `HTTP ${res.status}` })
              } else {
                setEmailFallbackResult({
                  kind: 'success',
                  sent: body.counts?.email_sent ?? 0,
                  failed: body.counts?.email_failed ?? 0,
                  failures: body.failures || [],
                })
              }
            } catch (err) {
              setEmailFallbackResult({ kind: 'error', text: err.message })
            } finally {
              setEmailFallbackSending(false)
            }
          }}
        />
      )}
    </div>
  )
}

function EmailFallbackModal({ draft, setDraft, sending, result, onCancel, onSend }) {
  const update = (key, value) => setDraft({ ...draft, [key]: value })
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-slate-900">
          📧 Email {draft.traineeIds.length} rep{draft.traineeIds.length === 1 ? '' : 's'} instead
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          Pre-filled with the SMS body you just sent. Edit the subject and tweak the wording
          for email format if you want.
        </p>
        <label className="mt-3 block">
          <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Subject
          </span>
          <input
            type="text"
            value={draft.subject}
            onChange={(e) => update('subject', e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            disabled={sending}
          />
        </label>
        <label className="mt-3 block">
          <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Email body
          </span>
          <textarea
            rows={6}
            value={draft.body}
            onChange={(e) => update('body', e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
            disabled={sending}
          />
        </label>
        {result && (
          <div
            className={
              'mt-3 rounded-md border p-2 text-xs ' +
              (result.kind === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-red-200 bg-red-50 text-red-800')
            }
          >
            {result.kind === 'success' ? (
              <>
                ✓ Email sent: <strong>{result.sent}</strong>
                {result.failed ? ` · ${result.failed} failed` : ''}
                {result.failures && result.failures.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {result.failures.map((f, i) => (
                      <li key={i}>{f.channel}: trainee {f.trainee_id} — {f.error}</li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <>✗ {result.text}</>
            )}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={sending}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {result?.kind === 'success' ? 'Close' : 'Cancel'}
          </button>
          {result?.kind !== 'success' && (
            <button
              type="button"
              onClick={onSend}
              disabled={sending || !draft.subject.trim() || !draft.body.trim()}
              className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {sending ? 'Sending…' : `Send email to ${draft.traineeIds.length}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function PlaceholderToolbar({ onInsert }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-slate-500">Insert:</span>
      <button
        type="button"
        onClick={() => onInsert('{firstName}')}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 font-mono text-[11px] hover:bg-slate-50"
      >
        {'{firstName}'}
      </button>
      <button
        type="button"
        onClick={() => onInsert('{link}')}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 font-mono text-[11px] hover:bg-slate-50"
      >
        {'{link}'}
      </button>
      <span className="text-slate-400">
        — substituted per recipient. <code>{'{link}'}</code> points to{' '}
        <code>/update-info/&lt;their token&gt;</code>.
      </span>
    </div>
  )
}

function ConfirmModal({ recipientCount, channels, onCancel, onConfirm, sending }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-slate-900">Send now?</h3>
        <p className="mt-2 text-sm text-slate-600">
          This will send {channels.join(' + ')} to <strong>{recipientCount}</strong>{' '}
          recipient{recipientCount === 1 ? '' : 's'}. Real texts and/or emails will go out
          immediately — there's no undo.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={sending}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={sending}
            className="rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy-dark disabled:opacity-50"
          >
            {sending ? 'Sending…' : `Yes, send to ${recipientCount}`}
          </button>
        </div>
      </div>
    </div>
  )
}

function applyPlaceholders(str, vars) {
  return String(str || '').replace(/\{(\w+)\}/g, (_, name) => {
    const v = vars[name]
    return v === undefined || v === null || v === '' ? `{${name}}` : String(v)
  })
}
