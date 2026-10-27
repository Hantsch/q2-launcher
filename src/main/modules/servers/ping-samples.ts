/**
 * Ping sample maths: the reported ping is the median of several round-trip samples, and extra
 * samples are only taken when the first ones disagree. "Disagree" needs both an absolute and a
 * relative bound exceeded - a few ms of jitter on a near server is not an outlier, and a wide
 * spread on a far server is only one when it is large relative to the ping itself (story 258).
 */

/** Samples taken for every responding server. */
export const PING_SAMPLES_FIRST = 3

/** Additional samples taken when the first ones are far apart. */
export const PING_SAMPLES_EXTRA = 3

/** Median of `samples` in whole ms; an even count averages the two middle values. */
export function medianPing(samples: readonly number[]): number {
  return Math.round(rawMedian(samples))
}

/** True when the spread exceeds both 20 ms and 25% of the (unrounded) median. */
export function samplesFarApart(samples: readonly number[]): boolean {
  if (samples.length < 2) return false
  const spread = Math.max(...samples) - Math.min(...samples)
  return spread > Math.max(20, 0.25 * rawMedian(samples))
}

function rawMedian(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
