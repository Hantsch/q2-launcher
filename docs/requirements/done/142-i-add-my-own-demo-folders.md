---
id: 142
title: I add my own demo folders
status: done # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

Not every demo sits inside an installation: some come as a download from a community site, some
live in an archive folder the user keeps. The user adds such folders in the demos settings, and
their demos appear in the same list, labelled with the folder (concept
`docs/concepts/demo-browser.md` §2, DEMO-1).

A new extra folder is one of the only two renderer-supplied paths in this module (§14): it comes from
a native folder dialog, is schema-validated and canonicalized in main. This story also introduces the
module's own `state.json` key — the `home`/`servers` precedent ([[110]]) — which later holds user
templates ([[140]]) and the remembered sort ([[152]]).

## Acceptance Criteria

- [x] **AC1** — In the demos settings section the user adds a folder through the native folder
      dialog, sees it in a list and can remove it; the list persists across restarts.
- [x] **AC2** — Demos in an extra folder appear in the list with the source "extra folder: `<path>`",
      with the same formats and exclusions as [[141]].
- [x] **AC3** — The folder path is validated by a zod schema and canonicalized in main; a
      non-absolute path, a file, or a path main cannot resolve is rejected with its reason.
- [x] **AC4** — Adding a folder that is already listed, or that is an installation's `demos/`
      folder, does not produce duplicate demos.
- [x] **AC5** — Removing a folder removes its demos from the list; nothing on disk is touched.
- [x] **AC6** — The module's settings live under a module-owned `state.json` key with its own zod
      schema; an invalid stored value falls back to defaults without breaking the app.

## Open Questions

- [x] ~~**Q1 — Recursion** — a downloads folder can be deep: scan subfolders, and if so, how deep?
      (Same question as [[141]] Q1, possibly a different answer.)~~ answered → Decisions
      (Sprint)
- [x] ~~**Q2 — Overlaps** — a folder that is a parent of an installation: scanned as extra folder,
      or skipped for the installation part?~~ resolved by Q1's answer, see Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Recursion: same answer as [[141]] Q1 — top-level of the extra folder only, no
  subfolder recursion. This also resolves Q2: since scanning never recurses, an extra folder
  that happens to be an ancestor of an installation's root never reaches that installation's
  `demos/` folder, so no separate overlap rule is needed beyond AC4's exact-path dedup.
- **The folder comes from the existing `installations:pickFolder` channel; the renderer then sends
  the picked path to a new `extraFolders.add` module handler** — a `MainModule` never touches
  `BrowserWindow` (ARCHITECTURE "Adding a module" step 3), so it cannot parent a dialog itself, and
  that channel already carries the `Q2L_UI_PICK_FOLDER` harness stub every folder-picking flow
  relies on; no new IPC channel.
- **`extraFolders.add` is the one entry in `REPLAYS_PATH_PAYLOAD_HANDLERS`** — story 135's no-path
  guard names exactly this handler as the only permitted exception (concept §14).
- **Remove and list address a folder by a main-generated `id`, never by path** — keeps every other
  handler inside 135's no-path guard.
- **Validation order in main: `isAbsolute` → `canonicalizePath` (realpath) + `stat` → is-directory →
  already listed**, each failure a distinct i18n reason key (`notAbsolute`, `unresolvable`,
  `notAFolder`, `alreadyListed`) — AC3 wants "rejected with its reason", and a zod failure at the
  seam would only surface the generic `ipc.error.invalidPayload`, so the zod schema
  (`absolutePathSchema`: non-empty, NUL-free) guards shape and main gives the reason.
