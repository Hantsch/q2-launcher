import { join } from 'node:path'
import { REPO_ROOT, UI_VERIFY_ROOT, assertInside } from '../paths.mjs'
import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { variantUserDataDir } from '../harness.mjs'
import {
  DEFAULT_SETTINGS,
  FIXED_TIMESTAMP,
  INSTALL_ONE_ID,
  INSTALL_TWO_ID,
  LEGACY_SEED_SCHEMA_VERSION,
  STATE_FILE,
  WINDOW_STATE_FILE,
  gameRoot,
  rmDirBestEffort,
  windowStateDocument,
  writeJson,
} from './core.mjs'
import { REPLAYS_FIXTURE_EXTRA_GAME_DIR } from './replays.mjs'
import {
  RETAIL_PAK_SIZES,
  vendoredWindowsExtractorExists,
  vendoredWindowsExtractorPath,
  writeSizedFile,
} from './bootstrap.mjs'

// --- installation.ts Installation shape ------------------------------------
// Mirrors src/shared/types/installation.ts:68 (`Installation`).

export function makeInstallation({
  id,
  name,
  rootPath,
  writeDirPath,
  favorite,
  sortOrder,
  gameDirs,
  engineKind,
  icon,
  status,
  checks,
  lastFailure,
  // Story 093 D7: an optional recorded `executablePath` - `undefined` for every caller that
  // predates this story (the hard-coded default below), so only the repair fixtures that need
  // `inspectInstallation` to compare a STALE recorded path against what it finds on disk
  // (`validation.executableMissing`) pass one.
  executablePath,
  // Story 087 D1: both default to the all-unplayed behavior every existing caller relies on, so
  // only a caller that passes them explicitly seeds a "filled" playtime/last-session state.
  lastPlayedAt,
  totalPlaytimeSeconds,
  // Story 092 D8: mirrors `icon`/`lastFailure`'s spread-only-when-present convention -
  // `Installation.moduleData` (`src/shared/types/installation.ts`). Only
  // `INSTALL_ENGINE_UPDATE_ID` below passes one (its recorded, out-of-date engine version, the
  // shape `readEngineState`/`writeEngineState` - `src/main/services/
  // engine-state.ts` - read/write under `moduleData['downloads']`); every other caller stays
  // `undefined`, exactly as before this story.
  moduleData,
  // Story 094 D4: an optional `InstallationSource` override, defaulting to the `'manual'` every
  // existing caller relied on before this story - only `INSTALL_REMOVE_STORE_ID` below passes
  // `'steam'`, so `isStoreManaged()` has a real store-managed fixture to gate on.
  source,
}) {
  return {
    id,
    name,
    rootPath,
    ...(writeDirPath ? { writeDirPath } : {}),
    // Story 065 D5: `engineKind` became a parameter (defaulting to the `r1q2` every caller
    // relied on before) purely so `INSTALL_UNKNOWN_ENGINE_ID` below can be a non-r1q2 install.
    engineKind: engineKind ?? 'r1q2',
    executablePath,
    launchArgs: [],
    activeGameDir: '',
    detectedVersion: undefined,
    source: source ?? 'manual',
    // Story 077 D5: `status`/`checks` became parameters (defaulting to the `ok`/`[]` every caller
    // relied on before) purely so `INSTALL_FAILED_ID` below can seed an honest `invalid` verdict -
    // the real app's own startup `validateAll()` re-derives both from the folder on disk anyway
    // (`main/index.ts`), so this only matters for a reader of the raw fixture `state.json` itself.
    status: status ?? 'ok',
    checks: checks ?? [],
    gameDirs: gameDirs ?? ['baseq2'],
    favorite,
    sortOrder,
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    lastValidatedAt: undefined,
    lastPlayedAt: lastPlayedAt ?? undefined,
    totalPlaytimeSeconds: totalPlaytimeSeconds ?? 0,
    ...(moduleData ? { moduleData } : { moduleData: undefined }),
    // Story 067 D5: mirrors src/shared/types/installation.ts's `InstallationIcon` -
    // `{ kind: 'shipped', id }` or `{ kind: 'custom' }`. Only set for the two installations
    // `populatedInstallations()` below wires up; every other caller (including
    // `controlsSeedStateDocument()`'s install) passes nothing and stays iconless.
    ...(icon ? { icon } : {}),
    // Story 077 D5: mirrors `icon`'s spread-only-when-present convention - `InstallationLastFailure`
    // (`src/shared/types/installation.ts`), `{ errorKey, at, jobId }`. Only `INSTALL_FAILED_ID` below
    // carries one; every other installation stays exactly as it rendered before this story (AC8).
    ...(lastFailure ? { lastFailure } : {}),
  }
}

/**
 * Story 067 D5: the shipped icon id `INSTALL_ONE_ID` is seeded with - one of the six basenames
 * under `src/renderer/src/assets/installations/` (`installation-icons.ts`'s `SHIPPED_ICONS`).
 * Exported so `scripts/flows/installation-icon-tile.mjs` asserts against the exact id the fixture
 * wrote rather than a copy that can drift.
 */
export const INSTALL_ONE_ICON_ID = 'gate'

/**
 * Story 067 D5: the smallest possible well-formed PNG - enough for `installations:iconDataUrl`
 * (D4) to read a real file back and for the rendered `<img>` to have a genuine `data:image/png;...`
 * source, without the fixture needing an image-encoding dependency.
 *
 * A single *opaque* pixel (RGB 255,90,31 - this app's own `flame` accent colour), not a
 * transparent one (review finding F5, story 067): a fully transparent pixel renders as an empty
 * box in every screenshot the D5/D6 flows take, which proves the plumbing (a real file is read and
 * delivered as a `data:` URL) but not that a real user image would actually be visible on the tile.
 */
export const CUSTOM_ICON_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4HyUPAAPUAXnNtuHVAAAAAElFTkSuQmCC'

/**
 * Story 065 D5: a third populated installation whose only job is to make AC3 ("an `unknown`
 * engine still gets a labelled badge") and AC4 ("a long name truncates, the badge stays
 * visible") reachable in the real app at all - the two installs above are both `r1q2` with
 * short names, and `CreateInstallationDialog` needs a native folder dialog the harness cannot
 * drive, so there is no other way to get either case in front of a flow.
 *
 * Additive by design: every harness selector addresses an installation by its display label
 * (`scripts/lib/screens.mjs`'s `selectOption({ label: 'Fixture WriteDir Install' })`), never by
 * index or count, and this install is assigned to no config profile, so nothing that iterates
 * a profile's assignments (Files rows, `engineScope`, `RawFileTab`'s per-installation section)
 * gains a row either.
 */
export const INSTALL_UNKNOWN_ENGINE_ID = 'fixture-install-unknown-long-name'

/**
 * 156 characters, exported so `scripts/flows/engine-badge-surfaces.mjs` selects on the exact
 * same literal the fixture wrote rather than a copy that can drift.
 *
 * The length is not decorative and is not "100+ because the story said so": AC4 is only proven
 * where the name element genuinely reports `scrollWidth > clientWidth`. The 320px assignments
 * popover clips anything past roughly 40 characters, but `InstallationProfilesPanel`'s row in
 * the config list is a `flex flex-wrap` box ~704px wide at the app's minimum window size, and a
 * ~100-character name measured exactly 704px there - it fitted, the badge simply wrapped to a
 * second line, and nothing truncated. This length clears that row's full width with margin, so
 * the long name truncates (rather than the row growing) on every surface the flow visits.
 */
export const INSTALL_UNKNOWN_ENGINE_NAME =
  'Fixture Unknown Engine Install With A Deliberately Very Long Display Name That Must Truncate Instead Of Pushing The Engine Badge Out Of Any Narrow Panel Row'

/** Story 042 D6: the second gamedir under `INSTALL_TWO_ID` that holds the own-file (launcher
 * "restore") fixture config, distinct from `baseq2`'s foreign-config fixture above. */
export const RESTORE_GAME_DIR = 'q2l-restore-fixture'

