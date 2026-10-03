# Sprint S33 — review

## Overview

Goal: the config module's main side is thin handlers over declared-once profile shapes, and
profile-restore is a folder of named stages. Every renderer screen reads main-owned data through one query
hook, saves a profile edit through one hook, and uses the UI kit's shared name, confirm, tabs, error
boundary, sort and search. The Controls tab is a component tree. On X11 the staged game stays on top of the
launcher. The docs, system docs and comments describe the launcher as built, and tech debt has one home with
an ageing rule. All 16 stories are done on `sprint/S33`; the merge into `dev` is the user's decision (see
Blocked / open).

| Story                          | Status | Commit                                                                                                        |
| ------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------- |
| 224 e2e fixture + flow helpers | done   | 31b87f6 shared fixture constants, fixture facade split, StateStore parity test, flow-helper duplication guard |
| 211 profile shapes once        | done   | 9b3cc3c shared schema, one restore adapter, shims and fixtures out of main                                    |
| 210 config main side           | done   | 166bd49 `profile-writes` service, `startup.ts`, `index.ts` 501 lines + line cap test                          |
| 214 profile-restore stages     | done   | 0f1b958 stage folder, `groupEntryLines` lifted, `shared/config` grouped by dependency direction               |
| 212 one save hook              | done   | 1147fa6 `useProfileSave`, new alias in first category, main refuses new orphan categories                     |
| 215 one query hook             | done   | 4dbc101 `useModuleQuery`/`useModuleMutation`, three-wave migration, `useListSort`, `useServerScan`            |
| 216 UI kit                     | done   | 7def152 `NameDialog`, `ConfirmDialog`, `Tabs`, `RadioGroup`, `TextArea`, one `ErrorBoundary`, `useStartJob`   |
| 217 shared sort and search     | done   | 0cd8fa0 `src/shared/list`, `null` sort sentinel, quoted demo search                                           |
| 218 profile provider           | done   | 7fcc2f2 `useConfigProfiles` store, `ProfileDraftProvider`, `ConfigView` split                                 |
| 213 Controls component tree    | done   | 1ffb774 row/drag/rail/actions hooks, `ControlsEntryRow`, shared config test harness                           |
| 231 i18n keys                  | done   | afdb229 key-usage + duplicate tests, `common.action/label`, per-module locale files; regression fix 95522d3   |
| 198 X11 stage on top           | done   | 8ee0fec X11 keeper (above + borderless via X-Resource PID), cinema overlay raise, not-on-top notice           |
| 227 docs as built              | done   | f9f3cbf ARCHITECTURE modules/errors/state, CLAUDE.md, `check-docs` in `npm test`, `log.caught`                |
| 228 system docs                | done   | c9e47a0 as-built docs for config/servers/replays/home/mods, concepts moved to `systems/`                      |
| 230 comments                   | done   | 8186078 comment sweep, `src/comments.test.ts`, `[diag187]` removed                                            |
| 229 tech debt home             | done   | a3072e0 `TECH-DEBT.md`, validator, ageing rule, follow-ups triaged                                            |

Also on the branch: f46e8b6 (sprint start), 4c17039 (clarification answers), 1aef744 (refine of the 16
stories) and 95522d3 (the regression fixes found by the gate, see Regression gate). Base `7ae6851`.

## Implemented stories

- **224** — fixture literals come from `src/shared/fixture-constants.json`; `fixture.mjs` is a facade over 11
  files with a `VARIANTS` map (seed output byte-identical); `fixture-parity.test.ts` loads every variant
  through the real `StateStore`; duplicated flow helpers moved to shared modules, guarded by
  `flow-helper-duplication.test.mjs`.
- **211** — profile sub-shapes are declared once in `shared/config/profile-schema.ts` (each `ZodType<Contract>`);
  the IPC tree adds caps, `persisted.ts` adds forgiveness; one `toRestoreInput` and `RestoredProfileFields`
  feed import and refresh; the two shims are gone.
