// Story 096 D1: the pure planning step of the release pipeline. Takes everything the shell layer
// (D4, not this file) would otherwise fetch from disk/git/GitHub as plain arguments, and returns
// either a plan (what to write, what commands to run) or throws `ReleaseRefused`. No fs, no
// child_process, no git/gh calls anywhere in this module — that is what makes AC2/AC3/AC5/AC7
// unit-testable without a real repo. Mirrors `scripts/lib/download-failures.mjs`'s shape: plain
// ESM, JSDoc types, named exports.
import { notesFor, promote, readUnreleased, validateUnreleased } from './changelog.mjs'
import { applyVersion, deriveBump, isPrerelease, nextVersion } from './version.mjs'

/**
 * Thrown by `planRelease` whenever the tree isn't in a state a release can be cut from. Carries a
 * human-readable `reason` (also available as `.message`) so a CLI layer can print it directly.
 */
export class ReleaseRefused extends Error {
  /** @param {string} reason */
  constructor(reason) {
    super(reason)
    this.name = 'ReleaseRefused'
    this.reason = reason
  }
}

/**
 * @typedef {Object} ReleaseWrite
 * @property {string} path - repo-relative path, e.g. `'CHANGELOG.md'`.
 * @property {string} content - the full new file content.
 */

/**
 * @typedef {Object} ReleaseCommand
 * @property {string} kind - a short discriminator: `'git-add' | 'git-commit' | 'git-tag' |
 *   'git-push' | 'gh-release'`.
 * @property {string[]} argv - the command's argv, ready for a shell layer to spawn (e.g.
 *   `['git', 'commit', '-m', 'release: 1.2.0 [skip ci]']`).
 */

/**
 * @param {Object} input
 * @param {string} input.changelogText - full current CHANGELOG.md text.
 * @param {string} input.pkgText - full current package.json text.
 * @param {string} input.lockText - full current package-lock.json text.
 * @param {string[]} input.tags - existing tag names (e.g. from `git tag --list`), used only to
 *   refuse a re-run that would recreate an existing tag (AC7).
 * @param {string} [input.requestedVersion] - an explicit version (no leading `v`) that wins over
 *   any derived or explicitly-requested bump (AC6).
 * @param {import('./version.mjs').Bump} [input.bump] - an explicit bump that wins over the
 *   category-derived one, when `requestedVersion` is not given (AC6).
 * @param {boolean} input.dryRun - when true, `commands` is always `[]` (AC5): every other step
 *   (version/notes/writes) still runs, so a caller can print/diff what *would* happen.
 * @param {boolean} [input.isCi] - threaded through for D4's convenience; this module does not
 *   gate on it (the shell layer is what refuses outside CI).
 * @param {string} input.today - `YYYY-MM-DD`, the date stamped on the new changelog section.
 * @returns {{ version: string, tag: string, notes: string, writes: ReleaseWrite[],
 *   commands: ReleaseCommand[] }}
 * @throws {ReleaseRefused}
 */
export function planRelease({
  changelogText,
  pkgText,
  lockText,
  tags,
  requestedVersion,
  bump,
  dryRun,
  isCi,
  today,
}) {
  // AC2: nothing is written before this check passes — it runs first, before any version
  // arithmetic or text is built.
  const refusalReason = validateUnreleased(changelogText)
  if (refusalReason) {
    throw new ReleaseRefused(refusalReason)
  }

  const currentVersion = readPackageVersion(pkgText)

  // `bump` present in the input means the caller (`--bump`) requested it explicitly; falling
  // back to `deriveBump` means it was derived from changelog categories instead. That distinction
  // is exactly what `nextVersion` needs to know whether an explicit bump should override the
  // prerelease-increment behavior (AC6) — see its `explicit` option.
  const explicitBump = bump !== undefined
  const resolvedBump = bump ?? deriveBump(...unreleasedBumpArgs(changelogText))

  const version =
    requestedVersion ?? nextVersion(currentVersion, resolvedBump, { explicit: explicitBump })

  const tag = `v${version}`
  if (tags.includes(tag)) {
    throw new ReleaseRefused(`tag ${tag} already exists`)
  }

  const promotedChangelogText = promote(changelogText, version, today)
  const notes = notesFor(promotedChangelogText, version)
  const { pkgText: newPkgText, lockText: newLockText } = applyVersion(pkgText, lockText, version)

  /** @type {ReleaseWrite[]} */
  const writes = [
    { path: 'CHANGELOG.md', content: promotedChangelogText },
    { path: 'package.json', content: newPkgText },
    { path: 'package-lock.json', content: newLockText },
  ]

  // AC5: a dry run computes everything (version, notes, writes) but plans no git/gh mutation.
  const commands = dryRun ? [] : buildCommands(version, tag)

  return { version, tag, notes, writes, commands }
}

/** @param {string} pkgText @returns {string} */
function readPackageVersion(pkgText) {
  const match = /"version":\s*"([^"]*)"/.exec(pkgText)
  if (!match) {
    throw new Error('planRelease: no "version" field found in package.json text')
  }
  return match[1]
}

/** @param {string} changelogText @returns {[string[], { hasBreaking: boolean }]} */
function unreleasedBumpArgs(changelogText) {
  const { categories, hasBreaking } = readUnreleased(changelogText)
  return [categories, { hasBreaking }]
}

/**
 * @param {string} version
 * @param {string} tag
 * @returns {ReleaseCommand[]}
 */
function buildCommands(version, tag) {
  const commitMessage = `release: ${version} [skip ci]`
  /** @type {ReleaseCommand[]} */
  const commands = [
    { kind: 'git-add', argv: ['git', 'add', 'CHANGELOG.md', 'package.json', 'package-lock.json'] },
    { kind: 'git-commit', argv: ['git', 'commit', '-m', commitMessage] },
    // Annotated, not lightweight: `git push --follow-tags` only pushes annotated tags reachable
    // from what's being pushed, so a lightweight tag here would silently never reach the remote.
    { kind: 'git-tag', argv: ['git', 'tag', '-a', tag, '-m', commitMessage] },
    { kind: 'git-push', argv: ['git', 'push', '--follow-tags'] },
    {
      kind: 'gh-release',
      argv: [
        'gh',
        'release',
        'create',
        tag,
        '--title',
        version,
        '--notes-file',
        // Placeholder: this module has no fs access, so it cannot write `notes` to a real file.
        // D4 writes the caller-visible `notes` (returned above) to a temp file and substitutes
        // its real path here before spawning.
        '<release-notes-file>',
        ...(isPrerelease(version) ? ['--prerelease'] : []),
        // D3/D4 fill in real asset paths after this placeholder — this module has no fs access
        // to discover them.
      ],
    },
  ]
  return commands
}
