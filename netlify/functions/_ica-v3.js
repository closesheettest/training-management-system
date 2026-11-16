// Is a rep's pay covered by the Independent Contractor Agreement they signed?
//
// From the v3 agreement on (live 2026-11-16 11:15 AM ET, commit 9b42417), Exhibit A carries the Draw
// Program and the Inspection Program itself. So anyone who signed the ICA from then on does NOT also
// sign the old separate "pay documents" form (Draw Program + Inspection Compensation Plan): it had the
// old wording and the old Pinellas Park address, and Jen saw new reps "still signing old docs"
// (Neal, 2026-11-16). Anyone who signed the ICA before then still owes the separate form, as before.
//
// `_`-prefixed helper module — not a Netlify endpoint.
export const ICA_V3_SINCE = '2026-11-16T16:15:00Z'
export const payCoveredByIca = (signedAt) => !!signedAt && Date.parse(signedAt) >= Date.parse(ICA_V3_SINCE)
