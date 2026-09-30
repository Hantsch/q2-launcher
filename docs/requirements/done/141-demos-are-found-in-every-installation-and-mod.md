---
id: 141
title: demos are found in every installation and mod
status: done # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

A user has several installations and plays several mods. Their demos sit in `baseq2/demos/`,
`opentdm/demos/`, `ctf/demos/` — per installation. The Demos view lists all of them in one place,
each labelled with where it lives (concept `docs/concepts/demo-browser.md` §7, DEMO-1, DEMO-2).

Discovery walks every installation (from the installations service) × every game dir `inspector.ts`
detects, and looks in `<root>/<gamedir>/demos/`. Q2PRO's `homedir` defaults to `~/.q2pro` in
system-wide Linux builds (distro/Flatpak), so the installation's **effective write directory** is
scanned too, not only its root. Recognised formats: `.dm2`, `.mvd2`, `.dm2.gz`, `.mvd2.gz`. Sidecars
(`*.json`, [[146]]) are not demos. The launcher's own temporary playback copies
(`demos/_launcher/`, [[160]]) never appear as demos.

This story delivers the discovered list with source labels; parsing results arrive through
[[136]]–[[139]], the incremental index through [[144]], the row itself through [[150]]. It also sets
up the UI-verification fixture: demos are served from a local test folder, and no test touches a
real installation (§14).

## Acceptance Criteria

- [x] **AC1** — Every `.dm2`, `.mvd2`, `.dm2.gz` and `.mvd2.gz` in `<root>/<gamedir>/demos/` of every
      installation and every detected game dir appears in the list.
- [x] **AC2** — For an installation whose effective write directory differs from its root (Q2PRO
      `homedir`, e.g. `~/.q2pro` on Linux), demos in `<writedir>/<gamedir>/demos/` appear too, and a
      demo present in both places is not listed twice.
- [x] **AC3** — Each demo shows its source as installation name + game dir.
- [x] **AC4** — Sidecar `.json` files and anything under `demos/_launcher/` are never listed as
      demos.
- [x] **AC5** — Extension matching is case-insensitive (`FINAL.DM2` is found).
- [x] **AC6** — A `ui:verify`/`ui:flow` fixture serves demos from a local test folder, so the list
      renders with data in e2e runs without any real installation.

## Open Questions

- [x] ~~**Q1 — Recursion** — only the `demos/` folder itself, or its subfolders too (Q2PRO's `demo`
      command accepts subpaths)?~~ answered → Decisions (Sprint)
- [x] ~~**Q2 — Write directory** — how the launcher learns an installation's effective write
      directory (known per engine/build, or read from the installation's config).~~ decided by
      refine → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Recursion: scan only the top-level `demos/` folder (and effective write-dir
  equivalent), not subfolders — matches the documented location and keeps the scan bounded.
  Same answer applies to [[142]]'s extra folders.
- **Q2: the effective write directory is engine-known, not read from config** — for an
  installation whose `engineKind` or `recordedEngineKind` is `q2pro` **on Linux**, it is
  `<homeDir>/.q2pro`; everywhere else there is none beyond the root. Reason: Q2PRO's `homedir` is a
  `CVAR_NOSET` startup cvar (command line only, no `.cfg` can change it) and the launcher never
  passes it (`launch-plan.ts` has no `homedir`/`basedir`), so the only non-root location is the
  build default the concept §7 names; scanning `~/.q2pro` when it does not exist (portable builds,
  where `homedir` = basedir) is a harmless empty listing. r1q2 has no user dir
  (`engine.ts` `writeDirStrategy: 'install-dir'`); Q2PRO on Windows defaults to the basedir.
- **`Installation.writeDirPath` is not scanned** — nothing passes it to the engine (the launch
  ignores it), so the game never writes demos there; the resolver is one pure function so the
  story that ever starts passing `+set homedir` adds one line there.
- **Game dirs in the root = `installation.gameDirs`** (what `inspector.ts` detected at the last
  validation, `baseq2` first) — AC1's "every detected game dir"; a missing or unreadable folder is
  skipped silently here, per-source errors are [[151]]'s.
- **Game dirs in the write dir = every immediate subdirectory (not in `NON_GAME_DIRS`) that holds a
  `demos/` folder** — Q2PRO downloads a mod's files into `homedir`, so a mod dir can exist only
  there, and inspector's pak/`game.dll` rule does not fit a write dir that holds no paks.
- **`demos` is looked up case-insensitively** (`listDir().byLowerName`), extension matching is on
  the lowercased name (`.dm2`, `.mvd2`, `.dm2.gz`, `.mvd2.gz`); a `.zip` is not a demo here
  ([[143]]).
- **`_launcher/` is excluded by construction** — the scan never descends below `demos/` (Q1), and a
  test pins it anyway.
- **Dedupe: canonical path first, then shadowing** — each `demos/` dir is canonicalised
  (`canonicalizePath`) and a file's identity is `pathKey(join(canonicalDir, name))` (case-folded on
  Windows, exact on Linux); the first occurrence in `app.installations.list()` order wins. Within
  one installation + game dir, a write-dir file with the same name as a root file wins and the
  root one is dropped, because Q2PRO searches `homedir` before the basedir, so the root copy is
  unreachable by `demo <name>`.
