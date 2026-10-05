import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect } from 'vitest'
import type { ConfigAction, ConfigProfile } from '@shared/modules/config'
import { actionKeySlots } from '@shared/config/catalog/action-slots'
import { renderProfileFile } from '@shared/config/render/render'
import { readOwnershipStamp } from '@shared/config/render/file-ownership'
import { restoreProfileParts } from '@shared/config/profile/profile-restore'
import { restoredToProfileFields } from '@shared/config/profile/profile-restore-input'
import { ROUND_TRIP_FIXTURES } from '@shared/config/fixtures/profiles'
import { readImportableConfig } from '../core/import-reader'
import { toRestoreInput } from '../import'
import { StateStore } from '../../../services/state'
import { ProfilesStore } from '../profiles'
import { hashCanonicalFileContent } from '../file-source'
import { detectSectionHeaderStyle, detectWriteUnbindall, recoverProfileName } from '../rebuild'
import { installTempDir } from '../../../../test-support/temp-dir'

let getRoot: () => string

/** Every `StateStore` an adopt case opened, settled before the temp directory goes away so no
 * pending `state.json` write outlives it. */
const openStores: StateStore[] = []

/** Registers the per-test temp directory every helper below reads from. Call once at the top level
 * of each test file. */
export function installRoundTripRoot(): void {
  getRoot = installTempDir('q2-launcher-round-trip-')
  afterEach(async () => {
    for (const store of openStores) await store.settle()
    openStores.length = 0
  })
}

/** The per-test temp root `reimport` writes under. */
export function getRoundTripRoot(): string {
  return getRoot()
}

/** Writes `text` as `<root>/baseq2/config.cfg` and reads it back through the real importer. */
export async function reimport(text: string) {
  const gamedir = join(getRoot(), 'baseq2')
  await mkdir(gamedir, { recursive: true })
  await writeFile(join(gamedir, 'config.cfg'), Buffer.from(text, 'latin1'))
  return readImportableConfig(getRoot(), 'baseq2')
}

/**
 * Replaces the profile id - the one identifier the restore never adopts (see the file doc comment)
 * - with a canonical, first-appearance-indexed token, in both of its spellings:
 *
 * replaced the sentinel's trailing clause ("- generated, do not edit" became
 * "- hand-edited changes are read back"), which left this pattern matching nothing at all; it is
 * anchored on the clause's leading `-` only now, the same wording-tolerant rule `ownedProfileId`
 * itself follows. Found by 043 the adversarial pass - harmless while it lasted (both sides of
 * the comparison carry the same profile id), but a normaliser that silently stops normalising is
 * exactly the kind of thing that hides the next real regression.
 *
 * the profile id moved out of that sentinel line and into the header block's own
 * `[q2l v=<n> id=<uuid>]` stamp, so the *same* subject needs normalising in its new spelling - and
 * through the same map, so a legacy-shape file and the banner-shape file it re-renders into
 * canonicalise one id to one token rather than to two. Without this, every case that restores a
 * file into a *fresh* profile record (`restoreFromText` below, which mints an id exactly as a
 * rebuild-from-file does) compares two headers differing in nothing but a `randomUUID` - which is
 * what "the header holds still" would then be measuring.
 *
 * Anchored on the whole `[q2l v=… id=` prefix rather than on `id=` alone, deliberately: `id=` is
 * also perfectly ordinary prose (`bodyProseWithIdProfile` puts it in a category name, an entry
 * name and an unbound line on purpose), and a normaliser that rewrote user text would be able to
 * hide a real regression in exactly the place this story made prose dangerous.
 */
export function canonicalizeProfileId(text: string): string {
  const ids = new Map<string, string>()
  const tokenFor = (value: string): string => {
    if (!ids.has(value)) ids.set(value, `SENTINEL${ids.size}`)
    return ids.get(value)!
  }
  const out = text.replace(
    /(\/\/ q2-launcher profile )(\S+)( -)/,
    (_m, pre, id, post) => `${pre}${tokenFor(id)}${post}`,
  )
  return out.replace(
    /(\[q2l v=\d+ id=)([^\s\]]+)/g,
    (_m, prefix: string, id: string) => `${prefix}${tokenFor(id)}`,
  )
}

