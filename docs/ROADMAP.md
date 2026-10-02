# Roadmap

## Where we stand

_As of 2026-10-02._ Phases 1–4 and 7–10 are done, and Mods milestone 5.1 is done (S31).
Current: Phase 11, codebase health. The 2026-10-01 review's stories 199–231 are cut into S32 (gate,
foundations, module bus) and S33 (config + renderer layers, docs, X11 stage story 198).
Next: `/sprint S32`, then `/sprint S33` once S32 is merged. Waiting on the user: the manual residue in
the S28–S30 testplans, and 102's Q1–Q4.

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
| 11 — Codebase health (review 2026-10-01, stories 199–231)         | 0/2        | planned     |

## Current phase

Phase 11 — codebase health, source [codebase review 2026-10-01](reviews/2026-10-01-codebase-review.md).

| #    | Milestone                                                  | Status  | Sprint(s)                    | Note                                                              |
| ---- | ---------------------------------------------------------- | ------- | ---------------------------- | ----------------------------------------------------------------- |
| 11.1 | A green gate, safe foundations, one module bus             | planned | [S32](sprints/S32/sprint.md) | 18 stories, main side and infra; 223 (green gate) goes first.     |
| 11.2 | Config module and renderer on shared layers, docs as built | planned | [S33](sprints/S33/sprint.md) | 16 stories incl. X11 stage story 198; starts after S32 is merged. |

## Open / unprioritised

| Topic                                                                                                                                                                                                                      | State                                                                                                                                                                                                                                                                   | Next step                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Story [102](requirements/102-a-linux-q2pro-is-built-and-mirrored.md) — a self-built Linux Q2PRO                                                                                                                            | Draft; standing obligation cut from 101, blocks nothing                                                                                                                                                                                                                 | Decide build/provenance approach (its Q1–Q4) when prioritized                                                                                   |
| Demos in a browser (WASM) engine — optional "Browser (experimental)" playback next to native Q2PRO, for an embedded canvas and Linux/Wayland without window placement                                                      | Deferred 2026-09-30 (polish, future): native Q2PRO works well for the start. Research in [demo-browser §9.2](concepts/demo-browser.md); depends on the q2pro `feature-rtx` WASM build (maintainer open to compiling common mods, which demo playback may not even need) | Spike when prioritized: run the web build in Electron with a vanilla and an OpenTDM demo (seek, speed, no game lib); `/roadmap plan` afterwards |
| Mods — game directories, concept [mods.md](concepts/mods.md)                                                                                                                                                               | Milestone 5.1 (catalog, install, remove, updates, stories 188–194) done 2026-10-01 with server-browser stories 195–197 — [S31](sprints/done/S31/review.md)                                                                                                              | 5.2 `/roadmap plan`                                                                                                                             |
| Assets — texture/model/sound packs                                                                                                                                                                                         | Not started; needs conflict detection between packs touching the same files, plus a per-pack change record (`Installation.moduleData` is the slot)                                                                                                                      | `/roadmap plan` when prioritized                                                                                                                |
| Two config decisions left open across the file-format rounds: the `alias cali "bind ..."` key-block-as-layer question (story 041), and bind grouping by keyboard region vs. category (story 040, decided category for now) | Never blocked anything; only relevant if a future story touches this area                                                                                                                                                                                               | Decide when a config story next needs it                                                                                                        |

## Follow-ups worth doing

- `replays-mod-warning` is quarantined as flaky (step 'resetting remembered mods asks again', 1–2 of ~6 runs) — fix it and drop its quarantine entry. [S31 review](sprints/done/S31/review.md)
- OpenTDM on 64-bit Q2PRO is refused (`mods.error.noVariant`, empty `contentOnly.packages`) — give it a content-only variant or a 64-bit build. [S31 review](sprints/done/S31/review.md)
- Play anyway on a mod whose game dir does not exist on disk fails in main (ENOENT writing `q2l_back.cfg`) and is not shown to the user as a play error. [S30 review](sprints/done/S30/review.md)
- Measure the Linux channel's control latency / stdout buffering on a real Linux Q2PRO; no Linux lever was applied in 185. [S30 review](sprints/done/S30/review.md)
- Add `writeCatalogDefaults` to `captureBaseline` (`src/shared/config/profile-baseline.ts`): today a pending catalog-defaults toggle lands on disk with an address-book add. [S29 review](sprints/done/S29/review.md)
- Stage cvar restore edges: a launcher quit while the game runs lets the stage values persist, and negative display origins (`+-X` in `vid_geometry`) are unverified against real Q2PRO. [S29 review](sprints/done/S29/review.md)
- A stop whose kill succeeds but never yields an `exit` event leaves the UI on "Stopping…" (e.g. a Linux wine wrapper). [S29 review](sprints/done/S29/review.md)
- Story 157's AC6 (rename while playing) can now get its real-playback e2e. [S28 review](sprints/done/S28/review.md)

