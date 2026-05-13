// Shared helper: look up SMS recipients for a specific notification event.
// Reads notification_recipients.subscribed_events first; falls back to the
// legacy role-based query (and finally to the ADMIN_PHONE env var) so older
// deployments and recipients without subscriptions still receive their texts.

function normalizePhone(raw) {
  if (!raw) return null
  const digits = String(raw).replace(/\D/g, '')
  if (!digits) return null
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return raw.startsWith('+') ? raw : null
}

export async function recipientPhonesForEvent(supabase, eventKey, { legacyRole } = {}) {
  // 1. Subscription-based lookup.
  const { data: subscribed } = await supabase
    .from('notification_recipients')
    .select('phone, subscribed_events')
    .eq('active', true)
    .contains('subscribed_events', [eventKey])
    .not('phone', 'is', null)

  const subscribedPhones = (subscribed || []).map((r) => normalizePhone(r.phone)).filter(Boolean)
  if (subscribedPhones.length > 0) {
    return { phones: subscribedPhones, source: 'subscription' }
  }

  // 2. Legacy role fallback (so existing deployments keep working pre-backfill).
  if (legacyRole) {
    const { data: byRole } = await supabase
      .from('notification_recipients')
      .select('phone')
      .eq('active', true)
      .eq('role', legacyRole)
      .not('phone', 'is', null)
    const rolePhones = (byRole || []).map((r) => normalizePhone(r.phone)).filter(Boolean)
    if (rolePhones.length > 0) {
      return { phones: rolePhones, source: `role:${legacyRole}` }
    }
  }

  // 3. Final fallback: ADMIN_PHONE env var.
  const env = normalizePhone(process.env.ADMIN_PHONE)
  return env ? { phones: [env], source: 'ADMIN_PHONE env var' } : { phones: [], source: null }
}
