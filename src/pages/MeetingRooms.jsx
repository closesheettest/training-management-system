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
const KINDS = [['company', 'Company meeting (all reps, trainees & managers)'], ['training', 'Training class (Week A / Week B)'], ['zone', 'Team room (one zone)'], ['managers', 'Managers'], ['prayer', 'Prayer call'], ['everyone', 'Everyone (all reps)'], ['custom', 'Custom (link only)']]
const blank = { title: '', kind: 'zone', zone: 'Zone 1', schedule: '', topic: '', cameras_required: true, hosts: '', public: false, host_code: '', days: [], time: '', minutes: 60, once: [], recording_enabled: false, rec_to: [], rec_kind: 'combined', rec_keep_days: 90 }
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const nextLabel = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')
const etDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const t = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) : '')

export default function MeetingRooms() {
  const pin = (() => { try { return sessionStorage.getItem('meet_admin_ok_pin') || '' } catch { return '' } })()
  const call = async (body) => (await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin, ...body }) })).json()
  const [rooms, setRooms] = useState([])
  const [site, setSite] = useState('')
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
    if (j.ok) { setRooms(j.rooms); setSite(j.site) } else setErr(j.error || 'Could not load rooms')
  }
  useEffect(() => { document.title = 'Meeting Rooms · TMS'; load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setMsg('')
    const j = await call({ action: 'save_room', room: { ...form, once: (form.once || []).filter(Boolean), hosts: String(form.hosts || '').split(',').map((s) => s.trim()).filter(Boolean) } })
    if (!j.ok) { setMsg(j.error || 'Could not save'); return }
    setForm(null); load()
  }
  const show = async (slug, tab, d = day) => {
    setOpen({ slug, tab, data: null }); setMsg('')
    const j = await call({ action: tab === 'people' ? 'audience' : tab, slug, date: d })
    setOpen({ slug, tab, data: j.ok ? j : { error: j.error } })
  }
  const sendLinks = async (r) => {
    if (!window.confirm(`Text AND email every person in "${r.title}" their own link?`)) return
    setMsg('Sending…')
    const j = await call({ action: 'send_links', slug: r.slug })
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
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-brand-navy">🎥 Meeting Rooms</h1>
        <span className="flex-1" />
        <button onClick={() => setForm({ ...blank })} className="rounded-md bg-brand-navy px-4 py-2 text-sm font-bold text-white">+ New room</button>
      </div>
      <p className="mt-1 text-sm text-slate-600">Our own meetings, in place of Zoom. Everyone joins from their own link: no app, no meeting ID, and attendance takes itself.</p>
      {err && <div className="mt-3 text-sm font-semibold text-red-700">{err}</div>}
      {msg && <div className="mt-3 rounded bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">{msg}</div>}

      {form && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-bold">{form.original_slug ? 'Edit room' : 'New room'}</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-semibold">Room name<input className={field} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Morning Sales Training" /></label>
            <label className="text-sm font-semibold">Type<select className={field} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value, public: e.target.value === 'prayer' ? true : form.public })}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            {form.kind === 'training' && <label className="text-sm font-semibold">Which week<select className={field} value={form.training_week || 'A'} onChange={(e) => setForm({ ...form, training_week: e.target.value })}><option value="A">Week A: trainees in their first week</option><option value="B">Week B: trainees in their second week</option><option value="both">Both weeks</option></select></label>}
            {form.kind === 'zone' && <label className="text-sm font-semibold">Team<select className={field} value={form.zone || 'Zone 1'} onChange={(e) => setForm({ ...form, zone: e.target.value })}>{Object.entries(ZONES).map(([z, n]) => <option key={z} value={z}>{n} ({z})</option>)}</select></label>}
            <label className="text-sm font-semibold">When (shown on the link)<input className={field} value={form.schedule} onChange={(e) => setForm({ ...form, schedule: e.target.value })} placeholder="e.g. Mon–Thu 9:30 AM" /></label>
            <label className="text-sm font-semibold sm:col-span-2">Today's topic (shown at the top; the host can change it in the meeting)<input className={field} value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} placeholder="e.g. Today: Psalm 23" /></label>
            <label className="text-sm font-semibold">Extra hosts (names, comma-separated)<input className={field} value={form.hosts} onChange={(e) => setForm({ ...form, hosts: e.target.value })} placeholder="A team room's manager is host automatically" /></label>
            <label className="text-sm font-semibold">Host code (for a host who isn't in TMS)<input className={field} value={form.host_code} onChange={(e) => setForm({ ...form, host_code: e.target.value })} placeholder="optional" /></label>
            {/* SCHEDULE: when the room is open. Outside it, people who tap Join are told when the
                next meeting is (Neal, 2026-10-04). Leave it all empty for an always-open room. */}
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 sm:col-span-2">
              <div className="text-sm font-bold">When it meets <span className="font-normal text-slate-500">(Eastern time; leave empty for always open)</span></div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">Repeats on</span>
                {DOW.map((d, i) => (
                  <label key={d} className={`cursor-pointer rounded border px-2 py-1 ${(form.days || []).includes(i) ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white'}`}>
                    <input type="checkbox" className="hidden" checked={(form.days || []).includes(i)} onChange={(e) => setForm({ ...form, days: e.target.checked ? [...(form.days || []), i].sort() : (form.days || []).filter((x) => x !== i) })} />{d}
                  </label>
                ))}
                <span className="ml-2 font-semibold">at</span><input type="time" value={form.time || ''} onChange={(e) => setForm({ ...form, time: e.target.value })} className="rounded border border-slate-300 px-2 py-1" />
                <span className="ml-2 font-semibold">for</span><input type="number" min="10" max="600" value={form.minutes || 60} onChange={(e) => setForm({ ...form, minutes: e.target.value })} className="w-20 rounded border border-slate-300 px-2 py-1" /> min
              </div>
              <div className="mt-3 text-sm">
                <span className="font-semibold">One-time meetings</span> <span className="text-slate-500">(e.g. a company meeting)</span>
                {(form.once || []).map((o, i) => (
                  <div key={i} className="mt-1 flex items-center gap-2">
                    <input type="datetime-local" value={o} onChange={(e) => setForm({ ...form, once: form.once.map((x, j) => (j === i ? e.target.value : x)) })} className="rounded border border-slate-300 px-2 py-1" />
                    <button onClick={() => setForm({ ...form, once: form.once.filter((_, j) => j !== i) })} className="text-xs text-red-600">remove</button>
                  </div>
                ))}
                <button onClick={() => setForm({ ...form, once: [...(form.once || []), ''] })} className="mt-1 block text-sm font-semibold text-blue-700">+ Add a date</button>
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
        {!rooms.length && !err && <p className="text-sm text-slate-500">No rooms yet. Press <b>+ New room</b>.</p>}
        {rooms.map((r) => (
          <div key={r.slug} draggable onDragStart={() => setDragging(r.slug)} onDragEnd={() => setDragging(null)}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); dropOn(r.slug) }}
            className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" style={{ borderLeft: `6px solid ${r.color || '#334155'}`, opacity: dragging === r.slug ? 0.4 : 1, outline: dragging && dragging !== r.slug ? '2px dashed #cbd5e1' : 'none' }}>
            <div className="flex flex-wrap items-center gap-3">
              <span title="Drag to reorder" className="cursor-grab select-none text-xl text-slate-400">⠿</span>
              {r.badge && <img src={r.badge} alt="" className="h-10 w-10 object-contain" />}
              <div className="min-w-0 flex-1">
                <div className="text-lg font-bold">{r.team && <span style={{ color: r.color }} className="mr-2">{r.team}</span>}{r.title}</div>
                <div className="text-xs text-slate-500">{KINDS.find(([k]) => k === r.kind)?.[1]}{r.schedule ? ` · ${r.schedule}` : ''}{r.scheduled ? (r.next_at ? ` · next: ${nextLabel(r.next_at)}` : ' · nothing scheduled') : ' · always open'}{r.public ? ' · open to the public' : ''}{r.topic ? ` · "${r.topic}"` : ''}</div>
              </div>
              <a href={`/meet/${r.slug}`} target="_blank" rel="noreferrer" className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-bold text-white">Join as host</a>
              <button onClick={() => copy(`${site}/meet/${r.slug}`)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold">{r.public ? '📋 Copy invite link' : 'Copy host link'}</button>
              <button onClick={() => setForm({ ...blank, ...r, hosts: (r.hosts || []).join(', '), original_slug: r.slug })} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold">Edit</button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              {/* A public room (the devotional) is for people OUTSIDE the company: its people are the
                  ones who signed in with name + email, not the TMS roster (Neal, 2026-10-04). */}
              {r.kind !== 'custom' && !r.public && <button onClick={() => show(r.slug, 'people')} className="rounded border border-slate-300 px-3 py-1 font-semibold">👥 People & links</button>}
              {r.kind !== 'custom' && !r.public && <button onClick={() => sendLinks(r)} className="rounded border border-emerald-400 bg-emerald-50 px-3 py-1 font-semibold text-emerald-800">📨 Send everyone their link</button>}
              <button onClick={() => show(r.slug, 'attendance')} className="rounded border border-slate-300 px-3 py-1 font-semibold">✅ Attendance</button>
              {r.public && <button onClick={() => show(r.slug, 'guests')} className="rounded border border-slate-300 px-3 py-1 font-semibold">👥 People who signed in (email list)</button>}
              {r.recording_enabled && <button onClick={() => show(r.slug, 'recordings')} className="rounded border border-slate-300 px-3 py-1 font-semibold">🎞 Recordings</button>}
              {r.recording_enabled && r.rec_key && <button onClick={() => copy(`${site}/recordings/${r.slug}?k=${r.rec_key}`)} className="rounded border border-slate-300 px-3 py-1 font-semibold">🔗 Copy recordings page link</button>}
              {r.public && <button onClick={() => (mail?.slug === r.slug ? setMail(null) : openMail(r))} className="rounded border border-blue-400 bg-blue-50 px-3 py-1 font-semibold text-blue-800">✉️ Email the list</button>}
              <span className="flex-1" />
              <button onClick={async () => { if (window.confirm(`Delete "${r.title}"? Links to it stop working.`)) { await call({ action: 'delete_room', slug: r.slug }); load() } }} className="text-xs text-red-600">Delete</button>
            </div>

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
                {!open.data ? 'Loading…' : open.data.error ? <span className="text-red-700">{open.data.error}</span> : open.tab === 'people' ? (
                  <table className="w-full">
                    <thead><tr className="text-left text-slate-500"><th>Name</th><th>Their link</th></tr></thead>
                    <tbody>{open.data.people.map((p) => (
                      <tr key={p.id} className="border-t border-slate-200"><td className="py-1 font-semibold">{p.name}{p.host ? ' · host' : ''}</td>
                        <td><button onClick={() => copy(p.link)} className="text-blue-700 underline">Copy link</button></td></tr>
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
        ))}
      </div>
    </div>
  )
}
