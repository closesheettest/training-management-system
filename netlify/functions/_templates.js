// Shared helper for loading + applying SMS templates.
//
// Templates live in the `message_templates` table so the admin can edit
// any text from the /message-templates page without a redeploy. Each
// template has a body with {placeholder} variables that get substituted
// at send time from a dictionary the caller provides.
//
// Lookup is by key (e.g. 'registration_initial'). If the key is missing
// from the DB (fresh install, migration not yet run, accidentally deleted),
// we fall back to a hardcoded default so the system keeps working.

const FALLBACKS = {
  registration_initial:
    'Hi {firstName}, you\'re scheduled for training the week of {weekDate} at {locationName}. Please complete your registration here: {link}',
  registration_followup_1:
    'Hi {firstName}, quick reminder — please finish your training registration so we can confirm your spot for the week of {weekDate}: {link}',
  registration_followup_2:
    'Hi {firstName}, final reminder — we need to confirm your spot for training the week of {weekDate}. Please register here today: {link}. If you can\'t attend, please text back so we can give your spot to someone else.',
}

// Returns the rendered string with placeholders substituted. Unknown
// placeholders stay as `{name}` so the trainee gets a visible "this
// wasn't filled in" cue instead of silent breakage.
export async function renderTemplate(supabase, key, vars = {}) {
  const body = await loadTemplateBody(supabase, key)
  return applyPlaceholders(body, vars)
}

async function loadTemplateBody(supabase, key) {
  try {
    const { data } = await supabase
      .from('message_templates')
      .select('body')
      .eq('key', key)
      .maybeSingle()
    if (data?.body) return data.body
  } catch {
    // fall through to fallback
  }
  return FALLBACKS[key] || ''
}

function applyPlaceholders(body, vars) {
  return String(body || '').replace(/\{(\w+)\}/g, (_, name) => {
    const v = vars[name]
    return v === undefined || v === null || v === '' ? `{${name}}` : String(v)
  })
}
