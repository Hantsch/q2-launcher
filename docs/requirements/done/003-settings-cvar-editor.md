---
id: 003
title: Settings/cvar editor with per-engine defaults and clamps
status: done
created: 2026-08-14
---

## Requirement

As a user, I want to edit player and graphics cvars for a profile, seeing each engine's
default, clamp range and any special-value warning, so I don't have to guess safe values per
engine or discover surprises like `r_maxfps 0` meaning "5 FPS" on R1Q2 the hard way.

Engine facts (defaults, clamps, per-engine meaning of the same value) are carried over from
q2-config-manager's `src/core/settings.ts` (source-cited against r1q2/Q2PRO/vanilla source —
see [docs/concepts/config-module.md](../concepts/config-module.md#5-feature-areas-carried-over-from-q2-config-manager-redesigned)).
Cvar values are stored on the profile (story 001); which engines apply comes from the
installations the profile is assigned to (story 002). Writing the result to disk is story 004.

## Acceptance Criteria

- [x] Each cvar control shows the current value alongside the engine's default and the range
      that engine clamps to.
- [x] A value the engine treats specially (e.g. `r_maxfps 0`) is flagged with an explanation of
      what actually happens.
- [x] A cvar the engine doesn't support is named/shown rather than silently omitted.
- [x] When a profile is assigned to installations with different engines, the view makes clear
      which engine's defaults/clamps/warnings are being shown for each cvar.
- [x] Cvar edits are saved on the profile and survive an app restart.

## Open Questions

_None — all detail questions were decided during refine, see below._

## Decisions (Sprint)

- **Upstream source is available locally** at `/mnt/c/dev/Hantsch/q2-config-manager`
  (`src/core/settings.ts`, `src/core/engines.ts`) — the port copies its numbers and `source:`
  citations verbatim instead of re-deriving engine facts, because re-deriving is exactly how
  source-cited data silently rots.
- **Fact catalog lives in `src/shared/config/`, not in the main process.** It is pure data with
  no node/DOM/electron dependency, so the renderer imports it directly — no IPC round-trip and
  no prose crossing IPC, which is what CLAUDE.md forbids.
- **Catalog carries i18n keys, not prose** (`labelKey`, `descriptionKey`, `noteKey`,
  `warningKey`, per-value-note `messageKey`); the English text moves into `en.json` under a new
  top-level `config` block, because user-visible strings must be translatable.
- **`source:` citations stay literal, untranslated strings** (e.g. `r1q2 client/cl_main.c`) —
  they are provenance for developers, same precedent as `EngineDefinition.label`
  ("Not translated - these are product names").
- **Engine identity is the launcher's `EngineKind`, not a second enum.** The catalog keys
  `byEngine` on `EngineKind` and only ever fills `r1q2` / `q2pro` / `vanilla`; every other kind
  resolves to "no engine facts available" — the concept explicitly declares the other engines
  out of scope with no source-cited facts.
- **No new IPC channel.** Module traffic rides the existing `module:invoke` envelope
  (`ARCHITECTURE.md#adding-a-module`), so `src/shared/ipc.ts` is untouched.
- **Applicable engines are derived in the renderer** from the already-mirrored installations
  state (`assignedProfiles` from story 002), not through a second main-process handler —
  duplicating 002's assignment logic in a second place is how the two drift apart.
- **Engine scope is an explicit selector, not a merged "worst case" view.** A single selected
  engine per view keeps every number on screen unambiguous (AC 4), with a per-cvar badge when
  another assigned engine disagrees — a merged view would have to invent a resolution rule
  that no engine actually implements.
- **Unsupported cvars are shown disabled with an "not on this engine" badge**, never filtered
  out — AC 3 and CFG-9 both require naming them.
- **No new shared UI primitive.** `controls.tsx` has no numeric/slider control; the module
  builds its own row-level number/range control from existing tokens, because CLAUDE.md says a
  feature is a module and never an edit to the shell.
- **`Profile.cvars` is `Record<string, string>`** (cvar name → raw value as the engine sees it),
  defaulted to `{}` by a forgiving `.catch` in the persisted schema — no `STATE_SCHEMA_VERSION`
  bump is needed for an additive optional field, and raw strings are what story 004 writes and
  story 005 imports.
- **Values are stored unclamped, exactly as typed;** clamping is presented as information, not
  enforced — the engine clamps at load time and silently rewriting the user's value would hide
  precisely the surprise this story exists to surface.
- **Tests are colocated `.ts` files** next to the pure logic (`vitest.config.ts` includes only
  `src/**/*.{test,spec}.ts`, node env) — component tests are not runnable in this setup, so the
  resolver carries the test weight and the UI is covered by the manual test plan.

## Plan

Port q2-config-manager's source-cited cvar facts into `src/shared/`, hang a `cvars` map on the
profile from story 001, and build the Settings tab of the config view on top of both.

1. **Facts** — new `src/shared/config/`:
   - `cvar-facts.ts` — types (`CvarKind`, `CvarChoice`, `EngineValueNote`, `EngineOverride`,
     `CvarDef`, `ResolvedCvar`) + resolver (`resolveCvar`, `isCvarSupported`, `noteForValue`,
     `foreignNotesForValue`, `hasEngineFacts`), ported from upstream `settings.ts` lines
     713–800, keyed on `EngineKind`.
   - `cvar-catalog.ts` — `PLAYER_CVARS` / `GRAPHICS_CVARS` / `ALL_CVARS` / `findCvar`, values,
     ranges, `byEngine` blocks and `source:` citations copied verbatim from upstream.
   - `cvar-facts.test.ts` — resolver behaviour + spot-checks of load-bearing facts.
2. **Profile state** — extend `src/shared/modules/config.ts` (story 001's contract) with
   `cvars` on `Profile` and a `setCvars` handler; implement it in
   `src/main/modules/config/index.ts` against the profile store; add `updateProfileCvars()` to
   `src/renderer/src/modules/config/client.ts`; forgiving schema default in
   `src/main/lib/schemas.ts`.
3. **Row control** — `src/renderer/src/modules/config/components/CvarRow.tsx`: current value,
   engine default, clamp range, special-value note, unsupported state, reset-to-default.
4. **Settings tab** — `src/renderer/src/modules/config/SettingsTab.tsx`, mounted in the config
   view from story 001; player/graphics groups, debounced save through the client.
5. **Engine scope** — `EngineScopeSelect.tsx`: distinct engines of the profile's assigned
   installations, "no facts for this engine" and "not assigned anywhere" states, plus the
   cross-engine disagreement badge on each row.

Order is 1 → 2 → (3, 4) → 5. Steps 3–5 depend on story 001's config view existing and step 5
on story 002's `assignedProfiles`; both are built earlier in this sprint.

## Deliverables

### D1 — Cvar fact catalog and resolver (shared, pure)

Port the source-cited engine facts. **Copy numbers, ranges and `source:` strings verbatim from
`/mnt/c/dev/Hantsch/q2-config-manager/src/core/settings.ts`** — do not re-derive or "improve"
any value. Replace every prose field (`label`, `description`, `note`, `warning`, value-note
`meaning`, choice `label`) with an i18n key field (`labelKey`, …) and move the English text into
`en.json`. `byEngine` is keyed on the launcher's `EngineKind`; `hasEngineFacts(kind)` is true
only for `r1q2` / `q2pro` / `vanilla`.

- Files: `src/shared/config/cvar-facts.ts` (new), `src/shared/config/cvar-catalog.ts` (new),
  `src/shared/config/cvar-facts.test.ts` (new),
  `src/renderer/src/i18n/locales/en.json` (new top-level `config.cvar.*` block).
- Mirror: upstream `src/core/settings.ts` for data; `src/shared/types/engine.ts` for the
  data-table-with-citations style; `src/main/services/launch-plan.test.ts` for the test shape.
- Accept: `npm test` green; the resolver test proves `r_maxfps 0` yields an `error`/`warning`
  note on `r1q2` and not on `q2pro`, that an `absent` cvar reports unsupported, that per-engine
  min/max narrow the def's range, and that `hasEngineFacts('yquake2') === false`. No prose
  string remains in the catalog except `source:` citations.

### D2 — `cvars` on the profile, persisted end to end

Add `cvars: Record<string, string>` to the `Profile` shape in story 001's contract, a `setCvars`
handler (`{ profileId, cvars }`) on the config `MainModule` writing through the profile store,
and the typed client function. Persisted schema defaults `cvars` to `{}` via `.catch` — no
`STATE_SCHEMA_VERSION` bump.

- Files: `src/shared/modules/config.ts`, `src/main/modules/config/index.ts`,
  `src/renderer/src/modules/config/client.ts`, `src/main/lib/schemas.ts`.
- Mirror: `src/shared/modules/library.ts` + `src/main/modules/library/index.ts` +
  `src/renderer/src/modules/library/client.ts` for the seam; `schemas.ts`'s persisted half
  (forgiving `.catch`) vs. its strict IPC half for the payload schema.
- Accept: `npm run build` and `npm test` green; setting cvars via the client and restarting the
  app returns the same map; an unknown/garbage payload is rejected by the payload schema rather
  than reaching the store.

### D3 — `CvarRow` control

One row per cvar: label + description, the editing control for its `kind`
(`text`/`number`/`slider`/`toggle`/`choice`), and — for the selected engine — the engine default,
the clamp range, a `Badge` with the special-value note when the current value matches one, and
the disabled + "not on this engine" state. A reset-to-default action restores the engine default.
Number/range controls are built locally from existing tokens; `controls.tsx` is not touched.

- Files: `src/renderer/src/modules/config/components/CvarRow.tsx` (new),
  `src/renderer/src/i18n/locales/en.json`.
- Mirror: `src/renderer/src/components/ui/controls.tsx` (`Field`, `Input`, `Select`, `Switch`)
  and `primitives.tsx` (`Panel`, `SectionLabel`, `Badge`) for markup/tone conventions;
  `LibraryView.tsx` for spacing and type scale.
- Accept: with a fact-carrying engine selected, a row shows value, default and range; a value
  with a note shows the note text; an `absent` cvar renders named and disabled. Covers AC 1,
  AC 2, AC 3.

### D4 — Settings tab in the config view

Group `PLAYER_CVARS` / `GRAPHICS_CVARS` into two `Panel` sections of `CvarRow`s inside the
config module view from story 001, bound to the selected profile's `cvars`. Edits update local
state immediately and persist through D2's client (debounced), with a "saved" indication.

- Files: `src/renderer/src/modules/config/SettingsTab.tsx` (new), the config view from story
  001 (`src/renderer/src/views/ConfigView.tsx`), `src/renderer/src/i18n/locales/en.json`.
- Mirror: `src/renderer/src/views/LibraryView.tsx` for page layout and the
  `useEffect` + typed-client data flow.
- Accept: editing a cvar in the UI and restarting the app shows the edited value. Covers AC 5.

### D5 — Engine scope and cross-engine disagreement

Derive the distinct `EngineKind`s of the installations the selected profile is assigned to
(story 002's `assignedProfiles`). Render a scope selector naming the engine whose facts are on
screen, defaulting to `r1q2` when assigned, otherwise the first assigned engine with facts.
Handle both empty cases explicitly: profile assigned nowhere, and assigned only to engines
outside the supported three ("no engine facts for X"). Each row gains a badge when another
assigned engine disagrees about that cvar (`foreignNotesForValue` / differing default or range),
naming the other engine.

- Files: `src/renderer/src/modules/config/components/EngineScopeSelect.tsx` (new),
  `src/renderer/src/modules/config/SettingsTab.tsx`,
  `src/renderer/src/modules/config/components/CvarRow.tsx`,
  `src/renderer/src/i18n/locales/en.json`.
- Mirror: `src/shared/types/engine.ts` `engineLabel()` for engine naming; existing `useLauncher`
  selectors for reading installations.
- Accept: a profile assigned to an r1q2 and a Q2PRO installation offers both, and switching the
  selector visibly changes defaults/ranges/notes; `r_maxfps 0` is flagged under r1q2 and carries
  a "differs on Q2PRO" badge. Covers AC 4.

## Coverage

| AC | Deliverable |
| --- | --- |
| Value + engine default + clamp range | D1 (facts) + D3 (row) |
| Special-value warning | D1 (`valueNotes`) + D3 (badge) |
| Unsupported cvar named, not hidden | D1 (`absent`) + D3 (disabled row) |
| Multi-engine clarity | D5 |
| Edits saved on the profile, survive restart | D2 + D4 |

## Model Hints

- D1 → default (mechanical port; the discipline is "copy verbatim", not judgement).
- D2 → default.
- D3 → default.
- D4 → default.
- D5 → **deliverable-hard** — it is the only deliverable that joins three moving parts (story
  002's assignment shape, the launcher's ten-value `EngineKind` against three fact-carrying
  engines, and the cross-engine comparison), and the two empty/unsupported-engine paths are
  easy to render as a plausible-looking but wrong "r1q2" default.
- Review: → default — the story is new code with no regression surface, and the one real risk
  (fact fidelity) is pinned by D1's tests.

## Test Plan (manual acceptance)

Run `npm run dev` and drive the real UI.

1. Config → create a profile (story 001), assign it to an r1q2 installation (story 002).
2. Open the profile's **Settings** tab. Check a slider cvar (e.g. `fov`): the row shows the
   current value, the R1Q2 default and R1Q2's clamp range.
3. Set `r_maxfps` to `0`. A warning appears explaining that R1Q2 treats this as 5 FPS.
4. Scroll to a cvar R1Q2 doesn't have: it is listed by name, disabled, and marked as not
   available on this engine.
5. Assign the same profile to a Q2PRO installation as well. The engine scope selector now
   offers R1Q2 and Q2PRO; switch to Q2PRO and confirm `r_maxfps 0` no longer warns and that
   defaults/ranges change where the engines differ.
6. Assign it additionally to an out-of-scope engine (e.g. Yamagi) — that engine is either
   absent from the selector or shown with an explicit "no engine facts" message, never with
   R1Q2's numbers.
7. Change two cvars, close the launcher, reopen it: both values are still there.

## Done

**Summary.** Ported the source-cited r1q2/Q2PRO/vanilla cvar fact catalog (30 cvars, defaults,
clamp ranges, special-value notes, `source:` citations) into `src/shared/config/`, added a
`setCvars` write path for the profile's `cvars` map (D2), built a `CvarRow` control (D3), a
`SettingsTab` that groups the catalog into Player/Graphics panels with debounced autosave (D4),
and an `EngineScopeSelect` that derives the profile's assigned engines from story 002's
assignment data and drives per-row cross-engine disagreement badges (D5). All 5 acceptance
criteria are met per an independent code review (see below); build/tests are green.

**Decisions:**
- **q2-config-manager source was available and used.** `/mnt/c/dev/Hantsch/q2-config-manager`
  existed in the sandbox; `src/core/settings.ts` (830 lines: `PLAYER_SETTINGS`/`GRAPHICS_SETTINGS`,
  the resolver section) and `src/core/engines.ts` were read and ported. All numbers, ranges and
  `source:` citations were copied verbatim, not re-derived — no deviation to best-available
  knowledge was needed.
- Upstream's `EngineId` (`'r1q2' | 'q2pro' | 'vanilla'`) was **not** introduced as a second enum;
  the catalog's `byEngine` maps key on the launcher's own ten-value `EngineKind`
  (`src/shared/types/engine.ts`) and only ever populate `r1q2`/`q2pro`/`vanilla`, per the story's
  decision log. `hasEngineFacts(kind)` is the single source of truth for "does this engine have
  facts" — every UI path (`EngineScopeSelect`, `CvarRow`) filters through it rather than assuming.
- Upstream's prose fields (`label`, `description`, `warning`, `note`, value-note `meaning`, choice
  `label`) were replaced with i18n key fields (`labelKey`, `descriptionKey`, `warningKey`,
  `noteKey`, `messageKey`) and the English text moved into a new `config.cvar.*` block in
  `en.json` (~295 new lines total across D1/D3/D4/D5). `source:` citations were kept as literal,
  untranslated strings (not rendered in the UI, kept as developer-facing data), per the story's
  explicit decision and the `EngineDefinition.label` precedent.
- `ProfilesStore.setCvars()` **replaces** the whole `cvars` map rather than merging, matching
  `SettingsTab`'s save call (it always sends the full locally-merged map). No
  `STATE_SCHEMA_VERSION` bump — `cvars` already existed and was already defaulted via `.catch`
  since story 001. No new IPC channel — rides the existing `module:invoke` envelope;
  `src/shared/ipc.ts` is untouched (confirmed by review).
- D5's two empty-state paths (profile unassigned; profile assigned only to installations outside
  `{r1q2, q2pro, vanilla}`) both resolve `EngineKind | null` to `null`, never falling through to a
  hardcoded `'r1q2'` default — traced explicitly by the review agent through `engine-scope.ts`,
  `EngineScopeSelect.tsx`, `SettingsTab.tsx` and `CvarRow.tsx`. `CvarRow` still renders every cvar
  (never hides one) in the no-facts case, labelling the shown value as the catalog's own
  "recommended default" rather than an engine default.
- The story's D5 text describes the cross-engine badge as driven by "`foreignNotesForValue` /
  differing default or range" — for the story's own headline case (`r_maxfps 0` under r1q2 vs.
  q2pro), `foreignNotesForValue` alone returns nothing (q2pro's note for `0` is `info`-level, by
  design excluded). A new pure helper, `engineDisagreement()` in `cvar-facts.ts` (additive only,
  no existing export's signature/behaviour changed), was added to also compare structural
  default/range/value-meaning differences, which is what actually carries the r1q2/q2pro badge in
  both directions. Covered by 6 new tests in `cvar-facts.test.ts`.
- Component tests are not written (`.test.tsx` files aren't runnable in this repo's vitest setup —
  node env only, no DOM/RTL — per the story's own decision); UI behaviour is covered by the
  `## Test Plan (manual acceptance)` section below, not yet executed (see Verification).

**Files changed:**
- New: `src/shared/config/cvar-facts.ts`, `src/shared/config/cvar-catalog.ts`,
  `src/shared/config/cvar-facts.test.ts`, `src/renderer/src/modules/config/SettingsTab.tsx`,
  `src/renderer/src/modules/config/components/CvarRow.tsx`,
  `src/renderer/src/modules/config/components/EngineScopeSelect.tsx`,
  `src/renderer/src/modules/config/lib/engine-scope.ts`.
- Edited: `src/shared/modules/config.ts`, `src/main/modules/config/schemas.ts`,
  `src/main/modules/config/profiles.ts`, `src/main/modules/config/index.ts`,
  `src/renderer/src/modules/config/client.ts`, `src/renderer/src/modules/config/ConfigView.tsx`,
  `src/renderer/src/i18n/locales/en.json`.

**Verification:**
- `npm run build` — green (main/preload/renderer all build).
- `npm test` — green, 54/54 tests passed (48 pre-existing + D1's 7 resolver tests folded to net 7,
  plus D5's 6 new `engineDisagreement` tests; exact count 54 across 4 test files).
- `npm run typecheck` (both `tsconfig.node.json` and `tsconfig.web.json`) — clean, run explicitly
  since `electron-vite build` alone doesn't fully typecheck.
- Code review (clean fresh agent, default tier per Model Hints): **PASS**. All 5 acceptance
  criteria individually verdicted PASS with file:line evidence, including an explicit trace of
  both D5 empty-state paths confirming neither falls through to a hardcoded r1q2 default. No
  weakened tests, no scope creep, `src/shared/ipc.ts` and `src/main/lib/schemas.ts` confirmed
  untouched. One non-blocking finding, deliberately left unfixed: if a cvar save is in-flight when
  the user switches profiles mid-debounce, the async response can flash a stale "Saved"/"Saving"
  status label onto the now-different profile for a moment — cosmetic only, no wrong id/cvars
  pairing and no data corruption (the debounce timer itself is correctly cancelled/rescoped per
  profile). Not fixed because it doesn't affect AC5 (persistence is still correct) and fixing it
  cleanly would need an in-flight-request cancellation token, which felt like scope creep for a
  one-frame visual glitch; worth a follow-up if it's noticed in manual testing.
- **Live smoke NOT run.** This sandbox is headless (no Electron display under WSL) — `npm run
  dev` cannot be driven through the real UI here. Built, acceptance pending: the manual test plan
  below is ready to execute but not yet performed. Per project policy (P2), status stays
  `in-progress` rather than `done` until that happens.

**Open points:** none blocking. The cosmetic debounce-switch status flash noted above is the only
known non-blocking issue.

**Live acceptance (2026-08-16):** the 7-step manual test plan was run against a real desktop
environment and accepted by the user. Status moved to `done`.
