# Codebase and architecture review — 2026-10-01

A whole-repo review of Q2 Launcher at commit `8765441` (after S31, 197 stories, 0.6.0): twelve
independent reviewers, one dimension each, 119 raw findings merged into 75, the top findings
checked by an adversarial second reader. The result is this report plus the story drafts
199–231 under [requirements/](../requirements/), one per refactoring the review recommends.

How to read it: the **story map** below is the actionable part. The **findings table** is the
evidence behind it and the place to look before touching an area. Full per-finding evidence lives
in the story that owns it.

## Verdict

The project is in better shape than its growth rate suggests. What the house rules cover, the
code does well: a textbook typed shell IPC with boot-time and compile-time contract checks, a
sandboxed renderer behind a 52-line preload allowlist, a pure `src/shared`, atomic persistence
with backup and quarantine, main services built by constructor injection and testable without
Electron, pure config and list logic under fast unit tests (6,243 tests in ~37 s), near-perfect
design-token discipline in TSX, and a spec-driven process that records every decision.

The weaknesses are structural and all of one kind: **conventions that were never turned into
code**. Five of them explain most of the 75 findings.

1. **The module bus is the untyped majority.** 138 of 188 IPC handlers go through `module:invoke`,
   where the handler name is a string, the result type a cast, and the registry wraps every
   `Outcome` in a second `Outcome`. Clients flatten it four different ways; servers and replays
   invented their own refusal shapes instead. (F03, F04, F29, F30)
2. **The shell owns every module's state.** `lib/schemas.ts` (1,655 lines, 55 commits) and
   `StateStore` hold every module's persisted slice; every module since story 071 has edited
   three shell files and two shell tests. Whole-section setters already produced four
   read-await-write races. (F02, F08, F09, F25)
3. **Patterns were mirrored by copy, not lifted.** "Mirrors X exactly" appears throughout: the
   read-on-mount hook (36 copies), the name dialog (12+), the forgiving row parse (11 beside its
   own helper), the job lifecycle (9), package staging (4), fetch-with-timeout (6 policies). Copies
   have already drifted into bugs: `isInsideDir`, the Aliases-tab category default, Enter-key
   double submit, `undefined` vs `null` sort sentinels. (F11, F13, F17, F18, F19, F20, F47, F54)
4. **Two files absorbed the config module.** `profile-restore.ts` (4,185 lines, one 487-line
   function) and `config/index.ts` (35 handlers plus the save/sync business logic inside one
   `setup()` closure, testable only by booting the module) — and `ControlsTab.tsx` (2,524 lines,
   34 state atoms) is the renderer twin. (F07, F14, F15, F16, F40)
5. **Nothing enforces the boundaries, and the docs lag.** No linter, no architecture test; the
   e2e gate has been red for five sprints with no quarantine; CLAUDE.md still says the modules are
   "not implemented"; tech debt lives in 34 unprioritised roadmap bullets. (F21, F23, F24, F56)

Two findings are correctness or safety issues rather than debt and should go first: the
reveal-path containment check is a string prefix on an unresolved path (F01), and a thrown shell
handler reaches the renderer as English prose with a filesystem path (F10).

## Story map

Stories are drafts (`status: draft`) for `/refine`. Priority: **P1** next refactoring sprint(s),
**P2** soon, **P3** opportunistic. Effort is the review's estimate. The order inside a priority is
a sensible build order; "after" names hard dependencies.

