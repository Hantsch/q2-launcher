---
id: 027
title: UI verification runs in one session per fixture, without stealing focus
status: done # draft -> ready -> in-progress -> done
created: 2026-08-20
---

## Requirement

The harness from story 026 works, but it is unusable while it works: `npm run ui:verify` starts
and closes the real app 56 times, and every one of those windows comes to the foreground and
takes the keyboard focus away from whatever I am doing. A run takes about two minutes during
which the machine is effectively mine no longer. The result is that I run the verification less
often than the story intended — which defeats the point of having it, namely that a live smoke
becomes cheap enough for a build session to do it in passing.

I want a run that starts the app as few times as it actually needs, and that does not push
itself in front of my work while it does. Same evidence, same honesty about what could not be
reached — just quiet and fast.

Measured facts about the current implementation, so nobody has to re-derive them:

- `scripts/shot.mjs:141-147` and `scripts/a11y.mjs:241-247` both loop
  `for (SCREENS) → for (viewports)` and call `withApp()` inside, which is one
  `_electron.launch` + `app.close()` each: 14 screens x 2 viewports x 2 scripts = 56 app
  starts per `ui:verify`.
- Cost per cycle, from the timestamps of the last run in `.ui-verify/screenshots/`
  (09:53:39 -> 09:54:12 for 18 files): ~1.85 s, i.e. ~50 s for `ui:shot` alone and a good two
  minutes for `ui:verify`.
- The focus theft comes from `src/main/window.ts:164-168`: the window is created with
  `show: false` and shown on `ready-to-show` via `window.show()`, which activates and raises it.
  The harness cannot prevent this from the outside — it happens before Playwright hands the
  window over.
- **Restarting the app is not the isolation it looks like.** `setRoute` persists `lastRoute`
  through `settings:patch` (`src/renderer/src/store/useLauncher.ts:141-144`) and the store reads
  it back at boot (`:113`), so every screen starts in whatever state its predecessor left
  behind — restart or not. On top of that `ensureFixtures()` (`scripts/shot.mjs:37-45`) only
  seeds when the file is *missing*, so run N+1 inherits run N's drift. Determinism has to come
  from rewriting the fixture, not from ending the process.
- `ui:shot` and `ui:a11y` currently drive two different app instances, so the accessibility
  report is not about the state in the PNG — which is the one thing the `ui-verify` skill says
  sharing the harness is for.

The sister project `second-brain` implements the same skill with 3 app starts per run
(`scripts/shot.mjs:1172` cold states, `:1223` main session, `scripts/a11y.mjs:274`), switching
viewports inside the session via `session.resize()`. The 20x difference is not a difference in
requirements, it is a rule the skill never wrote down.

## Acceptance Criteria

- [x] A full `npm run ui:verify` starts the app at most once per fixture variant plus one per
      screen explicitly marked as needing a cold start — for today's registry that is 2 starts,
      down from 56 — and the number of starts is reported in the run summary.
- [x] The app windows a run opens do not take the keyboard focus: while a run is going, I can
      keep typing in another window without interruption. Normal `npm run dev` / packaged
      launches are unchanged.
- [x] Screenshots and the accessibility report for a screen come from the same visit to that
      screen, so `a11y.json` provably describes the state in the corresponding PNG.
- [x] Every screen still gets its own verdict: console errors, renderer exceptions and
      unreachability are attributed to the screen that caused them, not to the session.
- [x] A crash or an unreachable screen does not cost the rest of the run: the remaining screens
      are still visited, and the failure is reported as before.
- [x] Each run starts from a freshly written fixture, so two consecutive runs of the same build
      produce the same screens — the current "seed only if missing" drift is gone.
- [x] A screen whose subject *is* the cold boot can declare that in the registry and gets its own
      app; the declaration is visible in the registry, not hidden in the driver.
- [x] I can restrict a run to named screens for a fast edit/verify loop, and a restricted run
      says that it is partial (no stale-renaming of images it never tried to write).
- [x] The exit-code contract from story 026 is unchanged: `0` clean, `1` harness/app failure,
      `2` accessibility findings.
- [x] `docs/UI-VERIFICATION.md` documents the session model, when a screen needs a cold start,
      and how to run a partial verification.

## Open Questions

Research done (current harness read in full, plus the sister project `second-brain`'s
`scripts/shot.mjs`/`a11y.mjs`/`lib/app-harness.mjs`, which implements the same skill at 3 app
starts instead of 56):