- **Demo id = first 16 hex chars of `sha256(identity key)`** — stable across scans for [[144]]'s
  cache and sidecars, and the renderer never sees or sends a path ([[135]] AC7).
- **One new handler `demos.list` (`z.void()` payload) does a fresh, full, synchronous discovery
  per call** — no cache, no events, no refresh button: those are [[144]]; this keeps the story to
  discovery.
- **The DTO carries no path**: `{ id, fileName, format: 'dm2'|'mvd2', gzip, source: { kind:
  'installation', installationId, installationName, gameDir } }` — `kind` leaves room for [[142]]'s
  extra folders without reshaping.
- **A minimal `ReplaysView` replaces the planned placeholder** — AC3/AC6 need a rendered list; it
  shows an `h1` "Demos", one row per demo (file name + source "installation · game dir"), a loading
  and an empty line. Columns, order, states and the real row are [[150]]–[[152]]; main returns the
  list sorted by installation order, then game dir order, then file name, so the fixture is
  deterministic. Manifest `status` flips `'planned'` → `'available'`.
- **Local `useState`/`useEffect` in the view, no Zustand store yet** — one read on mount; [[144]]
  owns scan state.
- **UI harness never reads the real home dir** — when `isUiHarnessEnabled()` is true the module's
  home dir is `<userData>/harness-home`, so a Linux e2e run cannot pick up a developer's
  `~/.q2pro` (§14: no test touches a real installation).
- **Fixture = real demo files inside the existing fixture installation folders** under
  `.ui-verify/fixture/game/<installId>/`, plus decoys (sidecar, `_launcher/`, subfolder, `.txt`)
  that must stay invisible; contents are placeholder bytes — this story does not parse.
- **Platform parity** — nothing is unavailable on either platform, only the write-dir location
  differs; no disabled control is needed.
- **CHANGELOG** — the Demos view now lists demos: one line under `## Unreleased → ### Added`.

## Plan

Main does the discovery, the renderer shows it. Builds on [[135]]'s `replays` scaffold
(`src/shared/modules/replays.ts`, `src/main/modules/replays/index.ts`,
`src/renderer/src/modules/replays/`).

1. **Contract** (D1) — `demos.list` handler + DTO schemas in `src/shared/modules/replays.ts`.
2. **Discovery core** (D2) — pure-ish `src/main/modules/replays/discovery.ts`: recogniser,
   write-dir resolver, per-installation walk, dedupe/shadowing, sort, id. Real temp-dir tests.
