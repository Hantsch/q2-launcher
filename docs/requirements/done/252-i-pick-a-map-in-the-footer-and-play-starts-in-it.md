---
id: 252
title: I pick a map in the footer and Play starts in it
status: done # draft -> ready -> in-progress -> done
created: 2026-10-26
---

## Requirement

As a player, I choose a map next to the mod in the footer, and Play starts straight into that map, so I
can practise or walk a map without going through the game menu.

User feedback 2026-10-26: optionally choose mod and map and start directly into the map — but not on
Servers and Demos, where the server or demo decides.

Story 249 built this as the "Play with…" dialog, but it lives in the Mods module, which is dev-only
(`src/shared/dev-modules.ts`), so release builds have no map choice. The launch plan already supports
`map` (`launch-plan.ts`), and `map` + `connect` are rejected together by the schema.

## Acceptance Criteria

- [x] **AC1** — In a release build the footer shows a "Map" select next to "Launch with" on Home and Library.
- [x] **AC2** — The Map select is not shown on Servers and Demos.
- [x] **AC3** — The Map select lists "No map" first, then the maps available to the chosen mod (its own and
      baseq2's, loose and in archives, as story 249 defined), sorted by name.
- [x] **AC4** — With a map chosen, Play launches with `+set deathmatch 1 +map <name>` and the chosen mod.
- [x] **AC5** — With "No map", Play starts at the menu exactly as today.
- [x] **AC6** — The map choice is remembered per installation across restarts, and Play from the Library card
      and the rail uses it too.
- [x] **AC7** — Changing "Launch with" to a mod that does not have the chosen map resets the map to "No map".
- [x] **AC8** — A server join and demo playback never pass the saved map.

## Open Questions

## Decisions (Sprint)

- **(User)** The map choice is a select in the footer next to "Launch with", not a dialog; remembered per
  installation; never shown on Servers and Demos.
- **(User)** A map start is always a local deathmatch (`+set deathmatch 1 +map <name>`); there is no
  game-type choice.
- Recorded at the cut, the user can veto before `/sprint`: the dev-only "Play with…" dialog (story 249) is
  superseded by the footer select and removed; its map listing (`map-list.ts`) and launch support move to
  release code.
- The saved map is a field on the installation record, `Installation.activeMap: string` (`''` = No map),
  persisted and updated through `installations:update` exactly like `activeGameDir` — "remembered per
  installation" is the same promise `activeGameDir` already keeps across restarts.
- The saved map is applied in the renderer store, not in main: `useLauncher.play(id)` called **without
  options** (the plain Play of footer, rail and Library card) adds `map: installation.activeMap` when it is
  non-empty — join always passes options (`connect`) and demo playback never goes through `launch:start`, so
  AC8 holds by construction; resolving it in `buildLaunchArgs` would leak the map into demo playback, which
  reuses that function.
- `LaunchInput.gameType` is removed and a map launch always emits `+set deathmatch 1` — the (User) decision
  leaves no caller for single player, and a dead option is a second path to keep correct.
- Map listing becomes a core IPC channel `installations:listMaps` (`{ installationId, gameDir }` →
  `Outcome<MapList>`), with `map-list.ts` moved to `src/main/services/` and `game-dir-fs.ts` to
  `src/main/lib/` — the mods module stays dev-only, and the shell may not depend on a module's handlers.
- The listing rules stay story 249's unchanged (loose, `.pak`, `.pkz` except r1q2; mod first, then
  baseq2; safe names only; deduped; sorted ASCII case-insensitively; BSP title for loose/pak) — AC3 points
  at "as story 249 defined".
- An option reads `name — title` when the BSP has a title, else `name`, as in story 249's dialog — that was
  a user decision for the map list and the footer shows the same list.
- The Map select shows whenever an installation is selected and the route is not Servers or Demos — also
  when the installation has no mods and "Launch with" is hidden, because baseq2 maps are startable without a
  mod.
- On other routes (Config, Downloads, Settings …) the Map select follows "Launch with"'s route rule from
  story 251 — the two are one footer group, and 251 owns the route rule.
- Changing "Launch with" first lists the new mod's maps, then writes `activeGameDir` and `activeMap` (kept
  if listed, else `''`) in **one** `installations:update` — two writes would let a fast Play launch the old
  map in the new mod.
- When a successfully loaded list does not contain the saved map (map file deleted), the saved map is
  cleared to `''`; a failed listing leaves it alone — Play must not start a map the select does not offer,
  but a transient read error must not erase the user's choice.
