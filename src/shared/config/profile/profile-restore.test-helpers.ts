import { BANNER_WIDTH, banner, fitProseAndTag } from '@shared/config/syntax/cfg-layout'
import { actionKeySlots } from '@shared/config/catalog/action-slots'
import { META_FORMAT_VERSION, formatMetaTag } from '@shared/config/profile/profile-metadata'
import {
  restoreProfileParts,
  type RestoreProfilePartsInput,
  type RestoreProfilePartsResult,
} from '@shared/config/profile/profile-restore'
import type { ActionKeySlot, ConfigAction } from '@shared/modules/config'

/** Deterministic ids, so a case can pin which category or layer an entry points at. */
export function idFactory(): () => string {
  let n = 0
  return () => `id${(n += 1)}`
}

/**
 * A document builder that produces exactly the shapes the parser hands over for a file the writer wrote:
 * comment-only lines with their line numbers, and cvar/bind/alias lines carrying the raw text after
 * their `//` marker (leading space included, as `config-parser.ts` slices it).
 *
 * Banner lines go through `cfg-layout.ts`'s own `banner`/`fitProseAndTag`, and every tag through
 * `formatMetaTag`, so a case is pinned against the writer's real decoration and the real grammar
 * rather than against a hand-typed imitation of them.
 */
export interface DocBuilder {
  input: (extra?: Partial<RestoreProfilePartsInput>) => RestoreProfilePartsInput
  restore: () => RestoreProfilePartsResult
  comment: (text: string) => void
  version: (value?: number) => void
  sentinel: (profileId: string) => void
  bannerHeader: (profileId: string, name?: string) => void
  headerRule: () => void
  headerTag: (fields: Record<string, string>) => void
  header: (title: string, tag?: string) => void
  alias: (name: string, body: string, comment?: string, codeWidth?: number) => void
  bind: (key: string, command: string, comment?: string) => void
  cvar: (name: string, value: string, comment?: string) => void
}

export function doc(file = 'q2l-profile-src.cfg'): DocBuilder {
  let line = 0
  const comments: RestoreProfilePartsInput['comments'][number][] = []
  const aliases: RestoreProfilePartsInput['aliases'][number][] = []
  const binds: RestoreProfilePartsInput['binds'][number][] = []
  const cvars: RestoreProfilePartsInput['cvars'][number][] = []

  const at = (): { file: string; line: number } => ({ file, line: (line += 1) })

  const self: DocBuilder = {
    comment: (text: string): void => void comments.push({ ...at(), text }),
    version: (value = META_FORMAT_VERSION): void =>
      self.comment(`  My Profile ${formatMetaTag({ v: String(value) })}`),
    sentinel: (profileId: string): void =>
      self.comment(` q2-launcher profile ${profileId} - generated, do not edit`),
    /** One `=`-rule line of the header block, from `banner`'s own `fill: '='` output. */
    headerRule: (): void => self.comment(banner([''], { fill: '=' })[0]!.slice(2)),
    /** The header block's tag-only last line (story 051, `render.ts#headerTagLine`): the tag
     * alone, right-aligned so its closing `]` lands on `BANNER_WIDTH`. */
    headerTag: (fields: Record<string, string>): void => {
      const tag = formatMetaTag(fields)
      self.comment(`${' '.repeat(BANNER_WIDTH - 2 - tag.length)}${tag}`)
    },
    /** The whole story-051 header block, exactly the four lines `render.ts#buildHeaderBlock`
     * writes: `=` rule, profile name, `=` rule, `[q2l v=… id=…]` tag alone on the last line. */
    bannerHeader: (profileId: string, name = 'My Profile'): void => {
      const [topRule, nameLine, bottomRule] = banner([name], { fill: '=' })
      self.comment(topRule!.slice(2))
      self.comment(nameLine!.slice(2))
      self.comment(bottomRule!.slice(2))
      self.headerTag({ v: String(META_FORMAT_VERSION), id: profileId })
    },
    /** A section banner exactly as `render.ts#titledSection` renders it, marker stripped. */
    header: (title: string, tag = ''): void =>
      self.comment(banner(fitProseAndTag(title, tag, 300))[0]!.slice(2)),
    /** `codeWidth` is what the parser measures off the raw line - omitted by every case that does
     * not care, exactly as a caller with no raw line to measure omits it. */
    alias: (name: string, body: string, comment = '', codeWidth?: number): void =>
      void aliases.push({
        ...at(),
        name,
        body,
        comment,
        ...(codeWidth === undefined ? {} : { codeWidth }),
      }),
    bind: (key: string, command: string, comment = ''): void =>
      void binds.push({ ...at(), key, command, comment }),
    cvar: (name: string, value: string, comment = ''): void =>
      void cvars.push({ ...at(), name, value, comment }),
    input: (extra: Partial<RestoreProfilePartsInput> = {}): RestoreProfilePartsInput => ({
      aliases,
      binds,
      cvars,
      comments,
      newId: idFactory(),
      ...extra,
    }),
    restore: (): RestoreProfilePartsResult => restoreProfileParts(self.input()),
  }
  return self
}

/**
 * The trailing comment of a line the writer tagged: prose, then the tag, after one space.
 *
 * Story 050: an entry line always carries a tag even with no fields at all, because the tag's mere
 * presence is what marks the line as the launcher's own (`render.ts#entryTag`) - `tagged('X', {})`
 * renders exactly that bare `[q2l]` marker, and every case below that omits it is testing an
 * *untagged* line on purpose.
 */
export function tagged(prose: string, fields: Record<string, string | undefined> = {}): string {
  const tag = formatMetaTag(fields)
  return prose.length > 0 ? ` ${prose} ${tag}` : ` ${tag}`
}

/** An entry's key slots as `(key, modifier)` pairs, which is what almost every case here asserts on
 * - read through the accessor rather than off `action.keys`, same discipline as production code. */
export function slotsOf(action: ConfigAction | undefined): ActionKeySlot[] {
  return [...actionKeySlots(action!)]
}

/** Just the keys of an entry's slots, in slot order. */
export function keysOf(action: ConfigAction | undefined): string[] {
  return slotsOf(action).map((slot) => slot.key)
}