/**
 * Story 077 D5: a fourth installation carrying a `lastFailure` - a bootstrap job that failed and,
 * per that story's own decision, left its registration behind instead of deleting it. Its own doc
 * comment on `populatedInstallations()`'s fourth entry below explains the additive rule this
 * follows; see that entry for what it proves and why its own doc comment (not this one) is where
 * the reasoning belongs.
 */
export const INSTALL_FAILED_ID = 'fixture-install-failed'

/**
 * The i18n key `INSTALL_FAILED_ID` carries as its `lastFailure.errorKey` - a real, existing key
 * from `src/renderer/src/i18n/locales/en.json` ("Every download source failed. Check your
 * connection and try again."), not an invented one. Exported so both the seeded fixture row and
 * `scripts/flows/bootstrap-failure-retry.mjs` (whose own 404-both-URLs fixture-server option
 * produces this exact key via `fetcher.ts`'s `allMirrorsFailed` exit) can assert against the same
 * literal rather than two copies that could drift apart.
 */
export const INSTALL_FAILED_ERROR_KEY = 'downloads.error.allMirrorsFailed'

/**
 * Story 090 D6: a fifth installation - `scripts/flows/retail-upgrade.mjs`'s own demo installation,
 * real files on disk (never a hand-set status/checks): a demo-sized `pak0.pak` so
 * `inspectInstallation` derives `validation.pak0NotRetail` for real (`isDemoData`,
 * `src/renderer/src/lib/demo-data.ts`), an `r1q2.exe` marker so `classifyEngine`/`rankExecutables`
 * find both a known engine and a real executable (keeping every OTHER check clean, so this
 * installation's status is a plain `ok` before the upgrade rather than `invalid` for unrelated
 * reasons), and a marker file elsewhere in `baseq2` the upgrade must never touch (AC4). Additive,
 * the same convention `INSTALL_UNKNOWN_ENGINE_ID`/`INSTALL_FAILED_ID` document above: `sortOrder: 4`
 * puts it last, and it is assigned to no config profile.
 */
export const INSTALL_DEMO_UPGRADE_ID = 'fixture-install-demo-upgrade'

export const INSTALL_DEMO_UPGRADE_NAME = 'Fixture Demo Upgrade Install'

/** A file inside `baseq2`, deliberately not one of `UPGRADE_PAK_NAMES` (`pak0.pak`/`pak1.pak`,
 * `src/main/modules/downloads/retail/upgrade-job.ts`) - the retail-upgrade flow's on-disk proof
 * that the job touches only the two paks it is allowed to (AC4). */
export const RETAIL_UPGRADE_MARKER_FILE = 'q2l-fixture-marker.cfg'

export const RETAIL_UPGRADE_MARKER_CONTENT =
  '// q2launcher fixture marker - must survive the retail upgrade untouched\n'

/**
 * Story 092 D8: a sixth installation - `scripts/flows/engine-update.mjs`'s own already-registered,
 * already-playable Q2PRO installation, seeded directly with a recorded engine version older than
 * the fixture manifest's own pin (`buildBootstrapPackages()`'s engine package, `version: 'fixture-1'`
 * - see `startBootstrapFixtureServer()` below) so `engine.updateStatus` reports `updateAvailable:
 * true` from the very first render, no bootstrap wizard run needed (Decisions (Sprint): "seeds an
 * out-of-date installation into the fixture ... instead of bootstrapping one first"). Additive, the
 * same convention `INSTALL_DEMO_UPGRADE_ID` documents just above: `sortOrder: 5` puts it last, and
 * it is assigned to no config profile.
 *
 * `moduleData` records the OLD version directly (`ENGINE_UPDATE_OLD_VERSION`) - the exact shape
 * `readEngineState()` (`src/main/services/engine-state.ts`) reads back under
 * `moduleData['downloads']`. Retail-sized `pak0.pak`/`pak1.pak`/`pak2.pak` (truncated, never real
 * bytes - the same trick `writeRetailSourceTree()` uses below) keep `inspectInstallation` reporting a
 * plain `ok` status with no demo-data check, so this installation reads as an ordinary, already-
 * working install rather than a demo one.
 */
export const INSTALL_ENGINE_UPDATE_ID = 'fixture-install-engine-update'

export const INSTALL_ENGINE_UPDATE_NAME = 'Fixture Engine Update Install'

/** The recorded "current" engine version this installation starts on - older than the fixture
 * manifest's own pin (`'fixture-1'`), so an update is available without any network comparison. */
export const ENGINE_UPDATE_OLD_VERSION = 'fixture-engine-old'

/**
 * Every `role: 'engine'` file `buildBootstrapPackages()`'s Q2PRO package carries, by its own
 * ARCHIVE-relative path (mirrors `BOOTSTRAP_FIXTURE_LAYOUT.engine` above - what the allowlist's
 * `from` candidates find in the extracted staging tree) - `sizeBytes`/`fillByte` are the exact bytes
 * the REAL fixture archive extracts onto these paths, so `engine-update.mjs` can assert the on-disk
 * result of a real update against the same literals the archive itself is built from, rather than a
 * second guess that could drift. Exported so `buildBootstrapPackages()` below and the flow's own
 * assertions share one definition.
 */
export const ENGINE_FIXTURE_FILES = {
  'q2pro64.exe': { sizeBytes: 96 * 1024, fillByte: 0x4d },
  'baseq2/gamex86_64.dll': { sizeBytes: 32 * 1024, fillByte: 0x44 },
  'baseq2/q2pro.menu': { sizeBytes: 512, fillByte: 0x4e },
}

/**
 * Where each `ENGINE_FIXTURE_FILES` archive path actually lands ONCE INSTALLED - `assemble.ts`'s
 * `buildQ2proEngineEntries()` renames the executable candidate it found (`q2pro.exe`/`q2pro64.exe`)
 * to `ENGINE_DEFINITIONS`'s own canonical name for Q2PRO (`q2pro.executables[0]`, `'q2pro.exe'`) -
 * the other two files keep their archive spelling. `update-job.ts`'s `engineAllowlistFor()` walks
 * that SAME allowlist, so this is also the spelling the update job looks for on an existing
 * installation and the spelling its backup slot files land under - a fixture installation whose
 * on-disk executable were still called `q2pro64.exe` would never be found or backed up at all.
 */
export const ENGINE_INSTALLED_RELATIVE = {
  'q2pro64.exe': 'q2pro.exe',
  'baseq2/gamex86_64.dll': 'baseq2/gamex86_64.dll',
  'baseq2/q2pro.menu': 'baseq2/q2pro.menu',
}

/** The fill byte this installation's engine files start on - distinct from every fill byte in
 * `ENGINE_FIXTURE_FILES` above, so a byte-for-byte read of any of the three files unambiguously
 * tells "still the old build" apart from "the update/rollback already touched this file". */
export const ENGINE_UPDATE_OLD_FILL_BYTE = 0x30

