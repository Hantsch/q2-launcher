---
id: 134
title: a native helper steers Q2PRO when cfg polling cannot
status: withdrawn # spike 133 ended in go
created: 2026-09-27
---

## Requirement

**Withdrawn** — spike [[133]] ended in go; see
[`spikes/133-q2pro-control/RESULT.md`](../../../spikes/133-q2pro-control/RESULT.md).

**Conditional story.** It is built only if the spike [[133]] ends in **no-go** for cfg polling. If
[[133]] ends in **go**, this story is withdrawn with a note pointing at [[133]]'s recorded result.

The concept (`docs/concepts/demo-browser.md` §12.3, DEMO-27) does not accept a Linux-only timeline:
Windows is ~80% of users. The fallback it names is a small native helper that attaches to the Q2PRO
process's console (`AttachConsole` + `WriteConsoleInput`), types the launcher's commands into it and
relays the engine's console output — at least the playback position — back to the launcher. It is a
new kind of artefact for this repo: a native binary that has to be built, packaged and signed
alongside the Electron app.

## Acceptance Criteria

- [ ] **AC1** — On Windows, a helper shipped with the launcher delivers a single command line from
      main to the console input of a running Q2PRO that main itself started.
- [ ] **AC2** — The helper returns the engine's console output to main, enough for [[164]] to read
      the current playback position.
- [ ] **AC3** — The helper attaches only to the process id main hands it (the game main started);
      nothing the renderer sends can point it at another process.
- [ ] **AC4** — The helper exits when the game exits and when the launcher dies; no orphaned helper
      process remains in either case.
- [ ] **AC5** — The helper is built from source by this repo's build and packaged into the Windows
      installer; `verify:release` covers it.
- [ ] **AC6** — The helper is signed the same way the launcher is, or the recorded decision states
      why not and what a user sees instead (e.g. a SmartScreen prompt).
- [ ] **AC7** — On Linux nothing of the helper is built or shipped; the Linux channel stays stdin
      ([[164]]).

## Open Questions

- [ ] **Q1 — Language and toolchain** (C, Rust, Go, .NET AOT) — which one the release pipeline can
      build reproducibly.
- [ ] **Q2 — Is there a console to attach to?** Q2PRO is started detached from the launcher; does
      it own a console on Windows, and if not, what does the helper attach to?
- [ ] **Q3 — Signing** — is a code-signing certificate available, and is the launcher itself signed
      today?

## Plan

<!-- Filled by /refine 134, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by /refine 134. -->

## Model Hints

<!-- Filled by /refine 134. -->

## Acceptance Tests

<!-- Filled by /refine 134. -->

## Done

<!-- Filled by /build 134. -->
