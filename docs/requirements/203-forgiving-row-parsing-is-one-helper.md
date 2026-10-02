---
id: 203
title: forgiving row parsing is one helper
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As the maintainer I want "parse this persisted list row by row, drop the bad rows, dedupe, log
what was dropped" to be one helper with one policy, so that a new persisted collection costs one
line instead of 10–20 and a change to the drop/dedupe/log policy is made once.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F25): `src/main/lib/schemas.ts`
contains `parseForgivingRows` with the comment "generalized so categories and actions can reuse it
instead of duplicating the map-safeParse-filter dance", yet the same file has 27 `safeParse`
calls and 8 hand-written `parseXRow` helpers each followed by `.map(parseXRow).filter(row !== null)`;
three address-keyed rows are byte-identical; the envelope idiom
`safeParse(raw === undefined ? {} : raw)` is copied four times; `dedupeByKey` is applied
afterwards in eight places; `parseModWarning` bypasses zod entirely. `mods/install-records`,
`mods/catalog-parse` and `downloads/manifest-parse` each hand-roll the same loop with their own
log line.

## Acceptance Criteria

- [ ] **AC1** — `src/main/lib/forgiving.ts` exports `parseForgivingRows` (moved),
      `parseForgivingEnvelope(schema, raw, fallback)`, `parseKeyedRows(schema, raw, { keyOf, refine? })`
      and `dedupeByKey`, with an `onDrop` callback for module log lines; one unit test file covers
      drop, dedupe-first-wins, missing envelope and the callback.
- [ ] **AC2** — The hand-written `parseXRow` + map/filter pairs and the four envelope blocks in
      `lib/schemas.ts` are expressed through the helpers; the file's `safeParse` count drops by at
      least half and no `function parse*Row` remains that only wraps `safeParse`.
- [ ] **AC3** — `parseModWarning` is a zod schema with `.catch()` like its siblings.
- [ ] **AC4** — The three module loops (`install-records`, `catalog-parse`, `manifest-parse`)
      use `parseKeyedRows`/`parseForgivingRows` and keep their log wording via `onDrop`.
- [ ] **AC5** — Behaviour is unchanged: `schemas.test.ts` passes without weakening any assertion;
      redundant per-row cases that now test the helper may be deleted once the helper's own test
      covers them.

## Open Questions

- [ ] **Q1** — Does story 207 (modules own their persisted state) want this helper in
      `src/main/lib` or in `src/shared`? It uses no node API, so shared is possible; the review
      recommends `src/main/lib` because only main parses persisted files.

## Plan

<!-- Filled by /refine 203. -->

## Deliverables

<!-- Filled by /refine 203. -->

## Model Hints

<!-- Filled by /refine 203. -->

## Acceptance Tests

<!-- Filled by /refine 203. -->

## Done

<!-- Filled by /build 203. -->