- **210** — the config write path is `profile-writes.ts` behind `ProfileWritesDeps` and startup is `startup.ts`
  (still awaited at boot); `index.ts` is 501 lines with no `node:fs`/`electron`, capped by an architecture test.
- **214** — profile-restore is a stage folder behind a one-line facade; all of `src/shared/config` is grouped
  `syntax → catalog → aliases/validation → profile → render`, the direction enforced by `architecture.test.ts`.
- **212** — `useProfileSave` owns debounce, optimistic patch, revert and one refusal toast for five surfaces; a
  new alias lands in the first category; main refuses a new action in a category the profile lacks.
- **215** — `useModuleQuery`/`useModuleMutation` and `useListSort`; three waves of one-shot reads migrated
  (hand-rolled flags 36 → 9); `ServersView` 721 → 345 lines with `useServerScan` and `ServersToolbar`.
- **216** — name, confirm, tabs, radio group, text area and one `ErrorBoundary` primitives; ~45 dialogs, tab
  strips and boundaries migrated; `useStartJob` + `JobActionDialog` for the job dialogs; adoption and token guards.
- **217** — `src/shared/list/{sort,search}.ts`; servers, replays, player roster and alias rows re-expressed on
  them; `listSort` is `null` end to end; the demo list takes a quoted exact-match search.
- **218** — `useConfigProfiles` store is the only reader of the profile list; `ProfileDraftProvider` serves the
  three tabs and eight panels; `ConfigView` 1009 → 310 lines.
- **213** — the Controls tab is `useControlsRows`, `useControlsDrag`, `ControlsEntryRow` (one slot path),
  `ControlsCategoryRail` and dialogs under `components/`; `ControlsTab.tsx` 2,313 → ~620 lines; shared
  `modules/config/test/` harness used by nine suites.
- **231** — every locale key is proven used (`keys.test.ts`, ~100 dead keys deleted), repeated action/label
  values live once under `common.action.*`/`common.label.*`, locales split per module and merged by `bundle.ts`.
- **198** — on X11 main keeps the staged game on top: a hand-written X11 client finds the game window by
  X-Resource PID of main's own process and sets above/borderless/geometry; the follower and cinema route through
  it; failure shows `replays.stage.notOnTop.x11`. Nothing is constructed on Windows or Wayland.
- **227** — `ARCHITECTURE.md` gained Modules as built, the walked "Adding a module" list, Errors and logging,
  Renderer state and Inside a renderer module; CLAUDE.md/CONTRIBUTING/README current; `scripts/check-docs.mjs`
  (links, README version, `--fix`) runs in `npm test`; `scopedLogger.caught`.
- **228** — as-built system docs for config, servers, replays, home and mods; `game-browser` and `home-screen`
  moved to `docs/systems/`; the module checklist and `docs/README.md` require the systems doc.
- **230** — ids and review narrative stripped from comments across ~440 files, six module headers rewritten, the
  densest files under 35 % comment share; `src/comments.test.ts` guards it tree-wide.
- **229** — `docs/TECH-DEBT.md` (validated by `check-docs`, `--overdue` lists age) and the ageing rule in
  `docs/README.md` and `.claude/ai-scrum.md` Notes; roadmap follow-ups cut from 34 bullets to 8 lines.

## Findings & decisions

