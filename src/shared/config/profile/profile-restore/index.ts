/**
 * Profile restore: a launcher-written config's metadata + its config lines -> profile parts.
 *
 * The profile file travels through six stages; this folder owns the middle ones. Pure data in,
 * `newId` injected, parts out - no `node:*`, no DOM, no electron - so the import preview (renderer)
 * and the commit (main) agree byte-for-byte about what a file restores to.
 *
 * - parse:   `config-parser.ts`/`import-reader.ts` hand back lines and `[q2l ...]` comments;
 *            `comment-parse.ts` reads one comment into a tag, `comment-scan.ts` turns all of them
 *            into positional sections, the version marker and diagnostics.
 * - fold:    `entry-grouping.ts` groups alias/bind/anchor/unbound lines into one `EntryGroup` per
 *            entry, by what the config text says; `entry-build.ts` folds `_p<n>`/`_c<n>` chunks back
 *            into one body and builds a `ConfigAction` from a group; `two-part.ts` merges the toggle
 *            trio and the `+x`/`-x` pair into one entry.
 * - restore: `layers.ts` rebuilds layers from their section and alias lines and hands modifier
 *            overrides back to the entries they bind; `categories.ts` and `cvar-sections.ts` mint
 *            or adopt grouping ids; `restoreProfileParts` below drives all of it.
 * - store:   the caller (`import.ts`) persists the result and reads `profile.binds`/`profile.cvars`
 *            from the parsed lines directly, independent of anything here.
 * - render:  `render.ts` writes the file from the profile, tags included.
 * - sync:    an unchanged file re-reads to the same profile, so render(restore(text)) === text.
 *
 * The one rule: the config line wins over its tag. A tag records what the UI knew; the config line
 * is what the engine reads. Where they disagree the line wins and the discrepancy is a warning. A
 * malformed tag degrades one line to inference, never fails the file and never drops the bind.
 *
 * A file with no tag at all is foreign and delegates wholesale to `buildImportedActions`.
 */

import { buildImportedActions } from '@shared/config/aliases/alias-import'
import { parseMetaTag } from '@shared/config/profile/profile-metadata'
import type { ConfigAction, ConfigActionCategory, ConfigCvarSection } from '@shared/modules/config'
import { categoryRegistry } from './categories'
import { TAG_SIGIL } from './comment-parse'
import { scanComments, type CommentScan } from './comment-scan'
import { cvarSectionRegistry } from './cvar-sections'
import { buildEntry } from './entry-build'
import { applyForeignSubcategoryHeuristic, groupEntryLines } from './entry-grouping'
import { buildLayer, restoreModifierSlots } from './layers'
import { buildTwoPartEntry } from './two-part'
import {
  sectionFor,
  type RestoreAliasLine,
  type RestoreProfilePartsInput,
  type RestoreProfilePartsResult,
  type RestoreWarning,
} from './types'

export type {
  RestoreSourcePosition,
  RestoreAliasLine,
  RestoreBindLine,
  RestoreCvarLine,
  RestoreCommentLine,
  RestoreProfilePartsInput,
  RestoreWarningReason,
  RestoreWarning,
  RestoreProfilePartsResult,
} from './types'
export { RESTORE_WARNING_KEYS } from './types'
export { foreignBannerCommentText } from './comment-parse'

/**
 * The cvar sections, attributed in a pass of their own: a `set` line carries no tag, and a foreign
 * `.cfg`'s group banners are the untagged case. Callers run it **last** - it mints ids from the
 * caller's one `newId` sequence, and minting earlier would shift every id after it (and, on the
 * untagged path, the ids the delegation would hand out on its own).
 */
function readCvarSections(input: RestoreProfilePartsInput, scan: CommentScan): ConfigCvarSection[] {
  const registry = cvarSectionRegistry(input.newId, scan.sections)
  for (const cvar of input.cvars) {
    // Placement is decided by the name's FIRST occurrence, never the winning (last-assignment-wins)
    // one `cvar` itself points at - see `RestoreCvarLine`.
    const position =
      cvar.firstFile !== undefined && cvar.firstLine !== undefined
        ? { file: cvar.firstFile, line: cvar.firstLine }
        : cvar
    registry.place(sectionFor(scan.sections, position), cvar.name)
  }
  return registry.created()
}

/** No `[q2l` anywhere: a foreign config. No ids are minted before the delegation. */
function restoreForeign(
  input: RestoreProfilePartsInput,
  scan: CommentScan,
): RestoreProfilePartsResult {
  const delegated = buildImportedActions({
    aliases: input.aliases.map(({ name, body, file, line }) => ({ name, body, file, line })),
    binds: Object.fromEntries(input.binds.map((bind) => [bind.key, bind.command])),
    layerAliases: input.layerAliases,
    newId: input.newId,
  })
  const { actions, categories } = applyForeignSubcategoryHeuristic(
    delegated,
    input.aliases,
    scan.sections,
    input.newId,
  )
  return {
    actions,
    categories,
    cvarSections: readCvarSections(input, scan),
    layers: delegated.layers,
    ambiguous: delegated.ambiguous,
    warnings: [],
    sourceProfileId: scan.sourceProfileId,
    metadataVersion: null,
    consumedCommentLines: [],
  }
}

