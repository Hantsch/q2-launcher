// Types for `redact-home.mjs`, so the parity test in
// `src/main/modules/downloads/diagnostics.test.ts` can import the mirror without
// pulling `scripts/` into either TS project.
export declare const HOME_PLACEHOLDER: string
export declare function redactHome(value: string, homeDir: string): string
