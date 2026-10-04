// 🏢 COMPANY LOBBY (Neal, 2026-10-04): a trainee who has finished their onboarding paperwork before
// class starts lands here instead of a "no class right now" screen — a full-screen slideshow that
// plays on its own and sells them on U.S. Shingle & Metal, with a countdown, and it lets them into
// class by itself when the room opens.
//
// ONLY CONFIRMED FACTS go in SLIDES (website + the company deck). Add Neal's numbers, photos, the
// manufacturing slide and real Google reviews as he confirms them.
import { useEffect, useState } from 'react'

export const SLIDES = [
  { kicker: 'Welcome to the team', big: 'U.S. Shingle & Metal', sub: "You're joining one of Florida's fastest-growing roofing companies.", logo: true },
  { kicker: 'Experience', big: '15 Years', sub: 'Protecting Florida homes and businesses for 15 years.' },
  { kicker: 'Who we are', big: 'Veteran-Owned', sub: 'Built on discipline, integrity and doing the job right.' },
  { kicker: 'What customers say', big: '★★★★★', sub: '5-star rated on Google by the homeowners we serve.' },
  { kicker: 'Licensed & insured', big: 'CCC1331960', sub: 'Florida Certified Roofing Contractor, fully licensed and insured.' },
  { kicker: 'Statewide', big: 'All of Florida', sub: 'Headquartered in Clearwater, serving communities across the state.' },
  { kicker: 'Trusted', big: 'Third-Party Vetted', sub: 'Approved by a national finance company, so homeowners can say yes.' },
  { kicker: 'Your future', big: 'Your Career Starts Today', sub: 'Skills and tools can be taught. Effort is the one thing you bring. Bring it every day.' },
]

const fmt = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })

export default function CompanyLobby({ title, nextAt, first, onCheck }) {
  const [i, setI] = useState(0)
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setI((x) => (x + 1) % SLIDES.length), 7000); return () => clearInterval(t) }, [])
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  // Let them in as soon as the room opens (15 min before start) — ask every 30 seconds.
  useEffect(() => { const t = setInterval(() => onCheck?.(), 30000); return () => clearInterval(t) }, [onCheck])
  const s = SLIDES[i]
  const left = nextAt ? Math.max(0, Date.parse(nextAt) - 15 * 60000 - now) : null
  const mm = left != null ? Math.floor(left / 60000) : null
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'radial-gradient(circle at 30% 20%, #16305c 0%, #0b1426 60%, #060b16 100%)', color: '#fff', display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, sans-serif', overflow: 'hidden' }}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;700&display=swap" />
      <style>{'@keyframes lobbyIn{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}'}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px' }}>
        <div style={{ background: '#fff', borderRadius: 10, padding: '4px 10px' }}><img src="/uss-logo.png" alt="U.S. Shingle & Metal" style={{ height: 38, display: 'block' }} /></div>
        <div style={{ fontSize: 14, color: '#9fb0c8', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }}>{first ? `Welcome, ${first}` : 'Welcome'} · {title}</div>
      </div>
      <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '0 6%', animation: 'lobbyIn .8s ease' }}>
        {s.logo && <div style={{ background: '#fff', borderRadius: 18, padding: '16px 28px', marginBottom: 28, boxShadow: '0 20px 60px rgba(0,0,0,.45)' }}><img src="/uss-logo.png" alt="" style={{ height: 'clamp(90px, 16vh, 170px)', display: 'block' }} /></div>}
        <div style={{ fontSize: 'clamp(14px, 1.8vw, 20px)', letterSpacing: '.3em', textTransform: 'uppercase', color: '#f87171', fontWeight: 800 }}>{s.kicker}</div>
        <div style={{ fontFamily: "'Oswald', 'Arial Narrow', sans-serif", fontSize: s.logo ? 'clamp(34px, 6vw, 72px)' : 'clamp(48px, 10vw, 128px)', fontWeight: 700, lineHeight: 1.02, margin: '10px 0 18px', textShadow: '0 6px 30px rgba(0,0,0,.5)' }}>{s.big}</div>
        <div style={{ fontSize: 'clamp(18px, 2.4vw, 30px)', color: '#dbe4f3', maxWidth: 900, lineHeight: 1.35 }}>{s.sub}</div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 12 }}>
        {SLIDES.map((_, k) => <span key={k} style={{ width: k === i ? 26 : 8, height: 8, borderRadius: 99, background: k === i ? '#f87171' : 'rgba(255,255,255,.3)', transition: 'all .4s' }} />)}
      </div>
      <div style={{ background: 'rgba(200,16,46,.95)', padding: '12px 16px', textAlign: 'center', fontWeight: 800, fontSize: 'clamp(14px, 1.8vw, 18px)' }}>
        ✅ Your paperwork is done.{' '}
        {nextAt ? (left > 0 ? <>Training starts at <b>{fmt(nextAt)}</b>. The doors open in <b>{mm} min</b> and you'll be let in automatically.</> : <>Opening now…</>) : <>You'll be let in automatically when training starts.</>}
      </div>
    </div>
  )
}