- **Do `ui:shot`/`ui:a11y` stay separate, or does only `ui:verify` remain?** ~~answered~~ — Neither
  literally. `second-brain` doesn't actually solve "same visit": it still runs `shot.mjs` and
  `a11y.mjs` as two independent sessions (2 launches + 1 launch), so a screenshot and its axe
  result can drift. This story's AC3 ("same visit") is stricter and forces screenshot+axe capture
  to happen back-to-back on the same page state, in one driver. Decision: one shared per-screen
  driver (D2) does both; `ui:shot`/`ui:a11y`/`ui:verify` become thin CLI wrappers around it
  (`--skip-axe` / `--skip-shot` / neither) so the two existing npm scripts keep working for a
  human who wants just one artifact, without losing the "same visit" guarantee when both run
  together.
- **Tie no-focus to the existing harness env, or a general "verification mode"?** ~~answered~~ —
  There is no harness-mode flag today (`grep -rE 'E2E|PLAYWRIGHT|UI_VERIFY|HARNESS' src/main`:
  zero hits); it has to be introduced from scratch either way. The first-run-scan-off behaviour
  the question raises is *already* solved without an env flag — the `empty` fixture sets
  `settings.scanOnFirstRun: false` directly in the seeded `state.json` (`scripts/lib/fixture.mjs`,
  story 026 Decisions), not via a runtime mode switch. So there is only one boot-time behaviour
  left that genuinely needs an env flag (focus), and introducing a generic "verification mode" for
  a single consumer is speculative. Decision: one dedicated, generically-named env var (e.g.
  `Q2L_UI_HARNESS=1`), set by `harness.mjs`'s `childEnv()` next to the existing
  `ELECTRON_RUN_AS_NODE` scrub, read once in `window.ts`. If a second boot-time behaviour ever
  needs gating, it reads the same flag — nothing here forecloses that, it just isn't built
  speculatively now.
- **Fully invisible window, or "visible but never focused"?** ~~answered~~ — "visible but never
  focused": `focusable: false` in the `BrowserWindow` constructor plus `window.showInactive()`
  instead of `window.show()` in the `ready-to-show` handler (`window.ts:164-168`). This keeps the
  window on Electron's normal compositor/paint path (no `paintWhenInitiallyHidden`/offscreen
  gotchas), which directly serves AC2 (no focus) without introducing the blank/stale-frame risk
  the story itself calls out as a failure mode an evidence harness must not have. Fully invisible
  (`offscreen: true` or never calling `show()`) was rejected: it rewrites the input path
  (`sendInputEvent` instead of real Playwright clicks) and has known Windows GPU-driver quirks —
  a materially bigger change for a story whose actual requirement (AC2) is "don't steal focus",
  not "be invisible."

## Plan

Today: `harness.mjs`'s `withApp()` = one `_electron.launch()` + one `app.close()` per call;
`shot.mjs`/`a11y.mjs` each loop `for (SCREENS) for (viewports)` calling `withApp` every iteration
(14 x 2 x 2 = 56). Viewport switching (`applyViewport()`, `harness.mjs:323`) already runs
mid-launch via `app.evaluate` + `win.setSize` — it's callable more than once, nothing currently
does. Fixture write (`fixture.mjs`) is unconditional; the "only if missing" drift is in the
*caller* (`ensureFixtures()`, duplicated 3x across `shot.mjs`/`a11y.mjs`/`ui-verify.mjs`).

1. **Registry + mid-session resize.** `screens.mjs` gets an optional `coldStart` field (default
   off — today's 14 screens use none). `harness.mjs` gets a `resize(app, viewport)` export (the
   existing `applyViewport` body, made callable repeatedly without relaunching) and adds the new
   harness-mode env var to `childEnv()`.
2. **Unified per-variant session driver.** New `runVariantSession({ variant, screens, capture })`
   in `harness.mjs` (or a new `scripts/lib/session.mjs`): one launch per fixture variant (2 today:
   `populated`, `empty`), loops its screens x viewports, and for each does navigate → resize →
   screenshot (if requested) → axe (if requested) in the same page visit, each wrapped in its own
   try/catch so one screen's failure doesn't stop the loop. `coldStart` screens get their own
   dedicated `withApp()` call each, outside the batched sessions. Fixture is always rewritten (drop
   the exists-check entirely — `writeFixture()` itself is already unconditional).