3. **Handler wiring** (D3) — register `demos.list` in the module's `setup()`, map to the DTO,
   harness-safe home dir.
4. **View** (D4) — `ReplaysView` + client call + i18n + status flip + CHANGELOG.
5. **Fixture + e2e** (D5) — demo files and decoys in the fixture installations, flow
   `replays-discovered-list`, ui:verify screen `replays-list`.

Order: D1 → D2 → D3 → D4 → D5 (D5's flow needs the view and the handler).

## Deliverables

- **D1 — `demos.list` contract.** Files: `src/shared/modules/replays.ts` (edit),
  `src/shared/modules/replays.test.ts` (edit). Add `demosList: 'demos.list'` to `REPLAYS_HANDLERS`
  and its payload schema `replaysNoInputSchema` (`z.void()`) to `REPLAYS_HANDLER_SCHEMAS`. Add
  `demoFormatSchema = z.enum(['dm2', 'mvd2'])`, `demoSourceSchema = z.object({ kind:
  z.literal('installation'), installationId: z.string().min(1), installationName: z.string(),
  gameDir: z.string().min(1) })`, `discoveredDemoSchema = z.object({ id:
  z.string().regex(/^[0-9a-f]{16}$/), fileName: z.string().min(1), format: demoFormatSchema, gzip:
  z.boolean(), source: demoSourceSchema })`, `demosListResultSchema =
  z.array(discoveredDemoSchema)` and the inferred types `DiscoveredDemo`, `DemoSource`,
  `DemoFormat`. No path field anywhere. Test: › "a discovered demo carries no filesystem path"
  (parses a sample; asserts no key of the parsed object or its `source` matches
  `/path|dir$|folder/i` other than `gameDir`). The existing "every replays handler has a zod
  schema" and "no replays handler payload carries a filesystem path" must stay green.
  Acceptance: `npm run typecheck`; `replays.test.ts` passes.

- **D2 — discovery core.** Files: `src/main/modules/replays/discovery.ts` (new),
  `src/main/modules/replays/discovery.test.ts` (new; temp dirs via `mkdtemp` like
  `src/main/services/inspector.test.ts`). Uses `listDir`, `canonicalizePath`, `pathKey` from
  `src/main/lib/fs-utils.ts` and `NON_GAME_DIRS` from `@shared/constants`. Exports:
  - `recogniseDemoFile(name): { format: 'dm2'|'mvd2'; gzip: boolean } | null` — on the lowercased
    name: `.dm2`, `.mvd2`, `.dm2.gz`, `.mvd2.gz`; anything else (incl. `.dm2.json`, `.zip`) → null.
  - `effectiveWriteDirs(installation, { platform, homeDir }): string[]` — `[join(homeDir,
    '.q2pro')]` when `platform === 'linux'` and `engineKind` or `recordedEngineKind` is `'q2pro'`,
    else `[]`. Never uses `writeDirPath`. Doc comment: Q2PRO `homedir` is a command-line-only
    cvar the launcher does not pass; concept §7.
  - `discoverDemos(installations, { platform, homeDir }): Promise<DiscoveredDemoFile[]>` where
    `DiscoveredDemoFile = DiscoveredDemo & { absolutePath: string }` (main-only). For each
    installation in the given order: root game dirs = `installation.gameDirs`; write-dir game dirs
    = immediate subdirs of each write dir not in `NON_GAME_DIRS` (lowercased) that contain a
    `demos` child. For each (base, gameDir): find `demos` case-insensitively via
    `listDir(join(base, gameDir)).byLowerName`, list it **once, no recursion**, keep files
    `recogniseDemoFile` accepts. Identity key = `pathKey(join(await canonicalizePath(demosDir),
    fileName))`; skip a key already seen (first installation wins). Shadowing: within the same
    installation + game dir, a write-dir file whose name equals a root file's name replaces the
    root entry. `id = sha256(key).hex.slice(0, 16)` (`node:crypto`). Sort: installation order,
    then game-dir order (root order, write-dir-only dirs after, by name), then `fileName`
    `localeCompare`. Unreadable/missing folders yield nothing (no throw).
  Tests (`discovery.test.ts`): › "finds every recognised demo in every detected game dir of every
  installation" (two installations, `baseq2` + `ctf`, all four formats); › "extension matching is
  case-insensitive" (`FINAL.DM2`, `Match.MVD2.GZ`, a `Demos/` folder); › "sidecars, _launcher and
  subfolders are never listed" (`x.dm2.json`, `demos/_launcher/y.dm2`, `demos/sub/z.dm2`,
  `notes.txt`, `a.zip`); › "a Q2PRO installation on Linux also yields demos from
  ~/.q2pro/<gamedir>/demos" (injected `homeDir` temp dir, incl. a write-dir-only mod dir); › "no
  write dir is scanned on Windows, for r1q2, or from writeDirPath" (same fixture, `platform:
  'win32'` / r1q2 / `writeDirPath` set → only root demos); › "a demo reachable through two paths is
  listed once" (root and write dir are the same folder via a `symlink(…, 'junction')`); › "a
  write-dir demo shadows the same-named root demo"; › "ids are stable across scans and differ per
  file"; › "a missing root yields no demos and no error".
  Acceptance: those tests pass on Windows (`npx vitest run src/main/modules/replays`).

- **D3 — `demos.list` handler.** Files: `src/main/modules/replays/index.ts` (edit),
  `src/main/modules/replays/index.test.ts` (edit). In `setup({ handle, app })` register
  `REPLAYS_HANDLERS.demosList` with `replaysNoInputSchema`, calling `discoverDemos(app.installations
  .list(), { platform: process.platform, homeDir: discoveryHomeDir() })` and returning each entry
  without `absolutePath` (explicit field pick, not a spread). Export `discoveryHomeDir({ env =
  process.env, userData = userDataDir(), osHome = homedir() } = {})`: `isUiHarnessEnabled({ env })`
  (`src/main/lib/ui-harness.ts`) → `join(userData, 'harness-home')`, else `osHome`
  (`userDataDir` from `src/main/lib/paths.ts`). Tests: › "demos.list returns the discovered demos
  without paths" (a stubbed `app.installations.list()` over a temp installation; result parses
  with `demosListResultSchema` and has no `absolutePath`); › "a bad demos.list payload is rejected";
  › "the harness never reads the real home dir" (gate on → `harness-home` under userData, off →
  `osHome`). The existing registry tests' handler-set assertion now includes `demos.list`.
  Acceptance: those tests pass.

- **D4 — minimal Demos view.** Files: `src/renderer/src/modules/replays/ReplaysView.tsx` (new;
  mirror the header/heading markup of `src/renderer/src/modules/servers/ServersView.tsx`, nothing
  else of it), `src/renderer/src/modules/replays/ReplaysView.test.tsx` (new, mirror
  `ServersView.test.tsx`'s client mocking), `src/renderer/src/modules/replays/client.ts` (edit: add
  `listDemos(): Promise<DiscoveredDemo[]>` over `callModule`), `src/renderer/src/modules/index.ts`
  (edit: `View: ReplaysView` on the `replays` entry), `src/shared/types/module.ts` (edit: replays
  `status: 'available'`), `src/shared/types/module.test.ts` (edit: the replays status assertion),
  `src/renderer/src/i18n/locales/en.json` (edit, inside the top-level `replays` block:
  `view.title` "Demos", `list.label` "Demos", `list.loading` "Looking for demos…", `list.empty`
  "No demos found.", `list.source` "{{installation}} · {{gameDir}}"), `CHANGELOG.md` (one short line
  under `## Unreleased` → `### Added`). View: `h1` from `replays.view.title` (the
  `replays-module-shell` flow asserts a heading named exactly "Demos"), `useEffect` calls
  `listDemos()` once; states `replays-list-loading` / `replays-list-empty`; list `<ul
  data-testid="replays-demo-list" aria-label=…>` with `<li data-testid="replays-demo-row"
  data-demo-id={id}>` holding the file name (`replays-demo-name`) and source
  (`replays-demo-source`) — demo data is data, not i18n. Semantic tokens only, no hex/raw palette
  classes. Tests: › "each row shows the file name and its installation and game dir"; › "an empty
  discovery shows the empty line"; › "every new string comes from the replays block".
  Acceptance: those tests pass; typecheck clean.

