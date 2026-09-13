# Sprint S09 — Review

## Overview

Goal: a profile's `.cfg` states the entire intended configuration rather than only its
deviations — so executing it lands the same game state no matter what `config.cfg`, an
`autoexec.cfg` or another profile set before it — and the "reset to default" idea that no longer
means anything once every setting is always written is gone everywhere. The unsaved-changes state
story 043 introduced becomes legible: the orange row marker means "I edited this", the bar can be
expanded into a before/after of what a Save would write, and edits can be discarded without
touching the file. Plus one surface for the alias name space a real ninety-alias config needs.

| Story | Status | Commit |
| --- | --- | --- |
| 048 — every setting is always written, reset-to-default is gone | done | `048: profile files always write every cvar, reset-to-default affordances removed` |
| 049 — unsaved changes are reviewable and discardable | done | `049: unsaved changes are reviewable and discardable` |
| 044 — one surface to manage every alias in a profile | done | `044: Aliases tab — one surface for the alias name space, backed by one reference graph` |

All three stories in the sprint list are done. No blocked or carried-over stories.

## Implemented stories

**048** — `render.ts` now writes a `set` line for every one of the ~30 catalogue cvars on every
render (the engine-neutral `def.default` when the launcher's own state has nothing recorded, even
for a cvar the currently-scoped engine doesn't support), so a profile's file states the whole
intended configuration rather than only deviations. Read-back strips a value that matches the
catalogue default back out of `profile.cvars` via a new shared `cvar-defaults.ts` helper, so state
never inflates and story 042's round-trip fixed point still holds. All three reset/restore-to-
default affordances — the Settings per-row reset, "Reset all", and Controls' "Restore defaults" —
are gone, along with the now-dead `suggestedKeys` in the action catalogue and
`lib/restore-defaults.ts`. The Settings "changed" filter/counters and the cvar row indicator
switched from "differs from default" to "edited and unsaved", the baseline 049 then builds on.

**049** — A `ProfileBaseline` snapshot (`src/shared/config/profile-baseline.ts`), seeded at every
site `fileHash` already is (save write-back, adopt-from-file, rebuild/migration/import), backs a
pure `diffProfileAgainstBaseline` that measures the live profile against it on cvars' resolved
values (agreeing with what `render.ts` actually writes), binds, actions, layers and per-profile
settings. A `discard` IPC handler restores the baseline without ever touching a file, and a
`ProfileChangesContext` feeds one shared change set to the save bar's new expandable before/after
view plus its Discard button/dialog, and to non-colour-only row markers on Settings, Controls,
Layers and the Raw File tab — replacing 048's interim renderer-local dirty tracking.

**044** — A new Aliases tab lists every alias name that exists in a profile — user-authored,
generated-for-a-keyed-entry, and the launcher's own layer aliases — each labelled with which of
the three it is, backed by one shared reference graph (`buildAliasIndex` in
`alias-references.ts`) that `validate-actions.ts`/Care was refactored onto, so the tab and Care
can never disagree about what references what. Each row shows its body, what references it (or an
explicit "nothing references this"), and its rendered line length against the engine budget
(`aliasLineBudget`, exported from `alias-render.ts`). Create/rename/edit/delete reuse the existing
action editor drawer and a `RenameActionDialog` extracted from Controls; a rename that is still
referenced refuses with the referrer list (039's rule, unchanged); a delete that is still
referenced requires an explicit confirmation naming them. Generated/layer aliases are read-only,
linked back to their owning entry/layer, and hidden by default behind a toggle so the list starts
scoped to what the user actually wrote.

## Findings & decisions

Aggregated from `## Decisions (Sprint)` across the three stories, build feedback and review
findings — input for future sprint planning:

- **Cross-engine default writing (048, user decisions):** an untouched cvar writes the
  engine-neutral `def.default`, not the per-engine `effectiveDefaultFor` — one canonical file
  stays valid across installations running different engines, per story 009's honesty rule. A
  cvar the scoped engine doesn't support is written anyway (a harmless unknown user cvar on that
  engine) rather than making the file's content depend on which engine last rendered it.
- **Where the always-write lives (048, user decision, load-bearing for 049 too):** at render time
  in `render.ts` from `ALL_CVARS`, not materialised into `profile.cvars` on save — this is what
  keeps "the user chose this" and "this is the default" distinguishable in state, which 049's
  `ProfileBaseline`/row indicator/diff all depend on.
- **"Unsaved" semantics (048 → 049, user decisions):** the Settings "changed only" filter and
  counters, and the cvar row indicator, all switched meaning from "differs from the default" to
  "edited and unsaved", measured against a snapshot of the last saved/loaded file — never against
  `profile.cvars`/`state.json`, which story 043 already made not-the-last-saved-state. The
  before/after view is a structured list of changes, not a text diff, so it doesn't drown in
  unchanged default lines now that every cvar is always written. Discard lives on the profile-wide
  bar only (all-or-nothing); a per-row undo was explicitly named out of scope.
- **048 found and fixed a real data-loss regression before landing:** the first cut of toggle-value
  normalization collapsed any non-boolean toggle value (e.g. `gl_shadows: "2"`) to `"0"`, so the new
  read-back's default-stripping logic would have silently deleted real user values; a
  case-insensitive compare also wrongly applied to `kind: 'text'` cvars, which could have mangled a
  player's `name`. Both were caught by `story-review-hard` before the story was marked done, not
  found later.
- **049 found and fixed a rename-survives-discard gap:** discard did not restore a renamed
  profile's `name` — only cvars/binds/actions/layers/settings were in the original
  `ProfileBaseline` field list. Fixed by adding `name` to the baseline, the diff, and discard's
  restore, with a persisted-schema back-fill so a pre-fix `state.json` baseline still loads.
- **049's known, accepted, documented limitations** (none reopened, all judged in-scope trade-offs
  rather than gaps): a category-rename-only edit (no action/cvar change) is silently reverted by
  Discard without appearing in the before/after list, since `ProfileBaseline`'s six sections
  deliberately exclude bare category renames; the preserved-lines/`unrecognized` diff section can
  show a "pending change" for a tidy-up that would produce a byte-identical file; a debounced
  Settings/Controls autosave in flight at the exact moment Discard is confirmed can, in a narrow
  race, re-persist the pre-discard value (flagged `PLAUSIBLE`, not `CONFIRMED`, by the reviewer); a
  numeric-/boolean-spelling-equivalent edit (`3` → `3.0`) marks the profile dirty via `setCvars`
  but the resolved-value diff correctly shows no change, so the bar's badge can show with nothing
  in the before/after list or on any row — the deliberate consequence of diffing resolved values
  the way `render.ts` actually writes them.
