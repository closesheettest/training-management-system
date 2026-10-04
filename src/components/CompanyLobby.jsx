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
  { kicker: 'Trusted', big: 'Vetted', sub: 'Approved by a national finance company, so homeowners can say yes.' },
  { kicker: 'What customers say', big: '★★★★★', sub: '5-star rated on Google by the homeowners we serve.' },
  { kicker: 'Statewide', big: 'All of Florida', sub: 'Headquartered in Clearwater, serving communities across the state.' },
  { kicker: 'Your future', big: 'Your Career Starts Today', sub: 'Skills and tools can be taught. Effort is the one thing you bring. Bring it every day.' },
]

const fmt = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })

// Mix the real reviews in: a company fact, a Google review, a past trainee, … (shuffled each visit).
const shuffle = (a) => a.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map((x) => x[1])
function buildDeck(facts, rev) {
  if (!rev?.ok) return facts
  const g = shuffle(rev.reviews || []).map((r) => ({ kind: 'google', quote: r.text, who: r.name, when: r.when }))
  const t = shuffle(rev.trainees || []).slice(0, 8).map((r) => ({ kind: 'trainee', quote: r.text, who: r.name }))
  const f = facts.map((x) => (x.big === '★★★★★' && rev.rating ? { ...x, big: `${rev.rating} ★`, sub: `From ${rev.total} Google reviews by the homeowners we serve.` } : x))
  const out = [f[0]]
  let gi = 0, ti = 0
  for (let k = 1; k < f.length; k++) { out.push(f[k]); if (g[gi]) out.push(g[gi++]); if (t[ti]) out.push(t[ti++]) }
  while (g[gi] || t[ti]) { if (g[gi]) out.push(g[gi++]); if (t[ti]) out.push(t[ti++]) }
  return out
}

export default function CompanyLobby({ title, nextAt, first, onCheck }) {
  const [deck, setDeck] = useState(SLIDES)
  useEffect(() => { fetch('/.netlify/functions/company-reviews').then((r) => r.json()).then((rev) => setDeck(buildDeck(SLIDES, rev))).catch(() => {}) }, [])
  const [i, setI] = useState(0)
  const [now, setNow] = useState(Date.now())
  // Quotes need longer on screen than a one-line fact — at a slow reading pace, up to 45s.
  useEffect(() => { const s0 = deck[i] || {}; const ms = s0.quote ? Math.min(45000, 5000 + s0.quote.length * 75) : 7000; const t = setTimeout(() => setI((x) => (x + 1) % deck.length), ms); return () => clearTimeout(t) }, [i, deck])
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  // Let them in as soon as the room opens (15 min before start) — ask every 30 seconds.
  useEffect(() => { const t = setInterval(() => onCheck?.(), 30000); return () => clearInterval(t) }, [onCheck])
  const s = deck[i] || deck[0]
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
        {s.quote ? (<>
          <div style={{ fontSize: 'clamp(14px, 1.8vw, 20px)', letterSpacing: '.3em', textTransform: 'uppercase', color: s.kind === 'google' ? '#fcd34d' : '#60a5fa', fontWeight: 800 }}>{s.kind === 'google' ? '★★★★★ Google review' : 'From a past trainee'}</div>
          <div style={{ fontSize: s.quote.length > 500 ? 'clamp(16px, 2vw, 25px)' : s.quote.length > 260 ? 'clamp(18px, 2.4vw, 30px)' : 'clamp(22px, 3.2vw, 40px)', lineHeight: 1.4, maxWidth: 1000, margin: '18px 0', fontStyle: 'italic', color: '#f1f5f9' }}>“{s.quote}”</div>
          <div style={{ fontSize: 'clamp(15px, 1.8vw, 22px)', fontWeight: 800, color: '#cbd5e1' }}>— {s.who}{s.kind === 'google' ? `${s.when ? `, ${s.when}` : ''} · Google` : ', past trainee'}</div>
        </>) : <>
        {s.logo && <div style={{ background: '#fff', borderRadius: 18, padding: '16px 28px', marginBottom: 28, boxShadow: '0 20px 60px rgba(0,0,0,.45)' }}><img src="/uss-logo.png" alt="" style={{ height: 'clamp(90px, 16vh, 170px)', display: 'block' }} /></div>}
        <div style={{ fontSize: 'clamp(14px, 1.8vw, 20px)', letterSpacing: '.3em', textTransform: 'uppercase', color: '#f87171', fontWeight: 800 }}>{s.kicker}</div>
        <div style={{ fontFamily: "'Oswald', 'Arial Narrow', sans-serif", fontSize: s.logo ? 'clamp(34px, 6vw, 72px)' : 'clamp(48px, 10vw, 128px)', fontWeight: 700, lineHeight: 1.02, margin: '10px 0 18px', textShadow: '0 6px 30px rgba(0,0,0,.5)' }}>{s.big}</div>
        <div style={{ fontSize: 'clamp(18px, 2.4vw, 30px)', color: '#dbe4f3', maxWidth: 900, lineHeight: 1.35 }}>{s.sub}</div>
        </>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 12 }}>
        {deck.map((_, k) => <span key={k} style={{ width: k === i ? 26 : 8, height: 8, borderRadius: 99, background: k === i ? '#f87171' : 'rgba(255,255,255,.3)', transition: 'all .4s' }} />)}
      </div>
      <div style={{ background: 'rgba(200,16,46,.95)', padding: '12px 16px', textAlign: 'center', fontWeight: 800, fontSize: 'clamp(14px, 1.8vw, 18px)' }}>
        ✅ Your paperwork is done.{' '}
        {nextAt ? (left > 0 ? <>Training starts at <b>{fmt(nextAt)}</b>. The doors open in <b>{mm} min</b> and you'll be let in automatically.</> : <>Opening now…</>) : <>You'll be let in automatically when training starts.</>}
      </div>
    </div>
  )
}
