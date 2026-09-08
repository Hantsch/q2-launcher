---
id: 032
title: Downloads icon shows a running-count badge
status: done
created: 2026-08-21
---

## Requirement

Once the Downloads icon exists ([[031]]), it should tell the user at a glance whether any
downloads are currently running and how many, via a small numeric badge on the icon — the same
pattern used for unread/active counts elsewhere (e.g. app taskbar badges), so a user does not
have to open the Downloads screen just to check.

This story was filed as **future work** while the `downloads` module (renamed from `install` in
[[031]]) was still `status: planned` and produced no jobs. [[071]] (this sprint) makes it the
first real producer of `Job` objects through `JobsService`; this story now has a real source of
truth to bind to instead of a placeholder.

## Acceptance Criteria

- [x] **AC1** — The Downloads icon shows a small badge with the current number of *active*
      downloads whenever that number is greater than zero. "Active" is `isJobActive` —
      `queued`, `running` or `paused` (see Decisions: D-paused).
- [x] **AC2** — The badge disappears when no downloads are active.
- [x] **AC3** — The count is driven by real job state from the downloads module, not a
      placeholder or a count of unrelated jobs (jobs of other modules never count; jobs the
      downloads module itself produces — including repair — do, see Decisions: D-scope).
- [x] **AC4** — Badge styling matches existing status/badge conventions (see `Badge` in
      [primitives.tsx](../../src/renderer/src/components/ui/primitives.tsx)) rather than
      introducing a new one-off style.

## Open Questions

- ~~The exact data shape to bind the count to~~ answered → Decisions (Sprint), D-shape.

## Decisions (Sprint)

