// D2 — fixture seed data + writers for the UI-verification harness.
//
// `scripts/` is plain Node ESM outside both TS projects, so it cannot
// `import type`/`import` anything from `src/**/*.ts` at runtime. Instead, the
// small set of literal values this file needs are hardcoded below, each
// annotated with exactly the source file/constant it mirrors, so a future
// schema bump is easy to find via grep (search for "mirrors").
//
// Everything here is deterministic: fixed ids and fixed ISO timestamps, never
// `Date.now()`/`crypto.randomUUID()`. That is what makes `npm run ui:seed`
// idempotent — re-running it regenerates byte-identical files rather than
// merge-patching whatever is already on disk.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { assertInside, REPO_ROOT, UI_VERIFY_ROOT } from './paths.mjs'
import { variantUserDataDir } from './harness.mjs'
// Story 075 D7's two seeded `downloadFailures` entries. They live in their own module (which
// imports only the redaction mirror) so a unit test can assert the seeded record is exactly what
// the real `redactHome` produces, without dragging playwright in through this file.
import { populatedDownloadFailures } from './download-failures.mjs'

// --- literals mirrored from src/shared -------------------------------------

/** Mirrors src/shared/constants.ts:10 (`STATE_FILE`). */
const STATE_FILE = 'state.json'
/** Mirrors src/shared/constants.ts:11 (`WINDOW_STATE_FILE`). */
const WINDOW_STATE_FILE = 'window-state.json'
/** Deliberately kept one version behind the real `STATE_SCHEMA_VERSION`
 * (`src/shared/constants.ts`, currently `2`) rather than mirroring it - see the comment block
 * above `CONTROLS_SEED_SCHEMA_VERSION` below for why `populated`/`empty` need every reseed to run
 * story 052 D6's migration fresh. */
const STATE_SCHEMA_VERSION = 1

/** Mirrors src/shared/types/settings.ts:22-32 (`DEFAULT_SETTINGS`). */
const DEFAULT_SETTINGS = {
  locale: 'system',
  motion: 'system',
  activeInstallationId: null,
  lastRoute: '/home',
  minimizeOnLaunch: true,
  closeAfterLaunch: false,
  confirmBeforeRemoving: true,
  scanOnFirstRun: true,
  deepScanDrives: [],
}

/** Fixed instant used for every fixture timestamp — never `Date.now()` (idempotency). */
const FIXED_TIMESTAMP = '2026-01-01T00:00:00.000Z'

/** Root all fixture game directories live under: `.ui-verify/fixture/game/<install>/`. */
function gameRoot() {
  return join(UI_VERIFY_ROOT, 'fixture', 'game')
}

// --- state.ts LauncherStateDocument ("defaults()") shape -------------------
// Mirrors src/main/services/state.ts:16-48 (`LauncherStateDocument`) and its
// `defaults()` (state.ts:50-60).

function emptyStateDocument() {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    // `scanOnFirstRun: false` overrides the default: with zero installations,
    // `useLauncher.bootstrap()` otherwise opens `DetectDialog` with
    // `autoStart: true`, which calls `detection:scan` on mount without
    // waiting for a click — exactly the real Steam/GOG/registry scan the
    // harness must never trigger (story 026 Decisions).
    settings: { ...DEFAULT_SETTINGS, scanOnFirstRun: false },
    installations: [],
    configProfiles: [],
    configPlayedMods: {},
    configPendingWrites: {},
    configSwitchBinds: {},
  }
}

// --- installation.ts Installation shape ------------------------------------
// Mirrors src/shared/types/installation.ts:68 (`Installation`).

