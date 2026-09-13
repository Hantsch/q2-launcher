// Story 096 D1: the pure Keep-a-Changelog parser/editor the release pipeline is built on. No fs,
// no git — every function here takes the changelog's full text as a plain string and returns
// either new text or plain data, so `plan.mjs` (and its tests) can drive the whole promotion
// without ever touching a real CHANGELOG.md. Mirrors `scripts/lib/download-failures.mjs`'s shape:
// plain ESM, JSDoc types, named exports, comments that explain why a rule exists.
//
// The file this operates on always has the shape:
//
//   ## Unreleased
//
//   ### Added
//   - ...
//
//   ## 1.2.0 — 2026-01-01
//
//   ### Fixed
//   - ...
//
// i.e. `##` version headings (the first of which is always `Unreleased`), each followed by zero
// or more `###` category sub-headings, each followed by zero or more `- ` bullet lines.

/** The exact placeholder HTML comment a freshly-scaffolded `## Unreleased` section carries.
 * Mirrors the seed comment already used in the sibling project this pipeline is ported from —
 * `validateUnreleased` treats a section containing only this (plus whitespace) as empty. */
export const UNRELEASED_PLACEHOLDER =
  "<!-- Add your changes here as '- ...' items, grouped under '### Added' / '### Changed' / '### Fixed' / '### Removed' / '### Security' headings. -->"

/**
 * @typedef {Object} ChangelogCategory
 * @property {string} name - the `###` heading text, e.g. `'Added'`.
 * @property {string[]} bullets - the full text of each `- ...` bullet under it, text only (no
 *   leading `- ` on the first line). A bullet that wraps onto indented continuation lines keeps
 *   those lines verbatim, joined by `\n`, so re-emitting `- ${bullet}` reproduces the original
 *   multi-line block byte-for-byte instead of truncating after the first line. Code that only
 *   cares about a bullet's lead-in (e.g. a `**BREAKING**` marker) can keep using `startsWith`
 *   since the first line's text is unchanged.
 */

/**
 * @typedef {Object} ChangelogSection
 * @property {string} heading - the full `##` heading line's content, e.g. `'Unreleased'` or
 *   `'1.2.0 — 2026-01-01'`.
 * @property {ChangelogCategory[]} categories - in source order.
 * @property {string} raw - the section's raw body text (between this `##` heading and the next),
 *   including any non-bullet prose/comments — needed so `validateUnreleased` can tell "only the
 *   placeholder comment" apart from "no body at all".
 */

/**
 * Splits changelog text into its `## `-delimited sections. The first section is always Unreleased
 * (that is the contract this whole pipeline assumes — `promote` re-inserts it at the top).
 *
 * @param {string} text
 * @returns {{ unreleased: ChangelogSection, prior: ChangelogSection[], preamble: string }}
 *   `preamble` is anything before the first `## ` heading (the `# Changelog` title, intro prose),
 *   preserved verbatim so `promote` can rebuild the file without losing it.
 */
export function parseChangelog(text) {
  const lines = text.split('\n')
  /** @type {{ heading: string, start: number, end: number }[]} */
  const headingRanges = []
  let preambleEnd = lines.length

  for (let i = 0; i < lines.length; i++) {
    const match = /^##\s+(.*)$/.exec(lines[i])
    if (match) {
      if (headingRanges.length === 0) preambleEnd = i
      headingRanges.push({ heading: match[1].trim(), start: i, end: lines.length })
    }
  }
  for (let i = 0; i < headingRanges.length - 1; i++) {
    headingRanges[i].end = headingRanges[i + 1].start
  }

  const preamble = lines.slice(0, preambleEnd).join('\n')
  const sections = headingRanges.map(({ heading, start, end }) =>
    parseSection(heading, lines.slice(start + 1, end).join('\n')),
  )

  // The first `##` heading is only treated as Unreleased if it is actually named that — a
  // changelog whose first (or only) section is e.g. `## 1.2.0 — ...` must NOT have that section
  // silently misread as Unreleased. When no `## Unreleased` heading exists at all, `validateUnreleased`
  // needs a genuinely empty synthetic section to produce its "missing" refusal reason from.
  const isFirstUnreleased = sections.length > 0 && sections[0].heading === 'Unreleased'
  const unreleased = isFirstUnreleased
    ? sections[0]
    : { heading: 'Unreleased', categories: [], raw: '' }
  const prior = isFirstUnreleased ? sections.slice(1) : sections

  return { unreleased, prior, preamble }
}

/** @param {string} heading @param {string} raw @returns {ChangelogSection} */
function parseSection(heading, raw) {
  const bodyLines = raw.split('\n')
  /** @type {ChangelogCategory[]} */
  const categories = []
  let current = null
  // Tracks whether the last non-blank line was a `- ` bullet (or a continuation of one), so a
  // following indented line gets appended to that bullet — but only until the next `- ` line, the
  // next heading, or a blank line closes it off, per the story's fix for the truncation bug.
  let bulletOpen = false

  for (const line of bodyLines) {
    const categoryMatch = /^###\s+(.*)$/.exec(line)
    if (categoryMatch) {
      current = { name: categoryMatch[1].trim(), bullets: [] }
      categories.push(current)
      bulletOpen = false
      continue
    }
    const bulletMatch = /^-\s+(.*)$/.exec(line)
    if (bulletMatch && current) {
      current.bullets.push(bulletMatch[1].trim())
      bulletOpen = true
      continue
    }
    if (line.trim() === '') {
      bulletOpen = false
      continue
    }
    if (bulletOpen && current) {
      // A continuation line belonging to the bullet just pushed — appended verbatim (original
      // indentation and all) so `promote` can re-emit the exact original multi-line block.
      const lastIndex = current.bullets.length - 1
      current.bullets[lastIndex] += `\n${line}`
    }
  }
  return { heading, categories, raw }
}

