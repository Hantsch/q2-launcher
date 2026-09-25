---
id: 130
title: a locked feature does not exist
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

"Nobody asks for something they don't see" (concept §13.6) — a locked experimental feature has to
render **nothing**: no tab, no menu entry, no greyed-out row, no tooltip hinting it exists. This
story is that enforcement contract, general enough that [[128]]'s verified-code state is the only
input it needs and [[132]]'s watchlist tab is simply its first caller, not something baked into the
mechanism itself.

The repo already has a real example of the shape this needs, checked directly rather than
paraphrased: `DEV_ONLY_CHANNELS` in `src/shared/ipc.ts` is a plain array of invoke channels, and
`registerDevIpc()` in `src/main/ipc/dev.ts` is the only place that registers handlers for them —
called from `registerAllIpc()` in `src/main/ipc/index.ts` only `if (app.isDev || ...)`. Critically,
the boot-time completeness check (`assertContractFullyHandled` in the same file) does not treat an
unregistered dev-only channel as a bug when the build isn't a dev build — it excuses exactly those
channels, by name, from the "declared but not handled" failure. That is the shape the concept means
by "in the same spirit" (§13.7): a declarative gate, checked once, whose handlers are conditionally
registered, with the contract-completeness check already knowing how to excuse a channel that is
deliberately not registered in this build — instead of that check either being blind to gated
channels or failing the build every time a feature is locked.

The renderer hiding a tab is presentation, never the boundary (§13.7) — the same "paths from the
renderer are never trusted" reasoning CLAUDE.md already applies to filesystem paths applies here to
feature flags: a compromised or simply modified renderer must not be able to reach a locked
feature's functionality by calling its IPC channel directly. The decision of what is unlocked is
made once, in main, from [[128]]'s verified token state, and the renderer only ever finds out the
answer, never decides it.

This story builds the general mechanism only. [[131]] and [[132]] (the watchlist) are its first and
currently only consumer — the design has to hold up for a second future feature without anyone
having to duplicate the gate logic, but no second feature needs to exist yet to prove that.

## Acceptance Criteria

- [ ] **AC1** — With no valid unlock code present, a gated feature's UI surface (tab, menu entry or
      route) does not render at all — not present in the DOM, not shown disabled.
- [ ] **AC2** — With no valid unlock code present, that feature's main-process IPC handlers are not
      registered at all, so a direct IPC call from a compromised or modified renderer receives "no
      handler for this channel", never a permission-denied response.
- [ ] **AC3** — The unlocked/locked decision is made in main from [[128]]'s verified token state; no
      code path lets the renderer's own choice not to render stand in for that check.
- [ ] **AC4** — The gate is keyed by feature name, not hardcoded to `watchlist`. A test declares a
      test-only feature name through the same declaration and gets the same behaviour: its surface
      and handlers are absent when locked and present when unlocked, with no gate code specific to
      that name.

## Open Questions

<!-- Leave empty. Filled during refine (`/refine <id>`) if the requirement is still
unclear. Must be resolved before status goes to `ready`. Inside a sprint these are put to the
user in the clarification round. -->

## Plan

<!-- Filled by `/refine 130`, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by `/refine 130`. -->

## Model Hints

<!-- Filled by `/refine 130`. -->

## Acceptance Tests

<!-- Filled by `/refine 130`. -->

## Done

<!-- Filled by `/build 130`. -->