function makeInstallation({
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
}) {
  return {
    id,
    name,
    rootPath,
    ...(writeDirPath ? { writeDirPath } : {}),
    // Story 065 D5: `engineKind` became a parameter (defaulting to the `r1q2` every caller
    // relied on before) purely so `INSTALL_UNKNOWN_ENGINE_ID` below can be a non-r1q2 install.
    engineKind: engineKind ?? 'r1q2',
    executablePath: undefined,
    launchArgs: [],
    activeGameDir: '',
    detectedVersion: undefined,
    source: 'manual',
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
    lastPlayedAt: undefined,
    totalPlaytimeSeconds: 0,
    moduleData: undefined,
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

const INSTALL_ONE_ID = 'fixture-install-favorite'
const INSTALL_TWO_ID = 'fixture-install-writedir'

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
const CUSTOM_ICON_PNG_BASE64 =
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
const INSTALL_UNKNOWN_ENGINE_ID = 'fixture-install-unknown-long-name'

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
const RESTORE_GAME_DIR = 'q2l-restore-fixture'

/**
 * Story 077 D5: a fourth installation carrying a `lastFailure` - a bootstrap job that failed and,
 * per that story's own decision, left its registration behind instead of deleting it. Its own doc
 * comment on `populatedInstallations()`'s fourth entry below explains the additive rule this
 * follows; see that entry for what it proves and why its own doc comment (not this one) is where
 * the reasoning belongs.
 */
const INSTALL_FAILED_ID = 'fixture-install-failed'

/**
 * The i18n key `INSTALL_FAILED_ID` carries as its `lastFailure.errorKey` - a real, existing key
 * from `src/renderer/src/i18n/locales/en.json` ("Every download source failed. Check your
 * connection and try again."), not an invented one. Exported so both the seeded fixture row and
 * `scripts/flows/bootstrap-failure-retry.mjs` (whose own 404-both-URLs fixture-server option
 * produces this exact key via `fetcher.ts`'s `allMirrorsFailed` exit) can assert against the same
 * literal rather than two copies that could drift apart.
 */
export const INSTALL_FAILED_ERROR_KEY = 'downloads.error.allMirrorsFailed'

function populatedInstallations() {
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
      gameDirs: ['baseq2', RESTORE_GAME_DIR],
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
  ]
}

// --- config.ts ConfigProfile shape ------------------------------------------
// Mirrors src/shared/modules/config.ts:181 (`ConfigProfile`), `:45`
// (`ProfileAssignment`) and `:56` (`UnrecognizedConfigLine`).
// AltLayer mirrors src/shared/config/alt-layers.ts:55 (`AltLayer`).
//
// Story 038 D4: `plain.actions` below (+ its `binds` mirror) makes the
// writer's dead-alias-line fix (`src/shared/config/alias-references.ts`)
// visible on the `config-raw`/`config-write-preview` screens. This file
// cannot import `aliasNameFor`/`bindValueFor` (plain Node ESM outside both TS
// projects - see the file doc comment), so `binds.q` below is that
// algorithm's output hand-computed for action 2 and must stay in lockstep
// with it if either changes: `q2l_a_` + `slugAliasName('Weapon Combo', 14)`
// (`weapon_combo`) + `_` + the action id's first 4 alnum chars (`fixt`).

function populatedConfigProfiles() {
  const plain = {
    id: 'fixture-profile-plain',
    name: 'Plain Profile',
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    // Story 047 D2: `r` is a `$r`-style colour cvar (mirrors
    // src/shared/config/color-cvars.ts:33 `isColorCvar` - every byte is 0x7f
    // or 0x80-0xff) so the message editor's colour-cvar badge has a real
    // token to resolve for the two message actions below.
    //
    // Story 059 D10: `q2l_fixture_note` is a name `ALL_CVARS` (src/shared/config/cvar-catalog.ts)
    // does not know - it exists purely so the Settings tab has a real `PlainCvarRow` to show
    // (D7's "the catalogue does not know this name" row), placed into `PLAIN_FIXTURE_SECTION_ID`
    // below alongside a real catalogue cvar so the `config-settings` screen's screenshot shows a
    // user-named section header with both kinds of row under it, not just one.
    cvars: {
      sensitivity: '3',
      crosshair: '0',
      r: '\x7f\x88\x88\x7f',
      q2l_fixture_note: 'shown in raw file',
    },
    // Story 059 D10: a real, user-named `ConfigCvarSection` (mirrors `ConfigCvarSection`,
    // src/shared/modules/config.ts) - this profile's `cvarSections` predates D1, so without this
    // the migration (`materialiseCvarSections`, src/main/services/migrations.ts D6) would seed the
    // four template group sections instead and there would be no *user-named* section anywhere in
    // the populated fixture, which is exactly what D10's `config-settings` screen and the
    // `settings-section-rename-add-cvar` flow both need to show/rename. Holds one real catalogue
    // cvar (`sensitivity`) alongside the plain one above, so the section's own row list already
    // demonstrates both a rich `CvarRow` and a `PlainCvarRow` line up together (AC3).
    cvarSections: [
      {
        id: 'fixture-section-custom',
        name: 'Fixture Section',
        cvars: ['sensitivity', 'q2l_fixture_note'],
      },
    ],
    binds: {
      MOUSE1: '+attack',
      SPACE: '+moveup',
      // Mirrors action 2 ("weapons") below - a multi-command action's mirror
      // is always its alias name, never a bare command (`bindValueFor`).
      q: 'q2l_a_weapon_combo_fixt',
    },
    assignments: [{ installationId: INSTALL_ONE_ID, isDefault: true }],
    // Actions 1-3 exercise the writer's three alias-line outcomes
    // (`actionsWithAliasLine`, `src/shared/config/alias-references.ts`);
    // actions 4-5 (story 047 D2) give the message editor something to show.
    actions: [
      // 1. Catalogue row whose single command is a bare `+attack` (story
      //    034/038's own case): `bindValueFor` returns the command itself,
      //    not the alias, so `binds.MOUSE1` above already carries `+attack`
      //    directly and nothing calls `q2l_a_attack_*` by name. Its alias
      //    line must be entirely absent from the rendered file (AC1).
      {
        id: 'fixture-action-attack',
        categoryId: 'movement',
        name: 'Attack',
        kind: 'bind',
        catalogId: 'movement:attack',
        commands: [{ kind: 'raw', text: '+attack' }],
        key: 'MOUSE1',
      },
      // 2. Free-form, two-command "weapons" row bound on `q`: more than one
      //    command means `bindValueFor` falls back to the alias name, so
      //    `binds.q` above names it and its `alias q2l_a_weapon_combo_fixt …`
      //    line must survive (AC2).
      {
        id: 'fixture-action-weapons',
        categoryId: 'weapons',
        name: 'Weapon Combo',
        kind: 'bind',
        commands: [
          { kind: 'raw', text: 'use shotgun' },
          { kind: 'raw', text: 'use super shotgun' },
        ],
        key: 'q',
      },
      // 3. Keyless, unreferenced action (the User decision): kept regardless
      //    - user-authored content the user may be about to bind, unlike the
      //    catalogue-mirror case above. No `key`, so no `binds` entry.
      {
        id: 'fixture-action-keyless',
        categoryId: 'weapons',
        name: 'Keyless Combo',
        kind: 'bind',
        commands: [
          { kind: 'raw', text: 'wait' },
          { kind: 'raw', text: '+attack' },
        ],
      },
      // 4. Story 047 D2: a `drops` catalogue row with a message command, so
      //    the drop-row "Edit message" path (`ControlsTab.tsx:701`) and the
      //    message editor's `$r` colour-cvar badge both have something real
      //    to show. `catalogId`/`commands` mirror what `applyMessage`
      //    (src/renderer/src/modules/config/lib/catalog-binds.ts:309) would
      //    write for the `railgun` droppable (`dropWeapon:railgun`,
      //    `action-catalog.ts`'s `DROPPABLES`/`catalog-rows.ts`'s
      //    `makeCatalogId`): the row's own raw `drop <item>` command, plus a
      //    trailing `{ kind: 'message' }` command whose text references the
      //    `r` colour cvar above via `$r`.
      {
        id: 'fixture-action-drop-message',
        categoryId: 'drops',
        name: 'Railgun',
        kind: 'bind',
        catalogId: 'dropWeapon:railgun',
        commands: [
          { kind: 'raw', text: 'drop railgun' },
          { kind: 'message', channel: 'say', text: 'Dropped railgun $r' },
        ],
      },
      // 5. Story 047 D2: a free-form `kind: 'message'` action (no
      //    `catalogId`) for the Team-messages path (`ControlsTab.tsx:1237`,
      //    `editingAction.kind === 'message'`) - a named chat message kept on
      //    a `say_team` channel, distinct from the drops row above which is
      //    catalogue-backed and uses `say`.
      {
        id: 'fixture-action-team-message',
        categoryId: 'weapons',
        name: 'Team Update',
        kind: 'message',
        commands: [{ kind: 'message', channel: 'say_team', text: 'Need ammo $r' }],
      },
      // 6. Story 056 D5: a free-form, three-key action ("Multi Bind") so the extra-keys group
      //    (folded "+2" chevron, indented sub-rows) has a real row to render against - AC 6's
      //    "hand-added third key" is now editable/clearable in Controls itself, not only in Care.
      //    `categoryId: 'movement'` puts it in the rail's default first category (mirrors action 1)
      //    so the new `config-controls-extra-keys-*` screens below need no category-chip click.
      //    `keys` (not the legacy singular `key`, see `ConfigAction.keys` in
      //    src/shared/modules/config.ts) uses three keys not already claimed by `binds`/any other
      //    action's `key`/`keys` above (`MOUSE1`, `SPACE`, `q`). No `binds` entry: `binds` only
      //    mirrors the PRIMARY key of a single-command action for the base bind table
      //    (`action-mirror.ts`), and this fixture's whole point is to view/edit the action in the
      //    Controls tab, not round-trip a specific alias line.
      {
        id: 'fixture-action-multibind',
        categoryId: 'movement',
        name: 'Multi Bind',
        kind: 'bind',
        commands: [
          { kind: 'raw', text: 'wait' },
          { kind: 'raw', text: '+attack' },
        ],
        keys: [{ key: 'G' }, { key: 'H' }, { key: 'J' }],
      },
      // 7-8. Story 063 D4: two already-damaged, keyless Weapons entries - one per grenade command -
      //   seeded as `kind: 'alias'` so the Controls tab's "Make bindable" row-menu item
      //   (`applyEntryKindBindable`) has real inert rows to repair. These are the shape a profile
      //   that hit story 063's root-cause bug is stuck with forever (a keyless bind/message entry
      //   that got silently misread back as `kind: 'alias'` on a file->state pass, decision 4) - and,
      //   distinct from the catalogue's own `weaponUse:use_grenades`/`weaponUse:use_glauncher` rows
      //   (which already round-trip correctly since D1/D2 and are not inert), these are user-created
      //   entries with their own synthetic ids/names, same idea as `fixture-action-weapons`
      //   ("Weapon Combo") above but one command each and no key, mirroring the real damaged
      //   `Grenade + Launcher` entry the story's root-cause section describes split one-command-per-
      //   entry per the D4 acceptance ("one keyless kind: 'alias' Weapons entry per grenade
      //   command").
      {
        id: 'fixture-action-inert-grenades',
        categoryId: 'weapons',
        name: 'Grenades (inert)',
        kind: 'alias',
        commands: [{ kind: 'raw', text: 'use grenades' }],
      },
      {
        id: 'fixture-action-inert-glauncher',
        categoryId: 'weapons',
        name: 'Grenade Launcher (inert)',
        kind: 'alias',
        commands: [{ kind: 'raw', text: 'use grenade launcher' }],
      },
    ],
  }

  const withLayers = {
    id: 'fixture-profile-layers',
    name: 'Layered Profile',
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    cvars: { sensitivity: '5' },
    binds: { w: '+forward', s: '+back' },
    assignments: [{ installationId: INSTALL_TWO_ID, isDefault: false }],
    layers: [
      {
        id: 'fixture-layer-drops',
        name: 'Drops',
        mode: 'hold',
        triggerKey: 'ALT',
        overrides: { 1: 'drop rl', 2: 'drop rg' },
      },
    ],
  }

  const withUnrecognized = {
    id: 'fixture-profile-unrecognized',
    name: 'Imported Profile',
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    cvars: {},
    binds: {},
    assignments: [],
    unrecognized: [{ file: 'config.cfg', line: 42, text: 'seta cl_oddcvar "1"' }],
  }

  return [plain, withLayers, withUnrecognized]
}

// --- downloads.ts DownloadsSettings shape + archive-cache fixture ----------
// Mirrors src/shared/modules/downloads.ts's `DownloadsSettings`/
// `DEFAULT_DOWNLOADS_SETTINGS` (2 / 5 GB / true) and
// src/main/modules/downloads/paths.ts's `userData/cache/downloads/<fileName>` layout
// (verified files, no `.part` suffix).
//
// Story 072 D6: deliberately non-default on every field, so the
// `settings-downloads-section` flow's boot-side assertion (AC6) can tell "the fixture's
// seeded values" apart from "whatever DEFAULT_DOWNLOADS_SETTINGS would have rendered anyway".
/** Mirrors src/shared/modules/downloads.ts's `DownloadsSettings`. Exported so the flow asserts
 * against the exact seeded literals rather than a copy that could drift. */
export const DOWNLOADS_SETTINGS_SEED = {
  concurrentJobs: 4,
  archiveCacheBudgetGB: 10,
  downloadWhilePlayingAllowed: false,
}

/**
 * Two plain (non-`.part`) dummy archives under `userdata/cache/downloads/`, distinct sizes and
 * distinct mtimes - enough for `cacheStatus`'s sum/count (AC3) to be unambiguous without
 * exercising eviction ordering (D3/D4's unit tests already cover that exhaustively). Exported so
 * `scripts/flows/settings-downloads-section.mjs` asserts against the exact same literals.
 */
export const DOWNLOADS_CACHE_ARCHIVE_ONE = {
  fileName: 'fixture-archive-one.pk3',
  sizeBytes: 3 * 1024 * 1024,
  mtime: '2026-01-01T00:00:00.000Z',
}
export const DOWNLOADS_CACHE_ARCHIVE_TWO = {
  fileName: 'fixture-archive-two.pk3',
  sizeBytes: 1 * 1024 * 1024,
  mtime: '2026-01-02T00:00:00.000Z',
}
/** Total evictable bytes/count the two archives above sum to - what `cacheStatus` should report. */
export const DOWNLOADS_CACHE_TOTAL_BYTES =
  DOWNLOADS_CACHE_ARCHIVE_ONE.sizeBytes + DOWNLOADS_CACHE_ARCHIVE_TWO.sizeBytes
export const DOWNLOADS_CACHE_ITEM_COUNT = 2

/** Writes the two dummy archives above into `<userDataDir>/cache/downloads/`, each with its own
 * distinct mtime (`fs.utimesSync` - the only way to backdate a file Node itself just wrote). */
function writeDownloadsCacheArchives(userDataDir) {
  const cacheDir = join(userDataDir, 'cache', 'downloads')
  mkdirSync(cacheDir, { recursive: true })
  for (const archive of [DOWNLOADS_CACHE_ARCHIVE_ONE, DOWNLOADS_CACHE_ARCHIVE_TWO]) {
    const path = join(cacheDir, archive.fileName)
    writeFileSync(path, Buffer.alloc(archive.sizeBytes, 0))
    const mtime = new Date(archive.mtime)
    utimesSync(path, mtime, mtime)
  }
}

function populatedStateDocument() {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, activeInstallationId: INSTALL_ONE_ID },
    installations: populatedInstallations(),
    configProfiles: populatedConfigProfiles(),
    configPlayedMods: {},
    configPendingWrites: {},
    configSwitchBinds: {},
    // Story 072 D6: non-default downloads settings (mirrors src/shared/modules/downloads.ts's
    // `downloads` state.json key, see `DOWNLOADS_SETTINGS_SEED` above).
    downloads: { ...DOWNLOADS_SETTINGS_SEED },
    // Story 075 D7: two static failure-log entries, one with diagnostics and one without (AC8).
    downloadFailures: populatedDownloadFailures(),
  }
}