export function normalize(text: string): string {
  return canonicalizeProfileId(text)
}

/**
 * One entry's key slots as `KEY` / `MOD+KEY` strings, in slot order.
 *
 * Every slot assertion below goes through this rather than through `entry.keys` directly: slots are
 * an array whose *order* is the whole subject (order is what the file records instead of the removed
 * `slot` field), and reading them through `action-slots.ts`' accessor is the discipline that module
 * asks of every reader.
 */
export function slotsOf(action: ConfigAction): string[] {
  return actionKeySlots(action).map((slot) =>
    slot.modifier ? `${slot.modifier}+${slot.key}` : slot.key,
  )
}

/** Rebuilds a fresh `ConfigProfile` out of one real render->parse pass over `profile`, carrying
 * over only the fields `restoreProfileParts` never claims to recover (see the own doc comment:
 * `id` is reported, never adopted; `writeUnbindall`/`sectionHeaderStyle` carry no tag key in
 * `profile-metadata.ts`'s registry at all). */
export async function reimportProfile(
  profile: ConfigProfile,
): Promise<{ profile2: ConfigProfile; text1: string }> {
  const text1 = renderProfileFile(profile)
  const result = await reimport(text1)
  const restored = restoreProfileParts(toRestoreInput(result, [], randomUUID))

  const profile2: ConfigProfile = {
    id: profile.id,
    name: profile.name,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    cvars: result.cvars,
    binds: result.binds,
    assignments: [],
    categories: restored.categories,
    actions: restored.actions,
    // recovered from the file's own `cvs=`/`cvsub=` banners, exactly like
    // `categories` above. `writeCatalogDefaults` is *not* recovered - like `writeUnbindall` it has
    // no tag key in `profile-metadata.ts`'s registry, so it is carried over rather than read back.
    cvarSections: restored.cvarSections,
    layers: restored.layers,
    writeUnbindall: profile.writeUnbindall,
    writeCatalogDefaults: profile.writeCatalogDefaults,
    sectionHeaderStyle: profile.sectionHeaderStyle,
  }
  return { profile2, text1 }
}

export function findFixture(name: string): ConfigProfile {
  const found = ROUND_TRIP_FIXTURES.find((p) => p.name === name)
  if (!found) throw new Error(`no fixture named "${name}"`)
  return found
}

/** Counts every physically importable config line - used to confirm a mangled variant still
 * imports "no config line dropped" (every cvar/bind/alias survives as *something*, even if its
 * entry attribution degraded). */
export function countConfigLines(result: {
  cvars: Record<string, string>
  binds: Record<string, string>
  aliases: readonly unknown[]
  unrecognized: readonly unknown[]
}): number {
  return (
    Object.keys(result.cvars).length +
    Object.keys(result.binds).length +
    result.aliases.length +
    result.unrecognized.length
  )
}

/**
 * "No config line is silently lost", asserted end to end rather than by counting: restores the
 * parsed result and checks that every `bind` and `alias` line the mangled file still carried
 * reappears in the file the restored profile *re-renders*.
 *
 * That is the strictest form of the claim has to make. `countConfigLines` only says
 * the parser still saw the line; this says the line also survived reconstruction - either owned by
 * an entry, or unowned in an `Other binds` section, or as an alias 041's inference recovered. A
 * mangled tag may legitimately cost a line its *attribution* (the entry row it belonged to); it may
 * never cost the line itself, which is exactly the "costs the entry, never the bind" contract
 * `profile-restore.ts`'s doc comment states.
 *
 * Not byte-identity: a hand-mangled file is not expected to be a fixed point (the whole point of
 * the mangle is that something in it is now different from what the writer would write).
 */
