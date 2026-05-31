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