- While the list loads, the Map select is disabled — a select with no options yet would show a value it
  cannot explain.
- When revalidation clears `activeGameDir` (the mod folder disappeared), it clears `activeMap` too — the map
  was chosen for that mod.
- No migration from the dev-only `moduleData.mods.lastLaunch`: release users never had it; the key is
  dropped from the reader and left inert on disk (the envelope writers keep unknown keys).
- AC1's "release build" is proven by a component test that renders the footer with `DEV_MODULES` mocked
  `false`, plus the e2e flow: `ui:flows` runs the `build:dev` bundle, so the flow alone cannot show that
  the release gating is gone.
- AC8's demo half is proven by a main test on the real demo playback path (`demo-play.test.ts`) with an
  installation whose `activeMap` is set; a demo fixture in the flow would add a whole replays setup to prove
  a property the store rule already makes structural.

## Plan

1. **Core map listing (main + shared):** move `game-dir-fs.ts` → `src/main/lib/`, `map-list.ts` (+ test) →
   `src/main/services/`; `MapList` type to `src/shared/types/launch.ts`; channel `installations:listMaps`
   in `ipc.ts` / `ipc-schemas.ts`, handler in `src/main/ipc/installations.ts`.
2. **Saved map + launch (main + shared):** `Installation.activeMap`, update schema, persisted schema,
   service patch/defaults/revalidation; `gameType` removed, a map launch always `deathmatch 1`.
3. **Footer (renderer, shell):** `MapSelect` beside `GameDirSelect` in `ActionBar.tsx`; atomic mod+map
   update; plain `play()` passes the saved map; the "Play with…" button goes.
4. **Remove the dev dialog (mods module):** `PlayWithDialog`, `Dialogs.tsx`, client calls, `maps.list` /
   `launch.last.*` handlers and the `lastLaunch` reader/writer, locale strings; `mods-module.md`.
5. **e2e:** `scripts/flows/footer-map.mjs` replaces `play-with.mjs` (fixture gains a loopback server);
   CHANGELOG.

Order D1 → D2 → D3 → D4 → D5 (D4 after D3: the button that opens the dialog goes first). Builds on story
251's route rule in `ActionBar.tsx`. Platform parity: nothing platform-specific; Windows and Linux both get
the feature (the r1q2 `.pkz` skip is an engine rule, not a platform one).

## Deliverables

- **D1 — Map listing is core code with its own IPC channel.** Move `src/main/modules/mods/game-dir-fs.ts`
  → `src/main/lib/game-dir-fs.ts` (update the import in `src/main/modules/mods/map-presence.ts`) and
  `src/main/modules/mods/map-list.ts` + `map-list.test.ts` → `src/main/services/map-list.ts` /
  `map-list.test.ts` (`git mv`, behaviour unchanged). Move the `ModMapList` type out of
  `src/shared/modules/mods.ts` into `src/shared/types/launch.ts` as
  `MapList = { maps: Array<{ name: string; title?: string }> }` (re-point the mods file's remaining users to
  it; D4 deletes them). Add channel `'installations:listMaps': { req: { installationId: string; gameDir:
string }; res: Outcome<MapList> }` to `src/shared/ipc.ts` (map + invoke list), schema
  `installationsListMapsSchema` in `src/shared/ipc-schemas.ts` (`installationId` non-empty string;
  `gameDir` `''` or `isSafeGameName` from `@shared/mods/server-local-content`), handler in
  `src/main/ipc/installations.ts` mirroring the mods module's `mapsList` handler
  (`src/main/modules/mods/index.ts`): root and engine kind from `app.installations.find(id)` — never from
  the payload — an unknown id fails with this file's existing installation-not-found key; zip deps from
  `resolveVendoredExtractor(app.isPackaged)` (`src/main/services/package-staging.ts`). Keep the IPC
  coverage test green. Tests: `src/main/services/map-list.test.ts` (moved, all green);
  `src/main/ipc/installations.test.ts` › "installations:listMaps lists the maps of the installation's mod",
  "installations:listMaps refuses an unknown installation"; `src/shared/ipc-schemas.test.ts` › "listMaps
  refuses an unsafe game dir".