// --- story 093 D7: five additive repair-flow installations (the sixth, demo-pak0/AC3, reuses
// `INSTALL_DEMO_UPGRADE_ID` above verbatim rather than duplicating it) ---------------------------
//
// `scripts/flows/repair.mjs` needs each fixture's finding to be reachable through a REAL trigger
// (the action bar's primary button, gated on `isPlayable(installation.status)`, or the checks
// list's own `fix: 'install-game-files'` button) - not just present in `installation.checks`. Two
// real constraints from `src/main/services/inspector.ts`/`src/renderer/src/lib/status.ts` shaped
// every one of these:
//
//   1. `isPlayable()` treats `warning` (and `ok`) as playable, so the action bar only ever shows
//      Repair for a `status: 'invalid'` (an `error`-severity check) or `'missing'` installation. A
//      warn/info-only finding (`executableMissing`, `pointReleaseMissing`, `pak0NotRetail`,
//      `retailPaksMissing`, `notWritable`) is real and repairable, but reaches the dialog only
//      through the checks list - never the action bar.
//   2. `classifyEngine()` only recognises r1q2/q2pro by one of THEIR OWN executable file names
//      being present at the root - so once every such file is gone, a fresh inspection reports
//      `engineKind: 'unknown'` and raises `validation.noExecutable` (error). `buildRepairPlan`'s
//      `reinstall-engine` gate (`src/main/modules/downloads/repair/plan.ts`) asks the manifest about
//      the installation's *recorded* `engineKind`, not that fresh one, so `noExecutable` and "the
//      manifest can supply this installation's engine" CAN co-occur in the real app (see
//      `plan.test.ts`'s "gates reinstall-engine on the recorded engine kind..."). This flow doesn't
//      build that exact fixture, though: AC1 here is built as `validation.executableMissing` (a
//      STALE recorded `executablePath` next to a DIFFERENT, still-present engine file -
//      `r1q2ded.exe`, which is both an r1q2 marker and, being the only `.exe` on disk, the fallback
//      executable, so the fresh and recorded engine kind stay equal) - paired with an empty `baseq2`
//      (`pak0Missing`, error) purely so the installation's overall status is `invalid` and the action
//      bar's Repair button exists to click at all. Both offers (`reinstall-engine` and `retail-copy`)
//      end up on the same plan; the flow only ever drives the one each AC is about.

export const INSTALL_REPAIR_ENGINE_ID = 'fixture-install-repair-engine'

export const INSTALL_REPAIR_ENGINE_NAME = 'Fixture Repair Engine Install'

export const INSTALL_REPAIR_POINT_RELEASE_ID = 'fixture-install-repair-point-release'

export const INSTALL_REPAIR_POINT_RELEASE_NAME = 'Fixture Repair Point Release Install'

export const INSTALL_REPAIR_RETAIL_ID = 'fixture-install-repair-retail'

export const INSTALL_REPAIR_RETAIL_NAME = 'Fixture Repair Retail Install'

export const INSTALL_REPAIR_WRITEDIR_ID = 'fixture-install-repair-writedir'

export const INSTALL_REPAIR_WRITEDIR_NAME = 'Fixture Repair WriteDir Install'

export const INSTALL_REPAIR_UNREPAIRABLE_ID = 'fixture-install-repair-unrepairable'

export const INSTALL_REPAIR_UNREPAIRABLE_NAME = 'Fixture Repair Unrepairable Install'

/**
 * A real, never-created path under the machine's genuine `%ProgramFiles%` - the same "a real
 * unelevated Program Files path is not writable by this test's own user account" fact
 * `bootstrapProgramFilesProbePath()` documents and `bootstrap-wizard.mjs` relies on, applied here
 * as an installation's *recorded* `writeDirPath` rather than a wizard target. Deliberately never
 * created (unlike a real write-dir): `isWritableDir()` (`src/main/lib/fs-utils.ts`) is a plain
 * `fs.access(target, W_OK)` that fails closed on a non-existent path exactly as it does on a
 * genuinely locked-down one, so this is deterministic on every machine this flow runs on -
 * elevated or not - rather than depending on this specific process's own Program Files ACLs.
 */
export function repairNonWritableDir() {
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
  return join(programFiles, 'Q2 Launcher UI Verify Fixture Repair', 'writedir')
}

// --- story 094 D4: two additive installations for `installation-remove-from-disk.mjs` -----------
//
// `INSTALL_REMOVE_STORE_ID` is a plain, playable `source: 'steam'` installation - store-managed
// (`isStoreManaged`), so its remove dialog only ever offers entry-only removal plus the store note
// (AC4). `INSTALL_REMOVE_DISK_ID` is a plain, playable `source: 'manual'` installation - the one the
// flow actually deletes from disk (AC1-AC3, AC5/AC6), reused for the running-game refusal check
// (`dev:simulateLaunch`) before the flow restores `idle` and proceeds with the real deletion, per
// this deliverable's own plan (simpler than a third fixture). Both mirror the simplest existing
// entry (`INSTALL_ONE_ID`'s shape, minus the icon/playtime specifics) and are additive: last
// `sortOrder`s, assigned to no config profile, the same convention every fixture since 090 documents.

export const INSTALL_REMOVE_STORE_ID = 'fixture-install-remove-store'

export const INSTALL_REMOVE_STORE_NAME = 'Fixture Remove Store Install'

export const INSTALL_REMOVE_DISK_ID = 'fixture-install-remove-disk'

export const INSTALL_REMOVE_DISK_NAME = 'Fixture Remove Disk Install'

/**
 * A sentinel file in a directory that sits NEXT TO (not inside) `INSTALL_REMOVE_DISK_ID`'s own
 * `rootPath` - `writePopulatedFixture()` writes it below, and
 * `scripts/flows/installation-remove-from-disk.mjs` reads it back after deleting that
 * installation's folder to prove AC3's "nothing outside that folder is touched": a plain sibling
 * directory, not a subfolder, so a mis-scoped `fs.rm` that walked one level too far would still be
 * caught.
 */
export function installRemoveDiskSiblingSentinelPath() {
  return join(gameRoot(), `${INSTALL_REMOVE_DISK_ID}-sibling`, 'sentinel.txt')
}

export const INSTALL_REMOVE_DISK_SIBLING_SENTINEL_CONTENT =
  '// q2launcher fixture sentinel - must survive installation-remove-from-disk untouched\n'

