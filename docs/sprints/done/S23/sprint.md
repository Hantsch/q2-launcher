---
sprint: S23
status: done # planned | in-progress | done
branch: sprint/S23
milestone: 9.2 — Discovery & persistence
---

# Sprint S23 — The browser remembers what it's told

## Goal

Everything the `servers` module needs to remember between restarts — master sources, favourites,
manually added servers and connection history — lives in its own `state.json` key with a defensive
parse, and can be created, edited and read back through IPC handlers backed by zod schemas. No scan
engine and no server list exist yet; this sprint proves the data survives a restart, not that it is
ever shown.

## Stories (in build order)

- [x] 110 — the browser's data lives in its own state key
- [x] 111 — master sources are a list i edit
- [x] 112 — favourites are always there
- [x] 113 — a server i add by hand, and where i've been

## Regression gate

Ran on `sprint/S23` `HEAD` (`bb3c805`, after both fix commits below) with a clean
`.ui-verify/fixture` directory:

- `npm run build` — green.
- `npm test` — green (265 files, 4410 passed, 8 skipped).
- `npm run ui:verify` — green (5 launches, 86/86 screenshots, 0 axe violations, full 45/45 screens).
- `npm run ui:flows` — 42/56 green. 14 red, all attributed **pre-existing**: `app-update`,
  `bootstrap-failure`, `bootstrap-failure-retry`, `bootstrap-incomplete-package`, `bootstrap-r1q2`,
  `bootstrap-wizard`, `config-header-geometry`, `controls-subcategory`, `custom-action-row`,
  `engine-badge-surfaces`, `engine-not-client`, `harness-offscreen`, `home-hero-carousel`,
  `news-cover-template` — each reproduced with an identical, deterministic failure at the sprint's
  merge-base with `dev` (`38181e7`), confirmed by running every one individually in a separate
  worktree at that commit. None touch the `servers` module; none are new to this sprint.

Two flows **did** regress from this sprint's own commits, both fixed on the branch:
- `servers-module-shell` (story 106's own flow) — failed once story 111 replaced the placeholder
  UI it asserted on (`servers-settings-placeholder`) with the real master-source list. Fixed in
  `4002e7b` (`111: fix regression from sprint gate`) by pointing the flow at `servers-sources-list`.
- `news-feed` — bisected to story 110's commit (`4f7135a`), but investigation found this was a
  false-positive attribution: the real cause is `EngineUpdateAction.tsx` (story 092) firing an
  undelayed startup fetch that can race a short-lived flow's fixture-server teardown, unmasked by
  fixture-directory pollution left over from an earlier flow in the same `ui:flows` batch — not by
  story 110's own diff (full trace in `docs/requirements/done/110-...md`'s Done section). Fixed
  anyway in `bb3c805` (`110: fix regression from sprint gate`) by giving `EngineUpdateAction`'s
  first automatic check the same 3s startup grace window `scheduleStartupCheck()` already uses.

Verdict: **green** for everything this sprint touched. The 14 pre-existing `ui:flows` failures are
not a merge blocker for S23's own stories, but they are a real gap in this project's e2e baseline —
flagged in `review.md` and the roadmap's follow-ups.

## Notes

This is sprint 2 of 7 (9.1–9.7, stories 106–132) building the game-browser milestone described in
full in `docs/concepts/game-browser.md`. It depends on sprint 9.1 (S22, stories 106–109) already
being built: 110 lands inside the `servers` module [[106]] registered, 111 and 113 validate
addresses through the validator [[107]] built, and 111 stores sources in the shape [[109]]'s codecs
will later read.

110 goes first because 111, 112 and 113 all write into the state key it defines — building any of
the three before it would mean inventing the shape twice. 111–113 have no dependency on each other
and could build in any order after 110; the listed order follows the concept's own §17 grouping
(sources before persistence-scoped favourites/manual/history).

Two scope boundaries carried over from the story files, worth restating here: the *scan-time*
behaviour of favourites (always queried, pinned to the top) and of history (whether it feeds the
scan's address set) both belong to sprint 9.3's scan engine ([[114]]) and sprint 9.4's list sorting
([[119]]), not to this sprint — 112 and 113 build storage and read APIs only. Likewise, 111 defers
the master rate-limit-etiquette open point (concept open point #15) to the scan engine rather than
deciding it here.