- **D2 — The installation carries a saved map; a map launch is always deathmatch.**
  `src/shared/types/installation.ts` (`Installation.activeMap: string` — `''` = no map — next to
  `activeGameDir`; `UpdateInstallationInput.activeMap?: string`), `src/main/lib/schemas.ts` (persisted
  `activeMap`, missing or not a safe game name reads as `''`), `src/shared/ipc-schemas.ts`
  (`updateInstallationInputSchema.activeMap`: `''` or `isSafeGameName`, optional; `launchInputSchema` loses
  `gameType`), `src/main/services/installations.ts` (new records `activeMap: ''` at both creation sites;
  `update` patches `activeMap`; the revalidation that clears a vanished `activeGameDir` also sets
  `activeMap = ''`), `src/shared/types/launch.ts` (remove `LaunchInput.gameType`),
  `src/main/services/launch-plan.ts` (`buildLaunchArgs` drops `gameType` from its `Pick`; a safe map always
  pushes `'+set','deathmatch','1'`), the installation builder under `src/test-support/` if it lists fields
  (`activeMap: ''`). Tests: `src/main/services/launch-plan.test.ts` › "a map launch sets deathmatch 1 and
  loads the map last" (adapt the existing one), "without a map the command line is unchanged" (keep);
  delete "single player sets deathmatch 0"; `src/main/services/installations.test.ts` › "update stores
  activeMap", "a revalidation that clears the game dir clears the map"; `src/main/lib/schemas.test.ts` › "a
  stored installation without activeMap reads as no map"; `src/shared/ipc-schemas.test.ts` › "installation
  update accepts an empty or safe activeMap and refuses an unsafe one";
  `src/main/modules/replays/demo-play.test.ts` › "demo playback never passes the saved map" (installation
  with `activeMap: 'q2dm1'`; the planned args carry no `+map` and no `deathmatch`).
- **D3 — The footer's Map select, and plain Play starts in the saved map.**
  `src/renderer/src/components/shell/ActionBar.tsx`: a `MapSelect` beside `GameDirSelect` (same row and
  styling: `stencil` label `common.label.map`, `Select` `h-6 w-44 py-0 text-xs`,
  `data-testid="actionbar-map"`); rendered when an installation is selected and the route is not
  `/servers` or `/replays` — reuse the route condition story 251 put on `GameDirSelect`, but do not hide the
  Map select when the installation has no mods. Options: `{ value: '', label: t('actionbar.map.none') }`
  first, then the `installations:listMaps` result for `installation.activeGameDir`, label `name — title`
  or `name`, in the order main returns. Fetch on installation id / `activeGameDir` change and discard a
  stale answer; disabled while loading. If a successful list lacks a non-empty `activeMap`, call
  `updateInstallation({ id, activeMap: '' })`; on a failed list keep it. `GameDirSelect`'s `onChange`
  becomes: list the new dir's maps, then **one** `updateInstallation({ id, activeGameDir, activeMap })`
  with `activeMap` kept iff listed, else `''`. Remove the `DEV_MODULES` "Play with…" button
  (`actionbar-play-with`) and `canPlay` if it becomes unused. `src/renderer/src/store/useLauncher.ts`:
  `play`'s options lose `gameDir`/`map`/`gameType`; called with `options === undefined` it looks the
  installation up in state and adds `map: activeMap` if non-empty (plain Play only — a join always passes
  options). `src/renderer/src/i18n/locales/en.shell.json` (`actionbar.map.none` "No map"; remove
  `actionbar.playWith`) and the i18n bundle snapshot. Add `data-testid="rail-play"` to the rail hover
  card's Play (`components/shell/InstallationRail.tsx`) and `data-testid="library-play"` to the Library
  card's Play (`views/LibraryView.tsx`). Tests: `src/renderer/src/components/shell/ActionBar.test.tsx` › "a
  release build shows the Map select" (`vi.mock('@shared/dev-modules', …)` with `DEV_MODULES: false`),
  "the Map select is hidden on Servers and Demos", "the Map select shows without mods", "switching Launch
  with to a mod without the map writes the game dir and No map in one update", "a loaded list without the
  saved map clears it"; new `src/renderer/src/store/useLauncher.play.test.ts` › "plain Play passes the
  saved map", "plain Play without a saved map passes none", "a join never carries the saved map".