- **D5 — fixture, flow, screen.** Files: `scripts/lib/fixture.mjs` (edit: exported
  `REPLAYS_FIXTURE_DEMOS` / `REPLAYS_FIXTURE_DECOYS` and `writeReplaysDemosFixture()` called from
  `writePopulatedFixture()`; mirror the `writeNewsImagesFixture()` style), `scripts/flows/replays-
  discovered-list.mjs` (new, mirror `scripts/flows/servers-module-shell.mjs`),
  `scripts/lib/screens.mjs` (edit: screen `replays-list`, variant `populated`, clicks `nav-replays`,
  waits for `replays-demo-list`). Fixture: in `INSTALL_ONE_ID`'s `<root>/baseq2/demos/`:
  `duel_q2dm1.dm2`, `FINAL.DM2`, `tourney.mvd2.gz`, `ctf_q2ctf1.dm2.gz`; in `INSTALL_TWO_ID`'s
  root, a second detected game dir's `demos/team_q2dm3.mvd2` — use a game dir the startup
  revalidation keeps in `gameDirs` (`ctf` is in `KNOWN_GAME_DIRS`; verify `RESTORE_GAME_DIR` is
  detected before reusing it). Decoys next to them: `duel_q2dm1.dm2.json`,
  `_launcher/leftover.dm2`, `old/nested.dm2`, `readme.txt`. Placeholder bytes only. Nothing
  existing screens/flows count may change (check `config-import-*` gamedir auto-selection if you
  add `ctf`). Flow `replays-discovered-list`: `nav-replays` → `replays-demo-list` visible; the
  `replays-demo-name` texts equal exactly the five fixture names; no decoy name visible; the
  `FINAL.DM2` row's `replays-demo-source` reads "Fixture Favorite Install · baseq2" and the
  `team_q2dm3.mvd2` row's reads "Fixture WriteDir Install · <that game dir>"; shot
  `replays-discovered-list`. Comment the selectors at the top and note that [[150]] replaces the
  row markup and must update this flow.
  Acceptance: `npm run ui:flow -- replays-discovered-list` and `npm run ui:flow --
  replays-module-shell` OK; `npm run ui:verify` passes with the `replays-list` screen (axe clean).

