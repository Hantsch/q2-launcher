/**
 * Pure Keep-a-Changelog-subset parser, shared by main and renderer (story 099 D1).
 *
 * No node, no DOM, no electron, no other module import - same "shared has no runtime deps beyond
 * zod" rule as the rest of this folder (see `constants.ts`'s header comment), except this file
 * doesn't even need zod: it only ever sees a string that was already read from disk (main) or
 * delivered over IPC (renderer), never a path or a value that needs validating against a schema.
 *
 * R1 (Decisions): no markdown dependency is added - this is a hand-written parser for exactly the
 * subset Q2 Launcher's own CHANGELOG.md uses: `### Heading` sections containing `- item` bullets.
 * Anything else (tables, code fences, standalone images, prose paragraphs) is silently dropped,
 * never passed through or guessed at.
 *
 * R2: markdown becomes data, never HTML. `parseReleaseNotes` returns plain strings; the three
 * inline styles it understands (`**bold**`, `` `code` ``, `[label](url)`) are reduced to their
 * plain text, nothing is ever turned into an HTML string. Raw HTML in a body (e.g.
 * `<img src=x onerror="alert(1)">`, `<script>...</script>`) is never recognised as markup by this
 * parser - it passes straight through as literal characters inside whatever item text contains it,
 * exactly like any other character. The caller (a later deliverable) is responsible for rendering
 * `items` as text, never as `innerHTML`.
 */

/** R12: caps so a hostile or merely oversized release body cannot stall the renderer. */
export const RELEASE_NOTES_MAX_INPUT_CHARS = 50_000
export const RELEASE_NOTES_MAX_SECTIONS = 50
export const RELEASE_NOTES_MAX_ITEMS_PER_SECTION = 200
export const RELEASE_NOTES_MAX_ITEM_LENGTH = 2_000

/** One `### Heading` block and the `- item` bullets found under it, in source order. */
export interface ReleaseNoteSection {
  heading: string
  items: string[]
}

