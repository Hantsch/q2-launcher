/**
 * Ping sample maths: the reported ping is the best (lowest) of a fixed number of round-trip
 * samples. Delay only ever adds to a round trip, so the minimum is the closest reading of the
 * path itself; there is no spread rule and no extra sampling (story 274).
 */

/** Samples taken for every responding server. */
export const PING_SAMPLES_FIRST = 3

/** Lowest of `samples` in whole ms. */
export function bestPing(samples: readonly number[]): number {
  return Math.round(Math.min(...samples))
}