// --- settings.ts WindowState shape ------------------------------------------
// Mirrors src/shared/types/settings.ts:34-41 (`WindowState`).

function windowStateDocument() {
  return {
    width: 1280,
    height: 800,
    maximized: false,
    fullScreen: false,
  }
}

// --- config.cfg importable fixture ------------------------------------------
// Fixed-content `baseq2/config.cfg` written under `fixture-install-writedir`
// only, so the config-import/preview flow has something real to read. Used by
// `config-import-preview` and `config-import-review`; see
// src/main/modules/config/core/import-reader.ts for how `seta`/`bind`/`alias`
// lines are recognized.
//
// - `bind w` appears twice with no `unbind w` in between: import-reader.ts's
//   `applyBind` records that as a duplicate bind (mirrors its own test,
//   "reports a key bound twice with no unbind in between as a duplicate").
// - `alias +fixture_unrecognized "echo hi"` is a plain alias definition
//   (story 041 taught `config-parser.ts` to recognize `alias`, so this no
//   longer lands in `preserved` the way it used to pre-story-041).
// - `alias q2l_fixture_layer "bind e +use"` is story 041's ambiguous
//   construct: its body contains a top-level `bind`, so it lands in
//   `ImportPreviewResult.ambiguousRebindAliases` and is what makes the
//   `config-import-review` screen's review step reachable.
const FIXTURE_CONFIG_CFG = `seta sensitivity "5"
seta cl_run "1"
seta name "FixtureUser"
seta cl_particles "1"
bind w "+forward"
bind s "+back"
bind MOUSE1 "+attack"
bind w "+moveup"
alias +fixture_unrecognized "echo hi"
alias q2l_fixture_layer "bind e +use"
`

// --- own-file ("restore") importable fixture -------------------------------
// Story 042 D6: fixed-content config carrying the `OWNERSHIP_MARKER` sentinel
// (`@shared/config/render.ts`) plus a well-formed `[q2l v=1]` header tag
// (`@shared/config/profile-metadata.ts`), written under `INSTALL_TWO_ID`'s
// `RESTORE_GAME_DIR` gamedir - used by the `config-import-restore` screen to
// exercise `ImportPreviewResult.ownWrittenFile`/`sourceProfileId`/
// `metadataWarnings`.
//
// - Line 1 is the literal sentinel line naming `fixture-profile-plain` (the
//   `plain` profile's own id, `populatedConfigProfiles()` below) - so the
//   import dialog's restore banner resolves and names a real local profile
//   rather than falling back to the bare id.
// - Line 3 carries the header block's `[q2l v=1]` version marker - required
//   for `restoreProfileParts` to take the tagged path at all (an untagged
//   sentinel-only file delegates wholesale to story 041's import instead).
// - The last `bind` line's trailing comment carries a deliberately malformed
//   tag (`[q2l bogus]`, no `key=value` pairs) so `metadataWarnings` is
//   non-empty on this screen (`tag-malformed`, `profile-restore.ts`) -
//   without it the warnings list would never render on any fixture screen.
// - No entry (`e=`)/category (`cat=`) tags at all: this is a minimal
//   launcher file with no actions/layers, same as a freshly created empty
//   profile would restore to (`actions`/`categories`/`layers` all empty).
// - Line 1's trailing clause is deliberately the OLD (pre-story-043) sentinel wording, not the
//   current one - a live exercise of the wording-tolerant ownership check
//   (`ownedProfileId`/`findOwnCanonicalFile`, `@shared/config/render.ts` + `canonical.ts`) rather
//   than a copy/paste that happened to go stale. Line 4, in contrast, must stay byte-identical to
//   `HAND_EDIT_SENTENCE` (`@shared/config/render.ts`) - `profile-restore.ts`'s
//   `consumeHeaderDecoration` matches it exactly so this line is recognised as understood header
//   decoration and folded out of the import dialog's "unrecognised leftovers" list; letting it
//   drift out of sync (as it did across story 043's D1 wording change) reintroduces the exact
//   `scrollable-region-focusable` axe violation story 042's fix-cycle-5 closed, because an
//   unrecognised long comment line renders as its own scrollable single-line code block with no
//   keyboard access.
// - Story 051 (the header-block rewrite: sentinel line dropped from profile files, ownership id
//   moved into the `[q2l ...]` tag's `id` field, four-line `=`-ruled banner replacing this five-line
//   block) deliberately leaves this whole literal in the OLD/legacy shape rather than updating it to
//   match `buildHeaderBlock`'s new output. That is not staleness: this fixture is now the
//   live-smoke regression probe for story 051's AC7 - "a file carrying the previous header shape is
//   still recognised as launcher-owned and is rewritten in the new shape on its next save" - so
//   `npm run ui:verify`'s config-import-restore screen exercises the legacy-shape read path in the
//   real app on every run. Do not "fix" this to the new banner shape in a future change; that would
//   delete the one place in the repo that keeps the legacy-shape reader honest end to end.
const FIXTURE_RESTORE_CONFIG_CFG = `// q2-launcher profile fixture-profile-plain - generated, do not edit
// ================================================================
// Fixture Restored Profile [q2l v=1]
// Q2 Launcher - hand-edited changes to this file are read back
// ================================================================

// --- General ---
set sensitivity "5"

// --- Other binds ---
bind w "+forward"
bind s "+back" // note [q2l bogus]
`

// --- writers ----------------------------------------------------------------

// --- story 052 D10: template-seeded / imported-only Controls fixtures --------
//
// `populated`'s `STATE_SCHEMA_VERSION` mirror above (`1`) is deliberately never bumped in step
// with `src/shared/constants.ts` (currently `2`): every `populated`/`empty` run starts one schema
// version behind the real app on purpose, so the real migration
// (`src/main/services/migrations.ts`, story 052 D6) runs fresh on every reseed and materialises
// `TEMPLATE_ACTION_CATEGORIES` plus one action per `allCatalogRows()` row into every pre-existing
// profile at runtime - exactly the "existing profiles migrate once" behaviour AC8 describes. That
// is what already makes the `config-controls`/`config-controls-message`/
// `config-controls-drop-message` screens and the `drop-message-checkbox` flow show Plain Profile's
// full Movement/Weapons/Weapon-dropping rail today, without hand-authoring roughly fifty catalogue
// rows here.
//
// The two profiles below need the opposite guarantee: a profile with only its own "Imported"
// category must show *only* that (AC1/AC7). If it shared a document with `STATE_SCHEMA_VERSION`
// still at `1`, that very same migration would blindly add Movement/Weapons/Weapon dropping to it
// too - the migration has no way to tell "predates story 052" apart from "genuinely has just one
// category". A dedicated third fixture variant, seeded at the real, current schema version (so no
// migration runs for anyone in this document), is what keeps that guarantee intact without
// touching `populated`/`empty` at all.
/** Mirrors src/shared/constants.ts:14 (`STATE_SCHEMA_VERSION`), unlike the deliberately-stale
 * `STATE_SCHEMA_VERSION` above - see the comment block just above this constant. */
const CONTROLS_SEED_SCHEMA_VERSION = 2

/** Mirrors src/shared/modules/config.ts:146-150 (`TEMPLATE_ACTION_CATEGORIES`). */
const TEMPLATE_CATEGORIES = [
  { id: 'movement', name: 'Movement', nameKey: 'config.controls.categories.movement' },
  { id: 'weapons', name: 'Weapons', nameKey: 'config.controls.categories.weapons' },
  { id: 'drops', name: 'Weapon dropping', nameKey: 'config.controls.categories.drops' },
]