- **044's placement and scope (user decisions):** a new fifth tab, not a panel or dialog — Controls
  keeps showing alias rows inside categories (039's placement rationale stands), the tab is the
  comprehensive management view on top of that, not a replacement. Editing reuses the existing
  action editor drawer rather than a new body editor. Generated/layer aliases sit behind a
  default-off toggle so the list starts scoped to the user's own ~90-alias reality, not the whole
  name space.
- **044's story-review-hard pass found and fixed three real gaps**, not just style notes: a
  layer-origin alias's "owner" link was dead (now routes to Overview's `LayersPanel`); a
  single-command alias that individually exceeds the line budget wasn't flagged as over-budget
  (the check only summed total bytes, missed the single-command case); and Care's `undefinedAlias`
  deep link landed on the new tab with no visible feedback about what it was supposed to show (now
  pre-seeds the filter). Left as-is, documented rather than fixed: a layer-origin row can show
  "nothing references this" for its own emitted trigger/chunk aliases — presentation-only, no
  destructive action follows from it, and Care never flags layer-origin names as unreferenced
  either.
- **A real, reproducible test-infrastructure bug was found and fixed mid-sprint, unrelated to any
  story's own acceptance criteria:** on this Windows machine, closing an Electron `ui:verify`
  session leaves its GPU shader-cache directory (`DawnGraphiteCache`/`DawnWebGPUCache`) transiently
  locked with no live process attached — observed durations ranged from under a second up to
  several minutes under load, ruling out any fixed retry budget as a reliable fix. `writePopulatedFixture`/
  `writeEmptyFixture` in `scripts/lib/fixture.mjs` now treat their `userData` cleanup as
  best-effort (`rmDirBestEffort`): retry with a budget, then log a warning and proceed regardless,
  since a fixture reseed only actually needs `state.json`/`window-state.json` refreshed — a stale
  locked cache leftover is harmless. Discovered because two build agents independently lost
  significant time treating this as an unfixable external blocker before the orchestrator
  root-caused it with direct process/timing measurement. **Carry-over note for future sessions on
  this machine:** if `ui:verify` reports `EPERM`/`EBUSY` on `.ui-verify/fixture/*/userdata`, this is
  now self-healing — do not re-diagnose it as an external process before checking `fixture.mjs`'s
  behavior first.
- **A related, purely coincidental test bug was found and fixed at the same time:** `screens.mjs`'s
  `config-conflict-dialog`/`config-save-expanded`/`config-discard-confirm` screens all waited on a
  non-exact `getByText('Unsaved changes')`, which 049's own new toggle-button text ("N unsaved
  changes") and Raw-File notice both match as a case-insensitive substring — a 3-way strict-mode
  violation once a prior screen in the same shared Electron session had already left the profile
  dirty. Fixed by making all three waits exact-match.

## Blocked / open

None. All three stories are done, verified (`npm run build`, `npm run typecheck`, and `npm test` —
1765 tests, with two known-flaky, pre-existing, unrelated failures confirmed absent from every
story's own diff: `src/main/ipc/index.test.ts`'s module-registration-order flake, untouched since
story 036, and `import-reader.test.ts`'s 512-file fan-out timeout) and passed a live
`npm run ui:verify` smoke run as their closing gate (54/54 screenshots written, 0 axe violations
at every impact level, 27/27 screens, including the new `config-aliases` screen).

Per this workflow's own acceptance rules: **"done" here means build/test/typecheck green plus a
passing live UI smoke run — it is not yet a user-performed manual acceptance pass.** See
`testplan.md` for the manual acceptance steps; the milestone's roadmap entry is marked "built,
acceptance pending" until the user runs them.