export function populatedInstallations() {
  return [
    makeInstallation({
      id: INSTALL_ONE_ID,
      name: 'Fixture Favorite Install',
      rootPath: join(gameRoot(), INSTALL_ONE_ID),
      favorite: true,
      sortOrder: 0,
      // Story 067 D5: a shipped icon, resolved by `useInstallationIcon` synchronously (no IPC) -
      // see `INSTALL_ONE_ICON_ID` for why `gate` specifically.
      icon: { kind: 'shipped', id: INSTALL_ONE_ICON_ID },
      // Story 087 D1: the one installation seeded with real playtime, so the library stats' new
      // `lastSession` and the existing playtime tile both show a "filled" state rather than every
      // fixture install reading as never-played. `FIXED_TIMESTAMP` (also `createdAt`/`updatedAt`
      // above) keeps this reproducible across `ui:verify` runs - never `Date.now()`.
      lastPlayedAt: FIXED_TIMESTAMP,
      totalPlaytimeSeconds: 13500, // 3h 45m
    }),
    makeInstallation({
      id: INSTALL_TWO_ID,
      name: 'Fixture WriteDir Install',
      rootPath: join(gameRoot(), INSTALL_TWO_ID),
      writeDirPath: join(gameRoot(), INSTALL_TWO_ID, 'writedir'),
      favorite: false,
      sortOrder: 1,
      // Story 067 D5: a custom icon - `writeCustomIconFile()` below writes the matching PNG into
      // this variant's userData at `installation-icons/<INSTALL_TWO_ID>.png`, which
      // `installations:iconDataUrl` (D4) reads back. `INSTALL_UNKNOWN_ENGINE_ID` below stays
      // iconless on purpose, so the fixture also proves the code-tile fallback still renders.
      icon: { kind: 'custom' },
      // Story 042 D6: a second gamedir, `RESTORE_GAME_DIR`, holding a launcher-written
      // (own-file) fixture config alongside the plain `baseq2` foreign-config one - `baseq2`
      // always sorts first (decision 12), so this is additive and does not change what
      // `config-import-preview`/`config-import-review` auto-select.
      //
      // Story 141 D5 appends `REPLAYS_FIXTURE_EXTRA_GAME_DIR` ('ctf') as a THIRD entry, purely so
      // `scripts/flows/replays-discovered-list.mjs` has a second, non-`baseq2` game dir to find a
      // demo under. 'ctf' is one of `KNOWN_GAME_DIRS` (`src/shared/constants.ts`), so
      // `inspectInstallation`'s `isGameDir` (`src/main/services/inspector.ts`) recognises it purely
      // by name and keeps it in `gameDirs` across the app's own startup `validateAll()`
      // revalidation, unlike `RESTORE_GAME_DIR` above (an arbitrary name, kept only because nothing
      // in this fixture ever re-derives it live before the flows that read it run). No existing
      // reader of this installation's `gameDirs` (grepped: no flow/test asserts its exact array or
      // length) is affected by the addition - `config-import*` no longer even has a gamedir
      // `<select>` to auto-select from (story 066 D8 retired it).
      gameDirs: ['baseq2', RESTORE_GAME_DIR, REPLAYS_FIXTURE_EXTRA_GAME_DIR],
    }),
    // Story 065 D5 - see `INSTALL_UNKNOWN_ENGINE_ID`/`INSTALL_UNKNOWN_ENGINE_NAME` above.
    // `sortOrder: 2` puts it last in the rail/library order, so the two installs the existing
    // screens and flows already reach stay exactly where they were.
    makeInstallation({
      id: INSTALL_UNKNOWN_ENGINE_ID,
      name: INSTALL_UNKNOWN_ENGINE_NAME,
      rootPath: join(gameRoot(), INSTALL_UNKNOWN_ENGINE_ID),
      engineKind: 'unknown',
      favorite: false,
      sortOrder: 2,
    }),
    // Story 077 D5 - see `INSTALL_FAILED_ID`/`INSTALL_FAILED_ERROR_KEY` above. ADDITIVE, following
    // the same convention `INSTALL_UNKNOWN_ENGINE_ID` documents just above: `sortOrder: 3` puts it
    // last, after every installation already in this array, and it is assigned to no config
    // profile, so nothing that iterates a profile's assignments gains a row either. Nothing about
    // the three installations above changes.
    //
    // This is what proves AC1's "after an app restart" e2e half (`npm run ui:verify
    // --screens=library`): a `state.json` written with a `lastFailure` already on it, the app
    // boots from THAT file (never clicking through a wizard), and the library still shows the
    // badge, the translated reason and a disabled Play button - and AC8, since the three
    // installations above render exactly as they did before this story alongside it. The real
    // failing *run* (create -> fail -> retry -> succeed) is proven separately, by
    // `scripts/flows/bootstrap-failure-retry.mjs` against a FRESH installation that flow creates
    // itself - this row is deliberately not reused for that, since AC1's restart proof needs a
    // failure that was never observed live by this session, only read back from disk.
    makeInstallation({
      id: INSTALL_FAILED_ID,
      name: 'Fixture Failed Install',
      rootPath: join(gameRoot(), INSTALL_FAILED_ID),
      engineKind: 'q2pro',
      favorite: false,
      sortOrder: 3,
      // `writePopulatedFixture()` below gives this installation's root folder no `baseq2` at all -
      // the same shape `bootstrap/job.ts`'s failure cleanup leaves behind (D2's `removeAssembled`
      // `rmdir`s an emptied `baseq2` away once the target root itself stays) - so `status: 'invalid'`
      // here matches what the real app's own startup `validateAll()` will re-derive from that folder
      // a moment later, rather than disagreeing with it for one render.
      status: 'invalid',
      gameDirs: [],
      lastFailure: {
        errorKey: INSTALL_FAILED_ERROR_KEY,
        at: Date.parse(FIXED_TIMESTAMP),
        jobId: 'fixture-bootstrap-job-failed',
      },
    }),
    // Story 090 D6 - see INSTALL_DEMO_UPGRADE_ID above. `checks` is seeded here to mirror exactly
    // what a live `inspectInstallation()` produces for the real, on-disk demo-sized `pak0.pak`
    // `writePopulatedFixture()` writes below (`validation.pak0NotRetail`, info severity -
    // `src/main/services/inspector.ts`) - NOT left to the real app's own startup `validateAll()` to
    // derive, unlike `INSTALL_FAILED_ID` above. That startup revalidation is asynchronous
    // (`did-finish-load`), and this flow's very first assertion (AC1's trigger visibility) cannot
    // race it: `isDemoData()` reads `installation.checks` straight from whatever `state.json` seeded,
    // and a flow that only clicked through the UI fast enough would otherwise see `checks: []` and
    // no trigger at all, depending on timing this repo's harness does not guarantee. Seeding the
    // pre-derived value here is the same trick `status: 'invalid'` uses for `INSTALL_FAILED_ID`
    // above, just applied to `checks` too because this story's very first assertion needs it, not
    // only its status dot.
    makeInstallation({
      id: INSTALL_DEMO_UPGRADE_ID,
      name: INSTALL_DEMO_UPGRADE_NAME,
      rootPath: join(gameRoot(), INSTALL_DEMO_UPGRADE_ID),
      engineKind: 'r1q2',
      // Story 093 D1 (already done): the real inspector now puts `fix: 'install-game-files'` on
      // this message key too - mirrored here so this hand-seeded array matches what a live
      // `inspectInstallation()` produces, which is what `scripts/flows/repair.mjs` (093 D7) needs
      // for its own demo-pak0 (AC3) case: the checks list's fix button only appears when `fix` is
      // present.
      checks: [
        {
          id: 'base-paks',
          severity: 'info',
          messageKey: 'validation.pak0NotRetail',
          fix: 'install-game-files',
        },
      ],
      favorite: false,
      sortOrder: 4,
    }),
    // Story 092 D8 - see INSTALL_ENGINE_UPDATE_ID above.
    makeInstallation({
      id: INSTALL_ENGINE_UPDATE_ID,
      name: INSTALL_ENGINE_UPDATE_NAME,
      rootPath: join(gameRoot(), INSTALL_ENGINE_UPDATE_ID),
      engineKind: 'q2pro',
      favorite: false,
      sortOrder: 5,
      moduleData: { downloads: { version: ENGINE_UPDATE_OLD_VERSION } },
    }),
    // Story 093 D7 - see the block comment above `INSTALL_REPAIR_ENGINE_ID` for why this finding
    // is `executableMissing` (a stale recorded `executablePath`), not `noExecutable`.
    //
    // `status`/`checks` are seeded directly, byte-for-byte what a live `inspectInstallation()`
    // produces for the real files `writePopulatedFixture()` writes below (measured, not guessed -
    // the same `installations:validate` call this flow itself could make) - not left for the app's
    // own startup `validateAll()` to derive: that revalidation is asynchronous
    // (`did-finish-load`), and was measured to still be unfinished 8s into a fresh launch with
    // eleven installations to re-check, which every one of `scripts/flows/repair.mjs`'s assertions
    // would otherwise race. The same trick `INSTALL_FAILED_ID`/`INSTALL_DEMO_UPGRADE_ID` already use.
    makeInstallation({
      id: INSTALL_REPAIR_ENGINE_ID,
      name: INSTALL_REPAIR_ENGINE_NAME,
      rootPath: join(gameRoot(), INSTALL_REPAIR_ENGINE_ID),
      engineKind: 'r1q2',
      executablePath: join(gameRoot(), INSTALL_REPAIR_ENGINE_ID, 'r1q2.exe'),
      status: 'invalid',
      checks: [
        {
          id: 'base-paks',
          severity: 'error',
          messageKey: 'validation.pak0Missing',
          fix: 'install-game-files',
        },
        {
          id: 'executable',
          severity: 'warn',
          messageKey: 'validation.executableMissing',
          params: { path: join(gameRoot(), INSTALL_REPAIR_ENGINE_ID, 'r1q2.exe') },
          fix: 'select-executable',
        },
      ],
      favorite: false,
      sortOrder: 6,
    }),
    // `validation.pointReleaseMissing` (warn) - reachable only via the checks list's own
    // `install-game-files` fix button, per this block's constraint 1 above.
    makeInstallation({
      id: INSTALL_REPAIR_POINT_RELEASE_ID,
      name: INSTALL_REPAIR_POINT_RELEASE_NAME,
      rootPath: join(gameRoot(), INSTALL_REPAIR_POINT_RELEASE_ID),
      engineKind: 'r1q2',
      status: 'warning',
      checks: [
        {
          id: 'base-paks',
          severity: 'warn',
          messageKey: 'validation.pointReleaseMissing',
          fix: 'install-game-files',
        },
      ],
      favorite: false,
      sortOrder: 7,
    }),
    // `validation.pak0Missing` (error, empty `baseq2`) - `status: 'invalid'`, reachable via both
    // the action bar and the checks list.
    makeInstallation({
      id: INSTALL_REPAIR_RETAIL_ID,
      name: INSTALL_REPAIR_RETAIL_NAME,
      rootPath: join(gameRoot(), INSTALL_REPAIR_RETAIL_ID),
      engineKind: 'r1q2',
      status: 'invalid',
      checks: [
        {
          id: 'base-paks',
          severity: 'error',
          messageKey: 'validation.pak0Missing',
          fix: 'install-game-files',
        },
      ],
      favorite: false,
      sortOrder: 8,
    }),
    // `validation.pak0Missing` (error, same as above, so the action bar reaches it) PLUS
    // `validation.notWritable` (warn, `writeDirPath` pointed at a real, never-created Program
    // Files path - see `repairNonWritableDir()`) - the plan carries both `retail-copy` and
    // `set-write-dir` offers; this flow only asserts the latter is present (AC5).
    makeInstallation({
      id: INSTALL_REPAIR_WRITEDIR_ID,
      name: INSTALL_REPAIR_WRITEDIR_NAME,
      rootPath: join(gameRoot(), INSTALL_REPAIR_WRITEDIR_ID),
      writeDirPath: repairNonWritableDir(),
      engineKind: 'r1q2',
      status: 'invalid',
      checks: [
        {
          id: 'base-paks',
          severity: 'error',
          messageKey: 'validation.pak0Missing',
          fix: 'install-game-files',
        },
        {
          id: 'write-access',
          severity: 'warn',
          messageKey: 'validation.notWritable',
          params: { path: repairNonWritableDir() },
          fix: 'set-write-dir',
        },
      ],
      favorite: false,
      sortOrder: 9,
    }),
    // `validation.noExecutable` (error) with an otherwise fully-valid, fully-retail `baseq2` and no
    // engine marker anywhere - `engineKind` inspects fresh as `'unknown'` (which also raises its own
    // `validation.engineUnknown`, warn). The *recorded* `engineKind` below is `'unknown'` too, not a
    // once-known one: `InstallationsService`'s ordinary revalidation (`installations.ts`'s
    // `preserveKnownEngine` guard, scoped to `lastFailure`) overwrites the record with exactly this
    // fresh verdict the moment every engine marker disappears from an otherwise-healthy install, so
    // this is what the record genuinely becomes, not a fixture shortcut. `canSupplyEngine('unknown')`
    // is false (no manifest package is ever keyed by `'unknown'`), so `buildRepairPlan` offers
    // nothing for either finding (AC6). Recorded and fresh are both `'unknown'` here, so this
    // fixture passes under either gate - it is `plan.test.ts`'s
    // "gates reinstall-engine on the recorded engine kind..." that actually guards against a
    // regression back to the fresh-kind gate, not this fixture.
    makeInstallation({
      id: INSTALL_REPAIR_UNREPAIRABLE_ID,
      name: INSTALL_REPAIR_UNREPAIRABLE_NAME,
      rootPath: join(gameRoot(), INSTALL_REPAIR_UNREPAIRABLE_ID),
      engineKind: 'unknown',
      status: 'invalid',
      checks: [
        {
          id: 'engine-identified',
          severity: 'warn',
          messageKey: 'validation.engineUnknown',
          fix: 'select-executable',
        },
        {
          id: 'executable',
          severity: 'error',
          messageKey: 'validation.noExecutable',
          fix: 'select-executable',
        },
      ],
      favorite: false,
      sortOrder: 10,
    }),
    // Story 094 D4 - see the block comment above `INSTALL_REMOVE_STORE_ID` for why these two exist.
    makeInstallation({
      id: INSTALL_REMOVE_STORE_ID,
      name: INSTALL_REMOVE_STORE_NAME,
      rootPath: join(gameRoot(), INSTALL_REMOVE_STORE_ID),
      source: 'steam',
      favorite: false,
      sortOrder: 11,
    }),
    makeInstallation({
      id: INSTALL_REMOVE_DISK_ID,
      name: INSTALL_REMOVE_DISK_NAME,
      rootPath: join(gameRoot(), INSTALL_REMOVE_DISK_ID),
      favorite: false,
      sortOrder: 12,
    }),
  ]
}

