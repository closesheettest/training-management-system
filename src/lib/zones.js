// Zone → counties reference (owner-defined territory model, 2026-05-31).
//
// Used by the Edit Info modal on /active-reps to show "Zone 1 covers
// Nassau, Duval, …" inline when admin picks a zone — so they don't have
// to keep the territory screenshot pinned in another tab. Also a single
// source of truth if we later want to auto-suggest a zone from a rep's
// home county.
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
      'Citrus', 'Hernando', 'Sumter', 'Lake', 'Seminole', 'Volusia',
      'Brevard **', 'Orange **',
    ],
  },
  'Zone 2': {
    manager: 'Richard',
    label: 'Central / East-Central FL',
    counties: [
      'Orange **', 'Brevard **', 'Pasco', 'Hillsborough', 'Polk',
      'Osceola', 'Indian River', 'Highlands', 'Okeechobee', 'St. Lucie',
    ],
  },
  'Zone 3': {
    manager: 'Chad',
    label: 'Gulf Coast / SW FL',
    counties: [
      'Pinellas', 'Manatee', 'Sarasota', 'Charlotte', 'Lee', 'Collier',
      'Monroe', 'Hardee', 'DeSoto', 'Glades', 'Hendry',
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
