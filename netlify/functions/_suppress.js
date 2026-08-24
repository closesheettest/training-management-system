// netlify/functions/_suppress.js
//
// NOBODY WHO HAS LEFT THE COMPANY GETS ANOTHER TEXT OR EMAIL.
//
// Forty functions in this codebase send SMS or email and almost none of them
// checked whether the person still works here. An offboarded rep kept receiving
// homework nudges, Monday check-in calls, provisioning chases and group
// broadcasts — from a company they no longer work for (Neal, 2026-08-24).
//
// The check lives HERE, inside the two helpers everything sends through, rather
// than in the forty callers. Patching call sites means patching thirty-nine and
// missing one, and the one you miss is the one that texts an ex-employee at
// seven on a Monday morning.
//
// WHAT COUNTS AS GONE: left_company_at is set. That is the explicit offboarding
// stamp the Offboarding page writes, and clearing it (rehiring) restores them
// automatically with nothing else to remember. Dropped-out trainees are also
// suppressed — they never became reps and should not keep getting class texts.
//
// ESCAPE HATCH: pass { force: true } for a message that MUST go to someone who
// has left — a final paycheck detail, a return-the-iPad chase. Deliberate,
// per-call, and rare.

const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SECRET_KEY || process.env.VITE_SUPABASE_ANON_KEY;

// Phone numbers arrive as "(727) 744-5944", "727-744-5944", "+17277445944".
// Compare on digits only, last 10, or half of these never match.
const digits10 = (v) => {
  const d = String(v || "").replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
};
const lower = (v) => String(v || "").trim().toLowerCase();

// Cached for the life of the function instance — a broadcast to 40 people should
// not be 40 round trips. Short enough that an offboarding takes effect promptly.
let cache = null, cachedAt = 0;
const TTL_MS = 60_000;

async function loadSuppressed() {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;
  const cols = "phone,company_phone,company_number,email,company_email,left_company_at,dropped_out_at";
  const url = `${SB_URL}/rest/v1/trainees?or=(left_company_at.not.is.null,dropped_out_at.not.is.null)&select=${cols}`;
  try {
    const rows = await fetch(url, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } })
      .then((r) => (r.ok ? r.json() : null));
    if (!rows) return cache || { phones: new Set(), emails: new Set() };   // keep the last good list
    const phones = new Set(), emails = new Set();
    for (const t of rows) {
      for (const p of [t.phone, t.company_phone, t.company_number]) { const d = digits10(p); if (d.length === 10) phones.add(d); }
      for (const e of [t.email, t.company_email]) { const v = lower(e); if (v.includes("@")) emails.add(v); }
    }

    // AN ACTIVE RECORD WINS — the same rule the deal boards needed.
    //
    // Seventeen people are in this table twice, sharing a phone and an email.
    // If ONE of those rows is marked departed while the other is a working rep,
    // suppressing on the contact alone silently gags somebody who still works
    // here. Chris Hill and Todd Saylor are exactly that shape, and tombstoning
    // their duplicates would have muted them (Neal, 2026-08-24).
    //
    // So: take back any phone or email that also belongs to a row which has
    // NOT left and has NOT dropped out.
    const liveUrl = `${SB_URL}/rest/v1/trainees?left_company_at=is.null&dropped_out_at=is.null&select=phone,company_phone,company_number,email,company_email`;
    const live = await fetch(liveUrl, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } })
      .then((r) => (r.ok ? r.json() : [])).catch(() => []);
    for (const t of live) {
      for (const p of [t.phone, t.company_phone, t.company_number]) { const d = digits10(p); if (d.length === 10) phones.delete(d); }
      for (const e of [t.email, t.company_email]) { const v = lower(e); if (v.includes("@")) emails.delete(v); }
    }
    cache = { phones, emails }; cachedAt = Date.now();
    return cache;
  } catch {
    // A failed read must NOT open the gates. Reuse the last known list; with no
    // list at all, allow the send — silently swallowing every message because
    // Supabase blinked would be its own outage.
    return cache || { phones: new Set(), emails: new Set() };
  }
}

// → { blocked: boolean, reason?: string }
export async function checkSuppressed(to) {
  if (!to || !SB_URL || !SB_KEY) return { blocked: false };
  const { phones, emails } = await loadSuppressed();
  const asPhone = digits10(to);
  if (asPhone.length === 10 && phones.has(asPhone)) return { blocked: true, reason: "no longer with the company" };
  const asEmail = lower(to);
  if (asEmail.includes("@") && emails.has(asEmail)) return { blocked: true, reason: "no longer with the company" };
  return { blocked: false };
}

// Let an offboarding take effect immediately rather than up to a minute later.
export function clearSuppressCache() { cache = null; cachedAt = 0; }