**Decisions made in the sprint** (full text in each story's `## Decisions (Sprint)`)

- 211: a constraint both schema trees enforce goes into the shared shape, a cap only IPC has stays IPC-side,
  forgiveness stays persisted-side, because the persisted tree is looser and a stricter shared shape would drop
  stored rows on load. The IPC legacy-key fold was deleted with no replacement.
- 210: boot keeps blocking on config startup (F49): a non-blocking start needs a new "config ready" event, a
  behaviour change a refactor story must not make. The ≤ 600-line cap is a hard assertion.
- 214 (user): group all of `src/shared/config` into folders, not only `profile-restore/`; a tenth stage file
  was needed to keep every file under 800 lines.
- 212: the orphan-category check is a handler check that refuses only new orphans (restore and import
  legitimately produce them); new alias goes to `categories[0]`, `MoveEntryDialog` stays unused.
- 215 (user): cache-free query hook. `error` is a `LocalizedMessage`; the "< 10 flags" budget is guarded by a
  broader regex so renaming a flag cannot satisfy it.
- 216 (user): raw `<button>` sweep out of scope. Two tab strips, not three (the Controls rail stays chips);
  tabs use manual activation; AC2's grep is met by a shared `useSubmitting` hook with an in-flight ref.
- 217: favourite pinning is an option of `createColumnSorter`, because servers and replays pin differently by
  shipped behaviour; the roster's third click now returns to its default order like every list.
- 218 (user): the store owns the list only; the selected profile id stays in route focus.
- 231: the AC1 test, not the review's "~25", defines dead keys; module locales reach the shell through
  `modules/locales.ts` with static imports; the merge throws on a leaf collision.
- 198 (user): window lookup via X-Resource PID, a hand-written X11 client without a dependency, the cinema
  overlay raised after the game's pin, and no Xvfb harness — so AC1–AC4 on a real WM are manual residue.
- 227 and 228 (user): the doc is written to the target state with a "planned in story NNN" marker, each story
  removes its own; a test fails on a marker whose story is done.
- 229 (user): rows leave `TECH-DEBT.md` when done; the ageing rule lives in `docs/README.md` and
  `.claude/ai-scrum.md` Notes because the plugin files are managed.

**Found by the gate, fixed** (see Regression gate): four regressions across stories that the narrow gates did not
see (224, 215, 227, 231) and one flaky pre-existing flow fixed at its cause in product (atomic-write rename
retry). The pattern is the one [233](../../requirements/233-the-flow-gate-has-no-quarantined-flows-and-catches-cross-story-breakage.md)
already describes. Several stories also reported flows red in their narrow runs (`unsaved-diff`,
`controls-extra-keys`, `drop-message-checkbox`, `external-edit-cascades`, `grenade-rows-take-a-key`,
`controls-drag-reorder`, `settings-downloads-section`, `config-header-geometry`) that were green in the gate; the
stated cause was a polluted `.ui-verify` fixture cache, which is the same finding.

**Process observations**

- The story and refine agents wrote CRLF into docs repeatedly (caught by the repo-hygiene test) and the
  orchestrator normalised it before each commit; the PowerShell-based progress trail wrote CRLF once
  (normalised). Guarded by the test, no follow-up.
- `check-docs --fix` once corrupted non-UTF-8 archive files; fixed in 227 by skipping files that are not valid
  UTF-8. This review's sweep found two more encoding defects in done-story files (224: double-encoded dashes
  and arrows, 31 places; 216: four lone cp1252 bytes in the commit and tiers lines) and repaired them in place.
- The progress trail is shell-generated and carries no typed timestamps; it holds a duplicated
  `217 · story · done` line.
- 229's triage ledger recorded "213: no unfixed findings" although 213's Done section has an Open item; it is
  now [TD-032](../../TECH-DEBT.md).
- 227 left story 205's typed-contract gap documented as "planned in story 232" (draft, undecided).

**Deliberately unfixed or open, with where each went**

Review findings left unfixed in the S33 stories were triaged by story 229 into [TECH-DEBT.md](../../TECH-DEBT.md)
(rows TD-017, TD-022 to TD-028 and TD-031 carry S33 as `since`) or deleted with a reason in 229's ledger; this
review added two rows that the ledger had missed. Per story:

- 198 → TD-023 (X errors dropped, TCP auth families, park geometry, cinema ordering)
- 210 → TD-024; 211 → TD-022 (`keepEmptyAlias` stripped by both schema trees)
- 212, 218 → TD-025 (draft edges); 213 → TD-032 (new, memo defeated by the per-render `grip`, thin row tests)
- 216 → TD-026; 227 → TD-027, TD-031 (bare catches); 228 → TD-017 (`setSwitchBind` bypasses
  `syncAndPersist`, a possible product bug), TD-027
