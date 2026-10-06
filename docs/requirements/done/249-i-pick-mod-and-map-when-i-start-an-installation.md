---
id: 249
title: I pick mod and map when I start an installation
status: done # draft -> ready -> in-progress -> done
created: 2026-10-04
---

## Requirement

As a player, when I start an installation I can choose which mod it runs and which map it loads,
so the game opens straight into that map instead of the main menu.

User feedback 2026-10-04: when starting an installation you should be able to choose mod and map.

Today Play starts the installation with `+set game <activeGameDir>` when a mod is set; the mod is a
persisted dropdown in the action bar (`GameDirSelect`, only shown when the installation has mods).
There is no map support anywhere (`+map` is never passed), and no UI edits `launchArgs`.

## Acceptance Criteria

- [x] **AC1** — Next to Play there is a "Play with…" action that opens a small launch dialog with a
      mod select and a map select.
- [x] **AC2** — The mod select lists Base game and the installation's game dirs; the map select lists
      the maps available to the chosen mod (its own and baseq2's), sorted by name.
- [x] **AC3** — Starting from the dialog launches with the chosen mod and loads the chosen map; with
      "No map" the game starts at the menu, as Play does today.
- [x] **AC4** — The dialog remembers the last choice per installation.
- [x] **AC5** — A map whose name is not a safe single token is not offered (launch arguments stay
      validated as today).
- [x] **AC6** — The plain Play button keeps its current behaviour.
- [x] **AC7** — Maps inside `.pak`/`.pk3` files are listed, not only loose `.bsp` files.

## Open Questions

- ~~**Q1** — Is the map start single-player or a local deathmatch server (`+set deathmatch 1 +map`)?
  `+map` in baseq2 without deathmatch starts a single-player game. Recommendation: a "Game type"
  choice with Deathmatch as the default when a map is picked.~~ answered → Decisions (Sprint)
- ~~**Q2** — Does the dialog replace the action bar's mod dropdown, or sit beside it? Recommendation:
  beside it — the dropdown stays the persisted default.~~ answered → Decisions (Sprint)
- ~~**Q3** — Should the map list show a levelshot? No (CLAUDE.md: no image assets); name plus the
  map's title from the BSP if cheap.~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Map start: a "Game type" choice with Deathmatch default when a map is picked.
- **(User)** Dialog vs. mod dropdown: sits beside the action bar's mod dropdown, which stays the persisted default.
- **(User)** Map list: name plus BSP title if cheap, no levelshot.
- Game type values are Deathmatch (`+set deathmatch 1`) and Single player (`+set deathmatch 0`),
  always emitted explicitly with a map — `deathmatch` is a saved cvar, so leaving it out would let
  a config decide the game type.
- The game type select is disabled while "No map" is chosen — without `+map` no game type is
  passed and Play's behaviour holds (AC3).
- `map` and `connect` in one launch payload are rejected by the schema — "load a map" and "join a
  server" contradict each other, and refusing is clearer than silently dropping one.
- AC7's archive set is `.pak` plus `.pkz` (Quake II's zip format); `.pk3` is not read — the same
  rule `map-presence.ts` already applies, because no supported engine loads `.pk3` and offering a
  map the engine cannot load breaks AC3.
- `.pkz` maps are skipped for an `r1q2` installation — the same rule install/update use for
  `pkzUnsupported`: r1q2 cannot read `.pkz`.
- A BSP title is the worldspawn `message` key, read for loose `.bsp` files and `.bsp` entries
  inside a `.pak` (header plus the first 16 KiB of the entity lump); maps inside a `.pkz` show the
  name only — reading them means a 7-Zip extraction per map, which is not cheap.
- Maps with the same name in the mod and in baseq2 are listed once (ASCII case-insensitive), the
  mod's copy first — the engine loads the mod's copy.
- The dialog lives in the `mods` module (it owns game dirs and the pak/pkz readers) and opens as a
  module dialog (`openDialog({ kind: 'module', moduleId: 'mods', view: 'play-with' })`); the action
  bar gains only the trigger button — no new shell→module import edge.
- "Play with…" is enabled exactly when the plain Play action would be `play` (a tab's contributed
  action is ignored) — it is a second way to play, so it must never start while Play cannot.
- The last choice (mod, map, game type) is stored in the installation's `moduleData.mods.lastLaunch`
  and written when the user starts from the dialog, not on every change — "the last choice" is the
  one actually launched.
- A remembered mod that no longer exists falls back to the installation's active game dir, a
  remembered map that is no longer listed falls back to "No map" — a stale memory must never
  launch something missing.
