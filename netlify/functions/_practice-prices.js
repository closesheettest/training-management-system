// What a practice run costs, from the usage Google reports (not an estimate of
// minutes). USD per 1M tokens, Google's paid tier as of 25 Sep 2026. Flash
// DOUBLES on 1 Jan 2027 ($1.50 in / $7.50 out): update GRADE then.
// Live bills every turn on the whole conversation so far, so a long run costs
// more per minute than a short one.
export const PRICES = {
  live: { textIn: 0.75, audioIn: 3.0, audioOut: 12.0, textOut: 4.5 }, // gemini-3.8-live
  grade: { in: 0.75, out: 3.75 },                                      // gemini-3.8-flash
}
export function liveCost(u) {
  if (!u) return 0
  const p = PRICES.live
  return ((u.textIn || 0) * p.textIn + (u.audioIn || 0) * p.audioIn + (u.audioOut || 0) * p.audioOut + (u.textOut || 0) * p.textOut) / 1e6
}
export function gradeCost(inTok, outTok) {
  return ((inTok || 0) * PRICES.grade.in + (outTok || 0) * PRICES.grade.out) / 1e6
}
