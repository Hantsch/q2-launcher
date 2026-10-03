/** The profile file format's written vocabulary: the literals the writer emits and the reader recognises. */

import type { EngineKind } from '@shared/types/engine'
import { limitsFor } from './engine-limits'

/** The engines `engine-limits.ts` carries source-cited line-budget facts for. Repeated here as a
 * literal (rather than imported) because that module's own backing array is private - same
 * precedent `cvar-facts.ts`'s `ENGINE_KINDS_WITH_FACTS` sets. */
const ENGINES_WITH_LINE_LIMITS: readonly EngineKind[] = ['r1q2', 'q2pro', 'vanilla']

/**
 * The strictest (smallest) per-line byte budget across every engine this app has facts for.
 * `render.ts` is engine-agnostic - a profile is not tied to one engine at render time - so a line
 * has to fit the tightest of the three, not just whichever engine the profile happens to target
 * today (story 040's Decisions). Computed rather than hardcoded so a future engine addition with a
 * smaller line budget is picked up automatically; currently 1024 on all three
 * (`engine-limits.ts`'s `CBUF_LINE_BYTES`). Cvar `set` lines carry no trailing comment in this
 * deliverable, so nothing here calls `attachComment` with it yet - it exists for the bind/alias
 * sections story 040 D3 adds on top of this file.
 */
export const STRICTEST_LINE_BUDGET = Math.min(
  ...ENGINES_WITH_LINE_LIMITS.map((engine) => limitsFor(engine)!.maxLineBytes),
)

/**
 * The budget `attachComment` is actually given for a trailing `// <label>` (story 040 D3).
 *
 * One byte below `STRICTEST_LINE_BUDGET`, because `maxLineBytes` is an *exclusive* bound
 * everywhere else in this codebase: `validate-structure.ts` reports `lineTooLong` at
 * `latin1ByteLength(rawLine) >= limits.maxLineBytes`, and `alt-layers.ts`/`alias-render.ts` keep a
 * whole 16 bytes of headroom below it for the separator the engine appends. `attachComment` fills
 * its budget exactly when it truncates, so handing it the raw 1024 would let a comment produce a
 * line of exactly 1024 bytes - a line the writer's own validator then flags as an error. Only the
 * decoration is squeezed by this; the command part is never measured against it at all (see
 * `attachComment`'s own contract), so an over-long *command* stays over-long and visible rather
 * than being silently cut.
 *
 * Exported because `profile-restore.ts` has to be able to tell a
 * display prose this budget *cut* on one line apart from a genuinely different prose on another, and
 * the only honest way to do that is to measure against the very number the writer measured against.
 */
export const COMMENT_LINE_BUDGET = STRICTEST_LINE_BUDGET - 1

/**
 * Plain ASCII sentence the header block carries - phrased as a general caution.
 *
 * Exported so `profile-restore.ts` can recognise the header block's fixed
 * four-line shape (rule / name+tag / this sentence / rule) as understood decoration rather than an
 * unrecognised leftover - the same reason it already imports `OWNERSHIP_MARKER` from here.
 */
export const HAND_EDIT_SENTENCE = 'Q2 Launcher - hand-edited changes to this file are read back'

/**
 * The two spaces plus `// ` `attachTaggedComment` puts between a line's code and its comment body.
 * Exported for the same reason `COMMENT_LINE_BUDGET` is - a reader reconstructing how much room a
 * line had for its prose has to subtract exactly what the writer added.
 */
export const COMMENT_PREFIX = '  // '

/**
 * Banner label for actions whose `categoryId` matches neither a built-in category nor one of
 * `profile.categories` (a category the user removed while its entries stayed behind). Plain ASCII,
 * same rule as `OTHER_CVAR_GROUP_LABEL`, and deliberately not routed through `categoryLabelFor` -
 * "other" is not a category id, it is the absence of one.
 *
 * Exported so `profile-restore.ts` can recognise this
 * reserved, non-user-configurable title on read-back regardless of `sectionHeaderStyle` - `plain`
 * style's banner (`// Aliases: Other`) carries no decoration at all, so `BANNER_RULE` can never
 * flag it as a section on its own, and even where a style's decoration lets `BANNER_RULE` notice it
 * (`dashes`/`brackets`), the generic untagged-section path would otherwise *mint* a brand new,
 * really-existing category named "Other" - which is a real category the original profile never
 * had, and a categoryId that no longer matches nothing on the next render, breaking AC2's
 * fixed point. Recognising the label lets the reconstruction hand the entry a
 * fresh, never-registered id instead (see `profile-restore.ts#categoryRegistry`), which continues
 * to match nothing on the very next render, exactly like the original orphaned id it stands in for.
 */
export const OTHER_CATEGORY_LABEL = 'Other'

/** Banner title for the binds no action owns - hand-typed, imported, or left behind by a deleted
 * entry. Distinct from a `Binds: Other` section (an *owned* bind whose owner's category is gone):
 * these have no owning entry at all, and therefore no display name to comment with. Exported for
 * the same reason `OTHER_CATEGORY_LABEL` is. */
export const UNOWNED_BINDS_LABEL = 'Other binds'

/** Reserved id for the auto-generated `Defaults` bucket (story 059 D2's "ON writes them into one
 * trailing, reserved auto-section 'Defaults'") - never a real entry in `profile.cvarSections`, and
 * never minted as one on read (that reader-side rule is D3's job; this constant only has to exist
 * so the writer's tag and D3's special-case agree on the same string). Exported for that reason -
 * a future `profile-restore.ts` has to recognise exactly this id, not a re-derived copy of it. */
export const CVAR_DEFAULTS_SECTION_ID = 'defaults'

/**
 * Prefix every q2-launcher-generated file starts with. Used both to write the
 * sentinel line and, by the writer, to detect "is this a file we generated
 * previously" (vs. the user's own hand-written file) - the prefix is checked,
 * not the whole line, because the loader file's sentinel legitimately carries a
 * *different* profile id across saves (whichever profile is the installation's
 * current default) and must still be recognised as ours.
 */
export const OWNERSHIP_MARKER = '// q2-launcher profile'