| # | Story | Findings | Prio | Effort | After |
| --- | --- | --- | --- | --- | --- |
| 199 | path containment is one checked rule | F01 | P1 | S | — |
| 200 | a thrown shell handler answers with an i18n key, not prose | F10 | P1 | S | — |
| 201 | the launcher shuts down in order and says when a write failed | F05 F50 F08 | P1 | M | — |
| 202 | state slices are mutated in place, never replaced from a snapshot | F09 | P1 | M | — |
| 203 | forgiving row parsing is one helper | F25 | P1 | S | — |
| 226 | the repo is formatted once and its dependencies are current | F57 F58 | P1 | S | — |
| 229 | tech debt has one home and an ageing rule | F24 | P1 | S | — |
| 227 | the docs describe the launcher as built | F23 F33 F51 F60 F61 F66 F73 | P1 | M | — |
| 204 | the module bus returns one Outcome envelope and every error key resolves | F04 F31 | P1 | M | — |
| 206 | a refusal is one shape with a full i18n key and one toast path | F04 | P1 | M | 204 |
| 205 | module handlers are typed from a contract and every declared handler is live | F03 F29 F30 | P1 | L | 204 |
| 207 | modules own their persisted state | F02 F33 F08 | P1 | L | 202 203 |
| 208 | layer rules are a test and a linter, not a convention | F56 F06 F59 | P1 | M | — |
| 220 | package staging is one path and the dead download queue is gone | F12 F13 F43 F45 | P1 | M | — |
| 210 | the config module's main side is handlers, not business logic | F07 | P1 | M | — |
| 212 | saving a profile edit is one hook, and a new alias lands in a real category | F17 F39 | P1 | M | — |
| 213 | the Controls tab is a component tree with a shared test harness | F16 F41 F42 F66 | P1 | L | 212 |
| 223 | the flow gate is green or says why | F21 F59 F72 | P1 | L | — |
| 209 | modules reach Electron and the harness only through the shell | F27 F28 F26 | P2 | M | 208 |
| 211 | config profile shapes are declared once | F15 F36 F37 | P2 | M | — |
| 215 | main-owned data is read through one query hook | F19 F48 F61 | P2 | M | 206 |
| 216 | the UI kit has name, confirm, tabs and one error boundary | F18 F74 F68 | P2 | L | — |
| 217 | list sort and search are shared | F47 | P2 | S | — |
| 218 | the config detail screen reads its profile from a provider | F40 | P2 | M | 212 215 |
| 219 | jobs share one runner, one busy rule and one failure log | F11 F44 F55 F46 | P2 | L | 220 |
| 221 | HTTP fetches share one timeout and size policy | F20 | P2 | S | — |
| 222 | platform rules live in one module | F32 F64 | P2 | S | — |
| 224 | the e2e fixture and flow helpers are shared and schema-checked | F22 F52 | P2 | M | 223 |
| 225 | tests share a quiet logger and one test-support kit | F53 F54 F71 | P2 | M | — |
| 228 | every shipped module has a system doc | F35 | P2 | M | 227 |
| 214 | profile-restore is a folder of named stages | F14 F65 | P3 | M | — |
| 230 | comments state invariants, not sprint history | F38 | P3 | M | 227 |
| 231 | i18n keys are referenced, not duplicated, and live with their module | F62 | P3 | M | — |

A suggested cut into sprints, each demonstrable on its own:

- **Foundations** (all S/M, low risk): 199, 200, 201, 202, 203, 226, 229, 227.
- **The bus**: 204, 206, 205, 208, 220.
- **Config**: 210, 212, 213, 211.
- **Shared layers**: 215, 216, 217, 218, 219, 221, 222.
- **Gate and tests**: 223, 224, 225, 209, 228.
- P3 stories ride along with whichever story next touches their files.

## Findings

Severity is the reviewers' corrected rating. **Check** says how the finding was verified:
*refuter* = an independent agent tried to refute it against the code and failed; *judged* = a
value judge grounded it in churn and code; *spot* = re-counted by hand for this report;
*reviewer* = the reviewer's own evidence only. One finding was refuted (F06) and is kept for the
record. "Tracked" marks items the roadmap's follow-ups already named.

