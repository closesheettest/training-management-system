// Generic social-post copy generators.
//
// Per user rule: never mention the client company name ("U.S. Shingle &
// Metal") in outbound social posts since Neal's personal brand should travel
// across clients. Location is OK to mention except when training is at the
// client's HQ — in that case just say the city.

const CLIENT_NAME_TOKENS = ['u.s. shingle', 'us shingle', 'usshingle', 'shingle', 'uss']

function looksLikeClientHq(location) {
  if (!location?.name) return false
  const n = location.name.toLowerCase()
  return CLIENT_NAME_TOKENS.some((tok) => n.includes(tok))
}

// Returns a leading-space phrase like " at the Hilton in Orlando" or " in St
// Pete", or '' if nothing useful. Caller can append directly into copy.
export function locationPhrase(location) {
  if (!location) return ''
  if (looksLikeClientHq(location)) {
    return location.city ? ` in ${location.city}` : ''
  }
  const name = location.name?.trim()
  const city = location.city?.trim()
  if (name) {
    const includesCity = city && name.toLowerCase().includes(city.toLowerCase())
    if (city && !includesCity) return ` at ${name} in ${city}`
    return ` at ${name}`
  }
  return city ? ` in ${city}` : ''
}

// "Class graduates" copy. Generic; no client name; respects location rule.
export function buildGraduationPost({ count, location }) {
  const where = locationPhrase(location)
  const plural = count === 1 ? '' : 's'
  return (
    `🎓 Just wrapped another training week${where}.\n\n` +
    `${count} new sales rep${plural} graduated this week — proud of this group's hustle and how much they soaked up.\n\n` +
    `Onto the next class.\n\n` +
    `#SalesTraining #FieldSales #SalesCoaching`
  )
}

// "New testimonial" copy. Generic; uses first name + initial only.
//
// Format intentionally pairs the question (SEO-friendly framing — keywords
// like "sales training" live naturally inside the prompt) with the trainee's
// verbatim answer. We never reword the answer; the SEO benefit comes from
// the question framing, not from massaging the trainee's voice.
//
// `question` is optional — if missing, falls back to the older
// "in their own words" lead-in so old callers still work.
export function buildTestimonialPost({ quote, question, firstName, lastName, yearsInSales }) {
  if (!quote) return null
  const initial = lastName ? lastName.charAt(0).toUpperCase() + '.' : ''
  const attr = [firstName, initial].filter(Boolean).join(' ')
  const tail = yearsInSales ? `${attr} · ${yearsInSales}` : attr
  const lead = question?.trim()
    ? `Asked one of this week's sales trainees:\n"${question.trim()}"\n\nIn their own words:`
    : `One of this week's trainees, in their own words:`
  return (
    `${lead}\n\n` +
    `"${quote.trim()}"\n\n` +
    (tail ? `— ${tail}\n\n` : '') +
    `Real impact. That's why I do this. 🙌\n\n` +
    `#SalesTraining #SalesCoaching`
  )
}