/**
 * Mirrors src/shared/config/catalog-rows.ts's `allCatalogRows()` (in turn built from
 * src/shared/config/action-catalog.ts's `MOVEMENT_ACTIONS`/`WEAPONS`/`WEAPON_ACTIONS`/
 * `WEAPON_EXTRA_ACTIONS`/`DROPPABLES`), in the exact order the real function produces them:
 * movement, `use <weapon>`, weapon cycling, then the three drop groups (weapon/ammo/misc). Each
 * tuple is `[kind, id, categoryId, command]`; `catalogId` is `${kind}:${id}` (`makeCatalogId`) and
 * a row's display name is its own raw command (`nameForCatalogRow`), since every row here carries
 * exactly one command.
 */
const TEMPLATE_CATALOG_ROW_TUPLES = [
  // movement (MOVEMENT_ACTIONS)
  ['movement', 'forward', 'movement', '+forward'],
  ['movement', 'back', 'movement', '+back'],
  ['movement', 'moveleft', 'movement', '+moveleft'],
  ['movement', 'moveright', 'movement', '+moveright'],
  ['movement', 'moveup', 'movement', '+moveup'],
  ['movement', 'movedown', 'movement', '+movedown'],
  ['movement', 'attack', 'movement', '+attack'],
  ['movement', 'speed', 'movement', '+speed'],
  ['movement', 'strafe', 'movement', '+strafe'],
  ['movement', 'left', 'movement', '+left'],
  ['movement', 'right', 'movement', '+right'],
  ['movement', 'klook', 'movement', '+klook'],
  ['movement', 'mlook', 'movement', '+mlook'],
  ['movement', 'centerview', 'movement', 'centerview'],
  // weaponUse (WEAPON_ACTIONS, one per WEAPONS entry)
  ['weaponUse', 'blaster', 'weapons', 'use blaster'],
  ['weaponUse', 'shotgun', 'weapons', 'use shotgun'],
  ['weaponUse', 'sshotgun', 'weapons', 'use super shotgun'],
  ['weaponUse', 'machinegun', 'weapons', 'use machinegun'],
  ['weaponUse', 'chaingun', 'weapons', 'use chaingun'],
  ['weaponUse', 'grenades', 'weapons', 'use grenades'],
  ['weaponUse', 'glauncher', 'weapons', 'use grenade launcher'],
  ['weaponUse', 'rlauncher', 'weapons', 'use rocket launcher'],
  ['weaponUse', 'hyperblaster', 'weapons', 'use hyperblaster'],
  ['weaponUse', 'railgun', 'weapons', 'use railgun'],
  ['weaponUse', 'bfg', 'weapons', 'use bfg10k'],
  // weaponExtra (WEAPON_EXTRA_ACTIONS)
  ['weaponExtra', 'weapnext', 'weapons', 'weapnext'],
  ['weaponExtra', 'weapprev', 'weapons', 'weapprev'],
  ['weaponExtra', 'weaplast', 'weapons', 'weaplast'],
  // dropWeapon (DROPPABLES kind === 'weapon', i.e. WEAPONS minus blaster)
  ['dropWeapon', 'shotgun', 'drops', 'drop shotgun'],
  ['dropWeapon', 'sshotgun', 'drops', 'drop super shotgun'],
  ['dropWeapon', 'machinegun', 'drops', 'drop machinegun'],
  ['dropWeapon', 'chaingun', 'drops', 'drop chaingun'],
  ['dropWeapon', 'grenades', 'drops', 'drop grenades'],
  ['dropWeapon', 'glauncher', 'drops', 'drop grenade launcher'],
  ['dropWeapon', 'rlauncher', 'drops', 'drop rocket launcher'],
  ['dropWeapon', 'hyperblaster', 'drops', 'drop hyperblaster'],
  ['dropWeapon', 'railgun', 'drops', 'drop railgun'],
  ['dropWeapon', 'bfg', 'drops', 'drop bfg10k'],
  // dropAmmo (DROPPABLES kind === 'ammo')
  ['dropAmmo', 'shells', 'drops', 'drop shells'],
  ['dropAmmo', 'bullets', 'drops', 'drop bullets'],
  ['dropAmmo', 'rockets', 'drops', 'drop rockets'],
  ['dropAmmo', 'cells', 'drops', 'drop cells'],
  ['dropAmmo', 'slugs', 'drops', 'drop slugs'],
  ['dropAmmo', 'hgrenades', 'drops', 'drop grenades'],
  // dropMisc (DROPPABLES kind === 'powerup' || 'tech')
  ['dropMisc', 'powershield', 'drops', 'drop power shield'],
  ['dropMisc', 'powerscreen', 'drops', 'drop power screen'],
  ['dropMisc', 'quad', 'drops', 'drop quad damage'],
  ['dropMisc', 'invuln', 'drops', 'drop invulnerability'],
  ['dropMisc', 'silencer', 'drops', 'drop silencer'],
  ['dropMisc', 'rebreather', 'drops', 'drop rebreather'],
  ['dropMisc', 'envsuit', 'drops', 'drop environment suit'],
  ['dropMisc', 'adrenaline', 'drops', 'drop adrenaline'],
  ['dropMisc', 'bandolier', 'drops', 'drop bandolier'],
  ['dropMisc', 'ammopack', 'drops', 'drop ammo pack'],
  ['dropMisc', 'tech', 'drops', 'drop tech'],
]

const TEMPLATE_CATALOG_ROWS = TEMPLATE_CATALOG_ROW_TUPLES.map(
  ([kind, id, categoryId, command]) => ({
    catalogId: `${kind}:${id}`,
    categoryId,
    command,
  }),
)

/** Mirrors src/shared/modules/config.ts's `TEMPLATE_BOUND_CATALOG_IDS` and `STANDARD_TEMPLATE.binds`
 * - the six catalogue rows a freshly created template profile binds immediately, and the key each
 * is bound to. */
const TEMPLATE_BOUND_KEYS = {
  'movement:forward': 'UPARROW',
  'movement:back': 'DOWNARROW',
  'movement:moveup': 'SPACE',
  'movement:movedown': 'c',
  'movement:speed': 'SHIFT',
  'movement:attack': 'MOUSE1',
}

/**
 * Story 053 D8: mirrors `src/shared/modules/config.ts`'s five template sub-category ids/names
 * (`WEAPONS_USE_SUBCATEGORY_ID` etc., added by D5) and its `TEMPLATE_SUBCATEGORY_ID_BY_CATALOG_PREFIX`
 * - this fixture's `templateSeededConfigProfile()` predates D5 and, until this deliverable, never
 * carried any `subcategories`/`subcategoryId`, so the `config-controls-template-seeded` screen never
 * actually showed a sub-categorised view even after D5 landed. Kept as its own literal block, not
 * imported, for the same "plain Node ESM can't import from the src TS trees" reason every other
 * mirror in this file gives (see the file's own doc comment at the top).
 */
const WEAPONS_USE_SUBCATEGORY_ID = 'weapons-use'
const WEAPONS_CYCLING_SUBCATEGORY_ID = 'weapons-cycling'
const DROPS_WEAPONS_SUBCATEGORY_ID = 'drops-weapons'
const DROPS_AMMO_SUBCATEGORY_ID = 'drops-ammo'
const DROPS_MISC_SUBCATEGORY_ID = 'drops-misc'

/** `CatalogRowKind` prefix (`row.catalogId.split(':')[0]`) -> the template sub-category it seeds
 * into. Mirrors `TEMPLATE_SUBCATEGORY_ID_BY_CATALOG_PREFIX` (`src/shared/modules/config.ts`). A
 * prefix missing here (`movement`) gets no `subcategoryId` - it lands in the ungrouped run. */
const TEMPLATE_SUBCATEGORY_ID_BY_CATALOG_PREFIX = {
  weaponUse: WEAPONS_USE_SUBCATEGORY_ID,
  weaponExtra: WEAPONS_CYCLING_SUBCATEGORY_ID,
  dropWeapon: DROPS_WEAPONS_SUBCATEGORY_ID,
  dropAmmo: DROPS_AMMO_SUBCATEGORY_ID,
  dropMisc: DROPS_MISC_SUBCATEGORY_ID,
}

function templateSubcategoryIdFor(catalogId) {
  const prefix = catalogId.split(':')[0] ?? ''
  return TEMPLATE_SUBCATEGORY_ID_BY_CATALOG_PREFIX[prefix]
}

/**
 * A profile shaped exactly like "create from template" would produce (mirrors
 * `STANDARD_TEMPLATE`/`buildTemplateActions` in src/shared/modules/config.ts): the three template
 * categories, and one action per catalogue row - unbound (`commands: []`) except the six rows
 * `TEMPLATE_BOUND_KEYS` names, which carry their real command and key exactly as a fresh template
 * profile's first commit would. Demonstrates AC4 on the `config-controls-template-seeded` screen.
 */
