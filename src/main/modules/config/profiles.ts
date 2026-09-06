import { randomUUID } from 'node:crypto'
import {
  STANDARD_TEMPLATE,
  type AssignProfileInput,
  type ConfigAction,
  type ConfigActionCategory,
  type ConfigCvarSection,
  type ConfigProfile,
  type CreateConfigProfileInput,
  type ProfileFileState,
  type RenameConfigProfileInput,
  type RemoveConfigProfileInput,
  type SetDefaultProfileInput,
  type SetProfileActionsInput,
  type SetProfileBindsInput,
  type SetProfileCvarsInput,
  type SetProfileLayersInput,
  type SetSectionHeaderStyleInput,
  type SetWriteCatalogDefaultsInput,
  type SetWriteUnbindallInput,
  type UnassignProfileInput,
  type UnrecognizedConfigLine,
} from '@shared/modules/config'
import type { AltLayer } from '@shared/config/alt-layers'
import type { StateStore } from '../../services/state'
import { applyActionBindMirror } from '@shared/config/action-mirror'
import { adoptRawBinds } from '@shared/config/bind-adoption'
import { stripCatalogDefaults } from '@shared/config/cvar-defaults'
import { applyActionLayerMirror } from '@shared/config/modifier-layers'
import { captureBaseline } from '@shared/config/profile-baseline'
import {
  assign as assignProfile,
  unassign as unassignProfile,
  setDefault as setDefaultProfile,
  reconcileAssignments,
} from './assignments'

/**
 * CRUD over config profiles.
 *
 * Simpler than `InstallationsService`: a profile has no path to canonicalize,
 * nothing to validate against the filesystem, and no uniqueness rule - identity
 * is the generated `id`, and a duplicate name is fine. This is the only thing
 * outside `state.ts`/`schemas.ts` that touches `configProfiles`, including its
 * assignment links to installations (mutated through `./assignments`'s pure
 * functions).
 */
export class ProfilesStore {
  private readonly state: StateStore

  constructor(state: StateStore) {
    this.state = state
  }

  list(): ConfigProfile[] {
    return this.state.configProfiles()
  }

  find(id: string): ConfigProfile | undefined {
    return this.state.configProfiles().find((profile) => profile.id === id)
  }

  create(input: CreateConfigProfileInput): ConfigProfile[] {
    const now = new Date().toISOString()
    const profile: ConfigProfile = {
      id: randomUUID(),
      name: input.name,
      createdAt: now,
      updatedAt: now,
      ...(input.from === 'template'
        ? {
            cvars: { ...STANDARD_TEMPLATE.cvars },
            binds: { ...STANDARD_TEMPLATE.binds },
            // Story 052 D1: the template's own categories/actions, deep-copied (never the shared
            // seed's own arrays/objects - `STANDARD_TEMPLATE` is reused by every "create from
            // template" call) with a fresh id per action so two profiles created from the template
            // never share an action id.
            categories: STANDARD_TEMPLATE.categories.map((category) => ({ ...category })),
            actions: STANDARD_TEMPLATE.actions.map((action) => ({
              ...action,
              id: randomUUID(),
              commands: action.commands.map((command) => ({ ...command })),
            })),
            // Story 059 D1: the template's own cvar sections, deep-copied for the same reason
            // `categories`/`actions` are right above - `STANDARD_TEMPLATE` is one shared, reused
            // object, so a profile must never end up holding its arrays/objects by reference. Ids
            // are stable per group already (`buildTemplateCvarSections`), so - unlike `actions` -
            // there is no per-row id to mint fresh here.
            cvarSections: STANDARD_TEMPLATE.cvarSections.map((section) => ({
              ...section,
              cvars: [...section.cvars],
              ...(section.subsections
                ? { subsections: section.subsections.map((sub) => ({ ...sub, cvars: [...sub.cvars] })) }
                : {}),
            })),
          }
        : { cvars: {}, binds: {} }),
      assignments: [],
    }

    return this.commit([...this.state.configProfiles(), profile])
  }