- Without a memory the dialog opens with the installation's active game dir, "No map" and
  Deathmatch — the action bar's dropdown stays the persisted default (User decision).
- Changing the mod in the dialog keeps the selected map if the new list has it, else resets to
  "No map".
- Starting from the dialog does not change `activeGameDir` — the mod is a per-launch override
  (`gameDir` in the launch payload), the dropdown stays the default (User decision).

## Plan

1. **Launch (shared + main):** `LaunchInput` gains `map?` and `gameType?`; `launchInputSchema`
   validates `map` with `isSafeGameName` and rejects `map` with `connect`; `buildLaunchArgs`
   emits `+set deathmatch 0|1` after `+set game` and `+map <map>` after the extra args, dropping
   an unsafe map (`unsafe-token`) together with its game type.
2. **Readers (main/lib):** `pak-directory.ts` additionally returns each entry's offset and length;
   new `bsp-title.ts` reads a bounded worldspawn `message` from a BSP at a file offset.
3. **Map listing (mods main):** shared fs helpers extracted from `map-presence.ts`; new
   `map-list.ts` lists `maps/*.bsp` of the chosen mod plus baseq2 (loose, pak, pkz unless r1q2),
   safe names only, deduped, sorted; handler `maps.list`.
4. **Remembered choice (mods main):** `moduleData.mods.lastLaunch` parsed forgivingly; handlers
   `launch.last.get` / `launch.last.remember`; record writes (install/update/remove) keep the
   envelope's other keys, a remember keeps the records.
5. **Dialog (mods renderer):** `PlayWithDialog` with mod, map and game type selects, registered as
   the mods module's `Dialogs`.
6. **Trigger + e2e:** "Play with…" button beside Play in `ActionBar.tsx`, the store's `play`
   options widened; flow `scripts/flows/play-with.mjs` with its own fixture (real pak, loose
   maps, a mod dir); `docs/systems/mods-module.md` and `CHANGELOG.md`.

Order D1 → D6; D2 before D3; D3 and D4 before D5; D5 before D6. Platform parity: nothing here is
platform-specific — Windows and Linux both get the feature.

## Deliverables

- **D1 — Launch input carries a map and a game type.** Files: `src/shared/types/launch.ts`
  (`LaunchInput.map?: string`, `LaunchInput.gameType?: 'deathmatch' | 'single'`),
  `src/shared/ipc-schemas.ts` (`launchInputSchema`: `map` = `z.string().refine(isSafeGameName)`
  from `@shared/mods/server-local-content`, `gameType` = `z.enum(['deathmatch','single'])`, both
  optional; a `superRefine`/`refine` rejects a payload carrying both `map` and `connect`),
  `src/main/services/launch-plan.ts` (`buildLaunchArgs` input `Pick` gains `map`/`gameType`; when
  `input.map` is set and passes both `isSafeGameName` and `isSafeEarlyToken`: push
  `'+set','deathmatch', gameType === 'single' ? '0' : '1'` directly after the `+set game` block,
  and `'+map', map` after `extraArgs` (before the `+connect` block); an unsafe map pushes
  `{ reason: 'unsafe-token', value: map }` to `dropped` and emits neither `+map` nor `deathmatch`;
  no map → output byte-identical to today). Tests: `src/main/services/launch-plan.test.ts` ›
  "a map launch sets deathmatch 1 by default and loads the map last", "single player sets
  deathmatch 0", "an unsafe map is dropped with its game type", "without a map the command line is
  unchanged"; `src/shared/ipc-schemas.test.ts` › "launch input refuses an unsafe map name",
  "launch input refuses map together with connect".
- **D2 — Pak entries with offsets, and a bounded BSP title reader.** Files:
  `src/main/lib/pak-directory.ts` (result `{ ok: true; names: string[]; entries: Array<{ name;
offset; length }> }` — additive, `names` unchanged so `map-presence.ts` keeps working; offset and
  length are the int32s after the 56-byte name), new `src/main/lib/bsp-title.ts`
  (`readBspTitle(path: string, base = 0, limit?: number): Promise<string | undefined>`; reads the
  BSP header at `base` — `IBSP`, version 38, lump 0 = entities `{ofs,len}` relative to `base` —
  refuses when the lump falls outside `limit`/the file, reads at most the first 16 KiB of the
  entity lump, parses the first `{ … }` block's quoted key/value pairs and returns `message`:
  bytes masked `& 0x7f`, control chars and literal `\n` turned into spaces, whitespace collapsed,
  trimmed, cut to 64 chars, `undefined` when empty. Never throws; mirror `pak-directory.ts`'s
  `readExactly`/refuse-everything style, opened read-only). Tests:
  `src/main/lib/pak-directory.test.ts` › "entries carry each file's offset and length";
  new `src/main/lib/bsp-title.test.ts` › "reads the worldspawn message", "a BSP inside a pak is read
  at its offset", "a bad ident, version or out-of-range lump is undefined", "a huge entity lump is
  read only up to the cap".