function templateSeededConfigProfile() {
  const binds = {}
  for (const [catalogId, key] of Object.entries(TEMPLATE_BOUND_KEYS)) {
    const row = TEMPLATE_CATALOG_ROWS.find((candidate) => candidate.catalogId === catalogId)
    binds[key] = row.command
  }

  return {
    id: 'fixture-profile-template-seeded',
    name: 'Template Profile',
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    // Mirrors STANDARD_TEMPLATE.cvars (src/shared/modules/config.ts).
    cvars: {
      sensitivity: '3',
      cl_run: '0',
      crosshair: '0',
      cl_gun: '1',
      m_pitch: '0.022',
      volume: '0.7',
    },
    binds,
    assignments: [],
    // Story 053 D8: `weapons`/`drops` now carry the same `subcategories` STANDARD_TEMPLATE.categories
    // seeds (D5) - so a template-seeded profile shows real group headers, not just three flat
    // categories, matching what "create from template" actually produces today.
    categories: TEMPLATE_CATEGORIES.map((category) => ({
      ...category,
      ...(category.id === 'weapons'
        ? {
            subcategories: [
              { id: WEAPONS_USE_SUBCATEGORY_ID, name: 'Use weapon' },
              { id: WEAPONS_CYCLING_SUBCATEGORY_ID, name: 'Cycling' },
            ],
          }
        : {}),
      ...(category.id === 'drops'
        ? {
            subcategories: [
              { id: DROPS_WEAPONS_SUBCATEGORY_ID, name: 'Weapons' },
              { id: DROPS_AMMO_SUBCATEGORY_ID, name: 'Ammunition' },
              { id: DROPS_MISC_SUBCATEGORY_ID, name: 'Misc' },
            ],
          }
        : {}),
    })),
    actions: TEMPLATE_CATALOG_ROWS.map((row) => {
      const key = TEMPLATE_BOUND_KEYS[row.catalogId]
      const slug = row.catalogId.replace(/[^a-z0-9]+/gi, '-')
      const subcategoryId = templateSubcategoryIdFor(row.catalogId)
      return {
        id: `fixture-template-seed-${slug}`,
        categoryId: row.categoryId,
        name: row.command,
        kind: 'bind',
        catalogId: row.catalogId,
        commands: key ? [{ kind: 'raw', text: row.command }] : [],
        ...(key ? { key } : {}),
        ...(subcategoryId ? { subcategoryId } : {}),
      }
    }),
  }
}

/**
 * Story 058 D7: the `controls-seed` variant's own installation, used only so
 * `importedOnlyConfigProfile()` below can be assigned to one for the `config-care-clear` screen
 * (the healthy Care fixture). None of `config-controls-imported-only`/`config-controls-template-
 * seeded`/`config-controls-template-subcategories` or the `controls-subcategory` flow touch
 * installations at all, so adding one here does not change anything about how those screens read.
 */
const INSTALL_CONTROLS_SEED_ID = 'fixture-install-controls-seed'

/**
 * A profile with a single, non-template category ("Imported") and a few free-form entries of its
 * own - no `movement`/`weapons`/`drops` at all. Demonstrates AC1/AC7: "a profile with only an
 * Imported category shows only that" on the `config-controls-imported-only` screen.
 *
 * Story 058 D7: also the `config-care-clear` screen's healthy fixture - deliberately NOT
 * `templateSeededConfigProfile()`/a migrated `populated` profile, both of which carry the full
 * movement/weapons/drops catalogue and therefore always raise `aliasShadowsCommand` findings for
 * several of its rows (`+moveleft` etc. resolve to alias names that collide with a reserved
 * command name - `validate-actions.ts`'s own doc comment confirms this fires for a catalogue row
 * too, not just a hand-typed one). This profile's three free-form entries do not collide with
 * anything reserved, so it is the one fixture profile that can actually reach Care's "All clear".
 * Assigned to `INSTALL_CONTROLS_SEED_ID` below so AC 1's "assigned, in-sync installation" is real,
 * not merely "nothing to validate against".
 */
function importedOnlyConfigProfile() {
  return {
    id: 'fixture-profile-imported-only',
    name: 'Imported Category Profile',
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    cvars: {},
    // No `binds` mirror for the "Use item" action below: unlike a catalogue-backed row,
    // `bindValueFor` (@shared/config/action-mirror.ts) only passes a bare `+command` through
    // verbatim when the action carries a `catalogId` - a free-form action's mirror is always its
    // alias name, so a hand-authored `binds.e: '+use'` here would read as a *second*, independent
    // claimant on `e` to `bind-conflicts.ts`'s scan and raise a spurious conflict badge that has
    // nothing to do with this screen's own point (AC1/AC7's "shows only its own category").
    binds: {},
    assignments: [{ installationId: INSTALL_CONTROLS_SEED_ID, isDefault: true }],
    categories: [{ id: 'imported', name: 'Imported' }],
    actions: [
      {
        id: 'fixture-imported-use',
        categoryId: 'imported',
        name: 'Use item',
        kind: 'bind',
        // Story 058 D7: real Quake II has no continuous `+use`/`-use` pair (the actual console
        // command is the discrete `use <item>`), so a signed `+use` token here reads to
        // `validate-actions.ts`'s `undefinedAlias` rule exactly like a hand-typed reference to an
        // alias that does not exist - it is neither a known engine command nor a defined alias.
        // Harmless for this profile's original purpose (`config-controls-imported-only` only checks
        // that the "Imported" category renders, never this row's exact command), but it is also now
        // the `config-care-clear` screen's healthy fixture (added in this deliverable), which needs
        // this profile to carry zero validation findings. The bare `use` command is exactly what a
        // real "Use item" bind would send.
        commands: [{ kind: 'raw', text: 'use' }],
        key: 'e',
      },
      {
        id: 'fixture-imported-inventory',
        categoryId: 'imported',
        name: 'Inventory',
        kind: 'bind',
        commands: [{ kind: 'raw', text: 'inven' }],
      },
      {
        id: 'fixture-imported-gg',
        categoryId: 'imported',
        name: 'GG',
        kind: 'message',
        commands: [{ kind: 'message', channel: 'say', text: 'gg' }],
      },
    ],
  }
}

function controlsSeedStateDocument() {
  return {
    schemaVersion: CONTROLS_SEED_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, scanOnFirstRun: false },
    installations: [
      makeInstallation({
        id: INSTALL_CONTROLS_SEED_ID,
        name: 'Controls Seed Install',
        rootPath: join(gameRoot(), INSTALL_CONTROLS_SEED_ID),
        favorite: false,
        sortOrder: 0,
      }),
    ],
    configProfiles: [templateSeededConfigProfile(), importedOnlyConfigProfile()],
    configPlayedMods: {},
    configPendingWrites: {},
    configSwitchBinds: {},
  }
}

/** Deletes and rewrites the `controls-seed` variant's userdata, plus its one installation's game
 * dir (story 058 D7 - see `INSTALL_CONTROLS_SEED_ID`'s own doc comment). */
export function writeControlsSeedFixture() {
  const userDataDir = variantUserDataDir('controls-seed')
  rmDirBestEffort(userDataDir)
  mkdirSync(userDataDir, { recursive: true })

  writeJson(join(userDataDir, STATE_FILE), controlsSeedStateDocument())
  writeJson(join(userDataDir, WINDOW_STATE_FILE), windowStateDocument())

  const baseq2Dir = join(gameRoot(), INSTALL_CONTROLS_SEED_ID, 'baseq2')
  rmDirBestEffort(join(gameRoot(), INSTALL_CONTROLS_SEED_ID))
  mkdirSync(baseq2Dir, { recursive: true })

  return { userDataDir, installations: 1, configProfiles: 2 }
}

function writeJson(path, value) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writeConfigCfg(baseq2Dir) {
  writeFileSync(join(baseq2Dir, 'config.cfg'), FIXTURE_CONFIG_CFG, 'utf8')
}

/** Story 042 D6: writes the own-file ("restore") fixture into `RESTORE_GAME_DIR`. */
function writeRestoreConfigCfg(installDir) {
  const dir = join(installDir, RESTORE_GAME_DIR)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'config.cfg'), FIXTURE_RESTORE_CONFIG_CFG, 'utf8')
}

/**
 * Story 067 D5: writes the custom-icon PNG an `icon: { kind: 'custom' }` installation's file lives
 * at - `userData/installation-icons/<installationId>.png` (mirrors `InstallationIcon`'s own doc
 * comment, `src/shared/types/installation.ts`), which is what `installations:iconDataUrl` (D4)
 * reads back as a `data:` URL.
 */
