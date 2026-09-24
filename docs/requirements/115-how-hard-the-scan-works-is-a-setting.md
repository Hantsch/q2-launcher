---
id: 115
title: how hard the scan works is a setting
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

A user who thinks the browser is too aggressive, too slow, or too eager to refresh itself can turn
every one of those knobs down (or up) in the module's settings section, rather than living with
whatever number a developer once hardcoded. Conversely a user who wants the list to feel instant
does not need to wait for a future release to loosen it. The concept is explicit that none of this
is fixed by design — "das soll der user selber entscheiden" (game-browser.md §3, §7.3, GB-N3/GB-N4)
— so the scan scheduler [[114]] built reads its cadence and budget from settings, never from a
constant baked into the scheduler.

That still leaves the question of what the app ships with on first run. The concept is equally
explicit that it refuses to invent those numbers (§18.1): "the first thing the implementation does
is measure: how long a full pass over a real master list (~100-300 servers) takes including
details. Only the numbers decide whether any of this needs tuning at all." This story is where that
measurement happens and where its result becomes the shipped defaults — not a guess dressed up as
one. If the measured full-detail pass turns out to be on the order of a few hundred milliseconds,
that also answers most of the "does this even need tuning" question the concept poses, and later
stories (the scoped refreshes in [[117]], a possible dedicated watchlist re-check) inherit that
answer rather than re-litigating it.

This story also has to decide, for [[114]]'s scheduler, whether a scan is represented as a `Job`
through the existing `JobsService` (`src/main/services/jobs.ts`), the way every installation-mutating
download/repair/upgrade job is today, or is its own lighter-weight thing. The concept raises this
itself without resolving it (§18 open point #7): "`JobsService` today is scoped to installation-
mutating work; reusing it for a read-only network sweep would be a deliberate decision, and the
progress UI would come for free." Whichever way this falls also shapes how [[116]]'s "no scan while
playing" guard observes and enforces the rule, so it has to be settled here, not deferred into build.

## Acceptance Criteria

- [ ] **AC1** — Auto-scan-on-open, auto-refresh interval (off/on + value), maximum concurrent
      in-flight queries, per-query timeout, retry count, and minimum spacing between two automatic
      scans are each a user-changeable setting in the module's settings section — none of them is a
      constant in the scheduler code.
- [ ] **AC2** — The shipped default value for every setting in AC1 is justified by a real measurement
      of a full two-stage pass over a real master list (~100-300 servers) recorded in this story
      (method, environment, and the resulting numbers), not asserted without that evidence.
- [ ] **AC3** — A manual scan is available regardless of the auto-scan-on-open and auto-refresh
      settings' current values — turning both off never removes the manual trigger.
- [ ] **AC4** — When an automatic scan comes due while a previous scan (automatic or manual) is still
      running, the due one is skipped, not queued and not run concurrently — at most one scan is ever
      in flight at a time.

## Open Questions

- [ ] **Q1 — Is a scan a `Job`?** The concept poses this itself without resolving it (§18 open
      point #7): "`JobsService` today is scoped to installation-mutating work; reusing it for a
      read-only network sweep would be a deliberate decision, and the progress UI would come for
      free." Modelling it as a `Job` gets cancellation, the action-bar readout and `jobs:changed`
      plumbing for nothing; not modelling it as one keeps `JobsService`'s scope honest and avoids
      teaching write-guard-adjacent code (`InstallationWriteGuard`, which assumes a job either writes
      or doesn't) about a job that never writes anything. Needs a decision before [[114]] and [[116]]
      can be built against a settled shape.

## Plan

<!-- Filled by `/refine 115`, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by `/refine 115`. -->

## Model Hints

<!-- Filled by `/refine 115`. -->

## Acceptance Tests

<!-- Filled by `/refine 115`. -->

## Done

<!-- Filled by `/build 115`. -->