/** How many installations the `populated` variant seeds - for flows asserting "one row per
 * installation", so they follow additive fixture installs instead of pinning a stale number. */
export function populatedInstallationCount() {
  return populatedInstallations().length
}

// --- story 066 D8: the import-from-files flow's staged real-config corpus ---------------------
//
// `docs/requirements/066-new-profile-starts-empty-from-a-template-or-from-my-files.md`'s own
// reference case: `docs/fixtures/{dm,dmalias,gfx}.cfg`, the same three real (anonymized) player
// config files `import-fixtures.test.ts` (D2) reads straight out of the repo. This story's harness
// stub (`DialogService.pickConfigFiles()`, `src/main/services/dialog.ts`) returns fixed paths from
// `Q2L_UI_PICK_FILES` instead of opening a real OS dialog - those paths have to point at real files
// on disk, so this stages byte-identical copies under `.ui-verify/` rather than pointing the env var
// back into the repo tree itself (every other harness-owned artifact already lives under
// `.ui-verify/`, never the repo).
//
// Deliberately NOT nested under any single variant's userData: `Q2L_UI_PICK_FILES` (built in
// `scripts/lib/harness.mjs`'s `childEnv()`) is the same for every launch regardless of which
// fixture variant the app under test is running against - AC9 ("import from files needs no
// installation") is proven by pointing this exact corpus at the zero-installation `empty` variant,
// not a copy of it.

/** In the exact order `Q2L_UI_PICK_FILES` must hand back - dm.cfg, then dmalias.cfg, then gfx.cfg -
 * matching the load order D2's fixture-corpus test pins (`bind RIGHTARROW "exec dmalias.cfg"`
 * resolves as a preserved bind text, never a real config-time exec, only because dmalias.cfg is
 * ALSO one of the picked files - see that test's own top comment). */
const IMPORT_FILES_FIXTURE_NAMES = ['dm.cfg', 'dmalias.cfg', 'gfx.cfg']

function importFilesFixtureDir() {
  return join(UI_VERIFY_ROOT, 'fixture', 'import-files')
}

/** The staged, absolute paths in the fixed order above - what `harness.mjs` joins with
 * `path.delimiter` for `Q2L_UI_PICK_FILES`. Exported so `scripts/flows/import-from-files.mjs` can
 * assert against the exact same paths/order rather than a copy that could drift. */
export function importFilesFixturePaths() {
  return IMPORT_FILES_FIXTURE_NAMES.map((name) => join(importFilesFixtureDir(), name))
}

/**
 * Copies `docs/fixtures/{dm,dmalias,gfx}.cfg` byte-for-byte into `.ui-verify/fixture/import-files/`.
 * Raw `Buffer` in, raw `Buffer` out - these are real player files with latin1-only bytes in places
 * (`import-fixtures.test.ts`'s own discipline for the same three files), so this never round-trips
 * through a text encoding that could silently mangle one.
 *
 * Idempotent (same source bytes every call, `ui:seed`'s own guarantee) and cheap enough to call
 * unconditionally on every `writeFixture()` reseed - see that function above.
 */
export function writeImportFilesFixture() {
  const dir = importFilesFixtureDir()
  mkdirSync(dir, { recursive: true })
  for (const name of IMPORT_FILES_FIXTURE_NAMES) {
    const bytes = readFileSync(join(REPO_ROOT, 'docs', 'fixtures', name))
    writeFileSync(join(dir, name), bytes)
  }
  return importFilesFixturePaths()
}