  /**
   * Creates a profile seeded from an import (story 005) instead of from
   * `STANDARD_TEMPLATE` or empty maps. Same shape and same `commit` path as
   * `create()` - fresh id, both timestamps, no assignments - which is what
   * makes the result an ordinary profile by construction (decision 11):
   * nothing downstream needs to know it came from an import rather than the
   * create-profile dialog.
   *
   * Story 041 (D6): `actions`/`categories`/`layers` - `buildImportedActions`'s
   * result (`import.ts#commitImport`) - are stored alongside `cvars`/`binds`/
   * `unrecognized`, never replacing them; a raw bind that merely *references*
   * one of these alias entries by name is left as a raw bind pointing at it
   * (decision from story 041), which is exactly what `commit`'s
   * `adoptProfileBinds` pass already guarantees: `adoptRawBinds`'s
   * `isAliasReference` check (`@shared/config/bind-adoption`) skips any raw
   * entry whose value is some action's own alias name - imported or not -
   * before it ever consults the catalogue, so this call cannot end up with two
   * entries for one bare-token bind.
   */
  createFromImport(input: {
    name: string
    cvars: Record<string, string>
    binds: Record<string, string>
    unrecognized: UnrecognizedConfigLine[]
    actions: ConfigAction[]
    categories: ConfigActionCategory[]
    layers: AltLayer[]
    /** Story 059 D5: `restoreProfileParts`'s own cvar sections, stored alongside `categories`/
     * `actions` above instead of being silently dropped - the Settings tab's own grouping for an
     * imported profile, filed by the cvar-group banner each `set` line actually sat under in the
     * source file. */
    cvarSections: ConfigCvarSection[]
  }): ConfigProfile[] {
    const now = new Date().toISOString()
    const profile: ConfigProfile = {
      id: randomUUID(),
      name: input.name,
      createdAt: now,
      updatedAt: now,
      cvars: { ...input.cvars },
      binds: { ...input.binds },
      assignments: [],
      unrecognized: input.unrecognized,
      actions: input.actions,
      categories: input.categories,
      layers: input.layers,
      cvarSections: input.cvarSections,
    }

    return this.commit([...this.state.configProfiles(), profile])
  }

  /**
   * Story 043 D3: appends an already-fully-built record - one `rebuild.ts` reconstructed from a
   * launcher-owned `.cfg` file whose `state.json` record was lost or unreadable - through the same
   * `commit()` path `create`/`createFromImport` use, so a rebuilt profile is an ordinary profile by
   * construction (the `adoptRawBinds` pass included) and nothing about its persistence semantics
   * differs from a normally-created one.
   *
   * Deliberately **not** `createFromImport`, and deliberately not id-generating: that path mints a
   * fresh id (story 042 AC4's import rule - importing a foreign file is a new profile), while a
   * rebuild has to keep the id the file's own ownership sentinel carries, or every installation
   * assignment and every other reference to that profile id would break (story 043's own decision:
   * "a rebuild from the launcher's own file keeps the sentinel id"). That is why the two stay
   * separate methods even though both end here.
   *
   * Throws when the store already holds `profile.id`, so this can never produce a second, duplicate
   * record for a profile that is still live - the caller (`rebuild.ts`) already filters those out,
   * and this is the independent net under it.
   */
  addRebuilt(profile: ConfigProfile): ConfigProfile[] {
    if (this.find(profile.id)) throw new Error(`config profile already exists: ${profile.id}`)
    // Story 049 D1: a rebuild reads the file and seeds `fileHash` from it, so it is one of the
    // points the baseline is seeded at too - see `seedBaseline` for why the seeding happens here,
    // after the adoption pass, rather than inside `rebuild.ts#buildRebuiltProfile` next to the hash.
    return this.commit([...this.state.configProfiles(), this.seedBaseline(profile)])
  }

  rename(input: RenameConfigProfileInput): ConfigProfile[] {
    const current = this.find(input.id)
    if (!current) throw new Error(`config profile not found: ${input.id}`)

    const next: ConfigProfile = {
      ...current,
      name: input.name,
      updatedAt: new Date().toISOString(),
    }
    return this.commit(this.state.configProfiles().map((p) => (p.id === next.id ? next : p)))
  }

  remove(input: RemoveConfigProfileInput): ConfigProfile[] {
    const current = this.find(input.id)
    if (!current) throw new Error(`config profile not found: ${input.id}`)

    return this.commit(this.state.configProfiles().filter((p) => p.id !== input.id))
  }

  assign(input: AssignProfileInput): ConfigProfile[] {
    return this.commit(assignProfile(this.list(), input))
  }

  unassign(input: UnassignProfileInput): ConfigProfile[] {
    return this.commit(unassignProfile(this.list(), input))
  }

  setDefault(input: SetDefaultProfileInput): ConfigProfile[] {
    return this.commit(setDefaultProfile(this.list(), input))
  }

