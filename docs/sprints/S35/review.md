# Sprint S35 review

**Goal:** mod and map are chosen only where the game starts, assigning a config never destroys a user's file, and the server and demo browsers keep their detail pane, with joinable and trustworthy server lists, server locations, and richer demo details.

Branch `sprint/S35`, 13/13 stories done, regression gate green after one fix commit. Merging into `dev` is the user's decision (S32–S35 wait in order).

## Overview

| Story | Status | Commit |
| --- | --- | --- |
| 251 Launch with applies only when I start the game | done | e8516a2 footer hides it on Servers/Demos, joins pass no mod, mismatch prompt removed |
| 252 I pick a map in the footer and Play starts in it | done | 5aa5c87 footer Map select; Play with… dialog removed |
| 253 An unassigned config profile tells me it is not used | done | 8fe5b98 banner with Assign… + "Not assigned" marker |
| 254 The first assignment backs up the original configs | done | 5671f61 backup folder + restore from the profiles panel |
| 255 Assigning never overwrites a foreign config silently | done | 8c1b94d dialog; Write backs the file up first |
| 256 Server details are always shown | done | 44d7e01 empty-state pane, click never deselects |
| 257 Double-click or Enter joins; arrow keys move | done | 2bf6d4b setting (default on), Enter, arrows |
| 258 Server pings match what I get in game | done | 20e1c70 median of 3–6 samples, per-send sockets |
| 259 Batch actions show from one selected demo | done | 6cf73ef bar condition `selectedIds.length > 0` |
| 260 Demo details are always shown | done | c19c2c0 empty-state pane, close button removed |
| 261 The demo players are split by team | done | 93ec00e two columns, side colour tokens |
| 262 Demo details show the POV player's accuracy stats | done | d016694 print observer, dm2-stats, cache v7 |
| 263 I see where a server is and filter by region | done | 90258bd bundled DB-IP database, Location column, grouped filter |
| gate fixes | done | f075eb6 252, 254, 256, 257, 258, 262 regressions from the sprint gate |

## Implemented stories

- **251/252** The footer's "Launch with" and the new Map select exist only where Play starts the game; joins pass no mod and the mismatch prompt is gone. Map listing is release code (`installations:listMaps`) and the dev-only "Play with…" dialog was removed (the veto window in the sprint notes passed unused).
- **253–255** Config safety: unassigned profiles say so; the launcher's first write into an installation backs the originals up to `q2launcher-original-configs/` (restorable); assigning onto a foreign `.cfg` asks first and backs it up.
- **256/257/260** The server and demo detail panes are always there; the server list joins on double-click or Enter and moves with arrow keys.
- **258** Pings are the median of 3–6 samples with per-send sockets and an arrival stamp.
- **259/261/262** One selected demo gets the batch bar; players split by team; the POV player's OpenTDM accuracy table shows from the real reference demo.
- **263** A bundled DB-IP Lite country database (CC BY 4.0, attributed in Settings > About) powers a Location column and a grouped region/country filter.

## Findings and decisions

- Cross-story breakage the narrow gates could not see (all fixed in f075eb6): story 252's footer `select` broke two bare `select` locators (`unsaved-diff`, two ui:verify screens); stories 252/254/258/262 each tripped a repo-health test (areas.json coverage/cap, comment rule, helper duplication, pinned tsconfig excludes); 256's always-present pane failed axe on the servers list; 257 pushed ServersView over 350 lines (join and arrow-key logic extracted into two hooks).
- Build agents left CRLF in the worktree (git normalises to LF); 11 files were converted. Narrow gates also ran the release `build` over the dev bundle twice, which turns mods flows red — keep verifying with `build:dev`.
- Story 258's AC6 real-socket ping test cannot catch a receive stamp taken after processing (a discriminating variant was flaky); AC5's fake-socket test is the proof. Low-severity review nits are in each story's Done section.
- Unfixed findings: TD-049 … TD-053 in [TECH-DEBT.md](../../TECH-DEBT.md), plus the two flaky flows (TD-052). The progress trail had two slips where a build agent wrote two events in one command; timestamps were shell-produced and monotonic.
- Doc check: every story touching a module also touched its `docs/systems/` doc. CHANGELOG has an entry for every user-facing story; none was added late.

## Blocked / open

Nothing blocked. No open questions.

## Regression gate

Commands and result are recorded in [sprint.md](sprint.md#regression-gate). Green after f075eb6 except two quarantined flaky flows (`news-feed`, `unlock-code`) and the scan-ping-accuracy timing flake (TD-049). Pre-existing broken ROADMAP/S34 links (S34 moved to `sprints/done/`) were repaired here.

## Acceptance

Every story's criteria are mapped to named unit, component or e2e tests in its `docs/requirements/done/<id>-*.md` (Done section); all passed in the narrow gates and the full gate. Per story ticked criteria: 251 (7), 252 (8), 253 (7), 254 (6), 255 (7), 256 (6), 257 (7), 258 (7), 259 (4), 260 (6), 261 (9), 262 (11), 263 (20). No manual residue anywhere, so no testplan was written.

Covered a level below the real surface: 252 AC1 ("release build") by a component test with `DEV_MODULES` mocked false, since flows run the dev build; 252 AC8's demo half by a unit test on the real demo-playback path; 261 AC4/AC5 (no teams, more than two) by component tests only; 258 AC6 as noted above; 256 AC5 on Online only.

## Tier record

| Story | Ds | hard Ds | review | cycles | agents | build min |
| --- | --- | --- | --- | --- | --- | --- |
| 251 | 3 | 0 | default | 1 | 6 | 46 |
| 252 | 5 | 1 | default | 1 | 10 | 52 |
| 253 | 2 | 0 | default | 1 | 5 | 21 |
| 254 | 3 | 1 | default | 1 | 6 | 35 |
| 255 | 2 | 0 | default | 0 | 4 | 21 |
| 256 | 2 | 0 | default | 1 | 6 | 13 |
| 257 | 4 | 0 | default | 1 | 9 | 43 |
| 258 | 5 | 1 | default | 1 | 11 | 52 |
| 259 | 1 | 0 | default | 1 | 3 | 16 |
| 260 | 2 | 0 | default | 0 | 5 | 39 |
| 261 | 2 | 0 | default | 1 | 7 | 21 |
| 262 | 3 | 1 | default | 1 | 7 | 34 |
| 263 | 8 | 1 | default | 1 | 12 | 68 |
| **Total** | **42** | **5** | 0 hard reviews | 11 | 91 | 461 |

No hard review stage ran this sprint (all 13 stories were `Review: → default`), so the question whether it finds more than the default review does not arise; the cross-story breakage above was caught by the gate, not by any review.

Measured minutes: refine 8; builds above; gate short suites 7 (build 1, test 1.1, ui:verify 4.1), e2e-all 22.5 and 23.5, attribution/fix agents ~8 and ~20.
