# Sprint S34 — review

## Overview

Goal: the five open codebase-health drafts from the S32 review are closed (typed module handlers, a flow gate
without quarantine, release verification before a merge to main, shutdown/store/job edge cases, no known holes in
the layer and error-key rules), and the demo browser, the add-installation flow and the server browser carry the
refinements from the latest user feedback. All 19 stories are done on `sprint/S34`; story 234 (the real rehearsal)
finished after the sprint review and the gate (see Regression gate). The merge into `dev` is the user's decision (see
Blocked / open).

| Story                               | Status | Commit                                                                                                               |
| ----------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| 232 typed module handlers           | done   | a4ebaba `defineModule` + `createModuleClient` for library/mods/downloads/config/replays; 7152267 comment-rule fix    |
| 236 layer and error-key holes       | done   | fd0773c electron-backed edges, builtin list, literal key records, comment paths, unlock feature fallback             |
| 235 shutdown, store, job edges      | done   | 32165ac cinema dispose, required migrations, `setEngineState`, `commitAdoption` failure, race + quitAndInstall pins  |
| 233 flow gate without quarantine    | done   | b00cee1 empty quarantine, `--repeat`, fixture-owned downloads cache, `--affected` selection                          |
| 234 release verification, rehearse  | done   | b547f37 D1 detached `npm run rehearse` runner, D3 note; real rehearsal PASSED 2026-10-06, 20 Linux flows quarantined |
| 245 players by team                 | done   | e192187 roster from the dm2 frame pass, OpenTDM + CTF, spectators group                                              |
| 243 detail edited in place          | done   | f3e9724 queued fresh-read edits, `InPlaceField`, `SidesField`                                                        |
| 242 demos in folders                | done   | 271d56d recursive discovery, folder view + breadcrumb, search across folders, create/rename folder, drag-move        |
| 238 list scoped to installation     | done   | 7510b37 `reachedBy`, "All installations" toggle, empty states, `demoFolders.read`                                    |
| 244 select several demos            | done   | f208e0a multi-select, bulk delete/tag/move, folder delete, row context menu                                          |
| 241 comment a moment                | done   | 541bd55 sidecar comments, detail list, timeline marks, play from here                                                |
| 237 demo volume slider              | done   | 9260377 slider + mute, coalesced `s_volume`, restored after the session, remembered level                            |
| 239 one add-installation flow       | done   | c278482 shared entry list, wizard names the installation, empty-create removed                                       |
| 240 install folder shown first      | done   | 1079255 `bootstrap.proposeTarget`, subfolder + free name, install-here, job mkdir + empty-root cleanup               |
| 249 pick mod and map                | done   | d1d0aa5 "Play with..." dialog, map listing from loose/pak/pkz, remembered launch, `+map` args                        |
| 246 choose an engine                | done   | eb7f7e4 inspector lists all engines, chosen engine persisted, Engine chips, demos play with a detected Q2PRO         |
| 247 maximum ping filter             | done   | ad581fd `maxPingMs` in filter + quick filters, Max ping select                                                       |
| 250 scan only what the filter shows | done   | 489ad6d `addresses` scan scope, "Refresh N shown" + Scan all menu                                                    |
| 248 several mods at once            | done   | dc6fa0d `MultiSelect` primitive, mod/map as sets, legacy quick filters load as a set of one                          |

Also on the branch: `d73d2ff` (the regression fixes found by the gate, see Regression gate). Base `2e0adb5` (sprint start,
clarification answers and the refine of the 19 stories).

## Implemented stories

- **232** — the five remaining modules declare a shared contract plus a `*_HANDLER_SCHEMAS` map, register through
  `defineModule` and call through `createModuleClient`; request schemas moved to `src/shared/modules/`; the bus-wide
  coverage tests have no `CONVERTED`/`Partial` escape any more.
- **236** — electron-backed shell-lib edges are an allowlisted, tested edge; oxlint and the architecture test share
  one node-builtin list; `${reason}` key templates became literal records; a nested-`Outcome` check and a
  comment-path-exists test; unknown unlock feature ids render a translated fallback.
- **235** — a disposed cinema stays closed, `StateStore` requires its migrations, engine-state writes are a service
  method, a `commitAdoption` throw is a recorded failure; the quitAndInstall, debounce race and bleeding-edge
  transport failures are pinned by tests.
