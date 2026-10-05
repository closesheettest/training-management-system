// Host panel for 📖 Scripture: type the passage, pick the translation (NIV default), paste or
// auto-fill the verses, Share / Stop sharing, step verse by verse.
import { useState } from 'react'
import { VERSIONS, versionOf, fetchPassage, splitPasted } from './Scripture.jsx'

export default function ScripturePanel({ current, onSet, onClose, layoutPick = null }) {
  const [ref, setRef] = useState(current?.ref || '')
  const [version, setVersion] = useState(current?.version || 'NIV')
  const [pasted, setPasted] = useState('')
  const [mode, setMode] = useState(current?.mode || 'verse')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const v = versionOf(version)
  const showing = !!current?.showing

  const share = async () => {
    setErr(''); if (!ref.trim()) { setErr('Type the passage, e.g. Psalm 23:1-6'); return }
    setBusy(true)
    try {
      // Pasted verses win if there are any; otherwise look it up (every translation now).
      let passage
      const verses = pasted.trim() ? splitPasted(pasted) : []
      if (verses.length) passage = { ref: ref.trim(), verses }
      else passage = await fetchPassage(ref, version)
      await onSet({ ...passage, version, idx: 0, mode, showing: true })
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  const step = (d) => current && onSet({ ...current, idx: Math.max(0, Math.min(current.verses.length - 1, (current.idx || 0) + d)) })

  const box = { position: 'absolute', top: 8, left: 12, zIndex: 60, width: 360, maxHeight: '80vh', overflow: 'auto', background: '#111827', border: '1px solid #B8893D', borderRadius: 12, padding: 12, color: '#e5e7eb', fontSize: 14 }
  const inp = { width: '100%', padding: '7px 9px', borderRadius: 8, border: '1px solid #374151', background: '#0b1220', color: '#fff', fontSize: 14, marginTop: 4, marginBottom: 8, boxSizing: 'border-box' }
  const btn = (bg) => ({ padding: '8px 12px', borderRadius: 8, border: 'none', background: bg, color: '#fff', fontWeight: 800, cursor: 'pointer' })
  return (
    <div style={box}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <b style={{ flex: 1 }}>📖 Scripture</b>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: 18, cursor: 'pointer' }}>×</button>
      </div>
      {layoutPick}
      {showing ? (
        <>
          <div style={{ fontWeight: 800, marginBottom: 4 }}>{current.ref} · {current.version}</div>
          <div style={{ fontSize: 12.5, color: '#94a3b8', marginBottom: 8 }}>{current.mode === 'all' ? 'Whole passage on screen' : `Verse ${(current.idx || 0) + 1} of ${current.verses.length}`}</div>
          {current.mode !== 'all' && current.verses.length > 1 && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button onClick={() => step(-1)} style={{ ...btn('#1f2937'), flex: 1 }}>◀ Back</button>
              <button onClick={() => step(1)} style={{ ...btn('#1A4870'), flex: 2 }}>Next verse ▶</button>
            </div>
          )}
          <button onClick={() => onSet({ ...current, mode: current.mode === 'all' ? 'verse' : 'all' })} style={{ ...btn('#1f2937'), width: '100%', marginBottom: 8 }}>{current.mode === 'all' ? 'Show one verse at a time' : 'Show the whole passage'}</button>
          <button onClick={() => onSet({ ...current, showing: false })} style={{ ...btn('#b91c1c'), width: '100%' }}>⏹ Stop sharing scripture</button>
        </>
      ) : (
        <>
          <label>Passage<input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. Psalm 23:1-6" style={inp} /></label>
          <label>Translation<select value={version} onChange={(e) => setVersion(e.target.value)} style={inp}>{VERSIONS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></label>
          {!v.auto && (
            <label><span style={{ fontSize: 12.5, color: '#94a3b8' }}>Fills in by itself. Only if it can't: paste the {v.key} verses here</span><textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={3} placeholder={`Copy the passage from your Bible app (YouVersion, Bible Gateway) and paste it here. Keep the verse numbers.`} style={inp} /></label>
          )}
          <div style={{ display: 'flex', gap: 12, marginBottom: 10, fontSize: 13.5 }}>
            <label><input type="radio" checked={mode === 'verse'} onChange={() => setMode('verse')} /> One verse at a time</label>
            <label><input type="radio" checked={mode === 'all'} onChange={() => setMode('all')} /> Whole passage</label>
          </div>
          <button disabled={busy} onClick={share} style={{ ...btn('#B8893D'), width: '100%' }}>{busy ? 'Loading…' : '📖 Share scripture'}</button>
          {current && current.ref && <button onClick={() => onSet({ ...current, showing: true })} style={{ ...btn('#1f2937'), width: '100%', marginTop: 8 }}>Show {current.ref} again</button>}
        </>
      )}
      {err && <p style={{ color: '#fca5a5', marginTop: 8, fontSize: 13 }}>{err}</p>}
    </div>
  )
}