  /**
   * Replaces a profile's entire `cvars` map with `input.cvars`. Not a partial
   * merge - the renderer is expected to send the full map it wants persisted
   * (see D4's debounced save), so a caller wanting to keep existing entries
   * must include them.
   *
   * Story 059 D8: `input.cvarSections`, when sent, replaces the profile's own section list the
   * same whole-array way - optional and additive (the shared-layer doc comment on
   * `SetProfileCvarsInput.cvarSections`): a caller not yet updated to send it (every call site
   * before this deliverable) simply omits it, which leaves the profile's stored `cvarSections`
   * untouched rather than wiping it out.
   */
  setCvars(input: SetProfileCvarsInput): ConfigProfile[] {
    const current = this.find(input.profileId)
    if (!current) throw new Error(`config profile not found: ${input.profileId}`)

    const next: ConfigProfile = {
      ...current,
      cvars: { ...input.cvars },
      ...(input.cvarSections !== undefined ? { cvarSections: input.cvarSections } : {}),
      updatedAt: new Date().toISOString(),
    }
    return this.commit(this.state.configProfiles().map((p) => (p.id === next.id ? next : p)))
  }

  /**
   * Replaces a profile's entire `binds` map with `input.binds`. Mirrors
   * `setCvars` exactly - not a partial merge, full-map replace semantics.
   */
  setBinds(input: SetProfileBindsInput): ConfigProfile[] {
    const current = this.find(input.profileId)
    if (!current) throw new Error(`config profile not found: ${input.profileId}`)

    const next: ConfigProfile = {
      ...current,
      binds: { ...input.binds },
      updatedAt: new Date().toISOString(),
    }
    return this.commit(this.state.configProfiles().map((p) => (p.id === next.id ? next : p)))
  }

  /**
   * Replaces a profile's entire `layers` array with `input.layers`. Same
   * replace-whole-array semantics as `setBinds`/`setCvars` above - the
   * renderer sends the full array it wants persisted.
   *
   * Story 016 (decision 18): the incoming array then goes through
   * `applyActionLayerMirror` against the profile's *existing* `actions` before
   * being stored, exactly as `setActions` does below. `layers` is replaced
   * wholesale, so a Layers-panel save that was assembled from a slightly stale
   * profile snapshot would otherwise silently drop the `q2l_a_*` overrides
   * `setActions` derived for every modifier-bound slot - and nothing would turn
   * red, the binds would just stop working. Re-deriving them here makes the
   * mirror an invariant of the persisted state rather than of one write path:
   * whichever of the two setters ran last, the modifier overrides are correct.
   *
   * `input.layers` is the layer *content* authority (names, modes, trigger
   * keys, hand-made overrides) and `current.actions` is the mirror authority -
   * this call never changes `actions`, so it cannot invent an override for a
   * slot the actions array does not carry, and a hand-made override in
   * `input.layers` (any value that is not the key-scoped `bindValueFor` of one
   * of `current.actions`, i.e. not a value `applyActionLayerMirror` itself
   * would have written for that same key) is passed through untouched. The one
   * exception is a value carrying the `LEGACY_ACTION_ALIAS_PREFIX` marker - not
   * an ownership test, just the format an older version of this app generated
   * for this same purpose - which is stripped unconditionally so a pre-039
   * orphan cannot survive a save.
   */
  setLayers(input: SetProfileLayersInput): ConfigProfile[] {
    const current = this.find(input.profileId)
    if (!current) throw new Error(`config profile not found: ${input.profileId}`)

    const next: ConfigProfile = {
      ...current,
      layers: applyActionLayerMirror(input.layers, current.actions ?? [], randomUUID, current.actions ?? []),
      updatedAt: new Date().toISOString(),
    }
    return this.commit(this.state.configProfiles().map((p) => (p.id === next.id ? next : p)))
  }