3. **Merge entry points.** New `scripts/verify.mjs` driving the session for the needed variants;
   `ui:shot` = `--skip-axe`, `ui:a11y` = `--skip-shot`, `ui:verify` = both. Add `--screens=a,b,c`
   filtering (validated against the registry) and a `full` flag gating the stale-PNG sweep, mirrored
   on `second-brain`'s `shot.mjs:99-107`/`:1275`/`:1287`. Exit code (0/1/2) assembled in-process
   (no more spawning two child scripts from `ui-verify.mjs`). Run summary reports the actual launch
   count.
4. **Focus suppression.** `window.ts`: when the harness env var is set, construct with
   `focusable: false` and call `showInactive()` instead of `show()` in `ready-to-show`; both are
   no-ops (normal behaviour) when the var is unset.
5. **Docs.** `docs/UI-VERIFICATION.md`: session model, `coldStart` registry field, `--screens`
   partial-run usage.

## Deliverables

**D1 — Registry field + mid-session resize + env plumbing.** [DONE] `scripts/lib/screens.mjs` (add
`coldStart?: boolean` to the entry shape, default unset — no existing entry sets it),
`scripts/lib/harness.mjs` (export `resize(app, viewport)` — lift `applyViewport`'s body so it can
be called more than once per launch; `childEnv()` also sets the new harness-mode var, e.g.
`Q2L_UI_HARNESS=1`, alongside its existing `ELECTRON_RUN_AS_NODE` delete).
*Acceptance:* a throwaway script that launches once and calls `resize()` twice with different
sizes resizes the window both times without a second launch; `childEnv()`'s returned object
contains the new var; existing `withApp()` callers are unaffected (still resize once at launch).

