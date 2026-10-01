---
id: 188
title: the mods view shows the mods I have
status: done # draft -> ready -> in-progress -> done
created: 2026-10-01
---

## Requirement

As a player, I open **Mods** in the navigation and see, as tiles, every game directory my
installation already has, with each one labelled for where it came from. Today the entry shows a
"planned" placeholder. This story makes the `mods` module real (main + renderer, registered in
both registries, its own IPC contract) and gives it its view: a tile catalog with a detail panel.
Later stories fill the catalog with installable entries.

Concept: [mods.md](../concepts/mods.md) §9, §12; requirements MOD-1, MOD-2, MOD-14.

## Acceptance Criteria

- [x] **AC1** — Opening Mods no longer shows the planned-module placeholder, but the Mods view.
- [x] **AC2** — For the installation the view speaks for, every game directory the inspector found
      (except `baseq2`) appears as one tile carrying the directory's name.
- [x] **AC3** — A game directory without a launcher install record carries the visible label
      *installed manually*.
- [x] **AC4** — Clicking a tile opens a detail panel naming the directory and its folder path, with
      a *Reveal folder* action that opens that folder in the OS file manager.
- [x] **AC5** — A manually installed directory's detail panel offers neither *Update* nor *Remove*.
- [x] **AC6** — An installation with no game directories besides `baseq2` shows an empty state that
      says so, not an empty grid.
- [x] **AC7** — Every installation id the renderer sends to the mods channels is validated in main.
      An unknown id is refused, never read from disk.

## Open Questions

- ~~**Q1**~~ answered → Decisions (Sprint) — (concept §14 item 4) — The tile catalog with a detail panel is a new pattern in this app.
  Do we build a layout prototype under `docs/prototypes/mods/` before this story, or decide the
  layout in the story?
- ~~**Q2**~~ answered → Decisions (Sprint) — (concept §14 item 6) — Which installation does the view speak for: the globally selected
  one, or an installation picker inside the Mods view?

## Decisions (Sprint)

- **(User)** Layout prototype first?: decide the layout in the story, no prototype
- **(User)** Which installation: the globally selected installation; the view shows explicitly which installation it speaks for
- **Layout:** a responsive tile grid with a detail panel docked to the right. The panel opens on tile click, closes via its close button or Escape, and the grid takes the full width while nothing is selected. This mirrors the existing replays list + detail-panel pattern instead of inventing a new one.
- **Source of truth:** the tiles come from a main handler `mods/list`, not from the renderer store's `Installation.gameDirs`. AC7 and the origin lookup (install records in `moduleData['mods']`) both have to live in main.
- **Game dirs read:** `mods/list` reads the persisted `Installation.gameDirs` (kept fresh by startup and post-change revalidation), not a live disk scan. An unknown id therefore touches nothing on disk, and the inspector stays the only folder judge.
- **`baseq2` exclusion is case-insensitive.** The inspector already treats dir names case-insensitively (`inspector.ts:160-161,328`).
- **Install-record reader:** 188 adds a minimal defensive reader of `moduleData['mods']` that only answers "does a record exist for this gamedir". Story 190 owns and extends the full record schema in the same file and must keep the `records[].gameDir` key. An origin that is computed, not hard-coded, is what AC3 tests.
- **Catalog-origin tiles in 188:** a gamedir with a record shows the label *installed*. Like manual ones, its detail panel offers no Update or Remove yet. Stories 191 and 194 add those actions, so 188 ships no dead buttons.
- **Manual note:** a manual dir's detail panel says visibly that the launcher does not update or remove it (concept §3). Without that line, AC5's missing buttons would read as a bug.
- **Reveal goes through a mods handler** (`mods/reveal` with `{ installationId, gameDir }`), so main builds the path from a validated id plus a gamedir the installation actually has. The renderer never sends a path. Under the UI harness it records via `recordHarnessRevealedPath`, the way `replays/index.ts:211-216` does.
- **No active installation:** the view shows an empty state asking the user to select an installation. The manifest's `requiresInstallation` is not enforced by the shell (repo fact, only `module.ts` reads it).
- **Platform parity:** nothing in this story is platform-limited, because reveal uses `shell.openPath` on both Windows and Linux. No disabled-with-reason control is needed.
- **Planned-module copy stays.** The `module.planned.mods.*` keys stay unused, the same precedent as downloads (`modules/index.test.ts:29`).

## Plan

Contract first, then main, then renderer, matching ARCHITECTURE.md's "Adding a module" steps.

