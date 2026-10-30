import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { en } from './renderer/src/i18n/bundle'
import { sourceFiles } from './test-support/source-files'
import {
  commentRanges,
  isTestFile,
  listSourceFiles,
  readRepoFile,
  REPO_ROOT,
} from './test-support/source-tree'

/**
 * Comments state invariants, not sprint history. Files join `SWEPT_FILES` / `ID_FREE_ROOTS` once
 * they have been swept; the guards below are binding for exactly those and vacuous while empty.
 */

/** Repo-relative files whose comment density and wording are guarded. */
const SWEPT_FILES: string[] = [
  'src/main/lib/schemas.ts',
  'src/main/modules/servers/scan-service.ts',
  'src/main/modules/replays/scan-service.ts',
  'src/shared/modules/config.ts',
  'src/shared/modules/downloads.ts',
  'src/shared/modules/servers.ts',
  'src/shared/modules/replays.ts',
  'src/shared/config/profile/profile-restore/comment-scan.ts',
  'src/shared/config/profile/profile-restore/layers.ts',
  'src/shared/config/profile/profile-restore/index.ts',
  'src/shared/config/profile/profile-restore/cvar-sections.ts',
  'src/shared/config/profile/profile-restore/entry-grouping.ts',
  'src/shared/config/render/file-ownership.ts',
  'src/shared/config/profile/profile-restore/categories.ts',
  'src/shared/config/profile/profile-restore/comment-parse.ts',
  'src/shared/config/profile/profile-restore/entry-build.ts',
  'src/shared/config/profile/profile-restore/entry-matching.ts',
  'src/shared/config/profile/profile-restore/two-part.ts',
  'src/shared/config/profile/profile-restore/types.ts',
  'src/shared/config/render/comment-labels.ts',
  'src/shared/config/render/render.ts',
  'src/renderer/src/modules/config/ConfigView.tsx',
  'src/renderer/src/modules/config/ControlsTab.tsx',
  'src/renderer/src/modules/config/components/BindSlot.tsx',
  'src/renderer/src/modules/config/components/ConfigCodeView.tsx',
  'src/renderer/src/modules/config/components/ConfigDetailHeader.tsx',
  'src/renderer/src/modules/config/components/ConfigListScreen.tsx',
  'src/renderer/src/modules/config/components/ConfigTabContent.tsx',
  'src/renderer/src/modules/config/components/ConfigTabStrip.tsx',
  'src/renderer/src/modules/config/components/ControlsCategoryMenu.tsx',
  'src/renderer/src/modules/config/components/ControlsCategoryRail.tsx',
  'src/renderer/src/modules/config/components/ControlsDragZone.tsx',
  'src/renderer/src/modules/config/components/ControlsEntryRow.tsx',
  'src/renderer/src/modules/config/components/ControlsGrid.tsx',
  'src/renderer/src/modules/config/components/ControlsOptionsCell.tsx',
  'src/renderer/src/modules/config/components/ControlsRow.tsx',
  'src/renderer/src/modules/config/components/ControlsRowMenu.tsx',
  'src/renderer/src/modules/config/components/DropToggles.tsx',
  'src/renderer/src/modules/config/lib/useControlsDrag.ts',
  'src/renderer/src/modules/config/lib/useControlsEntryActions.ts',
  'src/renderer/src/modules/config/lib/useControlsRows.ts',
  'src/renderer/src/store/useLauncher.ts',
]

/** Repo-relative directories or files whose comments carry no deliverable or criterion ids. */
const ID_FREE_ROOTS: string[] = ['src']