// --- story 100 D10: the Linux user-journey flow's own, unregistered install root ---------------
//
// `linux-user-journey.mjs` adds this folder through the real `AddExistingDialog` (the
// `Q2L_UI_PICK_FOLDER` stub), so unlike every `INSTALL_*` constant above it is never written into
// `state.json` by a fixture writer - the flow registers it itself, through the real UI, the same
// way a user would. What has to exist on disk beforehand is a folder `inspectInstallation` ranks
// as playable AND that the real `spawn()` call the Play button drives can actually execute.
//
// The stand-in client is named `q2pro`/`q2pro.exe` on purpose, not just "some executable": q2pro's
// own `defaultArgs` is empty and its markers/executables list both the Windows and the
// extension-less Linux name (`ENGINE_DEFINITIONS`, `src/shared/types/engine.ts`), and the action
// bar's Play button passes no `gameDir`/`connect`/`extraArgs` (`play(installation.id)`,
// `ActionBar.tsx`) - so the real launch this flow drives spawns the file below with ZERO
// arguments, which is exactly what both stand-ins are built to tolerate:
//
//   off Windows: a real, tiny POSIX shell script (`#!/bin/sh`, sleeps briefly, exits 0),
//     `chmodSync(..., 0o755)` - `looksExecutable` off Windows needs a real execute bit, not an
//     extension (`fs-utils.ts`, story 100 D3). The brief sleep gives the launch state's `running`
//     phase a real, non-zero-width window, though the flow does not actually depend on that
//     window - see its own header for why listening to every `launch:state` broadcast makes this
//     race-proof regardless of how fast the child exits.
//   on Windows: a copy of the vendored `resources/bin/7za.exe` - a real, spawnable Win32 binary
//     that exits almost immediately when given no arguments. Copied under the name `q2pro.exe`,
//     not left as `7za.exe`, so `classifyEngine`/`rankExecutables` (`inspector.ts`) pick it up as
//     the installation's ranked client executable instead of leaving it without one.
//
// When `resources/bin/7za.exe` was never vendored locally (`npm run fetch:7za` never ran) -
// Windows only, since the shell-script stub off Windows needs no vendored binary at all - a
// placeholder file is written instead: `looksExecutable`'s Windows rule is extension-only
// (`fs-utils.ts`), so the installation still adds and classifies as q2pro and the config-edit half
// of the journey is entirely unaffected. Only the flow's own Play/launch assertions are skipped in
// that case - loudly, the same "state the reason, never pretend" gate every other flow's own
// `vendoredExtractorExists()` check already uses (e.g. `bootstrap-existing-folder.mjs`'s
// `setup()`), just scoped to one step of this flow instead of refusing the whole run.

export const LINUX_JOURNEY_INSTALL_NAME = 'Fixture Linux Journey Install'

const LINUX_JOURNEY_INSTALL_DIR = 'fixture-linux-journey-install'

/** `q2pro.exe` on Windows, extension-less `q2pro` elsewhere - both real q2pro markers. */
const LINUX_JOURNEY_EXECUTABLE_NAME = process.platform === 'win32' ? 'q2pro.exe' : 'q2pro'

/** A tiny, real POSIX shell script: sleeps briefly, then exits cleanly. Only ever written off
 * Windows - see the block comment above for why. */
const LINUX_JOURNEY_SHELL_SCRIPT = '#!/bin/sh\nsleep 0.4\nexit 0\n'

/** The real, on-disk root the flow points the folder-pick stub at - never written into
 * `state.json`; the flow registers it itself through the real Add Existing dialog. */
export function linuxJourneyInstallRoot() {
  return join(gameRoot(), LINUX_JOURNEY_INSTALL_DIR)
}

/** The real, on-disk path of the executable the journey's Play step spawns. */
export function linuxJourneyExecutablePath() {
  return join(linuxJourneyInstallRoot(), LINUX_JOURNEY_EXECUTABLE_NAME)
}

/**
 * Builds a fresh install root: `baseq2/pak0.pak` (any bytes - just needs to exist so
 * `inspectInstallation` never reports `pak0Missing`) plus the platform's stand-in client
 * executable. Returns `{ root, executablePath, spawnable }` - `spawnable` is `false` only on
 * Windows when `resources/bin/7za.exe` was never vendored, and the flow uses it to decide whether
 * to run its own Play/launch assertions or skip them loudly.
 */
export function writeLinuxJourneyInstallRoot() {
  const root = linuxJourneyInstallRoot()
  rmDirBestEffort(root)
  const baseq2Dir = join(root, 'baseq2')
  mkdirSync(baseq2Dir, { recursive: true })
  writeFileSync(join(baseq2Dir, 'pak0.pak'), 'not a real pak, just needs to exist')

  const executablePath = linuxJourneyExecutablePath()
  if (process.platform === 'win32') {
    if (vendoredWindowsExtractorExists()) {
      copyFileSync(vendoredWindowsExtractorPath(), executablePath)
      return { root, executablePath, spawnable: true }
    }
    writeFileSync(executablePath, 'placeholder - resources/bin/7za.exe was not vendored locally')
    return { root, executablePath, spawnable: false }
  }

  writeFileSync(executablePath, LINUX_JOURNEY_SHELL_SCRIPT)
  chmodSync(executablePath, 0o755)
  return { root, executablePath, spawnable: true }
}

// --- story 125 D5: `servers-join.mjs`'s own, unregistered install root -------------------------
//
// Same stand-in-client trick as `writeLinuxJourneyInstallRoot()` just above (a real, spawnable
// executable with a brief sleep off Windows, the vendored `7za.exe` on Windows), but this fixture
// is registered directly into `state.json` (as the sole, active installation) rather than added
// through the real UI - `servers-join.mjs` needs a genuine Play/join to spawn a real process and
// exit on its own so the flow can assert on `main.log`'s recorded argv and a real `exited` phase,
// which `writePopulatedFixture()`'s own installations (placeholder, non-spawnable executables)
// cannot provide.
const JOIN_INSTALL_DIR = 'fixture-servers-join-install'

/** The id `servers-join.mjs` seeds this installation under in `state.json`, and the value it
 * points `settings.activeInstallationId` at - exported so the flow never has to guess or
 * duplicate the literal. */
export const JOIN_INSTALL_ID = JOIN_INSTALL_DIR

/** `q2join.exe` on Windows, extension-less `q2join` elsewhere - name is irrelevant to any engine
 * classification this fixture depends on (the flow sets `executablePath` directly rather than
 * relying on `inspectInstallation` to rank it). */
const JOIN_EXECUTABLE_NAME = process.platform === 'win32' ? 'q2join.exe' : 'q2join'

export function joinInstallRoot() {
  return join(gameRoot(), JOIN_INSTALL_DIR)
}

export function joinExecutablePath() {
  return join(joinInstallRoot(), JOIN_EXECUTABLE_NAME)
}

/**
 * Builds a fresh install root: `baseq2/pak0.pak` (any bytes - just needs to exist) plus the
 * platform's stand-in client executable. Returns `{ root, executablePath, spawnable }`, same shape
 * as `writeLinuxJourneyInstallRoot()` - `spawnable` is `false` only on Windows when
 * `resources/bin/7za.exe` was never vendored locally.
 */
export function writeJoinInstallRoot() {
  const root = joinInstallRoot()
  rmDirBestEffort(root)
  const baseq2Dir = join(root, 'baseq2')
  mkdirSync(baseq2Dir, { recursive: true })
  writeFileSync(join(baseq2Dir, 'pak0.pak'), 'not a real pak, just needs to exist')

  const executablePath = joinExecutablePath()
  if (process.platform === 'win32') {
    if (vendoredWindowsExtractorExists()) {
      copyFileSync(vendoredWindowsExtractorPath(), executablePath)
      return { root, executablePath, spawnable: true }
    }
    writeFileSync(executablePath, 'placeholder - resources/bin/7za.exe was not vendored locally')
    return { root, executablePath, spawnable: false }
  }

  writeFileSync(executablePath, LINUX_JOURNEY_SHELL_SCRIPT)
  chmodSync(executablePath, 0o755)
  return { root, executablePath, spawnable: true }
}

