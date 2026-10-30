# Roadmap

## Where we stand

_As of 2026-10-30._ Phases 1–4 and 7–10 are done, and Mods milestone 5.1 is done (S31). Current: Phase 11, codebase health and user feedback.
S37 is finished on `sprint/S37`: all 13 stories (276–280, 320–327) done, gate green after five fix commits ([S37 review](sprints/done/S37/review.md)); this closes milestone 11.6 and with it Phase 11. Next: `/roadmap plan` for Phase 12 (integrated demo player, drafts 281–319) once the user decides to start it.
Phase 12 (integrated demo player) is drafted for after Phase 11.
Waiting on the user: merging `sprint/S37` into `dev` (after `sprint/S32`–`S35`), pushing the edited OpenTDM manifest to `Hantsch/q2_community_content` (story 327 reaches users only then), the S37 manual residue ([testplan](sprints/done/S37/testplan.md)), pushing `dev` and the S36 manual residue ([testplan](sprints/done/S36/testplan.md)), 234 AC3 GitHub half, merging `sprint/S32`–`S35` into `dev` in order,
the manual residue in the S28–S30, [S32](sprints/done/S32/testplan.md), [S33](sprints/done/S33/testplan.md) and [S34](sprints/done/S34/testplan.md) testplans.

## Phase overview

| Phase                                                             | Milestones | Status      |
| ----------------------------------------------------------------- | ---------- | ----------- |
| 1 — Shell                                                         | 1/1        | done        |
| 2 — Config module (r1q2 settings & cvars, full lifecycle)         | 5/5        | done        |
| 3 — Home screen (news hero + dashboard)                           | 2/2        | done        |
| 4 — Install (download/update/repair)                              | 1/1        | done        |
| 5 — Mods (game directories)                                       | 1/2        | in progress |
| 6 — Assets (texture/model/sound packs)                            | 0/1        | not started |
| 7 — Release & updates (beta rollout)                              | 1/1        | done        |
| 8 — Platform parity (Linux support, Steam Play/Proton runners)    | 1/1        | done        |
| 9 — Game browser (server list, detail, watchlist, observing)      | 7/7        | done        |
| 10 — Demo browser (library, metadata, remote-controlled playback) | 10/10      | done        |
| 11 — Codebase health (reviews 2026-10-01 and 2026-10-27)          | 5/6        | in progress |
| 12 — Integrated demo player (WASM) and MP4 export                 | 0/7        | not started |

## Current phase

Phase 11 — codebase health, source [codebase review 2026-10-01](reviews/2026-10-01-codebase-review.md).

| #    | Milestone                                                  | Status          | Sprint(s)                         | Note                                                                                                 |
| ---- | ---------------------------------------------------------- | --------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 11.1 | A green gate, safe foundations, one module bus             | done 2026-10-02 | [S32](sprints/done/S32/review.md) | 18 stories, main side and infra; merge into `dev` waits on the user.                                 |
| 11.2 | Config module and renderer on shared layers, docs as built | done 2026-10-03 | [S33](sprints/done/S33/review.md) | 16 stories incl. X11 stage story 198; merge into `dev` waits on the user.                            |
| 11.3 | Health drafts closed, demo/install/server user stories     | done 2026-10-06 | [S34](sprints/done/S34/review.md) | 19 stories incl. the 234 rehearsal (20 Linux flows quarantined); merge into `dev` waits on the user. |
| 11.4 | User feedback 2026-10-26: launch, config safety, browsing  | done 2026-10-27 | [S35](sprints/done/S35/review.md) | 13 stories 251–263; merge into `dev` waits on the user.                                              |
| 11.5 | Tests review 2026-10-27: blocking lanes, cheaper gate      | done 2026-10-29 | [S36](sprints/done/S36/review.md) |                                                                                                      |
| 11.6 | PR and release path, overdue tech debt                     | done 2026-10-30 | [S37](sprints/done/S37/review.md) | 13 stories 276–280, 320–327; merge into `dev` waits on the user.                                     |

## Open / unprioritised

