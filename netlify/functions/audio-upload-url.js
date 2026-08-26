// netlify/functions/audio-upload-url.js
//
// Hands the browser a SIGNED UPLOAD URL so a big file can go straight to
// Supabase Storage. It cannot be routed through this function: Netlify caps a
// function payload at ~6 MB and the presentation audio is 25 MB, so anything
// that "uploads to the server" would fail at about a fifth of the file.
//
// Creates the bucket on first use (public — the link goes out in a text message
// and has to work without a login or an expiring token).
//
//   POST { filename }            → { ok, path, token, publicUrl }
//   GET  ?list=1                 → what's already in the bucket
//
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY

import { createClient } from '@supabase/supabase-js'

const BUCKET = 'training-audio'
const ALLOWED = /\.(mp3|m4a|wav|aac)$/i

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return cors(200, '')
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) return cors(500, JSON.stringify({ ok: false, error: 'Server is missing its Supabase key.' }))
  const supabase = createClient(url, key)

  // Make sure the bucket exists and is public.
  try {
    const { data: buckets } = await supabase.storage.listBuckets()
    if (!(buckets || []).some((b) => b.name === BUCKET)) {
      await supabase.storage.createBucket(BUCKET, { public: true, fileSizeLimit: '200MB' })
    }
  } catch { /* if it already exists, carry on */ }

  if (event.httpMethod === 'GET') {
    const { data, error } = await supabase.storage.from(BUCKET).list('', { limit: 50, sortBy: { column: 'created_at', order: 'desc' } })
    if (error) return cors(500, JSON.stringify({ ok: false, error: error.message }))
    return cors(200, JSON.stringify({
      ok: true,
      files: (data || []).map((f) => ({
        name: f.name,
        size_mb: f.metadata?.size ? +(f.metadata.size / 1048576).toFixed(1) : null,
        url: `${url}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(f.name)}`,
      })),
    }))
  }

  if (event.httpMethod !== 'POST') return cors(405, JSON.stringify({ ok: false, error: 'POST only' }))

  let body = {}
  try { body = JSON.parse(event.body || '{}') } catch { return cors(400, JSON.stringify({ ok: false, error: 'bad JSON' })) }

  // Normalise the name. A space becomes %20 in the link, which breaks in some
  // text-message clients — so spaces are stripped here rather than trusted to
  // whoever picked the file.
  const raw = String(body.filename || '').trim()
  if (!ALLOWED.test(raw)) return cors(400, JSON.stringify({ ok: false, error: 'Audio files only (.mp3, .m4a, .wav, .aac).' }))
  const path = raw.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true })
  if (error) return cors(500, JSON.stringify({ ok: false, error: error.message }))

  return cors(200, JSON.stringify({
    ok: true, path, token: data.token, bucket: BUCKET,
    publicUrl: `${url}/storage/v1/object/public/${BUCKET}/${path}`,
  }))
}

function cors(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }, body }
}
