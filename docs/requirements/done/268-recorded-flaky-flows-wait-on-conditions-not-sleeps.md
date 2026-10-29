---
id: 268
title: Recorded-flaky flows wait on conditions, not sleeps
status: done # draft -> ready -> in-progress -> done
created: 2026-10-27
---

## Requirement

As a maintainer, I want the flows that have flaked to wait on a condition instead of a fixed sleep, so
a red result means a regression and not a slow machine, and nobody re-runs a 50-minute suite to find
out.

Today ([review 2026-10-27](../../reviews/2026-10-27-tests-review.md), F07): 35 `waitForTimeout` calls sit
in 18 flow files, plus one in `scripts/lib/servers-lan-flow.mjs:98`. Sprint reviews name the flaky
ones: controls-drag-reorder (S14 `review.md:73`), replays-extra-folders and servers-master-sources
(S26 `review.md:121`), replays-detail-quick-edit failing 40-50% of runs (S33 `review.md:167`). In
the tree at `ed0151a` the sleeps that remain in those four are
`scripts/flows/controls-drag-reorder.mjs:87,94,98,101` and
`scripts/flows/servers-master-sources.mjs:162,165,168`; `replays-detail-quick-edit.mjs` and
`replays-extra-folders.mjs` have none. The no-new-`waitForTimeout` rule exists
(`docs/UI-VERIFICATION.md:626`, stories 223 and 233) but is a convention with no automated check;
story 223 decided to leave existing sleeps alone, so this story reverses that only for the flows with
recorded flakes. The drag flow cites a dnd-kit timing reason for its sleeps. About 22 non-zero
unit-test sleeps are mostly negative assertions ("nothing happened after N ms") with no condition to
wait on; they are out of scope.

## Acceptance Criteria

- [x] **AC1** — `grep -n "waitForTimeout"` over `scripts/flows/controls-drag-reorder.mjs`,
      `scripts/flows/servers-master-sources.mjs`, `scripts/flows/replays-detail-quick-edit.mjs` and
      `scripts/flows/replays-extra-folders.mjs` returns nothing.
- [x] **AC2** — Each of the four flows passes 10 consecutive runs under 4 parallel shards, recorded
      in the Done section (command and result), not one green run.
- [x] **AC3** — Each replaced wait names the state it waits for (a test id, a `waitForFunction`
      predicate or an `expect` on a locator); a seeded defect that never reaches that state makes
      the flow fail at its timeout instead of passing, shown once per flow.
- [x] **AC4** — The drag-reorder flow still asserts the final order after the drag; deleting the
      drop step makes it fail (guards against a vacuous condition).
- [x] **AC5** — A test in `scripts/repo-hygiene.test.mjs` fails when a flow file not on an explicit
      allowlist contains `waitForTimeout`: it fails against a fixture flow with one sleep and passes
      against the repo; the allowlist holds the remaining legacy files and may only shrink.
- [x] **AC6** — `git diff --stat` for this story shows neither `src/main/services/launch.test.ts` nor
      `src/renderer/src/modules/replays/components/DemoDragZone.test.tsx` (negative-assertion sleeps
      stay).

## Open Questions

- ~~Scope of the unit tests: the finding also lists `upgrade-job.test.ts:167,623` and other positive
  waits; the judge would take `launch.test.ts` and `upgrade-job.test.ts` after the flows, the refuter
  says several are negative assertions. Include `upgrade-job.test.ts` here or a follow-up?~~
  answered → Decisions (Sprint)
- ~~Check mechanism for AC5: a hygiene test with an allowlist (above) or an ESLint rule over
  `scripts/flows/`; the lint rule holds a shrinking allowlist less easily.~~ answered → Decisions
  (Sprint)
- ~~Remaining 14 flows with sleeps: fix opportunistically when touched (judge: P3), with the allowlist
  as the ratchet?~~ answered → Decisions (Sprint)
- ~~Not bundled with story 265: this story reduces the cause of re-runs, 265 their cost.~~ answered →
  Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Linux is not a supported platform: it is an additional, manually-run qualification, never part of a pipeline. Scope: flows and launch.test.ts only; hygiene test with a shrinking allowlist; other flows fixed when touched.
