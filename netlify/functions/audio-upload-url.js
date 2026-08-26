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
  //
  // Errors here are REPORTED, never swallowed. Hiding a failed createBucket
  // just moves the failure to the upload, where it surfaces as Supabase's
  // "The related resource does not exist" — which tells the person uploading
  // nothing at all about what actually went wrong.
  const ensure = { listed: null, created: null, error: null }
  try {
    const { data: buckets, error: lerr } = await supabase.storage.listBuckets()
    if (lerr) ensure.error = `listBuckets: ${lerr.message}`
    ensure.listed = (buckets || []).map((b) => b.name)
    if (!(buckets || []).some((b) => b.name === BUCKET)) {
      // No fileSizeLimit — asking for one ABOVE the project's global cap makes
      // createBucket fail with "The object exceeded the maximum allowed size",
      // which sounds like a problem with the file being uploaded and isn't.
      // Omitting it inherits the project cap (50 MB; the presentation is 25).
      const { error: cerr } = await supabase.storage.createBucket(BUCKET, { public: true })
      if (cerr && !/already exists/i.test(cerr.message || '')) ensure.error = `createBucket: ${cerr.message}`
      else ensure.created = true
    }
  } catch (e) { ensure.error = `ensureBucket: ${e.message}` }

  if (/^(1|true|yes)$/i.test((event.queryStringParameters || {}).diag || '')) {
    return cors(200, JSON.stringify({ ok: !ensure.error, bucket: BUCKET, ensure, key_kind: (process.env.SUPABASE_SECRET_KEY || '').slice(0, 12) }))
  }
  if (ensure.error) return cors(500, JSON.stringify({ ok: false, error: `Storage isn't set up: ${ensure.error}` }))

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

  if (event.httpMethod === 'DELETE') {
    const name = String((event.queryStringParameters || {}).name || '').trim()
    if (!name) return cors(400, JSON.stringify({ ok: false, error: 'missing name' }))
    const { error } = await supabase.storage.from(BUCKET).remove([name])
    return cors(error ? 500 : 200, JSON.stringify({ ok: !error, removed: name, error: error?.message || null }))
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
  return { statusCode: status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }, body }
}
