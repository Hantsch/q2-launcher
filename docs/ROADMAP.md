# Roadmap

## Where we stand

*As of 2026-09-12.* Config (Phase 2) and Phase 3 (home screen) are done. **[S19 review](../sprints/done/S19/review.md)
is done**: retail import from a detected store installation or an existing folder (088–089), plus
the demo-to-retail upgrade action (090) — all on real, non-demo installations proven end to end.
**[S20](../sprints/S20/sprint.md) is planned**: it closes out Phase 4 M1 — a job-writes-wait-for-a-
running-game guard (091, also retrofitted onto 090's gap), engine update/rollback (092), repair
(093) and removal from disk (094). Next step: the user starts `/sprint S20`.

## Phase overview

| Phase | Milestones | Status |
| --- | --- | --- |
| 1 — Shell | 1/1 | done |
| 2 — Config module (r1q2 settings & cvars, full lifecycle) | 5/5 | done |
| 3 — Home screen (news hero + dashboard) | 2/2 | done |
| 4 — Install (download/update/repair) | 0/1 | in progress, S20 planned |
| 5 — Mods (game directories) | 0/1 | not started |
| 6 — Assets (texture/model/sound packs) | 0/1 | not started |

## Current phase

**Phase 4 — Install (download/update/repair)**, one milestone, in progress since S16.

| # | Milestone | Status | Sprint(s) | Note |
| --- | --- | --- | --- | --- |
| 4.1 | Install — bootstrap, update and repair ([concepts/install-module.md](concepts/install-module.md)) | planned | [S16 review](../sprints/done/S16/review.md), [S17 review](../sprints/done/S17/review.md), [S18 review](../sprints/done/S18/review.md), [S19 review](../sprints/done/S19/review.md), [S20](../sprints/S20/sprint.md) | Q2PRO and R1Q2 bootstraps ship (story 080); S19 shipped retail import + demo upgrade (088–090); S20 closes update/rollback, repair and removal from disk (091–094). |

## Open / unprioritised

| Topic | State | Next step |
| --- | --- | --- |
| Mods — game directories | Not started; `+set game <dir>` already built; needs discovery, install, enable/disable, per-mod config and a `game-lifecycle` guard against mutating files while running | `/roadmap plan` when prioritized |
| Assets — texture/model/sound packs | Not started; needs conflict detection between packs touching the same files, plus a per-pack change record (`Installation.moduleData` is the slot) | `/roadmap plan` when prioritized |
| Two config decisions left open across the file-format rounds: the `alias cali "bind ..."` key-block-as-layer question (story 041), and bind grouping by keyboard region vs. category (story 040, decided category for now) | Never blocked anything; only relevant if a future story touches this area | Decide when a config story next needs it |

## Follow-ups worth doing

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
- Auto-update via `electron-updater`, plus a code-signing decision (unsigned builds trigger
  SmartScreen).
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