- **"Already listed" compares `pathKey(canonicalized)`** (`src/main/lib/fs-utils.ts`) — the same
  "is this the same folder?" key installations use, so `C:\Demos`, `c:\demos\` and a junction to it
  collapse.
- **An installation's `demos/` folder may be added; the dedup happens at scan time, not at add
  time** — an installation can be registered _after_ the extra folder was added, so an add-time
  check alone cannot satisfy AC4; at scan, an extra folder whose canonical `pathKey` equals a
  scanned installation `demos/` folder is skipped and its demos keep the installation source label
  (the richer one: installation + game dir).
- **A listed folder that is missing at scan time contributes no demos and stays listed** — a
  removable or network drive can come back; the per-source error state is DEMO-19's story (S27).
- **The state key is `replays` with envelope `{ extraFolders: ReplaysExtraFolder[] }`, entry `{ id,
path, addedAt }`**, getter/setter `replaysState()` / `setReplaysState()`, parse
  `parseReplaysState` — the story-110 `servers` precedent verbatim (module-named key, no schema
  bump, envelope fallback + row-level drop + first-wins dedupe by `pathKey`). If story 140 (built
  earlier in this sprint) already introduced the `replays` key, `extraFolders` is added to that
  envelope instead of creating a second key.
- **Stored rows are re-validated on parse only for shape (absolute, NUL-free string), not against
  the disk** — parse is synchronous and a missing drive must not delete the user's list.
- **The source label is the i18n key `replays.source.extraFolder` with `{{path}}` → "extra folder:
  `<path>`"** — AC2's literal text, and main sends keys + data, never prose, across IPC.
- **The settings list mirrors `ServersSettingsSection`'s master-source list: every mutation
  replaces the list from main's returned result, no optimistic state** — the renderer and
  `state.json` can never disagree.
- **CHANGELOG** — adding demo folders is user-facing: one line under `## Unreleased → ### Added`.

## Plan

Five Ds, bottom-up: state → handlers → scan → settings UI → list label + e2e. No new IPC channel,
no shell file, no platform branch (folder dialog and paths behave the same on Windows and Linux).

1. [x] **D1 State key** — `ReplaysState`/`ReplaysExtraFolder` + zod schema + `DEFAULT_REPLAYS_STATE`
       in `src/shared/modules/replays.ts`; `parseReplaysState` in `src/main/lib/schemas.ts`;
       `replays` on `LauncherStateDocument` with getter/setter in `src/main/services/state.ts`.
2. [x] **D2 Handlers** — `extraFolders.list` / `.add` / `.remove` in the contract and the main half;
       validation in a new `src/main/modules/replays/extra-folders.ts`.
3. [x] **D3 Scan** — 141's discovery gets extra-folder sources (top level only, same per-folder scan
       function, formats and exclusions), dedup against installation `demos/` folders.
4. [x] **D4 Settings UI** — `ReplaysSettingsSection` lists folders, adds via picker, removes, shows the
       rejection reason; i18n; CHANGELOG; 135's shell flow's last assertion updated.
5. [x] **D5 List label + e2e** — "extra folder: `<path>`" in the list row's source; fixture folder;
       flow `replays-extra-folders`.

