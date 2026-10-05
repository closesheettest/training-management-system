// /meeting-rooms — set up the company's meeting rooms (Neal, 2026-10-04: "a main admin page that
// lets the company set up separate rooms, such as regional manager rooms").
// Each room: name, type (zone team / managers / prayer / everyone / custom), schedule, today's
// topic, cameras required, hosts, and for the prayer call: open to the public (name + email
// sign-in → email list) with a host code for a leader who isn't in TMS.
// Per room: People & links (from the TMS roster), Send links (text + email), Attendance by day
// (from LiveKit's join/leave webhook), and the guest email list (CSV).
import { useEffect, useState } from 'react'

const FN = '/.netlify/functions/meet'
const ZONES = { 'Zone 1': 'SQUAD', 'Zone 2': 'SitSold', 'Zone 3': 'SHARKS', 'Zone 4': 'HURRICANE' }
const KINDS = [['oneoff', 'One-time meeting (invite people)'], ['company', 'Company meeting (all reps, trainees & managers)'], ['training', 'Training class (Week A / Week B)'], ['zone', 'Team room (one zone)'], ['managers', 'Managers'], ['prayer', 'Prayer call'], ['everyone', 'Everyone (all reps)'], ['custom', 'Custom (private: invite who you want)'], ['retraining', 'Retraining (managers pick their reps)']]
const blank = { title: '', kind: 'zone', zone: 'Zone 1', schedule: '', topic: '', cameras_required: true, hosts: '', host_ids: [], public: false, host_code: '', days: [], time: '', minutes: 60, once: [], recording_enabled: false, rec_to: [], rec_kind: 'combined', rec_keep_days: 90 }
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
// Weekly slots (each day its own time); old rooms stored days + one time — read those as slots.
const slotsOfForm = (f) => (Array.isArray(f.slots) && f.slots.length ? f.slots : (f.days || []).filter(() => f.time).map((d) => ({ day: d, time: f.time, minutes: f.minutes || 60 })))
const endLabel = (t, m) => { const [h, mi] = t.split(':').map(Number); const e = h * 60 + mi + (Number(m) || 0); const hh = Math.floor(e / 60) % 24, mm = e % 60; return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh >= 12 ? 'PM' : 'AM'}` }
const nextLabel = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')
const etDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const t = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) : '')

export default function MeetingRooms() {
  const pin = (() => { try { return sessionStorage.getItem('meet_admin_ok_pin') || '' } catch { return '' } })()
  const call = async (body) => (await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin, ...body }) })).json()
  const [rooms, setRooms] = useState([])
  const [site, setSite] = useState('')
  const [hostPeople, setHostPeople] = useState([])
  const [err, setErr] = useState('')
  const [form, setForm] = useState(null) // room being created/edited
  const [open, setOpen] = useState(null) // { slug, tab:'people'|'attendance'|'guests', data }
  const [day, setDay] = useState(etDay())
  const [msg, setMsg] = useState('')
  const [mail, setMail] = useState(null) // { slug, subject, message, test_to, log } — email a public room's list
  const openMail = async (r) => {
    setMail({ slug: r.slug, title: r.title, subject: '', message: '', test_to: '', log: null, note: '' })
    const j = await call({ action: 'email_log', slug: r.slug }).catch(() => ({}))
    setMail((m) => (m && m.slug === r.slug ? { ...m, log: j.log || [] } : m))
  }
  const sendMail = async (test) => {
    if (!mail.subject.trim() || !mail.message.trim()) { setMail({ ...mail, note: 'Write a subject and a message first.' }); return }
    if (test && !mail.test_to.trim()) { setMail({ ...mail, note: 'Type your email address for the test.' }); return }
    if (!test && !window.confirm(`Email everyone on the ${mail.title} list who asked for emails?`)) return
    const r = await fetch('/.netlify/functions/meet-email-background', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin, slug: mail.slug, subject: mail.subject, message: mail.message, test_to: test ? mail.test_to.trim() : undefined }) }).catch(() => null)
    setMail({ ...mail, note: !r || r.status >= 400 ? 'Could not send — try again.' : test ? `Test sent to ${mail.test_to}. Check that inbox (and spam).` : 'Sending now. It takes about a second per person; refresh this box in a minute to see the result.' })
  }
  // ONE-OFF MEETINGS: who can be invited (TMS people), searchable.
  const [people, setPeople] = useState(null)
  const [pq, setPq] = useState('')
  const [staff, setStaff] = useState(null)
  const [sq, setSq] = useState('')
  const loadPeople = async () => { if (people) return; const j = await call({ action: 'people_search' }).catch(() => ({})); setPeople(j.ok ? j.people : []); setStaff(j.ok ? j.staff || [] : []) }
  // The invite list loads as soon as the Who's invited box shows (editing a room never loaded it).
  useEffect(() => { if (form && (form.kind === 'oneoff' || form.kind === 'custom')) loadPeople() }, [form?.kind, form?.original_slug]) // eslint-disable-line react-hooks/exhaustive-deps
  const [dragging, setDragging] = useState(null) // slug being dragged
  // Drag a card onto another to move it there; the new order saves straight away.
  const dropOn = async (target) => {
    if (!dragging || dragging === target) { setDragging(null); return }
    const list = rooms.filter((r) => r.slug !== dragging)
    list.splice(list.findIndex((r) => r.slug === target) + (rooms.findIndex((r) => r.slug === dragging) < rooms.findIndex((r) => r.slug === target) ? 1 : 0), 0, rooms.find((r) => r.slug === dragging))
    setRooms(list); setDragging(null)
    const j = await call({ action: 'reorder', slugs: list.map((r) => r.slug) }).catch(() => ({}))
    if (!j.ok) { setMsg('Could not save the new order'); load() }
  }

  const load = async () => {
    const j = await call({ action: 'rooms' }).catch(() => ({}))
    if (j.ok) { setRooms(j.rooms); setSite(j.site); setHostPeople(j.host_people || []) } else setErr(j.error || 'Could not load rooms')
  }
  useEffect(() => { document.title = 'Meeting Room Setup · TMS'; load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setMsg('')
    const j = await call({ action: 'save_room', room: { ...form, slots: slotsOfForm(form), once: (form.once || []).filter(Boolean), hosts: String(form.hosts || '').split(',').map((s) => s.trim()).filter(Boolean) } })
    if (!j.ok) { setMsg(j.error || 'Could not save'); return }
    setForm(null); load()
  }
  const show = async (slug, tab, d = day) => {
    // Same button again (or ✕ Hide) closes it (Neal, 2026-10-05). Changing the attendance day doesn't.
    if (d === day && open?.slug === slug && open?.tab === tab) { setOpen(null); return }
    setOpen({ slug, tab, data: null }); setMsg('')
    const j = await call({ action: tab === 'people' ? 'audience' : tab, slug, date: d })
    setOpen({ slug, tab, data: j.ok ? j : { error: j.error } })
  }
  // SEND LINKS with your own message (Neal, 2026-10-04 — the virtual Week A notice). {first} and
  // {link} are filled in for each person; every message goes by text AND email.
  const [compose, setCompose] = useState(null) // { slug, title, subject, message }
  // 🔀 Combine today: { slug, into, reason, busy } (Neal, 2026-10-05).
  const [combine, setCombine] = useState(null)
  const todayET = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const doCombine = async (r, cancel) => {
    if (cancel) { await call({ action: 'combine_today', slug: r.slug, into: r.merge.into, cancel: true }); load(); return }
    const into = rooms.find((x) => x.slug === combine.into)
    if (!into) { setMsg('Pick the room they are joining.'); return }
    if (!window.confirm(`Today only: send ${r.team || r.title} to ${into.team || into.title}'s room, and text + email both teams their link?`)) return
    setCombine({ ...combine, busy: true })
    const j = await call({ action: 'combine_today', slug: r.slug, into: into.slug, reason: combine.reason || '', notify: true })
    setCombine(null)
    if (!j.ok) { setMsg(j.error || 'Did not work'); return }
    const ok = (j.sent || []).filter((x) => x.sms || x.email).length
    setMsg(`🔀 Done. ${r.team || r.title} goes to ${into.team || into.title} today. Texted + emailed ${ok} of ${(j.sent || []).length}.`)
    load()
  }
  // Custom rooms (a private standing meeting) invite with the schedule + how to bookmark the link.
  const BOOKMARK = 'Two ways to find it again:\n1) Bookmark this link so it is one tap away:\n• iPhone: open the link in Safari, tap Share, then "Add to Home Screen".\n• Android: open it in Chrome, tap ⋮, then "Add to Home screen".\n• Computer: press Ctrl+D (⌘+D on a Mac).\n2) Or open your My Tools page and tap "Your meetings". Every meeting you are part of is in there.'
  const sendLinks = (r) => setCompose(r.kind === 'custom'
    ? { slug: r.slug, title: r.title, subject: `You're invited: ${r.title}`, message: `Hi {first}, you're invited to ${r.title}${r.schedule ? `, ${r.schedule}` : ''} (Eastern).\n\nThis is your own link. Use it every time: {link}\n\n${BOOKMARK}` }
    : r.kind === 'oneoff'
    ? { slug: r.slug, title: r.title, subject: `You're invited: ${r.title}`, message: `Hi {first}, you're invited to ${r.title} on {when} (Eastern). Please confirm you'll be there: {link}` }
    : { slug: r.slug, title: r.title, subject: `Your link: ${r.title}`, message: `Hi {first}, here is your link for ${r.title}. It's yours only, so use it every time: {link}` })
  const sendNow = async () => {
    const r = compose
    if (!window.confirm(`Text AND email every person in "${r.title}" this message with their own link?`)) return
    setMsg('Sending…')
    const j = await call({ action: 'send_links', slug: r.slug, message: r.message, subject: r.subject })
    setCompose(null)
    if (!j.ok) { setMsg(j.error || 'Send failed'); return }
    const ok = j.sent.filter((x) => x.sms || x.email).length
    setMsg(`Sent to ${ok} of ${j.sent.length}.` + (j.sent.some((x) => !x.sms && !x.email) ? ` Not reached: ${j.sent.filter((x) => !x.sms && !x.email).map((x) => x.name).join(', ')}` : ''))
  }
  const csv = (rows) => {
    const lines = [['Name', 'Email', 'Wants emails', 'First visit', 'Last visit', 'Visits'], ...rows.map((g) => [g.name, g.email, g.opt_in ? 'yes' : 'no', g.first, g.last, g.visits])]
    const blob = new Blob([lines.map((l) => l.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'guest-list.csv'; a.click()
  }
  const copy = (s) => { navigator.clipboard?.writeText(s); setMsg('Link copied') }

  const field = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm'
  const [closedGroups, setClosedGroups] = useState(() => { try { return JSON.parse(localStorage.getItem('meet_rooms_groups') || '{"past":true}') } catch { return { past: true } } })
  const toggleGroup = (k) => setClosedGroups((g) => { const n = { ...g, [k]: !g[k] }; try { localStorage.setItem('meet_rooms_groups', JSON.stringify(n)) } catch { /* private */ } return n })
  // One room's card (used in every group below).
  // Each card tinted in its own colour so the page has some separation (Neal, 2026-10-05): a team
  // room in its team colour, the rest by type.
  // Training cards (Week A / Week B / retraining) in U.S. Shingle navy + red, with the logo.
  const cardColor = (r) => r.color || ({ prayer: '#B8893D', company: '#E04A3A', training: '#1F2A5C', managers: '#7C3AED', custom: '#475569', oneoff: '#2563EB', retraining: '#1F2A5C', everyone: '#EA580C' }[r.kind] || '#334155')
  const roomCard = (r) => (
          <div key={r.slug} draggable onDragStart={() => setDragging(r.slug)} onDragEnd={() => setDragging(null)}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); dropOn(r.slug) }}
            className="rounded-lg p-4 shadow-sm" style={{ background: `linear-gradient(90deg, ${cardColor(r)}26, ${cardColor(r)}0d)`, border: `1px solid ${cardColor(r)}66`, borderLeft: `6px solid ${cardColor(r)}`, opacity: dragging === r.slug ? 0.4 : 1, outline: dragging && dragging !== r.slug ? '2px dashed #cbd5e1' : 'none' }}>
            <div className="flex flex-wrap items-center gap-3">
              <span title="Drag to reorder" className="cursor-grab select-none text-xl text-slate-400">⠿</span>
              {r.badge ? <img src={r.badge} alt="" className={r.badge === '/uss-logo.png' ? 'h-10 w-16 rounded bg-white object-contain p-0.5' : 'h-10 w-10 object-contain'} /> : r.banner_url ? <img src={r.banner_url} alt="" className="h-10 w-16 rounded object-cover" /> : null}
              <div className="min-w-0 flex-1">
                <div className="text-lg font-bold">{r.team && <span style={{ color: r.color }} className="mr-2">{r.team}</span>}{r.title}</div>
                {(r.host_names || []).length > 0 && <div className="text-sm font-semibold text-slate-700">👤 Host: {r.host_names.join(' & ')}</div>}
                <div className="text-xs text-slate-500">{KINDS.find(([k]) => k === r.kind)?.[1]}{r.schedule ? ` · ${r.schedule}` : ''}{r.scheduled ? (r.next_at ? ` · next: ${nextLabel(r.next_at)}` : ' · nothing scheduled') : ' · always open'}{r.public ? ' · open to the public' : ''}{r.topic ? ` · "${r.topic}"` : ''}{r.rsvp ? <span className="ml-1 font-semibold"> · {r.rsvp.invited} invited · <span className="text-emerald-700">{r.rsvp.yes} confirmed</span> · <span className="text-red-700">{r.rsvp.no} can't</span> · {Math.max(0, r.rsvp.invited - r.rsvp.yes - r.rsvp.no)} no answer</span> : null}</div>
              </div>
              <a href={`/meet/${r.slug}`} target="_blank" rel="noreferrer" className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-bold text-white">Join as host</a>
              <a href={`/meet/${r.slug}?as=attendee`} target="_blank" rel="noreferrer" className="rounded-md border border-blue-600 bg-white px-3 py-1.5 text-sm font-bold text-blue-700">Join as attendee</a>
              <button onClick={() => copy(`${site}/meet/${r.slug}`)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold">{r.public ? '📋 Copy invite link' : 'Copy host link'}</button>
              <button onClick={() => setForm({ ...blank, ...r, hosts: (r.hosts || []).join(', '), original_slug: r.slug })} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold">Edit</button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              {/* A public room (the devotional) is for people OUTSIDE the company: its people are the
                  ones who signed in with name + email, not the TMS roster (Neal, 2026-10-04). */}
              {(r.kind !== 'custom' || (r.invitees || []).length > 0) && !r.public && <button onClick={() => show(r.slug, 'people')} className="rounded border border-slate-300 px-3 py-1 font-semibold">{r.kind === 'oneoff' ? '✅ Who\'s coming' : '👥 People & links'}</button>}
              {(r.kind !== 'custom' || (r.invitees || []).length > 0) && !r.public && <button onClick={() => sendLinks(r)} className="rounded border border-emerald-400 bg-emerald-50 px-3 py-1 font-semibold text-emerald-800">{r.kind === 'oneoff' || r.kind === 'custom' ? '📨 Send invites' : '📨 Send everyone their link'}</button>}
              <button onClick={() => show(r.slug, 'attendance')} className="rounded border border-slate-300 px-3 py-1 font-semibold">✅ Attendance</button>
              {r.kind === 'zone' && (r.merge?.date === todayET
                ? <span className="rounded border border-amber-400 bg-amber-50 px-3 py-1 font-semibold text-amber-800">🔀 Today: joining {(rooms.find((x) => x.slug === r.merge.into) || {}).team || r.merge.into} <button onClick={() => doCombine(r, true)} className="ml-1 text-xs text-red-600 underline">undo</button></span>
                : <button onClick={() => setCombine(combine?.slug === r.slug ? null : { slug: r.slug, into: '', reason: '' })} className="rounded border border-amber-400 bg-amber-50 px-3 py-1 font-semibold text-amber-800">🔀 Combine today</button>)}
              {r.public && <button onClick={() => show(r.slug, 'guests')} className="rounded border border-slate-300 px-3 py-1 font-semibold">👥 People who signed in (email list)</button>}
              {r.recording_enabled && <button onClick={() => show(r.slug, 'recordings')} className="rounded border border-slate-300 px-3 py-1 font-semibold">🎞 Recordings</button>}
              {r.recording_enabled && r.rec_key && <button onClick={() => copy(`${site}/recordings/${r.slug}?k=${r.rec_key}`)} className="rounded border border-slate-300 px-3 py-1 font-semibold">🔗 Copy recordings page link</button>}
              {r.public && <button onClick={() => (mail?.slug === r.slug ? setMail(null) : openMail(r))} className="rounded border border-blue-400 bg-blue-50 px-3 py-1 font-semibold text-blue-800">✉️ Email the list</button>}
              <span className="flex-1" />
              <button onClick={async () => { if (window.confirm(`Delete "${r.title}"? Links to it stop working.`)) { await call({ action: 'delete_room', slug: r.slug }); load() } }} className="text-xs text-red-600">Delete</button>
            </div>

            {combine?.slug === r.slug && (
              <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
                <div className="font-bold">🔀 Today only: send {r.team || r.title} to another team's room</div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span>Joining:</span>
                  <select value={combine.into} onChange={(e) => setCombine({ ...combine, into: e.target.value })} className="rounded border border-slate-300 px-2 py-1">
                    <option value="">Pick a room…</option>
                    {rooms.filter((x) => x.slug !== r.slug && x.kind === 'zone').map((x) => <option key={x.slug} value={x.slug}>{x.team ? `${x.team} ` : ''}{x.title}</option>)}
                  </select>
                </div>
                <input value={combine.reason} onChange={(e) => setCombine({ ...combine, reason: e.target.value })} placeholder="Why (optional), e.g. Anthony is out today" className="mt-2 w-full rounded border border-slate-300 px-2 py-1" />
                <div className="mt-1 text-xs text-slate-600">Both teams get a text + email with their own link to that room. Their usual link and dashboard button also take them there today. Back to normal tomorrow.</div>
                <button disabled={combine.busy} onClick={() => doCombine(r)} className="mt-2 rounded-md bg-amber-600 px-4 py-2 font-bold text-white">{combine.busy ? 'Sending…' : 'Combine & send'}</button>
              </div>
            )}
            {compose?.slug === r.slug && (
              <div className="mt-3 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm">
                <div className="font-bold">📨 Send everyone their link (text + email)</div>
                <p className="mt-1 text-xs text-slate-600">Write it the way you'd say it. <b>{'{first}'}</b> becomes their first name and <b>{'{link}'}</b> their own link.</p>
                <input className={field} value={compose.subject} onChange={(e) => setCompose({ ...compose, subject: e.target.value })} placeholder="Email subject" />
                <textarea className={field} rows={8} value={compose.message} onChange={(e) => setCompose({ ...compose, message: e.target.value })} />
                <div className="mt-1 rounded bg-white p-2 text-xs text-slate-600"><b>Preview:</b> {compose.message.replace(/\{when\}/g, 'Thursday, October 8, 6:00 PM').replace(/\{first\}/g, 'Sam').replace(/\{link\}/g, `${site}/meet/${r.slug}?t=…`)}</div>
                <div className="mt-2 flex gap-2"><button onClick={sendNow} className="rounded-md bg-emerald-600 px-4 py-2 font-bold text-white">Send to everyone</button><button onClick={() => setCompose(null)} className="rounded-md border border-slate-300 px-4 py-2 font-semibold">Cancel</button></div>
              </div>
            )}
            {mail?.slug === r.slug && (
              <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm">
                <div className="font-bold">✉️ Email everyone on the list who asked for emails</div>
                <p className="mt-1 text-xs text-slate-600">It comes from "{r.title}", starts with "Hi (their first name)," and ends with an unsubscribe link. People who didn't tick "email me" or who unsubscribed are skipped.</p>
                <input className={field} value={mail.subject} onChange={(e) => setMail({ ...mail, subject: e.target.value })} placeholder="Subject, e.g. This week: walking through Psalm 23" />
                <textarea className={field} rows={7} value={mail.message} onChange={(e) => setMail({ ...mail, message: e.target.value })} placeholder={`Message. Include the link so they can join:\n${site}/meet/${r.slug}`} />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input className="rounded-md border border-slate-300 px-3 py-2 text-sm" value={mail.test_to} onChange={(e) => setMail({ ...mail, test_to: e.target.value })} placeholder="your email for a test" />
                  <button onClick={() => sendMail(true)} className="rounded-md border border-slate-300 bg-white px-3 py-2 font-semibold">Send me a test</button>
                  <span className="flex-1" />
                  <button onClick={() => sendMail(false)} className="rounded-md bg-blue-700 px-4 py-2 font-bold text-white">Send to the list</button>
                </div>
                {mail.note && <div className="mt-2 font-semibold text-blue-900">{mail.note}</div>}
                {mail.log && mail.log.length > 0 && (
                  <div className="mt-3 border-t border-blue-200 pt-2 text-xs text-slate-600">
                    <div className="mb-1 font-bold">Sent before <button onClick={() => openMail(r)} className="ml-2 font-normal text-blue-700 underline">refresh</button></div>
                    {mail.log.map((l, i) => <div key={i}>{new Date(l.at).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · "{l.subject}" · {l.sent} of {l.to} sent{l.failed?.length ? ` · ${l.failed.length} failed` : ''}{l.by ? ` · by ${l.by}` : ''}</div>)}
                  </div>
                )}
              </div>
            )}
            {open?.slug === r.slug && (
              <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm">
                <div className="mb-1 flex justify-end"><button onClick={() => setOpen(null)} className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs font-semibold text-slate-600 hover:bg-slate-100">✕ Hide</button></div>
                {open.tab === 'people' && open.data?.people?.some((q) => q.probation) && (() => {
                  const P = open.data.people.filter((q) => q.probation).map((q) => q.probation)
                  return <div className="mb-2 rounded bg-white p-2 text-sm font-semibold">Second chance: {P.length} turned away · {P.filter((x) => x.seen_at).length} opened · <span className="text-orange-700">{P.filter((x) => x.committed_at).length} 🔥 committed</span> · <span className="text-emerald-700">{P.filter((x) => x.committed_at && (x.so_far ?? 0) >= 30).length} on track</span>{P.some((x) => x.result) ? ` · ${P.filter((x) => x.result === 'enrolled').length} enrolled` : ''}</div>
                })()}
                {!open.data ? 'Loading…' : open.data.error ? <span className="text-red-700">{open.data.error}</span> : open.tab === 'people' ? (
                  <table className="w-full">
                    <thead><tr className="text-left text-slate-500"><th>Name</th><th>Their link</th></tr></thead>
                    <tbody>{open.data.people.map((p) => (
                      <tr key={p.id} className="border-t border-slate-200"><td className="py-1 font-semibold">{p.name}{p.host ? ' · host' : ''}
                          {open.data.people.some((q) => 'rsvp' in q) && <span className={`ml-2 rounded px-1.5 text-xs font-bold ${p.rsvp?.status === 'yes' ? 'bg-emerald-100 text-emerald-800' : p.rsvp?.status === 'no' ? 'bg-red-100 text-red-800' : 'bg-slate-200 text-slate-600'}`}>{p.rsvp?.status === 'yes' ? '✅ Confirmed' : p.rsvp?.status === 'no' ? "❌ Can't make it" : 'No answer yet'}</span>}
                          {p.effort && <span className={`ml-2 rounded px-1.5 text-xs ${p.effort.override ? 'bg-slate-100 text-slate-600' : (p.effort.average === null || p.effort.average >= (open.data.effort_needed || 30)) ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`} title={Object.entries(p.effort.perDay).map(([d, n]) => `${d}: ${n}`).join(' · ')}>{p.effort.override ? 'override (let in)' : p.effort.average === null ? 'all days with William' : `${p.effort.average} doors/day`}{p.effort.rideDays?.length ? ` · ${p.effort.rideDays.length} day${p.effort.rideDays.length > 1 ? 's' : ''} with William not counted` : ''}{!p.effort.linked ? ' · no map access found' : ''}</span>}
                          {p.probation && !p.probation.result && <span className="ml-2 text-xs text-slate-500">{p.probation.seen_at ? `👀 opened ${new Date(p.probation.seen_at).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : '👀 not opened yet'}</span>}
                          {p.probation?.committed_at && !p.probation.result && p.probation.so_far != null && <span className={`ml-2 rounded px-1.5 text-xs font-bold ${p.probation.so_far >= 30 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`} title={Object.entries(p.probation.so_far_perDay || {}).map(([d, n]) => `${d}: ${n}`).join(' · ')}>this week: {p.probation.so_far}/day {p.probation.so_far >= 30 ? '· on track ✓' : '· needs 30'}</span>}
                          {p.probation && <span className={`ml-2 rounded px-1.5 text-xs ${p.probation.result === 'enrolled' ? 'bg-emerald-100 text-emerald-800' : p.probation.committed_at ? 'bg-orange-100 text-orange-800' : 'bg-slate-200 text-slate-700'}`}>{p.probation.result === 'enrolled' ? '✅ proved it, enrolled' : p.probation.result === 'did_not_qualify' ? `didn't make 30 (${p.probation.week_avg})` : p.probation.result === 'did_not_commit' ? "didn't commit: gone" : p.probation.committed_at ? `🔥 Committed ${new Date(p.probation.committed_at).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : "Didn't commit"}</span>}
                          {p.early_b ? <span className="ml-2 rounded bg-emerald-100 px-1.5 text-xs text-emerald-800">🎓 Graduated Week B early: junior rep</span> : p.early_a ? <span className="ml-2 rounded bg-sky-100 px-1.5 text-xs text-sky-800">🎓 Graduated Week A early: in the field</span> : null}</td>
                        <td className="whitespace-nowrap"><button onClick={() => copy(p.link)} className="text-blue-700 underline">Copy link</button>
                          {r.kind === 'training' && !p.early_a && !p.early_b && <button onClick={async () => { if (!window.confirm(`${p.name}: graduated Week A early?\n\nThey go into the field for the rest of Week A and stay in the class for Week B (their link keeps working).`)) return; const j = await call({ action: 'early_grad', trainee_id: p.id, week: 'A' }); setMsg(j.ok ? `${j.name}: graduated Week A early ✓` : (j.error || 'Did not work')); show(r.slug, 'people') }} className="ml-3 rounded border border-sky-300 bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-800">🎓 Week A early</button>}
                          {r.kind === 'training' && !p.early_b && <button onClick={async () => { if (!window.confirm(`${p.name}: graduated Week B early?\n\nThey become a JUNIOR REP on their team now (active sales rep).`)) return; const j = await call({ action: 'early_grad', trainee_id: p.id, week: 'B' }); setMsg(j.ok ? `${j.name}: graduated Week B early, now a junior rep ✓` : (j.error || 'Did not work')); show(r.slug, 'people') }} className="ml-2 rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">🎓 Week B early</button>}
                        </td></tr>
                    ))}</tbody>
                  </table>
                ) : open.tab === 'attendance' ? (
                  <>
                    <div className="mb-2 flex items-center gap-2">Day <input type="date" value={day} onChange={(e) => { setDay(e.target.value); show(r.slug, 'attendance', e.target.value) }} className="rounded border border-slate-300 px-2 py-1" /></div>
                    {!open.data.people.length ? <span className="text-slate-500">Nobody joined that day.</span> : (
                      <table className="w-full">
                        <thead><tr className="text-left text-slate-500"><th>Name</th><th>Joined</th><th>Left</th><th>Minutes</th><th>Camera off</th></tr></thead>
                        <tbody>{(() => {
                          // One row per PERSON (rejoining or a second device made extra rows), and a camera
                          // that went off as they LEFT doesn't count as "camera off" (Neal, 2026-10-04).
                          const by = new Map()
                          for (const p of open.data.people) {
                            const k = String(p.name || p.identity).trim().toLowerCase()
                            const outs = (p.joins || []).map((j) => (j.out ? Date.parse(j.out) : null)).filter(Boolean)
                            const offs = (p.camera || []).filter((c) => !c.on && !outs.some((o) => Math.abs(o - Date.parse(c.at)) < 15000)).length
                            const mins = (p.joins || []).reduce((t, j) => t + ((j.out ? Date.parse(j.out) : Date.now()) - Date.parse(j.in)), 0) / 60000
                            const first = (p.joins || [])[0]?.in, lastJ = (p.joins || [])[p.joins.length - 1]
                            const cur = by.get(k) || { name: p.name, first: null, last: null, still: false, mins: 0, offs: 0 }
                            if (first && (!cur.first || first < cur.first)) cur.first = first
                            if (lastJ?.out && (!cur.last || lastJ.out > cur.last)) cur.last = lastJ.out
                            if ((p.joins || []).some((j) => !j.out)) cur.still = true
                            cur.mins += mins; cur.offs += offs
                            by.set(k, cur)
                          }
                          return [...by.values()].sort((a, c) => String(a.first).localeCompare(String(c.first))).map((p) => (
                            <tr key={p.name} className="border-t border-slate-200"><td className="py-1 font-semibold">{p.name}</td><td>{t(p.first)}</td>
                              <td>{p.still ? <span className="text-emerald-700">still in</span> : t(p.last)}</td><td>{Math.round(p.mins)}</td><td>{p.offs ? `${p.offs}×` : ''}</td></tr>
                          ))
                        })()}</tbody>
                      </table>
                    )}
                  </>
                ) : open.tab === 'recordings' ? (
                  !open.data.recordings.length ? <span className="text-slate-500">No recordings yet. The host presses ⏺ Record in the meeting.</span> : (
                    <table className="w-full">
                      <thead><tr className="text-left text-slate-500"><th>When</th><th>What</th><th>Length</th><th></th></tr></thead>
                      <tbody>{open.data.recordings.map((x) => (
                        <tr key={x.egress_id} className="border-t border-slate-200">
                          <td className="py-1">{new Date(x.started).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                          <td>{x.kind === 'raw' ? "Host's camera" : 'Meeting as seen'}</td>
                          <td>{[x.seconds != null ? (x.seconds < 60 ? `${x.seconds} sec` : `${Math.round(x.seconds / 60)} min`) : x.minutes ? `${x.minutes} min` : '', x.mb ? `${x.mb} MB` : ''].filter(Boolean).join(' · ')}</td>
                          <td>{x.deleted ? <span className="text-slate-400">deleted (past keep date)</span> : x.link ? <a href={x.link} className="font-semibold text-blue-700 underline">⬇ Download</a> : x.error ? <span className="text-red-700">failed</span> : <span className="text-amber-700">processing…</span>}{x.notified ? <span className="ml-2 text-xs text-emerald-700">emailed ✓</span> : null}
                            <button onClick={async () => { if (!window.confirm('Delete this recording for good? The video file is removed too.')) return; const j = await call({ action: 'delete_recording', slug: r.slug, egress_id: x.egress_id }); if (j.ok) show(r.slug, 'recordings'); else setMsg(j.error || 'Could not delete') }} className="ml-3 text-xs text-red-600" title="Delete">🗑 Delete</button></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  )
                ) : (
                  <>
                    <div className="mb-2 flex items-center gap-2"><b>{open.data.guests.length}</b> people · <b>{open.data.guests.filter((g) => g.opt_in).length}</b> asked for emails
                      <button onClick={() => csv(open.data.guests)} className="ml-auto rounded border border-slate-300 px-2 py-1 font-semibold">⬇ Download CSV</button></div>
                    <table className="w-full">
                      <thead><tr className="text-left text-slate-500"><th>Name</th><th>Email</th><th>Wants emails</th><th>Visits</th></tr></thead>
                      <tbody>{open.data.guests.map((g) => <tr key={g.email} className="border-t border-slate-200"><td className="py-1">{g.name}</td><td>{g.email}</td><td>{g.opt_in ? '✓' : ''}</td><td>{g.visits}</td></tr>)}</tbody>
                    </table>
                  </>
                )}
              </div>
            )}
          </div>
  )
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-brand-navy">🛠️ Meeting Room Setup</h1>
        <span className="flex-1" />
        <button onClick={() => { setForm({ ...blank, kind: 'oneoff', look: 'company', cameras_required: true, once: [''], minutes: 60, invitees: [] }); loadPeople() }} className="rounded-md border-2 border-brand-navy px-4 py-2 text-sm font-bold text-brand-navy">📅 Create a one-time meeting</button>
        <button onClick={() => setForm({ ...blank })} className="rounded-md bg-brand-navy px-4 py-2 text-sm font-bold text-white">🎥 Create a meeting room</button>
      </div>
      <p className="mt-1 text-sm text-slate-600">Our own meetings, in place of Zoom. Everyone joins from their own link: no app, no meeting ID, and attendance takes itself.</p>
      {err && <div className="mt-3 text-sm font-semibold text-red-700">{err}</div>}
      {msg && <div className="mt-3 rounded bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">{msg}</div>}

      {form && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-bold">{form.original_slug ? (form.kind === 'oneoff' ? 'Edit one-time meeting' : 'Edit room') : (form.kind === 'oneoff' ? 'Create a one-time meeting' : 'Create a meeting room')}</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-semibold">Room name<input className={field} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Morning Sales Training" /></label>
            <label className="text-sm font-semibold">Type<select className={field} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value, public: e.target.value === 'prayer' ? true : form.public })}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            {/* A one-time meeting's date + time live in the ONE "When" section below (Neal, 2026-10-05:
                Nikki — "the time is in three locations to enter"). */}
            {(form.kind === 'oneoff' || form.kind === 'custom') && (
              <div className="rounded-md border border-indigo-200 bg-indigo-50 p-3 sm:col-span-2 text-sm">
                <div className="font-bold">Who's invited <span className="font-normal text-slate-500">({(form.invitees || []).length} picked)</span></div>
                <div className="mt-2 font-semibold text-slate-800">👥 Active sales reps <span className="font-normal text-slate-500">(and managers, trainees)</span></div>
                <input value={pq} onChange={(e) => setPq(e.target.value)} onFocus={loadPeople} placeholder="Search names, teams, Manager, Trainee…" className="mt-1 w-full rounded border border-slate-300 px-2 py-1" />
                <div className="mt-1 max-h-48 overflow-auto rounded border border-slate-200 bg-white">
                  {!people ? <div className="p-2 text-slate-500">Loading…</div> : people.filter((x) => !pq || `${x.name} ${x.tag}`.toLowerCase().includes(pq.toLowerCase())).map((x) => {
                    const on = (form.invitees || []).some((y) => y.id === x.id)
                    return <label key={x.id} className="flex cursor-pointer items-center gap-2 border-b border-slate-100 px-2 py-1"><input type="checkbox" checked={on} onChange={(e) => setForm({ ...form, invitees: e.target.checked ? [...(form.invitees || []), { id: x.id }] : (form.invitees || []).filter((y) => y.id !== x.id) })} /> <span className="font-semibold">{x.name}</span> <span className="text-xs text-slate-500">{x.tag}</span></label>
                  })}
                </div>
                {people && pq && <button onClick={() => { const add = people.filter((x) => `${x.name} ${x.tag}`.toLowerCase().includes(pq.toLowerCase())).map((x) => ({ id: x.id })); setForm({ ...form, invitees: [...(form.invitees || []).filter((y) => !add.some((a) => a.id === y.id)), ...add] }) }} className="mt-1 text-xs font-semibold text-blue-700">+ Invite everyone matching "{pq}"</button>}
                {/* EVERYONE ELSE IN THE COMPANY (Neal, 2026-10-05: Nikki, Hank want department meetings).
                    Office staff from GoHighLevel; picked ones get their own link by text + email. */}
                <div className="mt-4 font-semibold text-slate-800">🏢 Everyone else in the company <span className="font-normal text-slate-500">(active in JobNimbus, by department; search "Foreman", "Admin", "PA"…)</span></div>
                <input value={sq} onChange={(e) => setSq(e.target.value)} onFocus={loadPeople} placeholder="Search name or department…" className="mt-1 w-full rounded border border-slate-300 px-2 py-1" />
                <div className="mt-1 max-h-56 overflow-auto rounded border border-slate-200 bg-white">
                  {!staff ? <div className="p-2 text-slate-500">Loading…</div> : staff.filter((x) => !sq || `${x.name} ${x.dept}`.toLowerCase().includes(sq.toLowerCase())).map((x) => {
                    const dg = (v) => String(v || '').replace(/\D/g, '').slice(-10)
                    const same = (y) => !y.id && (x.cell ? dg(y.phone) === x.cell : String(y.name || '').toLowerCase() === x.name.toLowerCase())
                    const on = (form.invitees || []).some(same)
                    return (
                      <div key={x.email || x.name} className="flex items-center gap-2 border-b border-slate-100 px-2 py-1">
                        <input type="checkbox" checked={on} onChange={(e) => setForm({ ...form, invitees: e.target.checked ? [...(form.invitees || []), { name: x.name, phone: x.phone, email: x.email }] : (form.invitees || []).filter((y) => !same(y)) })} />
                        <span className="flex-1">{x.name} <span className="text-xs text-slate-400">{x.dept}</span></span>
                        {x.cell ? <span className="text-xs text-slate-500">📱 …{x.cell.slice(-4)}</span>
                          : <button type="button" onClick={async () => { const ph = window.prompt(`${x.name} has no cell on file (JobNimbus doesn't keep phones). Type their cell to save it for every meeting and Call:`); if (!ph) return; const j = await call({ action: 'set_staff_cell', email: x.email, name: x.name, phone: ph }).catch(() => ({})); if (j.ok) setStaff(staff.map((z) => (z === x ? { ...z, phone: j.phone, cell: j.phone.replace(/\D/g, '') } : z))); else alert(j.error || 'Could not save.') }} className="text-xs font-semibold text-red-600 underline">⚠️ no cell: add</button>}
                      </div>
                    )
                  })}
                </div>
                {staff && sq && <button onClick={() => { const add = staff.filter((x) => `${x.name} ${x.dept}`.toLowerCase().includes(sq.toLowerCase())).map((x) => ({ name: x.name, phone: x.phone, email: x.email })); const dg = (v) => String(v || '').replace(/\D/g, '').slice(-10); setForm({ ...form, invitees: [...(form.invitees || []).filter((y) => y.id || !add.some((a) => (a.phone && dg(a.phone) === dg(y.phone)) || a.name.toLowerCase() === String(y.name || '').toLowerCase())), ...add] }) }} className="mt-1 text-xs font-semibold text-blue-700">+ Invite everyone matching "{sq}"</button>}
                <div className="mt-3 font-bold">Someone not in TMS?</div>
                {(form.invitees || []).filter((y) => !y.id).map((y, i) => (
                  <div key={y.key || i} className="mt-1 flex flex-wrap gap-2">
                    {['name', 'phone', 'email'].map((f) => <input key={f} value={y[f] || ''} placeholder={f[0].toUpperCase() + f.slice(1)} onChange={(e) => setForm({ ...form, invitees: form.invitees.map((z) => (z === y ? { ...z, [f]: e.target.value } : z)) })} className="w-40 flex-1 rounded border border-slate-300 px-2 py-1" />)}
                    <button onClick={() => setForm({ ...form, invitees: form.invitees.filter((z) => z !== y) })} className="text-xs text-red-600">remove</button>
                  </div>
                ))}
                <button onClick={() => setForm({ ...form, invitees: [...(form.invitees || []), { name: '', phone: '', email: '' }] })} className="mt-1 text-sm font-semibold text-blue-700">+ Add someone else</button>
              </div>
            )}
            {form.kind === 'training' && <label className="text-sm font-semibold">Which week<select className={field} value={form.training_week || 'A'} onChange={(e) => setForm({ ...form, training_week: e.target.value })}><option value="A">Week A: trainees in their first week</option><option value="B">Week B: trainees in their second week</option><option value="both">Both weeks</option></select></label>}
            {form.kind === 'training' && form.training_week === 'B' && <label className="flex items-center gap-2 text-sm font-semibold sm:col-span-2"><input type="checkbox" checked={!!form.effort_gate} onChange={(e) => setForm({ ...form, effort_gate: e.target.checked })} /> Require the effort: an average of 30 doors a day on DoorDispatcher over Week A Thu–Sat. Anyone short gets the "prove it this week" second chance.</label>}
            {form.kind === 'zone' && <label className="text-sm font-semibold">Team<select className={field} value={form.zone || 'Zone 1'} onChange={(e) => setForm({ ...form, zone: e.target.value })}>{Object.entries(ZONES).map(([z, n]) => <option key={z} value={z}>{n} ({z})</option>)}</select></label>}
            {/* No separate "When" text box (Neal, 2026-10-05: Nikki — "why have it twice"). The line on the
                link is written from "When it meets" below when you save. */}
            <label className="text-sm font-semibold sm:col-span-2">Today's topic (shown at the top; the host can change it in the meeting)<input className={field} value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} placeholder="e.g. Today: Psalm 23" /></label>
            {/* 👤 HOST (Neal, 2026-10-05: "an area where we can say who the host is"). Shown on the
                card, every dashboard and the join screen; whoever is picked hosts from their own link. */}
            <div className="rounded-md border-2 border-blue-300 bg-blue-50 p-3 text-sm sm:col-span-2">
              <div className="font-bold">👤 Host</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {hostPeople.map((x) => {
                  // Office hosts not in TMS (Hank) live in the names list; everyone else by TMS id.
                  const names = String(form.hosts || '').split(',').map((h) => h.trim()).filter(Boolean)
                  const on = x.name_only ? names.some((h) => h.toLowerCase() === x.name.toLowerCase()) : (form.host_ids || []).includes(x.id)
                  const toggle = () => x.name_only
                    ? setForm({ ...form, hosts: (on ? names.filter((h) => h.toLowerCase() !== x.name.toLowerCase()) : [...names, x.name]).join(', ') })
                    : setForm({ ...form, host_ids: on ? form.host_ids.filter((y) => y !== x.id) : [...(form.host_ids || []), x.id] })
                  return (
                  <button key={x.id || x.name} type="button" onClick={toggle}
                    className={`rounded-full border px-3 py-1 font-semibold ${on ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>{on ? '✓ ' : ''}{x.name}{x.tag ? <span className={`ml-1 text-xs font-normal ${on ? 'text-blue-100' : 'text-slate-400'}`}>{x.tag}</span> : null}</button>
                ) })}
              </div>
              <label className="mt-2 block font-semibold">Someone else (names, comma-separated)<input className={field} value={form.hosts} onChange={(e) => setForm({ ...form, hosts: e.target.value })} placeholder="optional" /></label>
              <div className="mt-1 text-xs text-slate-500">{(form.host_ids || []).length || String(form.hosts || '').trim() ? 'Shown as the host everywhere this meeting appears.' : form.kind === 'zone' ? "None picked: the team's manager shows as host." : 'None picked: Neal / DeWayne show as host when they\'re included below.'}</div>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm sm:col-span-2">
              <div className="flex flex-wrap items-center gap-4">
                <span className="font-semibold">Also include:</span>
                {[['neal', 'Neal'], ['dewayne', 'DeWayne']].map(([k, l]) => (
                  <label key={k} className="flex items-center gap-1.5 font-semibold"><input type="checkbox" checked={(form.also || []).includes(k)} onChange={(e) => setForm({ ...form, also: e.target.checked ? [...(form.also || []).filter((x) => x !== k), k] : (form.also || []).filter((x) => x !== k) })} /> {l}</label>
                ))}
                <span className="text-xs text-slate-500">They get the links and reminders, see it on Your meetings, and host it.</span>
              </div>
              <label className="mt-2 flex items-center gap-2 font-semibold"><input type="checkbox" checked={!!form.mic_lock} onChange={(e) => setForm({ ...form, mic_lock: e.target.checked })} /> 🔇 Lock mics: everyone comes in muted and only a host can unmute them</label>
              {form.kind === 'retraining' && (
                <label className="mt-2 flex flex-wrap items-center gap-2 font-semibold">🔁 Picked reps join this room:
                  <select value={form.joins_room || ''} onChange={(e) => setForm({ ...form, joins_room: e.target.value })} className="rounded border border-slate-300 px-2 py-1 font-normal">
                    <option value="">Its own room</option>
                    {rooms.filter((x) => x.kind === 'training').map((x) => <option key={x.slug} value={x.slug}>{x.title}</option>)}
                  </select>
                </label>
              )}
              <label className="mt-2 flex items-center gap-2 font-semibold"><input type="checkbox" checked={!!form.auto_stage} onChange={(e) => setForm({ ...form, auto_stage: e.target.checked })} /> 🎙 Podcast view: when 2+ hosts are in, show them side by side for everyone (nobody is muted)</label>
              <label className="mt-2 flex items-center gap-2 font-semibold"><input type="checkbox" checked={!!form.remind_5} onChange={(e) => setForm({ ...form, remind_5: e.target.checked })} /> ⏰ Remind everyone 5 minutes before each meeting (text + email with their own link)</label>
            </div>
            <label className="text-sm font-semibold">Host code (for a host who isn't in TMS)<input className={field} value={form.host_code} onChange={(e) => setForm({ ...form, host_code: e.target.value })} placeholder="optional" /></label>
            {/* SCHEDULE: when the room is open. Outside it, people who tap Join are told when the
                next meeting is (Neal, 2026-10-04). Leave it all empty for an always-open room. */}
            <div className="overflow-hidden rounded-lg border-2 border-blue-300 bg-white sm:col-span-2">
              <div className="bg-blue-600 px-3 py-2 text-base font-extrabold text-white">🕒 When <span className="text-sm font-normal text-blue-100">(Eastern time)</span></div>
              <div className="p-3">
              {form.kind !== 'oneoff' && (<>
              <div className="rounded bg-slate-100 px-2 py-1 text-sm font-extrabold text-slate-800">🔁 Recurring meetings only <span className="font-normal text-slate-500">(repeats every week; leave all off if it doesn't)</span></div>
              {/* One row per day, each with its own time and length — repeats every week. */}
              <div className="mt-2 space-y-1 text-sm">
                {DOW.map((d, i) => {
                  const sl = slotsOfForm(form).find((x) => x.day === i)
                  const setSl = (patch) => setForm({ ...form, slots: [...slotsOfForm(form).filter((x) => x.day !== i), ...(patch ? [{ day: i, time: '14:00', minutes: 120, ...(sl || {}), ...patch }] : [])].sort((a, b) => a.day - b.day), days: [], time: '' })
                  return (
                    <div key={d} className="flex flex-wrap items-center gap-2">
                      <label className={`flex w-16 cursor-pointer items-center justify-center rounded border px-2 py-1 font-semibold ${sl ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white'}`}>
                        <input type="checkbox" className="hidden" checked={!!sl} onChange={(e) => setSl(e.target.checked ? {} : null)} />{d}
                      </label>
                      {sl ? (
                        <>
                          <span className="text-slate-500">starts</span>
                          <input type="time" value={sl.time} onChange={(e) => setSl({ time: e.target.value })} className="rounded border border-slate-300 px-2 py-1" />
                          <span className="text-slate-500">for</span>
                          <input type="number" min="10" max="600" value={sl.minutes} onChange={(e) => setSl({ minutes: e.target.value })} className="w-20 rounded border border-slate-300 px-2 py-1" />
                          <span className="text-slate-500">min{sl.time ? ` (ends ${endLabel(sl.time, sl.minutes)})` : ''}</span>
                        </>
                      ) : <span className="text-slate-400">no meeting</span>}
                    </div>
                  )
                })}
              </div>
              </>)}
              <div className={`${form.kind !== 'oneoff' ? 'mt-4' : ''} text-sm`}>
                <div className="rounded bg-slate-100 px-2 py-1 text-sm font-extrabold text-slate-800">📅 {form.kind === 'oneoff' ? 'Date and time' : 'One-time meetings only'} <span className="font-normal text-slate-500">{form.kind === 'oneoff' ? '' : '(a specific date, e.g. a company meeting)'}</span></div>
                {(form.once || []).length > 0 && <span className="ml-2 text-slate-500">each lasts <input type="number" min="10" max="600" value={form.minutes || 60} onChange={(e) => setForm({ ...form, minutes: e.target.value })} className="w-16 rounded border border-slate-300 px-1 py-0.5" /> min</span>}
                {(form.once || []).map((o, i) => (
                  <div key={i} className="mt-1 flex items-center gap-2">
                    <input type="datetime-local" value={o} onChange={(e) => setForm({ ...form, once: form.once.map((x, j) => (j === i ? e.target.value : x)) })} className="rounded border border-slate-300 px-2 py-1" />
                    <button onClick={() => setForm({ ...form, once: form.once.filter((_, j) => j !== i) })} className="text-xs text-red-600">remove</button>
                  </div>
                ))}
                <button onClick={() => setForm({ ...form, once: [...(form.once || []), ''] })} className="mt-1 block text-sm font-semibold text-blue-700">+ Add {form.kind === 'oneoff' && (form.once || []).filter(Boolean).length ? 'another ' : 'a '}date</button>
                {form.kind !== 'oneoff' && !slotsOfForm(form).length && !(form.once || []).filter(Boolean).length && <div className="mt-2 text-xs text-amber-700">Nothing set: the room is open any time.</div>}
              </div>
              </div>
            </div>
            {/* LOOK: how the room's pages look (Neal, 2026-10-04 — the devotional should feel like
                915devotional.com, not a company tool). */}
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 sm:col-span-2">
              <div className="text-sm font-bold">Look</div>
              <div className="mt-2 flex flex-wrap gap-2 text-sm">
                {[['team', 'Team colors (dark)'], ['company', 'Company (navy + red)'], ['devotional', '9:15 Devotional (cream, navy & gold)']].map(([k, l]) => (
                  <label key={k} className={`cursor-pointer rounded border px-3 py-1.5 font-semibold ${(form.look || (form.kind === 'company' ? 'company' : 'team')) === k ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white'}`}>
                    <input type="radio" className="hidden" checked={(form.look || (form.kind === 'company' ? 'company' : 'team')) === k} onChange={() => setForm({ ...form, look: k })} />{l}
                  </label>
                ))}
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className="text-sm font-semibold sm:col-span-2">Banner picture (web address, optional)<input className={field} value={form.banner_url || ''} onChange={(e) => setForm({ ...form, banner_url: e.target.value })} placeholder="https://…/banner.jpg" /></label>
                <label className="text-sm font-semibold sm:col-span-2">Welcome line (shown before joining)<input className={field} value={form.welcome || ''} onChange={(e) => setForm({ ...form, welcome: e.target.value })} placeholder="e.g. A short daily devotional: we open scripture and close in prayer." /></label>
                <label className="text-sm font-semibold">"No meeting now" button text<input className={field} value={form.back_label || ''} onChange={(e) => setForm({ ...form, back_label: e.target.value })} placeholder="e.g. Watch Past Devotionals" /></label>
                <label className="text-sm font-semibold">…and where it goes<input className={field} value={form.back_url || ''} onChange={(e) => setForm({ ...form, back_url: e.target.value })} placeholder="https://…" /></label>
              </div>
            </div>
            {/* RECORDING (Neal, 2026-10-04 — the devotional is recorded and DeWayne's cousin edits it). */}
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 sm:col-span-2">
              {/* ENABLE RECORDING TOOLS — any room (Neal, 2026-10-04). */}
              <button type="button" onClick={() => setForm({ ...form, recording_enabled: !form.recording_enabled })} className="flex w-full items-center gap-3 text-left">
                <span className={`relative inline-block h-6 w-11 flex-shrink-0 rounded-full transition ${form.recording_enabled ? 'bg-emerald-600' : 'bg-slate-300'}`}>
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${form.recording_enabled ? 'left-[22px]' : 'left-0.5'}`} />
                </span>
                <span className="text-sm font-bold">Enable recording tools {form.recording_enabled ? <span className="font-semibold text-emerald-700">· ON</span> : <span className="font-normal text-slate-500">· off</span>}</span>
              </button>
              <p className="mt-1 text-xs text-slate-500">Gives the host a ⏺ Record button. Pressing it mutes everyone except the host (they can unmute themselves), switches everyone to speaker view on the host, and records. Recordings go to this room's recordings page.</p>
              {form.recording_enabled && (
                <div className="mt-2 space-y-3 text-sm">
                  {/* The room's recordings page — share it or open it from here (Neal, 2026-10-04). */}
                  <div className="rounded border border-blue-200 bg-white p-2">
                    <div className="font-semibold">🎞 Recordings page</div>
                    {form.rec_key ? (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <code className="min-w-0 flex-1 truncate rounded bg-slate-100 px-2 py-1 text-xs">{`${site}/recordings/${form.original_slug || form.slug}?k=${form.rec_key}`}</code>
                        <button onClick={() => copy(`${site}/recordings/${form.original_slug || form.slug}?k=${form.rec_key}`)} className="rounded border border-slate-300 px-2 py-1 font-semibold">📋 Copy</button>
                        <a href={`/recordings/${form.original_slug || form.slug}?k=${form.rec_key}`} target="_blank" rel="noreferrer" className="rounded bg-blue-700 px-2 py-1 font-semibold text-white">Open ↗</a>
                      </div>
                    ) : <div className="mt-1 text-xs text-slate-500">Save the room once and its recordings page link appears here.</div>}
                  </div>
                  <div>
                    <div className="font-semibold">Email the recording to</div>
                    {(form.rec_to || []).map((p, i) => (
                      <div key={i} className="mt-1 flex gap-2">
                        <input className="w-40 rounded border border-slate-300 px-2 py-1" value={p.name} onChange={(e) => setForm({ ...form, rec_to: form.rec_to.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} placeholder="Name" />
                        <input className="flex-1 rounded border border-slate-300 px-2 py-1" value={p.email} onChange={(e) => setForm({ ...form, rec_to: form.rec_to.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)) })} placeholder="Email" />
                        <button onClick={() => setForm({ ...form, rec_to: form.rec_to.filter((_, j) => j !== i) })} className="text-xs text-red-600">remove</button>
                      </div>
                    ))}
                    <button onClick={() => setForm({ ...form, rec_to: [...(form.rec_to || []), { name: '', email: '' }] })} className="mt-1 font-semibold text-blue-700">+ Add a person</button>
                  </div>
                  <div>
                    <div className="font-semibold">What to record</div>
                    {[['combined', 'The meeting as people saw it (one video, ready to post)'], ['raw', "Just the host's camera (clean, easier to edit)"], ['both', 'Both']].map(([k, l]) => (
                      <label key={k} className="mt-1 flex items-center gap-2"><input type="radio" checked={(form.rec_kind || 'combined') === k} onChange={() => setForm({ ...form, rec_kind: k })} /> {l}</label>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">Keep recordings for</span>
                    <select value={String(form.rec_keep_days ?? 90)} onChange={(e) => setForm({ ...form, rec_keep_days: Number(e.target.value) })} className="rounded border border-slate-300 px-2 py-1">
                      <option value="30">30 days</option><option value="60">60 days</option><option value="90">90 days</option><option value="0">Forever</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={!!form.cameras_required} onChange={(e) => setForm({ ...form, cameras_required: e.target.checked })} /> Cameras on</label>
            <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={!!form.public} onChange={(e) => setForm({ ...form, public: e.target.checked })} /> Open to the public (guests sign in with name + email)</label>
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={save} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-bold text-white">Save</button>
            <button onClick={() => setForm(null)} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold">Cancel</button>
          </div>
        </div>
      )}

      <div className="mt-5 space-y-3">
        {!rooms.length && !err && <p className="text-sm text-slate-500">No rooms yet. Press <b>🎥 Create a meeting room</b>.</p>}
        {/* Grouped (Neal, 2026-10-05): standing rooms, then one-time meetings still to come, then
            past ones. Each heading opens/closes; Past starts closed. Remembered on this device. */}
        {[
          ['recurring', '🔁 Recurring meetings', rooms.filter((r) => r.kind !== 'oneoff' && r.kind !== 'retraining')],
          ['upcoming', '📅 Upcoming meetings', rooms.filter((r) => (r.kind === 'oneoff' || r.kind === 'retraining') && (r.next_at || !(r.once || []).filter(Boolean).length))],
          ['past', '🗂️ Past meetings', rooms.filter((r) => (r.kind === 'oneoff' || r.kind === 'retraining') && !r.next_at && (r.once || []).filter(Boolean).length)],
        ].map(([key, label, list]) => (
          <section key={key}>
            <button onClick={() => toggleGroup(key)} className="flex w-full items-center gap-2 rounded-lg bg-brand-navy px-4 py-2.5 text-left text-white">
              <span className="text-lg font-bold">{label}</span>
              <span className="rounded-full bg-white/20 px-2 text-sm font-bold">{list.length}</span>
              <span className="flex-1" />
              <span className="text-sm font-semibold">{closedGroups[key] ? '▸ Show' : '▾ Hide'}</span>
            </button>
            {!closedGroups[key] && (
              <div className="mt-3 space-y-3">
                {!list.length && <p className="px-1 text-sm text-slate-500">{key === 'upcoming' ? 'No one-time meetings coming up. Press 📅 Create a one-time meeting.' : key === 'past' ? 'None yet.' : 'No rooms yet.'}</p>}
                {list.map((r) => roomCard(r))}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