/**
 * Story 125 D5: `servers-join.mjs`'s own fixture writer. Built on `emptyStateDocument()`'s minimal
 * shape (zero installations, zero config profiles) rather than `writePopulatedFixture()`'s
 * five-installation/two-profile default - that default's `configProfiles` name installation ids
 * (`INSTALL_ONE_ID`/`INSTALL_TWO_ID`) that a wholesale `installations` override for this flow's one
 * custom, real-spawnable installation would otherwise leave dangling. Writes the real install root
 * via `writeJoinInstallRoot()`, seeds it as the sole installation and `settings.activeInstallationId`
 * (`DEFAULT_SETTINGS.activeInstallationId` is `null`), and takes the caller's `servers` state slice
 * verbatim - same shape every other servers flow already builds by hand.
 *
 * `variant` (story 126 D3) picks the userDataDir a caller other than `servers-join.mjs` itself
 * gets - e.g. `servers-watchlist.mjs` passes its own name so the two flows' fixtures never share a
 * directory, defaulting to `'servers-join'` so the original caller is unaffected.
 */
export function writeJoinFixture({ servers, variant = 'servers-join' }) {
  const userDataDir = variantUserDataDir(variant)
  rmDirBestEffort(userDataDir)
  mkdirSync(userDataDir, { recursive: true })

  const install = writeJoinInstallRoot()

  writeJson(join(userDataDir, STATE_FILE), {
    schemaVersion: LEGACY_SEED_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, scanOnFirstRun: false, activeInstallationId: JOIN_INSTALL_ID },
    installations: [
      {
        id: JOIN_INSTALL_ID,
        name: 'Fixture Join Install',
        rootPath: install.root,
        engineKind: 'r1q2',
        executablePath: install.executablePath,
        launchArgs: [],
        activeGameDir: '',
        detectedVersion: undefined,
        source: 'manual',
        status: 'ok',
        checks: [],
        gameDirs: ['baseq2'],
        favorite: false,
        sortOrder: 0,
        createdAt: FIXED_TIMESTAMP,
        updatedAt: FIXED_TIMESTAMP,
        lastValidatedAt: undefined,
        lastPlayedAt: undefined,
        totalPlaytimeSeconds: 0,
      },
    ],
    configProfiles: [],
    configPlayedMods: {},
    configPendingWrites: {},
    configSwitchBinds: {},
    servers,
  })
  writeJson(join(userDataDir, WINDOW_STATE_FILE), windowStateDocument())

  return {
    userDataDir,
    installRoot: install.root,
    executablePath: install.executablePath,
    spawnable: install.spawnable,
  }
}

// --- story 103 D8: the windows-build-on-linux e2e proof's own install root ---------------------
//
// `windows-build-on-linux.mjs` needs an install root `inspectInstallation` ranks exactly the way a
// real "someone copied their Windows Quake II folder onto a Linux machine" install would: a real
// MZ-header `quake2.exe` (D1/D2's `readBinaryKind` has to classify it as `'pe'`, not merely exist),
// retail-sized paks so nothing OTHER than the runner story shows up in `installation.checks`, and -
// the story's own fixture requirement for this deliverable - a real ELF-header `quake2` alongside it,
// execute bit and all.
//
// The two cannot both be active ranking candidates at once, though: D2's own `rankExecutables`
// ranks a native ELF/script ahead of a PE unconditionally off Windows (see that function's own doc
// comment - "a folder holding both `quake2` and `quake2.exe` on Linux must pick the one the machine
// can actually execute"), so a root carrying both would have Linux pick the ELF file and never raise
// AC2's `executable-runnable` check at all - the opposite of what half of this flow needs to prove.
// `includeNativeElf` (default `true`, matching the deliverable's own fixture description literally -
// "an install root ... containing a real MZ-header quake2.exe and (for the ranking half) a native
// quake2") lets the flow's Windows branch use the combined root as-is (ranking is a non-event there:
// `looksExecutable` is extension-only on win32, so the extension-less `quake2` is never even a
// candidate - AC8), while the Linux branch's AC2/AC6/AC7 half explicitly asks for
// `includeNativeElf: false` - a genuinely PE-only folder - so the chosen executable is unambiguously
// `quake2.exe`.
export const WINDOWS_BUILD_INSTALL_NAME = 'Fixture Windows Build Install'

const WINDOWS_BUILD_INSTALL_DIR = 'fixture-windows-build-install'

const WINDOWS_BUILD_EXE_NAME = 'quake2.exe'

const WINDOWS_BUILD_ELF_NAME = 'quake2'

/** `MZ`, then filler bytes - `readBinaryKind` only ever reads the first 4 bytes of a file. */
const PE_HEADER_BYTES = Buffer.from([0x4d, 0x5a, 0x90, 0x00])

/** `\x7fELF`, then filler bytes. */
const ELF_HEADER_BYTES = Buffer.from([0x7f, 0x45, 0x4c, 0x46])

export function windowsBuildInstallRoot() {
  return join(gameRoot(), WINDOWS_BUILD_INSTALL_DIR)
}

/** The real, on-disk path of the fixture's Windows executable - always written. */
export function windowsBuildExecutablePath() {
  return join(windowsBuildInstallRoot(), WINDOWS_BUILD_EXE_NAME)
}

/** The real, on-disk path of the fixture's native (ELF) executable - only written when
 * `includeNativeElf` is not explicitly `false`; see the block comment above. */
export function windowsBuildNativeExecutablePath() {
  return join(windowsBuildInstallRoot(), WINDOWS_BUILD_ELF_NAME)
}

/**
 * Builds a fresh install root: retail-sized `baseq2/pak0.pak`/`pak1.pak`/`pak2.pak` (so nothing but
 * the runner story shows up in `installation.checks`), a real MZ-header `quake2.exe` with the
 * execute bit set (needed off Windows too - `looksExecutable` there is a plain exec-bit stat, not an
 * extension check, so an unexecutable `quake2.exe` would never even be ranked as a candidate), and -
 * unless `includeNativeElf` is `false` - a real ELF-header `quake2`, execute bit set, alongside it.
 * Returns `{ root, exePath, elfPath }` - `elfPath` is `null` when `includeNativeElf` is `false`.
 */
export function writeWindowsBuildFixture({ includeNativeElf = true } = {}) {
  const root = assertInside(UI_VERIFY_ROOT, windowsBuildInstallRoot(), 'windows-build install root')
  rmDirBestEffort(root)
  const baseq2Dir = join(root, 'baseq2')
  mkdirSync(baseq2Dir, { recursive: true })
  writeSizedFile(join(baseq2Dir, 'pak0.pak'), RETAIL_PAK_SIZES['pak0.pak'])
  writeSizedFile(join(baseq2Dir, 'pak1.pak'), RETAIL_PAK_SIZES['pak1.pak'])
  writeSizedFile(join(baseq2Dir, 'pak2.pak'), RETAIL_PAK_SIZES['pak2.pak'])

  const exePath = windowsBuildExecutablePath()
  writeFileSync(exePath, PE_HEADER_BYTES)
  chmodSync(exePath, 0o755)

  let elfPath = null
  if (includeNativeElf) {
    elfPath = windowsBuildNativeExecutablePath()
    writeFileSync(elfPath, ELF_HEADER_BYTES)
    chmodSync(elfPath, 0o755)
  }

  return { root, exePath, elfPath }
}

// --- story 103 D8: a real, on-PATH `wine` stub ---------------------------------------------------
//
// A tiny POSIX shell script that execs its first argument with the rest as its own arguments -
// `resolveRunner()`/`LaunchService.plan()` only need something named `wine` on `PATH` with the
// execute bit set (`findOnPath()`, `src/main/services/runners.ts`); what it actually does once
// spawned is this flow's own business. Node's `child_process.spawn()` reports the wrapper script
// itself as `'spawn'`/`'exit'` regardless of whether the `exec` inside it against the fixture's own
// (content-wise inert) `quake2.exe` succeeds - the same "the wrapper process itself is real, so the
// launch-state sequence is real" trick `writeLinuxJourneyInstallRoot()`'s own shell-script stub
// relies on for an unwrapped launch.
function wineStubBinDir() {
  return join(UI_VERIFY_ROOT, 'fixture', 'windows-build-wine-bin')
}