/** Tags but no marker: the header's `[q2l v=...]` was hand-deleted. The tags are read anyway. */
function warnMissingVersion(
  input: RestoreProfilePartsInput,
  scan: CommentScan,
  warnings: RestoreWarning[],
): void {
  if (scan.version !== null) return
  const first = input.comments[0]
  warnings.push({
    reason: 'metadata-version-missing',
    file: first?.file ?? '',
    line: first?.line ?? 0,
  })
}

/**
 * A hand-added `alias` with no `[q2l` tag is inferred like a foreign one. `layerAliases: []` on
 * purpose: the tagged path reports no `ambiguous` list, and `binds` is the full map so a layer's
 * `triggerKey` resolves.
 */
function delegateUntaggedAliases(
  input: RestoreProfilePartsInput,
  untaggedAliases: readonly RestoreAliasLine[],
  actions: ConfigAction[],
): ConfigActionCategory[] {
  if (untaggedAliases.length === 0) return []
  const delegated = buildImportedActions({
    aliases: untaggedAliases.map(({ name, body, file, line }) => ({ name, body, file, line })),
    binds: Object.fromEntries(input.binds.map((bind) => [bind.key, bind.command])),
    layerAliases: [],
    newId: input.newId,
  })
  actions.push(...delegated.actions)
  return [...delegated.categories]
}

/** Cvar lines carry no tag of their own; the only thing to report is a hand-edited `[q2l`. */
function warnMalformedCvarTags(input: RestoreProfilePartsInput, warnings: RestoreWarning[]): void {
  for (const cvar of input.cvars) {
    const parsed = parseMetaTag(cvar.comment)
    if (parsed.malformed)
      warnings.push({ reason: 'tag-malformed', file: cvar.file, line: cvar.line })
  }
}

function restoreTagged(
  input: RestoreProfilePartsInput,
  scan: CommentScan,
): RestoreProfilePartsResult {
  const warnings = [...scan.warnings]
  warnMissingVersion(input, scan, warnings)

  const categories = categoryRegistry(input.newId, scan.sections)
  const layerSections = scan.sections.filter((section) => section.kind === 'layer')

  const consumedCommentLines = [...scan.consumed]
  const { groups, untaggedAliases, merges } = groupEntryLines(
    input.aliases,
    input.binds,
    input.comments,
    layerSections,
    scan.sections,
    warnings,
    consumedCommentLines,
  )
  // A group no merge consumed goes through `buildEntry` as a plain alias entry; a shape the
  // recogniser rejects raises no warning here - no tag and config line disagree about it.
  const mergeByPrimary = new Map(merges.map((merge) => [merge.primary, merge]))
  const consumedGroups = new Set(merges.flatMap((merge) => merge.consumed))

  const actions: ConfigAction[] = []
  for (const group of groups) {
    const merge = mergeByPrimary.get(group)
    if (merge) {
      actions.push(buildTwoPartEntry(merge, scan.sections, categories, input.newId, warnings))
      continue
    }
    // A consumed non-primary group already lives inside the merged entry's `parts`.
    if (consumedGroups.has(group)) continue
    actions.push(buildEntry(group, scan.sections, categories, input.newId, warnings))
  }

  const delegatedCategories = delegateUntaggedAliases(input, untaggedAliases, actions)

  const takenLayerIds = new Set<string>()
  const layers = layerSections.map((section) =>
    buildLayer(section, scan.sections, input, warnings, takenLayerIds),
  )

  restoreModifierSlots(actions, layers)
  warnMalformedCvarTags(input, warnings)

  return {
    actions,
    categories: [...categories.created(), ...delegatedCategories],
    cvarSections: readCvarSections(input, scan),
    layers,
    ambiguous: [],
    warnings,
    sourceProfileId: scan.sourceProfileId,
    metadataVersion: scan.version?.value ?? null,
    consumedCommentLines,
  }
}

/**
 * Rebuilds a profile's entries, categories and layers from a launcher-written config's metadata,
 * reconciled against its config lines - or, for a file that carries no metadata at all, by
 * delegating to `buildImportedActions`.
 *
 * The profile `id` is never adopted: the file's own is *reported* as `sourceProfileId`. Entry ids
 * are always minted from `newId`; grouping ids (layer, category, sub-category, cvar section and
 * sub-section) are adopted from the file's tags when well-formed and unique within it, and minted
 * otherwise (`adoptableId`).
 */
export function restoreProfileParts(input: RestoreProfilePartsInput): RestoreProfilePartsResult {
  const scan = scanComments(input.comments)
  const taggedLines = [...input.aliases, ...input.binds, ...input.cvars].some((line) =>
    line.comment.includes(TAG_SIGIL),
  )
  return !scan.anyTag && !taggedLines ? restoreForeign(input, scan) : restoreTagged(input, scan)
}