  /**
   * Replaces a profile's entire `categories` and `actions` wholesale (same
   * replace-whole-array semantics as `setLayers`) and rebuilds the `binds`
   * map's action mirror: every existing bind that is either (a) the key-scoped
   * `bindValueFor` of one of `current.actions` - i.e. a value this same mirror
   * wrote for *that* action on *that* key, current-format, never a bare prefix
   * test - or (b) carries the `LEGACY_ACTION_ALIAS_PREFIX` marker (the format an
   * older version of this app generated for the same purpose, kept recognisable
   * forever so a pre-039 orphan cannot survive a save) is dropped first. An
   * action that lost its key, or was deleted outright, must not leave a stale
   * bind pointing at an alias this save no longer generates. Then one
   * `binds[normalizeBindKey(key)] = aliasNameFor(action)` is written per key an
   * action still carries, in `input.actions` array order - so when two actions
   * land on the same (normalized) key, the later one in the array wins,
   * deterministically. Every other bind (the user's own, hand-typed ones, and
   * anything from an alt layer's own overrides, which live in a separate map
   * entirely) is untouched.
   *
   * Story 015 (decision 1), story 050: "every key an action carries" is every
   * slot of `action.keys` (read through `@shared/config/action-slots`, no cap of
   * two), all of them pointing at the same `aliasNameFor(action)` - the alias is
   * per action, not per slot, so an N-slot row costs one alias and N bind lines. The consequences fall out of that single rule rather than needing
   * their own branches: clearing one slot drops only that key's bind (the whole
   * mirror is rebuilt from the surviving slots anyway), and an action whose two
   * slots normalize to the same key writes that key twice with the same value,
   * which is a no-op rather than a conflict.
   *
   * Story 016 (decisions 17-18) adds the modifier half, and it is deliberately
   * *two* mirrors over the same one loop's worth of information, not one mirror
   * with a branch:
   *
   * - A slot that carries its own `modifier` is skipped by the `binds`
   *   mirror above. Quake 2 has no modifiers, so `Alt+R` is not a bind at all -
   *   it is an override inside the ALT layer. Writing a base `bind r` for it
   *   would make the action fire on bare `r` too, which is precisely the
   *   collision the modifier exists to avoid. The slots are judged
   *   independently: a row can have slot 0 on `Alt+R` and slot 1 on plain
   *   `MOUSE2` at the same time, and each slot's own `modifier` decides only
   *   that slot's own fate.
   * - Skipping is not the same as *dropping*: the strip pass above only removes
   *   a bind that is either the key-scoped mirror value for that same action or
   *   carries the `LEGACY_ACTION_ALIAS_PREFIX` marker, so a user's hand-typed
   *   `bind r "weapnext"` on that same key survives a row moving to `Alt+R`
   *   untouched. What does disappear is the stale generated base bind for a
   *   slot that just *gained* a modifier - it has to, or the key would keep
   *   firing the action without the modifier held.
   * - A `kind: 'alias'` action (story 019) is skipped by both mirrors outright:
   *   it renders as `alias <its own name>` and exists to be *called* by a
   *   binding, so it is never bound to a key nor overridden into a layer. Same
   *   strip-then-skip consequence as above - a row that was a bind and became
   *   an alias loses its generated bind, while a hand-typed bind on that key
   *   stays.
   * - `layers` is rebuilt by `applyActionLayerMirror` (`@shared/config/
   *   modifier-layers`), the exact layer-side counterpart of the `binds` mirror:
   *   same strip-then-rewrite shape, same key-scoped ownership rule plus the
   *   same `LEGACY_ACTION_ALIAS_PREFIX` marker, same later-wins array order.
   *   Hand-made overrides and non-modifier layers are left alone; `randomUUID`
   *   is passed as its id factory so that pure, `src/shared` function stays
   *   free of `node:crypto`.
   */
  setActions(input: SetProfileActionsInput): ConfigProfile[] {
    const current = this.find(input.profileId)
    if (!current) throw new Error(`config profile not found: ${input.profileId}`)

    // Story 034: the two mirrors, both now living in `src/shared` next to
    // `bindValueFor` - the one function that answers what value a mirror writes
    // for an action (see `action-mirror.ts`). The rule itself is unchanged from
    // decision 17; what moved is where it is implemented, so main's write path
    // and the adoption pass in `commit` cannot disagree about it.
    const next: ConfigProfile = {
      ...current,
      categories: [...input.categories],
      actions: [...input.actions],
      binds: applyActionBindMirror(current.binds, input.actions, current.actions ?? []),
      layers: applyActionLayerMirror(current.layers ?? [], input.actions, randomUUID, current.actions ?? []),
      updatedAt: new Date().toISOString(),
    }
    return this.commit(this.state.configProfiles().map((p) => (p.id === next.id ? next : p)))
  }

