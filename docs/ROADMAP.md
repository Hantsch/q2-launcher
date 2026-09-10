# Roadmap

## Where we stand

*As of 2026-09-10.* Config (Phase 2) and the shell are done; Phase 4's install module reached a
real, failure-honest bootstrap for Q2PRO (S16, [S17 review](../sprints/done/S17/review.md)).
Two things are in flight: story 079 (a save reaches every installation, and Care sees drift) is
finishing on `dev` outside a sprint, and **[S18](../sprints/S18/sprint.md) is cut and planned** —
R1Q2 as a second installable engine plus the whole home-screen milestone (news hero over a
user-arranged dashboard). Next step: `/sprint S18`. Nothing is waiting on the user.

## Phase overview

| Phase | Milestones | Status |
| --- | --- | --- |
| 1 — Shell | 1/1 | done |
| 2 — Config module (r1q2 settings & cvars, full lifecycle) | 5/5 | done |
| 3 — Home screen (news hero + dashboard) | 0/2 | planned (S18) |
| 4 — Install (download/update/repair) | 0/1 | in progress |
| 5 — Mods (game directories) | 0/1 | not started |
| 6 — Assets (texture/model/sound packs) | 0/1 | not started |

## Current phase

**Phase 3 — Home screen (news hero + dashboard)**, cut into two milestones — plus Phase 4's
install milestone, which the same sprint carries on with R1Q2.

| # | Milestone | Status | Sprint(s) | Note |
| --- | --- | --- | --- | --- |
| 3.1 | Home screen — news hero ([concepts/home-screen.md](concepts/home-screen.md)) | planned | [S18](../sprints/S18/sprint.md) | Stories 081–085: the `home` module takes the screen over, the community feed is fetched and cached, the 320px hero renders it, images come from main's cache, and the content repo carries the contract. |
| 3.2 | Home screen — dashboard ([concepts/home-screen.md](concepts/home-screen.md)) | planned | [S18](../sprints/S18/sprint.md) | Stories 086–087: the 12 × 40px arrange-mode grid with keyboard parity and persistence, plus the two v1 tiles (playtime, config profiles). |
| 4.1 | Install — bootstrap, update and repair ([concepts/install-module.md](concepts/install-module.md)) | in progress | [S16 review](../sprints/done/S16/review.md), [S17 review](../sprints/done/S17/review.md), [S18](../sprints/S18/sprint.md) | Q2PRO bootstrap ships; S18 adds R1Q2 (story 080). Retail import, update/rollback, repair and removal from disk still follow. |

## Open / unprioritised

| Topic | State | Next step |
| --- | --- | --- |
| Mods — game directories | Not started; `+set game <dir>` already built; needs discovery, install, enable/disable, per-mod config and a `game-lifecycle` guard against mutating files while running | `/roadmap plan` when prioritized |
| Assets — texture/model/sound packs | Not started; needs conflict detection between packs touching the same files, plus a per-pack change record (`Installation.moduleData` is the slot) | `/roadmap plan` when prioritized |
| Two config decisions left open across the file-format rounds: the `alias cali "bind ..."` key-block-as-layer question (story 041), and bind grouping by keyboard region vs. category (story 040, decided category for now) | Never blocked anything; only relevant if a future story touches this area | Decide when a config story next needs it |

## Follow-ups worth doing

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
- `detectedVersion` is never populated (Windows version resource or console-banner parse).
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
