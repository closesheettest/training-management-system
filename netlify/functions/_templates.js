// Shared helper for loading + applying message templates.
//
// Templates live in the `message_templates` table so admins can edit
// any text (SMS body OR email subject + body) from the /message-
// templates page without a redeploy. Each template has placeholder
// variables in {curly} that get substituted at send time from a
// dictionary the caller provides.
//
// Lookup is by key (e.g. 'registration_initial', 'itinerary_email').
// If the key is missing from the DB (fresh install, migration not yet
// run, accidentally deleted), we fall back to a hardcoded default so
// the system keeps working.

const FALLBACK_BODIES = {
  registration_initial:
    'Hi {firstName}, you\'re scheduled for training the week of {weekDate} at {locationName}. Please complete your registration here: {link}',
  registration_followup_1:
    'Hi {firstName}, quick reminder — please finish your training registration so we can confirm your spot for the week of {weekDate}: {link}',
  registration_followup_2:
    'Hi {firstName}, final reminder — we need to confirm your spot for training the week of {weekDate}. Please register here today: {link}. If you can\'t attend, please text back so we can give your spot to someone else.',
  itinerary_email:
    'Hello {firstName},\n\nYour training is scheduled for the week of {weekDate} at {locationName}.\n\nSchedule:\n{scheduleDetails}\n\nIf you can\'t attend, please reply to this email.\n\n— {hiringManagerName}',
}

const FALLBACK_SUBJECTS = {
  itinerary_email: 'Your training itinerary — Week of {weekDate} at {locationName}',
}

// Render just the body string with placeholders substituted. For SMS
// templates this is the only thing the caller needs.
export async function renderTemplate(supabase, key, vars = {}) {
  const { body } = await loadTemplate(supabase, key)
  return applyPlaceholders(body, vars)
}

// Render both subject + body for an email template. Returns
// { subject, body } strings with placeholders substituted.
export async function renderEmailTemplate(supabase, key, vars = {}) {
  const { subject, body } = await loadTemplate(supabase, key)
  return {
    subject: applyPlaceholders(subject || '', vars),
    body: applyPlaceholders(body || '', vars),
  }
}

async function loadTemplate(supabase, key) {
  try {
    const { data } = await supabase
      .from('message_templates')
      .select('subject, body')
      .eq('key', key)
      .maybeSingle()
    if (data?.body) {
      return {
        subject: data.subject || FALLBACK_SUBJECTS[key] || '',
        body: data.body,
      }
    }
  } catch {
    // fall through to fallback
  }
  return {
    subject: FALLBACK_SUBJECTS[key] || '',
    body: FALLBACK_BODIES[key] || '',
  }
}

function applyPlaceholders(str, vars) {
  return String(str || '').replace(/\{(\w+)\}/g, (_, name) => {
    const v = vars[name]
    return v === undefined || v === null || v === '' ? `{${name}}` : String(v)
  })
}