  /**
   * Sets a profile's `writeUnbindall` flag outright (story 040 D4) - a single boolean, so this is
   * a dedicated setter rather than routed through `setCvars`/`setBinds`/`setLayers`/`setActions`
   * (each of those replaces a whole field of its own). Mirrors `setCvars`/`setBinds` above: throws
   * if the profile is unknown, bumps `updatedAt`, and goes through the same `commit`.
   */
  setWriteUnbindall(input: SetWriteUnbindallInput): ConfigProfile[] {
    const current = this.find(input.profileId)
    if (!current) throw new Error(`config profile not found: ${input.profileId}`)

    const next: ConfigProfile = {
      ...current,
      writeUnbindall: input.writeUnbindall,
      updatedAt: new Date().toISOString(),
    }
    return this.commit(this.state.configProfiles().map((p) => (p.id === next.id ? next : p)))
  }

  /**
   * Sets a profile's `writeCatalogDefaults` flag outright (story 059 D9) - mirrors
   * `setWriteUnbindall` above exactly, just a different boolean field: throws if the profile is
   * unknown, bumps `updatedAt`, and goes through the same `commit`.
   */
  setWriteCatalogDefaults(input: SetWriteCatalogDefaultsInput): ConfigProfile[] {
    const current = this.find(input.profileId)
    if (!current) throw new Error(`config profile not found: ${input.profileId}`)

    const next: ConfigProfile = {
      ...current,
      writeCatalogDefaults: input.writeCatalogDefaults,
      updatedAt: new Date().toISOString(),
    }
    return this.commit(this.state.configProfiles().map((p) => (p.id === next.id ? next : p)))
  }

  /**
   * Sets a profile's `sectionHeaderStyle` outright (story 042 D7) - mirrors `setWriteUnbindall`
   * right above exactly, just a 3-way enum in place of a boolean: throws if the profile is
   * unknown, bumps `updatedAt`, and goes through the same `commit`.
   */
  setSectionHeaderStyle(input: SetSectionHeaderStyleInput): ConfigProfile[] {
    const current = this.find(input.profileId)
    if (!current) throw new Error(`config profile not found: ${input.profileId}`)

    const next: ConfigProfile = {
      ...current,
      sectionHeaderStyle: input.sectionHeaderStyle,
      updatedAt: new Date().toISOString(),
    }
    return this.commit(this.state.configProfiles().map((p) => (p.id === next.id ? next : p)))
  }

  /**
   * Story 049 D3: restores a profile's render-relevant fields to its `baseline` - the "go back to
   * what I last saved" discard, and the only thing that survives the removal of 048's reset
   * affordances.
   *
   * Returns a discriminated outcome rather than throwing for the "nothing to discard from" case
   * (mirrors the story's decision that this must be distinguishable from success, not a silent
   * no-op): `profile.baseline === undefined` - never saved, or a pre-story record that still has
   * `dirty === true` with nothing to fall back to - returns `{ outcome: 'noBaseline' }` and mutates
   * nothing. An unknown `profileId` still throws, exactly like every other setter in this file - it
   * is the same "caller bug" case `rename`/`setCvars`/etc. already treat that way, not a "nothing to
   * discard" state.
   *
   * Deliberately spreads the baseline's fields back onto `current` rather than replacing the whole
   * record: `id`/`createdAt`/`assignments`/`fileHash`/`fileSeenAt`/`fileState`/`baseline` itself all
   * describe something other than "the profile's edited content" (identity, installation links, or
   * the file-on-disk cache) and must survive a discard untouched - discard never writes a file, so
   * the cache describing that file has nothing new to record. `baseline` itself is left as it was:
   * it already describes the same last-saved-or-loaded state, and live state now equals it again.
   *
   * Goes through the same `commit()` every other setter uses (which re-runs `adoptProfileBinds`),
   * so a discarded profile is adopted exactly as it would be if this same content had just been
   * loaded from a file - never a discard-specific code path that could drift from the ordinary one.
   */
  discard(profileId: string): { outcome: 'discarded'; profiles: ConfigProfile[] } | { outcome: 'noBaseline' } {
    const current = this.find(profileId)
    if (!current) throw new Error(`config profile not found: ${profileId}`)
    if (!current.baseline) return { outcome: 'noBaseline' }

    const { baseline } = current
    const next: ConfigProfile = {
      ...current,
      // Review finding (story 049): a `rename` marks the profile dirty and leaves both the header
      // banner and the file rename to the next save (story 043), so an un-restored name is a pending
      // edit the discard would have kept - the one field of the snapshot that is edited outside the
      // config tabs, and no less part of "the last saved state" for it.
      name: baseline.name,
      cvars: { ...baseline.cvars },
      binds: { ...baseline.binds },
      layers: baseline.layers.map((layer) => ({ ...layer, overrides: { ...layer.overrides } })),
      categories: baseline.categories.map((category) => ({ ...category })),
      actions: baseline.actions.map((action) => ({
        ...action,
        commands: action.commands.map((command) => ({ ...command })),
      })),
      // Story 054 D11: `cvarSections` is render-relevant exactly like `categories`/`actions` (story
      // 059 D8 made `setCvars` replace it wholesale) and was missing from this restore entirely - a
      // section/sub-section reorder, or a cvar moved between sections, survived a Discard untouched.
      cvarSections: baseline.cvarSections.map((section) => ({
        ...section,
        cvars: [...section.cvars],
        ...(section.subsections
          ? { subsections: section.subsections.map((sub) => ({ ...sub, cvars: [...sub.cvars] })) }
          : {}),
      })),
      writeUnbindall: baseline.writeUnbindall,
      sectionHeaderStyle: baseline.sectionHeaderStyle,
      unrecognized: baseline.unrecognized.map((line) => ({ ...line })),
      dirty: false,
      updatedAt: new Date().toISOString(),
    }
    return {
      outcome: 'discarded',
      profiles: this.commit(this.state.configProfiles().map((p) => (p.id === next.id ? next : p))),
    }
  }