- **D-shape (the story's open question): the badge binds to the renderer's existing `jobs: Job[]`
  in `useLauncher`, filtered by `moduleId === 'downloads'` + `isJobActive`** — no new IPC channel,
  no new main-side aggregate. Reason: the concept fixes `JobsService` + the `jobs:changed`
  broadcast as unchanged (`docs/concepts/install-module.md` §13) and `Job.moduleId` is the
  attribution field that already exists, so this interface is stable no matter which `kind`
  values [[071]] ends up emitting.
- **D-shape assumption:** the count deliberately does **not** filter on `Job.kind`. Reason:
  `kind` is a module-defined discriminator still in flux in [[071]]/[[073]], while `moduleId`
  is a closed union — filtering on `kind` would make this story break every time the module
  adds a job kind.
- **D-scope: every active `downloads`-module job counts, including repair and engine-update
  jobs.** Reason: the concept has repair and update ride the same job machinery inside the same
  module (§9, §11), which is exactly AC3's "unless the downloads module explicitly folds them
  in"; only *other* modules' jobs are excluded.
- **D-paused: `paused` counts as active, i.e. the shared `isJobActive` predicate is reused
  verbatim.** Reason: a second, competing definition of "active" in the codebase is worse than
  the wording gap, and a paused download is precisely the state whose pointer to the Downloads
  tab the user still needs.
- **D-generic: the count is rendered per utility module (`jobs` of `module.id`), not hardcoded
  for `downloads`.** Reason: keeps [[031]]'s recorded decision that the titlebar stays
  data-driven and no module id is hardcoded into the shell; `downloads` is simply the only
  secondary module today.
- **D-cap: the badge prints the exact count up to 99, then `99+`.** Reason: three digits do not
  fit the 44px icon button, and a bootstrap queue of a dozen packages is realistic.
- **D-a11y: with a count > 0 the button's `aria-label`/`title` becomes a pluralised i18n string
  carrying the count; the badge digits themselves are not a second announcement.** Reason: the
  button already has an `aria-label`, which overrides its content for AT — the count would
  otherwise be invisible to a screen reader.
- **D-fixture: the e2e path seeds jobs with the existing dev-only `dev:simulateJob` channel,
  which already creates `moduleId: 'downloads'` jobs.** Reason: the concept names that channel
  the fixture path for UI verification (§13), and it makes this story's acceptance independent
  of [[071]] landing first.
- **D-no-ipc: `src/shared/ipc.ts` and `ipc-schemas.ts` are not touched.** Reason: the whole
  feature is a derived value over data the renderer already receives — adding a channel would
  be a second source of truth for the same number.

## Plan

Renderer-only, additive. Nothing in main, nothing in the IPC contract.

1. **Shared predicate.** Add `countActiveJobs(jobs: Job[], moduleId: ModuleId): number` next to
   `isJobActive` in `src/shared/types/jobs.ts` (pure, no DOM/node), unit-tested in
   `src/shared/types/jobs.test.ts` — mirror `src/shared/types/engine.test.ts`.
2. **Badge component.** New `src/renderer/src/components/shell/NavJobBadge.tsx`: renders
   `null` for `count <= 0`, otherwise the existing `Badge` (`tone="flame"`, `testId`) absolutely
   positioned in the button's top-right corner with `tabular-nums` and a `min-w`; `99+` above 99.
   No new colours, no new one-off style — token classes only (`/design-tokens`).
   i18n keys for the count-aware accessible name go into
   `src/renderer/src/i18n/locales/en.json` (`nav.activeJobs_one` / `_other`, next to `nav.*`),
   using the `{{count}}` plural precedent already in the file.
3. **Store selector.** `useActiveJobCount(moduleId)` in
   `src/renderer/src/store/useLauncher.ts`, next to `useActiveJob` (~line 396); returns the
   primitive from `countActiveJobs(state.jobs, moduleId)`.
4. **TitleBar wiring.** In `src/renderer/src/components/shell/TitleBar.tsx`: `UtilityButton`
   gets `relative` plus an optional `badge?: number`; the utility-module loop passes
   `useActiveJobCount(module.id)` and swaps `aria-label`/`title` to the count-aware string when
   it is > 0. The Settings button and the window controls are untouched.
5. **Machine-verified acceptance.** New flow `scripts/flows/downloads-badge-count.mjs` (mirror
   `scripts/flows/import-from-files.mjs`) — seed two jobs via `dev:simulateJob`, assert the
   badge reads `2`, cancel both via `jobs:cancel`, assert the badge is gone — plus a
   `downloads-badge` entry in `scripts/lib/screens.mjs` so `npm run ui:verify` screenshots and
   axe-checks the badged state.

Order: 1 → 2 → 3 → 4 → 5. Guardrails: no image assets, no shell module-id hardcoding (D-generic),
no `webPreferences`/CSP/IPC surface change.

## Deliverables

- [x] **D1 — shared active-job count.** `countActiveJobs(jobs, moduleId)` in
  `src/shared/types/jobs.ts`, plus its test in `src/shared/types/jobs.test.ts` (new; mirror
  `src/shared/types/engine.test.ts`). Accepted when the test proves: other modules' jobs are
  excluded, `queued`/`running`/`paused` count, `succeeded`/`failed`/`cancelled` do not.
  *(AC3)*
- [x] **D2 — the badge itself.** New `src/renderer/src/components/shell/NavJobBadge.tsx` +
  `NavJobBadge.test.tsx` (jsdom docblock, `@testing-library/react`; mirror
  `src/renderer/src/components/installations/InstallationTile.test.tsx`), plus the two
  `nav.activeJobs_*` keys in `src/renderer/src/i18n/locales/en.json`. Accepted when the test
  proves: nothing rendered at 0, `3` at 3, `99+` at 120, and the rendered node is the shared
  `Badge` (no bespoke pill markup/colour). *(AC2, AC4)*
- [x] **D3 — wire it to real job state.** `useActiveJobCount` in
  `src/renderer/src/store/useLauncher.ts` and the badge + count-aware `aria-label` in
  `src/renderer/src/components/shell/TitleBar.tsx` (`UtilityButton` gains `relative` and
  `badge`). Accepted when the Downloads button carries `nav-downloads-badge` whenever
  `downloads` jobs are active, driven only by the store's `jobs`. *(AC1, AC3)*
- [x] **D4 — machine-verified through the real app.** New `scripts/flows/downloads-badge-count.mjs`
  (mirror `scripts/flows/import-from-files.mjs`) and a `downloads-badge` screen entry in
  `scripts/lib/screens.mjs`. Accepted when `npm run ui:flow downloads-badge-count` exits 0 and
  `npm run ui:verify` is green (screenshot + axe on the badged titlebar). *(AC1, AC2)*

## Model Hints

- D1 → default. Pure predicate over an existing type.
- D2 → default. One small presentational component plus i18n keys.
- D3 → default. Two additive edits along an existing, well-understood pattern.
- D4 → default. Follows an existing flow script and screen-registry entry verbatim.
- Review: → default. Renderer-only, additive, no IPC/main/CSP surface touched and no existing
  behaviour rewired, so there is no cross-module regression path for a hard reviewer to find.

## Test Plan (manual acceptance)

### Acceptance tests

- AC1 → e2e `scripts/flows/downloads-badge-count.mjs` › "two active downloads badge the
  Downloads button with 2" (run via `npm run ui:flow downloads-badge-count`; the project's
  machine-verified flow harness, same driver as `npm run ui:verify`), backed at unit level by
  `src/renderer/src/components/shell/NavJobBadge.test.tsx` › "renders the count".
