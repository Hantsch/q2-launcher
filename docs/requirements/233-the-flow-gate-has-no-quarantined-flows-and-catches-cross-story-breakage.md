---
id: 233
title: the flow gate has no quarantined flows and catches cross-story breakage
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

Story [[223]] made the end-of-sprint flow gate binary, and S32's gate showed both what that buys and
what is still open. The first full `ui:flows` run was red 134/138 because of two regressions that
only the full gate saw (209's `bootEnv` case-sensitivity broke `bootstrap-wizard` on Windows; 220
disabled a switch that 201's `quit-persists-state` clicked): the narrow per-story gate ran only the
flows each story named, and `bootstrap-wizard` was not among 209's. Two flows are still quarantined
(`scripts/flows/quarantine.json`), and a polluted `.ui-verify` fixture cache makes the archive
counts in `downloads-tab` and `settings-downloads-section` vary until `npm run ui:seed` is run.

The maintainer wants the quarantine list empty, flows that do not depend on what ran before them,
and a per-story gate that is hard to blind to a neighbouring flow.

## Acceptance Criteria

- [ ] **AC1** — `mods-view` passes with its quarantine entry removed. The flow asserts the displayed
      installation name per `docs/UI-VERIFICATION.md#what-a-flow-may-assert`, or the product's
      `uppercase` styling (story 188) is changed; which of the two is decided in refine.
- [ ] **AC2** — `replays-mod-warning` passes its step "resetting remembered mods asks again" in 20
      consecutive runs, and its quarantine entry is removed.
- [ ] **AC3** — `downloads-tab` and `settings-downloads-section` report the same archive counts
      whatever flows ran before them, with no manual `npm run ui:seed`.
- [ ] **AC4** — A story's narrow gate includes the flows that exercise the shared code it changed,
      derived from the diff rather than named by hand; a test shows that a change to `bootEnv` selects
      `bootstrap-wizard`.
- [ ] **AC5** — `npm run ui:flows` on the sprint branch ends green with `quarantine.json` empty.

## Open Questions

<!-- AC1: flow or product? AC4: how are flows mapped to source areas (a declared list per flow, an
import graph, or a coarse area-to-flow table)? Both are refine's call, with the user. -->

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