  /**
   * Story 043 D4: marks whether the profile carries edits that are not in its canonical `.cfg` yet.
   *
   * Same shape as `setWriteUnbindall`/`setSectionHeaderStyle` above (one field, full replace, throws
   * on an unknown id) with one deliberate difference: `updatedAt` is NOT bumped. This flag is the
   * launcher's own bookkeeping about the cache-vs-file relationship, not a user edit - the setter
   * that actually changed the profile's content already stamped the timestamp, and `save` clearing
   * the flag afterwards must not look like a second edit.
   */
  setDirty(profileId: string, dirty: boolean): ConfigProfile[] {
    const current = this.find(profileId)
    if (!current) throw new Error(`config profile not found: ${profileId}`)

    const next: ConfigProfile = { ...current, dirty }
    return this.commit(this.state.configProfiles().map((p) => (p.id === next.id ? next : p)))
  }

  /**
   * Story 043 D2/D4: records that the profile's canonical file was just confirmed to hold exactly
   * `fileHash`'s bytes, at `fileSeenAt` (epoch ms) - the baseline `readFileState` compares the next
   * read against, and the reason the launcher's own write is never mistaken for an external edit.
   *
   * Deliberately does NOT touch `dirty`: the caller is a sync run, which can confirm a *sibling*
   * profile's file (a cascade writes more than one), and clearing that sibling's unsaved-edits flag
   * as a side effect of hashing its file would silently lose the fact that it has unsaved edits.
   * Clearing `dirty` is `save`'s own explicit step, through `setDirty` above. `updatedAt` is not
   * bumped either, same reasoning as `setDirty`.
   *
   * Story 049 D1: this is also where the profile's `baseline` is reseeded, from `current` - the
   * record as it stands, which is exactly what the file was just confirmed to hold (this method is
   * only ever reached from a sync run that wrote or verified those bytes). Every save's write-back
   * comes through here (`index.ts`'s `syncAndPersist` -> `markFileSeen`), so the save path needs no
   * seeding of its own.
   */
  markFileSeen(profileId: string, fileHash: string, fileSeenAt: number): ConfigProfile[] {
    const current = this.find(profileId)
    if (!current) throw new Error(`config profile not found: ${profileId}`)

    const next: ConfigProfile = {
      ...current,
      fileHash,
      fileSeenAt,
      fileState: 'unchanged',
    }
    return this.commit(
      this.state.configProfiles().map((p) => (p.id === next.id ? this.seedBaseline(next) : p)),
    )
  }

  /**
   * Story 043 D5: records `readFileState`'s classification as a display hint only, for the two
   * branches `refreshFromFiles` must never do anything else for:
   *
   * - `missing` - the file is gone outside the launcher; the story's own decision keeps the profile
   *   in the list ("it stays in the list marked 'file missing'"), so this only ever updates
   *   `fileState`, never removes the record.
   * - `unparseable`/`readError` - the last good cache must stay exactly as it was (content, `dirty`,
   *   `fileHash` all untouched) so the profile keeps working off it; only the display hint changes.
   *
   * Deliberately does not bump `updatedAt` (this is launcher bookkeeping about the cache-vs-file
   * relationship, not a user edit - same reasoning as `setDirty`/`markFileSeen` above) and does not
   * touch `dirty`/`fileHash` itself, unlike `markFileSeen`.
   */
  setFileState(profileId: string, fileState: ProfileFileState): ConfigProfile[] {
    const current = this.find(profileId)
    if (!current) throw new Error(`config profile not found: ${profileId}`)

    const next: ConfigProfile = { ...current, fileState }
    return this.commit(this.state.configProfiles().map((p) => (p.id === next.id ? next : p)))
  }