const WINE_STUB_SCRIPT = '#!/bin/sh\nexec "$@"\n'

/** Writes a fresh `<dir>/wine` stub and returns `dir` - the flow prepends this onto `PATH` (inside
 * the running app's own main process, via Playwright's `app.evaluate()`) once it wants wine to be
 * "found". Never called on `win32` - the flow's own branch gate keeps this off Windows entirely. */
export function writeWineStub() {
  const dir = assertInside(UI_VERIFY_ROOT, wineStubBinDir(), 'wine stub bin dir')
  rmDirBestEffort(dir)
  mkdirSync(dir, { recursive: true })
  const wine = join(dir, 'wine')
  writeFileSync(wine, WINE_STUB_SCRIPT)
  chmodSync(wine, 0o755)
  return dir
}

// --- story 103 review finding N1: a second, distinct stub runner (`umu-run`) -------------------
//
// A single stub (`wine`) could not distinguish "the user explicitly chose this runner" from "this
// runner became available and `resolveRunner()`'s cascade default (`src/main/services/runners.ts`,
// `WRAPPING_KINDS = ['wine', 'umu']`, wine ranked first) picked it automatically" - both produce the
// exact same visible preview change. A second wrapping-kind stub, in its own directory so it can be
// written/removed independently of the wine stub above, lets a flow put both on PATH at once: the
// cascade still defaults to wine, so explicitly picking `umu-run` instead is the only way to reach
// the umu-wrapped preview, and that can only happen through a genuine, persisted explicit choice.
function umuStubBinDir() {
  return join(UI_VERIFY_ROOT, 'fixture', 'windows-build-umu-bin')
}

const UMU_STUB_SCRIPT = '#!/bin/sh\nexec "$@"\n'

/** Writes a fresh `<dir>/umu-run` stub and returns `dir` - same shape as `writeWineStub()`, for the
 * second wrapping runner kind `findOnPath('umu', 'umu-run')` looks for (`src/main/services/
 * runners.ts`). Never called on `win32`, same as `writeWineStub()`. */
export function writeUmuStub() {
  const dir = assertInside(UI_VERIFY_ROOT, umuStubBinDir(), 'umu-run stub bin dir')
  rmDirBestEffort(dir)
  mkdirSync(dir, { recursive: true })
  const umu = join(dir, 'umu-run')
  writeFileSync(umu, UMU_STUB_SCRIPT)
  chmodSync(umu, 0o755)
  return dir
}

// --- story 104 D6: the steam-handoff e2e proof's own fixtures -----------------------------------
//
// `scripts/flows/steam-handoff.mjs` needs two things `windows-build-on-linux.mjs`'s own fixtures
// don't provide: an install root Steam itself would recognise as one of its own
// (`readSteamAppId()`, `src/main/services/steam.ts` - a folder living directly inside some Steam
// library's `steamapps/common/`, with a sibling `appmanifest_<appid>.acf` naming it), and a stub
// `steam` binary that behaves like a real handoff target rather than a wrapper.

/**
 * The exact `"key" "value"` shape `scrapeVdfPairs()` (`src/main/services/steam.ts`) reads, mirroring
 * the literal fixture already proven correct by `steam.test.ts`'s own "reads the appid from the
 * manifest whose installdir matches the folder" case - not hand-rolled a second time here.
 */
const STEAM_LIBRARY_INSTALL_DIR_NAME = 'Quake 2'

function steamLibraryFixtureRoot(appid) {
  return join(gameRoot(), `steam-handoff-${appid}`)
}

/** `<root>/steamapps/common/Quake 2` - what `readSteamAppId()` requires an install root to be:
 * `dirname(installRoot)` named `common`, `dirname(dirname(installRoot))` named `steamapps`. */
export function steamLibraryInstallRoot(appid) {
  return join(steamLibraryFixtureRoot(appid), 'steamapps', 'common', STEAM_LIBRARY_INSTALL_DIR_NAME)
}

/**
 * Builds a fresh Steam-owned install root for `appid`: retail-sized `baseq2/pak0.pak`/`pak1.pak`/
 * `pak2.pak` (so nothing but the runner story shows up in `installation.checks`, same reasoning as
 * `writeWindowsBuildFixture()`), a real MZ-header `quake2.exe` (execute bit set), and a sibling
 * `steamapps/appmanifest_<appid>.acf` whose `"appid"`/`"installdir"` pair names this exact folder -
 * the one thing that makes `readSteamAppId()` recognise it as Steam-owned at all. A distinct root
 * per appid (rather than one shared `steamapps` with several manifests) keeps the two call sites
 * `steam-handoff.mjs` needs (a known appid with a client table, and an unknown one without) fully
 * independent - deleting/rewriting one never touches the other's manifest.
 *
 * Returns `{ root, exePath, manifestPath }` - `root` is what a flow hands to
 * `Q2L_UI_PICK_FOLDER`/the Add Existing dialog.
 */
export function writeSteamLibraryFixture({ appid }) {
  const installRoot = assertInside(
    UI_VERIFY_ROOT,
    steamLibraryInstallRoot(appid),
    'steam library install root',
  )
  rmDirBestEffort(steamLibraryFixtureRoot(appid))
  const baseq2Dir = join(installRoot, 'baseq2')
  mkdirSync(baseq2Dir, { recursive: true })
  writeSizedFile(join(baseq2Dir, 'pak0.pak'), RETAIL_PAK_SIZES['pak0.pak'])
  writeSizedFile(join(baseq2Dir, 'pak1.pak'), RETAIL_PAK_SIZES['pak1.pak'])
  writeSizedFile(join(baseq2Dir, 'pak2.pak'), RETAIL_PAK_SIZES['pak2.pak'])

  const exePath = join(installRoot, 'quake2.exe')
  writeFileSync(exePath, PE_HEADER_BYTES)
  chmodSync(exePath, 0o755)

  const steamappsDir = join(steamLibraryFixtureRoot(appid), 'steamapps')
  const manifestPath = join(steamappsDir, `appmanifest_${appid}.acf`)
  writeFileSync(
    manifestPath,
    `"AppState"\n{\n\t"appid"\t\t"${appid}"\n\t"installdir"\t\t"${STEAM_LIBRARY_INSTALL_DIR_NAME}"\n}\n`,
    'utf8',
  )

  return { root: installRoot, exePath, manifestPath }
}

function steamStubBinDir() {
  return join(UI_VERIFY_ROOT, 'fixture', 'steam-handoff-steam-bin')
}

/** `<dir>/steam-stub.log` - where the stub below records every invocation's argv. */
export function steamStubLogPath() {
  return join(steamStubBinDir(), 'steam-stub.log')
}

/**
 * Unlike `writeWineStub()`/`writeUmuStub()`, a Steam handoff's only argument is a
 * `steam://launch/<appid>/client/<n>` URL, never another executable to run - `exec "$@"` would try
 * (and fail) to run that URL as a program. So this stub just records its own argv to a log file
 * (`steamStubLogPath()`) and exits 0: still a real process spawn/exit (`LaunchService.handOff()`'s
 * `'spawn'`/`'error'` listeners see a genuine child process, the same "the wrapper process itself is
 * real" trick the wine/umu stubs use), just one whose recorded argv is what the flow asserts against
 * instead of a nested exec. Never called on `win32` - the flow's own branch gate keeps this off
 * Windows entirely (the Windows branch never presses Play).
 */
export function writeSteamStub() {
  const dir = assertInside(UI_VERIFY_ROOT, steamStubBinDir(), 'steam stub bin dir')
  rmDirBestEffort(dir)
  mkdirSync(dir, { recursive: true })
  const logPath = steamStubLogPath()
  const steam = join(dir, 'steam')
  writeFileSync(steam, `#!/bin/sh\necho "$@" >> "${logPath}"\nexit 0\n`)
  chmodSync(steam, 0o755)
  return { dir, logPath }
}