const HEADING_LINE = /^###\s+(.+?)\s*$/
const ITEM_LINE = /^[-*]\s+(.+?)\s*$/
const CONTINUATION_LINE = /^\s+(\S.*?)\s*$/
const CODE_FENCE_LINE = /^```/
const STANDALONE_IMAGE_LINE = /^!\[[^\]]*\]\([^)]*\)\s*$/
const TABLE_ROW_LINE = /^\|.*\|\s*$/

/**
 * Reduces the three inline styles this subset understands to plain text - never to HTML. Order
 * matters only in that links are unwrapped before bold/code so a link label that happens to
 * contain `**`/`` ` `` still ends up plain; real changelog entries don't nest these, so a single
 * pass of each is enough (R1's "~80-line parser", not a full markdown engine).
 */
function reduceInline(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .trim()
}

/**
 * Parses a changelog *body* - a `### Heading` + `- item` fragment, with or without a leading
 * `## [version] - date` line above it (R6: a pending update's release-notes body has no version
 * header at all, just starts at `### Added`, and must parse the same way as a section carved out
 * of the full changelog by `extractVersionSection`).
 *
 * Unknown blocks - fenced code, tables, standalone images, any prose line that isn't a heading or
 * a bullet - are dropped, not passed through (R1). Truncates rather than throws once any of the
 * R12 caps is exceeded.
 */
export function parseReleaseNotes(markdown: string): ReleaseNoteSection[] {
  if (!markdown || !markdown.trim()) {
    return []
  }

  const truncated =
    markdown.length > RELEASE_NOTES_MAX_INPUT_CHARS
      ? markdown.slice(0, RELEASE_NOTES_MAX_INPUT_CHARS)
      : markdown
  const lines = truncated.split(/\r?\n/)

  const sections: ReleaseNoteSection[] = []
  let current: ReleaseNoteSection | null = null
  let inCodeFence = false
  // Index of the item currently being wrapped onto, within `current.items` - reset on every
  // blank line, heading or dropped block so an indented paragraph elsewhere never gets glued
  // onto an unrelated bullet.
  let openItemIndex = -1

  for (const line of lines) {
    if (line.trim() === '') {
      openItemIndex = -1
      continue
    }
    if (CODE_FENCE_LINE.test(line)) {
      inCodeFence = !inCodeFence
      openItemIndex = -1
      continue
    }
    if (inCodeFence) {
      continue
    }
    if (TABLE_ROW_LINE.test(line) || STANDALONE_IMAGE_LINE.test(line)) {
      openItemIndex = -1
      continue
    }

    const headingMatch = HEADING_LINE.exec(line)
    if (headingMatch) {
      openItemIndex = -1
      if (sections.length >= RELEASE_NOTES_MAX_SECTIONS) {
        // Cap reached: stop recognising further sections entirely rather than throwing.
        break
      }
      current = { heading: reduceInline(headingMatch[1]), items: [] }
      sections.push(current)
      continue
    }

    const itemMatch = ITEM_LINE.exec(line)
    if (itemMatch && current) {
      if (current.items.length >= RELEASE_NOTES_MAX_ITEMS_PER_SECTION) {
        openItemIndex = -1
        continue
      }
      const item = reduceInline(itemMatch[1]).slice(0, RELEASE_NOTES_MAX_ITEM_LENGTH)
      current.items.push(item)
      openItemIndex = current.items.length - 1
      continue
    }

    // A wrapped continuation of the bullet above it (Keep a Changelog's own convention of an
    // indented second line) - joined back onto the same item, not treated as a new block.
    const continuationMatch = CONTINUATION_LINE.exec(line)
    if (continuationMatch && current && openItemIndex >= 0) {
      const joined = `${current.items[openItemIndex]} ${reduceInline(continuationMatch[1])}`
      current.items[openItemIndex] = joined.slice(0, RELEASE_NOTES_MAX_ITEM_LENGTH)
      continue
    }

    // Anything else - prose paragraphs, a bullet before any heading - is dropped.
    openItemIndex = -1
  }

  return sections
}

// Matches the real heading shape this repo's own release pipeline writes
// (`scripts/lib/release/changelog.mjs`'s `promote()`): `## <version> — <date>` or, since
// `notesFor()` in that same file reads either dash leniently, `## <version> - <date>` - never
// bracketed, and the separator (em-dash or hyphen) must follow the version token directly so a
// bare `## Unreleased` heading (no separator at all) never matches.
const VERSION_HEADING_LINE = /^##\s+(\S+)\s+[—-]\s*(.+?)\s*$/
const ANY_VERSION_HEADING_LINE = /^##\s+\S+\s+[—-]/

/**
 * R4: resolves exactly one version's section out of a full changelog - used later to show only
 * the running version's notes. Finds the `## <version> — date` (or `## <version> - date`)
 * heading whose version token matches `version` exactly, and returns everything after it up to
 * (but not including) the next such version heading, or end of file. Returns `null` if that
 * version has no section at all. This must stay compatible with
 * `scripts/lib/release/changelog.mjs`'s `promote()` (the producer) and `notesFor()` (the other
 * reader) - not the other way around.
 *
 * Only a version heading (`## x — y` / `## x - y`) ends a section - a plain `## Unreleased`
 * heading does not, since `CHANGELOG.md` itself uses that as the section above every version.
 */
export function extractVersionSection(
  changelog: string,
  version: string,
): { version: string; date: string; body: string } | null {
  if (!changelog) {
    return null
  }

  const truncated =
    changelog.length > RELEASE_NOTES_MAX_INPUT_CHARS
      ? changelog.slice(0, RELEASE_NOTES_MAX_INPUT_CHARS)
      : changelog
  const lines = truncated.split(/\r?\n/)

  let startIndex = -1
  let date = ''
  for (let i = 0; i < lines.length; i++) {
    const match = VERSION_HEADING_LINE.exec(lines[i])
    if (match && match[1] === version) {
      startIndex = i
      date = match[2].trim()
      break
    }
  }

  if (startIndex === -1) {
    return null
  }

  let endIndex = lines.length
  for (let i = startIndex + 1; i < lines.length; i++) {
    if (ANY_VERSION_HEADING_LINE.test(lines[i])) {
      endIndex = i
      break
    }
  }

  const body = lines
    .slice(startIndex + 1, endIndex)
    .join('\n')
    .trim()

  return { version, date, body }
}