- AC2 → e2e `scripts/flows/downloads-badge-count.mjs` › "cancelling every job removes the
  badge", plus unit `src/renderer/src/components/shell/NavJobBadge.test.tsx` › "renders nothing
  at zero".
- AC3 → unit `src/shared/types/jobs.test.ts` › "counts only the given module's active jobs"
  (other-module jobs excluded, finished jobs excluded, paused included).
- AC4 → unit `src/renderer/src/components/shell/NavJobBadge.test.tsx` › "uses the shared Badge
  primitive", plus the axe/screenshot pass on the new `downloads-badge` screen entry in
  `npm run ui:verify`.

No manual residue: every criterion is observable through the real surface or a pure unit.

## Done

Implemented the running-count badge for the Downloads titlebar button entirely in the
renderer: a pure `countActiveJobs(jobs, moduleId)` predicate in shared types, a presentational
`NavJobBadge` built on the existing `Badge` primitive, a `useActiveJobCount` store selector, and
generic wiring into `TitleBar.tsx`'s utility-module loop (no `'downloads'` hardcoding) with a
count-aware, pluralised `aria-label`. No IPC channel, no main-process change.

**Commit message:** `032: downloads icon shows a running-count badge`

**Verification:**
- `npm run build` — green.
- `npm run typecheck` — green (node + web).
- `npm test` — 3029/3030 passed; 1 pre-existing flaky timeout in
  `src/main/modules/config/core/import-reader.test.ts` › "refuses further exec once 512 files
  have been opened" — unrelated to this story's files. Re-ran in isolation
  (`npx vitest run src/main/modules/config/core/import-reader.test.ts -t "refuses further exec
  once"` → 1 passed), confirming a timing flake on this machine, not a regression from this
  change.
- `npm run ui:flow downloads-badge-count` — exit 0, both flow steps passed.
- `npm run ui:verify` — green: 68/68 screenshots, 0 axe violations, includes the new
  `downloads-badge` screen entry (badged titlebar) at both viewport sizes.
- Code review (clean agent, default tier per Model Hints) — overall verdict **PASS**, no
  blocking findings. One non-blocking observation: the exact `count === 99` boundary isn't
  separately unit-tested (only 3 and 120 are), though the `count > 99 ? '99+' : String(count)`
  implementation is correct by inspection — accepted as-is, not worth a fix cycle.

**AC → test mapping, as verified:**
- AC1 → e2e `scripts/flows/downloads-badge-count.mjs` › "two active downloads badge the
  Downloads button with 2" (passed), backed by unit `NavJobBadge.test.tsx` › "renders the
  count" (passed).
- AC2 → e2e `scripts/flows/downloads-badge-count.mjs` › "cancelling every job removes the
  badge" (passed), plus unit `NavJobBadge.test.tsx` › "renders nothing at zero" (passed).
- AC3 → unit `src/shared/types/jobs.test.ts` › "counts only the given module's active jobs"
  (passed — other-module jobs excluded, finished jobs excluded, paused included).
- AC4 → unit `NavJobBadge.test.tsx` › "uses the shared Badge primitive" (passed), plus the
  axe/screenshot pass on `downloads-badge` in `npm run ui:verify` (clean).

No manual residue. No open points or blockers.

**Decisions (implementation-level, not already in the story's Decisions section):**
- `UtilityButton` was split into a small `UtilityModuleButton` wrapper in `TitleBar.tsx` so
  `useActiveJobCount(module.id)` — a hook — is called once per module item rather than inside
  a loop; reviewed and accepted as required plumbing for D-generic, not scope creep.
- The badge's test id is derived generically as `` `nav-${moduleId}-badge` ``, which produces
  `nav-downloads-badge` for the Downloads module without a literal `'downloads'` check
  anywhere in the wiring code.
- The e2e flow (D4) seeds jobs via `dev:simulateJob` with `{ scenario: 'stall' }` (holds a job
  at partial progress indefinitely) and cancels via `jobs:cancel` with the job id looked up
  through `jobs:list`.