/** Path suffixes that must each be matched by some `SWEPT_FILES` entry; sweeps append to both. */
const REQUIRED_SWEPT: string[] = [
  'lib/schemas.ts',
  'servers/scan-service.ts',
  'replays/scan-service.ts',
  'shared/modules/config.ts',
  'shared/modules/downloads.ts',
  'shared/modules/servers.ts',
  'shared/modules/replays.ts',
  'config/profile/profile-restore/comment-scan.ts',
  'config/profile/profile-restore/layers.ts',
  'config/profile/profile-restore/index.ts',
  'config/profile/profile-restore/cvar-sections.ts',
  'config/profile/profile-restore/entry-grouping.ts',
  'config/render/file-ownership.ts',
  'config/profile/profile-restore/categories.ts',
  'config/profile/profile-restore/comment-parse.ts',
  'config/profile/profile-restore/entry-build.ts',
  'config/profile/profile-restore/entry-matching.ts',
  'config/profile/profile-restore/two-part.ts',
  'config/profile/profile-restore/types.ts',
  'config/render/comment-labels.ts',
  'config/render/render.ts',
  'config/ConfigView.tsx',
  'config/ControlsTab.tsx',
  'config/components/BindSlot.tsx',
  'config/components/ConfigCodeView.tsx',
  'config/components/ConfigDetailHeader.tsx',
  'config/components/ConfigListScreen.tsx',
  'config/components/ConfigTabContent.tsx',
  'config/components/ConfigTabStrip.tsx',
  'config/components/ControlsCategoryMenu.tsx',
  'config/components/ControlsCategoryRail.tsx',
  'config/components/ControlsDragZone.tsx',
  'config/components/ControlsEntryRow.tsx',
  'config/components/ControlsGrid.tsx',
  'config/components/ControlsOptionsCell.tsx',
  'config/components/ControlsRow.tsx',
  'config/components/ControlsRowMenu.tsx',
  'config/components/DropToggles.tsx',
  'config/lib/useControlsDrag.ts',
  'config/lib/useControlsEntryActions.ts',
  'config/lib/useControlsRows.ts',
  'store/useLauncher.ts',
]

const ID_PATTERN = /\bD\d{1,2}\b|\bAC ?\d{1,2}\b/
/** A pointer to a story in any spelling: `story 12`, `stories 052/053`, `story-146`, `[[146]]`. */
const STORY_POINTER = /\bstor(?:y|ies)[ -]\d+|\[\[\d+\]\]/i
/** A zero-padded story number (`pre-042`, `every 042 fixture`). */
const PADDED_STORY_NUMBER = /\b0\d{2}\b/
const TRAILING_POINTER = /\(story \d+\)\s*(\*\/)?\s*$/
const HISTORY_PHRASES = /\b(later|this|earlier|next) deliverable\b|\bused to\b/i
const NARRATIVE_MARKERS: RegExp[] = [
  /review round/i,
  /review finding/i,
  /\bfinding F?\d+/i,
  /reversed by story/i,
  /\bround (one|two|three|\d)\b/i,
]

const productionSources = (): string[] =>
  listSourceFiles('src').filter(
    (path) => !isTestFile(path) && !path.startsWith('src/test-support/'),
  )

