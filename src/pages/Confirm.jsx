import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { formatDateLong } from '../lib/dates.js'
import { useTimetable, SIGNOFF } from '../lib/schedule.js'

// All training now happens here — one fixed venue.
const VENUE = {
  name: 'Training Suite',
  address: '6698 68th Ave N, Pinellas Park, FL 33781',
}
const DIRECTIONS = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(VENUE.address)}`

// Timetable lives in src/lib/schedule.js — shared with the class page.

export default function Confirm() {
  const { token } = useParams()
  const [sp] = useSearchParams()
  const isPreview = token === 'preview'
  const [status, setStatus] = useState('loading') // loading | not_found | choose | saving | done
  const [trainee, setTrainee] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [errorMsg, setErrorMsg] = useState(null)

  // Which week this confirmation is for. The send link sets ?week=A|B; otherwise
  // infer B once they've done Week A (attended in the prior week), else A.
  const weekParam = (sp.get('week') || '').toUpperCase()
  const week = useMemo(() => {
    if (weekParam === 'A' || weekParam === 'B') return weekParam
    return 'A'
  }, [weekParam])
  const timetable = useTimetable()
  const sched = { ...(timetable[week] || timetable.A), signoff: SIGNOFF[week] || SIGNOFF.A }

  useEffect(() => {
    if (isPreview) {
      setTrainee({ first_name: 'Sample' })
      setClassInfo({ week_start_date: mondayForWeek(week) })
      setStatus('choose')
      return
    }
    if (!token) { setStatus('not_found'); return }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  async function load() {
    setStatus('loading')
    const { data, error } = await supabase
      .from('trainees')
      .select('id, first_name, last_name, confirmation_status, confirmation_at, classes!class_id(week_start_date, week_end_date)')
      .eq('registration_token', token)
      .maybeSingle()
    if (error || !data) { setStatus('not_found'); return }
    setTrainee(data)
    setClassInfo(data.classes || null)
    setStatus('choose')
  }

  async function respond(choice) {
    if (isPreview) return
    setErrorMsg(null)
    setStatus('saving')
    const { error } = await supabase
      .from('trainees')
      .update({ confirmation_status: choice, confirmation_at: new Date().toISOString() })
      .eq('registration_token', token)
    if (error) { setErrorMsg(error.message); setStatus('choose'); return }
    setTrainee((prev) => ({ ...prev, confirmation_status: choice, confirmation_at: new Date().toISOString() }))
    setStatus('done')
  }

  if (status === 'loading') return <div style={S.wrap}><p style={{ textAlign: 'center', color: '#64748b', padding: '60px 0' }}>Loading…</p></div>

  if (status === 'not_found') {
    return (
      <div style={S.wrap}>
        <div style={{ ...S.card, textAlign: 'center' }}>
          <div style={{ fontSize: 34 }}>🔗</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0f2a4a', margin: '8px 0 4px' }}>Link not found</h1>
          <p style={{ color: '#475569', fontSize: 14 }}>This link may have expired or been mistyped. Check your text message, or contact your training manager.</p>
        </div>
      </div>
    )
  }

  const choice = trainee?.confirmation_status // 'confirmed' | 'declined' | null
  const startMon = classInfo?.week_start_date ? (week === 'B' ? addDays(classInfo.week_start_date, 7) : classInfo.week_start_date) : mondayForWeek(week)

  return (
    <div style={S.wrap}>
      {isPreview && (
        <div style={{ background: '#7c3aed', color: '#fff', borderRadius: 10, padding: '8px 12px', fontSize: 12.5, fontWeight: 700, textAlign: 'center', marginBottom: 12 }}>
          👀 PREVIEW — this is exactly what a trainee sees. Toggle ?week=A / ?week=B in the URL.
        </div>
      )}

      {/* Hero */}
      <div style={{ ...S.card, background: 'linear-gradient(135deg,#0f2a4a,#173a63)', color: '#fff', textAlign: 'center' }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.13em', textTransform: 'uppercase', color: '#f5b400' }}>U.S. Shingle &amp; Metal · Retail Training</div>
        <h1 style={{ fontSize: 26, fontWeight: 900, margin: '6px 0 2px' }}>
          {choice === 'confirmed' ? `You're all set, ${trainee?.first_name || 'there'}! ✅`
            : `Welcome${trainee?.first_name ? `, ${trainee.first_name}` : ''}!`}
        </h1>
        <div style={{ fontSize: 14.5, color: '#cbd5e1' }}>
          {sched.label} starts <b style={{ color: '#fff' }}>{formatDateLong(startMon)}</b>
        </div>
      </div>

      {/* Location + directions */}
      <div style={S.card}>
        <div style={S.h2}>📍 Where to go</div>
        <div style={{ fontWeight: 800, color: '#0f2a4a', fontSize: 15 }}>{VENUE.name}</div>
        <div style={{ color: '#475569', fontSize: 14, marginTop: 1 }}>{VENUE.address}</div>
        <a href={DIRECTIONS} target="_blank" rel="noreferrer"
          style={{ display: 'inline-block', marginTop: 10, background: '#2563eb', color: '#fff', borderRadius: 10, padding: '10px 16px', fontWeight: 700, fontSize: 14, textDecoration: 'none' }}>
          🧭 Get Directions
        </a>
      </div>

      {/* Schedule */}
      <div style={S.card}>
        <div style={S.h2}>🗓️ Your {sched.label} schedule</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
          {sched.days.map((d) => (
            <div key={d.day} style={{ borderLeft: '3px solid #f5b400', paddingLeft: 12 }}>
              <div style={{ fontWeight: 800, color: '#0f2a4a', fontSize: 14 }}>{d.day}</div>
              {d.blocks.map((b, i) => (
                <div key={i} style={{ color: '#475569', fontSize: 13.5, marginTop: 1 }}>{b}</div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Arrival note */}
      <div style={{ ...S.card, background: '#fffbeb', border: '1px solid #fde68a' }}>
        <div style={{ fontWeight: 800, color: '#92400e', fontSize: 14 }}>⏰ Please arrive 15 minutes early</div>
        <div style={{ color: '#78350f', fontSize: 13.5, marginTop: 3 }}>Our trainers begin on time — arriving early keeps everything smooth. Come ready to participate, ask questions, and learn.</div>
      </div>

      {errorMsg && <div style={{ ...S.card, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 13.5 }}>{errorMsg}</div>}

      {/* Confirm */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ textAlign: 'center', fontWeight: 700, color: '#334155', fontSize: 14 }}>Can you make it Monday?</div>
        <button onClick={() => respond('confirmed')} disabled={status === 'saving' || choice === 'confirmed'}
          style={{ ...S.btn, background: choice === 'confirmed' ? '#dcfce7' : '#16a34a', color: choice === 'confirmed' ? '#166534' : '#fff', border: choice === 'confirmed' ? '2px solid #22c55e' : 'none' }}>
          {choice === 'confirmed' ? "✓ Confirmed — you're on the list" : "✅ Yes, I'll be there"}
        </button>
        <button onClick={() => respond('declined')} disabled={status === 'saving' || choice === 'declined'}
          style={{ ...S.btn, background: choice === 'declined' ? '#fef2f2' : '#fff', color: choice === 'declined' ? '#991b1b' : '#334155', border: `2px solid ${choice === 'declined' ? '#f87171' : '#cbd5e1'}` }}>
          {choice === 'declined' ? "✗ You marked can't make it" : "❌ I can't make it"}
        </button>
        {choice && !isPreview && (
          <p style={{ textAlign: 'center', fontSize: 12, color: '#94a3b8' }}>Changed your mind? Tap the other option.{trainee?.confirmation_at ? ` · ${new Date(trainee.confirmation_at).toLocaleString()}` : ''}</p>
        )}
      </div>

      {/* Sign-off */}
      <div style={{ textAlign: 'center', color: '#64748b', fontSize: 13, paddingTop: 4 }}>
        We look forward to seeing you! <br />
        <b style={{ color: '#0f2a4a' }}>{sched.signoff.name}</b>{sched.signoff.title ? <><br />{sched.signoff.title}</> : null}<br />
        U.S. Shingle &amp; Metal
      </div>
    </div>
  )
}

// Monday of the upcoming/current training week — used only for preview + fallbacks.
function mondayForWeek() {
  const d = new Date()
  const back = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - back + 7) // next Monday
  return d.toISOString().slice(0, 10)
}
function addDays(iso, n) {
  const [y, m, d] = String(iso).split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d)); dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}

const S = {
  wrap: { maxWidth: 520, margin: '0 auto', padding: '8px 0 40px', display: 'flex', flexDirection: 'column', gap: 12 },
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '16px 18px', boxShadow: '0 1px 3px rgba(15,42,74,.06)' },
  h2: { fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: '#64748b', marginBottom: 6 },
  btn: { width: '100%', borderRadius: 12, padding: '15px', fontSize: 16, fontWeight: 800, cursor: 'pointer' },
}
