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
const KINDS = [['company', 'Company meeting (all reps, trainees & managers)'], ['zone', 'Team room (one zone)'], ['managers', 'Managers'], ['prayer', 'Prayer call'], ['everyone', 'Everyone (all reps)'], ['custom', 'Custom (link only)']]
const blank = { title: '', kind: 'zone', zone: 'Zone 1', schedule: '', topic: '', cameras_required: true, hosts: '', public: false, host_code: '', days: [], time: '', minutes: 60, once: [] }
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
          <div key={r.slug} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" style={{ borderLeft: `6px solid ${r.color || '#334155'}` }}>
            <div className="flex flex-wrap items-center gap-3">
              {r.badge && <img src={r.badge} alt="" className="h-10 w-10 object-contain" />}
              <div className="min-w-0 flex-1">
                <div className="text-lg font-bold">{r.team && <span style={{ color: r.color }} className="mr-2">{r.team}</span>}{r.title}</div>
                <div className="text-xs text-slate-500">{KINDS.find(([k]) => k === r.kind)?.[1]}{r.schedule ? ` · ${r.schedule}` : ''}{r.scheduled ? (r.next_at ? ` · next: ${nextLabel(r.next_at)}` : ' · nothing scheduled') : ' · always open'}{r.public ? ' · open to the public' : ''}{r.topic ? ` · "${r.topic}"` : ''}</div>
              </div>
              <a href={`/meet/${r.slug}`} target="_blank" rel="noreferrer" className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-bold text-white">Join as host</a>
              <button onClick={() => copy(`${site}/meet/${r.slug}`)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold">{r.public ? 'Copy public link' : 'Copy host link'}</button>
              <button onClick={() => setForm({ ...blank, ...r, hosts: (r.hosts || []).join(', '), original_slug: r.slug })} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold">Edit</button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              {r.kind !== 'custom' && <button onClick={() => show(r.slug, 'people')} className="rounded border border-slate-300 px-3 py-1 font-semibold">👥 People & links</button>}
              {r.kind !== 'custom' && <button onClick={() => sendLinks(r)} className="rounded border border-emerald-400 bg-emerald-50 px-3 py-1 font-semibold text-emerald-800">📨 Send everyone their link</button>}
              <button onClick={() => show(r.slug, 'attendance')} className="rounded border border-slate-300 px-3 py-1 font-semibold">✅ Attendance</button>
              {r.public && <button onClick={() => show(r.slug, 'guests')} className="rounded border border-slate-300 px-3 py-1 font-semibold">📧 Guest email list</button>}
              <span className="flex-1" />
              <button onClick={async () => { if (window.confirm(`Delete "${r.title}"? Links to it stop working.`)) { await call({ action: 'delete_room', slug: r.slug }); load() } }} className="text-xs text-red-600">Delete</button>
            </div>

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
                        <tbody>{open.data.people.sort((a, c) => String(a.joins?.[0]?.in).localeCompare(String(c.joins?.[0]?.in))).map((p) => {
                          const mins = Math.round((p.joins || []).reduce((s, j) => s + ((j.out ? Date.parse(j.out) : Date.now()) - Date.parse(j.in)), 0) / 60000)
                          const offs = (p.camera || []).filter((c) => !c.on).length
                          return (
                            <tr key={p.identity} className="border-t border-slate-200"><td className="py-1 font-semibold">{p.name}</td><td>{t(p.joins?.[0]?.in)}</td>
                              <td>{(p.joins || []).some((j) => !j.out) ? <span className="text-emerald-700">still in</span> : t(p.joins?.[p.joins.length - 1]?.out)}</td><td>{mins}</td><td>{offs ? `${offs}×` : ''}</td></tr>
                          )
                        })}</tbody>
                      </table>
                    )}
                  </>
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
