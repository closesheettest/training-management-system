// ONE SIGN-IN (Neal, 2026-10-09: "a pin just to get in and you have access to all the stuff you have access to").
// Every admin page's server check goes through here and accepts EITHER the training-site admin PIN (CCG
// regional-admin-pin) OR the person's My Tools sign-in, sent as "mt:<base64 {name, pin}>" (checked with CCG; never
// sets a passcode). Returns the same shape regional-admin-pin did: { valid, name }.
const PIN_URL = 'https://free-roof-inspections.netlify.app/.netlify/functions/regional-admin-pin'
const MT_URL = 'https://free-roof-inspections.netlify.app/.netlify/functions/manager-dashboard'

export async function adminVerify(pin) {
  const p = String(pin || '').trim()
  if (!p) return { valid: false, name: null }
  if (p.startsWith('mt:')) {
    try {
      const mt = JSON.parse(decodeURIComponent(Buffer.from(p.slice(3), 'base64').toString('utf8')))
      const nm = String(mt?.name || '').trim().slice(0, 60), pw = String(mt?.pin || '').trim()
      if (!nm || !pw) return { valid: false, name: null }
      const has = await fetch(`${MT_URL}?manager=${encodeURIComponent(nm)}`).then((r) => r.json()).catch(() => ({}))
      if (!has.pin_set) return { valid: false, name: null }
      const ok = await fetch(MT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'auth', manager: nm, pin: pw }) }).then((r) => r.json()).catch(() => ({}))
      return ok.ok ? { valid: true, name: nm } : { valid: false, name: null }
    } catch { return { valid: false, name: null } }
  }
  const v = await fetch(PIN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'verify', pin: p }) }).then((r) => r.json()).catch(() => ({}))
  return { valid: !!v.valid, name: v.name || null }
}
