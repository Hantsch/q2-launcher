---
id: 146
title: what I write about a demo lives next to it
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

A user annotates a demo — "final vs X, the rail at 4:10", who played on which side, a few tags, a
star and a rating. That knowledge belongs to the file, not to the launcher: it is stored as a small
**sidecar next to the demo**, so it travels when the demo is copied or zipped and is never locked in
an app database (concept `docs/concepts/demo-browser.md` §8.1, DEMO-10, DEMO-11). **The filesystem is
the master.**

This story is the sidecar's storage: its schema, reading, and writing through a main-side handler.
The editor surface is [[155]]; how a broken sidecar is handled is [[147]]; how sidecar values win
over parsed ones is [[148]].

- **Name:** the demo's full file name + `.json` — `final.dm2` → `final.dm2.json`,
  `x.mvd2.gz` → `x.mvd2.gz.json`. Unambiguous when `x.dm2` and `x.mvd2` sit side by side.
- **Content:** only user-entered fields plus `schemaVersion`: `name`, `description`, `mod`,
  `gamemode`, `map`, `sides` (each: optional team name, optional final result, list of player
  names), `tags`, `favourite`, `rating` (1–10), `date` (override).
- **Created only on the user's first save.** Untouched demos get no sidecar — the launcher never
  writes thousands of files uninvited.

## Acceptance Criteria

- [ ] **AC1** — A shared zod schema describes the sidecar with exactly the fields above; `rating` is
      an integer 1–10, `favourite` a boolean, `date` an ISO date-time, `sides` an array of
      `{ team?, result?, players[] }`.
- [ ] **AC2** — Saving metadata for a demo without a sidecar creates `<full file name>.json` next to
      it, containing `schemaVersion` plus only the fields the user set.
- [ ] **AC3** — Saving again updates that file; parsed facts, name facts or cache data are never
      written into it.
- [ ] **AC4** — Scanning, listing, opening the detail view or playing never creates a sidecar.
- [ ] **AC5** — A write is atomic: a crash or error during save leaves either the old or the new
      sidecar, never a partial file.
- [ ] **AC6** — The write handler receives the demo's id, never a path; main resolves the sidecar
      path from its own index.
- [ ] **AC7** — A save into a location that is not writable (e.g. an installation under
      `Program Files`) fails with a visible, specific reason, and nothing is written anywhere else.
- [ ] **AC8** — Clearing every field behaves as decided in Q1.

## Open Questions

- [x] ~~**Q1 — Clearing everything** — delete the sidecar, or keep it with only `schemaVersion`?~~
      answered → Decisions (Sprint)
- [x] ~~**Q2 — Read-only locations** (§17.11): error only (as AC7 assumes), or an alternative
      location? The "filesystem is master" rule argues against a fallback store.~~ answered →
      Decisions (Sprint)
- [ ] **Q3 — Formatting** — pretty-printed, stable key order (diff-friendly for users who version
      their demos)?

## Decisions (Sprint)

- **(User)** Clearing everything: delete the sidecar file entirely rather than keeping a
  bare-`schemaVersion` husk — matches "untouched demos get no sidecar"; a fully-cleared demo
  goes back to being untouched.
- **(User)** Read-only locations: error only, no fallback store — consistent with "the
  filesystem is master"; AC7 already assumed this.

## Plan

<!-- Filled by /refine 146, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by /refine 146. -->

## Model Hints

<!-- Filled by /refine 146. -->

## Acceptance Tests

<!-- Filled by /refine 146. -->

## Done

<!-- Filled by /build 146. -->
