# Config module

Status: **Implemented.** Central Quake II config profiles — edited in the launcher, kept as
`.cfg` files that are the source of truth, and written to every installation they are assigned to.

This document describes the module as built. It follows the architecture rules in
[CLAUDE.md](../../CLAUDE.md) and the module pattern in
[ARCHITECTURE.md](../ARCHITECTURE.md#adding-a-module); the on-disk file layout is specified in
[profile-file-format.md](profile-file-format.md). `config` is a registered module
(`src/shared/types/module.ts`, route `/config`); its contract is `src/shared/modules/config.ts`.

## Component map

**Main** (`src/main/modules/config/`)

- `index.ts` — `configModule`: builds the store and the write service, registers every handler,
  runs startup. Content setters, `openFile`, `preview`, `setPlayedMods`, import and cleanup live
  here; every file write is delegated.
- `profile-writes.ts` — `createProfileWrites`: every handler that writes or judges a file (`save`,
  `saveRawText`, `refreshFromFiles`, `commitCvars`, `assign`/`unassign`/`setDefault`, `write`,
  `setSwitchBind`, `tidyUpApply`, `syncState`, `rawFiles`) and the central write rule
  `syncAndPersist`. Reaches the app only through `ProfileWritesDeps`.
- `startup.ts` — `runConfigStartup`: file-source startup, then the write-failure retry sweep.
- `rebuild.ts` — one-time canonical-file format migration and rebuild-on-missing-record.
- `sync.ts` — `syncProfile`: one profile's canonical file plus every installation it is assigned
  to, cascading to profiles whose resolved file name moved; `installationCopySource`.
- `write-plan.ts` — pure planning: `defaultProfileFor`, `assignedProfilesFor`,
  `previewProfileFiles`, `validatePlayedMods`.
- `writer.ts` / `backup.ts` / `canonical.ts` — the disk: installation files (diff-skip,
  backup-once to `<file>.q2l-backup`, atomic), ownership reads, the canonical
  `<userData>/<name>.cfg` file and its rename/delete.
- `file-source.ts` — reads, hashes and classifies a canonical file (`readFileState`), folding it
  into profile fields.
- `core/config-parser.ts` / `core/import-reader.ts` — tokenizer/classifier for config text; the
  engine-faithful reader for picked files and installation exec chains.
- `import.ts` / `picked-files.ts` — the import handlers' logic and the session registry that maps
  opaque file ids to picker paths.
- `profiles.ts` / `assignments.ts` / `orphan-category.ts` — `ProfilesStore` (the only writer of
  `configProfiles`), the pure one-default-per-installation assignment rules, the
  unknown-category guard for `setActions`.
- `persisted.ts` / `persisted-migrations.ts` / `write-failures.ts` — the module's
  state.json sections and their forgiving parse, its migration steps, the failure-map merge.
  Its strict IPC request schemas live in shared at `src/shared/modules/config-schemas.ts`.
- `cleanup.ts` — redundant mod-folder copy scan, backed-up removal and restore.

**Shared** (`src/shared/config/`, pure — no node, no DOM, no electron)

- `syntax/` — the written vocabulary: tokenizing, key names, latin-1 charset, engine limits.
- `catalog/` — cvar and action facts: `cvar-catalog.ts`, `cvar-defaults.ts`, `action-catalog.ts`.
- `aliases/` — alias, bind, alt-layer, drop and switch-bind logic; `profile-schema.ts` declares
  the profile sub-shapes once (IPC schemas add caps, `persisted.ts` adds forgiveness by
  `.extend()`).
- `validation/` — the multi-engine validator.
- `profile/` — `profile-restore.ts` (lines to profile parts), `profile-restore-input.ts`,
  `profile-baseline.ts`, `profile-diff.ts`, `profile-files.ts` (`resolveProfileFileNames`),
  `tidy-up.ts` (`applyTidyUpOps`), `bind-adoption.ts`.
- `render/` — `render.ts` (`renderProfileFile`, `renderLoaderFile`), `file-ownership.ts`
  (`readOwnershipStamp`), `comment-labels.ts`.

`src/shared/config` is grouped by direction. Its groups are `syntax/` (the file format's written
vocabulary and tokenizing), `catalog/` (cvar and action facts), `aliases/` (alias, bind and layer
logic, profile schema), `validation/`, `profile/` (restore, diff, metadata, files) and `render/`
(profile to text). A file imports only from its own group or leftward:
`syntax → catalog → aliases/validation → profile → render`; `src/architecture.test.ts` enforces
it. `profile/profile-restore/` is a folder of named stages behind the one-line facade
`profile/profile-restore.ts`: `types.ts` (shared restore shapes), `comment-parse.ts` (one
`[q2l ...]` comment to a tag), `comment-scan.ts` (all comments to sections, version marker and
diagnostics), `categories.ts` (mint or adopt category ids), `cvar-sections.ts` (mint or adopt cvar
section ids), `entry-build.ts` (fold `_p<n>`/`_c<n>` chunks and build an action), `two-part.ts`
(merge the toggle trio and `+x`/`-x` pairs), `layers.ts` (rebuild layers and modifier overrides),
`entry-grouping.ts` (group alias/bind lines per entry), `entry-matching.ts` (match lines to their
tags) and `index.ts` (drives the stages).

**Renderer** (`src/renderer/src/modules/config/`)

- `ConfigView.tsx` + `components/ConfigListScreen.tsx`, `ConfigDetailHeader.tsx`,
  `ConfigTabStrip.tsx`, `ConfigTabContent.tsx` — layout, profile list, detail header, the tab strip
  (Overview, Settings, Controls, Aliases, Raw File, Care, Unsaved changes).
- `config-profiles-store.ts` (`useConfigProfiles`, the list) and `lib/ProfileDraftProvider.tsx`
  (the selected profile, its draft and the `save` sink); selection stays in `ConfigView` via route
  focus, and each open profile mounts under `key={selected.id}`.
- `client.ts` — the typed client, one function per handler.
- `OverviewKeyboardPanel.tsx`, `lib/keyboard-layout.ts`, `lib/test-mode.ts` — keyboard overview and
  test mode.
- `ControlsTab.tsx` with `ControlsCategoryRail.tsx`, `lib/useControlsRows.ts`,
  `lib/useControlsDrag.ts`, `lib/useControlsEntryActions.ts`, `ControlsEntryRow.tsx`, `ControlsGrid.tsx`,
  `lib/bind-conflicts.ts` — the Controls grid; tests share the harness in `test/`.
- `AliasesTab.tsx`, `LayersPanel.tsx` — aliases and alternate binding layers.
- `SettingsTab.tsx`, `CvarRow.tsx`, `lib/cvar-rows.ts`, `lib/cvar-sections.ts` — cvars grouped
  into the profile's cvar sections and sub-sections.
- `RawFileTab.tsx`, `components/ConfigCodeView.tsx`, `lib/raw-draft.tsx` — the canonical file's
  path/status line, toolbar and inline editor; the raw draft is a second, renderer-local source of
  "unsaved" next to the structured change set.
- `CareTab.tsx`, `CleanupPanel.tsx`, `lib/care-items.ts`, `lib/tidy-up-findings.ts` — file sync
  status, tidy-up findings, cleanup.
- `lib/useProfileSave.ts`, `lib/useProfileFileSync.ts`, `lib/useFileSourceRefresh.ts`,
  `lib/file-source-refresh.ts`, `ConfigConflictDialog.tsx` — save, re-read and conflict resolution.
- `ImportProfileDialog.tsx`, `InstallationProfilesPanel.tsx`, `ProfileAssignmentsPanel.tsx` —
  import and assignment surfaces.

## Flow

**Parse.** Config text is read as latin-1 and tokenized by `core/config-parser.ts`
(`parseConfigText`) into cvar, bind, alias, exec and comment lines; Quake II's own rules apply
(no in-quote escaping, line-based). Anything not understood is kept verbatim as an unrecognized
line, never dropped.

**Fold.** The parsed lines collapse to the state the engine would end up in. For a canonical file,
`file-source.ts` folds last-wins per cvar, key and alias name; an alias defined twice loses its
earlier definition and is reported as an `entry-alias-duplicate` warning. For an import,
`core/import-reader.ts` follows the files in engine order, resolving `exec` chains and recording
binds that silently replace an earlier bind of the same key.

**Restore.** `@shared/config/profile/profile-restore.ts` (`restoreProfileParts`) rebuilds entries,
categories, cvar sections and layers from the folded lines and the `[q2l ...]` comment tags,
degrading with warnings on a hand-edited or tag-stripped file. `profile-restore-input.ts` turns the
result into profile fields; `rebuild.ts` recovers the name, `unbindall` setting and section-header
style from the file.

**Store.** `ProfilesStore` (`profiles.ts`) is the only writer of the `configProfiles` state.json
section. Every commit runs bind adoption. Entry points are distinct on purpose: `create`,
`createFromImport` (mints a new id), `addRebuilt` (keeps the file's ownership id), `adoptFromFile`
(overlays an external edit), the content setters (mark the profile `dirty`) and `markFileSeen`
(records `fileHash`, `fileState` and the last-saved `baseline`). Played mods, switch binds, write
failures and the migration guard are their own sections (`persisted.ts`).

**Render.** `@shared/config/render/render.ts` turns a profile into its file: `renderProfileFile`
(header block with the ownership tag, cvar sections, aliases, binds, layers) and `renderLoaderFile`
(the installation's `autoexec.cfg`, which execs the default profile and carries the optional
profile-switch alias chain). `resolveProfileFileNames` assigns every profile a unique `<name>.cfg`
across the whole list.

**Sync.** `sync.ts#syncProfile` writes one profile's canonical file under userData and, for every
installation it is assigned to, every profile assigned there into `<root>/baseq2/` plus the loader
`autoexec.cfg`, copied into each played mod folder (`FS_ExecAutoexec` ignores the search path).
Installation copies mirror the canonical file's bytes, never a fresh render
(`installationCopySource`). Profiles displaced by a name change are moved first; stale owned files
are removed by `reconcileOwnedProfileFiles`. Failures land in `configWriteFailures` and are
reported as `failed` rows with Retry, never as a failed IPC response.

## Handlers

Write rule: **none** touches neither; **writes the profile store** changes the module's state.json
sections; **writes engine cfg files** writes the canonical `.cfg` and/or installation copies;
**both** does both. Write-failure and `fileHash` bookkeeping recorded by every sync run is not
counted as a store write.

| Handler                   | What it does                                                                                                   | Write rule               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `list`                    | All profiles, assignments filtered to live installations.                                                      | none                     |
| `create`                  | New profile (empty, template or copy); writes its canonical file at once (`syncAppended`).                     | both                     |
| `rename`                  | Renames and marks dirty; the file keeps its old name until `save`.                                             | writes the profile store |
| `remove`                  | Removes the profile and deletes its canonical file (`cleanupRemoved`); installation copies are left.           | both                     |
| `assign`                  | Assigns to an installation, then syncs the profile.                                                            | both                     |
| `unassign`                | Unassigns, syncs the profile and the installation's remaining default.                                         | both                     |
| `setDefault`              | Makes the profile the installation's default; syncs every profile there plus the loader.                       | both                     |
| `setCvars`                | Replaces cvars, marks dirty.                                                                                   | writes the profile store |
| `commitCvars`             | Writes chosen cvars into the canonical file from the baseline, leaving other pending edits unsaved; cascades.  | both                     |
| `setBinds`                | Replaces binds, marks dirty.                                                                                   | writes the profile store |
| `setLayers`               | Replaces layers, marks dirty.                                                                                  | writes the profile store |
| `setActions`              | Replaces actions and categories, marks dirty; refuses an orphan category.                                      | writes the profile store |
| `write`                   | Retry / "Sync now": re-runs the sync, optionally for one installation.                                         | writes engine cfg files  |
| `save`                    | The explicit save: re-reads the canonical file, refuses on conflict unless forced, writes, verifies, cascades. | both                     |
| `saveRawText`             | Writes the Raw File tab's text verbatim, re-reads and adopts it, cascades without re-rendering the file.       | both                     |
| `refreshFromFiles`        | Re-reads canonical files; adopts an external edit and cascades it, or reports conflict/missing/unparseable.    | both                     |
| `preview`                 | The files a write to one installation would produce, with on-disk existence.                                   | none                     |
| `writeState`              | Always `{}`: nothing is ever pending.                                                                          | none                     |
| `syncState`               | Read-only status of the canonical file and every installation copy.                                            | none                     |
| `rawFiles`                | Read-only canonical file and per-assignment copies for the Raw File tab.                                       | none                     |
| `openFile`                | Opens or reveals one of the profile's files; ids only, path resolved and ownership-checked in main.            | none                     |
| `setPlayedMods`           | Sets which mod folders get the loader copy, validated against `installation.gameDirs`.                         | writes the profile store |
| `switchBinds`             | Per-installation profile-switch keys.                                                                          | none                     |
| `setSwitchBind`           | Sets the switch key and rewrites that installation's default profile and loader directly.                      | both                     |
| `setWriteUnbindall`       | Toggles the `unbindall` line, marks dirty.                                                                     | writes the profile store |
| `setWriteCatalogDefaults` | Toggles writing unplaced catalogue cvars into the `Defaults` section, marks dirty.                             | writes the profile store |
| `setSectionHeaderStyle`   | Sets the section-banner style, marks dirty.                                                                    | writes the profile store |
| `discard`                 | Restores the last-saved baseline; `noBaseline` when there is none.                                             | writes the profile store |
| `importPickFiles`         | `import.pickFiles`: OS picker; registers picked paths in the session registry, returns opaque ids.             | none                     |
| `importPreviewFiles`      | `import.previewFiles`: what the picked files contain.                                                          | none                     |
| `importCommitFiles`       | `import.commitFiles`: new profile from the picked files (new id), canonical file written at once.              | both                     |
| `cleanupScan`             | `cleanup.scan`: redundant mod-folder copies.                                                                   | none                     |
| `cleanupApply`            | `cleanup.apply`: backs up and deletes them; refused while the installation runs.                               | writes engine cfg files  |
| `cleanupRestore`          | `cleanup.restore`: restores removed copies from backup; refused while the installation runs.                   | writes engine cfg files  |
| `tidyUpApply`             | `tidyUp.apply`: one atomic tidy-up batch, one commit and one sync; the file only when authorised.              | both                     |

The central write rule lives in `profile-writes.ts#syncAndPersist` (`canonicalWriteAllowed`): a
`dirty` profile's canonical file is written by nothing but `save` (and `commitCvars`, which writes
baseline plus cvars itself), and a canonical file is only overwritten when it is absent, the
profile has no `fileHash` baseline yet, it already holds exactly `renderProfileFile(profile)`, or
the user forced the overwrite. A refused write records no failure; the row reports `outOfSync`.

## Startup

`configModule.setup()` runs, in order:

1. Builds `ProfilesStore` over app state and the write service (`createProfileWrites`).
2. `profiles.reconcile(...)` drops assignments to installations that vanished while the launcher
   was closed.
3. Registers every handler; the import trio shares one `PickedFilesRegistry` for the session.
4. Awaits `runConfigStartup` (`startup.ts`), so the first `list` already sees rebuilt profiles:
   1. `runFileSourceStartup` (`rebuild.ts`): the one-time format migration — skipped once
      `configFileSourceMigratedAt` is set; otherwise every profile's canonical file is rewritten in
      the current format and its `fileHash` seeded, and the write-once guard is set only when all
      succeeded — then rebuild-on-missing-record for every owned `.cfg` with no record, keeping the
      file's id. A failure of the whole step is logged and the module runs on cached state.
   2. The retry sweep: every profile id in `configWriteFailures` is synced once via
      `syncAndPersist`, sequentially, under the same write rule as any other trigger.
5. Logs `config module ready`.

## Binding decisions

- **Profiles are central**, not `Installation.moduleData`: many-to-many assignment, at most one
  default per installation (`assignments.ts`). The loader execs the default at launch.
- **The `.cfg` is the source of truth; state.json is a rebuildable cache** (story 043). A file's
  ownership id is the profile's identity: rebuild keeps it, import of a foreign file mints a new
  one. A `.cfg` without a recognised ownership stamp is never adopted.
- **Explicit save** (story 043, inverting story 022's write-on-every-mutation). Content setters
  persist to state.json at once and mark the profile `dirty`; only `save` writes the content.
  `assign`/`unassign`/`setDefault`/`write`/`create`/`tidyUp.apply`/the retry sweep still sync
  immediately under the central rule.
- **Never overwrite bytes nobody has read** (story 043). `save` and `saveRawText` re-read the file
  by ownership id before writing; every other path is guarded by `canonicalWriteAllowed`. A raw
  save's hand-typed bytes are never re-rendered (story 057/079), but may still be moved to a new
  resolved name (`canonicalMoveAllowed`).
- **Copies come from the file**, never from a render of the cache (`installationCopySource`), so
  writer and readers (`syncState`, `rawFiles`) judge a copy against the same bytes.
- **A running game defers nothing** (story 079, reversing story 004): the engine reads a config
  only at `exec` time. `pending` is gone from state and contract; `cleanup.apply`/`restore`, which
  delete files, still refuse a running installation.
- **Writes stay inside the installation**: `baseq2` and mod folders listed in
  `installation.gameDirs`; a user's own file is backed up once, forever, before first overwrite;
  writes are diff-skipped and atomic. Latin-1 throughout, byte-for-byte.
- **Renderer paths are never trusted**: `openFile` takes ids only and checks ownership before the
  OS is touched; import addresses picked files by opaque ids from `picked-files.ts`.
- **Engines in scope**: r1q2, Q2PRO and vanilla `quake2.exe` 3.20 only — the cvar facts, limits and
  validator findings are source-cited for these; the validator checks every engine reached through
  the profile's assignments with equal weight.
- **Profile switching is session-only**: the switch key cycles assigned profiles in-game and echoes
  the name; the next launch loads the default again.

## Known limitations

- An entry with **no key** whose command is exactly its catalogue default has no representation in
  the rendered file, so adopting or rebuilding from a file cannot bring it back. Behaviour in the
  engine is unaffected; pinned in `file-source-pipeline.test.ts`.
- `remove` does not delete installation copies of the removed profile; they are cleaned by
  `reconcileOwnedProfileFiles` when that installation is next synced. `unassign` leaves the copy
  when nothing else is assigned to that installation.
- `commitCvars` renders `writeCatalogDefaults` from the live record, because the baseline does not
  snapshot it (`profile-baseline.ts`); a pending toggle of it lands on disk with the commit.
- `setSwitchBind` writes the default profile through `writeInstallationFiles` directly, outside
  `syncAndPersist`, rendering the live record — a `dirty` default's unsaved edits reach that
  installation's copy, and the external-edit guard does not apply.
- A rename cycle (two profiles trading names) cannot be ordered; the first move is attempted and a
  refusal is recorded in `configWriteFailures` for retry.
- `writeState` and `write`'s `written`/`error` result shape survive only for the contract;
  `syncState` is the accurate status.
- No direct numbered profile selection: it conflicts with the default `1`–`9` weapon binds.
