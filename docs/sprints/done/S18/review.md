# Sprint S18 review — R1Q2 installs, and the home screen becomes a real screen

## Overview

Goal: two demonstrable things. R1Q2 as a second installable engine through the bootstrap wizard,
and a `home` module showing a live community news hero over a user-arranged dashboard with two
real tiles. Both are done — all 8 stories shipped, none blocked.

| Story | Status | Commit |
| --- | --- | --- |
| 080 — Install R1Q2 from the community package | done | `97e55d1` |
| 081 — The home screen belongs to a home module | done | `8a8eebb` |
| 082 — The launcher fetches the community news feed | done | `6ff9d7b` |
| 085 — The content repository carries the news contract | done | `82b28c6` |
| 083 — The hero is the news carousel | done | `b8f63ed` |
| 084 — Slide images come from the launcher's own cache | done | `cba509e` |
| 086 — The dashboard is a grid I arrange myself | done | `b69c8a0` |
| 087 — Two tiles worth having — playtime and config profiles | done | `af00e38` |
| — regression fix (news startup fetch vs. harness gate) | done | `c2633d0` |

## Implemented stories

- **080 — R1Q2 install.** R1Q2 joins Q2PRO as a bootstrap-wizard engine choice: engine-scoped file
  assembly, seeded `autoexec.cfg` (`vid_ref r1gl`), GPLv3 license installed alongside the client,
  and a real e2e flow proving primary→mirror fallback and the library card's engine badge.
- **081 — Home becomes a module.** The home screen moved from a shell-hardcoded view into a real
  `home` module (`src/main/modules/home/`, `src/renderer/src/modules/home/`); the old
  installation-hero fallback and the planned-module cards are gone, with no shell special-casing
  left for the home route.
- **082 — News feed pipeline.** Main fetches, validates, filters, orders and caches
  `news/index.json` + its documents from the community content repo, with conditional GET, a
  1-retry budget, and a pure, unit-tested pipeline; a failed refresh is silent and falls back to
  the last cached feed with its age.
- **085 — Content repository contract.** The real feed (3 entries, one per template) now lives in
  `content/q2_community_content/news/` in this repo and is mirrored into the external checkout at
  `C:\development\Hantsch\q2_community_content` (untouched git state, no publish); a
  `scripts/check-content-repo.mjs` machine-verifies the layout instead of a manual walk.
- **083 — The hero carousel.** A 320px full-bleed hero renders the feed through three templates
  (split/banner/text), with auto-rotation, hover/focus pause, keyboard parity, a live region for
  announcements, welcome/stale states and a refresh affordance in the hero itself.
- **084 — Slide images.** Split/banner slide images are downloaded, validated (≤5MB/4000px) and
  served from the launcher's own cache over `q2launcher://news-image/…` — the renderer never talks
  to a remote origin, and the production CSP is untouched.
- **086 — Dashboard grid.** A 12-column, 40px-row grid below the hero with arrange mode (drag,
  resize, catalog, reset), full keyboard parity with live announcements, and its own persisted
  `homeLayout` key — nothing is ever auto-compacted.
- **087 — Playtime and config-profiles tiles.** The two placeholder tiles from 086 now show real
  data (last-session playtime; config profiles with sync/care badges, click-through to the config
  editor) through a shared four-state tile frame (loading/error/empty/filled) with per-tile retry
  and fault isolation.

## Findings & decisions

- **User decisions from the clarification round** (recorded per-story under each story's
  `## Decisions (Sprint)`): planned-module discovery drops entirely rather than keeping a home
  screen pointer (081); news `schemaVersion` mismatches degrade gracefully instead of dropping the
  feed, conditional GET with ETag/5s/1 retry, English-only feed stays silent for v1, and the button
  allowlist is a fixed constant naming only the content repo's own hosts (082); the hero's manual
  refresh sits in the hero itself (083); a cached slide image is dropped (not kept) once its
  upstream source disappears, with a count-capped, feed-scoped cache and a 5MB/4000px per-image
  ceiling (084); reserved content directories get a placeholder README and `config_templates/`'s
  future shape stays open (085); dashboard tiles floor at 2×2 cells and the arrange control lives in
  the home header (086); the config-profiles tile shows profiles only (they are global, not
  per-installation) with scroll on overflow (087). Two of the concept's own open points (a
  fixed right-hand friend-list column; a "new since last visit" news marker) were deliberately left
  open, per the sprint's own Notes.