- `launch.test.ts` is in scope as an audit, not an edit: its four `setTimeout(…, 25)` sleeps
  (`:529,532,546,615`) are negative assertions ("the cfg is still there after the loop turned") with
  no state to wait on and its positive waits already use `vi.waitFor`, so AC6 stands and the audit
  result goes into Done — converting them would weaken the guard, not de-flake it.
- `upgrade-job.test.ts` gets no follow-up story: the user's scope excludes it, and its remaining
  sleep (`:623`) is a negative assertion too.
- The hygiene test scans `scripts/flows/**/*.mjs` and `scripts/lib/**/*.mjs`, because flow helpers
  in `scripts/lib/` (e.g. `servers-lan-flow.mjs:98`) sleep on behalf of the flows that call them.
- "Shrink only" is enforced by a stale-entry check (an allowlisted file without a sleep fails the
  test), so a fixed flow must leave the list; growing the list is a visible diff for review.
- Not bundled with story 265: confirmed — this story removes a cause of re-runs, 265 their cost,
  and they share no file.
- A red run of `replays-detail-quick-edit` or `replays-extra-folders` (no sleeps today) during
  AC2's runs is root-caused and fixed in that flow with a condition wait inside this story, never
  re-run until green, because AC2 is the story's stability proof.

## Plan

Two flows still sleep (`controls-drag-reorder` 4×, `servers-master-sources` 3×); both drive
dnd-kit, which already exposes the state the sleeps stand in for:

- **Drag in flight:** the Controls preview `.ctrl-drag-preview` (`ControlsDragZone.tsx:371`) exists
  only while a drag is active; the servers list renders a second `servers-source-row-<id>` (the
  `DragOverlay` copy) while an item is picked up.
- **Over a target:** a category chip gets `ctrl-chip-drop-over` (`ControlsDragZone.tsx:206`);
  dnd-kit's live region (`role="status"`) announces "Item … was moved into position N of M."
  (`en.shell.json:751`, `SortableList.tsx:342`).
- **Dropped:** the preview/overlay copy is gone **and** the DOM row order changed — both, since the
  order alone is not a drop signal.

Steps, in order:

1. `controls-drag-reorder.mjs` — `realDrag` waits on started / over-target / dropped instead of
   50/30/200/300 ms; seeded-defect and no-drop runs prove the waits are not vacuous (AC3, AC4).
2. `servers-master-sources.mjs` — `keyboardReorder` waits on "picked up", one announcement per arrow
   press and "dropped" instead of 150/150/300 ms.
3. `scripts/repo-hygiene.test.mjs` — the sleep ratchet (fixture case, repo case, stale-entry case)
   with the 17 remaining legacy files; `docs/UI-VERIFICATION.md:626` says the rule is enforced.
4. Stability: the four flows ×10 under `--parallel=4`, recorded in Done with the AC6 diff check and
   the `launch.test.ts` audit line.

Not touched: unit-test sleeps (`launch.test.ts`, `DemoDragZone.test.tsx`, `upgrade-job.test.ts`),
the 16 other sleeping flows and `scripts/lib/servers-lan-flow.mjs` (allowlisted, fixed when touched).

## Deliverables

- [x] D1 — **`scripts/flows/controls-drag-reorder.mjs` waits on dnd-kit state, not sleeps.**
      Replace all four `page.waitForTimeout` in `realDrag` (`:87,94,98,101`). After the first move
      past the 8px activation distance, wait until `.ctrl-drag-preview` is attached (drag started).
      Drop the per-step 30 ms sleeps. Before `mouse.up()`, after the final
      `mouse.move(…, { steps: 5 })`, wait for the target's over-state: for a category chip
      (`[data-drop-category=…]`) its class `ctrl-chip-drop-over`; for a row target the dnd-kit live
      region (`[role="status"][aria-live]`) reading "was moved into position". After `mouse.up()`
      wait until `.ctrl-drag-preview` is detached, then until the post-drop DOM holds via
      `page.waitForFunction` over `[role="rowgroup"][data-row-id]` — the caller passes that
      predicate as a `realDrag` option (reorder: Multi Bind's index differs from `orderBefore`;
      chip drop: `fixture-action-attack` absent). Every wait uses `CLICK_TIMEOUT_MS` and an error
      message naming the state. Rewrite the module doc comment's last paragraph (the "settles for
      300ms" rationale) to name the conditions; keep the order assertions after each drag as they
      are. Proof, recorded in Done: (a) `npm run ui:flow -- controls-drag-reorder` passes;
      (b) seeded defect — temporarily point the drag-started wait at a selector that never appears →
      the flow fails at that wait's timeout; (c) temporarily delete `await page.mouse.up()` → the
      flow fails. Revert both seeds. Touches only this file.
