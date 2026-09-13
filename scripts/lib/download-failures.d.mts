// Types for `download-failures.mjs`, so the fixture-parity test in
// `src/main/modules/downloads/diagnostics.test.ts` can import the seeded entry
// without pulling `scripts/` into either TS project. Deliberately narrow: only
// the shape that test asserts on.
export declare const DOWNLOAD_FAILURE_WITH_DIAGNOSTICS_ID: string
export declare const DOWNLOAD_FAILURE_WITHOUT_DIAGNOSTICS_ID: string
export declare const FIXTURE_HOME_DIR: string
export declare const FIXTURE_ACCOUNT_NAME: string
export declare const FIXTURE_RAW_TARGET_PATH: string

export interface FixtureFailureWithDiagnostics {
  id: string
  diagnostics: {
    target: { targetPath: string }
    logTail: string[]
  }
}

export declare function downloadFailureWithDiagnostics(): FixtureFailureWithDiagnostics
export declare function downloadFailureWithoutDiagnostics(): { id: string }
export declare function populatedDownloadFailures(): unknown[]
