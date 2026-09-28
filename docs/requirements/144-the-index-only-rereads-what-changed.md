---
id: 144
title: the index only re-reads what changed
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

A user with a thousand demos opens the Demos view and sees their list straight away — not after the
launcher has re-read every file again. The index refreshes **incrementally when the module opens**
and on a **manual refresh**; there is no file watcher (concept `docs/concepts/demo-browser.md` §3,
DEMO-3, DEMO-4).

Parsed facts and name facts are kept in a **disposable cache** in app data, keyed by path + size +
modification time (§8.2) — its own file, not `state.json`, because it can grow large. The filesystem
stays the master: deleting the cache loses nothing, the next scan rebuilds it. Scan progress reaches
the renderer as a pushed `module:event` (counts), which [[151]] shows.

## Acceptance Criteria

- [ ] **AC1** — Opening the Demos view starts an incremental scan; a refresh button starts one on
      demand.
- [ ] **AC2** — A file whose path, size and modification time are unchanged since the last scan is
      not parsed again (asserted by counting parser calls).
- [ ] **AC3** — A changed file is re-parsed, a new file is added, and a deleted file disappears
      from the list after the scan.
- [ ] **AC4** — The cache lives in its own app-data file; deleting it and scanning again produces the
      same list, and no sidecar or user setting is lost.
- [ ] **AC5** — A cache written by an older cache format version is discarded and rebuilt, not
      misread.
- [ ] **AC6** — Scan progress (scanned / total, per source) is pushed as a module event while the scan
      runs.
- [ ] **AC7** — A refresh requested while a scan is running does not start a second parallel scan.
- [ ] **AC8** — While a game is running, scanning follows the rule decided in Q1.

## Open Questions

- [x] ~~**Q1 — Scanning while the game runs** (§17.12): allowed (the game may be writing a demo right
      now), deferred until the game exits, or skip files still being written — and how "still being
      written" is detected?~~ answered → Decisions (Sprint)
- [ ] **Q2 — First scan** — does the list show cached rows immediately and update in place, or wait
      for the scan to finish?

## Decisions (Sprint)

- **(User)** Scanning while a game runs: skip files still being written, rather than deferring
  the whole scan or reading a possibly-live file. Refine picks the detection method (e.g. a
  short re-stat to see if mtime/size are still moving, or an open-handle/lock check) and adds
  it as an AC.

## Plan

<!-- Filled by /refine 144, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by /refine 144. -->

## Model Hints

<!-- Filled by /refine 144. -->

## Acceptance Tests

<!-- Filled by /refine 144. -->

## Done

<!-- Filled by /build 144. -->