1. **Contract.** Add `src/shared/modules/mods.ts` with:
   - `MODS_HANDLERS` = `{ list, reveal }`
   - `ModGameDirOrigin` = `'manual' | 'catalog'`
   - `ModGameDir` = `{ gameDir, folderPath, origin }`
   - `ModsListResult` = `{ installationId, gameDirs: ModGameDir[] }`
2. **Main.** Add `src/main/modules/mods/` with `index.ts`, `schemas.ts`, `install-records.ts` and tests, and register it in `src/main/modules/index.ts`.
   - Both handlers look the id up through `app.installations.find`. A miss returns `fail('mods.error.installationNotFound')`.
   - `reveal` also requires the gamedir to be a safe token and one of the installation's non-`baseq2` `gameDirs`, otherwise `mods.error.gameDirNotFound`.
3. **Renderer view (D2).** Add `src/renderer/src/modules/mods/`: `client.ts`, `ModsView.tsx`, `components/ModTile.tsx`.
   - The view has a header naming the active installation, a tile grid with origin badges, the empty states, and registration.
   - Flip the manifest status to `available`.
   - Add the i18n keys and a CHANGELOG line.
4. **Detail panel (D3).** Add `components/ModDetailPanel.tsx` with name, folder path and Reveal folder, plus the manual note.
5. **Acceptance.** Two ui flows prove the user-facing ACs, and main unit tests prove AC7.

Fixture: the populated variant's active installation (`fixture-install-favorite`) has only `baseq2`, which covers AC6. `fixture-install-writedir` has `ctf` (+ `q2l-restore-fixture`), which covers AC2-AC5. No fixture change should be needed. If startup revalidation drops a dir, the flow asserts against the live list (see D2).

## Deliverables

- [x] **D1 — mods contract + main module.** Files:
  - `src/shared/modules/mods.ts` (new, mirror `src/shared/modules/library.ts`): the `MODS_HANDLERS` map and result types listed in Plan step 1.
  - `src/main/modules/mods/schemas.ts` (new, mirror `src/main/modules/config/schemas.ts`):
    - `listInputSchema` = `z.object({ installationId: z.string().min(1) })`
    - `revealInputSchema` adds `gameDir`, which must be a non-empty `^[A-Za-z0-9_.-]+$` token (same rule as `src/shared/ipc-schemas.ts:108`)
  - `src/main/modules/mods/install-records.ts` (new): `recordedGameDirs(moduleData: unknown): Set<string>` (lower-cased). It reads `moduleData?.['mods']` as `{ records: Array<{ gameDir: string }> }` defensively. A bad envelope gives an empty set, and a bad row is dropped (precedent: `src/main/modules/downloads/engine/installation-state.ts`). A doc comment says story 190 extends this schema here.
  - `src/main/modules/mods/index.ts` (new, mirror `src/main/modules/library/index.ts`; Outcome style of `src/main/modules/config/index.ts:1525`). The `modsModule` handlers:
    - `list` → find installation, else `fail('mods.error.installationNotFound')`. Map `installation.gameDirs`, minus `baseq2` case-insensitively, keeping order, to `{ gameDir, folderPath: join(rootPath, gameDir), origin }`. Origin is `'catalog'` if the dir is in `recordedGameDirs` (case-insensitive), else `'manual'`.
    - `reveal` → same id check. The gamedir must match a listed non-`baseq2` entry (case-insensitive), else `fail('mods.error.gameDirNotFound')`. Under `isUiHarnessEnabled({ isDev: app.isDev })` call `recordHarnessRevealedPath(folder)`. Otherwise call `shell.openPath(folder)`, where a non-empty error string means `fail('mods.error.revealFailed', { message })`.
  - `src/main/modules/index.ts`: add `modsModule` to `MODULES`, and update the "mods/assets remain parked" comment.
  - Tests in `src/main/modules/mods/index.test.ts` (mirror the harness of `src/main/modules/replays/index.test.ts` / `config/index.test.ts`, shell mocked):
    - "list refuses an unknown installation id"
    - "reveal refuses an unknown installation id and calls no shell"
    - "reveal refuses a gamedir the installation does not have"
    - "list returns every game directory except baseq2"
    - "a game directory without an install record is manual"
    - "a game directory with an install record is catalog"
    - "reveal opens the gamedir folder under the installation root"
  - Tests in `src/main/modules/mods/schemas.test.ts`: "reveal input rejects a gamedir with a path separator".
