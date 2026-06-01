// Zone → counties reference (owner-defined territory model).
//
// Originally seeded 2026-05-31. Revised 2026-06-01 — owner moved
// 4 counties between Zones:
//   Citrus      Zone 1 → Zone 2
//   Hernando    Zone 1 → Zone 2
//   Okeechobee  Zone 2 → Zone 3
//   St. Lucie   Zone 2 → Zone 3
//
// Used by the Edit Info modal on /active-reps to show "Zone 1 covers
// Nassau, Duval, …" inline when admin picks a zone — so they don't have
// to keep the territory screenshot pinned in another tab. Also a single
// source of truth for auto-suggesting a zone from a rep's home county
// AND for flagging reps who are sitting in the wrong zone after a
// territory rewrite like the one above.
//
// Brevard ** and Orange ** are split between Zone 1 and Zone 2: Rt 50
// is the dividing line, north is Zone 1, south is Zone 2. We list them
// in both Zone 1 and Zone 2 with the ** marker so the UI can show the
// split-warning text.

export const ZONE_COUNTIES = {
  'Zone 1': {
    manager: 'Tony',
    label: 'NE / North-Central FL',
    counties: [
      'Nassau', 'Duval', 'Baker', 'Union', 'Bradford', 'Clay',
      'St. Johns', 'Putnam', 'Flagler', 'Alachua', 'Levy', 'Marion',
      'Sumter', 'Lake', 'Seminole', 'Volusia',
      'Brevard **', 'Orange **',
    ],
  },
  'Zone 2': {
    manager: 'Richard',
    label: 'Central / East-Central FL',
    counties: [
      'Orange **', 'Brevard **', 'Pasco', 'Hillsborough', 'Polk',
      'Osceola', 'Indian River', 'Highlands',
      'Citrus', 'Hernando',
    ],
  },
  'Zone 3': {
    manager: 'Chad',
    label: 'Gulf Coast / SW FL',
    counties: [
      'Pinellas', 'Manatee', 'Sarasota', 'Charlotte', 'Lee', 'Collier',
      'Monroe', 'Hardee', 'DeSoto', 'Glades', 'Hendry',
      'St. Lucie', 'Okeechobee',
    ],
  },
  'Zone 4': {
    manager: 'Sam',
    label: 'SE FL',
    counties: ['Martin', 'Palm Beach', 'Broward', 'Miami-Dade'],
  },
}

// The Rt 50 split rule, surfaced as a helper string for tooltips /
// notes. Anywhere we render the ** counties we should explain it.
export const ZONE_SPLIT_NOTE =
  'Brevard ** and Orange ** are split between Zone 1 and Zone 2 — Rt 50 is the dividing line. North of Rt 50 = Zone 1, south = Zone 2.'

// Quick check: does a value look like one of the new Zone names? Used
// by the Edit Info modal to know whether to render the county hint
// (we don't want it showing for legacy regions like "Jacksonville").
export function isZoneName(name) {
  return !!name && Object.prototype.hasOwnProperty.call(ZONE_COUNTIES, name)
}

// Strip the "**" split-marker from a county name so it matches the
// raw value stored on the trainee record.
function stripSplit(c) {
  return String(c || '').replace(/\s*\*\*\s*$/, '').trim()
}

// All known FL counties referenced by any Zone — deduplicated and
// alphabetized. Brevard and Orange appear once each even though they
// live in both Zone 1 and Zone 2 (the split is on Rt 50, not by county
// name). Used as the dropdown options for the home_county field.
export const KNOWN_COUNTIES = Array.from(
  new Set(
    Object.values(ZONE_COUNTIES).flatMap((z) => z.counties.map(stripSplit)),
  ),
).sort((a, b) => a.localeCompare(b))

// Given a county, return the matching zone(s).
//   { zones: ['Zone 1'],           split: false }  for normal counties
//   { zones: ['Zone 1', 'Zone 2'], split: true  }  for Brevard / Orange
//   null                                            for unknown / blank
//
// Case-insensitive, ignores trailing whitespace + the optional "**".
export function zoneForCounty(county) {
  const target = stripSplit(county).toLowerCase()
  if (!target) return null
  const zones = []
  for (const [zone, def] of Object.entries(ZONE_COUNTIES)) {
    for (const c of def.counties) {
      if (stripSplit(c).toLowerCase() === target) {
        zones.push(zone)
        break
      }
    }
  }
  if (zones.length === 0) return null
  return { zones, split: zones.length > 1 }
}

// Check whether a rep's current region disagrees with what their
// county would suggest. Returns:
//   null                     — no mismatch (or no data to compare against)
//   { county, expected, current }  — county says X, region is Y
//
// Used by /active-reps RepRow to flag reps whose county landed in a
// different zone after a territory rewrite. Skips:
//   - reps with no county on file (nothing to compare)
//   - reps whose county isn't in any zone (can't suggest anything)
//   - reps whose current region is a non-zone string (legacy region)
//     because moving them is the admin's call, not the algorithm's
//   - split counties when current region is one of the valid zones
//     (Brevard/Orange can legitimately be either Zone 1 or Zone 2)
export function detectZoneMismatch(rep) {
  if (!rep || !rep.county) return null
  const suggestion = zoneForCounty(rep.county)
  if (!suggestion || suggestion.zones.length === 0) return null
  if (!rep.region || !isZoneName(rep.region)) return null
  if (suggestion.zones.includes(rep.region)) return null
  return {
    county: stripSplit(rep.county),
    expected: suggestion.zones, // array — usually 1 entry, 2 for split counties
    current: rep.region,
  }
}
