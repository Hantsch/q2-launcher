/**
 * Runs before every test file (`test.setupFiles` in `vitest.config.ts`).
 *
 * Deliberately does not mute `console`: a test run is quiet because the logger is stubbed
 * (`electron-log-stub.ts`) and every other line of output is fixed where it is printed, so a
 * new warning still shows up in the run instead of being swallowed here.
 */
export {}