export function expectEveryLineSurvivesRerender(
  result: Awaited<ReturnType<typeof reimport>>,
  rendered: string,
  /** Alias names this case *knowingly* loses, each one named here so a loss is always a statement
   * in the test source rather than a gap in what it checks. Only the truncated-tag case below
   * passes one; see there for the defect it records. */
  knownLostAliases: readonly string[] = [],
): void {
  for (const [key, command] of Object.entries(result.binds)) {
    expect(rendered, `bind ${key} "${command}" is missing from the re-render`).toMatch(
      new RegExp(`^bind\\s+${escapeRegExp(key)}\\s+"?${escapeRegExp(command)}"?`, 'm'),
    )
  }
  for (const alias of result.aliases) {
    if (knownLostAliases.includes(alias.name)) {
      // Held to the *opposite* assertion instead of skipped, so this list can never quietly outlive
      // the defect that justifies it.
      expect(rendered, `alias ${alias.name} was expected to be lost, but survived`).not.toMatch(
        new RegExp(`^alias\\s+${escapeRegExp(alias.name)}\\s`, 'm'),
      )
      continue
    }
    expect(rendered, `alias ${alias.name} is missing from the re-render`).toMatch(
      new RegExp(`^alias\\s+${escapeRegExp(alias.name)}\\s`, 'm'),
    )
  }
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** One render -> parse -> restore pass over hand-mangled `text`, plus the profile that restore
 * rebuilds (same field mapping as `reimportProfile`, minus the render the caller supplies).
 *
 * `cvarSections` is carried for exactly the reason `categories` is - the writer recovers it,
 * and this helper claims `reimportProfile`'s field mapping. Leaving it out was invisible while only
 * bind-side mangles used this helper (there were no cvar sections to lose) and would have made every
 * cvar-side case below assert about the wrong file: the re-render would carry no `cvs=` banner at
 * all, so "does the mangled reading settle" would have been answered for a file that had already
 * thrown the sections away. */
export async function restoreFromText(text: string): Promise<{
  result: Awaited<ReturnType<typeof reimport>>
  restored: ReturnType<typeof restoreProfileParts>
  rerendered: string
}> {
  const result = await reimport(text)
  const restored = restoreProfileParts(toRestoreInput(result, [], randomUUID))
  const rerendered = renderProfileFile({
    id: randomUUID(),
    name: 'Mangled',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cvars: result.cvars,
    binds: result.binds,
    assignments: [],
    categories: restored.categories,
    actions: restored.actions,
    cvarSections: restored.cvarSections,
    layers: restored.layers,
  })
  return { result, restored, rerendered }
}

/**
 * Renders `profile`, reads the text back through the real parser, and adopts the result onto a real
 * `ProfilesStore` record exactly the way `index.ts`'s `refreshFromFiles` does - same field mapping,
 * same header/format recovery, same `adoptFromFile` entry point. Returns the record as the store
 * holds it afterwards.
 *
 * A fresh store per call, so a case can adopt the *same* profile id twice (the convergence case
 * below) without the second round tripping over the first one's record.
 */
export async function adoptRendered(
  profile: ConfigProfile,
): Promise<{ adopted: ConfigProfile; text1: string }> {
  const text1 = renderProfileFile(profile)
  const result = await reimport(text1)
  const restored = restoreProfileParts(toRestoreInput(result, [], randomUUID))

  const store = new StateStore(join(getRoot(), `state-${openStores.length}.json`), {
    migrations: 'none',
  })
  await store.load()
  openStores.push(store)
  const profiles = new ProfilesStore(store)
  // The record as it stood before the file was read back: the very profile `text1` was rendered
  // from, under its own id (`addRebuilt` is the one store entry point that appends a finished record
  // without minting a new one - the id has to match, or the sentinel line alone would make every
  // byte comparison below fail for a reason that has nothing to do with cvars).
  const id = profile.id
  profiles.addRebuilt({ ...profile })
  expect(profiles.find(id)!.cvars).toEqual(profile.cvars)

  const list = profiles.adoptFromFile(
    id,
    {
      name: recoverProfileName(text1) ?? profile.name,
      ...restoredToProfileFields(result.cvars, result.binds, restored),
      writeUnbindall: detectWriteUnbindall(text1),
      sectionHeaderStyle: detectSectionHeaderStyle(text1) ?? profile.sectionHeaderStyle,
    },
    hashCanonicalFileContent(text1),
    Date.now(),
  )
  return { adopted: list.find((p) => p.id === id)!, text1 }
}

/** Every `set` line of a rendered file, in order - the cvar block, alignment included. */
export function setLines(text: string): string[] {
  return text.split('\n').filter((line) => line.startsWith('set '))
}

/** A category id the profile has no category for - `render.ts`'s trailing "other" bucket, which is
 * defined by absence rather than by a stored value, so it has no name to compare. */
export const NO_CATEGORY = '(no category the profile has)'

/**
 * One entry reduced to everything the round trip has to carry: its display name, the *name* of the
 * category it sits in, its catalogue link and its commands.
 *
 * By category name rather than id on purpose: several cases below restore into a *fresh* record or
 * a hand-mangled file, where a category is minted locally (`profile-restore.ts#categoryRegistry`,
 * an id the file no longer states, or states twice, is minted), so comparing ids
 * literally would test the id factory. The *drawer* is what must survive, and its name is what says
 * which drawer it is.
 */
export function entryShapes(profile: ConfigProfile): {
  name: string
  category: string
  catalogId: string | null
  commands: ConfigAction['commands']
}[] {
  const names = new Map((profile.categories ?? []).map((category) => [category.id, category.name]))
  return (profile.actions ?? []).map((entry) => ({
    name: entry.name,
    category: names.get(entry.categoryId) ?? NO_CATEGORY,
    catalogId: entry.catalogId ?? null,
    commands: entry.commands,
  }))
}

/**
 * `entryShapes` sorted by display name - the "no entry merges or disappears" comparison.
 *
 * Sorted, and only sorted, because the *array* order of `profile.actions` is knowingly not preserved
 * across the alias-line/aliasless boundary: `groupEntryLines` discovers every entry that has an alias
 * line before any entry that only has a bind, anchor or unbound line, which is a scan-order choice
 * `fixtures/profiles.ts#catalogueAndUserEntryProfile`'s own comment records and reports separately.
 * That reordering is invisible in the rendered file (the writer derives each section's rows from the
 * entries' contents, so the fixed-point loop above still holds) and it is not what this pass is
 * about. A merge, a drop or a re-filing is - and none of those can hide behind a sort.
 */
export function sortedEntryShapes(profile: ConfigProfile): ReturnType<typeof entryShapes> {
  return [...entryShapes(profile)].sort((a, b) => a.name.localeCompare(b.name))
}

/** Every category the profile carries, as `name` in array order - the order that *is* the file's
 * section order since the writer. */
export function categoryNames(profile: ConfigProfile): string[] {
  return (profile.categories ?? []).map((category) => category.name)
}

/** The header block as the writer draws it - the file's first four lines. */
export function headerOf(text: string): string[] {
  return text.split('\n').slice(0, 4)
}

/**
 * The lines the import dialog would list as **preserved** ("we did not understand this, so we kept
 * it verbatim"): every unrecognised line minus everything `restoreProfileParts` reported as
 * understood.
 *
 * Mirrors `import.ts#preservedLinesFor`, which is module-private - both halves of the subtraction
 * come from real production output, so this is the same statement the writer makes ("the header lines never
 * show up as unrecognised/preserved lines"), computed the same way, rather than a re-reading of the
 * text with the test's own idea of what a header line looks like.
 */
export function preservedLines(
  result: Awaited<ReturnType<typeof reimport>>,
  restored: ReturnType<typeof restoreProfileParts>,
): string[] {
  const consumed = new Set(
    restored.consumedCommentLines.map((position) => `${position.file}:${position.line}`),
  )
  return result.unrecognized
    .filter((line) => !consumed.has(`${line.file}:${line.line}`))
    .map((line) => line.text)
}

/**
 * One render -> parse -> restore -> render pass over `text`, rendered back **the way a rebuild from
 * the file does it**: the id comes from the file's ownership stamp (`readOwnershipStamp`, the writer) and
 * the name from its header (`recoverProfileName`, the writer), exactly as `rebuild.ts#buildRebuiltProfile`
 * takes them.
 *
 * That is what separates this from `restoreFromText` above, which mints a fresh id and a fixed name
 * because its cases are about the file's *body*. Here the header is the subject, so a helper that
 * invented an id would make every assertion about identity vacuous - and "the same id and name come
 * back out" is precisely what the writer promises for a file in the old shape.
 */
export async function rerenderFromFile(text: string): Promise<{
  result: Awaited<ReturnType<typeof reimport>>
  restored: ReturnType<typeof restoreProfileParts>
  rerendered: string
}> {
  const result = await reimport(text)
  const restored = restoreProfileParts(toRestoreInput(result, [], randomUUID))
  const rerendered = renderProfileFile({
    id: readOwnershipStamp(text)?.id ?? randomUUID(),
    // `rebuild.ts#fallbackProfileName` falls back to the file's own base name; the literal below
    // stands in for it, and every case that reaches it says so.
    name: recoverProfileName(text) ?? 'Rebuilt from a nameless header',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cvars: result.cvars,
    binds: result.binds,
    assignments: [],
    categories: restored.categories,
    actions: restored.actions,
    layers: restored.layers,
  })
  return { result, restored, rerendered }
}

/** A section banner as the writer draws it, split into the two halves that mean different things:
 * the title (user prose) and the `[q2l ...]` tag, or `null` for a line that is not a banner.
 *
 * The three strips are the exact inverse of what `cfg-layout.ts#banner`'s `dashes` branch and
 * `render.ts#bannerSection` compose, in reverse order: the variable-length trailing fill (absent
 * when the title already fills the line, which `LONG_CVAR_SECTION_NAME` really does), then the tag,
 * leaving the title. */
export function bannerAt(line: string): { title: string; tag: string | null } | null {
  if (!line.startsWith('// --- ')) return null
  const withoutFill = line.slice('// --- '.length).replace(/ -+$/, '')
  const tag = /( \[q2l[^\]]*\])$/.exec(withoutFill)?.[1] ?? null
  return { title: tag === null ? withoutFill : withoutFill.slice(0, -tag.length), tag }
}

