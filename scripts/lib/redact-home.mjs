// Mirror of `redactHome`/`HOME_PLACEHOLDER` from
// `src/main/modules/downloads/diagnostics.ts` (story 075 D2, AC4).
//
// `scripts/` is plain Node ESM outside both TS projects and cannot import
// `src/**/*.ts` at runtime (see the module doc comment in `fixture.mjs`), but the
// UI-verification fixture must contain *exactly* what production redaction
// produces — otherwise `scripts/flows/downloads-tab.mjs`'s "no real account name"
// assertion proves a property of a hand-typed placeholder rather than of the code
// under test.
//
// The copy is kept honest by a machine check, not by discipline:
// `src/main/modules/downloads/diagnostics.test.ts` › "the scripts/ mirror of
// redactHome matches the real implementation" runs both implementations over the
// same case table (including the fixture's own raw inputs) and fails the unit
// suite the moment they diverge.

/** Mirrors `HOME_PLACEHOLDER`. */
export const HOME_PLACEHOLDER = '<home>'

function stripTrailingSeparators(value) {
  let out = value
  while (out.length > 0 && (out.endsWith('\\') || out.endsWith('/'))) {
    out = out.slice(0, -1)
  }
  return out
}

function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function homeDirPattern(home) {
  return home.split(/[\\/]+/).map(escapeForRegExp).join('[\\\\/]+')
}

/**
 * Mirrors `redactHome`. `homeDir` is required here (the real one defaults to
 * `os.homedir()`) so a fixture is never accidentally seeded from whichever
 * machine generated it.
 *
 * @param {string} value
 * @param {string} homeDir
 * @returns {string}
 */
export function redactHome(value, homeDir) {
  const home = stripTrailingSeparators(homeDir)
  if (home.length === 0) return value

  const caseInsensitive = process.platform === 'win32'
  const pattern = new RegExp(
    `${homeDirPattern(home)}(?![A-Za-z0-9_-])`,
    caseInsensitive ? 'gi' : 'g',
  )
  return value.replace(pattern, HOME_PLACEHOLDER)
}