- 230 → TD-033 (new, dropped invariant notes in `shared/modules/config.ts`); 231 → TD-028
- 215 narrow edges (`BootstrapWizard` stale verdict, `useServerScan` order) were deleted by 229 as unobservable.
- No story drafts were created by this sprint. Drafts 232–236 from S32 still await a decision.

## Blocked / open

Nothing blocked and no regression is red. Open: merging `sprint/S33` into `dev` is the user's decision (pushes and
pull requests are not done by agents); the manual residue of story 198 in `testplan.md`; the decision on drafts
232–236; the plugin-upstream follow-up for the ageing and systems-doc rules (roadmap).

## Regression gate

Ran on `8186078`+fixes; the fixes were committed as `95522d3` and the confirmation run is on `95522d3`.

| Command                                        | Minutes | Result                                                                  |
| ---------------------------------------------- | ------- | ----------------------------------------------------------------------- |
| `npm run build`                                | 0.1     | green                                                                   |
| `npm test`                                     | 0.5     | first run 3 red, then green (7028 passed, 8 skipped)                    |
| `npm run ui:verify`                            | 2.1     | first run exit 1, then exit 0                                           |
| `npm run ui:flows` (first run)                 | 51      | red: 140/143                                                            |
| `npm run ui:flows` (confirmation on `95522d3`) | 50.5    | green: 142/143, the remaining one is quarantined `mods-view` (expected) |

- `shell-layering` "no shell file imports from modules" — story 224 (`31b87f6`): the fixture-parity test moved
  next to the other module-importing golden test. **Fixed in 95522d3.**
- `test-kit` mockClient offender `useQuickFilters.test.ts` — story 215. **Fixed in 95522d3.**
- `architecture-doc` planned-in-story marker for done story 230 — story 227: sentence rewritten (TD-031 tracks
  the unmigrated bare catches). **Fixed in 95522d3.**
- `ui:verify` `config-aliases` unreachable — story 231 (`afdb229`): the key-usage sweep deleted the dynamic
  `config.aliases.origin.*` keys (the UI showed the raw key). **Fixed in 95522d3.**
- Flow `replays-detail-quick-edit` — flaky and pre-existing (fails ~40–50 % at the sprint base `7ae6851`): a
  transient Windows EPERM on the atomic-write rename silently dropped the sidecar write. **Fixed in product with
  a bounded rename retry (95522d3)** rather than quarantined; 12/12 green afterwards.
- Quarantine: `replays-mod-warning` removed (unexpected pass twice); no entries added.
- Unattributed / blockers: none.

## Acceptance

Every criterion below has a named automated test (listed in full in each story's `## Done` and
`## Acceptance Tests`, docs/requirements/done/). Per story:

- **224** — AC1 `fixture-parity.test.ts`; AC2 `fixture-constants.test.ts`; AC3 `fixture-layout.test.mjs`;
  AC4/AC5 `flow-helper-duplication.test.mjs`; AC6 the sprint's `ui:flows` (142/143, `mods-view` quarantined).
- **211** — AC1 `profile-schema.test.ts` + `tsc`; AC2/AC5 `schema-parity.test.ts` (snapshot written before
  any change); AC3 `profile-restore-input.test.ts`, `import-vs-refresh.test.ts`; AC4 two `architecture.test.ts` rules.
- **210** — AC1/AC2 `profile-writes*.test.ts`; AC3 `architecture.test.ts` (line cap, no fs/electron); AC4
  `index.test.ts`; AC5 `startup.test.ts`; AC6 `round-trip/`, `file-source-pipeline.test.ts` unchanged + five config flows.
- **214** — AC1/AC6 `architecture.test.ts` (leftward groups, `config-module.md` direction note); AC2
  `entry-grouping.test.ts`; AC3 800/150 line rule; AC4 the unchanged `profile-restore.*` and `round-trip/*` suites;
  AC5 overview ≤ 40 lines.