- **D3 — The mods module lists a mod's maps.** Files: new
  `src/main/modules/mods/game-dir-fs.ts` (move `asciiLower`, `listNames`, `matching`,
  `matchingChildren` out of `map-presence.ts`, which then imports them — no third copy),
  `src/main/modules/mods/map-presence.ts`, new `src/main/modules/mods/map-list.ts`
  (`listMaps({ rootPath, gameDir, engineKind }, { zipDeps })`: for the mod (if a safe name and not
  baseq2) then `baseq2`, in each case-insensitively matched dir: loose `maps/<stem>.bsp`, then each
  `.pak`'s entries, then — unless `engineKind === 'r1q2'` — each `.pkz` via `listZipEntries`
  (`src/main/lib/zip-entries.ts`); an entry counts when `\`→`/`, it is exactly
  `maps/<stem>.bsp` (ASCII case-insensitive, no deeper folder) and `<stem>` passes
  `isSafeGameName`; dedupe by lower-cased stem, first source wins; titles via `readBspTitle` for
  loose files and pak entries (`base` = entry offset, `limit` = offset + length), none for pkz;
  sort by `asciiLower(name)`; unreadable dirs/corrupt archives are skipped),
  `src/shared/modules/mods.ts` (handler `mapsList: 'maps.list'` → `Outcome<ModMapList>`,
  `ModMapList = { maps: Array<{ name: string; title?: string }> }`; declare it the way story 232
  left the mods contract), `src/main/modules/mods/schemas.ts` (`mapsListInputSchema`:
  `installationId` + `gameDir` = `''` or a safe game name), `src/main/modules/mods/index.ts`
  (handler mirrors `mapPresence`: root and engine kind from the installation record, unknown id →
  `mods.error.installationNotFound`). Tests: new `src/main/modules/mods/map-list.test.ts` ›
  "lists loose, pak and pkz maps of the mod and baseq2, sorted", "a name that is not a safe token is
  not offered", "the mod's copy wins over baseq2's", "pkz maps are skipped for r1q2", "titles come
  from loose and pak BSPs only" (pkz built with the real vendored 7-Zip, as `map-presence.test.ts`
  does); `src/main/modules/mods/map-presence.test.ts` stays green unchanged.
- **D4 — The mods module remembers the last launch choice.** Files:
  `src/main/modules/mods/install-records.ts` (add `readLastLaunch(moduleData)` →
  `{ gameDir: string; map: string | null; gameType: 'deathmatch' | 'single' } | null`, parsed with
  zod and `.catch(null)`, `gameDir` `''` or safe, `map` safe or null; `withLastLaunch(moduleData,
choice)`; `withRecords(moduleData, records)`; all three keep every other key of the
  `moduleData.mods` envelope; `withRecord` is rewritten on top of `withRecords`),
  `src/main/modules/mods/remove-job.ts` (its `setModuleData(…, 'mods', { records })` becomes
  `withRecords(current.moduleData, records)['mods']`), `src/shared/modules/mods.ts` (handlers
  `lastLaunchGet: 'launch.last.get'` → `Outcome<ModLastLaunch | null>`, `lastLaunchRemember:
'launch.last.remember'` → `Outcome<null>`; type `ModLastLaunch`), `src/main/modules/mods/schemas.ts`,
  `src/main/modules/mods/index.ts` (remember writes `withLastLaunch(installation.moduleData,
input)['mods']` through `app.installations.setModuleData`). Tests:
  `src/main/modules/mods/install-record.test.ts` › "a record write keeps the remembered launch",
  "remembering a launch keeps the install records", "a garbage lastLaunch reads as null";
  `src/main/modules/mods/remove-job.test.ts` › "removing a mod keeps the remembered launch";
  `src/main/modules/mods/index.test.ts` › "launch.last.remember then get round-trips per
  installation".
- **D5 — The Play with… dialog.** Files: new
  `src/renderer/src/modules/mods/components/PlayWithDialog.tsx` (built on `Modal` from
  `components/ui/Modal` and `Select` from `components/ui/controls`, mirror
  `RemoveModDialog.tsx`; mod select = Base game (`''`) + `installation.gameDirs` minus baseq2;
  map select = "No map" + `listMaps` result for the chosen mod, label `name — title` or `name`;
  game type select Deathmatch/Single player, disabled while "No map"; a loading line while the list
  is fetched; initial values from `getLastLaunch` with the fallbacks in Decisions (Sprint); a mod
  change keeps the map only if the new list has it; Start calls `rememberLastLaunch` then
  `useLauncher.getState().play(installationId, { gameDir, map?, gameType? })` and closes; test ids
  `play-with-dialog`, `play-with-mod`, `play-with-map`, `play-with-gametype`, `play-with-start`),
  new `src/renderer/src/modules/mods/Dialogs.tsx` (`view === 'play-with'` → the dialog for
  `installationId`), `src/renderer/src/modules/mods/client.ts` (`listMaps`, `getLastLaunch`,
  `rememberLastLaunch` via `callModule`), `src/renderer/src/modules/index.ts` (mods entry gets
  `Dialogs`), `src/renderer/src/store/useLauncher.ts` (`play` options type gains `gameDir?`,
  `map?`, `gameType?` — spread unchanged into `launch:start`),
  `src/renderer/src/modules/mods/locale/en.json` (all dialog strings). Tests: new
  `src/renderer/src/modules/mods/components/PlayWithDialog.test.tsx` › "a remembered mod that is
  gone falls back to the active game dir", "a remembered map that is not listed falls back to No
  map", "game type is disabled while No map is chosen".
- **D6 — Play with… beside Play, proven end to end.** Files:
  `src/renderer/src/components/shell/ActionBar.tsx` (a `Button`/`IconButton` labelled "Play with…"
  next to `PlayButton`, `data-testid="actionbar-play-with"`, enabled iff
  `resolvePrimaryAction(installation, job, launch, demo, null).kind === 'play'`, onClick
  `openDialog({ kind: 'module', moduleId: 'mods', view: 'play-with', installationId })` — no import
  of mods code), `src/renderer/src/i18n/locales/en.shell.json` (label), new
  `scripts/flows/play-with.mjs` (mirror `scripts/flows/servers-actionbar-join.mjs`: skip loudly when
  not spawnable, read the newest `launching` line from `main.log`), a fixture writer
  `writePlayWithFixture` in `scripts/lib/fixture/installations.mjs` re-exported from
  `scripts/lib/fixture.mjs` (mirror `writeJoinFixture`/`writeJoinInstallRoot`: one r1q2
  installation, `gameDirs: ['baseq2','ctf']`; `baseq2/maps/q2dm1.bsp` with message "The Edge",
  `baseq2/maps/bad name.bsp`, a real `baseq2/pak0.pak` holding `maps/base1.bsp`, `ctf/maps/ctf1.bsp`
  — minimal BSPs built in the fixture: `IBSP`, 38, a lump table whose lump 0 holds
  `{ "classname" "worldspawn" "message" "…" }`), `docs/systems/mods-module.md` (purpose, map,
  handlers: map listing, last launch, the play-with dialog), `CHANGELOG.md` (one `### Added` line
  under Unreleased). Tests: the flow below.