- **Regression found and fixed during the final sprint-level check, not during any single story's
  own build.** Story 083 added a guard in `home/index.ts` that skipped the app-start news
  `refreshNews()` call whenever the UI-verification harness flag was set at all — not only when no
  fixture base was configured. That silently broke story 082's own AC1 and its `news-feed.mjs`
  acceptance flow (which sets a real loopback base and expects a live fetch). Each story's own
  per-story verification passed because no story re-ran an *earlier* story's flow after building on
  top of it; only running all seven flows together, after 087, surfaced it. Fixed in `c2633d0` by
  removing the redundant outer gate — `resolveNewsSource()` already distinguishes "harness, no base
  → skip" from "harness, base configured → fetch" correctly, and now the caller only ever asks it
  to decide. **Process note for future sprints:** `/build`'s own per-story verification only proves
  that story's flow(s) still pass in isolation; a flow another, earlier story owns is not
  automatically re-run once a later story touches shared code it depends on (here: `home/index.ts`,
  touched by 082, 083 and 086). Re-running every sprint story's flows together at the end of the
  sprint — not just each story's own — is what caught this, and is worth doing as a standing step
  before `/sprint` writes its review.
- **Fixture-execution artifact, not a code defect.** Running `home-dashboard-arrange` and
  `home-dashboard-keyboard` (both mutate the persisted `homeLayout` in the shared `populated`
  fixture) immediately before `home-tile-states` in the same unseeded sequence made the
  `configProfiles` tile briefly disappear from the layout, failing `home-tile-states` for a reason
  that had nothing to do with story 087's own code. `npm run ui:flow` has always required a fresh
  `npm run ui:seed` between flows that mutate shared fixture state (documented in `flow.mjs`'s own
  header comment) — this is a reminder of that rule, not a new one.
- **Doc drift noted by story 085's own refine pass, not fixed this sprint:**
  `docs/concepts/home-screen.md` §6 still says the content repository holds "only a LICENSE"; it
  now also has `engines/` and `gamedata/` from story 080. Worth a small correction next time that
  concept doc is touched.
- Three new `CLAUDE.md` deviation rows were added (084's feed-image bitmap exception; 086/087's
  28px dashboard-tile affordances under the existing 44px-touch-target deviation pattern) — each
  with its own recorded reason, consistent with the project's existing deviation rows.

## Blocked / open

Nothing is blocked. No story was left in `draft` or `in-progress`.

## Acceptance

Every acceptance criterion across all 8 stories has a named, passing automated test — the mapping
lives in each story's own `## Acceptance Tests`/`## Done` section under
`docs/requirements/done/`. Re-verified together at the end of the sprint, on the final branch
state: `npm run typecheck`, `npm test` (3583/3583), `npm run build`, and `npm run ui:verify`
(43/43 screens, 0 axe violations) all green, plus all 7 of the sprint's `ui:flow` scripts
(`bootstrap-r1q2`, `home-route-roundtrip`, `news-feed`, `home-hero-carousel`,
`home-dashboard-arrange`, `home-dashboard-keyboard`, `home-tile-states`) passing individually
against a freshly reseeded fixture.

**Manual residue** (both from story 080, both declared in its own Done section, neither blocking):

- AC4's real Windows OpenGL/audio/input/map-load smoke test for R1Q2 — fixture executables cannot
  establish real engine compatibility; not run against real hardware this sprint.
- The dependency-notice completeness judgment for R1Q2's bundled license — license text is
  installed and surfaced, but whether it is exhaustively complete is a legal/maintainer judgment
  call, not something a test can prove.

No other story has manual residue. AC5 of story 080 also has a narrower proof than planned: the
UI-injected-runtime-probe half of "fails cleanly when the x86 runtime is absent" is covered at the
integration level (`bootstrap/job.test.ts`) rather than through a live UI flow, because no harness
hook exists to fake a missing runtime end-to-end — recorded in 080's Done section as a gap, not
silently dropped.