Order: D1 → D2 → D3 → D4 → D5 (D5's flow needs D3's scan and D4's section).

## Deliverables

- **D1 — the module-owned `replays` state key.** Files: `src/shared/modules/replays.ts` (extend;
  mirror the `ServersState`/`serversStateSchema`/`DEFAULT_SERVERS_STATE` block in
  `src/shared/modules/servers.ts`), `src/shared/modules/replays.test.ts` (extend),
  `src/main/lib/schemas.ts` (add `parseReplaysState`; mirror `parseServersState`),
  `src/main/lib/schemas.test.ts` (extend), `src/main/services/state.ts` (field, `defaults()`, parse
  callback, `replaysState()`/`setReplaysState()`; mirror the `servers`/`serversState()` quartet),
  `src/main/services/state.test.ts` (extend). Shape: `ReplaysState = { extraFolders:
ReplaysExtraFolder[] }`, `ReplaysExtraFolder = { id: string; path: string; addedAt: string (ISO)
}`, `DEFAULT_REPLAYS_STATE = { extraFolders: [] }`. Parse: envelope failure → fresh clone of the
  default; per-row parse, a row whose `path` is not an absolute NUL-free string is dropped; rows
  deduped first-wins by `pathKey(path)` (`src/main/lib/fs-utils.ts`); no disk access. No
  `STATE_SCHEMA_VERSION` bump, no migration, no `LauncherSettings` field. **If `replays` already
  exists on `LauncherStateDocument`** (story 140 builds first and may have created it), add
  `extraFolders` to that envelope, its default and its parse instead of a second key, and extend its
  existing tests. Tests: `schemas.test.ts` › "a foreign replays value falls back to the default
  replays state" and › "a malformed extra folder row is dropped, its siblings survive";
  `state.test.ts` › "replays state round-trips through state.json and touches no other key" and ›
  "a state.json without the replays key loads the default replays state, with no schema bump".
  Acceptance: those tests pass; `npm run typecheck` clean.

- **D2 — extra-folder handlers with main-side validation.** Files: `src/shared/modules/replays.ts`
  (extend `REPLAYS_HANDLERS` with `extraFoldersList: 'extraFolders.list'`, `extraFoldersAdd:
'extraFolders.add'`, `extraFoldersRemove: 'extraFolders.remove'`; payload schemas
  `z.void()`, `z.object({ path: absolutePathSchema })` (from `src/shared/schemas.ts`), `z.object({
id: z.string().min(1) })`; result type `ExtraFoldersResult = { ok: true; folders:
ReplaysExtraFolder[] } | { ok: false; reason: 'notAbsolute' | 'unresolvable' | 'notAFolder' |
'alreadyListed' }` — mirror `MasterSourcesResult` in `src/shared/modules/servers.ts`; set
  `REPLAYS_PATH_PAYLOAD_HANDLERS = ['extraFolders.add']`), `src/shared/modules/replays.test.ts`
  (the existing "every replays handler has a zod schema" / "no replays handler payload carries a
  filesystem path" tests must pass with the new entries), `src/main/modules/replays/extra-folders.ts`
  (new: `async addExtraFolder(current, rawPath, now, newId): Promise<ExtraFoldersResult>` — `!isAbsolute`
  → `notAbsolute`; `canonicalizePath` + `stat` throws → `unresolvable`; `!isDirectory()` →
  `notAFolder`; `pathKey` equal to a listed row → `alreadyListed`; else append `{ id, path:
canonical, addedAt }`; `removeExtraFolder(current, id)` — unknown id is a no-op returning the
  unchanged list; neither function ever writes, deletes or renames anything on disk),
  `src/main/modules/replays/extra-folders.test.ts` (new, real temp dirs via `mkdtemp`),
  `src/main/modules/replays/index.ts` (register the three handlers; persist through
  `app.state.setReplaysState` and answer with what was stored — mirror the `mutate` helper in
  `src/main/modules/servers/index.ts:209`), `src/main/modules/replays/index.test.ts` (extend).
  Tests: `extra-folders.test.ts` › "a non-absolute path, a file and a missing path are each rejected
  with their reason", › "a folder already listed under another spelling is rejected as already
  listed" (trailing separator + different case on Windows/macOS), › "an added folder is stored
  canonicalized", › "removing a folder leaves its files on disk untouched" (hash/list the temp dir
  before and after); `index.test.ts` › "extra folders added through the handler survive a new
  StateStore on the same file". Acceptance: those tests pass.

- **D3 — extra folders are scanned like installation demo folders.** Files: story 141's discovery
  code under `src/main/modules/replays/` (the function that builds the list of folders to scan and
  its per-folder scan function — extend, do not fork), its test file (extend), and the shared
  demo-source type in `src/shared/modules/replays.ts` (add `{ kind: 'extraFolder'; path: string }`
  beside 141's installation source). Each `replaysState().extraFolders` row becomes one source,
  scanned with **the same per-folder function** 141 uses: top level only (no subfolder recursion),
  `.dm2`/`.mvd2`/`.dm2.gz`/`.mvd2.gz` case-insensitive, sidecar `.json` and `_launcher/` excluded.
  An extra folder whose `pathKey(await canonicalizePath(p))` equals the canonical `pathKey` of any
  installation `demos/` folder scanned in the same pass is skipped (its demos keep the installation
  source). A folder that does not exist or cannot be read contributes no demos and does not fail the
  scan. Removing a row means the next scan simply no longer lists its demos. Tests (real temp dirs):
  › "demos in an extra folder are listed with an extra-folder source", › "an extra folder is scanned
  top-level only with the same formats and exclusions as installations" (`sub/deep.dm2`,
  `x.dm2.json`, `FINAL.DM2`, `notes.txt`), › "an extra folder that is an installation's demos folder
  yields no duplicate demos", › "an extra folder listed twice under different spellings yields each
  demo once", › "a removed extra folder's demos are no longer listed", › "a missing extra folder
  does not fail the scan". Acceptance: those tests pass.

- **D4 — the demos settings section manages extra folders.** Files:
  `src/renderer/src/modules/replays/ReplaysSettingsSection.tsx` (replace the placeholder; mirror the
  list + add + remove part of `src/renderer/src/modules/servers/ServersSettingsSection.tsx`, no
  drag-reorder), `src/renderer/src/modules/replays/ReplaysSettingsSection.test.tsx` (extend; drop
  the placeholder assertion), `src/renderer/src/modules/replays/client.ts` (typed calls for the three
  handlers), `src/renderer/src/i18n/locales/en.json` (`replays.extraFolders.*`: heading, empty text,
  add button, remove label with `{{path}}`, `error.notAbsolute` / `.unresolvable` / `.notAFolder` /
  `.alreadyListed`, picker title), `CHANGELOG.md` (one line under `## Unreleased` → `### Added`),
  `scripts/flows/replays-module-shell.mjs` (its last assertion targets
  `replays-settings-placeholder` — point it at `replays-extra-folders` instead). Behaviour: on mount
  load `extraFolders.list`; "Add folder" button (`data-testid="replays-extra-folders-add"`) calls
  `window.q2.invoke('installations:pickFolder', { title: t('replays.extraFolders.pickTitle') })`;
  `null` = cancelled, no call; else `extraFolders.add`; on `ok: false` show
  `t('replays.extraFolders.error.<reason>')` as visible text with `role="alert"`
  (`replays-extra-folders-error`), cleared on the next success; rows
  (`replays-extra-folder-row`, the path as text) each with an `IconButton` remove
  (`aria-label` from the remove key); the list always comes from main's returned result. Tokens only
  (`/design-tokens`), no raw palette classes. Tests: › "the section lists, adds and removes extra
  folders through the module client", › "a rejected folder shows its reason as visible text", ›
  "a cancelled pick adds nothing". Acceptance: those tests pass; `npm run ui:flow --
replays-module-shell` OK.

- **D5 — the list shows the extra-folder source; end-to-end flow.** Files: story 141's renderer
  source-label code (the place that renders "installation name + game dir" — add the
  `extraFolder` branch as `t('replays.source.extraFolder', { path })`), its test (extend),
  `src/renderer/src/i18n/locales/en.json` (`replays.source.extraFolder`: "extra folder: {{path}}"),
  `scripts/lib/fixture.mjs` (a real extra-demos folder beside 141's fixture demos, with
  `a.dm2`, `B.MVD2`, `a.dm2.json`, `sub/deep.dm2`; export its path helper),
  `scripts/flows/replays-extra-folders.mjs` (new; mirror `scripts/flows/servers-master-sources.mjs`
  including its restart phase). Flow: set `Q2L_UI_PICK_FOLDER` to the fixture folder; Settings →
  `replays-extra-folders-add` → a row with that path; shot `replays-extra-folder-added`; Demos view
  lists `a.dm2` and `B.MVD2` with source text "extra folder: <path>" and neither `deep.dm2` nor the
  `.json`; restart on a copied `state.json` → the row is still there; add the same folder again →
  `replays-extra-folders-error` visible and the list still shows each demo once; remove the row →
  the Demos view no longer lists them, and the fixture files still exist on disk. Test: unit ›
  "an extra-folder source renders as extra folder: <path>". Acceptance: that test passes; `npm run
ui:flow -- replays-extra-folders` OK.

## Model Hints

- D1 → default — the story-110 state-key recipe a third time, precedent named per file.
- D2 → default — three CRUD handlers mirroring the servers `mutate` helper; each rejection branch
  has its own test.
- D3 → default — extends 141's discovery with one more source kind; the dedup rule and its
  negative cases are spelled out as tests.
- D4 → default — a list/add/remove section mirroring `ServersSettingsSection`.
- D5 → default — one label branch, a fixture folder and a flow mirroring `servers-master-sources`.
- Review: → default — additive persistence, CRUD and one scan source kind; every negative behaviour
  (rejection reasons, no duplicate demos, disk untouched on remove, no recursion) is pinned by a
  named test on real temp folders, so no plausible wrong implementation hides from tests plus a
  default review.

## Acceptance Tests

- AC1 → e2e `scripts/flows/replays-extra-folders.mjs` › flow `replays-extra-folders` (D5) — add via
  the (stubbed) native picker, row visible, survives restart, remove; plus unit
  `src/renderer/src/modules/replays/ReplaysSettingsSection.test.tsx` › "the section lists, adds and
  removes extra folders through the module client" (D4) and unit
  `src/main/services/state.test.ts` › "replays state round-trips through state.json and touches no
  other key" (D1). The OS dialog itself is replaced by `Q2L_UI_PICK_FOLDER` (Playwright cannot drive
  a native dialog, `docs/UI-VERIFICATION.md` "Known blind spots") — the same accepted stub every
  folder-picking flow uses, not a manual residue.