- [x] **D2 — Mods view: header, tiles, empty states, registration.** Files:
  - `src/renderer/src/modules/mods/client.ts` (new, mirror `src/renderer/src/modules/library/client.ts`): `listMods(installationId)`, `revealMod(installationId, gameDir)` over `callModule('mods', …)`.
  - `src/renderer/src/modules/mods/ModsView.tsx` (new). Data and states:
    - It reads `useActiveInstallation()` (`src/renderer/src/store/useLauncher.ts:540`). It calls `listMods` on mount and whenever the active id or that installation's `gameDirs` change.
    - Header: an h1 (`module.mods.title`) plus a visible line "For <installation name>" (`data-testid="mods-installation-name"`). Mirror the header of `src/renderer/src/modules/replays/ReplaysView.tsx`.
    - No active installation → `EmptyState` (`src/renderer/src/components/ui/primitives.tsx:112`), `data-testid="mods-no-installation"`.
    - Zero entries → `EmptyState` saying this installation has no game directories besides baseq2, `data-testid="mods-empty"`, with no grid rendered.
    - A failed outcome → its i18n error key.
  - `src/renderer/src/modules/mods/components/ModTile.tsx` (new): a button tile (`data-testid="mods-tile-<gameDir>"`) showing the dir name plus a `Badge` (`primitives.tsx:56`).
    - The badge reads *installed manually* (`data-testid="mods-tile-origin-manual"`) or *installed* (`mods-tile-origin-catalog`).
    - Tokens only, no images, with a visible focus ring.
  - `src/renderer/src/modules/index.ts`: register `{ id: 'mods', View: ModsView }`, replacing the commented stub.
  - `src/shared/types/module.ts`: mods `status: 'available'`.
  - `src/renderer/src/i18n/locales/en.json`: a new top-level `mods.*` namespace (view, empty states, origin labels, errors `mods.error.installationNotFound`/`gameDirNotFound`/`revealFailed`).
  - `CHANGELOG.md` under `## Unreleased` / `### Added`: one line, e.g. "Mods view shows every game directory of the selected installation."
  - Tests:
    - `src/renderer/src/modules/index.test.ts`: add "the mods module is registered with a real View" and "the mods module's manifest status is available".
    - Flow `scripts/flows/mods-view.mjs` (mirror `scripts/flows/replays-list-empty.mjs`; fixture `populated`) does this:
      1. Click `nav-mods`.
      2. Assert the `mods` view is shown and the planned placeholder text (`module.planned.mods.intro` copy) is absent.
      3. With `fixture-install-favorite` active, assert `mods-empty` is visible and no `mods-tile-*` exists.
      4. Select `fixture-install-writedir` through the installation rail.
      5. Assert `mods-installation-name` shows "Fixture WriteDir Install", `mods-tile-ctf` exists, no `mods-tile-baseq2` exists, and the tile set equals that installation's `gameDirs` minus baseq2, read live through `window.q2.invoke('installations:list')`.
      6. Assert every tile carries `mods-tile-origin-manual` with the visible text "installed manually".
- [x] **D3 — detail panel with Reveal folder.** Files:
  - `src/renderer/src/modules/mods/components/ModDetailPanel.tsx` (new, mirror the docked layout of `src/renderer/src/modules/replays/components/DemoDetailPanel.tsx`). It is `data-testid="mods-detail-panel"` and contains:
    - the dir name as heading (`mods-detail-name`)
    - the full folder path (`mods-detail-path`, selectable text)
    - a *Reveal folder* `Button` (`mods-detail-reveal`) → `revealMod`, whose failure shows the error key inline
    - for `origin: 'manual'`, the visible note "Installed manually — the launcher does not update or remove it" (`mods-detail-manual-note`)
    - no Update or Remove control for any origin in this story
    - a close button, and Escape also closes the panel
  - `src/renderer/src/modules/mods/ModsView.tsx`: track the selected gamedir. Clicking a tile opens the panel, and the grid and panel sit side by side. The selection clears when the installation changes.
  - `src/renderer/src/i18n/locales/en.json`: the detail keys under `mods.detail.*`.
  - Tests: flow `scripts/flows/mods-detail.mjs` (mirror the reveal assertion of `scripts/flows/replays-demo-file-actions.mjs:62-100`; fixture `populated`) does this:
    1. Select `fixture-install-writedir`, open Mods and click `mods-tile-ctf`.
    2. Assert `mods-detail-name` is "ctf" and `mods-detail-path` ends with `fixture-install-writedir` + separator + `ctf`.
    3. Click `mods-detail-reveal` and assert exactly one new entry in `ui-harness-revealed.json`, ending in `ctf`.
    4. Assert `mods-detail-manual-note` is visible and no `mods-detail-update`/`mods-detail-remove` element exists.

## Model Hints

All Ds default tier. Nothing here is regression-prone or subtle: D1 is a mirror of existing Outcome handlers, and D2 and D3 are new files plus a registry line.