- **212** — AC1 `useProfileSave.test.ts`; AC2 `architecture.test.ts`; AC3 `save-refusal.test.tsx` (five surfaces);
  AC4 `AliasesTab.category.test.tsx` + flow `alias-new-lands-in-first-category`; AC5 two handler tests +
  `orphan-category.test.ts`; AC6 the seven `ControlsTab.*` suites and the config flows.
- **215** — AC1 `useModuleQuery.test.tsx`; AC2 `renderer-health.test.ts` flag budget (= 9) +
  `useQuickFilters.test.ts`, `ReplaysSettingsSection.test.tsx`; AC3 `ServersView.test.tsx`, `useServerScan.test.ts`,
  `useListSort.test.ts`, 350-line cap; AC4 "four state kinds"; AC5 32 flows by name plus the gate.
- **216** — AC1 primitive tests + flows `name-dialog-enter-once`, `tabs-keyboard`; AC2/AC3 `ui-kit-adoption.test.ts`,
  `ErrorBoundary.test.tsx`; AC4 `useStartJob.test.ts`, `JobActionDialog.test.tsx` + five job flows; AC5
  `ui-kit-tokens.test.ts` + `ui:verify` with `a11y.json` identical to the baseline; AC6 31 flows.
- **217** — AC1 `sort.test.ts`, `search.test.ts`; AC2 the unchanged servers/replays/player/alias sort tests +
  `architecture.test.ts`; AC3 persisted/index tests + flow `servers-sort-order`; AC4 `list-filter.test.ts` + flow
  `replays-quoted-search`; AC5 five sort/filter flows.
- **218** — AC1/AC2/AC3 `config-structure.test.ts`, `ProfileDraftProvider.test.tsx`, `config-profiles-store.test.ts`,
  `ConfigView.profilesStore.test.tsx`; AC4 `config-header-geometry` + 26 config flows and two home flows.
- **213** — AC1–AC4 `useControlsRows.test.ts`, `ControlsEntryRow.test.tsx`, `useControlsDrag.test.ts`,
  `ControlsTab.dialogs.test.ts`, `ConfigView.profile-switch.test.tsx`, four `architecture.test.ts` rules; AC5
  `harness.test.tsx` + architecture rule; AC6 soft-cap rule + nine flows; AC7 four anchor tests.
- **231** — AC1/AC2 `keys.test.ts`; AC3 `bundle.test.ts` (file snapshot of the pre-split bundle), `index.test.ts`;
  AC4 `vocabulary.test.ts`, flows `replays-stage-unavailable`, `replays-cinema-unavailable`, `ui:a11y` label
  findings 0 before and after.
- **198** — AC1–AC4 unit: `x11/stage-window.test.ts`, `x11/wire.test.ts`, `stage-follow.test.ts`,
  `cinema-controller.test.ts`, `cinema-window.test.ts` (the real-WM effect is manual residue below); AC5
  `stage-window.test.ts`; AC6 flow `replays-stage-x11-unreachable` + `stage-window.test.ts`, `connection.test.ts`;
  AC7 `stage.test.ts`, `stage-follow.test.ts` + flow `replays-stage-follow`; AC8 `stage.test.ts` + flow
  `replays-stage-unavailable`.
- **227** — AC1/AC2 `architecture-doc.test.ts`, `logger.test.ts`; AC3/AC4 `docs-facts.test.mjs`,
  `check-docs.test.mjs`; AC5 `check-docs.test.mjs` (red path and green; 146 findings before, 0 after).
- **228** — AC1–AC3 and AC5 `systems-docs.test.ts` (four groups); AC4 `check-docs.test.mjs` + `check-docs` exit 0.
- **230** — AC1–AC5 `src/comments.test.ts`; scanner `source-tree.test.ts`.
- **229** — AC1–AC5 `scripts/tech-debt.test.mjs`; AC2's completeness is the triage ledger in the story's Done
  section, checked by the review against the diff.