  /**
   * Story 043 D5: overlays freshly-read file content onto an EXISTING profile record - the "adopt"
   * case of `refreshFromFiles` (the file changed on disk, no unsaved edits to lose). Mirrors
   * `rebuild.ts#buildRebuiltProfile`'s field mapping (same fields the file actually carries: the
   * recovered name, `cvars`/`binds`/`actions`/`categories`/`layers`, `writeUnbindall`,
   * `sectionHeaderStyle`) but UPDATES in place rather than constructing a fresh record - unlike a
   * rebuild, an adopt has an existing `id`/`createdAt`/`assignments`/played-mods-adjacent state to
   * keep untouched, so it cannot go through `addRebuilt`/`createFromImport`.
   *
   * `fileHash`/`fileSeenAt` are reseeded from the read that produced `fields` and `fileState`
   * becomes `'unchanged'` (this read IS the new baseline), and `dirty` is left alone - the caller
   * only reaches this method when the profile was not dirty in the first place.
   *
   * `updatedAt` IS bumped: unlike `setFileState`/`setDirty`/`markFileSeen` above (pure cache
   * bookkeeping), this genuinely replaces the profile's content with what is now on disk.
   *
   * ## Story 048 D3: `cvars` is stripped back to the deviations on the way in
   *
   * Since 048 D2 the writer emits a `set` line for EVERY catalogue cvar (`render.ts`'s
   * `buildCvarSections`, `writeValueFor`), so a launcher-written file carries ~30 of them where the
   * profile stored one. Storing that map verbatim would turn "this was a default" into "the user
   * chose this" for every cvar the user never touched - which is what story 049's edited-and-unsaved
   * indicator and story 042 AC3's round-trip both forbid. `stripCatalogDefaults` (048 D1, the same
   * module `writeValueFor` comes from, so the two rules cannot drift) removes exactly the catalogue
   * cvars sitting at `def.default` again, leaving genuine deviations and every foreign/unknown cvar
   * untouched.
   *
   * This is deliberately the *launcher-authored* read-back path only: it is reached from
   * `refreshFromFiles` for a profile's own canonical `.cfg` (the file whose ownership sentinel
   * carries this very `profileId`), never for a foreign config. Importing an external file goes
   * through `createFromImport` above, which keeps what the file said verbatim - a foreign file's
   * values were never produced by the always-write, so there is nothing there to strip back off.
   */
  adoptFromFile(
    profileId: string,
    fields: {
      name: string
      cvars: Record<string, string>
      binds: Record<string, string>
      actions: ConfigAction[]
      categories: ConfigActionCategory[]
      /** Story 059 D3: the cvar sections the file's own banners state, adopted exactly like
       * `categories` - the file is the source of truth for the grouping too. */
      cvarSections: ConfigCvarSection[]
      layers: AltLayer[]
      writeUnbindall: boolean
      sectionHeaderStyle: ConfigProfile['sectionHeaderStyle']
    },
    fileHash: string,
    fileSeenAt: number,
  ): ConfigProfile[] {
    const current = this.find(profileId)
    if (!current) throw new Error(`config profile not found: ${profileId}`)

    const next: ConfigProfile = {
      ...current,
      name: fields.name,
      // Returns a fresh map, so this is the copy `{ ...fields.cvars }` used to make.
      cvars: stripCatalogDefaults(fields.cvars),
      binds: { ...fields.binds },
      actions: fields.actions,
      categories: fields.categories,
      cvarSections: fields.cvarSections,
      layers: fields.layers,
      writeUnbindall: fields.writeUnbindall,
      sectionHeaderStyle: fields.sectionHeaderStyle,
      updatedAt: new Date().toISOString(),
      fileHash,
      fileSeenAt,
      fileState: 'unchanged',
    }
    // Story 049 D1: the second of the two seeding points in this class, and the one AC9 rests on -
    // "take the file" (and the ordinary adopt) must leave the baseline describing the file as it NOW
    // stands, or the very next edit would be measured against a snapshot that predates the external
    // change. Captured from `next`, i.e. from the *stripped* cvars and the adopted fields as they
    // are about to be stored - never from `fields` as read.
    return this.commit(
      this.state.configProfiles().map((p) => (p.id === next.id ? this.seedBaseline(next) : p)),
    )
  }