- **233** — the quarantine list is empty; `ui:flows` takes `--repeat=<n>`, flow files and `--affected[=<ref>]`
  (changed files to flows via testid derivation and `scripts/flows/areas.json`); the fixture owns `cache/downloads/`.
- **234** — `npm run rehearse` runs `verify:release`, `ci:local` and `ci:local:flows` detached with a status record;
  the real rehearsal (record `.rehearsal/20261006-073931`) PASSED after six real runs, each red triaged. The `ui-flows`
  workflow now runs 6 shards (was 4, 973-1147 s each); 20 Linux flows are quarantined; the sprint README says when
  the rehearsal runs.
- **245** — the roster (teams, spectators) is read in the existing `.dm2` frame pass and stored on the index row;
  the detail lists players per team with a POV mark and a closed spectators group; search matches teams and players.
- **243** — one detail view, no Edit/Save/Cancel: `InPlaceField` per text field, live `TagInput`, `SidesField`; every
  edit is one queued fresh-read write; TD-018 closed.
- **242** — demos are found at any depth and browsed as folders (breadcrumb, recursive counts, zips as read-only
  folders); search crosses the folders below; create/rename folder and drag a demo onto a folder or crumb (keyboard
  chord Ctrl+Space).
- **238** — rows carry `reachedBy`; the list shows the selected installation's demos plus the extra-folder group,
  with an "All installations" toggle and empty states that say why.
- **244** — Ctrl/Cmd-click, Shift-range, Ctrl+A and a row checkbox select demos; bulk delete (to the OS trash), tag and
  move with a per-demo outcome; single demos and folders get the same actions from the detail and a context menu.
- **241** — sidecar `comments`; the detail lists, edits and deletes them with "Play from here"; the timeline has Add
  comment, seeking marks and an inline field; zip demos are read-only with a visible reason.
- **237** — speaker button and 0-100 slider on the timeline; main coalesces `playback.volume` to one in-flight
  `s_volume`; every play launches with `+set s_volume`, the session restore puts the installation's value back and
  the last level is remembered.
- **239** — the rail "+" and the Library header/empty state share one entry list (Add existing, Search this PC,
  New installation…); the bootstrap wizard names the installation; the create dialog and channel are gone.
- **240** — the wizard asks for a parent plus an editable folder name, proposes a free `<name> (2)` subfolder and
  shows the final path before install; the job creates the folder and removes it again when empty on failure.
- **249** — "Play with..." opens a dialog for mod, map and game type; maps come from loose BSPs, `.pak` and `.pkz`
  with BSP titles; the last choice is stored in `moduleData.mods.lastLaunch`.
- **246** — the inspector reports every engine in a root; the installation stores them and the chosen one; the
  library card has an Engine radiogroup; demos play with a detected Q2PRO while r1q2 stays chosen.
- **247** — `maxPingMs` (50/100/150/200/any) in the shared filter engine and quick filters (legacy entries load as
  Any) with a "Max ping" select.
- **250** — with a filter active the scan button reads "Refresh N shown" and refreshes exactly the visible servers
  (new `addresses` scope, no master query); a chevron menu keeps "Scan all".
- **248** — mod and map filters are multi-select (new `MultiSelect` UI-kit primitive, any-of within a field, AND
  across fields); quick filters compare as sets and legacy scalar rows load as a set of one.

## Findings & decisions