- **D4 — The dev-only Play with… dialog is gone.** Delete
  `src/renderer/src/modules/mods/components/PlayWithDialog.tsx` + `.test.tsx` and
  `src/renderer/src/modules/mods/Dialogs.tsx`; drop `Dialogs` from the mods entry in
  `src/renderer/src/modules/index.ts`; remove `listMaps`, `getLastLaunch`, `rememberLastLaunch` from
  `src/renderer/src/modules/mods/client.ts` and the `playWith.*` strings from
  `src/renderer/src/modules/mods/locale/en.json`; remove handlers `mapsList`, `lastLaunchGet`,
  `lastLaunchRemember`, their schemas and `ModMapList` / `ModLastLaunch` / `modLastLaunchSchema` from
  `src/shared/modules/mods.ts` and `src/main/modules/mods/index.ts`; remove `readLastLaunch` /
  `withLastLaunch` from `src/main/modules/mods/install-records.ts` (keep `withRecords`, which still keeps
  unknown envelope keys) and their tests in `install-record.test.ts`, `index.test.ts`, and turn
  `remove-job.test.ts` › "removing a mod keeps the remembered launch" into "removing a mod keeps an unknown
  envelope key"; delete `scripts/flows/play-with.mjs`. Update `docs/systems/mods-module.md` (no play-with
  dialog, no `lastLaunch`, no map listing — it now lives in `src/main/services/map-list.ts`; `map.presence`
  stays). Tests: `npx vitest run src/main/modules/mods src/renderer/src/modules/mods` green, i18n bundle
  snapshot regenerated, `src/architecture.test.ts` green.
- **D5 — The footer map, proven end to end.** New `scripts/flows/footer-map.mjs` (mirror the deleted
  `play-with.mjs` for skip-loudly, `nextLaunchLine` and `main.log` reading; mirror
  `scripts/flows/servers-actionbar-join.mjs` for the loopback responder and the Join); extend
  `writePlayWithFixture` in `scripts/lib/fixture/installations.mjs` with an optional `servers` slice passed
  to `seedJoinStyleFixture` (one loopback server, `gamename` baseq2, no password; responder bound in the
  flow). Persistence is read from `state.json` on disk (precedent: `servers-scan-settings.mjs`).
  `CHANGELOG.md`: one `### Added` line under Unreleased ("Pick a map in the footer — Play starts a
  deathmatch in it"), replacing an Unreleased "Play with…" line if one exists. Tests: the flow steps in
  `## Acceptance Tests`.

## Model Hints

- D3 → deliverable-hard — the plain-Play rule changes `useLauncher.play`, which footer, rail, Library card
  and the join flow all call, and the mod change must write game dir and map atomically against an async
  listing (stale answers, failed listings) — a wrong cut leaks the map into a join or launches a map the new
  mod does not have.

Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/footer-map.mjs` › step "AC1: the footer shows a Map select on Home and
  Library"; unit `src/renderer/src/components/shell/ActionBar.test.tsx` › "a release build shows the Map
  select", "the Map select shows without mods"
- AC2 → e2e `scripts/flows/footer-map.mjs` › step "AC2: no Map select on Servers and Demos"; unit
  `src/renderer/src/components/shell/ActionBar.test.tsx` › "the Map select is hidden on Servers and Demos"
- AC3 → e2e `scripts/flows/footer-map.mjs` › step "AC3: the map list follows the mod and is sorted" (first
  option "No map"; ctf: base1, ctf1, q2dm1 "The Edge"; Base game: base1, q2dm1; `bad name` absent); unit
  `src/main/services/map-list.test.ts` (moved suite); `src/main/ipc/installations.test.ts` ›
  "installations:listMaps lists the maps of the installation's mod", "installations:listMaps refuses an
  unknown installation"; `src/shared/ipc-schemas.test.ts` › "listMaps refuses an unsafe game dir"
- AC4 → e2e `scripts/flows/footer-map.mjs` › step "AC4: Play with a map starts a deathmatch in it"
  (launching line contains `+set game ctf +set deathmatch 1` and ends `+map ctf1`); unit
  `src/main/services/launch-plan.test.ts` › "a map launch sets deathmatch 1 and loads the map last";
  `src/renderer/src/store/useLauncher.play.test.ts` › "plain Play passes the saved map"
- AC5 → e2e `scripts/flows/footer-map.mjs` › step "AC5: No map starts at the menu" (no `+map`, no
  `deathmatch`); unit `src/main/services/launch-plan.test.ts` › "without a map the command line is
  unchanged"; `src/renderer/src/store/useLauncher.play.test.ts` › "plain Play without a saved map passes
  none"
- AC6 → e2e `scripts/flows/footer-map.mjs` › step "AC6: the map is saved and the rail and Library card
  start in it" (`state.json` holds `activeMap: "ctf1"`; `library-play` and `rail-play` launching lines end
  `+map ctf1`); unit `src/main/services/installations.test.ts` › "update stores activeMap";
  `src/main/lib/schemas.persisted-state.test.ts` › "a stored installation without activeMap reads as no map";
  `src/shared/ipc-schemas.test.ts` › "installation update accepts an empty or safe activeMap and refuses an
  unsafe one"
- AC7 → e2e `scripts/flows/footer-map.mjs` › step "AC7: switching to a mod without the map resets it"
  (ctf1 chosen under ctf, Launch with → Base game: Map select reads "No map", `state.json` `activeMap: ""`);
  unit `src/renderer/src/components/shell/ActionBar.test.tsx` › "switching Launch with to a mod without the
  map writes the game dir and No map in one update", "a loaded list without the saved map clears it";
  `src/main/services/installations.test.ts` › "a revalidation that clears the game dir clears the map"
- AC8 → e2e `scripts/flows/footer-map.mjs` › step "AC8: a server join never passes the saved map" (q2dm1
  saved, Join on the loopback server: the launching line has `+connect`, no `+map`, no `deathmatch`); unit
  `src/renderer/src/store/useLauncher.play.test.ts` › "a join never carries the saved map";
  `src/main/modules/replays/demo-play.test.ts` › "demo playback never passes the saved map";
  `src/shared/ipc-schemas.test.ts` › "launch input refuses map together with connect" (existing)

Coverage: AC1 D3+D5 · AC2 D3+D5 · AC3 D1+D3+D5 · AC4 D2+D3+D5 · AC5 D2+D3+D5 · AC6 D2+D3+D5 · AC7 D2+D3+D5
· AC8 D2+D3+D5. D4 carries the cut decision to remove the dialog; no AC of its own.

## Done

Core map listing moved out of the dev-only mods module (`installations:listMaps`, `src/main/services/map-list.ts`); the installation
carries `activeMap`; the footer has a Map select beside "Launch with" (hidden on Servers/Demos); plain Play adds the saved map in the
renderer store; a map launch is always `+set deathmatch 1`; the dev "Play with…" dialog, its `lastLaunch` storage and flow are gone.
Flow `footer-map.mjs` proves AC1–AC8 end to end.

Commit message: `252: footer Map select — Play starts a deathmatch in the saved map; Play with… dialog removed`

Verification (narrow gate): build, lint, typecheck green; `npx vitest run --changed HEAD` green (320 files, 3838 tests); e2e
`npm run ui:flows -- --affected scripts/flows/footer-map.mjs --parallel=4 --shard=1/2|2/2` ran 157 flows; the first pass was red on 15
mods flows only because the verify agent's release `npm run build` replaced the dev bundle — after `build:dev` all 15 were green.
After the review fix: typecheck, lint, vitest --changed and flows footer-map, launch-with-scope, servers-actionbar-join,
action-bar-view green. AC → test mapping as verified: every AC1–AC8 test in `## Acceptance Tests` ran and passed (flow steps AC1–AC8
printed by footer-map); the AC6 schema test lives in `src/main/lib/schemas.persisted-state.test.ts` (mapping corrected). Review 1
(default): PASS. No manual residue.