- AC2 → e2e flow `replays-extra-folders` (D5) — demos listed with "extra folder: <path>", `deep.dm2`
  and the sidecar absent; unit `src/main/modules/replays/` (141's discovery test file) › "demos in an
  extra folder are listed with an extra-folder source" and › "an extra folder is scanned top-level
  only with the same formats and exclusions as installations" (D3); unit › "an extra-folder source
  renders as extra folder: <path>" (D5).
- AC3 → unit `src/main/modules/replays/extra-folders.test.ts` › "a non-absolute path, a file and a
  missing path are each rejected with their reason" and › "an added folder is stored canonicalized"
  (D2); unit `ReplaysSettingsSection.test.tsx` › "a rejected folder shows its reason as visible
  text" (D4); schema presence via `src/shared/modules/replays.test.ts` › "every replays handler has
  a zod schema" (D2).
- AC4 → unit `extra-folders.test.ts` › "a folder already listed under another spelling is rejected
  as already listed" (D2); unit (141's discovery test file) › "an extra folder that is an
  installation's demos folder yields no duplicate demos" and › "an extra folder listed twice under
  different spellings yields each demo once" (D3); e2e flow `replays-extra-folders` re-add step (D5).
- AC5 → unit `extra-folders.test.ts` › "removing a folder leaves its files on disk untouched" (D2);
  unit `discovery.test.ts` › "a removed extra folder is no longer listed" (D3 — landed under this
  slightly shorter name, same assertion); e2e flow `replays-extra-folders` remove step, fixture files
  still on disk (D5).
- AC6 → unit `src/main/lib/schemas.test.ts` › "a foreign replays value falls back to the default
  replays state" and › "a malformed extra folder row is dropped, its siblings survive" (D1); unit
  `src/main/services/state.test.ts` › "a state.json without the replays key loads the default
  replays state, with no schema bump" (D1).

No manual residue.

## Done

User-chosen extra demo folders: `replays.extraFolders` added to the existing `replays` state key
(D1), `extraFolders.list/add/remove` handlers with main-side validation (isAbsolute → stat →
canonicalizePath → pathKey dedup) (D2), 141's `discoverDemos` extended with extra-folder sources,
deduped against installation `demos/` folders (D3), a Settings-section list/add/remove UI wired to
the native `installations:pickFolder` dialog (D4), and the "extra folder: `<path>`" list label plus
fixture + e2e flow `replays-extra-folders` (D5).

Commit message: `142: add my own demo folders`

Verification — narrow gate: `npm run build` GREEN, `npm run typecheck` GREEN, `npx vitest run
--changed HEAD` GREEN (110 files, 1630 tests). `npm run ui:flow -- replays-extra-folders`:
**INCONCLUSIVE (environment)** — times out on the very first locator (`nav-settings`), the same
Electron-window-not-rendering symptom this session hit on stories 140 and 141's own flows before
any code in this story existed; not a code-specific failure (confirmed by re-running the untouched
`replays-module-shell` flow, which fails identically at its own first locator). AC → test mapping,
all found and passing in the vitest run above: AC1 → `ReplaysSettingsSection.test.tsx` › "the
section lists, adds and removes extra folders through the module client", `state.test.ts` ›
"replays state round-trips through state.json and touches no other key"; AC2 → `discovery.test.ts`
› "demos in an extra folder are listed with an extra-folder source" + › "an extra folder is scanned
top-level only with the same formats and exclusions as installations", `ReplaysView.test.tsx` › "an
extra-folder source renders as extra folder: <path>"; AC3 → `extra-folders.test.ts` › "a
non-absolute path, a file and a missing path are each rejected with their reason" + › "an added
folder is stored canonicalized", `ReplaysSettingsSection.test.tsx` › "a rejected folder shows its
reason as visible text", `replays.test.ts` › "every replays handler has a zod schema"; AC4 →
`extra-folders.test.ts` › "a folder already listed under another spelling is rejected as already
listed", `discovery.test.ts` › "an extra folder that is an installation's demos folder yields no
duplicate demos" + › "an extra folder listed twice under different spellings yields each demo
once"; AC5 → `extra-folders.test.ts` › "removing a folder leaves its files on disk untouched",
`discovery.test.ts` › "a removed extra folder is no longer listed"; AC6 → `schemas.test.ts` › "a
foreign replays value falls back to the default replays state" + › "a malformed extra folder row is
dropped, its siblings survive", `state.test.ts` › "a state.json without the replays key loads the
default replays state, with no schema bump". No manual residue.

Review: default-tier clean-agent review, cycle 1 → FAIL — confirmed bug: `extraFolders.remove`'s
main handler returned a bare `ReplaysExtraFolder[]` while the renderer client/`mutate()` expected
`ExtraFoldersResult`'s `{ ok: true, folders }` shape, so `!domain.ok` was always true on a real
remove and the Settings-list row never disappeared (AC1/AC5). Fixed by making the handler return
`{ ok: true, folders: persisted.extraFolders }`, mirroring `add`'s shape; re-verified green (narrow
gate re-run, all green; e2e still environment-inconclusive as above). No further findings after the
fix; no deliberately-unfixed findings.

Decisions (implementation-detail, made without a user question per sprint rules):

- `ReplaysState`/`parseReplaysState` already live in `src/main/lib/schemas.ts` (not
  `src/shared/modules/replays.ts` as the plan's shorthand implied) — extended there, in place,
  rather than relocated, since story 140 had already established that location.
- D2's `addExtraFolder` uses `stat()` directly (not `canonicalizePath`+`isDirectory`) to
  distinguish `unresolvable` (stat throws) from `notAFolder` (stat succeeds, not a directory); the
  stored path is still canonicalized via `canonicalizePath` afterward. `fs-utils.ts`'s
  `canonicalizePath`/`isDirectory` swallow errors internally and can't tell the two cases apart on
  their own.
- `demoSourceSchema` (`src/shared/modules/replays.ts`) converted from a plain object to a
  `z.discriminatedUnion('kind', ...)` to add the `extraFolder` member alongside `installation`.
- `scripts/flows/replays-module-shell.mjs`'s last assertion now checks both
  `replays-name-templates` (story 140) and `replays-extra-folders-add` (this story) are visible,
  rather than replacing one with the other — the placeholder it originally guarded is long gone.

tiers: D 5 / hard 0 · review default · cycles 1 · agents 9