| Topic                                                                                                                                                                                                                      | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Next step                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [Integrated demo player and MP4 export](concepts/integrated-demo-player.md) — Q2PRO as WebAssembly in the launcher, switchable with engine mode, deterministic MP4 export                                                  | Concept drafted 2026-10-30 with story drafts [281](requirements/281-the-engine-builds-reproducibly-as-webassembly.md)–[319](requirements/319-mvd2-demos-play-in-integrated-mode.md) in seven increments; 9 open points                                                                                                                                                                                                                                                                                                                               | `/roadmap plan`                                                                    |
| Mods — game directories, concept [mods.md](concepts/mods.md)                                                                                                                                                               | Milestone 5.1 (catalog, install, remove, updates, stories 188–194) done 2026-10-01 with server-browser stories 195–197 — [S31](sprints/done/S31/review.md)                                                                                                                                                                                                                                                                                                                                                                                           | 5.2 `/roadmap plan`                                                                |
| Assets — texture/model/sound packs                                                                                                                                                                                         | Not started; needs conflict detection between packs touching the same files, plus a per-pack change record (`Installation.moduleData` is the slot)                                                                                                                                                                                                                                                                                                                                                                                                   | `/roadmap plan` when prioritized                                                   |
| Two config decisions left open across the file-format rounds: the `alias cali "bind ..."` key-block-as-layer question (story 041), and bind grouping by keyboard region vs. category (story 040, decided category for now) | Never blocked anything; only relevant if a future story touches this area                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Decide when a config story next needs it                                           |
| [Codebase review 2026-10-01](reviews/2026-10-01-codebase-review.md), stories 199–231 (its [five-group suggestion](reviews/2026-10-01-codebase-review.md) is the cut)                                                       | Cut as applied: S32 = 11.1, S33 = 11.2; the S32 review's drafts [232](requirements/done/232-every-modules-handlers-are-typed-from-a-contract.md), [233](requirements/done/233-the-flow-gate-has-no-quarantined-flows-and-catches-cross-story-breakage.md), [234](requirements/done/234-release-verification-and-ci-rehearsals-run-before-a-merge-to-main.md), [235](requirements/done/235-shutdown-state-store-and-job-edge-cases-are-closed.md), [236](requirements/done/236-the-layer-and-error-key-rules-have-no-known-holes.md) await a decision | Decide on 232–236 after S33; unfixed findings live in [TECH-DEBT.md](TECH-DEBT.md) |

## Follow-ups worth doing

- Fix the ten S37 review findings (TD-060 to TD-069); the module-failure contract of story 322 has no module doc (TD-063). [S37 review](sprints/done/S37/review.md)
- Split the longest flow shard: the S36 gate's was 18.8 min, over the 15-min mark. [S36 review](sprints/done/S36/review.md)
- R1Q2 demo pause/speed via a control channel (r1q2 has `pause`/`timescale`). [S36 review](sprints/done/S36/review.md)
- `detectedVersion` is only recorded by the update/rollback path; probe a Windows version resource or console banner for the general case.
- Per-installation launch profiles (cvar overrides, connect-to-server, a launcher-composed `+set` safe mode: r1q2 has no `-safe`).
- Crash detection: a non-zero exit shortly after start is worth surfacing.
- Upstream the tech-debt ageing rule (docs/README.md, `.claude/ai-scrum.md` Notes) into the ai-scrum plugin — for the user. [story 229]
- Register the six S34 flows in `scripts/flows/areas.json` and make `--affected` selective when `scripts/lib` changes (TD-042, TD-043). [S34 review](sprints/done/S34/review.md)

## History

| Milestone                                                                                     | Sprint(s)                  | Done       |
| --------------------------------------------------------------------------------------------- | -------------------------- | ---------- |
| Shell                                                                                         | pre-sprint                 | done       |
| Config — r1q2 settings and cvars                                                              | S01–S06                    | 2026-08-22 |
| Config, round two — the file becomes the config                                               | S07–S10                    | 2026-09-04 |
| Config, round three — the editor reflects the file                                            | S11–S13                    | 2026-09-06 |
| Config, round three — live-acceptance findings                                                | S14                        | 2026-09-07 |
| Identity, icons and the first profile                                                         | S15                        | 2026-09-07 |
| Install, first slice — bootstrap to a playable Q2PRO demo                                     | S16                        | 2026-09-08 |
| Install — real-run gaps: allowlist, failed-install persistence, failure cause                 | S17                        | 2026-09-09 |
| Home screen — news hero                                                                       | S18                        | 2026-09-11 |
| Home screen — dashboard                                                                       | S18                        | 2026-09-11 |
| Install — retail import, demo upgrade                                                         | S19                        | 2026-09-11 |
| Install — write-guard, engine update/rollback, repair, removal from disk                      | S20                        | 2026-09-12 |
| Release & updates — changelog-driven releases, daily update check, user-chosen update         | S21                        | 2026-09-13 |
| Platform parity — Linux support, Steam Play/Proton runner selection                           | ad hoc (100, 101, 103–105) | 2026-09-24 |
| Game browser — server list, detail, join/spectate/address book, experimental gate & watchlist | S22–S25                    | 2026-09-26 |
| Demo browser — parsing, discovery & index, sidecar                                            | S26                        | 2026-09-28 |
| Demo browser — list, detail, edit & file actions                                              | S27                        | 2026-09-29 |
| Demo browser — playback, timeline & binds, auto-record                                        | S28                        | 2026-09-29 |
| Demo browser — demo plays in the launcher (stage)                                             | S29                        | 2026-09-29 |
| Demo browser — polish                                                                         | S30                        | 2026-09-30 |