Decisions:

- A failed mod-switch listing writes the new `activeGameDir` with `activeMap: ''` (never keep a map the new mod may lack).
- Review finding fixed: MapSelect only clears a saved map from a listing read on a playable (`ok`/`warning`) installation, because
  `listNames` turns an unreadable root into an empty successful list; `footer-map` and `launch-with-scope` added to the `shell-window`
  area in `scripts/flows/areas.json`; `docs/DEV-MODULES.md` lost its Play-with lines.
- Unfixed by choice: (1) the map list is fetched once per id + `activeGameDir`, not refreshed on root/engine change or newly installed
  maps; (2) during a mod-switch listing the Map select still shows the previous mod's list — a pick there is re-filtered against the new
  list after the await, so AC7 holds; (3) `footer-map.mjs` repeats the servers `scan` fixture block and responder helper like its siblings.
- `PlayWithDialog` compile cast added in D3 vanished with D4; the "No map" i18n duplicate exception was added and removed again.
- `docs/concepts/mods.md` / `demo-browser.md` still mention the old dialog (concept docs, left as history).

tiers: D 5 / hard 1 · review default · cycles 1 · agents 10

Gate regression (S35): bare `locator('select')` in the unsaved-diff flow and the config-save screens resolved to the footer Map select, and a comment carried a non-trailing story pointer; fixed in the flow/screens by scoping to the Raw tab toolbar, comment and areas.json rows (footer-map, game-dir-fs, map-list) corrected.