| Id | Sev | Finding | Check | Story |
| --- | --- | --- | --- | --- |
| F01 | high | `app:revealPath` containment is a `startsWith` on an unresolved path; `absolutePathSchema` never checks absoluteness; `isInsideDir` copied 3x with a trailing-separator drift | refuter | 199 |
| F02 | high | Shell owns every module's persisted state (`lib/schemas.ts` 1,655 lines) and imports module internals in five places | refuter | 207 |
| F03 | high | 138 module-bus handlers, clients and events are typed by cast, not derived from a contract | refuter | 205 |
| F04 | high | Registry wraps handler Outcomes again (`Outcome<Outcome<T>>`); five in-band refusal shapes; the error toast literal copied 12x | refuter | 204, 206 |
| F05 | high | `before-quit` never awaits flushes or calls `disposeAll()`; replays has no `dispose()`; singletons exist to work around it (tracked) | refuter | 201 |
| F06 | high | Renderer shell imports module internals and modules import each other (11 imports) — **refuted**: every import is a recorded story decision; only the missing enforcement stands | refuter | 208 |
| F07 | high | `config/index.ts`: 35 handlers plus save/sync logic inside a 1,443-line `setup()`; its test boots the module 13 times | refuter | 210 |
| F08 | high | `state.json` (216 KB) rewritten whole and un-debounced on every sort/filter/favourite click | refuter | 201, 207 |
| F09 | high | Whole-section setters force read→spread→set in ~20 handlers; four read-await-write races live | refuter | 202 |
| F10 | high | Zero `try` under `src/main/ipc`; a throw crosses IPC as Electron's English error text with a path | judged, spot | 200 |
| F11 | high | Job lifecycle hand-rolled in nine job files; no cross-module per-installation exclusivity | judged | 219 |
| F12 | high | Download pipeline/queue has no caller; two of three Downloads settings persist values nothing reads | judged, spot | 220 |
| F13 | high | Download→verify→extract staging exists four times; the unpinned download bypasses the hardened fetcher | refuter | 220 |
| F14 | high | `profile-restore.ts`: 4,185 lines, 63 functions, one 487-line function with 13 closures | refuter | 214 |
| F15 | high | `ConfigAction`/`ConfigProfile` modelled three times with untyped parallel zod trees; dead legacy-key shim | judged | 211 |
| F16 | high | `ControlsTab`: 2,524 lines, 34 `useState`, duplicated slot/row renderers, un-memoised row pipeline | judged | 213 |
| F17 | high | Save/debounce/status flow copied across five config components with four failure behaviours | judged, spot | 212 |
| F18 | high | No `NameDialog`/`ConfirmDialog`/`Tabs` primitives: name dialog ~12x, confirm ~18x, tab strip 3x; Enter-key drift | spot | 216 |
| F19 | high | Read-on-mount idiom (`let cancelled = false`) 36x in 26 renderer files; no query hook | spot | 215 |
| F20 | high | Six fetch wrappers, six policies; the user-supplied list source has no timeout or byte cap (tracked) | spot | 221 |
| F21 | high | 136 flows, 49 min, four red for five sprints, no quarantine, 4 run in CI (tracked) | spot | 223 |
| F22 | high | `fixture.mjs`: 5,737 hand-mirrored lines, never validated against the real schema (`STATE_SCHEMA_VERSION` 1 vs 5) | reviewer | 224 |
| F23 | high | CLAUDE.md, ARCHITECTURE.md, README describe a four-module plan; checklist misses steps; no doc-drift guard (tracked) | spot | 227 |
| F24 | high | Tech debt is prose: 34 unprioritised follow-ups plus "unfixed" lists in sprint reviews | reviewer | 229 |
| F25 | high | Forgiving row-parse dance hand-rolled 8–11x beside its own `parseForgivingRows` | spot | 203 |
| F26 | med | mods/servers/replays import downloads' internals (18 imports): infrastructure lives in a module | reviewer | 209 |
| F27 | med | Six module files import `electron`; replays reaches the `BrowserWindow` past the observer | spot | 209 |
| F28 | med | The UI-harness gate is spelled three ways and read from `process.env` inside modules | reviewer | 209 |
| F29 | med | Per-handler schemas live in three places per module; `moduleId` enum hand-written (tracked) | reviewer | 205 |
| F30 | med | No bus-wide handler coverage test; six declared handlers have no renderer caller | spot | 205 |
| F31 | med | Error-key/locale consistency is discipline, not a test; mods keys stringly typed | reviewer | 204 |
| F32 | med | Platform branching in ~30 files with a divergent case-folding rule (tracked) | reviewer | 222 |
| F33 | med | Two migration mechanisms coexist; ARCHITECTURE.md describes neither | reviewer | 207, 227 |
| F34 | med | `createUpdateService` is a 480-line closure factory with 20 inner functions | reviewer | — (P3) |
| F35 | med | `systems/` and `concepts/` docs unmaintained; four shipped modules have no system doc (tracked) | reviewer | 228 |
| F36 | med | Two restore-input adapters and four restored-to-profile field assemblies | reviewer | 211 |
| F37 | med | Render tests and fixture corpora live behind main-side re-export shims | reviewer | 211 |
| F38 | med | ~4,800 story-number references in source; stale headers; `[diag187]` lines in production | spot | 230 |
| F39 | med | Alias created from the Aliases tab lands in a possibly non-existent category | spot | 212 |
| F40 | med | `ConfigView` (1,067 lines) owns the profile list and drills a four-prop draft into every tab | reviewer | 218 |
| F41 | med | Per-profile reset via `useEffect` (30 setState-in-effect sites, 29 orphaned eslint-disables) | spot | 213 |
| F42 | med | Seven private ControlsTab test harnesses; 16 large config components with no test | reviewer | 213 |
| F43 | med | Two `ManifestService` instances share one cache file; `CatalogService` clones the pattern | spot | 220 |
| F44 | med | Write-phase failure leaves installation status stale in six jobs, not two (tracked) | reviewer | 219 |
| F45 | med | `bootstrap/job.ts`: an 860-line function with a double-copy extras pass (tracked) | reviewer | 220 |
| F46 | med | Failure log skips mods jobs; `missingChecks` drop interpolation params (tracked) | spot | 219 |
| F47 | med | Column-sort machinery duplicated per module with `undefined` vs `null` sentinels | reviewer | 217 |
| F48 | med | ServersView/ReplaysView/Dashboard are 450–560-line components; ServersView re-sorts every render | reviewer | 215 |
| F49 | med | Boot blocks on config file I/O; a module whose setup throws keeps its handlers live | reviewer | — (P3) |
| F50 | med | `state.json` write failures are logged and never shown | reviewer | 201 |
| F51 | med | No written error/logging policy; 114 bare catches; warn is the catch-all | reviewer | 227 |
| F52 | med | Servers/replays flow helpers copied into 15–22 flow files each, already drifting | spot | 224 |
| F53 | med | Logger never silenced in tests: 622 output blocks per run; electron-log loaded by every main test | spot | 225 |
| F54 | med | No shared test-support: fakes and builders duplicated per test file | reviewer | 225 |
| F55 | med | Mods jobs keep three process-global in-flight registries with asymmetric busy rules | spot | 219 |
| F56 | med | Layer boundaries held by convention and four per-file regex tests; no linter (tracked) | reviewer | 208 |
| F57 | med | Repo not prettier-clean (1,044 files); `.gitattributes` empty; no format gate | spot | 226 |
| F58 | med | Obsolete jsdom patch; 6 high audit findings; no dependency automation (tracked) | spot | 226 |
| F59 | med | Gate regressions come from flows asserting other stories' details; a repo-wide guard hides in one module | reviewer | 223, 208 |
| F60 | med | CLAUDE.md deviations table repeats one 44px rule fifteen times | reviewer | 227 |
| F61 | med | `useLauncher` mixes mirror, UI state and 25 actions; five stores, five contexts, no rule | reviewer | 227, 215 |
| F62 | med | `en.json`: 518 duplicate-value keys, ~25 dead keys, unchecked | spot | 231 |
| F63 | low | Optional service deps for test convenience leak into production guards | reviewer | — |
| F64 | low | Listener-set emitter hand-written 10x; `looksLikeQuake2` duplicated | reviewer | 222 |
| F65 | low | `src/shared/config` is a flat bag of 42 modules | reviewer | 214 |
| F66 | low | No placement rule inside renderer modules | reviewer | 227, 213 |
| F67 | low | `controls-grid.css`/`surfaces.css` hardcode token colours as rgb literals | reviewer | — |
| F68 | low | Three downloads dialogs hand-roll the same start/track state machine | reviewer | 216 |
| F69 | low | Playback channel: platform decisions leak outside the seam | reviewer | — |
| F70 | low | Playback terminate has no SIGKILL escalation (tracked) | reviewer | — (tracked) |
| F71 | low | Five test files over 2,000 lines are story-chronological append logs | reviewer | 225 |
| F72 | low | CI: no Windows UI verification; setup duplicated across four workflows | reviewer | 223 |
| F73 | low | Story/sprint templates cite paths that do not exist and lack the Decisions section | reviewer | 227 |
| F74 | low | Four error boundaries, three hand-rolled copies | reviewer | 216 |
| F75 | low | No typography tokens: 51 arbitrary micro font sizes | reviewer | — |

Left out of stories on purpose: F34 and F49 (cold areas; do when the file is next open), F63,
F67, F69, F75 (small, no drift risk), F70 (already a roadmap follow-up with its fix described).

## Method and limits

- Reviewers: architecture and security, IPC contract, main services, config core, config
  renderer, downloads and mods, servers/replays/home, renderer shell and state, tests and tooling,
  docs and process, cross-module duplication, robustness. Each read the code, counted, and was
  told that a documented deviation is not a finding.
- Verification: F01–F09, F13 and F14 survived an adversarial refuter; 22 findings got a value
  judgement with churn data, which shaped the story scoping (smaller, incremental, type-first).
  The run hit a usage limit before F15–F75 were refuted, so those carry the reviewer's own
  evidence plus the hand spot-checks marked above. Treat a *reviewer*-only count as approximate;
  `/refine` re-measures before it plans.
- Numbers are as of commit `8765441` on `dev`, Windows worktree.
