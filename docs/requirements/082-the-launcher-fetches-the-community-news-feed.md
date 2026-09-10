---
id: 082
title: The launcher fetches the community news feed
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-10
---

## Requirement

The launcher must be able to tell me what is going on in Quake II. The maintainer publishes news
in the public `Hantsch/q2_community_content` repository; the launcher fetches that feed, decides
what is currently visible and in which order, and hands the result to the home screen. It does
that quietly: news is not important enough to interrupt me, so a failed fetch shows me the last
feed I had, with its age, and never a dialog or a toast.

This story is the pipeline, not the picture — it ends at a validated, filtered, ordered feed
available over IPC, plus its cache. The hero that renders it is story 083.

Foreign content from the network reaches the launcher here for the first time. It is data, never
instruction: nothing in a feed is executed, and nothing unvalidated reaches the renderer. See
[concepts/home-screen.md](../concepts/home-screen.md) §2 (non-goals), §6 and §10.

## Acceptance Criteria

- [ ] **AC1** — Main fetches `news/index.json` and the `.md` files it references from
      `raw.githubusercontent` on `main`, at app start and on an explicit refresh — no other
      trigger, no interval, no focus refresh.
- [ ] **AC2** — Every fetched document is validated in main before it is used or cached; an
      invalid entry (missing file, unparseable frontmatter, duplicate id, no title or body) is
      dropped with a log line and the remaining feed still arrives.
- [ ] **AC3** — An entry outside its `visibleFrom`/`visibleUntil` window is filtered out in main
      and never reaches the renderer.
- [ ] **AC4** — The feed's order is the entries' `order` value ascending; file name and date do
      not influence it.
- [ ] **AC5** — An entry's frontmatter selects one of the templates `split`, `banner`, `text` and
      is validated against that template's field set; an unknown template value is delivered as a
      `text` slide when title and body exist.
- [ ] **AC6** — At most 3 buttons per entry reach the renderer; further buttons are dropped with a
      log line, and a button URL outside the host allowlist is dropped.
- [ ] **AC7** — The last successful feed is cached in userData and delivered when a refresh fails;
      the delivered feed states when it was retrieved.
- [ ] **AC8** — A failed fetch produces no dialog, no toast and no error state in the shell; it is
      visible only as the feed's age plus a refresh affordance.
- [ ] **AC9** — Every new channel exists in the shared contract with a zod payload schema before
      its handler, and the renderer receives a push when a refresh changed the feed.
- [ ] **AC10** — The feed pipeline (validate, filter, sort, template fallback, drop invalid) is a
      pure, unit-tested module, and the whole test suite plus `ui:verify` run with no network
      access.

## Open Questions

- How does an older launcher react to a `schemaVersion` higher than it knows — ignore the
  unknown parts with a note, or drop the feed? (Concept open point 7.)
- Does the request use ETag/`If-None-Match`, and what are its timeout and retry budget?
  (Concept open point 8.)
- Feed prose is English only in v1. Is that stated anywhere the user can see, or silent?
  (Concept open point 9.)
- Which hosts does the button allowlist contain, and is it a constant or configurable?
  (Concept open point 6 — shared with 083.)

## Plan

_Filled by `/refine 082`._

## Deliverables

_Filled by `/refine 082`._

## Model Hints

_Filled by `/refine 082`._

## Acceptance Tests

_Filled by `/refine 082`._

## Done

_Filled by `/build 082`._