**Manual residue** (reason each; all in `testplan.md`; none holds a story or the sprint open):

- 198 AC1–AC4 — the real window-manager behaviour on X11: game on top of the launcher, borderless with the client
  rect exactly on the stage, lowering on launcher blur, and the cinema overlay above the game with mouse and
  keyboard. It needs a real X server and WM; the user decided against an Xvfb harness (Q5). Also walked there:
  the open park-geometry question (Q3) and the cinema-before-window ordering (TD-023).

**Criteria covered below the real surface**

- 198 AC1–AC4 — proven by protocol-level unit tests (bytes on the wire, call order into the keeper), not by a
  window manager. AC6 is proven end to end only for the unreachable-server path, via the `Q2L_UI_SESSION_TYPE=x11`
  lever on the Windows flow runner.
- 211, 213, 214, 215, 218, 230 — structural criteria (line caps, "grep-zero", import direction, one slot path) are
  proven by source-scanning tests; their flows are regression proof, not acceptance of a user action.
- 227, 228, 229 — doc criteria are proven by structural doc tests (handler names present, files exist, sections
  exist); whether a doc is accurate prose is a reviewer judgement ([TD-027](../../TECH-DEBT.md)).
- 216 AC1 — the unit test for Enter/Space selection uses a click (no `user-event` in the repo); the real Enter is
  proven by flow `tabs-keyboard`.
- 211 AC5 — "byte-identical" is a characterization test over parse outputs and verdicts, not a diff of two builds.

**Changelog sweep:** `CHANGELOG.md` `## Unreleased` carries an entry for each user-facing S33 change: 212 (the
`Config` line under Fixed: refused saves show their reason, a new alias lands in the first category), 216
(name dialogs submit once on Enter, tabs work with the arrow keys), 217 (`Demos` under Changed: quoted search,
third click resets a sort) and 198 (`Demos` under Fixed: the X11 stage stays on top, borderless). No entry was
missing and none was added late. 224, 211, 210, 214, 215, 218, 213, 231, 227, 228, 230 and 229 are internal;
215's one side effect (the replays extra-folder controls disable while a change is saving) is marginal and has none.

## Tier record

| Story     | Ds      | hard Ds | review       | cycles | agents  | build min |
| --------- | ------- | ------- | ------------ | ------ | ------- | --------- |
| 224       | 6       | 1       | default      | 1      | 10      | 88        |
| 211       | 8       | 1       | default+hard | 2      | 13      | 24        |
| 210       | 6       | 1       | default      | 1      | 8       | 33        |
| 214       | 5       | 1       | default      | 1      | 8       | 28        |
| 212       | 6       | 1       | default      | 1      | 10      | 23        |
| 215       | 9       | 1       | default      | 1      | 12      | 59        |
| 216       | 14      | 1       | default      | 1      | 21      | 47        |
| 217       | 6       | 1       | default      | 1      | 10      | 27        |
| 218       | 6       | 1       | default      | 1      | 8       | 28        |
| 213       | 9       | 1       | default      | 1      | 13      | 40        |
| 231       | 5       | 1       | default      | 0      | 7       | 33        |
| 198       | 6       | 1       | default+hard | 2      | 12      | 32        |
| 227       | 5       | 1       | default      | 1      | 8       | 16        |
| 228       | 5       | 1       | default      | 0      | 7       | 16        |
| 230       | 11      | 0       | default      | 2      | 22      | 61        |
| 229       | 3       | 0       | default      | 1      | 5       | 10        |
| **Total** | **110** | **14**  | 2 hard of 16 | 17     | **174** | **~565**  |

Refine took ~8 min (16 in parallel); the gate took 3 min of short suites plus 51 and 50.5 min of `ui:flows`. The
hard review did find what the default review had missed, in both stories that had one: in 211 the two-way type tests
only compared an annotation with itself (and the default review passed it); in 198 the keeper's geometry regex
rejected the emitted `+-N` form. That is two for two this sprint, so the hard tier keeps its place.