  /**
   * Commits an already-fully-built profile in place of the one with the same
   * `id` - the smallest thing story 025 D3's `tidyUp.apply` needs, and
   * deliberately *not* a fifth field setter.
   *
   * A tidy-up batch mutates several fields at once (a re-classify writes
   * `unrecognized` plus one of `cvars`/`binds`/`actions`; `unrecognized` has no
   * setter at all otherwise), and it computes the whole next profile in one pure
   * pass (`applyTidyUpOps`, `@shared/config/tidy-up`) precisely so that batch
   * lands as one commit with one `updatedAt`. So this method takes the finished
   * object and does the one thing the four setters above all end in - swap it
   * into the list and `commit` - rather than re-deriving any field logic.
   *
   * `updatedAt` is the *caller's* to set, unlike in the setters above: the
   * timestamp has to be stamped once for the whole batch, and only when
   * something actually applied. Throws when `profile.id` is unknown, same as the
   * setters.
   */
  replaceProfile(profile: ConfigProfile): ConfigProfile[] {
    if (!this.find(profile.id)) throw new Error(`config profile not found: ${profile.id}`)
    return this.commit(this.state.configProfiles().map((p) => (p.id === profile.id ? profile : p)))
  }

  reconcile(knownInstallationIds: string[]): ConfigProfile[] {
    return this.commit(reconcileAssignments(this.list(), knownInstallationIds))
  }

  /**
   * The single write funnel - and, since story 034, the place the
   * "`actions` is the only authority for a catalogue bind" invariant is
   * enforced rather than merely intended.
   *
   * Every profile about to be persisted goes through `adoptRawBinds`
   * (`@shared/config/bind-adoption`): a raw `bind w "+forward"` - hand-bound on
   * the Overview keyboard, seeded from `STANDARD_TEMPLATE`, or read out of an
   * imported `config.cfg` - becomes the Movement row's own `ConfigAction`, so
   * the keyboard and the Controls grid can no longer show two different answers
   * for one key. Same reasoning `setLayers` gives for re-deriving the layer
   * mirror on both write paths: an invariant of the persisted state beats an
   * invariant of one code path.
   *
   * Idempotent, so running it on every commit (including the ones that only
   * touch assignments) costs a pass over the binds map and changes nothing when
   * there is nothing to adopt. `updatedAt` is deliberately not bumped: adoption
   * is a re-encoding of what the profile already said, not a user edit.
   */
  private commit(profiles: ConfigProfile[]): ConfigProfile[] {
    return this.state.setConfigProfiles(profiles.map((profile) => adoptProfileBinds(profile)))
  }

  /**
   * Story 049 D1: `profile` with its `baseline` reseeded - the one place that snapshot is taken, so
   * the three seeding call sites above (`markFileSeen`, `adoptFromFile`, `addRebuilt`) cannot
   * disagree about how.
   *
   * The `adoptProfileBinds` call is the whole reason this is a helper rather than a `captureBaseline`
   * at each call site. `commit` runs that pass over every profile it persists, so the record that
   * actually lands in `state.json` is the *adopted* one; a snapshot taken before it would differ from
   * the stored profile in `binds`/`actions`/`layers` the moment there was anything to adopt - which
   * is precisely the case the two file-reading seeders produce (a hand-added `bind w "+forward"` in
   * the file becomes the Movement row's action on the way in). The result would be a profile that
   * reports unsaved changes the instant it was loaded, and a discard that undoes the adoption.
   * Adoption is idempotent, so doing it here and again in `commit` costs one pass over the binds map
   * and changes nothing else.
   */
  private seedBaseline(profile: ConfigProfile): ConfigProfile {
    const adopted = adoptProfileBinds(profile)
    return { ...adopted, baseline: captureBaseline(adopted) }
  }
}

/**
 * `adoptRawBinds` applied to a whole profile, keeping the profile's own
 * reference when there was nothing to adopt (the common case) so a commit that
 * changes nothing else really does hand `state.ts` the same objects back.
 */
export function adoptProfileBinds(profile: ConfigProfile): ConfigProfile {
  const result = adoptRawBinds(profile, randomUUID)
  if (result.adopted === 0) return profile
  return { ...profile, binds: result.binds, layers: result.layers, actions: result.actions }
}
