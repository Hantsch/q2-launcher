# Sprint S23 review — The browser remembers what it's told

## Overview

**Goal:** everything the `servers` module needs to remember between restarts lives in its own
`state.json` key, with a defensive parse, and can be created, edited and read back through IPC
handlers backed by zod schemas. No scan engine and no server list exist yet — this sprint proves
the data survives a restart, not that it is ever shown.

| Story | Status | Commit |
| --- | --- | --- |
| 110 — the browser's data lives in its own state key | done | `4f7135a` |
| 111 — master sources are a list i edit | done | `a8e1087` |
| 112 — favourites are always there | done | `c38a71a` |
| 113 — a server i add by hand, and where i've been | done | `6302ccb` |

All four stories done, no blockers. Two follow-up fix commits landed after the sprint-wide
regression gate: `4002e7b` (111) and `bb3c805` (110) — see Regression gate below.

## Implemented stories

- **110** — added a new top-level `servers` key to `state.json`, owned entirely by the `servers`
  module: five persisted collections (sources, favourites, manual servers, history, scan budget),
  a zod envelope in `src/shared/modules/servers.ts`, and a two-level defensive parse in
  `src/main/lib/schemas.ts` (envelope fallback to a safe empty default, row-level drop for a
  malformed entry) mirroring the `homeLayout` precedent. Purely additive — no schema-version bump,
  no migration, no user-facing surface.
- **111** — the master-source list a user actually edits: add, remove, reorder and enable/disable
  a source (`udp-master` / `http-list`), each action validated by a zod payload schema and
  persisted immediately. Ships with the concept's three default sources on a fresh install. A real
  Settings-section UI landed, plus an e2e flow proving the full CRUD path.
- **112** — favourites CRUD and persistence: mark/unmark a server address as a favourite, backed by
  IPC handlers and their own tests. No list UI yet (story 118) — this story proves the storage and
  handlers it will be wired to.
- **113** — manual servers (hand-entered `ip:port`, validated through story 107's address
  validator, flagged as hand-added) and a bounded, 200-entry connection history (oldest-evicted,
  most-recent-first read). Both are store + read-API only — the join trigger (125) and any
  scan-time folding of history (114) are out of scope here.

## Findings & decisions

Aggregated from each story's `## Decisions (Sprint)`:

- **Global, not per-installation (GB-P1).** Every collection in the `servers` key is keyed by
  address, never by an installation id — confirmed by a dedicated test in 110 (AC6) and carried
  through unchanged by 111–113.
- **111's Q1 (master rate-limit etiquette, concept open point #15) stays deferred** to the scan
  engine (story 114/115, sprint 9.3) — this sprint's scope was the source list's CRUD and shape,
  not scan timing. Not decided here, as the story's own text already specified.
- **`DEFAULT_SERVERS_STATE` ships empty; 111 seeds the three default master sources as its own
  field default**, not a re-seed on read — deliberate, so "remove the last source" stays a valid
  end state rather than something the launcher fights.
- **The `scan` budget knobs (concurrency, timeout, retries, min-spacing) got provisional
  placeholder values in 110** — the concept names the four knobs but leaves the real numbers to
  story 115's own tuning against a real master list.
- **Every mutating handler returns the full new collection**, not a delta — renderer state is
  always main's truth, consistent with the pattern `home`'s `setLayout` already uses.
- **112 and 113 have no list UI** by design — favourite-marking and manual-server management get
  their surface in story 118; this sprint proves persistence and IPC only, and review was briefed
  not to expect a finished UI for either.
- **A real bug surfaced and got fixed along the way, not staged as a finding:** during 111's build,
  a fresh-install gap was caught where `state.ts`'s `defaults()` cloned `DEFAULT_SERVERS_STATE`
  directly (bypassing the schema's `.default()`), which would have silently shipped an empty
  source list on a truly fresh profile despite every schema-level test passing. Fixed within the
  story, with a new fresh-install-path test added.

## Blocked / open

None. All four stories completed without a user-facing blocker.

## Regression gate

Ran on `sprint/S23` `HEAD` (`bb3c805`) with a clean `.ui-verify/fixture` directory:

- `npm run build` — **green**.
- `npm test` — **green** (265 files, 4410 passed, 8 skipped).
- `npm run ui:verify` — **green** (5 launches, 86/86 screenshots, 0 axe violations, full 45/45
  screens).
- `npm run ui:flows` — **42/56 green**, 14 red — all 14 confirmed **pre-existing**: `app-update`,
  `bootstrap-failure`, `bootstrap-failure-retry`, `bootstrap-incomplete-package`, `bootstrap-r1q2`,
  `bootstrap-wizard`, `config-header-geometry`, `controls-subcategory`, `custom-action-row`,
  `engine-badge-surfaces`, `engine-not-client`, `harness-offscreen`, `home-hero-carousel`,
  `news-cover-template`. Each reproduces identically, deterministically and in isolation at the
  sprint's merge-base with `dev` (`38181e7`) — none touch the `servers` module, none are new to
  this sprint. This is a real gap in the project's e2e baseline, not a blocker for S23 — flagged
  as a roadmap follow-up below.

Two flows did regress from this sprint's own work, both attributed and fixed on the branch:

- **`servers-module-shell`** (story 106's own flow) broke when 111 replaced the placeholder UI it
  asserted on with the real master-source list. Fixed in `4002e7b`.
- **`news-feed`** bisected to 110's commit, but investigation found the bisect's attribution was a
  false positive — fixture-directory pollution from an earlier flow in the same `ui:flows` batch
  unmasked a pre-existing, unrelated race in story 092's `EngineUpdateAction` (an undelayed startup
  fetch that could land after a short flow's fixture server tears down). Fixed anyway, in source,
  in `bb3c805` — full trace in story 110's Done section.

**Merge is not blocked by the regression gate.**

## Acceptance

Acceptance is the test suite — every criterion below was proven by a named, passing test before
its story moved to `done`.

| Story | AC | Proven by |
| --- | --- | --- |
| 110 | AC1–AC7 | `state.test.ts`, `servers.test.ts`, `schemas.test.ts` (unit; no e2e — no user-facing surface) |
| 111 | AC1–AC5 | unit tests in `master-sources.test.ts`/`servers.test.ts` + `scripts/flows/servers-master-sources.mjs` (e2e: defaults → CRUD → refusal → restart round-trip) |
| 112 | AC1–AC5 | `favourites.test.ts`, `index.test.ts` (unit; no e2e — no list UI yet, story 118 owns the surface) |
| 113 | AC1–AC6 | `manual-servers.test.ts`, `history-log.test.ts`, `index.test.ts`, `state.test.ts` (unit; no e2e — same reason as 112) |

No manual residue in any story — every criterion was automatable at the level it was written for.

**Named e2e gaps (not manual residue, not a blocker):** 112 and 113 have no e2e flow because they
add no user-facing surface this sprint — their criteria are IPC/persistence-level and covered by
`test`. This is consistent with `ui-acceptance-required`'s own rule: a criterion without a surface
is covered one level down, and the gap is named here rather than silently converted into a manual
step. The surface both stories are building toward lands in story 118 (sprint 9.4).
