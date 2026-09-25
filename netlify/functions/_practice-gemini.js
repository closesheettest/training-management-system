// One-use Gemini Live token, shared by the trainer path (practice-token, PIN)
// and the practice-link path (practice-invite, link token). Google's auth_tokens
// call takes uses + expiry times; it rejected a "liveConnectConstraints" block
// (first real run 2026-09-25), so the token is not pinned to a model. It is
// single-use and dies in a minute if no session starts.
export const liveModel = () => process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live'

export async function mintToken(key) {
  const now = Date.now()
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      uses: 1,
      expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
      newSessionExpireTime: new Date(now + 60 * 1000).toISOString(),
    }),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || !d.name) throw new Error(`Gemini refused the token: ${d.error?.message || r.status}`)
  return d.name
}
