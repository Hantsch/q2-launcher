/**
 * The "last saved/loaded" snapshot a profile is measured against (story 049 D1).
 *
 * Since story 043 the `.cfg` is the source of truth and saving is an explicit act, so "this profile
 * carries unsaved edits" is a real state - and answering *which* edits are unsaved needs something
 * to compare the live profile against. That something is a `ProfileBaseline`: the render-relevant
 * subset of the profile as it stood the last time the launcher and the file agreed about it.
 *
 * Why a stored subset of the profile rather than the baseline file *text* (story 049, Decisions):
 * the profile record already travels to the renderer with every `list`, so a structured before/after
 * ("`sensitivity` 3 -> 4.5") and a discard need no second fetch channel and no re-parse of a `.cfg`.
 * The subset is exactly the set of fields a save would put in that file - `name`, `cvars`, `binds`,
 * `layers`, `categories`, `actions`, `writeUnbindall`, `sectionHeaderStyle`, `unrecognized` - so a
 * change to anything in it is a change the file does not have yet, and a change to anything outside
 * it (assignments, played mods, the file-state cache) is not.
 *
 * `name` is in the subset (review finding, story 049) even though it is edited from the profile list
 * rather than from a config tab: it is real file content twice over - `render.ts`'s
 * `buildHeaderBlock` prints it in the header banner, and a save renames the canonical `.cfg` to
 * match - and story 043 decided a `rename` only marks the profile dirty, leaving both to the next
 * save. A baseline without it meant a discard restored every cvar, bind, action and layer but left
 * the profile renamed, which is not "the last saved state" (AC6).
 *
 * `cvarSections` (story 054 D11) is the same kind of render-relevant field as `categories`: story
 * 059 D8 made `setCvars` replace it wholesale, alongside the cvar values `cvars` already covered, so
 * a section/sub-section move (or a cvar moved between sections) is exactly as much "not in the file
 * yet" as a cvar value edit is - and `discard()` restoring `categories`/`actions` but not
 * `cvarSections` would put every Controls row back where it was while leaving Settings' own grouping
 * wherever the unsaved edit had left it. `id` is the one field a save writes that is deliberately
 * absent: it is never editable, so it can never differ from its baseline.
 *
 * Pure by contract, like every other `src/shared/config` module: no node, no DOM, no electron.
 */

import type {
  ConfigAction,
  ConfigActionCategory,
  ConfigCvarSection,
  ConfigProfile,
  UnrecognizedConfigLine,
} from '../modules/config'
import type { AltLayer } from './alt-layers'

/**
 * The render-relevant subset of a `ConfigProfile`, **normalised**: every field is present, so a
 * consumer (the diff of D2, the discard of D3) never has to repeat the `?? []` / `!== false` /
 * `?? 'dashes'` reads that the optional fields on `ConfigProfile` require.
 *
 * That normalisation is not a liberty: it is the same resolution the rest of the codebase already
 * performs at every use site (`current.actions ?? []` in `profiles.ts`, `writeUnbindall !== false`
 * and `sectionHeaderStyle ?? 'dashes'` in `render.ts`, and the persisted schema's own
 * `.catch(() => [])` / `.catch(true)` / `.catch('dashes')` defaults, which mean a profile that has
 * been through `state.json` even carries them explicitly). Capturing the resolved values is what
 * keeps a profile whose `layers` key is merely absent from reading as "the layers changed" against a
 * baseline that spells out `[]`.
 */
export interface ProfileBaseline {
  /** The only member needing no normalisation: `name` is required on `ConfigProfile`, with no
   * optional/default-value story of its own to resolve. */
  name: string
  cvars: Record<string, string>
  binds: Record<string, string>
  layers: AltLayer[]
  categories: ConfigActionCategory[]
  actions: ConfigAction[]
  cvarSections: ConfigCvarSection[]
  writeUnbindall: boolean
  /** Kept in lockstep with the field it snapshots rather than restating the three literals. */
  sectionHeaderStyle: NonNullable<ConfigProfile['sectionHeaderStyle']>
  unrecognized: UnrecognizedConfigLine[]
}

/**
 * Snapshots `profile`'s render-relevant fields.
 *
 * Deep-copied down to every mutable container it hands out - the maps, the arrays, each layer's
 * `overrides`, each action's `commands` - and for one specific reason: the live profile the caller
 * just captured from goes on being edited in place-ish (`{ ...current, cvars: { ...input.cvars } }`
 * and friends), and a baseline that shared a nested object with it would silently follow those
 * edits, which is precisely the "there are no unsaved changes" lie this whole feature exists to
 * prevent. The explicit spread-per-level style (rather than `structuredClone`) is the same one the
 * store's setters use, and it keeps the copy typed.
 *
 * The rows themselves are copied shallowly *below* those containers only where nothing mutable is
 * left: a `ConfigCommand`, a `ConfigActionCategory` and an `UnrecognizedConfigLine` are flat records
 * of primitives.
 */
export function captureBaseline(profile: ConfigProfile): ProfileBaseline {
  return {
    name: profile.name,
    cvars: { ...profile.cvars },
    binds: { ...profile.binds },
    layers: (profile.layers ?? []).map((layer) => ({
      ...layer,
      overrides: { ...layer.overrides },
    })),
    categories: (profile.categories ?? []).map((category) => ({ ...category })),
    actions: (profile.actions ?? []).map((action) => ({
      ...action,
      commands: action.commands.map((command) => ({ ...command })),
    })),
    cvarSections: (profile.cvarSections ?? []).map((section) => ({
      ...section,
      cvars: [...section.cvars],
      ...(section.subsections
        ? { subsections: section.subsections.map((sub) => ({ ...sub, cvars: [...sub.cvars] })) }
        : {}),
    })),
    // The same two reads `render.ts` performs, so the snapshot says what the file would have said.
    writeUnbindall: profile.writeUnbindall !== false,
    sectionHeaderStyle: profile.sectionHeaderStyle ?? 'dashes',
    unrecognized: (profile.unrecognized ?? []).map((line) => ({ ...line })),
  }
}
