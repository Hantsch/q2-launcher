# Roadmap

## Where we stand

*As of 2026-09-08.* The Config module is fully done (S01–S15) — no phase is currently in
progress. Last finished: milestone "Identity, icons and the first profile" (S15, closed
2026-09-07) — engine vocabulary, per-installation icons, a two-line profile header, and
profile creation from template or own config files. Next step: pick and cut the next
milestone (see Open / unprioritised) with `/roadmap plan`. Nothing is waiting on the user
right now.

## Phase overview

| Phase | Milestones | Status |
| --- | --- | --- |
| 1 — Shell | 1/1 | done |
| 2 — Config module (r1q2 settings & cvars, full lifecycle) | 5/5 | done |
| 3 — Home screen (news hero + dashboard) | 0/1 | not started |
| 4 — Install (download/update/repair) | 0/1 | not started |
| 5 — Mods (game directories) | 0/1 | not started |
| 6 — Assets (texture/model/sound packs) | 0/1 | not started |

## Current phase

No phase is currently open. Pick the next milestone from "Open / unprioritised" below and run
`/roadmap plan`.

## Open / unprioritised

| Topic | State | Next step |
| --- | --- | --- |
| Home screen — news hero + customizable dashboard ([concepts/home-screen.md](concepts/home-screen.md)) | Concept drafted 2026-09-07; composition decided on the prototype (variant A: 320px hero over the dashboard); 13 open points remain, the largest being a possible fixed friend-list column | `/roadmap plan` — cut the stories |
| Downloads running-count badge ([story 032](requirements/032-downloads-badge-active-count.md)) | Filed 2026-08-21; blocked on the Install module's job queue, which does not exist yet | Cut once the Install module starts |
| Install — bootstrap, update and repair ([concepts/install-module.md](concepts/install-module.md)) | Concept drafted 2026-09-08; 20 open points remain, the largest being how to pin a rolling upstream build and where r1q2 binaries come from at all | `/roadmap plan` — cut the stories |
| Mods — game directories | Not started; `+set game <dir>` already built; needs discovery, install, enable/disable, per-mod config and a `game-lifecycle` guard against mutating files while running | `/roadmap plan` when prioritized |
| Assets — texture/model/sound packs | Not started; needs conflict detection between packs touching the same files, plus a per-pack change record (`Installation.moduleData` is the slot) | `/roadmap plan` when prioritized |
| Two config decisions left open across the file-format rounds: the `alias cali "bind ..."` key-block-as-layer question (story 041), and bind grouping by keyboard region vs. category (story 040, decided category for now) | Never blocked anything; only relevant if a future story touches this area | Decide when a config story next needs it |

## Follow-ups worth doing

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
- The hero's news carousel is wired but empty — folds into the Home Screen milestone.
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
