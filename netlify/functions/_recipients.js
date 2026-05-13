// Shared helper: look up notification recipients for a specific event.
// Returns full recipient records (id, name, phone, email, notify_via_sms,
// notify_via_email) so callers can route by channel. Falls back to legacy
// role-based lookup, then to ADMIN_PHONE env var, so existing deployments
// continue to work.

function normalizePhone(raw) {
  if (!raw) return null
  const digits = String(raw).replace(/\D/g, '')
  if (!digits) return null
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return raw.startsWith('+') ? raw : null
}

// Returns full recipient objects subscribed to the given event.
export async function recipientsForEvent(supabase, eventKey, { legacyRole } = {}) {
  // 1. Subscription-based lookup.
  const { data: subscribed } = await supabase
    .from('notification_recipients')
    .select('id, name, phone, email, notify_via_sms, notify_via_email')
    .eq('active', true)
    .contains('subscribed_events', [eventKey])

  let pool = (subscribed || []).map(normalizeRecipient)
  if (pool.length > 0) {
    return { recipients: pool, source: 'subscription' }
  }

  // 2. Legacy role fallback.
  if (legacyRole) {
    const { data: byRole } = await supabase
      .from('notification_recipients')
      .select('id, name, phone, email, notify_via_sms, notify_via_email')
      .eq('active', true)
      .eq('role', legacyRole)
    pool = (byRole || []).map(normalizeRecipient)
    if (pool.length > 0) {
      return { recipients: pool, source: `role:${legacyRole}` }
    }
  }

  // 3. ADMIN_PHONE env var fallback (SMS only).
  const envPhone = normalizePhone(process.env.ADMIN_PHONE)
  if (envPhone) {
    return {
      recipients: [
        {
          id: 'env',
          name: 'ADMIN_PHONE env var',
          phone: envPhone,
          email: null,
          notify_via_sms: true,
          notify_via_email: false,
        },
      ],
      source: 'ADMIN_PHONE env var',
    }
  }

  return { recipients: [], source: null }
}

function normalizeRecipient(r) {
  return {
    id: r.id,
    name: r.name,
    phone: normalizePhone(r.phone),
    email: (r.email || '').trim() || null,
    notify_via_sms: r.notify_via_sms !== false, // default true if column missing
    notify_via_email: r.notify_via_email !== false,
  }
}

// Backward-compat: returns just phone numbers (for callers that haven't been
// updated to use recipientsForEvent yet). Honors the channel toggle.
export async function recipientPhonesForEvent(supabase, eventKey, opts) {
  const { recipients, source } = await recipientsForEvent(supabase, eventKey, opts)
  const phones = recipients
    .filter((r) => r.notify_via_sms && r.phone)
    .map((r) => r.phone)
  return { phones, source }
}