Review: → default. The obvious wrong turns are visible in a spec + diff review: the renderer reading `gameDirs` from the store instead of `mods/list`, a path sent from the renderer for reveal, or a hard-coded `manual` origin.

## Acceptance Tests

- AC1 → e2e `scripts/flows/mods-view.mjs` › "mods-view" (placeholder absent, Mods view shown); plus unit `src/renderer/src/modules/index.test.ts` › "the mods module is registered with a real View"
- AC2 → e2e `scripts/flows/mods-view.mjs` › "mods-view" (tile per non-baseq2 gamedir, named, no baseq2 tile); plus unit `src/main/modules/mods/index.test.ts` › "list returns every game directory except baseq2"
- AC3 → e2e `scripts/flows/mods-view.mjs` › "mods-view" (visible *installed manually* label); plus unit `src/main/modules/mods/index.test.ts` › "a game directory without an install record is manual" and › "a game directory with an install record is catalog"
- AC4 → e2e `scripts/flows/mods-detail.mjs` › "mods-detail" (name, folder path, Reveal recorded by the UI harness); plus unit `src/main/modules/mods/index.test.ts` › "reveal opens the gamedir folder under the installation root"
- AC5 → e2e `scripts/flows/mods-detail.mjs` › "mods-detail" (no update/remove control, manual note visible)
- AC6 → e2e `scripts/flows/mods-view.mjs` › "mods-view" (`mods-empty` on the baseq2-only installation, no tiles)
- AC7 → unit `src/main/modules/mods/index.test.ts` › "list refuses an unknown installation id", › "reveal refuses an unknown installation id and calls no shell", › "reveal refuses a gamedir the installation does not have"; plus unit `src/main/modules/mods/schemas.test.ts` › "reveal input rejects a gamedir with a path separator" (IPC validation, no user surface)

Coverage gate:

| AC | Deliverable | Test |
| --- | --- | --- |
| AC1 | D2 | mods-view |
| AC2 | D1 + D2 | index.test + mods-view |
| AC3 | D1 + D2 | index.test + mods-view |
| AC4 | D1 (reveal) + D3 | index.test + mods-detail |
| AC5 | D3 | mods-detail |
| AC6 | D2 | mods-view |
| AC7 | D1 | index.test + schemas.test |

No gaps.

## Done

Mods module is real: contract `src/shared/modules/mods.ts`, main module `src/main/modules/mods/` (`list`, `reveal`, install-record reader), renderer `src/renderer/src/modules/mods/` (view, tiles, detail panel with Reveal folder), registered in both registries, manifest `available`, i18n `mods.*`, CHANGELOG line, flows `mods-view` and `mods-detail`.

Commit message: `188: mods module — view of installed game dirs, tile catalog, detail panel, reveal`

Verification (narrow gate): `npm run build`, `npm run typecheck`, `npx vitest run --changed HEAD` (206 files / 3009 tests), `npm run ui:flow -- mods-view` and `-- mods-detail` (each after `ui:seed`) all green; after review fixes typecheck, `vitest run src/renderer/src/modules` and both flows re-run green. Full regression gate not run (sprint's job). AC -> test: AC1-AC7 all mapped tests ran and passed as listed under Acceptance Tests; no manual residue. Review: stage 1 PASS, 3 minor findings fixed (see Decisions).

Decisions:
- Detail panel buttons use the default 44px size, not `size="sm"` (no deviation row exists; CLAUDE.md untouched).
- `client.ts` flattens the `module:invoke` double Outcome into one `Outcome<T>`; stale list responses for another installation count as loading.
- `mods-detail.mjs` polls the revealed-paths file (5s bound) instead of a fixed wait; flows assume a freshly seeded fixture (`mods-detail` leaves WriteDir active; `ui:flows` reseeds per flow).
- `revealInputSchema.gameDir` additionally has `.max(64)` (harmless extra bound).
- Known unrelated flake seen once: `config/profiles.test.ts` EBUSY on Windows temp file (passed in the verify run).

Names later stories reuse: `recordedGameDirs` in `src/main/modules/mods/install-records.ts` (190 extends; keep `records[].gameDir`), `MODS_HANDLERS`/`ModGameDir`/`ModGameDirOrigin`/`ModsListResult` in `src/shared/modules/mods.ts`, `listInputSchema`/`revealInputSchema` in `src/main/modules/mods/schemas.ts`, `listMods`/`revealMod` in `src/renderer/src/modules/mods/client.ts`, `ModTile` (`selected`/`onSelect`), `ModDetailPanel`, testids `mods-tile-<dir>`, `mods-detail-*`, i18n `mods.*`/`mods.detail.*`/`mods.error.*`.

tiers: D 3 / hard 0 · review default · cycles 1 · agents 6
