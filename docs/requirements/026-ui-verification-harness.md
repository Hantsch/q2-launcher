---
id: 026
title: A committed UI verification harness that drives the real app
status: draft # draft -> ready -> in-progress -> done
created: 2026-08-20
---

## Requirement

Every story with a visible surface currently ends the same way: built, reviewed, green tests —
and then "live acceptance pending", because nobody drove the actual Electron window. That has
been true for all six S03 stories and it makes me the bottleneck for every UI change.

I want a harness committed to this repository that starts the built app, walks through its
screens, and leaves behind evidence I can look at: a screenshot per screen and an accessibility
report. Not a test suite that asserts business logic — a way to see that the app really renders
and really reacts, runnable by one command, by me or by a build session.

Two things are known about this environment up front and must be handled, not discovered again:
the repo is often developed from inside an Electron host that exports `ELECTRON_RUN_AS_NODE=1`
(inherited, `electron.exe` runs as plain Node and the main process dies on its first
`require('electron')`), and the app's own state lives in `state.json` — a harness run must not
touch or corrupt my real installations and profiles.

## Acceptance Criteria

- [ ] One documented command builds (if needed) and drives the real app end to end; no manual
      app start, no hand-written glue per run.
- [ ] `ELECTRON_RUN_AS_NODE` is deleted from the child environment before launch, so a run
      started from inside an Electron-hosted terminal works.
- [ ] A run uses an isolated userData/state location — my real `state.json`, installations and
      config profiles are provably untouched.
- [ ] The run visits every top-level route/screen of the shell plus the config module's tabs and
      writes one screenshot per screen to a git-ignored output folder.
- [ ] An axe-core accessibility report is produced per screen, machine-readable plus a readable
      summary; the run's exit code distinguishes "app failed to start / screen missing" from
      "accessibility findings present".
- [ ] Renderer console errors and main-process crashes during the run are surfaced in the output,
      not swallowed.
- [ ] A story-level smoke flow is possible, not just static screenshots: the harness exposes a
      documented way to click/type through a flow (e.g. open a profile, open a keycap dialog) so
      a story's own acceptance steps can be scripted on top of it.
- [ ] `docs/` documents how to run it, where the output lands, and how to add a screen or a flow.
- [ ] The harness is not wired into `npm test` as a blocking gate in this story — it is
      opt-in/explicit, so a broken desktop environment cannot fail the normal build.

## Open Questions

- Should the harness live as a separate npm script + `scripts/` folder, or as Playwright test
  files under a dedicated project config? (The `/ui-verify` skill has an opinion — refine should
  follow it unless it conflicts with this repo's two-tsconfig layout.)
- Screenshot baselines: this story only produces screenshots. Is diffing against committed
  baselines wanted later, or deliberately never (they rot on every design change)?
- Is a CI job in scope at all, given the app needs a display, or is this local-only for now?

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
