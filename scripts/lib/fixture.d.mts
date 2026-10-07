// Types for `fixture.mjs`, so the tests that import it from `src/` (the fixture-parity test,
// the bootstrap archive-layout test) are typed without pulling `scripts/` into either TS project.
// Deliberately narrow: only what those tests use.
export declare const BOOTSTRAP_FIXTURE_LAYOUT: Record<string, string[]>
export declare const FIXTURE_VARIANTS: readonly string[]
export declare const LEGACY_SEED_VARIANTS: readonly string[]
export declare const LEGACY_SEED_SCHEMA_VERSION: number

/** Seeds one variant; some writers are async or hand back something the caller must stop. */
export declare function writeFixture(variant: string): unknown