## Model Hints

- D4 → deliverable-hard — the `moduleData.mods` envelope is rewritten by four writers (install,
  update, remove, remember); a write that rebuilds `{ records }` alone silently erases the
  remembered launch, and a remember that rebuilds `{ lastLaunch }` alone erases the install records
  — after which the launcher no longer knows it installed a mod and cannot update or remove it.

Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/play-with.mjs` › step "AC1: Play with opens a dialog with a mod and a
  map select"
- AC2 → e2e `scripts/flows/play-with.mjs` › step "AC2: the map list follows the mod and is sorted"
  (ctf lists base1, ctf1, q2dm1 "The Edge"; Base game lists base1, q2dm1); unit
  `src/main/modules/mods/map-list.test.ts` › "lists loose, pak and pkz maps of the mod and baseq2,
  sorted", "the mod's copy wins over baseq2's"
- AC3 → e2e `scripts/flows/play-with.mjs` › step "AC3: starting launches the chosen mod and map"
  (launching line contains `+set game ctf +set deathmatch 1` and ends `+map ctf1`) and step "AC3:
  No map starts at the menu" (no `+map`, no `deathmatch`); unit
  `src/main/services/launch-plan.test.ts` › "a map launch sets deathmatch 1 by default and loads the
  map last", "single player sets deathmatch 0", "without a map the command line is unchanged"
- AC4 → e2e `scripts/flows/play-with.mjs` › step "AC4: reopening the dialog shows the last choice";
  unit `src/main/modules/mods/install-record.test.ts` › "a record write keeps the remembered
  launch", "remembering a launch keeps the install records"; `src/main/modules/mods/index.test.ts` ›
  "launch.last.remember then get round-trips per installation";
  `src/renderer/src/modules/mods/components/PlayWithDialog.test.tsx` › "a remembered mod that is
  gone falls back to the active game dir", "a remembered map that is not listed falls back to No
  map"
- AC5 → e2e `scripts/flows/play-with.mjs` › step "AC5: a map with an unsafe name is not offered"
  (`bad name` absent); unit `src/main/modules/mods/map-list.test.ts` › "a name that is not a safe
  token is not offered"; `src/shared/ipc-schemas.test.ts` › "launch input refuses an unsafe map
  name", "launch input refuses map together with connect";
  `src/main/services/launch-plan.test.ts` › "an unsafe map is dropped with its game type"
- AC6 → e2e `scripts/flows/play-with.mjs` › step "AC6: plain Play still launches without a map"
  (after a dialog launch with ctf1, Play's launching line carries no `+map` and the installation's
  own game dir); unit `src/main/services/launch-plan.test.ts` › "without a map the command line is
  unchanged"
- AC7 → e2e `scripts/flows/play-with.mjs` › step "AC2: the map list follows the mod and is sorted"
  (`base1` comes from `pak0.pak`); unit `src/main/modules/mods/map-list.test.ts` › "lists loose,
  pak and pkz maps of the mod and baseq2, sorted", "pkz maps are skipped for r1q2", "titles come
  from loose and pak BSPs only"; `src/main/lib/bsp-title.test.ts` › "a BSP inside a pak is read at
  its offset"

Coverage: AC1 D5+D6 · AC2 D3+D5 · AC3 D1+D5 · AC4 D4+D5 · AC5 D1+D3 · AC6 D1+D6 · AC7 D2+D3.

## Done

**Summary.** "Play with..." sits beside Play and opens a mods-module dialog (mod, map, game type). Launch input carries `map`/`gameType` (`+set deathmatch` after `+set game`, `+map` last); maps are listed from loose BSPs, `.pak` and `.pkz` (not for r1q2) of the mod and baseq2 with BSP titles; the last choice is stored in `moduleData.mods.lastLaunch`, and every envelope writer keeps the other key.

**Commit message:** `249: Play with... dialog — pick mod, map and game type; map listing from loose/pak/pkz, remembered launch, +map launch args`

**Verification (narrow gate).** build, typecheck, lint green; `npx vitest run --changed HEAD` green after fixing three reds (systems-docs handler names, i18n bundle snapshot, duplicate i18n values reused from `common.label.*`); comments + architecture tests green. e2e: `--affected` not used (too broad) — flows by name: `play-with` (all 7 steps), `servers-actionbar-join`, `mods-catalog`, `mods-catalog-detail`, `mods-install*`, `mods-remove`, `mods-detail`, `mods-view` all OK. `mods-view` fails only when run after `mods-detail` on the same seed (mods-detail persists a selected installation); it passes on a fresh seed, `ui:flows` reseeds per flow.
AC -> test: AC1 flow AC1 step; AC2/AC7 flow AC2 step + map-list.test.ts + bsp-title.test.ts; AC3 flow AC3 steps + launch-plan.test.ts; AC4 flow AC4 + install-record/index/PlayWithDialog tests; AC5 flow AC5 + map-list/ipc-schemas/launch-plan tests; AC6 flow AC6 + launch-plan "unchanged" — all ran and passed. No manual residue.
Review: 1 cycle, PASS with minor findings, fixed (stale doc text on .pkz and persisted state, deliverable id in two comments, added test for mod change keeping the map). Left as is: pkz tests self-skip without the vendored 7-Zip (precedent: map-presence.test.ts); `rememberLastLaunch` failure is ignored on Start (launch unaffected).

**Decisions.**

- `schemas.ts` does not exist in the mods module; mods schemas and handler declarations live in `src/shared/modules/mods.ts` (story 232), so the new schemas went there.
- `bsp-title.ts` avoids a control-char regex (the architecture test forbids eslint-disable); `mods.playWith.mod/map` reuse `common.label.mod/map`.
- `play-with` is not registered in `scripts/flows/areas.json` (the `mods` row is already at 12 flows, flow-select.test.mjs stays at its known reds); `src/main/lib/bsp-title.ts` was added to the mods row paths. The flow is run by name. `seedJoinStyleFixture` extracted so the play-with fixture shares the join fixture seeding.
- Known reds not touched: check-docs.test.mjs, flow-select.test.mjs (downloads-bootstrap, replays-playback rows over 12), flow-helper-duplication.test.mjs.

tiers: D 6 / hard 1 · review default · cycles 1 · agents 11