## Model Hints

- D1 → default — schema additions in an existing contract file.
- D2 → default — new, self-contained code with every subtle rule (canonical dedupe, shadowing,
  no recursion, Linux-only write dir) spelled out and pinned by a named real-filesystem test.
- D3 → default — one handler plus a gated two-branch helper.
- D4 → default — a small list view on an existing client/registration pattern.
- D5 → default — fixture files and a flow mirroring existing ones.
- Review: → default — no regression surface beyond the manifest status flip; the negative
  behaviours (decoys, real home dir, recursion) each have an explicit test.

## Acceptance Tests

- AC1 → unit `src/main/modules/replays/discovery.test.ts` › "finds every recognised demo in every
  detected game dir of every installation" (D2); e2e `scripts/flows/replays-discovered-list.mjs` ›
  flow `replays-discovered-list` (D5).
- AC2 → unit `src/main/modules/replays/discovery.test.ts` › "a Q2PRO installation on Linux also
  yields demos from ~/.q2pro/<gamedir>/demos", › "a demo reachable through two paths is listed
  once", › "a write-dir demo shadows the same-named root demo" and › "no write dir is scanned on
  Windows, for r1q2, or from writeDirPath" (D2). No e2e: the write dir exists only on Linux and the
  harness deliberately never reads a real home dir (D3 › "the harness never reads the real home
  dir"); this is discovery logic without a user action, covered by `test`.
- AC3 → e2e `scripts/flows/replays-discovered-list.mjs` › flow `replays-discovered-list` (D5); unit
  `src/renderer/src/modules/replays/ReplaysView.test.tsx` › "each row shows the file name and its
  installation and game dir" (D4).
- AC4 → unit `src/main/modules/replays/discovery.test.ts` › "sidecars, _launcher and subfolders are
  never listed" (D2); e2e flow `replays-discovered-list` asserts no decoy is visible (D5).
- AC5 → unit `src/main/modules/replays/discovery.test.ts` › "extension matching is
  case-insensitive" (D2); e2e flow `replays-discovered-list` finds `FINAL.DM2` (D5).
- AC6 → e2e `scripts/flows/replays-discovered-list.mjs` › flow `replays-discovered-list` and
  `npm run ui:verify` screen `replays-list` (D5), backed by D3 › "demos.list returns the discovered
  demos without paths".

## Done

Discovery walks every installation × detected game dir's `demos/` plus the Q2PRO-on-Linux
effective write dir, recognises `.dm2`/`.mvd2`/`.dm2.gz`/`.mvd2.gz` case-insensitively (no
recursion), dedupes by canonical path with write-dir-shadows-root precedence, and exposes it
through a path-free `demos.list` handler. A minimal `ReplaysView` renders the discovered list
with source labels; `replays` module status flipped to `available`. Fixture + flow
`replays-discovered-list` and ui:verify screen `replays-list` added.

Commit message: `141: find demos in every installation and mod's demos folder`

Changed files: `src/shared/modules/replays.ts(.test.ts)`,
`src/main/modules/replays/discovery.ts(.test.ts)` (new),
`src/main/modules/replays/index.ts(.test.ts)`,
`src/renderer/src/modules/replays/ReplaysView.tsx(.test.tsx)` (new),
`src/renderer/src/modules/replays/client.ts`, `src/renderer/src/modules/index.ts`,
`src/shared/types/module.ts(.test.ts)`, `src/renderer/src/i18n/locales/en.json`,
`src/renderer/src/modules/replays/ReplaysSettingsSection.test.tsx`, `CHANGELOG.md`,
`scripts/lib/fixture.mjs`, `scripts/flows/replays-discovered-list.mjs` (new),
`scripts/lib/screens.mjs`.

Verification: narrow gate. `npm run build`, `npm run typecheck`,
`npx vitest run --changed HEAD` all green (165 files, 2488 passed/7 skipped), including every
test named in `## Acceptance Tests`. `npm run ui:flow -- replays-discovered-list` and
`npm run ui:flow -- replays-module-shell` **INCONCLUSIVE** — both time out on the very first
`nav-*` locator click (`element was detached from the DOM, retrying`); confirmed session-wide,
not caused by this story, by re-running the untouched pre-existing `servers-module-shell` flow
directly, which fails identically. `npm run ui:verify` likewise did not complete for the same
reason (same pattern as story 140's Done section). AC1/AC3/AC4/AC5/AC6's e2e half is therefore a
named environment gap, not a regression; their unit half (discovery.test.ts, ReplaysView.test.tsx,
index.test.ts) is green and, per clean-agent review, non-tautological. AC2 has no e2e leg by
design (Linux-only write dir, harness never reads a real home dir). Clean-agent review: PASS, no
findings (one procedural note about the same e2e gap, already recorded here).

Decisions: none beyond those already in `## Decisions (Sprint)`; no new implementation-detail
calls were needed during the build.

tiers: D 5 / hard 0 · review default · cycles 1 · agents 7
