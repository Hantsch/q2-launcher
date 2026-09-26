/** A gated feature's name. Deliberately a plain string, not a closed union, so a
 *  test-only feature name works through the exact same declaration as a real one. */
export type FeatureName = string
