// Story 096 D1: pure semver helpers for the release pipeline — no fs, no git. Every function
// takes plain strings/arrays and returns plain data, so `plan.mjs` (and its tests) can drive a
// full version decision without touching package.json for real. Mirrors
// `scripts/lib/download-failures.mjs`'s shape: plain ESM, JSDoc types, named exports.
//
// This project's very first release is `1.0.0-beta.1` (a prerelease), which is why bump
// derivation and version incrementing both need to be prerelease-aware rather than plain semver:
// a category-derived "this looks like a major change" must not jump straight to a stable `2.0.0`
// while the project hasn't even shipped `1.0.0` yet — see `nextVersion`.

/** @typedef {'major' | 'minor' | 'patch'} Bump */

/**
 * Derives the semver bump implied by which Keep-a-Changelog categories (and bullet markers) are
 * present in `## Unreleased`, per this story's decision:
 *
 * - `### Removed` present, or any bullet marked `**BREAKING**` → `major`.
 * - else `### Added` or `### Changed` present → `minor`.
 * - else (only `### Fixed` / `### Security`) → `patch`.
 *
 * @param {string[]} categories - the `###` category names present, e.g. from
 *   `readUnreleased(text).categories`.
 * @param {{ hasBreaking?: boolean }} [options] - `hasBreaking` mirrors
 *   `readUnreleased(text).hasBreaking`; pass it alongside `categories` to fold in the
 *   `**BREAKING**` bullet rule. Defaults to `false` when omitted.
 * @returns {Bump}
 */
export function deriveBump(categories, options = {}) {
  const hasBreaking = options.hasBreaking ?? false
  if (categories.includes('Removed') || hasBreaking) return 'major'
  if (categories.includes('Added') || categories.includes('Changed')) return 'minor'
  return 'patch'
}

/**
 * @param {string} version - a semver string, e.g. `'1.0.0-beta.1'` or `'1.2.0'`.
 * @returns {boolean} true if it carries a prerelease identifier.
 */
export function isPrerelease(version) {
  return /^\d+\.\d+\.\d+-/.test(version)
}

const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

/**
 * Computes the next version from `current` and a derived/explicit `bump`, prerelease-aware:
 *
 * - if `current` is a prerelease (`X.Y.Z-<identifier>.<N>`) AND `bump` was *derived* (not
 *   explicitly requested — `options.explicit` is false/omitted), it only increments the trailing
 *   numeric prerelease counter (`beta.1` → `beta.2`) — stable `X.Y.Z` hasn't shipped yet, so a
 *   category-derived bump must not announce a release that doesn't exist yet.
 * - otherwise (a stable `current`, or an *explicit* `bump` even over a prerelease `current`),
 *   applies a normal semver bump to the release core (major/minor/patch, resetting lower
 *   components to `0`) and drops any prerelease identifier — an explicit `--bump`/`--version`
 *   means "cut a real release right now", so it must not be silently downgraded to a prerelease
 *   counter tick (AC6). Concretely: `nextVersion('1.0.0-beta.1', 'major', { explicit: true })` →
 *   `'2.0.0'` (major bump of the `1.0.0` release core, prerelease identifier dropped).
 *
 * @param {string} current
 * @param {Bump} bump
 * @param {{ explicit?: boolean }} [options] - `explicit: true` means the caller (a human via
 *   `--bump`) requested this bump directly, as opposed to it being derived from changelog
 *   categories — see `deriveBump`. Defaults to `false`.
 * @returns {string}
 */
export function nextVersion(current, bump, options = {}) {
  const explicit = options.explicit ?? false
  const match = SEMVER_PATTERN.exec(current)
  if (!match) {
    throw new Error(`nextVersion: "${current}" is not a valid semver version`)
  }
  const [, majorStr, minorStr, patchStr, prerelease] = match
  const major = Number(majorStr)
  const minor = Number(minorStr)
  const patch = Number(patchStr)

  if (prerelease && !explicit) {
    const prereleaseMatch = /^(.*\.)(\d+)$/.exec(prerelease)
    if (!prereleaseMatch) {
      throw new Error(
        `nextVersion: prerelease identifier "${prerelease}" does not end in ".<number>"`,
      )
    }
    const [, prefix, counterStr] = prereleaseMatch
    const nextCounter = Number(counterStr) + 1
    return `${major}.${minor}.${patch}-${prefix}${nextCounter}`
  }

  switch (bump) {
    case 'major':
      return `${major + 1}.0.0`
    case 'minor':
      return `${major}.${minor + 1}.0`
    case 'patch':
      return `${major}.${minor}.${patch + 1}`
    default:
      throw new Error(`nextVersion: unknown bump "${bump}"`)
  }
}

/**
 * Regex-replaces the `"version"` field in package.json text and package-lock.json text, without
 * JSON.parse+stringify (which would reformat the file and blow up the diff).
 *
 * package.json has exactly one `"version"` field, so its first (only) occurrence is replaced.
 *
 * package-lock.json (lockfileVersion 3) repeats the *project's own* version in two places:
 *
 *   { "name": "q2-launcher", "version": "0.1.0", ... }                                  <- root
 *   { "packages": { "": { "name": "q2-launcher", "version": "0.1.0", ... } } }          <- self-entry
 *
 * but also carries a `"version"` field for every *dependency*, which must NOT be touched. Both
 * of the project's own occurrences are (and only ever are) immediately preceded by `"name":
 * "<this project's name>"` — no dependency is named after its own consumer — so scoping the
 * replacement to `"name": "<pkgText's name>", "version": "..."` hits exactly those two spots
 * (or however many of them exist) and nothing else. Pulling the name from `pkgText` itself (a
 * caller doesn't pass it separately) keeps this correct for whatever project it's pointed at.
 *
 * @param {string} pkgText
 * @param {string} lockText
 * @param {string} version - the new version, no leading `v`.
 * @returns {{ pkgText: string, lockText: string }}
 */
export function applyVersion(pkgText, lockText, version) {
  const versionFieldPattern = /"version":\s*"[^"]*"/
  if (!versionFieldPattern.test(pkgText)) {
    throw new Error('applyVersion: no "version" field found in package.json text')
  }
  const newPkgText = pkgText.replace(versionFieldPattern, `"version": "${version}"`)

  const nameMatch = /"name":\s*"([^"]*)"/.exec(pkgText)
  if (!nameMatch) {
    throw new Error('applyVersion: no "name" field found in package.json text')
  }
  const escapedName = nameMatch[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const ownVersionPattern = new RegExp(
    `("name":\\s*"${escapedName}",\\s*"version":\\s*")[^"]*(")`,
    'g',
  )
  const newLockText = lockText.replace(ownVersionPattern, `$1${version}$2`)

  return { pkgText: newPkgText, lockText: newLockText }
}
