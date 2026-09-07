---
id: 066
title: A new profile starts empty, from a handed template, or from my own config files
status: ready
created: 2026-09-07
---

## Requirement

Creating a profile is the first thing a user does in the config module, and the "Start from"
choice it offers today does not match what people actually arrive with
([CreateProfileDialog.tsx:88-99](../../src/renderer/src/modules/config/CreateProfileDialog.tsx#L88-L99)).
Three choices should be on offer, and two of them need work:

**Empty** — correct as it is, nothing to change.

**Template** — today there is one nameless "standard template"
([config.ts:498-605](../../src/shared/modules/config.ts#L498-L605)). There should be two: one for
right-handers and one for left-handers, because handedness is the one decision that changes a
whole keyboard layout rather than a single bind. The two layouts themselves come later; this story
is about the choice existing and being carried into the created profile.

**Import** — today import is addressed by `{ installationId, gameDir }` and reads exactly the
engine's own entry files, `config.cfg` and `autoexec.cfg`, plus whatever they `exec`
([import-reader.ts:10-22](../../src/main/modules/config/core/import-reader.ts#L10-L22)). That
misses the normal case: a player's config lives in files the engine only loads on demand. The
three real fixture configs are exactly that shape —
[docs/fixtures/dm.cfg](../fixtures/dm.cfg) (100 binds, 93 `set` lines),
[docs/fixtures/dmalias.cfg](../fixtures/dmalias.cfg) (96 aliases) and
[docs/fixtures/gfx.cfg](../fixtures/gfx.cfg) (46 `set` lines) — and nothing links them by `exec`
except one bind, `bind RIGHTARROW "exec dmalias.cfg"`
([dm.cfg:133](../fixtures/dm.cfg#L133)). Point today's importer at that installation and 96 of
those aliases never get read.

So: the user picks N config files themselves, from anywhere on disk, and the launcher reads and
analyses all of them into one profile with every function intact. `docs/fixtures/{dm,dmalias,gfx}.cfg`
is the reference case — the author's own config — and the existing fixture-corpus test
([import-fixtures.test.ts:17-29](../../src/main/modules/config/core/import-fixtures.test.ts#L17-L29))
already pins what the parser gets out of those files when it does see them.

Two existing constraints stay in force: paths from the renderer are never trusted (CLAUDE.md), so
the picked paths have to be owned by main the way `installations:pickFolder` already owns its
result ([installations.ts:68-88](../../src/main/ipc/installations.ts#L68-L88)); and nothing is
written before Create, with commit re-reading from disk instead of trusting a previewed result
(story 005 decisions 3 + 14).

## Acceptance Criteria

- [ ] **AC1** — The create dialog's "Start from" offers four options: Empty, Template
      (right-handed), Template (left-handed), Import from files.
- [ ] **AC2** — Empty produces exactly the profile it produces today; no behaviour change.
- [ ] **AC3** — Both template options create a profile and the created profile records which
      handedness it was seeded from, so the later layout story fills in content rather than
      re-touching the picker. Until that content exists the dialog does not pretend the two differ.
- [ ] **AC4** — Import from files opens a native multi-select file picker filtered to `.cfg`, and
      the picked files are listed in the dialog. The renderer never sends a path it composed
      itself — main owns the picked paths from picker to commit.
- [ ] **AC5** — The listed order is the load order: files are folded left to right, a later
      assignment wins over an earlier one, and the user can remove a file or change its position
      before importing.
- [ ] **AC6** — The picked files are analysed by the same reader/parser the installation import
      uses: cvars, binds, aliases (plain, press/release, message), categories and sub-categories,
      cvar sections, layers and preserved lines all come out as they do today.
- [ ] **AC7** — Reference case: importing `docs/fixtures/dm.cfg`, `dmalias.cfg` and `gfx.cfg`
      yields one profile containing every bind and every alias the fixture-corpus test already
      pins for those files, plus the last-set value of every cvar assignment across all three, with
      `bind RIGHTARROW "exec dmalias.cfg"` preserved as a working entry. Anything that could not
      become a structured entry is named in the import review step, not silently dropped.
- [ ] **AC8** — An `exec` inside a picked file resolves relative to that file's own folder and
      cannot escape it; an unresolvable or refused `exec` is kept as a preserved line with a
      warning and never aborts the import — the guarantee today's reader already gives.
- [ ] **AC9** — Importing from files needs no installation: the flow completes with no installation
      selected, and on a launcher with no installation registered at all.
- [ ] **AC10** — Nothing is written until Create is pressed, and the commit re-reads the picked
      files from disk rather than trusting anything the preview returned.
- [ ] **AC11** — No image assets; the file list and its controls are CSS/inline SVG per the repo
      rule.

## Open Questions

All resolved 2026-09-07:

- [x] **Both template options ship now.** `ConfigProfileSeed` becomes
      `'empty' | 'template-right' | 'template-left'`, both seeded identically from today's
      `STANDARD_TEMPLATE`, and the profile records `seedFrom`. The later layout story fills in
      content instead of re-touching picker + contract + seed field.
- [x] **File import replaces the installation/gamedir import.** `import.scan` and the
      `{ installationId, gameDir }` addressing disappear from the contract and the dialog. The
      picker opens with `defaultPath` on the selected (or last) installation's `baseq2`, so the
      "just read my baseq2" case costs two clicks instead of one, and there is only one contract
      path and one test surface. `readImportableConfig()` itself stays — `file-source.ts` uses it.
- [x] **Read once, then standalone** (story 022). No source paths are persisted, no re-import
      surface, no stale paths in state.json.
- [x] **The native picker gets a harness-only stub.** Playwright cannot drive an OS dialog at all
      ([UI-VERIFICATION.md:701-706](../UI-VERIFICATION.md#L701-L706)), so a `DialogService` in main
      returns fixture paths when `Q2L_UI_HARNESS=1` **and** `isDev` — the precedent is
      `dev:simulateJob`'s `app.isDev` gate ([index.ts:120](../../src/main/ipc/index.ts#L120)).
      Everything after the paths arrive (list, reorder, remove, preview, create) is covered through
      the real surface; only "the OS dialog appears and is multi-select" stays manual residue.

## Plan

The reader already separates cleanly: `processFile()`
([import-reader.ts:511](../../src/main/modules/config/core/import-reader.ts#L511)) only wants a
resolved absolute path, and the entry-file loop
([:603-607](../../src/main/modules/config/core/import-reader.ts#L603-L607)) is the only thing that
knows about installations. Everything downstream of the reader — `toRestoreInput`,
`restoreProfileParts`, `ProfilesStore.createFromImport`
([profiles.ts:123](../../src/main/modules/config/profiles.ts#L123)) — is already a pure function of
the parsed result. So the work is: a second reader entry point, a picker main owns, an id-based
contract, and a new dialog step.

1. **Reader** — add `readImportableFiles(paths)` next to `readImportableConfig()`, sharing
   `processFile` / `documentOrder` / `applyBind` / `applyAlias`. `exec` resolution becomes a
   per-file strategy on `ReaderContext` (installation mode keeps gameDir → baseq2; file mode
   confines to `dirname(file)` with no fallback), so `resolveRelaxed`'s "cannot escape the root"
   guarantee carries over unchanged. Last-wins already falls out of document order.
2. **Picker ownership** — modules cannot touch `dialog` / `BrowserWindow`
   ([types.ts:41-44](../../src/main/modules/types.ts#L41-L44)) and get no invoke event, so a new
   `DialogService` on `AppContext` owns `showOpenDialog` plus the harness stub. The config module
   asks it, registers the returned absolute paths in a session map, and hands the renderer opaque
   `{ id, fileName, dirName }` handles. The renderer only ever sends ids and their order — it can
   neither compose nor observe an absolute path.
3. **Contract** — `import.scan` out; `import.pickFiles`, `import.previewFiles`,
   `import.commitFiles` in, keyed by `fileIds: string[]`. `ConfigProfileSeed` grows the two
   handedness values, `ConfigProfile` an optional `seedFrom`.
4. **Commit re-reads** — `commitImportFiles` resolves ids → paths and calls the reader again; the
   preview result is never trusted (story 005 decisions 3 + 14).
5. **Renderer** — `CreateProfileDialog`'s "Start from" gets four entries; `ImportProfileDialog`
   swaps its installation/gamedir selects for a pick button plus an ordered file list with
   move-up / move-down / remove, then preview → review → name → create.
6. **e2e** — the harness seeds three fixture `.cfg` files, sets the stub env, and a flow plus new
   `SCREENS` entries walk the whole flow. `config-import-installation` and `config-import-gamedir`
   are replaced by `config-import-files`.

Order: 1 → 2 → 3 → 4 → 5 → 6. D1/D2 and D4 are independent of each other and can run in parallel.

## Deliverables

**D1 — `readImportableFiles(paths)` in the reader.**
Files: `src/main/modules/config/core/import-reader.ts`, `core/import-reader.test.ts`.
Turn `resolveExecTarget` into a strategy carried on `ReaderContext` and add the file-list entry
point; `readImportableConfig()` keeps its exact behaviour (`file-source.ts` depends on it).
Accepted when: N paths fold into one `ImportResult` in list order with last-wins per
cvar/bind/alias, `exec` inside a picked file resolves only under that file's own folder, a missing
or escaping `exec` becomes a preserved line + warning without aborting, and every existing
`import-reader.test.ts` case still passes.

**D2 — the fixture reference case.**
Files: `src/main/modules/config/core/import-fixtures.test.ts`.
Mirror the existing `buildFixtureGamedir()` block
([:53-101](../../src/main/modules/config/core/import-fixtures.test.ts#L53-L101)) with a file-list
variant that reads `docs/fixtures/{dm,dmalias,gfx}.cfg` straight from the repo, no fake
installation root. Accepted when: the result carries every bind and alias the existing corpus test
pins for those three files, the last-set value of every cvar assignment across all three, and
`bind RIGHTARROW "exec dmalias.cfg"` as a working entry; anything unstructured lands in the review
step's preserved lines rather than being dropped.

**D3 — contract + schemas.**
Files: `src/shared/modules/config.ts`, `src/main/modules/config/schemas.ts`,
`src/main/lib/schemas.ts`, `src/main/modules/config/schemas.test.ts`.
`ConfigProfileSeed = 'empty' | 'template-right' | 'template-left'`; `ConfigProfile.seedFrom?`;
`PickedConfigFile { id; fileName; dirName }`; `ImportFilesPreviewInput` / `ImportFilesCommitInput`
keyed by `fileIds`; `import.scan` and the `{ installationId, gameDir }` import types removed.
`configProfileObjectSchema` ([schemas.ts:446-531](../../src/main/lib/schemas.ts#L446-L531)) gets
`seedFrom` as `.optional().catch(undefined)`. Accepted when: `npm run typecheck` is green and
`schemas.test.ts` rejects a `fileIds` payload that is empty, over the cap, or not a string array.

**D4 — `DialogService` + harness stub.**
Files: `src/main/services/dialog.ts` (new), `src/main/services/dialog.test.ts` (new),
`src/main/context.ts`, `src/main/index.ts`.
Mirror `showOpenDialog` in [installations.ts:93-104](../../src/main/ipc/installations.ts#L93-L104),
but resolve the window from the registered main window instead of an invoke event.
`pickConfigFiles({ defaultPath })` uses `properties: ['openFile', 'multiSelections']` with a `.cfg`
filter and returns canonicalised absolute paths. When `Q2L_UI_HARNESS === '1' && isDev`, it returns
the paths from `Q2L_UI_PICK_FILES` instead of opening anything. Accepted when: the unit test proves
the real branch passes multi-select + the `.cfg` filter, cancel yields an empty list, and the stub
is unreachable with either gate off.

**D5 — picked-file registry + the three import handlers.**
Files: `src/main/modules/config/picked-files.ts` (new), `import.ts`, `index.ts`, `import.test.ts`.
Session map of opaque id → absolute path; `pickFiles` fills it, `previewFiles` / `commitFiles`
resolve ids in the order given and reject an unknown id. `scanImportCandidates` and the
installation/gamedir guards go. `commitFiles` calls the reader again and passes the result to
`ProfilesStore.createFromImport` unchanged. Accepted when: preview and commit work with no
installation selected and on an empty installation list, commit re-reads from disk (test: change a
file between preview and commit and see the commit reflect it), an unknown or renderer-invented id
fails without touching the filesystem, and nothing is written before commit.

**D6 — `CreateProfileDialog`: four "Start from" options.**
Files: `src/renderer/src/modules/config/CreateProfileDialog.tsx`, `client.ts`,
`src/renderer/src/i18n/locales/en/*`, `src/main/modules/config/profiles.ts`, plus a new
`src/renderer/src/modules/config/CreateProfileDialog.test.tsx` and cases in
`src/main/modules/config/profiles.test.ts`.
Mirror the existing `<Select>` at
[:91-102](../../src/renderer/src/modules/config/CreateProfileDialog.tsx#L91-L102). Empty and the
two template entries submit `createConfigProfile({ name, from })`; Import calls `onWantImport()` as
today. `ProfilesStore.create` records `seedFrom` and seeds both template values from
`STANDARD_TEMPLATE`. A short note states that the two handedness layouts are identical for now.
Accepted when: the four options render, each template option sends its own seed value and the
created profile carries the matching `seedFrom`, and Empty produces exactly today's profile.

**D7 — `ImportProfileDialog`: the ordered file list.**
Files: `src/renderer/src/modules/config/ImportProfileDialog.tsx`, `client.ts`,
`src/renderer/src/i18n/locales/en/*`, plus `ImportProfileDialog.files.test.tsx` (new).
Replace the installation and gamedir selects with a "Choose files" button and a list showing
`fileName` + `dirName` per row, with move-up / move-down / remove per row (dense `IconButton`s per
the CLAUDE.md deviation table, CSS / inline SVG only, no image assets). The preview re-runs on
every order change. Review, name and create steps stay as they are. Accepted when: the list order
is the load order, removing and reordering re-triggers the preview, and the component never holds
an absolute path.

**D8 — e2e coverage of the flow.**
Files: `scripts/lib/fixture.mjs`, `scripts/lib/harness.mjs`, `scripts/lib/screens.mjs`,
`scripts/flows/import-from-files.mjs` (new).
Seed copies of `docs/fixtures/{dm,dmalias,gfx}.cfg` into the fixture dir, export
`Q2L_UI_PICK_FILES` from `childEnv()`, replace the `config-import-installation` /
`config-import-gamedir` `SCREENS` entries with `config-import-files`, and add a flow that walks
new profile → Import from files → pick → reorder → remove → create, plus the two template options.
Accepted when `npm run ui:verify` is green including the a11y report for the new screen, and the
flow ends on a created profile carrying the fixture's binds and aliases.

## Model Hints

- `D1 → deliverable-hard` — the reader is shared with `file-source.ts`, so turning `exec`
  resolution into a per-file strategy risks a silent regression in the live-file pipeline that no
  import test would catch.
- `D5 → deliverable-hard` — this is the path-trust boundary: an id → path registry, a commit that
  must re-read from disk rather than trust the preview, and the removal of the installation guards
  that used to confine every path.
- D2, D3, D4, D6, D7, D8 → default.
- `Review: → story-review-hard` — the story introduces a new renderer → main path-trust seam and
  an env-gated test hook in the main process; both are exactly the kind of thing that looks fine
  in a diff and is wrong in production.

## Acceptance Tests

- AC1 → e2e `scripts/flows/import-from-files.mjs` › "the Start from select offers four options"
  (D8), plus unit `src/renderer/src/modules/config/CreateProfileDialog.test.tsx` › "four
  start-from options render" (D6)
- AC2 → unit `src/main/modules/config/profiles.test.ts` › "an empty seed produces the profile it
  produces today" (D6)
- AC3 → unit `src/main/modules/config/profiles.test.ts` › "a template seed records its handedness
  in seedFrom" (D6); e2e `scripts/flows/import-from-files.mjs` › "both template options create a
  profile" (D8)
- AC4 → e2e `SCREENS` entry `config-import-files` + `scripts/flows/import-from-files.mjs` ›
  "picking files lists them in the dialog" (D8); unit `src/main/services/dialog.test.ts` › "the
  config-file picker is multi-select and filtered to .cfg" (D4); unit
  `src/main/modules/config/import.test.ts` › "an id the renderer invented is refused" (D5).
  **manual residue:** that the window the OS puts on screen is a real native multi-select file
  dialog — Playwright cannot drive an OS-native dialog at all
  ([UI-VERIFICATION.md:701-706](../UI-VERIFICATION.md#L701-L706)); the stub covers everything from
  the resolved paths onward.
- AC5 → e2e `scripts/flows/import-from-files.mjs` › "reordering and removing a file changes the
  load order" (D8); unit `src/main/modules/config/core/import-reader.test.ts` › "a later
  assignment wins over an earlier one" (D1)
- AC6 → unit `src/main/modules/config/core/import-reader.test.ts` › "a file list yields the same
  structures as an installation read" (D1)
- AC7 → unit `src/main/modules/config/core/import-fixtures.test.ts` › "dm, dmalias and gfx import
  as one profile with every bind and alias" (D2)
- AC8 → unit `src/main/modules/config/core/import-reader.test.ts` › "exec resolves inside the
  file's own folder and cannot escape it" and › "an unresolvable exec is preserved with a warning"
  (D1)
- AC9 → unit `src/main/modules/config/import.test.ts` › "import from files needs no installation"
  (D5); e2e `scripts/flows/import-from-files.mjs` runs against the `empty` fixture variant, which
  has no installation registered (D8)
- AC10 → unit `src/main/modules/config/import.test.ts` › "commit re-reads the picked files from
  disk" (D5) and › "preview writes nothing" (D5)
- AC11 → e2e `npm run ui:verify` a11y + screenshot for `config-import-files` (D8); the clean-agent
  review checks that no image asset was added (D7)

### Coverage gate

| AC | Deliverable | Test |
| --- | --- | --- |
| AC1 | D6, D8 | e2e flow + CreateProfileDialog unit |
| AC2 | D3, D6 | profiles unit |
| AC3 | D3, D6, D8 | profiles unit + e2e flow |
| AC4 | D4, D5, D7, D8 | dialog unit + import unit + e2e screen (residue: the OS dialog itself) |
| AC5 | D1, D7, D8 | reader unit + e2e flow |
| AC6 | D1 | reader unit |
| AC7 | D2 | fixture corpus unit |
| AC8 | D1 | reader unit |
| AC9 | D5, D8 | import unit + e2e flow on the `empty` variant |
| AC10 | D5 | import unit |
| AC11 | D7, D8 | e2e a11y / screenshot |

## Done
