---
id: 027
title: UI verification runs in one session per fixture, without stealing focus
status: draft # draft -> ready -> in-progress -> done
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

- [ ] A full `npm run ui:verify` starts the app at most once per fixture variant plus one per
      screen explicitly marked as needing a cold start — for today's registry that is 2 starts,
      down from 56 — and the number of starts is reported in the run summary.
- [ ] The app windows a run opens do not take the keyboard focus: while a run is going, I can
      keep typing in another window without interruption. Normal `npm run dev` / packaged
      launches are unchanged.
- [ ] Screenshots and the accessibility report for a screen come from the same visit to that
      screen, so `a11y.json` provably describes the state in the corresponding PNG.
- [ ] Every screen still gets its own verdict: console errors, renderer exceptions and
      unreachability are attributed to the screen that caused them, not to the session.
- [ ] A crash or an unreachable screen does not cost the rest of the run: the remaining screens
      are still visited, and the failure is reported as before.
- [ ] Each run starts from a freshly written fixture, so two consecutive runs of the same build
      produce the same screens — the current "seed only if missing" drift is gone.
- [ ] A screen whose subject *is* the cold boot can declare that in the registry and gets its own
      app; the declaration is visible in the registry, not hidden in the driver.
- [ ] I can restrict a run to named screens for a fast edit/verify loop, and a restricted run
      says that it is partial (no stale-renaming of images it never tried to write).
- [ ] The exit-code contract from story 026 is unchanged: `0` clean, `1` harness/app failure,
      `2` accessibility findings.
- [ ] `docs/UI-VERIFICATION.md` documents the session model, when a screen needs a cold start,
      and how to run a partial verification.

## Open Questions

- Do `ui:shot` and `ui:a11y` stay as separate entry points once both are filters over one pass
  (`npm run ui:shot` = pass without axe), or does only `ui:verify` remain plus flags?
- Should the no-focus behaviour be tied to the existing harness env (one flag the harness sets
  and the main process honours) or to a general "verification mode" that also switches off other
  boot-time side effects such as the first-run scan the `empty` fixture disables in its state?
- Is a fully invisible window worth chasing (never `show()`, capture via
  `webContents.capturePage()`) or is "visible but never focused" the end of it? Chromium
  throttles composition of hidden windows, which risks blank or stale PNGs — the failure mode an
  evidence harness must not have.

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