**Decisions made in the sprint** (full text in each story's `## Decisions` and `## Decisions (User)`)

- The refine round ran 08:11–08:22 (19 stories in parallel, 11 min); the user then answered about 35 open questions
  story by story, recorded as (User) decisions. Notable: 245 covers OpenTDM and CTF and commits the real demo as a
  fixture; 248 makes the map filter multi-select too; the rest followed the recommendations.
- 232: `ConfigContract.setActions.req` is the readonly `SetProfileActionsInput` (the inferred mutable type failed
  typecheck), pinned by a `toExtend` assertion.
- 235: AC6 stays `allMirrorsFailed` (no product change); the `none` guard test's helper file was renamed to fit its
  allowed patterns.
- 233: a helper change selecting every importing flow is by design; named-flow runs replaced `--affected` in builds.
- 242: the breadcrumb bar always renders once loaded; main keeps each root's absolute dir internally so empty and
  zip-only roots can be targets; the recursive scan counts the fixture decoy `old/nested.dm2`.
- 243: one replace dialog in `ReplaysView` serves every demo; a refused sides save keeps the editor open.
- 238: the scan stays global and the view scopes by `reachedBy`; "All installations" is view state, off by default.
- 244: delete is always `shell.trashItem` through `OsService` and never falls back to `rm`; Ctrl+Space stays dnd-kit's
  drag chord and does not toggle.
- 239/240: the create channel is gone; the wizard name follows into the folder name; a refused start leaves no
  empty folder behind.
- 246: the chosen engine is the `executablePath`, `engineKind` is derived from it; `recordedEngineKind` (repair offer)
  deliberately does not change on a switch because it records the installed engine, not the played one.
- 249: a `.pkz` map listing needs the vendored 7-Zip; titles of `.pkz` maps are absent and map `.pk3` is not read
  (intentional, not filed).
- 247/250/248: new flows follow the flows' copy-not-import convention; 248 keeps legacy `mod: null` rows dropped.

**Found by the gate** (see Regression gate): eight flows, four unit files and the replays `ui:verify` screens were
red because earlier stories of the same sprint changed what a later story's flow had asserted (239, 240, 242, 238, 237) or moved docs; all fixed in `d73d2ff` in flows, tests, docs and scripts, none in `src/`. Stories 237, 241, 244
and 246 each saw those reds in their narrow runs and recorded them as "pre-existing, not ours"; the cause was a
story of the same sprint, so a red named in a narrow run should be attributed before it is waved through.

**Review outcomes.** All 19 reviews ran at the default tier, so the hard-review question does not apply. Default
reviews returned FAIL on real defects in three stories and each was fixed in its cycle: 242 (breadcrumb hidden at the
top level, dead keyboard sensor), 239 (stale text; the fix was verified but not re-reviewed) and 248 (a11y gaps,
invalid UTF-8 in `CHANGELOG.md`). 234 returned PASS with minor findings, fixed in one cycle; its cosmetic leftover
is TD-048.

**Story 234 after the confirmation gate.** The 234 work (about 5 h wall time, because a rehearsal run takes 17-24
min) happened after the sprint review and changed about 100 format-only files, 4 flows (`replays-stop`,
`replays-volume`, `replays-date-filter`, `mods-install`) and `quarantine.json` after the confirmation gate (169/169 on
`d73d2ff`). The final tree had narrow checks only (typecheck, lint, `prettier --check`, targeted vitest and the
touched flows on Windows), not a third full `e2e-all`. What the six real runs found and fixed on the branch:
`prettier --check` was red on 99 files (reformatted), `fetch-7za` wrote a CRLF licence, `scan-service.test` (TEMP),
`quiet-test-run.test` (ANSI) and `map-list.test` (case-sensitive paths) were red on Linux, `.actrc` no longer sets
`--use-gitignore=false`, the extractor path is `7zz`, the mods fixture follows the host platform, the stub engine
takes its parent pid. Rehearsal numbers: `verify:release` 1029 s, `ci:local` 270 s, `ci:local:flows` 1412 s; six
shards 685/682/820/664/747/666 s against the 900 s limit.

**Process observations**

- Build agents hit the 10-minute call ceiling with `--affected`, which selected 25-145 flows whenever `scripts/lib` or
  a broad file changed, and ran flows by name in batches ([TD-043](../../TECH-DEBT.md)). Six new flows are not in
  `areas.json` because its rows are capped at 12 ([TD-042](../../TECH-DEBT.md)).
- Several story agents condensed `docs/systems/replays-module.md` to its 150-line cap and dropped some detail
  ([TD-045](../../TECH-DEBT.md)).
- One fix agent's temporary worktree wiped `node_modules` through a junction; restored with `npm ci`, lockfile
  unchanged.
- Story 232 left a comment-convention red (`comments.test.ts`) in `shared/modules/downloads.ts`, fixed in `7152267`.
- The attribution and fix agent took about 30 minutes; the confirmation `ui:flows` another 65.

**Deliberately unfixed or open, with where each went** (every defect or debt finding is a row in
[TECH-DEBT.md](../../TECH-DEBT.md), `since` S34)

- 238 → TD-034 (duplicate row ids on a shared Linux write dir); 250 → TD-035 (silent favourite left as a stale row)
- 235 → TD-036 (guard test sanity, implicit quit order, installer vs 3 s shutdown); 243 → TD-037 (tag and sides edges)
- 244 → TD-038 (duplicated folder-pick walk, plain rename, no size total); 241 → TD-039 (refused vs failed on retry)
- 233 → TD-040 (flow-select test strength, usage header), TD-043 (`--affected` over-selects); 236 → TD-041 (circular
  test); 234 → TD-047 (20 Linux quarantines, 12 a Windows-engine fixture limitation, staleness deadline S38), TD-048
  (`win32` variant ids in the mods fixture)
- 239, 240, 247, 248, 249, 250 → TD-042 (flows missing from `areas.json`); 240, 237 → TD-044 (Linux/non-root paths
  unrun on this host)
- 237, 238, 244 → TD-045 (replays doc condensed); doc misses of the module-doc check → TD-046 (below)
- Left as is, too small for a row: 245 `demo-detail.ts` still builds a `sides` entry the panel filters out; 242 duplicate
  `sourceLabel`; 247 ~25 lines of scan setup copied into one flow; 248 local case-insensitive helper copies; 249
  `.pkz` tests self-skip without 7-Zip and a failing `rememberLastLaunch` is ignored on Start; 250 two thin tests.
- No story drafts were created by this sprint. Draft 102 (Linux Q2PRO) still awaits its Q1–Q4.
- **Overdue TECH-DEBT rows** (`node scripts/check-docs.mjs --overdue`, current sprint minus `since` > 3): TD-008,
  TD-009, TD-010, TD-011 (S29–S30), TD-015 (S24), TD-016 (S25), TD-019 (S30), TD-029 (S29), TD-030 (S30). They await
  promotion to a story or deletion by the maintainer.

**Module-doc check** (a story that touched `src/main/modules/<id>/` or `src/renderer/src/modules/<id>/` also touches
that module's `docs/systems/` doc). Misses, filed as [TD-046](../../TECH-DEBT.md): 232 did not touch
`install-module.md` (downloads and library handlers); 235 did not touch `replays-module.md` (cinema dispose; the story
says so deliberately); 236 did not touch `replays-module.md`, `servers-module.md` or `config-module.md` (key records,
a `RawFileTab` comment path). All other stories touched their module's doc: 245, 243, 242, 238, 244, 241, 237, 246
`replays-module.md`; 239, 240, 235 `install-module.md`; 249 `mods-module.md`; 247, 250, 248 `servers-module.md`.

## Blocked / open

- **Story 234, AC3 GitHub half.** Real-runner shard times under 20 minutes and `windows-verify` green on
  `windows-latest` need a PR or workflow dispatch, which is the user's step, not an agent's.
- Merging `sprint/S34` into `dev` is the user's decision (pushes and pull requests are not done by agents).
- The manual residue in `testplan.md` (244 AC9, 237, 234 AC3 GitHub half).
- The 20 Linux quarantine entries are due a fix by S38 (TD-047).
- Nine overdue TECH-DEBT rows (above).

## Regression gate

Ran on `dc6fa0d`; the fixes were committed as `d73d2ff` and the confirmation run is on `d73d2ff`. Detail and
per-failure verdicts also in [sprint.md](sprint.md#regression-gate).

| Command                                                                                           | Minutes | Result                                                                     |
| ------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------- |
| `npm run build`                                                                                   | < 1     | green                                                                      |
| `npm test`                                                                                        | < 1     | 4 red: `check-docs`, `flow-helper-duplication`, `flow-select`, `tech-debt` |
| `npm run ui:verify`                                                                               | 3.7     | red: 14 replays screens unreachable                                        |
| `npm run ui:flows` (first run)                                                                    | 65      | red: 161/169, 8 flows red                                                  |
| fixes re-verified (4 unit files, typecheck, lint, comments + architecture, 21 flows, `ui:verify`) | ~30     | green; `ui:verify` exit 0, 116 shots, 0 unreachable                        |
| `npm run ui:flows` (confirmation on `d73d2ff`)                                                    | 65.5    | green: 169/169                                                             |

- `check-docs`, `tech-debt` — the sprint moved stories and the S32/S33 folders into `done/`, links broke. **Fixed**
  (`check-docs --fix` paths).
- `flow-select` — two `areas.json` rows over 12 flows (replays-playback, downloads-bootstrap). **Fixed**, rows split.
- `flow-helper-duplication` — copied helpers in `replays-copy-in` and `servers-flow`. **Fixed**, moved to `scripts/lib`.
- `ui:verify` replays screens — stories 238 and 242 changed the first list view. **Fixed** in `screens.mjs`.
- `add-installation-one-flow` — story 240 (target step). **Fixed** in the flow.
- `linux-user-journey`, `runner-choice-compact`, `steam-handoff`, `windows-build-on-linux` — story 239 removed the
  Library "Add existing" button. **Fixed**: flows use `openLibraryAddEntry`.
- `replays-filter-search` — 242 (folder view); `replays-mod-warning` — 238 (scope reset); `replays-play-q2pro` — 237
  (`+set s_volume` token). **Fixed** in the flows.
- Quarantine: `scripts/flows/quarantine.json` stays `[]`, nothing quarantined, no unexpected pass.
- Unattributed / blockers: none. The confirmation did not re-run the whole `npm test`, only the four red files.
- Story 234 rehearsal, after the gate: PASSED (`.rehearsal/20261006-073931`: `verify:release` 1029 s, `ci:local` 270 s,
  `ci:local:flows` 1412 s; shards 685/682/820/664/747/666 s). It changed about 100 format-only files, 4 flows and
  `quarantine.json` after the 169/169 confirmation; the final tree had narrow checks only (typecheck, lint,
  `prettier --check`, targeted vitest, the touched flows on Windows), not a third full `e2e-all`.

## Acceptance

Every criterion below has a named automated test (listed in full in each story's `## Done` and
`## Acceptance Tests`, docs/requirements/done/). Per story:

- **232** — AC1 the "exactly one schema per" tests in the library/mods/downloads/config-schemas/replays shared test
  files; AC2 "every module's main half binds defineModule" + "every module client is built with createModuleClient";
  AC3 "every module registers exactly its declared handlers" + "every handler constant is referenced by its module's
  client"; AC4 "request schemas live in shared, persisted and manifest schemas in main" + the unchanged schema-parity
  snapshot; AC5 typecheck + 23 flows.
- **236** — AC1 `architecture.test.ts` "a main module reaches an electron-backed shell lib only through an allowlisted
  edge"; AC2 "oxlint forbids exactly the node builtins the architecture test forbids"; AC3 `error-keys.test.ts` (three
  tests: no template keys, misspelled literal fails, every literal resolves in `en.json`); AC4 "no renderer file
  unwraps a nested Outcome" + "every repo path named in a source comment exists"; AC5 `UnlockCodePanel.test.tsx`
  (fallback and known label).
- **235** — AC1 `cinema-controller.test` + replays `index.test`; AC2 `service.actions.test`; AC3 `state.test` +
  `installations.test` `setEngineState`; AC4 `job.failure-and-retry.test`; AC5 `job-runner.test` (fails without
  `await state?.settle()`); AC6 `update-job.test` (`it.each` 5xx and refused) + `FailureLogEntry.test`.
- **233** — AC1 flow `mods-view`; AC2 flow-gate "--repeat…" + `replays-mod-warning --repeat=20` 20/20; AC3
  `fixture-layout` test + flows `downloads-tab`, `settings-downloads-section`; AC4 five `flow-select` tests +
  flow-gate "flow file paths and --affected…"; AC5 quarantine `[]` + the gate's 169/169.
- **234** — AC1 `scripts/rehearsal.test.mjs` (launcher returns at once, failing command, missing Docker) + the
  rehearsal record `.rehearsal/20261006-073931` (PASSED); AC2 `scripts/flow-gate.test.mjs` (linux-scoped entry) + the 20
  entries in `quarantine.json` + `ci:local:flows` passed with them applied; AC3 `scripts/rehearsal.test.mjs` (shard
  parser, margin) + six shards at most 820 s of 900 (GitHub half is residue); AC4 `scripts/docs-facts.test.mjs`.
- **245** — AC1/AC6 flow `replays-detail-teams` + `DemoPlayersPanel.test.tsx`; AC2/AC3/AC8 `dm2-roster.test.ts` +
  flow; AC4 `dm2-roster.test.ts`, `effective-values.test.ts`, `DemoPlayersPanel.test.tsx` (component level only); AC5
  `effective-values.test.ts` + flow; AC7 `dm2-roster.test.ts` budget + `scan-service.test.ts` one-pass.
- **243** — AC1–AC9 as mapped in the story's Acceptance Tests, e.g. "the detail is one view: no Edit, Save, Cancel or
  discard dialog"; flows `replays-edit-sidecar`, `-edit-sides-tags`, `-edit-unreadable-sidecar`,
  `replays-archive-readonly`.
- **242** — AC1–AC8 each by a unit test plus flows `replays-folders`, `-folders-search`, `-folder-manage`,
  `-folder-drag-move`, `-folders-scale`; `ui:verify` on the replays screens with axe clean.
- **238** — AC1 flow `replays-installation-scope` + `discovery.test` "a Q2PRO write dir shared by two installations is
  reached by both" + `list-scope.test`; AC2/AC3 flow + `ReplaysView.test`; AC4 flows `replays-list-empty`,
  `replays-scope-empty`, `replays-scope-none-selected` + `list-state.test`; AC5 flow `replays-scope-empty` +
  `ReplaysListStatus.test` + `discovery.test`; AC6 flow + `list-scope.test` + `demo-rename.test`.
- **244** — AC1 flow `replays-multi-select` + `selection.test.ts`; AC2/AC3/AC6/AC7 flow `replays-bulk-delete` +
  `demo-file-ops.test.ts`; AC4/AC5 flow `replays-bulk-tag-move` + `demo-bulk-tags`/`demo-file-ops` tests; AC8
  `demo-file-ops.test.ts`; AC9 `os.test.ts` + `demo-file-ops.test.ts` (OS trash is manual residue); AC10/AC11 flow
  `replays-demo-context-menu` + `demo-folder-delete.test.ts`.
- **241** — all 18 Acceptance Tests lines: e2e `step:` lines in the three story flows (and `replays-timeline`) plus
  the named unit tests.
- **237** — AC1–AC7 flow `replays-volume`; unit `playback-volume.test.ts` "sends s_volume as a fraction" and the
  named volume tests; flows `replays-timeline`, `-timeline-burst`, `-timeline-optimistic`, `replays-cinema`.
- **239** — AC1–AC4 flow `add-installation-one-flow` + the named unit tests, nine bootstrap flows via
  `openLibraryAddEntry`; AC5 `vocabulary.test.ts`.
- **240** — AC1/AC4/AC5 `target.test.ts` + flow `bootstrap-target-subfolder`; AC2 `BootstrapWizard.test.tsx` "the
  confirm step states the final path" + flow; AC3 `job.assembly.test.ts` "the job creates the target folder before
  writing" + flow; AC6 `target.test.ts` + `bootstrap-wizard`; AC7 `job.failure-and-retry.test.ts` (3) +
  `bootstrap-failure`.
- **249** — AC1–AC6 the seven steps of flow `play-with` plus `map-list.test.ts`, `bsp-title.test.ts`,
  `launch-plan.test.ts`, install-record/index/`PlayWithDialog` tests, ipc-schemas.
- **246** — AC1–AC8 and both (User) playback decisions: the named unit tests plus flows `installation-engine-choice`
  and `replays-play-detected-q2pro`.
- **247** — AC1–AC5 flow `servers-ping-filter` + `ServerListFilterBar.test`, `list-filter.test`, `persisted.test`,
  `quick-filters.test`; AC6 flow `servers-lan-mode` step.
- **250** — AC1–AC3 `ServersView.test.tsx` + flow `servers-refresh-shown`; AC4 `ServersView.test.tsx` "a row that stops
  matching…"; AC5 scoped-rounds unknown-address test + `servers.test.ts`; AC6 scoped-rounds LAN test + `servers-lan-mode`;
  AC7 scoped-rounds refused test + `ServersView` disabled test.
- **248** — AC1–AC6 and the map extension: `MultiSelect`, `list-filter`, `quick-filters`, `persisted`,
  `ServerListFilterBar` unit tests ("a chip is pressed when its mod set equals the filter's") + flow
  `servers-multi-filter`.

**Manual residue** (reason each; all in `testplan.md`; none holds a story or the sprint open):

- 244 AC9 — the real Windows Recycle Bin and a Linux desktop trash: the harness stubs `shell.trashItem` into
  `harness-trash/` and never touches the OS trash.
- 237 — hearing the volume change on a real Q2PRO with an audio device: the stub engine has no sound.
- 234 AC3, GitHub half — real-runner shard times and `windows-verify` green on `windows-latest`: it needs a PR or a
  workflow dispatch, which is the user's step.

**Criteria covered below the real surface**

- 245 AC4 — component level only (no roster-less fixture row for a flow).
- 237 — the keyboard unit test asserts `step=5` and click-toggle (jsdom has no arrow-key value change); ArrowUp and
  Space are proven in the flow. The Linux `q2config.cfg` path is unrun on this host ([TD-044](../../TECH-DEBT.md)).
- 240 — "a subfolder of a non-writable parent is not writable" is `skipIf` on Windows/root.
- 249 — `.pkz` tests self-skip without the vendored 7-Zip.
- 234 AC2 — 20 flows are quarantined on Linux rather than fixed, 12 of them for a Windows-engine fixture limitation
  ([TD-047](../../TECH-DEBT.md)); the rehearsal ran them under Docker, not on a real Linux desktop.
- 232, 236, 233 — structural criteria (one contract, import direction, key records) are proven by source-scanning
  tests; their flows are regression proof.

**Changelog sweep:** `CHANGELOG.md` `## Unreleased` carries an entry for each user-facing S34 story: 237, 238, 239 (the
wizard, under Changed), 240, 241, 242, 243 (Changed), 244, 245, 246, 247, 248 (Changed), 249 and 250 (Added), and the
Fixed lines for 235 and 236. No entry was missing and none was added late. 232, 233 and 234 are internal.

## Tier record

| Story     | Ds      | hard Ds | review       | cycles | agents  | build min |
| --------- | ------- | ------- | ------------ | ------ | ------- | --------- |
| 232       | 11      | 1       | default      | 1      | 16      | 31        |
| 236       | 6       | 0       | default      | 1      | 8       | 8         |
| 235       | 7       | 1       | default      | 0      | 9       | 12        |
| 233       | 5       | 1       | default      | 1      | 7       | 40        |
| 234       | 3       | 1       | default      | 1      | 3       | ~310      |
| 245       | 5       | 1       | default      | 1      | 9       | 39        |
| 243       | 5       | 1       | default      | 1      | 9       | 52        |
| 242       | 10      | 1       | default      | 1      | 19      | 156       |
| 238       | 4       | 1       | default      | 1      | 10      | 106       |
| 244       | 8       | 1       | default      | 1      | 13      | 85        |
| 241       | 4       | 1       | default      | 1      | 9       | 58        |
| 237       | 4       | 1       | default      | 1      | 11      | 61        |
| 239       | 7       | 0       | default      | 1      | 10      | 44        |
| 240       | 5       | 1       | default      | 1      | 8       | 37        |
| 249       | 6       | 1       | default      | 1      | 11      | 25        |
| 246       | 6       | 1       | default      | 1      | 10      | 49        |
| 247       | 3       | 0       | default      | 1      | 5       | 17        |
| 250       | 3       | 1       | default      | 1      | 6       | 25        |
| 248       | 4       | 0       | default      | 1      | 7       | 34        |
| **Total** | **106** | **15**  | 0 hard of 19 | 18     | **180** | **~1190** |

Refine took 11 min (19 in parallel) plus the user's question round; the gate took about 5 minutes of short suites, 65
and 65.5 minutes of `ui:flows` and about 30 minutes of attribution and fixes. The 234 build minutes are about 5 h of
wall time, mostly rehearsal runs of 17-24 min each, plus 10 min before. All 19 reviews ran at the default tier
and no second-stage hard review ran, so there is no evidence this sprint on whether the hard tier earns its place
(default reviews alone caught the real defects in 242, 239 and 248).
