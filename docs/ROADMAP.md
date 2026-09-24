# Roadmap

## Where we stand

*As of 2026-09-24.* Phases 1–4 and 7 are done. Phase 8 (Linux support, Steam Play/Proton runner
selection — stories 100, 101, 103–105) is also done, shipped ad hoc outside a formal sprint; story
102 (a self-built Linux Q2PRO) stays open as a standing, non-blocking item. Phase 9 (game browser)
is now prioritized and cut into 7 sprints, S22–S28 — next step is `/sprint S22`. Phase 5 (mods) and
Phase 6 (assets) remain unprioritised.

## Phase overview

| Phase | Milestones | Status |
| --- | --- | --- |
| 1 — Shell | 1/1 | done |
| 2 — Config module (r1q2 settings & cvars, full lifecycle) | 5/5 | done |
| 3 — Home screen (news hero + dashboard) | 2/2 | done |
| 4 — Install (download/update/repair) | 1/1 | done |
| 5 — Mods (game directories) | 0/1 | not started |
| 6 — Assets (texture/model/sound packs) | 0/1 | not started |
| 7 — Release & updates (beta rollout) | 1/1 | done |
| 8 — Platform parity (Linux support, Steam Play/Proton runners) | 1/1 | done |
| 9 — Game browser (server list, detail, watchlist, observing) | 0/7 | planned |

## Current phase

Phase 9 (game browser) is cut into 7 sprints, ready to start with S22. Phase 5 (mods) and Phase 6
(assets) are still unprioritised.

| # | Milestone | Status | Sprint(s) | Note |
| --- | --- | --- | --- | --- |
| 7.1 | Release & updates — changelog-driven GitHub releases, daily update check, user-chosen update | done 2026-09-13 | [S21](../sprints/S21/review.md) | Stories 096–099, all done. Two manual-residue items (a real GitHub publish, a real packaged-install restart) — see the review's Acceptance section. |
| 9.1 | Servers module foundation & protocol core | planned | S22 | Module scaffold, address validator, info/status + master-reply codecs, CLAUDE.md platform-parity rule. Stories 106–109. |
| 9.2 | Discovery & persistence | planned | S23 | Module `state.json` key, master-source settings, favourites, manual servers, history. Stories 110–113. |
| 9.3 | Scan engine | planned | S24 | Two-stage streaming scan, scan-budget settings measured against a real master list, no-scan-while-playing, scoped refreshes. Stories 114–117. |
| 9.4 | Server list UI | planned | S25 | Rows, markers, default sort, filters/search, loading/empty/error states. Stories 118–121. |
| 9.5 | Server detail view | planned | S26 | Header/players, rule table + `dmflags`, ping history + local mod/map availability. Stories 122–124. |
| 9.6 | Join, spectate, address book | planned | S27 | `+connect` join with mod-mismatch/password handling, spectate launch, address-book write dialog. Stories 125–127. |
| 9.7 | Experimental-features gate & watchlist | planned | S28 | Signed unlock codes, installation id, gate enforcement, then the gated watchlist. Stories 128–132. |

## Open / unprioritised

| Topic | State | Next step |
| --- | --- | --- |
| Story [102](requirements/102-a-linux-q2pro-is-built-and-mirrored.md) — a self-built Linux Q2PRO | Draft; standing obligation cut from 101, blocks nothing | Decide build/provenance approach (its Q1–Q4) when prioritized |
| Mods — game directories | Not started; `+set game <dir>` already built; needs discovery, install, enable/disable, per-mod config and a `game-lifecycle` guard against mutating files while running | `/roadmap plan` when prioritized |
| Assets — texture/model/sound packs | Not started; needs conflict detection between packs touching the same files, plus a per-pack change record (`Installation.moduleData` is the slot) | `/roadmap plan` when prioritized |
| Two config decisions left open across the file-format rounds: the `alias cali "bind ..."` key-block-as-layer question (story 041), and bind grouping by keyboard region vs. category (story 040, decided category for now) | Never blocked anything; only relevant if a future story touches this area | Decide when a config story next needs it |

## Follow-ups worth doing

- A mid-copy `PACKAGE_INCOMPLETE` failure can leave an installation's status stale until the next
  revalidation — a pattern shared by `retail/upgrade-job.ts` (090) and `repair/job.ts` (093); worth
  a fix once a job triggers it in practice. [S20 review](../sprints/S20/review.md)
- 093's `reinstall-engine` repair gates on the manifest being able to supply the installation's
  recorded engine, slightly stricter than the plan's offer gate — latent today since the shipped
  manifest only pins the two engines both paths already require; worth re-checking once a third
  engine is added. [S20 review](../sprints/S20/review.md)
- `bootstrap/job.ts`'s toggle-on extras pass re-copies the whole assemble plan a second time when
  `includeVideoAndPlayers` is set (pre-existing since story 074, confirmed still present by 088 and
  090) — worth a fix once that toggle sees more use. [S19 review](../sprints/done/S19/review.md)
- `docs/concepts/home-screen.md` §6 still says the content repository holds "only a LICENSE" —
  story 080 added `engines/` and `gamedata/`. A small doc correction, next time that concept is
  touched. [S18 review](../sprints/done/S18/review.md)
- Running every sprint's `ui:flow` scripts together at the end of a sprint (not just each story's
  own) is what caught a real regression in S18 (083 silently broke 082's own acceptance flow) that
  no single story's own verification would have seen — worth making a standing last step before
  `/sprint` writes its review. [S18 review](../sprints/done/S18/review.md)
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
- ESLint is absent (`typescript-eslint@8` caps TS `<6.1.0`; project is on TS7) — revisit when it
  supports TS7. Vite is pinned to 7.x (`electron-vite@5` constraint) — revisit at `electron-vite@6`.
- Per-installation launch profiles (cvar overrides, safe mode, connect-to-server).
- Crash detection: a non-zero exit shortly after start is worth surfacing.
- Only `en` ships; adding a locale is one JSON file plus one entry in `i18n/index.ts`.

## History

| Milestone | Sprint(s) | Done |
| --- | --- | --- |
| Shell | pre-sprint | done |
| Config — r1q2 settings and cvars | S01–S06 | 2026-08-22 |
| Config, round two — the file becomes the config | S07–S10 | 2026-09-04 |
| Config, round three — the editor reflects the file | S11–S13 | 2026-09-06 |
| Config, round three — live-acceptance findings | S14 | 2026-09-07 |
| Identity, icons and the first profile | S15 | 2026-09-07 |
| Install, first slice — bootstrap to a playable Q2PRO demo | S16 | 2026-09-08 |
| Install — real-run gaps: allowlist, failed-install persistence, failure cause | S17 | 2026-09-09 |
| Home screen — news hero | S18 | 2026-09-11 |
| Home screen — dashboard | S18 | 2026-09-11 |
| Install — retail import, demo upgrade | S19 | 2026-09-11 |
| Install — write-guard, engine update/rollback, repair, removal from disk | S20 | 2026-09-12 |
| Release & updates — changelog-driven releases, daily update check, user-chosen update | S21 | 2026-09-13 |
| Platform parity — Linux support, Steam Play/Proton runner selection | ad hoc (100, 101, 103–105) | 2026-09-24 |