/** The first string argument of a `describe(` / `describe.each(…)(` call, in any quote style. */
const DESCRIBE_TITLE = /\bdescribe(?:\.each\([^)]*\))?\(\s*(['"`])((?:(?!\1)[^\\\n]|\\.)*)\1/g

/** Repo-relative `*.test.ts(x)` / `*.test.mjs` files under `src/` and `scripts/`. */
function testFilesWithDescribes(): string[] {
  const scripts = sourceFiles(join(REPO_ROOT, 'scripts')).map((file) =>
    file.slice(REPO_ROOT.length + 1).replaceAll('\\', '/'),
  )
  return [...listSourceFiles('src'), ...scripts].filter((path) => /\.test\.(tsx?|mjs)$/.test(path))
}

const filesUnder = (roots: string[]): string[] =>
  productionSources().filter((path) =>
    roots.some((root) => path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`)),
  )

/** Lines touched by a comment divided by total lines. */
function commentShare(path: string): number {
  const source = readRepoFile(path)
  const total = source.split('\n').length
  const touched = new Set<number>()
  for (const { startLine, endLine } of commentRanges(source))
    for (let line = startLine; line <= endLine; line++) touched.add(line)
  return touched.size / total
}

const commentsOf = (path: string): string[] =>
  commentRanges(readRepoFile(path)).map((range) => range.text)

/**
 * A module file's header: the >=3-line block before the first import, else the one directly above
 * the module definition (`export const xModule`, `RendererModule`, default export).
 */
function moduleHeader(path: string): ReturnType<typeof commentRanges>[number] | undefined {
  const source = readRepoFile(path)
  const lines = source.split('\n')
  const firstImport = lines.findIndex((line) => line.startsWith('import ')) + 1
  const blocks = commentRanges(source).filter(
    (range) => range.text.startsWith('/*') && range.endLine - range.startLine + 1 >= 3,
  )
  const leading = blocks.find((range) => range.endLine < firstImport)
  const definition = /^export (const \w*Module\b|interface RendererModule\b|default\b)/
  return leading ?? blocks.find((range) => definition.test(lines[range.endLine] ?? ''))
}

/** A backticked dotted token in a comment: `a.b.c` or `a.b.*`. */
const DOTTED_TOKEN = /`([A-Za-z][\w-]*(?:\.[\w-]+)+)(\.\*)?`/g
const FILE_EXTENSION = /\.(?:[cm]?[jt]sx?|json|md|css|html|ya?ml|txt|log|exe|node|d)$/

/** A plural key is stored as `<key>_one` / `<key>_other`, so the bare base resolves too. */
function resolvesIn(tree: unknown, key: string): boolean {
  let node = tree
  const segments = key.split('.')
  for (const [index, segment] of segments.entries()) {
    if (typeof node !== 'object' || node === null) return false
    const here = node as Record<string, unknown>
    const plural = index === segments.length - 1 && `${segment}_other` in here
    if (!(segment in here) && !plural) return false
    node = here[segment]
  }
  return true
}

/**
 * Backticked tokens of three or more segments whose first two segments name a real namespace of
 * `bundle` (so `app.isPackaged` or `installation.gameDirs` stay property paths) but which do not resolve.
 */
function danglingKeys(comments: string[], bundle: object): string[] {
  return comments.flatMap((comment) =>
    [...comment.matchAll(DOTTED_TOKEN)]
      .map((match) => match[1])
      .filter((token) => !FILE_EXTENSION.test(token) && token.split('.').length >= 3)
      .filter((token) => resolvesIn(bundle, token.split('.').slice(0, 2).join('.')))
      .filter((token) => !resolvesIn(bundle, token)),
  )
}

function sourcesAndScripts(): string[] {
  const scripts = sourceFiles(join(REPO_ROOT, 'scripts')).map((file) =>
    file.slice(REPO_ROOT.length + 1).replaceAll('\\', '/'),
  )
  return [...listSourceFiles('src'), ...scripts].filter((path) => path !== 'src/comments.test.ts')
}

describe('comment conventions', () => {
  it('main logs no info-level diagnostic tags', () => {
    const offenders = productionSources()
      .filter((path) => path.startsWith('src/main/'))
      .filter((path) => readRepoFile(path).match(/log\.info\(\s*['"`]\[diag/) !== null)
    expect(offenders).toEqual([])
  })

  it.each(SWEPT_FILES)(
    'swept files keep comments under 35%% with trailing story pointers only: %s',
    (path) => {
      expect(commentShare(path)).toBeLessThan(0.35)
      for (const comment of commentsOf(path)) {
        expect(comment).not.toMatch(ID_PATTERN)
        for (const marker of NARRATIVE_MARKERS) expect(comment).not.toMatch(marker)
        for (const line of comment.split('\n'))
          if (STORY_POINTER.test(line)) expect(line).toMatch(TRAILING_POINTER)
        expect(comment).not.toMatch(HISTORY_PHRASES)
      }
    },
  )

  it('SWEPT_FILES covers every required file', () => {
    const missing = REQUIRED_SWEPT.filter(
      (suffix) => !SWEPT_FILES.some((path) => path.endsWith(suffix)),
    )
    expect(missing).toEqual([])
  })

  it('no deliverable or criterion ids in comments', () => {
    const offenders = filesUnder(ID_FREE_ROOTS).filter((path) =>
      commentsOf(path).some((comment) => ID_PATTERN.test(comment)),
    )
    expect(offenders).toEqual([])
  })

  it('no describe title carries a story, deliverable or criterion id', () => {
    const idPatterns = [ID_PATTERN, STORY_POINTER, PADDED_STORY_NUMBER]
    const offenders = testFilesWithDescribes().flatMap((path) =>
      [...readRepoFile(path).matchAll(DESCRIBE_TITLE)]
        .map((match) => match[2])
        .filter((title) => idPatterns.some((pattern) => pattern.test(title)))
        .map((title) => `${path}: ${title}`),
    )
    expect(offenders).toEqual([])
  })

  it('no review-round narrative in comments', () => {
    const offenders = filesUnder(ID_FREE_ROOTS).filter((path) =>
      commentsOf(path).some((comment) => NARRATIVE_MARKERS.some((marker) => marker.test(comment))),
    )
    expect(offenders).toEqual([])
  })

  it('module headers are at most 40 lines and carry no stale claims', () => {
    const headerFiles = [
      'src/main/modules/servers/index.ts',
      'src/main/modules/replays/index.ts',
      'src/renderer/src/modules/index.ts',
      'src/shared/config/profile/profile-restore/index.ts',
      'src/shared/config/render/render.ts',
      'src/main/modules/config/rebuild.ts',
    ]
    const stale = [
      'There is no scanning yet',
      'no process.platform checks',
      'that is a later deliverable',
      'stand-in',
    ]
    for (const path of headerFiles) {
      const header = moduleHeader(path)
      expect(header, path).toBeDefined()
      expect(header!.endLine - header!.startLine + 1, path).toBeLessThanOrEqual(40)
      expect(header!.text, path).not.toMatch(ID_PATTERN)
      for (const line of header!.text.split('\n'))
        if (STORY_POINTER.test(line)) expect(line, path).toMatch(TRAILING_POINTER)
      for (const sentence of stale)
        for (const comment of commentsOf(path)) expect(comment, path).not.toContain(sentence)
    }
  })

  it('the config contract keeps its invariant notes', () => {
    const path = 'src/shared/modules/config.ts'
    const source = readRepoFile(path)
    const lines = source.split('\n')
    const docAbove = (fieldLine: RegExp): string => {
      const index = lines.findIndex((line) => fieldLine.test(line))
      expect(index, String(fieldLine)).toBeGreaterThan(-1)
      const range = commentRanges(source).find((r) => r.endLine === index)
      expect(range, String(fieldLine)).toBeDefined()
      return range!.text
    }
    expect(docAbove(/^ {6}droppedAliases: string\[\]/)).toContain('[]')
    expect(docAbove(/^ {2}messageCount: number/)).toContain('empty `layerAliases`')
    expect(docAbove(/^ {2}ambiguousRebindAliases:/)).toContain('whatever')
    expect(docAbove(/^ {2}ownWrittenFile: boolean/)).toContain('exec')
  })

  it('no comment names a missing locale file or i18n key', () => {
    const fixture = ['// see `downloads.error.noSuchKey` and `downloads.error.allMirrorsFailed`']
    expect(danglingKeys(fixture, en)).toEqual(['downloads.error.noSuchKey'])
    expect(danglingKeys(['// the `runner.unavailable.*` family'], en)).toEqual([])

    const files = sourcesAndScripts()
    const oldFile = files.filter((path) => readRepoFile(path).includes('i18n/locales/en.json'))
    expect(oldFile).toEqual([])
    const dangling = files.flatMap((path) =>
      danglingKeys(commentsOf(path), en).map((key) => `${path}: ${key}`),
    )
    expect(dangling).toEqual([])
  })
})