- [x] D2 — **`scripts/flows/servers-master-sources.mjs` keyboard reorder waits on state.** Replace
      the three `page.waitForTimeout` in `keyboardReorder` (`:162,165,168`): after `Space`, wait
      until the dnd-kit live region (`[role="status"][aria-live]`) reads "Picked up item"; after each
      arrow press, wait until it reads "was moved into position <n>" with the expected 1-based
      position (add a `startPosition` parameter; `ArrowUp` counts down from it, the one caller at
      `:261` starts at `DEFAULT_SOURCES.length + 1`); after the final `Space`, wait until the
      overlay copy is gone (`[data-testid="servers-source-row-<id>"]` count back to 1). The caller's
      `waitForRowOrder` (`:262`) stays the final order assertion. Mirror `waitForRowOrder`'s
      `page.waitForFunction` + `TIMEOUT_MS` shape; error messages name the state. Proof, recorded in
      Done: `npm run ui:flow -- servers-master-sources` passes; seeded defect — temporarily skip the
      first `Space` → the flow fails at the "picked up" wait's timeout. Revert the seed. Touches only
      this file.
- [x] D3 — **Sleep ratchet in `scripts/repo-hygiene.test.mjs`, plus the rule doc.** Add
      `describe('flows wait on conditions')` with a pure helper in the test file,
      `filesWithFixedSleeps(root)` → sorted repo-relative paths (forward slashes) of every `.mjs`
      under `<root>/scripts/flows/` and `<root>/scripts/lib/` whose source contains `waitForTimeout`
      (recursive `readdirSync`, no new dependency). A frozen `LEGACY_SLEEP_ALLOWLIST` of exactly the
      17 files that still sleep after D1/D2 — in `scripts/flows/`: controls-extra-keys,
      drop-message-checkbox, grenade-rows-take-a-key, home-dashboard-arrange, home-hero-carousel,
      news-cover-template, replays-bulk-delete, replays-bulk-one-selected, replays-demo-context-menu,
      replays-demo-file-actions, replays-detail-always-shown, replays-folder-drag-move,
      replays-multi-select, replays-name-templates, servers-lan-no-scan-while-playing,
      servers-no-scan-while-playing (all `.mjs`); plus `scripts/lib/servers-lan-flow.mjs` — with a
      one-line comment: shrink only, a flow leaves the list when it is fixed. Three tests:
      "a flow with one fixed sleep is reported" (writes `scripts/flows/fixture-flow.mjs` with one
      `await page.waitForTimeout(100)` into a `mkdtempSync` root, expects the helper to return it);
      "no flow outside the legacy allowlist sleeps on a fixed timeout" (repo root; result minus
      allowlist is `[]`); "every legacy allowlist entry still sleeps" (allowlist minus result is
      `[]`). In `docs/UI-VERIFICATION.md` (`:626`, "New flows do not use `waitForTimeout`…") add one
      sentence: `scripts/repo-hygiene.test.mjs` enforces this; its legacy allowlist only shrinks, and
      a legacy flow that is touched is fixed and leaves it. Touches only these two files.
- [x] D4 — **Stability record.** Run `npm run ui:flows -- controls-drag-reorder
      servers-master-sources replays-detail-quick-edit replays-extra-folders --repeat=10
      --parallel=4` and record the command and per-flow result (10/10 each) in Done. A red run is
      root-caused and fixed in its flow with a condition wait, then the whole command is repeated —
      never a partial re-run. Also record in Done: `git diff --stat` of the story (neither
      `src/main/services/launch.test.ts` nor `DemoDragZone.test.tsx`) and the `launch.test.ts` audit
      line (four negative-assertion sleeps at `:529,532,546,615`, left by decision). Touches no file
      unless a run is red.

