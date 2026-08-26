import { useEffect, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

// Upload page for training audio (the full presentation, and anything like it).
//
// The file goes browser → Supabase Storage DIRECTLY, using a one-time signed
// URL from audio-upload-url. It deliberately does not pass through a Netlify
// function: those cap out around 6 MB and the presentation is 25 MB.

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
)

export default function UploadAudio() {
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [pct, setPct] = useState(0)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(null)
  const inputRef = useRef(null)

  const refresh = async () => {
    try {
      const r = await fetch('/.netlify/functions/audio-upload-url?list=1')
      const j = await r.json()
      if (j.ok) setFiles(j.files || [])
    } catch { /* leave the list as it was */ }
  }
  useEffect(() => { refresh() }, [])
  // Name the tab. Fifteen tabs all reading "training-management-system" is
  // unusable, so every page says what it is.
  useEffect(() => { document.title = 'Upload training audio' }, [])

  const upload = async (file) => {
    if (!file) return
    setErr(''); setDone(null); setBusy(true); setPct(0)
    try {
      const r = await fetch('/.netlify/functions/audio-upload-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name }),
      })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error || 'Could not start the upload.')

      // uploadToSignedUrl streams the whole file straight to Storage.
      const { error } = await supabase.storage
        .from(j.bucket)
        .uploadToSignedUrl(j.path, j.token, file, { contentType: file.type || 'audio/mpeg', upsert: true })
      if (error) throw new Error(error.message)

      setPct(100)
      setDone({ name: j.path, url: j.publicUrl })
      await refresh()
    } catch (e) {
      setErr(e.message || 'Upload failed.')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div style={{ maxWidth: 620, margin: '0 auto', padding: '32px 20px 60px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0f172a', margin: '0 0 6px' }}>Training audio</h1>
      <p style={{ color: '#64748b', fontSize: 15, margin: '0 0 24px', lineHeight: 1.5 }}>
        Upload the recording here. It gets a permanent link that works in a text message —
        no login, nothing that expires.
      </p>

      <label
        style={{
          display: 'block', border: '2px dashed #cbd5e1', borderRadius: 14, padding: '30px 20px',
          textAlign: 'center', cursor: busy ? 'default' : 'pointer', background: busy ? '#f8fafc' : '#fff',
        }}
        onDragOver={(e) => { e.preventDefault() }}
        onDrop={(e) => { e.preventDefault(); if (!busy) upload(e.dataTransfer.files?.[0]) }}
      >
        <input
          ref={inputRef} type="file" accept="audio/*,.mp3,.m4a,.wav,.aac" disabled={busy}
          onChange={(e) => upload(e.target.files?.[0])} style={{ display: 'none' }}
        />
        <div style={{ fontSize: 34, marginBottom: 8 }}>{busy ? '⏳' : '🎧'}</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
          {busy ? `Uploading… ${pct}%` : 'Choose an audio file'}
        </div>
        <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>
          {busy ? 'Keep this page open until it finishes.' : 'or drag it here — MP3, M4A, WAV, AAC'}
        </div>
      </label>

      {err && (
        <div style={{ marginTop: 16, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 10, padding: '12px 14px', fontSize: 14 }}>
          {err}
        </div>
      )}

      {done && (
        <div style={{ marginTop: 16, background: '#ecfdf5', border: '1px solid #6ee7b7', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ fontWeight: 800, color: '#047857', fontSize: 14, marginBottom: 6 }}>✅ Uploaded — {done.name}</div>
          <audio controls src={done.url} style={{ width: '100%', marginBottom: 10 }} />
          <div style={{ fontSize: 12, color: '#065f46', wordBreak: 'break-all', background: '#fff', borderRadius: 8, padding: '8px 10px' }}>{done.url}</div>
          <button
            onClick={() => navigator.clipboard?.writeText(done.url)}
            style={{ marginTop: 10, background: '#047857', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
          >Copy link</button>
        </div>
      )}

      {files.length > 0 && (
        <div style={{ marginTop: 30 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#94a3b8', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 10 }}>Already uploaded</div>
          {files.map((f) => (
            <div key={f.name} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px', marginBottom: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>
                {f.name} {f.size_mb != null && <span style={{ color: '#94a3b8', fontWeight: 500 }}>· {f.size_mb} MB</span>}
              </div>
              <audio controls src={f.url} style={{ width: '100%', marginTop: 8 }} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
