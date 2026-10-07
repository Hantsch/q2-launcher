---
sprint: S33
status: done
branch: sprint/S33
milestone: 11.2 — Codebase health, part 2 — the config module and the renderer on shared layers, docs as built
---

# Sprint S33 — Codebase health, part 2 — config and renderer on shared layers, docs as built

## Goal

The config module's main side is thin handlers over declared-once profile shapes, and
profile-restore is a folder of named stages. Every renderer screen reads main-owned data through one
query hook, saves a profile edit through one hook, and uses the UI kit's shared name, confirm, tabs,
error boundary, sort and search. The Controls tab is a component tree. On X11 the staged game stays
on top of the launcher. The docs, system docs and comments describe the launcher as built, and tech
debt has one home with an ageing rule.

## Stories (in build order)

- [x] 224 — the e2e fixture and flow helpers are shared and schema-checked
- [x] 211 — config profile shapes are declared once
- [x] 210 — the config module's main side is handlers, not business logic
- [x] 214 — profile-restore is a folder of named stages
- [x] 212 — saving a profile edit is one hook, and a new alias lands in a real category
- [x] 215 — main-owned data is read through one query hook
- [x] 216 — the UI kit has name, confirm, tabs and one error boundary
- [x] 217 — list sort and search are shared
- [x] 218 — the config detail screen reads its profile from a provider
- [x] 213 — the Controls tab is a component tree with a shared test harness
- [x] 231 — i18n keys are referenced, not duplicated, and live with their module
- [x] 198 — the staged game stays on top on X11
- [x] 227 — the docs describe the launcher as built
- [x] 228 — every shipped module has a system doc
- [x] 230 — comments state invariants, not sprint history
- [x] 229 — tech debt has one home and an ageing rule

## Notes

- Source: [codebase review 2026-10-01](../../../reviews/2026-10-01-codebase-review.md), second half of
  the two-sprint cut (see [S32](../S32/sprint.md) for why two). Builds on S32's contract (envelope,
  refusal shape, typed handlers); start only after S32 is merged into `dev`.
- **Order.** 224 goes first so the shared fixture gates every later flow change. The config main
  side comes next (211 → 210 → 214), then the renderer layers (212, 215, 216, 217), then their
  consumers (218 after 212 + 215; 213 after 212 and 216, so the Controls tree is built from the new
  kit). 231 runs after the renderer rewrites so it moves the final keys. The docs come last because
  they describe the result: 227 → 228 → 230. 229 is the very last story, so its triage of roadmap
  follow-ups and review leftovers can delete what 199–231 fixed instead of filing it.
- 214 and 230 are P3 in the review. They are in because they touch files this sprint rewrites anyway
  (profile-restore, and every file the sweep reaches after the refactors).
- 198 is the one user-facing story. It is contained in `stage.ts`/`stage-follow.ts` and comes
  after 222 (S32), which put platform rules in one module. Real X11 behaviour can't be e2e-proven
  on this machine, so its criteria that need a real X server are expected to become manual residue.
- 229 AC4 asks to change the `/roadmap` and `/sprint` instructions. Those files are plugin-managed
  (`ai-scrum:managed`, "do not edit"), so the clarification round must settle where the rule
  lives instead (e.g. docs/README.md and `.claude/ai-scrum.md` Notes).
- Deliberately not in this sprint: 102 (Linux Q2PRO build, needs its Q1–Q4 decided first) and Mods
  milestone 5.2.

## Regression gate

Ran on `8186078`+fixes → fixes committed as `95522d3`; confirmation run on `95522d3`.

- `npm run build` green (0.1 min); `npm test` 7028 passed / 8 skipped after fixes (first run 3 red, 0.5 min); `npm run ui:verify` exit 0 after fix (first run exit 1, 2.1 min); `npm run ui:flows` first run 140/143 in 51 min, confirmation run 142/143 in 50.5 min (remaining: quarantined `mods-view`, expected).
- Failures and outcomes:
  - `shell-layering` "no shell file imports from modules" → story 224 (`31b87f6`), fixed in `95522d3` (fixture-parity test moved next to the other module-importing golden test).
  - `test-kit` mockClient offender `useQuickFilters.test.ts` → story 215, fixed in `95522d3`.
  - `architecture-doc` planned-in-story marker for done story 230 → story 227, fixed in `95522d3` (sentence rewritten; TD-031 tracks the unmigrated bare catches).
  - `ui:verify` `config-aliases` unreachable → story 231 (`afdb229`): key-usage sweep deleted dynamic `config.aliases.origin.*` keys (raw key shown in the UI), fixed in `95522d3`.
  - flow `replays-detail-quick-edit` → flaky and pre-existing (fails ~40–50% already at the sprint base `7ae6851`): transient Windows EPERM on the atomic-write rename silently dropped the sidecar write. Fixed in product with a bounded rename retry (`95522d3`) rather than quarantined; 12/12 green afterwards.
- Quarantine: `replays-mod-warning` removed (unexpected pass twice); no entries added.
- Unattributed / blockers: none.