## Model Hints

- D1 → deliverable-hard: the drag sleeps were found by trial against dnd-kit's pointer sensor (an
  immediate read once saw the pre-drop order), and the conditions must be neither vacuous (row
  order alone can be read mid-drag) nor racing the drop's async persist, under a 10-run × 4-worker
  stability bar.
- Review: → default

## Acceptance Tests

- AC1 → unit `scripts/repo-hygiene.test.mjs` › "no flow outside the legacy allowlist sleeps on a
  fixed timeout" (none of the four flows is on the allowlist) — D3, after D1/D2.
- AC2 → e2e `scripts/flows/controls-drag-reorder.mjs`, `scripts/flows/servers-master-sources.mjs`,
  `scripts/flows/replays-detail-quick-edit.mjs`, `scripts/flows/replays-extra-folders.mjs` › flows
  "controls-drag-reorder", "servers-master-sources", "replays-detail-quick-edit",
  "replays-extra-folders", run with `--repeat=10 --parallel=4`; command and counts in Done — D4.
- AC3 → e2e `scripts/flows/controls-drag-reorder.mjs` › "controls-drag-reorder" (D1) and
  `scripts/flows/servers-master-sources.mjs` › "servers-master-sources" (D2), each plus its
  seeded-defect run failing at the named wait's timeout, recorded once per flow in Done. The two
  replays flows replace no wait, so AC3 has nothing to show for them.
- AC4 → e2e `scripts/flows/controls-drag-reorder.mjs` › "controls-drag-reorder" — order assertions
  kept; the run without `mouse.up()` fails, recorded in Done — D1.
- AC5 → unit `scripts/repo-hygiene.test.mjs` › "a flow with one fixed sleep is reported", "no flow
  outside the legacy allowlist sleeps on a fixed timeout", "every legacy allowlist entry still
  sleeps" — D3.
- AC6 → review check: `git diff --stat` in Done shows neither file — D4; a negative property of the
  diff that the default review re-checks against the commit.

## Done

Both sleeping drag flows now wait on dnd-kit state (preview attached/detached, over-state, live-region announcements, post-drop DOM predicate); a ratchet test in `scripts/repo-hygiene.test.mjs` keeps flows and `scripts/lib` sleep-free outside a 17-file shrink-only allowlist.

Commit: `268: drag-reorder and servers-sources flows wait on dnd-kit state, sleep ratchet in repo-hygiene`

Verification (narrow gate): `npx vitest run scripts/repo-hygiene.test.mjs` 14/14; lint, typecheck, build green.
- AC1 -> hygiene "no flow outside the legacy allowlist sleeps on a fixed timeout" passed; grep of the four flows: 0 hits.
- AC2 -> `npm run ui:flows -- controls-drag-reorder servers-master-sources replays-detail-quick-edit replays-extra-folders --repeat=10 --parallel=4`: 40/40 (10/10 each). First run was 39/40 (replays-extra-folders, `openDemosView` clicked a breadcrumb that vanished); fixed with a condition loop, whole command repeated green.
- AC3 -> seeded defects: drag-start selector that never appears fails at "drag to start" (8000ms); skipping the first Space in servers-master-sources fails at "picked up" wait.
- AC4 -> drag flow without `mouse.up()` fails at "drag to end (.ctrl-drag-preview detached)"; order assertions kept.
- AC5 -> hygiene tests "a flow with one fixed sleep is reported", repo case, stale-entry case passed.
- AC6 -> `git diff --stat` has no `src/` file; `launch.test.ts` audit: four 25 ms negative-assertion sleeps (:529,532,546,615) left by decision.
- Review (default, 1 cycle): PASS; unfixed notes: `.catch(() => {})` in `openDemosView` is broad, one long doc line.

Decisions:
- servers-master-sources: the wait after the first Space accepts "Picked up item" or "was moved into position" because dnd-kit's onDragOver overwrites the pickup text before a poll sees it; skipping Space still fails.
- Row-target over-state waits on "position N of" with the target's own N, since the drag start already announces the dragged row's position.
- `realDrag` takes a required `dropped` option (state, predicate, arg).
- No changelog entry: no user-facing change.

tiers: D 4 / hard 1 · review default · cycles 1 · agents 8