- `docs/ARCHITECTURE.md#adding-a-module` should name `src/shared/ipc-schemas.ts`'s hardcoded
  `moduleId` z.enum as a step — it is not extended automatically, and 106 rediscovered that.
  [S22 review](../sprints/S22/review.md)
- A scoped refresh ("Refresh favourites" / "Refresh this server") overwrites a row's `origins`
  instead of merging them into the existing entry — currently inert since nothing reads `origins`
  yet, but worth fixing before story 131's watchlist work is likely to. [S24 review](../sprints/S24/review.md)
- `AppContext` exposes both the frozen `features` gate and the live `unlock` service side by side —
  a future handler reading `app.unlock` directly (bypassing `app.features.isFeatureUnlocked`) could
  see a mid-session redemption before the boot-time gate does. Not exploitable today (no
  redeem-triggering channel reads it directly), but worth hardening — e.g. freezing/hiding `unlock`
  from module handlers — before a future feature adds one. [S25 review](../sprints/S25/review.md)

- A mid-copy `PACKAGE_INCOMPLETE` failure can leave an installation's status stale until the next
  revalidation — a pattern shared by `retail/upgrade-job.ts` (090) and `repair/job.ts` (093); worth
  a fix once a job triggers it in practice. [S20 review](../sprints/S20/review.md)
- 093's `reinstall-engine` repair gates on the manifest being able to supply the installation's
  recorded engine, slightly stricter than the plan's offer gate — latent today since the shipped
  manifest only pins the two engines both paths already require; worth re-checking once a third
  engine is added. [S20 review](../sprints/S20/review.md)
- `bootstrap/job.ts`'s toggle-on extras pass re-copies the whole assemble plan a second time when
  `includeVideoAndPlayers` is set (pre-existing since story 074, confirmed still present by 088 and 090) — worth a fix once that toggle sees more use. [S19 review](../sprints/done/S19/review.md)
- `docs/concepts/home-screen.md` §6 still says the content repository holds "only a LICENSE" —
  story 080 added `engines/` and `gamedata/`. A small doc correction, next time that concept is
  touched. [S18 review](../sprints/done/S18/review.md)
- A `missingChecks` entry whose translation interpolates a variable (e.g. `validation.rootMissing`'s
  `{{path}}`) renders that placeholder unfilled wherever a failure's target verdict is now shown
  on screen — `DownloadDiagnosticsTarget.missingChecks` has stored only `{id, messageKey}` since
  075's redaction boundary, with no `params`. [S17 review](../sprints/done/S17/review.md)
- `scripts/fetch-7za.mjs` (071) has never run end-to-end in this environment (no network access
  to 7-zip.org) — the wiring is correct but unverified against a real download; three tests stay
  `it.skipIf`-gated until someone with network access runs it once. [S16 review](../sprints/done/S16/review.md)
- `setPlayedMods`/`setSwitchBind` (022) still bypass the sync engine — a stale switch-bind chain
  can `exec` an unmigrated filename until the next real sync touches that profile.
- 9 non-blocking findings from story 010's review (case-folding inconsistencies, restore-primitive
  scope, locally-redeclared types) — see `docs/sprints/done/S02/review.md`.
- Executable/marker names for engines other than r1q2/Q2PRO are unverified (now cosmetic-only
  since story 068 made "supported" a data flag).
- `detectedVersion` stays unpopulated for any installation outside the update/rollback path
  itself (S20/092 only records what that path just wrote) — probing a Windows version resource
  or console banner for the general case is still open.
- No `-safe` launch mode exists in r1q2 — one has to be a launcher-composed `+set` bundle.
- 098's real `checker.ts` has a narrow cancel-timing window (a cancel racing the moment a download
  finishes) flagged by its review and left as a documented, non-blocking limitation — worth closing
  once anyone hits it in practice. [S21 review](../sprints/S21/review.md)
- Make `ci.yml`'s `npm audit` step blocking (drop `continue-on-error`) on 2026-10-09, after S33.
  [story 226]
- Per-installation launch profiles (cvar overrides, safe mode, connect-to-server).
- Crash detection: a non-zero exit shortly after start is worth surfacing.
- Only `en` ships; adding a locale is one JSON file plus one entry in `i18n/index.ts`.

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
