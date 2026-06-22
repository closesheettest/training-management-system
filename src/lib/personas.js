// Persona / role-based nav personalization.
//
// IMPORTANT: this is UX personalization, NOT authentication. Anyone
// who knows a URL can still navigate directly to a page. The persona
// just decides which nav items show up by default.
//
// Page registry — every top-nav-visible page in the app. The `key`
// field is what role_settings.visible_page_keys stores; if you add a
// new page, add it here AND update the Personas admin page to expose
// the checkbox for it.

export const PAGES = [
  { key: 'home', label: 'Home', path: '/', menu: 'top' },
  { key: 'schedule', label: 'Schedule', path: '/calendar', menu: 'top' },
  { key: 'attendance', label: 'Attendance', path: '/attendance', menu: 'top' },
  { key: 'homework', label: 'Homework', path: '/homework', menu: 'top' },
  { key: 'progress', label: 'Progress', path: '/progress', menu: 'top' },
  { key: 'provisioning', label: 'Provisioning', path: '/provisioning', menu: 'top' },
  { key: 'setup.manager', label: 'Hiring Manager', path: '/manager', menu: 'setup' },
  { key: 'setup.locations', label: 'Locations', path: '/locations', menu: 'setup' },
  { key: 'setup.hotels', label: 'Hotels', path: '/hotels', menu: 'setup' },
  { key: 'setup.welcome_links', label: 'Welcome page links', path: '/welcome-links', menu: 'setup' },
  { key: 'setup.questions', label: 'Questions', path: '/questions', menu: 'setup' },
  { key: 'setup.testimonials', label: 'Testimonials', path: '/testimonials', menu: 'setup' },
  { key: 'setup.training_week', label: 'Training Week', path: '/training-week', menu: 'setup' },
  { key: 'setup.field_trainee', label: 'Field Trainee', path: '/field-trainee', menu: 'setup' },
  { key: 'settings.messages', label: 'Messages', path: '/messages', menu: 'settings' },
  { key: 'settings.notifications', label: 'Notifications', path: '/notifications', menu: 'settings' },
  { key: 'settings.templates', label: 'Message templates', path: '/message-templates', menu: 'settings' },
  { key: 'settings.handoff', label: 'Handoff contacts', path: '/handoff-contacts', menu: 'settings' },
  { key: 'settings.personas', label: 'Personas', path: '/personas', menu: 'settings' },
  { key: 'settings.active_reps', label: 'Active sales reps', path: '/active-reps', menu: 'team' },
  { key: 'settings.offboarding', label: 'Offboarding reps', path: '/offboarding', menu: 'team' },
  { key: 'team.map', label: 'Sales team map', path: '/rep-map', menu: 'team' },
  { key: 'team.regions', label: 'Zones', path: '/regions', menu: 'team' },
  { key: 'settings.group_messages', label: 'Group messages', path: '/group-messages', menu: 'team' },
  { key: 'settings.hosted_pages', label: 'Hosted pages', path: '/hosted-pages', menu: 'settings' },
  { key: 'settings.training_itinerary', label: 'Training Itinerary', href: '/training-itinerary/', external: true, menu: 'settings' },
  { key: 'settings.overview', label: 'System Overview', href: '/system-overview.html', external: true, menu: 'settings' },
]

// Roles + display labels. Must include every value used in
// notification_recipients.role.
export const ROLES = [
  { value: 'admin', label: 'Admin' },
  { value: 'hiring_manager', label: 'Hiring Manager' },
  { value: 'it', label: 'IT' },
  { value: 'hr', label: 'HR' },
  { value: 'trainer', label: 'Corporate Trainer' },
  { value: 'va', label: 'Virtual Assistant' },
  { value: 'test', label: 'Test' },
  { value: 'custom', label: 'Custom' },
]

// Fallback visibility per role, used only if the role isn't seeded in
// role_settings (e.g. legacy data or a brand-new role). Matches the
// seed in the migration. '*' means "see everything".
export const ROLE_DEFAULTS = {
  admin: ['*'],
  hiring_manager: ['home', 'schedule', 'setup.manager', 'setup.hotels', 'settings.overview'],
  it: ['home', 'provisioning', 'settings.overview'],
  // HR co-owns the persona config alongside admin — they shape who sees what.
  hr: ['home', 'schedule', 'setup.hotels', 'setup.welcome_links', 'settings.notifications', 'settings.personas', 'settings.group_messages', 'settings.active_reps', 'settings.offboarding', 'team.map', 'team.regions', 'settings.overview'],
  va: ['home', 'settings.overview'],
  trainer: ['home', 'schedule', 'attendance', 'homework', 'setup.questions', 'settings.messages', 'settings.overview'],
  test: ['*'],
  custom: ['home', 'settings.overview'],
}

// Pages everyone can always see, regardless of role config. Keeps the
// app from getting into a state where someone has no nav at all.
// Only home — Personas is toggleable like every other page and defaults
// to admin + HR only.
export const ALWAYS_VISIBLE = new Set(['home'])

// LocalStorage key for the currently-selected persona's recipient id.
export const PERSONA_STORAGE_KEY = 'tms_persona_id'

// Returns the set of visible page keys for a given role + its
// role_settings row (or null). Handles the '*' wildcard and the
// always-visible set.
export function computeVisible(role, visiblePageKeys) {
  if (visiblePageKeys && visiblePageKeys.includes('*')) {
    return new Set(PAGES.map((p) => p.key))
  }
  const fromConfig = visiblePageKeys && visiblePageKeys.length > 0
    ? visiblePageKeys
    : (ROLE_DEFAULTS[role] || ROLE_DEFAULTS.custom)
  if (fromConfig.includes('*')) {
    return new Set(PAGES.map((p) => p.key))
  }
  const out = new Set(fromConfig)
  for (const k of ALWAYS_VISIBLE) out.add(k)
  return out
}

export function getStoredPersonaId() {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(PERSONA_STORAGE_KEY) || null
  } catch {
    return null
  }
}

export function setStoredPersonaId(id) {
  if (typeof window === 'undefined') return
  try {
    if (id) window.localStorage.setItem(PERSONA_STORAGE_KEY, id)
    else window.localStorage.removeItem(PERSONA_STORAGE_KEY)
  } catch {
    // ignore
  }
}

export function roleLabel(value) {
  return ROLES.find((r) => r.value === value)?.label || value || 'Unknown'
}