/**
 * @param {string} text
 * @returns {{ categories: string[], bullets: string[], hasBreaking: boolean }}
 *   `categories` is the set of `###` sub-headings under `## Unreleased`, in source order.
 *   `bullets` is every `- ...` bullet under any of them, in order, across categories.
 *   `hasBreaking` is true if any bullet starts with `**BREAKING**` — `deriveBump` needs this to
 *   force a major bump even from a `### Changed`-only section.
 */
export function readUnreleased(text) {
  const { unreleased } = parseChangelog(text)
  const categories = unreleased.categories.map((c) => c.name)
  const bullets = unreleased.categories.flatMap((c) => c.bullets)
  const hasBreaking = bullets.some((b) => b.startsWith('**BREAKING**'))
  return { categories, bullets, hasBreaking }
}

/**
 * Refuses a release when `## Unreleased` cannot possibly describe a real change. Returns a
 * refusal reason string when invalid, or `null` when the section is fit to release from —
 * a plain return rather than a throw, so `plan.mjs` decides how to surface it (wraps it in
 * `ReleaseRefused`) without this module needing to know about that error type.
 *
 * Refuses when:
 * - there is no `## Unreleased` heading at all;
 * - the section's body is empty (nothing but whitespace);
 * - the section's body is only the seed placeholder comment;
 * - the section has zero `- ` bullets under any category (e.g. a category heading with no
 *   bullets under it, or prose that isn't a bullet).
 *
 * @param {string} text
 * @returns {string | null}
 */
export function validateUnreleased(text) {
  const { unreleased } = parseChangelog(text)
  if (unreleased.raw.trim() === '' && unreleased.categories.length === 0) {
    // Distinguish "heading missing entirely" from "heading present but empty" for a more useful
    // message — parseChangelog always returns a synthetic empty section when the heading is
    // absent, so check the raw text for the heading to tell them apart.
    if (!/^##\s+Unreleased\s*$/m.test(text)) {
      return 'CHANGELOG.md has no "## Unreleased" section'
    }
    return '"## Unreleased" section is empty'
  }

  const withoutPlaceholder = unreleased.raw.replaceAll(UNRELEASED_PLACEHOLDER, '').trim()
  if (withoutPlaceholder === '' && unreleased.categories.length === 0) {
    return '"## Unreleased" section only contains the placeholder comment'
  }

  const { bullets } = readUnreleased(text)
  if (bullets.length === 0) {
    return '"## Unreleased" section has no "- " bullet items'
  }

  return null
}

/**
 * Promotes `## Unreleased` into a new dated version section, and empties `## Unreleased` back to
 * just the scaffold placeholder — ready for the next round of changes.
 *
 * @param {string} text
 * @param {string} version - e.g. `'1.2.0'` (no leading `v`).
 * @param {string} date - `YYYY-MM-DD`.
 * @returns {string} the new full changelog text.
 */
export function promote(text, version, date) {
  const { unreleased, prior, preamble } = parseChangelog(text)

  const promotedBody = unreleased.categories
    .map((c) => `### ${c.name}\n${c.bullets.map((b) => `- ${b}`).join('\n')}`)
    .join('\n\n')

  const newSection = `## ${version} — ${date}\n\n${promotedBody}\n`
  const emptiedUnreleased = `## Unreleased\n\n${UNRELEASED_PLACEHOLDER}\n`

  const priorText = prior
    .map((section) => `## ${section.heading}\n${section.raw.replace(/^\n+/, '')}`)
    .join('\n')

  const parts = [preamble.trimEnd(), emptiedUnreleased, newSection]
  if (priorText) parts.push(priorText)
  return parts.filter((p) => p.trim() !== '').join('\n\n').trimEnd() + '\n'
}

/**
 * Extracts the body of a `## <version> — ...` section — for `gh release create --notes-file`.
 * Does not include the heading line itself.
 *
 * @param {string} text
 * @param {string} version - e.g. `'1.2.0'` (no leading `v`); matched against the heading's
 *   leading `<version> —` (or `<version> -`) prefix, so the exact date suffix need not be known
 *   by the caller.
 * @returns {string}
 */
export function notesFor(text, version) {
  const { unreleased, prior } = parseChangelog(text)
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const headingPattern = new RegExp(`^${escapedVersion}\\s+[—-]`)
  const section = [unreleased, ...prior].find((s) => headingPattern.test(s.heading))
  if (!section) {
    throw new Error(`notesFor: no "## ${version} — ..." section found in changelog`)
  }
  return section.raw.trim() + '\n'
}