/**
 * Every `set` line of a rendered file as `<cvar name> -> <the section it sits under>|<its value>`.
 *
 * This is what "no cvar moves" is asserted with, and it is strictly stronger than comparing the
 * `set` block alone: two renders can carry byte-identical `set` lines while one of them files a
 * cvar under a different banner, which is exactly the silent regression a section reader can cause.
 *
 * Sections are identified by *title plus whether the banner carried a tag at all*, never by the tag
 * value - an untagged section's id is freshly minted per read, so a literal
 * comparison would test `randomUUID`. The tagged/untagged distinction is kept because it is
 * the entire difference between a user's own section named `Other` and the writer's reserved
 * leftovers bucket of the same name (`literalOtherCvarSectionProfile`).
 */
export function cvarPlacements(text: string): Map<string, string> {
  const placements = new Map<string, string>()
  let current = '<above every banner>'
  for (const line of text.split('\n')) {
    const banner = bannerAt(line)
    if (banner) {
      current = banner.tag === null ? `${banner.title} (untagged)` : banner.title
      continue
    }
    const set = /^set (\S+)\s+"(.*)"$/.exec(line)
    if (set) placements.set(set[1]!, `${current}|${set[2]!}`)
  }
  return placements
}

/** Every `set` line's cvar name, in file order - duplicates included, which is the point. */
export function cvarNames(text: string): string[] {
  return setLines(text).map((line) => /^set (\S+)/.exec(line)![1]!)
}

/**
 * Cvar names a fixture's render KNOWINGLY does not carry, each one named here so a loss is always a
 * statement in this file rather than a gap in what it checks - the same discipline
 * `expectEveryLineSurvivesRerender`'s `knownLostAliases` follows, and held to the opposite
 * assertion below for the same reason.
 *
 * The one entry is the documented trade, not a leak: with `writeCatalogDefaults: false` a catalogue
 * cvar that no section places gets no line at all - not even under `Other`, which is only ever the
 * non-catalogue leftovers bucket. The value stays in the profile's own `cvars` record in
 * `state.json`; what it loses is its trace in the *file*, and therefore its way back into a profile
 * rebuilt from that file. That follows directly from the story's "what Settings shows is what the
 * file gets" (with the toggle off, an unplaced catalogue cvar is shown nowhere), so it is asserted
 * here rather than worked around - but it is asserted where someone changing the toggle will see it.
 */
export const KNOWN_UNWRITTEN_CVARS: Record<string, readonly string[]> = {
  'Unplaced catalogue cvars with the defaults toggle off': ['cl_gun'],
}