function writeCustomIconFile(userDataDir, installationId) {
  const dir = join(userDataDir, 'installation-icons')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${installationId}.png`), Buffer.from(CUSTOM_ICON_PNG_BASE64, 'base64'))
}

/**
 * On Windows, closing an Electron session's GPU process (Dawn's WebGPU/Graphite disk cache
 * under `userData`) doesn't release its cache files immediately - `app.close()` returns before
 * Windows (observed: real-time AV scanning the freshly-closed cache blobs, anywhere from a few
 * seconds up to several minutes under load, with no live process holding the handle) actually
 * lets go, so the very next fixture reseed can hit `EPERM`/`EBUSY` on a directory nothing still
 * wants. `maxRetries`/`retryDelay` are Node's own documented remedy for exactly this class of
 * transient Windows delete failure, but the observed worst case is unbounded enough that no
 * fixed budget can be sized to always win.
 *
 * So this is a best-effort delete, not an all-or-nothing one: what a fixture reseed actually
 * needs is `state.json`/`window-state.json` to hold this run's fresh data, never a byte-clean
 * `userData` directory - a stale, still-locked cache subfolder left behind is harmless (Chromium
 * happily reuses or extends an existing disk cache) and must never fail the whole run. On a
 * still-locked path after the retry budget, this logs a warning and moves on so `mkdirSync` +
 * the two `writeJson` calls right after it can still put the run in a known-good state.
 */
const RM_RETRY_OPTIONS = { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }

function rmDirBestEffort(path) {
  try {
    rmSync(path, RM_RETRY_OPTIONS)
  } catch (error) {
    console.warn(
      `[fixture] could not fully clear ${path} (${error.code ?? error.message}) - a locked ` +
        'leftover (e.g. GPU disk cache) is harmless and the fixture reseed continues regardless.',
    )
  }
}

/** Deletes and rewrites the `populated` variant's userdata + game dirs. */
export function writePopulatedFixture() {
  const userDataDir = variantUserDataDir('populated')
  rmDirBestEffort(userDataDir)
  mkdirSync(userDataDir, { recursive: true })

  writeJson(join(userDataDir, STATE_FILE), populatedStateDocument())
  writeJson(join(userDataDir, WINDOW_STATE_FILE), windowStateDocument())
  writeDownloadsCacheArchives(userDataDir)

  const installIds = [INSTALL_ONE_ID, INSTALL_TWO_ID, INSTALL_UNKNOWN_ENGINE_ID]
  for (const id of installIds) {
    const baseq2Dir = join(gameRoot(), id, 'baseq2')
    rmDirBestEffort(join(gameRoot(), id))
    mkdirSync(baseq2Dir, { recursive: true })
    if (id === INSTALL_TWO_ID) {
      writeConfigCfg(baseq2Dir)
      writeRestoreConfigCfg(join(gameRoot(), id))
      // Story 067 D5: this is also the installation seeded with `icon: { kind: 'custom' }`.
      writeCustomIconFile(userDataDir, id)
    }
  }

  // Story 077 D5: `INSTALL_FAILED_ID`'s root, deliberately WITHOUT a `baseq2` subfolder - unlike
  // every id in the loop above. A folder that exists but holds nothing is exactly what
  // `bootstrap/job.ts`'s failure cleanup leaves behind (see that installation's own doc comment in
  // `populatedInstallations()`), and it is what makes the real app's own startup `validateAll()`
  // re-derive `status: 'invalid'` here rather than disagreeing with the value already seeded above.
  rmDirBestEffort(join(gameRoot(), INSTALL_FAILED_ID))
  mkdirSync(join(gameRoot(), INSTALL_FAILED_ID), { recursive: true })

  return {
    userDataDir,
    installations: installIds.length + 1,
    configProfiles: populatedConfigProfiles().length,
  }
}

/** Deletes and rewrites the `empty` variant's userdata (defaults only). */
export function writeEmptyFixture() {
  const userDataDir = variantUserDataDir('empty')
  rmDirBestEffort(userDataDir)
  mkdirSync(userDataDir, { recursive: true })

  writeJson(join(userDataDir, STATE_FILE), emptyStateDocument())
  writeJson(join(userDataDir, WINDOW_STATE_FILE), windowStateDocument())

  return { userDataDir, installations: 0, configProfiles: 0 }
}

export function writeFixture(variant) {
  // Story 066 D8: staged independently of which variant is being (re)written - see
  // `writeImportFilesFixture()`'s own doc comment for why this has to happen on every reseed
  // regardless of variant (AC9 points the same three files at the `empty` variant too).
  writeImportFilesFixture()
  if (variant === 'populated') return writePopulatedFixture()
  if (variant === 'empty') return writeEmptyFixture()
  if (variant === 'controls-seed') return writeControlsSeedFixture()
  throw new Error(`unknown fixture variant: ${variant}`)
}

export const FIXTURE_VARIANTS = ['populated', 'empty', 'controls-seed']

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

// --- story 074 D8: the offline bootstrap-wizard fixture -----------------------------------------
//
// `scripts/flows/bootstrap-wizard.mjs` runs the REAL bootstrap job - real manifest fetch, three
// real verified downloads, three real `7za.exe` extractions, the real assemble/revalidate passes -
// and must do so with no outbound network access whatsoever. That needs three things, and all
// three are built here:
//
//   1. three real, 7-Zip-extractable archives, laid out the way the REAL archives are - not the
//      way `bootstrap/assemble.ts`'s allowlist was once guessed to expect (story 076 measured and
//      fixed that gap): `q2pro64.exe` + `baseq2/{gamex86_64.dll,q2pro.menu}` for the engine,
//      `Install/Data/baseq2/{pak0.pak,players/...}` for the demo, and
//      `baseq2/{pak1.pak,pak2.pak,players/...}` for the point release - plus `ctf/`, `xatrix/`
//      and `rogue/` payloads inside the point-release archive so AC8's "no ctf/xatrix/rogue
//      directory is created" is a claim about real, discarded input rather than about an input
//      that never had any. `BOOTSTRAP_FIXTURE_LAYOUT` below is this layout as data;
//   2. a `127.0.0.1` server serving both manifest files and those archives - with the real
//      sha256/size of the archives on disk, so nothing about the verification step is faked; and
//   3. a target folder that is deliberately BOTH under a fake `Program Files` root (AC2) and
//      non-empty (AC3), so one pass through the wizard renders and acknowledges both warnings.
//
// Everything lands under `.ui-verify/fixture/bootstrap/` and nowhere else - the paths go through
// `assertInside(UI_VERIFY_ROOT, ...)`, the same containment discipline `harness.mjs` applies to
// `--user-data-dir`.
//
// None of this is part of `writeFixture()`/`ui:seed`: these artefacts are only ever wanted by that
// one flow, they cost a few seconds and ~10 MB to build, and (unlike the `populated`/`empty` state
// documents) they are not byte-identical per run, since a zip stores mtimes. That is harmless
// because every digest below is computed from the bytes that were actually written.

/** `.ui-verify/fixture/bootstrap` - everything this section writes lives under it. */
function bootstrapFixtureRoot() {
  return assertInside(
    UI_VERIFY_ROOT,
    join(UI_VERIFY_ROOT, 'fixture', 'bootstrap'),
    'bootstrap fixture root',
  )
}

/**
 * A path under the machine's REAL `%ProgramFiles%` that is only ever *named*, never created and
 * never written to - the target the flow points the wizard's step 2 at to make AC2's Program Files
 * warning appear, before re-picking the real fixture target below.
 *
 * Story 074's refine expected this to work the other way round ("the e2e flow can exercise the
 * verdict by pointing the child process's `ProgramFiles` at a fixture dir - no production backdoor
 * needed"). On Windows it cannot: `ProgramFiles`, `ProgramFiles(x86)` and `NUMBER_OF_PROCESSORS`
 * are regenerated by the loader for every new process from the process's own bitness, so a value
 * handed to `CreateProcess` in the environment block is simply replaced - measured, not assumed.
 * `bootstrap/target.test.ts` can still inject a fake root, because it calls
 * `computeTargetVerdict(path, { env })` in-process; a child process cannot be lied to this way.
 *
 * Naming a real Program Files path is safe here because `computeTargetVerdict` is a read-only
 * verdict: the folder does not have to exist (`programFiles` is a prefix comparison,
 * `alreadyInstalled`/`entries` are skipped for a non-existent directory) and the only write it
 * attempts is the same throwaway probe marker in the nearest existing ancestor that a real user
 * picking that folder would trigger - which fails harmlessly without elevation. The flow never
 * proceeds past the target step with this path selected, so nothing is ever installed there.
 */
export function bootstrapProgramFilesProbePath() {
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
  return join(programFiles, 'Q2 Launcher UI Verify Fixture')
}

/** The folder the wizard actually installs into: writable, under `.ui-verify/`, and non-empty (AC3). */
export function bootstrapTargetDir() {
  return join(bootstrapFixtureRoot(), 'target', 'Q2PRO Demo')
}

/**
 * The one pre-existing file that makes the target non-empty (AC3). A name that could plausibly be
 * the user's own, since that warning exists precisely because they may have put something here.
 */
export const BOOTSTRAP_TARGET_LOOSE_FILE = 'user-notes.txt'

/** Where the built archives are served from. */
function bootstrapPackagesDir() {
  return join(bootstrapFixtureRoot(), 'packages')
}

/** Scratch trees the archives are built out of; kept afterwards, so a build is easy to inspect. */
function bootstrapStagingDir() {
  return join(bootstrapFixtureRoot(), 'staging')
}

/** The vendored extractor - the same binary the app spawns (`7za-path.ts`, its dev branch). */
function vendoredSevenZaPath() {
  return join(REPO_ROOT, 'resources', 'bin', '7za.exe')
}

/** True when that binary is present; the flow refuses to pretend an extraction happened without it. */
export function vendoredExtractorExists() {
  return existsSync(vendoredSevenZaPath())
}

/**
 * `pak0.pak`'s fixture size: 8 MiB - deliberately NOT `RETAIL_PAK_SIZES['pak0.pak']`
 * (183,997,730, `src/shared/constants.ts`). `inspectInstallation` tells the demo from the retail
 * game by exactly that comparison, and AC7's Demo marker is derived from the
 * `validation.pak0NotRetail` warning it raises, so a retail-sized fixture would make this flow
 * prove the opposite of what it exists for.
 */
const FIXTURE_PAK0_BYTES = 8 * 1024 * 1024

/** Mirrors `RETAIL_PAK_SIZES['pak2.pak']` (45,055). Nothing depends on it; free realism. */
const FIXTURE_PAK2_BYTES = 45_055

/** `pak1.pak`'s fixture size - distinct from `FIXTURE_PAK2_BYTES` so the two files are never confused on disk. */
const FIXTURE_PAK1_BYTES = 38_912

/**
 * How many files the discarded `ctf/` payload holds. Two jobs: it makes AC8's negative assertion
 * meaningful (a real payload the allowlist walks past), and it gives the job's tail - the final
 * revalidation plus the `rm -r` of the three extract trees, both of which happen AFTER
 * `markPlayable` - enough real work that "Play is enabled while the job is still running" (AC6) is
 * an observable window rather than a coin flip. See the sampler in
 * `scripts/flows/bootstrap-wizard.mjs`.
 *
 * Measured, not guessed: at 300 files the flow's sampler caught that window in ~60ms of samples, at
 * 900 in ~80ms. Most of it turns out to be the two `jobs:changed` round trips and their React
 * renders rather than the disk work, so raising this further buys little - it is kept at 900 for the
 * ~33% margin it does buy, and because the real 3.20 point release ships a `ctf/` payload of
 * comparable size, which makes AC8's negative assertion less artificial rather than more.
 */
const FIXTURE_CTF_FILE_COUNT = 900

/** Deterministic filler, never random, so two builds are comparable. */
function filler(bytes, byte) {
  return Buffer.alloc(bytes, byte)
}

function writeFileIn(dir, name, contents) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), contents)
}

/**
 * Builds one staging tree and zips its named top-level entries into `packages/<fileName>`.
 *
 * A `.zip` rather than a self-extracting `.exe`: the point of this fixture is that the app's REAL
 * extractor runs against a REAL archive, and a hand-forged byte sequence that merely looked like an
 * installer would prove nothing. `7za.exe` is the same binary `extractor.ts` spawns, so an archive
 * it wrote is certainly one the app can read. The entries are named explicitly rather than globbed,
 * so the archive's internal layout is stated here instead of inherited from a directory walk.
 */
function buildFixturePackage({ fileName, stagingName, entries, build }) {
  const staging = join(bootstrapStagingDir(), stagingName)
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  build(staging)

  const archivePath = join(bootstrapPackagesDir(), fileName)
  mkdirSync(bootstrapPackagesDir(), { recursive: true })
  // `7za a` APPENDS to an existing archive, so a stale one has to go first.
  rmSync(archivePath, { force: true })
  execFileSync(
    vendoredSevenZaPath(),
    ['a', '-tzip', '-mx1', '-bso0', '-bse0', '-bd', archivePath, ...entries],
    { cwd: staging, windowsHide: true },
  )

  const bytes = readFileSync(archivePath)
  return {
    fileName,
    path: archivePath,
    sizeBytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

/**
 * The three archives, in the order the job downloads them. Package ids satisfy `job.ts`'s
 * `SAFE_PATH_SEGMENT` (an id becomes an extract-directory name) and the file names satisfy
 * `paths.ts`'s `isSafeDownloadFileName` (a name becomes a cache file name) - both are refused
 * rather than sanitised, so a fixture that ignored either would fail before a byte moved.
 */
function buildBootstrapPackages({ demoContributesNothing = false } = {}) {
  const engine = buildFixturePackage({
    fileName: 'q2pro-fixture-client.zip',
    stagingName: 'engine',
    entries: ['q2pro64.exe', 'baseq2'],
    build: (staging) => {
      // At the archive root, matching both the pinned Q2PRO release zip's own layout - which
      // calls its binary `q2pro64.exe`, not `q2pro.exe` - and `assemble.ts`'s
      // `{ from: ['q2pro.exe', 'q2pro64.exe'] }` allowlist entry (story 076 D1).
      writeFileIn(staging, 'q2pro64.exe', filler(96 * 1024, 0x4d))
      // Not allowlisted, on purpose: the real engine build does ship a `baseq2/` of its own (game
      // DLLs), and AC8's guarantee has to hold for that too.
      writeFileIn(join(staging, 'baseq2'), 'gamex86_64.dll', filler(32 * 1024, 0x44))
      // Ships alongside the binary and DLL in the same package (story 076 D1's allowlist, marked
      // optional). A few hundred bytes is enough - only its presence is ever checked.
      writeFileIn(join(staging, 'baseq2'), 'q2pro.menu', filler(512, 0x4e))
    },
  })

  const demo = buildFixturePackage({
    fileName: 'q2-demo-fixture.zip',
    stagingName: 'demo',
    entries: ['Install'],
    build: (staging) => {
      // Nested under `Install/Data/` - the real id Software InstallShield demo installer's actual
      // layout (measured 2026-09-08, story 076's Requirement table), not the flat `baseq2/` the
      // fixture used to guess. No `video/` anywhere in this package: the real archive has none
      // (AC4 - an absent `video/` is a normal outcome, never an error).
      //
      // `demoContributesNothing` (story 076 D6) skips writing `pak0.pak` - the required allowlist
      // entry - so the package downloads and extracts fine but contributes none of its required
      // files, the exact case `job.ts`'s `downloads.error.packageIncomplete` exists for. The
      // players file below is left in place so `entries: ['Install']` still names real staged
      // content and the archive still zips cleanly.
      if (!demoContributesNothing) {
        writeFileIn(
          join(staging, 'Install', 'Data', 'baseq2'),
          'pak0.pak',
          filler(FIXTURE_PAK0_BYTES, 0x50),
        )
      }
      writeFileIn(
        join(staging, 'Install', 'Data', 'baseq2', 'players', 'male'),
        'tris.md2',
        filler(4 * 1024, 0x54),
      )
    },
  })

  const pointRelease = buildFixturePackage({
    fileName: 'q2-point-release-fixture.zip',
    stagingName: 'point-release',
    entries: ['baseq2', 'ctf', 'xatrix', 'rogue'],
    build: (staging) => {
      writeFileIn(join(staging, 'baseq2'), 'pak1.pak', filler(FIXTURE_PAK1_BYTES, 0x51))
      writeFileIn(join(staging, 'baseq2'), 'pak2.pak', filler(FIXTURE_PAK2_BYTES, 0x52))
      // The real 3.20 full/CTF package ships `baseq2/players/` directly under its own `baseq2/`
      // - not nested under `Install/Data/` like the demo above.
      writeFileIn(join(staging, 'baseq2', 'players', 'male'), 'tris.md2', filler(4 * 1024, 0x54))
      for (let index = 0; index < FIXTURE_CTF_FILE_COUNT; index += 1) {
        writeFileIn(join(staging, 'ctf'), `ctf-payload-${index}.dat`, filler(4 * 1024, 0x43))
      }
      writeFileIn(join(staging, 'xatrix'), 'pak0.pak', filler(8 * 1024, 0x58))
      writeFileIn(join(staging, 'rogue'), 'pak0.pak', filler(8 * 1024, 0x47))
    },
  })

  return [
    { role: 'engine', id: 'q2pro-fixture-client', version: 'fixture-1', ...engine },
    { role: 'demo', id: 'q2-demo-fixture', version: '3.14-fixture', ...demo },
    {
      role: 'point-release',
      id: 'q2-point-release-fixture',
      version: '3.20-fixture',
      ...pointRelease,
    },
  ]
}

/**
 * Every source-relative path `buildBootstrapPackages()` actually writes, by role - literal, not
 * computed, so a later deliverable (076 D5) can cross-check it against a real-archive listing and
 * against `assemble.ts`'s allowlist candidates without re-deriving it. Deliberately excludes the
 * `ctf`/`xatrix`/`rogue` discard payloads: this documents what the ALLOWLIST is expected to find,
 * not everything the archive contains.
 */
export const BOOTSTRAP_FIXTURE_LAYOUT = {
  engine: ['q2pro64.exe', 'baseq2/gamex86_64.dll', 'baseq2/q2pro.menu'],
  demo: ['Install/Data/baseq2/pak0.pak', 'Install/Data/baseq2/players/male/tris.md2'],
  'point-release': ['baseq2/pak1.pak', 'baseq2/pak2.pak', 'baseq2/players/male/tris.md2'],
}

/**
 * Creates the target folder fresh, holding exactly one loose file. Called on every run, which is
 * what makes the flow re-runnable: a previous run left a whole assembled installation in there.
 */
export function writeBootstrapTargetDir() {
  const target = assertInside(UI_VERIFY_ROOT, bootstrapTargetDir(), 'bootstrap target')
  rmDirBestEffort(target)
  mkdirSync(target, { recursive: true })
  writeFileSync(
    join(target, BOOTSTRAP_TARGET_LOOSE_FILE),
    'A file of the user that was already sitting in this folder.\n',
    'utf8',
  )
  return target
}

/**
 * Story 077 D5: the target `scripts/flows/bootstrap-failure-retry.mjs`'s OWN wizard-created
 * installation uses - a sibling of `bootstrapTargetDir()` above, not that same folder. That one is
 * deliberately pre-seeded non-empty (AC3's warning, story 074); this one has to be genuinely FRESH -
 * the story's own "Decided during refine" note is explicit that the failing-then-succeeding run
 * happens against an installation the flow creates itself, distinct from the pre-seeded fixture row
 * `populatedInstallations()` adds for AC1's restart proof.
 */
export function bootstrapFailureRetryTargetDir() {
  return join(bootstrapFixtureRoot(), 'target', 'Failure Retry Demo')
}

/**
 * Deletes any leftover from a previous run and returns the (non-existent) path - what makes the
 * flow re-runnable without a manual reseed: a previous run's second (succeeding) wizard pass would
 * otherwise leave a fully assembled installation sitting where the next run needs a fresh folder.
 * Unlike `writeBootstrapTargetDir()`, this never recreates the directory or seeds a loose file in
 * it - the wizard's own `create()` step is what brings it into being, on the flow's first run.
 */
export function resetBootstrapFailureRetryTargetDir() {
  const target = assertInside(
    UI_VERIFY_ROOT,
    bootstrapFailureRetryTargetDir(),
    'bootstrap failure-retry target',
  )
  rmDirBestEffort(target)
  return target
}

/** How many body chunks each archive response is split into, and the pause between them. */
const BOOTSTRAP_SERVE_CHUNKS = 10
const BOOTSTRAP_SERVE_CHUNK_DELAY_MS = 45

/**
 * Starts the loopback fixture server and returns `{ baseUrl, packages, totalSizeBytes, close }`.
 *
 * **Bound to `127.0.0.1` explicitly, on an OS-assigned port.** The address is not decoration: the
 * app's harness override (`src/main/modules/downloads/harness.ts`) refuses any base URL whose
 * hostname is not literally `127.0.0.1`, and so does the harness-only package-URL schema
 * (`harnessLoopbackUrlSchema`) - a fixture server on any other interface could not be reached even
 * with both gates open.
 *
 * Archive bodies are streamed in `BOOTSTRAP_SERVE_CHUNKS` chunks with a small pause between them.
 * That is not throttling for its own sake: on loopback these archives transfer in single-digit
 * milliseconds, and the flow needs the download phase to last long enough to activate the freshly
 * registered installation before the job reaches its playable moment (AC6). `content-length` is
 * still the real, full size, so `fetcher.ts`'s size pre-check and its 30s stall detector both see
 * exactly what they would see from a real mirror.
 *
 * Only the paths registered below exist; everything else answers 404, so a request the app should
 * never make shows up as a failure rather than as silence.
 *
 * `demoContributesNothing` (story 076 D6) forwards straight into `buildBootstrapPackages()` - see
 * its own doc comment. Defaulted off, so every existing caller keeps working unchanged.
 *
 * `failFirstAttemptFor` (story 077 D5): a package id (`buildBootstrapPackages()`'s own `id`, e.g.
 * `'q2pro-fixture-client'`) whose PRIMARY url and MIRROR url each 404 on their own first request,
 * then serve that same package normally on every request after. This has to be a property of the
 * *server*, not of the flow driving it: `Q2L_UI_CONTENT_REPO_BASE` is fixed for the whole app
 * session (`src/main/lib/ui-harness.ts` reads it once), so a single flow that wants to prove both
 * the failing first run (AC1/AC5) and the adopting, succeeding retry (AC4/AC7) in one app session
 * has no other way to make the second attempt succeed where the first did not (Decisions (Refine)).
 * Undefined/omitted changes nothing about how every existing caller behaves.
 */
export async function startBootstrapFixtureServer({
  demoContributesNothing = false,
  failFirstAttemptFor,
} = {}) {
  const packages = buildBootstrapPackages({ demoContributesNothing })

  const failFirstPackage = failFirstAttemptFor
    ? packages.find((pkg) => pkg.id === failFirstAttemptFor)
    : undefined
  if (failFirstAttemptFor && !failFirstPackage) {
    throw new Error(
      `startBootstrapFixtureServer: failFirstAttemptFor ${JSON.stringify(failFirstAttemptFor)} ` +
        `matches no package id (have: ${packages.map((pkg) => pkg.id).join(', ')})`,
    )
  }
  /** The primary and mirror request paths that must 404 exactly once. Empty when the option is
   * unused, so nothing about a server started without it changes. */
  const failFirstPaths = failFirstPackage
    ? new Set([`/packages/${failFirstPackage.fileName}`, `/mirror/${failFirstPackage.fileName}`])
    : new Set()
  /** Which of `failFirstPaths` has already 404'd once - so the SECOND request to it (the retry) is
   * served normally. */
  const failedOnce = new Set()

  /** Everything this server is willing to serve, by request path. */
  const routes = new Map()
  /** Every path that was requested, in order - the flow prints it as its own offline evidence. */
  const requested = []

  const server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0]
    requested.push(path)
    if (failFirstPaths.has(path) && !failedOnce.has(path)) {
      failedOnce.add(path)
      response.writeHead(404, { 'content-type': 'text/plain' })
      response.end('not found (failFirstAttemptFor - first attempt only)')
      return
    }
    const route = routes.get(path)
    if (!route) {
      response.writeHead(404, { 'content-type': 'text/plain' })
      response.end('not found')
      return
    }
    void route(response)
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  const { port } = server.address()
  const baseUrl = `http://127.0.0.1:${port}`

  const jsonRoute = (body) => (response) => {
    const bytes = Buffer.from(JSON.stringify(body), 'utf8')
    response.writeHead(200, {
      'content-type': 'application/json',
      'content-length': bytes.byteLength,
    })
    response.end(bytes)
  }

  const archiveRoute = (archivePath) => async (response) => {
    const bytes = readFileSync(archivePath)
    response.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': bytes.byteLength,
    })
    const chunkSize = Math.ceil(bytes.byteLength / BOOTSTRAP_SERVE_CHUNKS)
    for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
      response.write(bytes.subarray(offset, Math.min(offset + chunkSize, bytes.byteLength)))
      await new Promise((done) => setTimeout(done, BOOTSTRAP_SERVE_CHUNK_DELAY_MS))
    }
    response.end()
  }

  const manifestPackage = (pkg, extra) => ({
    ...extra,
    id: pkg.id,
    version: pkg.version,
    sizeBytes: pkg.sizeBytes,
    sha256: pkg.sha256,
    url: `${baseUrl}/packages/${pkg.fileName}`,
    // A non-empty `mirrors` array, so the schema's mirror rule is exercised rather than bypassed.
    // Both entries work; the primary always succeeds here, so the mirror is never actually read.
    mirrors: [`${baseUrl}/mirror/${pkg.fileName}`],
    contents: [{ from: '.', to: extra.kind === 'engine' ? 'root' : 'baseq2' }],
  })

  const engine = packages.find((pkg) => pkg.role === 'engine')
  const demo = packages.find((pkg) => pkg.role === 'demo')
  const pointRelease = packages.find((pkg) => pkg.role === 'point-release')

  // Mirrors `ENGINES_MANIFEST_PATH`/`GAMEDATA_MANIFEST_PATH` (`manifest-service.ts`) and the
  // envelope shape of the real shipped files (`content/q2_community_content/*/manifest.json`).
  routes.set(
    '/engines/manifest.json',
    jsonRoute({
      schemaVersion: 1,
      packages: [manifestPackage(engine, { kind: 'engine', engine: 'q2pro' })],
      pinned: { q2pro: engine.id },
    }),
  )
  routes.set(
    '/gamedata/manifest.json',
    jsonRoute({
      schemaVersion: 1,
      packages: [
        manifestPackage(demo, { kind: 'gamedata', role: 'demo' }),
        manifestPackage(pointRelease, { kind: 'gamedata', role: 'point-release' }),
      ],
    }),
  )
  for (const pkg of packages) {
    routes.set(`/packages/${pkg.fileName}`, archiveRoute(pkg.path))
    routes.set(`/mirror/${pkg.fileName}`, archiveRoute(pkg.path))
  }

  return {
    baseUrl,
    packages,
    requested,
    /** Sum of the three archives' real sizes - the figure the confirm step must state (AC4). */
    totalSizeBytes: packages.reduce((total, pkg) => total + pkg.sizeBytes, 0),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      }),
  }
}

/**
 * Every entry in `targetPath`, one level deep, as `{ dirs, files }`. Read from Node rather than
 * scraped off the UI, because AC8 is a statement about the filesystem, not about a rendered list.
 */
export function readTargetTree(targetPath) {
  const dirs = []
  const files = []
  for (const name of readdirSync(targetPath)) {
    if (statSync(join(targetPath, name)).isDirectory()) dirs.push(name)
    else files.push(name)
  }
  return { dirs: dirs.sort(), files: files.sort() }
}
