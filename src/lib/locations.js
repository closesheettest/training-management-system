// US states + DC. Used in the state dropdown and for display.
export const US_STATES = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'District of Columbia' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
]

// Build a single-line address string from a location record.
export function formatAddress(loc) {
  if (!loc) return ''
  const parts = []
  if (loc.street_address) parts.push(loc.street_address)
  const cityStateZip = [loc.city, loc.state].filter(Boolean).join(', ')
  if (cityStateZip || loc.zip) {
    parts.push([cityStateZip, loc.zip].filter(Boolean).join(' '))
  }
  return parts.join(', ')
}

// Simple zip validation: 5 digits, optionally followed by -4 digits.
export const ZIP_PATTERN = '\\d{5}(-\\d{4})?'

// Years-in-sales buckets shown on testimonials.
export const YEARS_IN_SALES_OPTIONS = [
  'New to sales',
  '1-4 yrs',
  '5-9 yrs',
  '10-19 yrs',
  '20+ yrs',
]

// Default training schedule — pre-filled when adding a new location.
// User can override per-location.
export const DEFAULT_SCHEDULE = `Mon: 12:00pm – 4:00pm
Tues – Thurs: 10:00am – 2:00pm
Fri: 9:00am – 12:00pm`

// Florida training regions. Keep in display order — used both in dropdowns and for grouping.
export const FL_REGIONS = ['St Pete', 'Jacksonville', 'Orlando', 'Miami']

// Group an array of locations by region. Locations with no region land under "Other".
export function groupByRegion(locations) {
  const groups = new Map()
  // Seed in canonical order so dropdown groups always appear in the same sequence
  for (const r of FL_REGIONS) groups.set(r, [])
  for (const loc of locations) {
    const key = loc.region && FL_REGIONS.includes(loc.region) ? loc.region : 'Other'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(loc)
  }
  // Drop empty groups
  return [...groups.entries()].filter(([, items]) => items.length > 0)
}