**D2 — Unified per-variant session driver.** [DONE] `scripts/lib/harness.mjs` or new
`scripts/lib/session.mjs` — `runVariantSession({ variant, screens, capture: { shot, axe } })`:
one launch per variant, loop screens x viewports (navigate → `resize()` → screenshot if
`capture.shot` → axe if `capture.axe`, same page state for both), per-iteration try/catch
classifying `written`/`audited`/`unreachable`/`error` (reusing the classification shape from
today's `shootOne()`/`auditOne()` in `scripts/shot.mjs:67-124`/`scripts/a11y.mjs:69-134`),
`coldStart` screens get their own `withApp()` call each. Fixture: caller always calls
`writeFixture(variant)` for every variant in use — delete the `existsSync`-gated skip in
`ensureFixtures()` wherever it currently lives.
*Acceptance:* running the driver over the existing 14-screen registry with `capture: {shot:true,
axe:true}` produces the same screenshots + axe results as today's separate `shot.mjs`+`a11y.mjs`
runs, using 2 launches total instead of 56; breaking one screen's `data-testid` still lets the
other 13 complete and reports that one screen as `unreachable`; running twice in a row produces
byte-identical `run.json` (fixture no longer drifts).

**D3 — Merge entry points, CLI flags, exit codes.** [DONE] New `scripts/verify.mjs` (replaces the bodies
of `scripts/shot.mjs`/`scripts/a11y.mjs`, which either become thin wrappers or are deleted in
favour of it), `scripts/ui-verify.mjs` (calls the unified driver in-process instead of spawning
two child scripts), `package.json` (`ui:shot`, `ui:a11y`, `ui:verify` point at the new script with
flags). `--screens=a,b,c` filters the registry (unknown name = hard error); `full = screens.length
=== SCREENS.length`, gates the stale-PNG sweep, and a partial run says so in its summary/log.
Exit code: `0` clean, `1` harness/app failure, `2` a11y serious/critical present — computed once,
in-process. Run summary prints the actual launch count.
*Acceptance:* `npm run ui:shot`, `npm run ui:a11y`, `npm run ui:verify`, and `npm run ui:verify --
--screens=home,settings` each run and produce correct, correctly-scoped artifacts; the summary
states the launch count (2 for a full run) and, for the restricted run, that it is partial and did
not stale-sweep; exit codes match the three cases from story 026's existing contract.

**D4 — Window focus suppression.** [DONE] `src/main/window.ts` (`focusable: false` in the
`BrowserWindow` constructor and `window.showInactive()` in place of `window.show()` in the
`ready-to-show` handler, both gated on the new harness env var being set), `scripts/lib/harness.mjs`
(already sets the var in D1's `childEnv()` change — this D only consumes it).
*Acceptance:* launching via the harness (var set) never raises/activates the window (manual check,
see Test Plan); `npm run dev` and a packaged launch (var unset) show/focus exactly as before —
verified by reading the code path, since this environment cannot demonstrate Windows focus
behaviour directly (see Test Plan).

**D5 — Docs.** [DONE] `docs/UI-VERIFICATION.md`. Documents: the per-variant session model and launch
count, how to mark a screen `coldStart: true` and why (a screen whose subject *is* the cold boot),
`--screens` for a partial run and what "partial" changes about stale-sweep behaviour, and the
harness-mode env var's purpose.
*Acceptance:* doc matches the shipped behaviour; no remaining reference to `shot.mjs`/`a11y.mjs`
as separate always-two-launch scripts.

## Model Hints

- `D2 → deliverable-hard` — this is the deliverable that can silently half-work: it changes the
  isolation/classification/fixture-freshness guarantees the whole harness exists to provide (a
  regression here reads as "harness still green" while quietly losing per-screen attribution or
  reintroducing fixture drift), and D3/D4 build on its output shape.
- `D4 → deliverable-hard` — Windows-specific `BrowserWindow` activation behaviour
  (`focusable`/`showInactive` interaction) that cannot be manually verified in this Linux/WSL2 dev
  environment; a wrong flag combination could either fail silently on Windows while looking fine
  here, or make the window unfocusable during normal (non-harness) use.
- D1, D3, D5 → default.
- `Review: → story-review-hard` — the story rewrites the harness's own correctness guarantees
  (isolation, exit codes, fixture freshness) and changes real main-process window behaviour in the
  same story; a fresh Opus-tier pass lowers the chance a subtle regression in either ships quietly.

## Test Plan (manual acceptance)

1. `npm run ui:verify` — confirm the summary reports the launch count (2 for today's registry,
   down from 56) and finishes in well under a minute.
2. Run it again, this time with a text editor focused and typing continuously while it runs —
   **on a real Windows session**, not this WSL2/Linux dev environment, since OS-level focus
   stealing/non-stealing can't be demonstrated here. Confirm keystrokes land in the editor the
   whole time, no window steals focus.
3. `npm run ui:verify -- --screens=home,settings` — confirm only those two screens produce
   artifacts, the summary says the run is partial, and `.ui-verify/screenshots/` for other screens
   is untouched (no stale-sweep).
4. Open one screen's PNG and its entry in `.ui-verify/a11y.json` — confirm both carry the same
   run/visit identifier (same visit, not two sessions).
5. Run `npm run ui:verify` twice back to back; diff the two `.ui-verify/run.json` — identical
   (fixture rewritten fresh each time, no drift).
6. Temporarily break one screen's `data-testid` so its `navigate()` throws; run `npm run
   ui:verify`; confirm the other 13 screens still complete and the broken one is reported
   `unreachable` (not a whole-run abort); revert the change.
7. Exit codes: clean run → `0`; a run against a build with an injected serious/critical a11y
   violation → `2`; a run where the app fails to start (e.g. `out/` deleted, no rebuild) → `1`.

## Done

**Summary.** The 56-launch-per-run harness is now 2 launches (measured, unchanged registry):
`scripts/lib/session.mjs` (new) drives one `_electron.launch()` per fixture variant, visiting every
screen×viewport with screenshot+axe captured in the same page visit; `coldStart: true` screens
(none today) still get their own dedicated launch. `scripts/verify.mjs` (new) is the single driver
behind `ui:shot`/`ui:a11y`/`ui:verify` — `scripts/shot.mjs`/`a11y.mjs` are deleted, `ui-verify.mjs`
calls it in-process (no more spawning two child scripts). `--screens=a,b,c` gives a deduplicated,
registry-ordered partial run that skips the stale-PNG sweep and says so in its summary. Fixtures
are always rewritten fresh (the "seed only if missing" drift is gone). `src/main/window.ts`
suppresses window activation (`focusable:false` + `showInactive()`) whenever the harness sets
`Q2L_UI_HARNESS=1`, verified empirically against a real Windows `electron.exe` process (this repo's
dev toolchain runs Windows node/Electron binaries via WSL interop): env unset →
`focusable/focused: true` as before; env set → `focusable/focused: false`.

A first review pass (Opus tier) FAILed on AC5: a mid-variant crash left the remaining screens of
that variant permanently unvisited instead of getting a fresh launch, and a liveness failure after
the last visit was silently swallowed (exit 0 for a run that should have been exit 1). Both are
fixed in `session.mjs`'s `runSession`/`drain` (bounded relaunch loop; a session-level `error` field
that fails the run when no visit can be blamed for it) — reproduced against the real app (an
injected crash mid-variant), confirmed the remaining screens are now genuinely visited, then
reverted the injected fault (including a leftover test-only `crash-inject` registry entry the
interrupted fix agent had not yet cleaned up — removed before this closed out). Also fixed from
that review: `--screens=` duplicate ids no longer falsely count as a full run; an unguarded
`axe.run()` result shape no longer risks aborting the rest of a variant; stale comments referencing
deleted `shot.mjs`/`a11y.mjs` and an already-shipped "future deliverable"; the run summary label now
names the actual npm script; `prettier --write` applied to every file this story touched (was
failing `format:check`); the console summary's violation totals now exclude errored screens,
matching `a11y.md`'s existing semantics (previously double-counted `config-raw`'s findings).

**Deliberately left unfixed**, all lower-severity findings from the same review, none tied to a
FAILing AC:
- A `--screens=` partial run overwrites `run.json`/`a11y.json` with only the visited subset rather
  than merging into the prior full run's records (PNGs of untouched screens are correctly left
  alone; their JSON entries are not). Not required by AC8, which only specifies PNG-staleness
  behaviour. Worth a follow-up if partial-run evidence completeness ever matters.
- A typo'd `coldStart` field name (e.g. `coldstart`) is silently treated as unset rather than
  rejected. AC7 only requires the field to be visible in the registry, which it is; registry-level
  validation was judged out of scope for this story.
- `.claude/skills/ui-verify/SKILL.md` (a `tech-rules`-managed plugin skill) still shows the
  reference shape's `shot.mjs`/`a11y.mjs` split — reviewed against CLAUDE.md's Deviations-table
  rule and judged not to need an entry there: the skill is an illustrative example, not a
  measurable rule like design-tokens' 44px floor, and this project's structure already diverges
  from the skill's naming/layout independent of this story.

**Also found, not fixed (pre-existing, out of scope):** `config-raw` throws a real render error
(`RawConfigPanel`) — a pre-existing app bug, unrelated to this story, that the harness now
correctly reports as `error` for that one screen without affecting the other 13. Also,
`src/main/index.ts:48`'s `revalidateOnStartup()` broadcasts `installations:changed` before the
renderer subscribes in `useLauncher.bootstrap()`, so a reload-driven visit shows a stale
installation list; both are worth their own story.

**Verification:** `npm run build` ✓, `npm run typecheck` ✓, `npm test` ✓ (697 tests), `npx prettier
--check` ✓ (scoped to this story's files). Live smoke (`npm run ui:verify`, this story's own
`live-smoke-how`) run repeatedly: 2 launches, 14/14 screens, byte-identical evidence across runs,
exit 1 on the pre-existing `config-raw` bug (matches story 026's contract, not a regression),
`--screens=home,settings,home,settings` correctly dedupes to a 2-screen partial run with no stale
sweep. Code review (Opus tier): FAIL → fixes applied → re-verified clean.

**Open point handed to the user:** AC2 (no focus theft) is code-verified and was empirically
confirmed against a real Windows `electron.exe` process's live `BrowserWindow` properties
(`focusable`/`focused` false only when the harness env var is set), but the experiential check in
Test Plan step 2 — typing continuously in another window while `ui:verify` runs and confirming no
interruption — needs a human on a real Windows session per the story's own text. Status stays
`in-progress` until that is confirmed; every other acceptance criterion is met and verified.

**Commit message:**
```
027: unify UI-verification into one session per fixture, suppress harness window focus
```

**Closed at S06 acceptance (2026-08-22).** The user confirmed the experiential focus check on the
real Windows desktop during the S06 sprint review: a full `npm run ui:verify` run does not steal
keyboard focus from another window. AC2 is ticked, the story is `done`. Closed together with
[[037-ui-verify-complete-and-green]], whose AC5 was the same check.
