---
id: 009
title: Multi-engine validator
status: in-progress
created: 2026-08-16
---

## Requirement

As a user, I want my profile validated against every engine my assigned installations actually
use, so I catch alias-name-length, loop-depth, buffer-size and per-engine cvar-meaning problems
before they cause a silent failure in-game.

See [docs/concepts/config-module.md §5](../concepts/config-module.md#5-feature-areas-carried-over-from-q2-config-manager-redesigned)
and CFG-10. No primary/portability two-tier severity — every engine reached through an
assignment is an equally-weighted error surface.

## Acceptance Criteria

- [x] The validator runs against every distinct engine reached through the profile's assigned
      installations, each weighted equally.
- [x] Findings cover: alias name length (`MAX_ALIAS_NAME` 32), alias loop depth
      (`ALIAS_LOOP_COUNT` 16), no in-quote escaping, per-engine command-buffer size
      (8192/65536/65536, EFBIG-on-overflow for Q2PRO), and the 1024-byte per-line
      `Cbuf_Execute` limit.
- [x] A profile assigned to no installation, or only to installations outside
      {r1q2, Q2PRO, vanilla}, shows an explicit "nothing to validate against" state — never a
      silent pass or a default to r1q2's numbers.
- [x] Validation results reflect the in-progress edit state, without requiring a save first.

## Open Questions

_None — finding-to-source and all remaining detail questions were decided during refine, see
below._

## Decisions (Sprint)

- **Upstream source is available locally** at `/c/dev/Hantsch/q2-config-manager`
  (`src/core/validator.ts` 534 lines, `src/core/engines.ts` 275 lines); all limits, buffer
  sizes and `source:` citations are copied verbatim rather than re-derived — the same rule
  story 003 used for the cvar catalog, because source-cited data silently rots when re-derived.
- **The validator is pure and lives in `src/shared/config/`**, not in main — it has no node/DOM/
  electron dependency, the renderer imports it directly, and that is what makes AC 4 (validate
  unsaved edits) cheap: no IPC round-trip per keystroke. Precedent: story 003's `cvar-facts.ts`.
- **No new IPC channel and no new module handler.** Validation is a computation over data the
  renderer already holds, so `src/shared/ipc.ts` and `CONFIG_HANDLERS` stay untouched
  (CLAUDE.md: contract-first, and nothing here needs the main process).
- **Findings are computed against the rendered profile text, not against 006/008's internal
  data shapes.** The serializer output is the one stable contract every later story must feed
  into anyway, so line-length, buffer-size and alias checks keep working whatever shape
  006/008 pick. *(Assumption noted: 006 and 008 are still `draft` with empty Plan/Decisions at
  refine time; this decision is deliberately built so it does not depend on their outcome.)*
- **Finding-to-source is derived from the rendered line's own head tokens** — `set <name>` →
  `{kind:'cvar', id:name}`, `bind <key>` → `{kind:'bind', id:key}`, `alias <name>` →
  `{kind:'alias', id:name}`, everything else → `{kind:'file'}`. This answers the story's only
  open point without coupling the validator to any story's model, and it is exactly what the
  user sees on disk.
- **The pure serializer moves to `src/shared/config/render.ts`; `src/main/modules/config/
  render.ts` re-exports it.** Duplicating the serializer in the renderer is how the validated
  bytes and the written bytes drift apart; the move is mechanical (pure string building) and
  pinned by the existing `render.test.ts`.
- **Finding level is `'info' | 'warning' | 'error'`**, reusing `EngineValueNote.level` from
  `cvar-facts.ts` and `CvarRow`'s existing `NOTE_TONE` badge mapping — not the installations'
  `CheckSeverity` (`'ok'|'warn'|'error'`), which is a per-installation status, not a per-item
  level.
- **Upstream's "one level quieter for foreign engines" is dropped.** The concept states the
  no-two-tier rule explicitly: every assigned engine reports its findings at their own natural
  level, and the UI groups per engine rather than merging into one ranked list.
- **Engine limits live in `src/shared/config/engine-limits.ts`, not in
  `src/shared/types/engine.ts`.** The shell's engine table is shell code (CLAUDE.md: a feature
  is a module, never an edit to the shell) and only the three in-scope engines have
  source-cited limits, exactly like the cvar catalog.
- **"Nothing to validate against" reuses story 003's `engine-scope.ts`** (`EngineScopeStatus`
  `'ok'|'unassigned'|'unresolved'|'noFacts'`) instead of a second derivation — AC 3 is
  literally the state machine that file already implements for the Settings tab.
- **The Validation tab is always present, never conditional** on findings existing — a tab
  that disappears when there is nothing to validate is indistinguishable from a silent pass,
  which AC 3 forbids.
- **Draft state is lifted from `SettingsTab` into `ConfigView` via a `useProfileDraft` hook.**
  Today the in-progress cvar map is component-local `useState` inside `SettingsTab`, so nothing
  else can see it; AC 4 requires a draft profile the validator can read.
- **Values stay unvalidated-but-unmodified**: the validator only reports, it never rewrites a
  value — same reasoning as story 003 (silently fixing hides the surprise the feature exists
  to surface).

## Plan

Port q2-config-manager's source-cited engine limits and validation rules into
`src/shared/config/`, run them per assigned engine over the *rendered* profile text, and
surface the result as a new Validation tab that reads the in-progress draft.

1. **Facts + model** — `engine-limits.ts` (buffer sizes, `MAX_ALIAS_NAME`, `ALIAS_LOOP_COUNT`,
   1024-byte line limit, q2pro's comment-stripping size rule) and `validation.ts` (`Finding`,
   `FindingSubject`, `summarize`).
2. **One serializer** — move the pure render functions to `src/shared/config/render.ts`;
   main's `render.ts` becomes a re-export so story 004's write pipeline is untouched.
3. **Structural checks** — `validate-structure.ts`: per rendered file, per line — line length,
   buffer budget (discard vs. truncate vs. EFBIG), alias name length/space/duplicate, alias
   loop depth and cycles, unescaped `"` inside a quoted value.
4. **Cvar checks** — `validate-cvars.ts`: absent / special-value note / out-of-clamp-range /
   value only another engine accepts, all through story 003's `cvar-facts.ts` resolver.
5. **Multi-engine aggregation + UI** — `lib/validation-scope.ts` in the config module runs
   3+4 once per distinct assigned engine via `engine-scope.ts`; `ValidationPanel.tsx` renders
   one equally-weighted section per engine plus the four scope states.
6. **Live draft** — `useProfileDraft` in `ConfigView` holds the unsaved profile; `SettingsTab`
   (and any tab 006/008 added) writes into it, the panel validates it.

Order 1 → 2 → (3, 4) → 5 → 6. Steps 3–5 depend on nothing outside `shared`; step 6 touches
tabs built earlier in this sprint.

## Deliverables

### D1 — Engine limits and finding model (shared, pure) [x]

Port the hard limits verbatim from upstream `src/core/engines.ts`: `maxLineBytes` 1024,
`maxAliasNameLength` 32, `aliasLoopCount` 16, `execBufferBytes` 65534 (r1q2, truncates) /
65535 (q2pro, `overflowDiscardsWholeFile`, `sizeCountsAfterCompression`, EFBIG) / 8190
(vanilla, discards), plus `writtenConfigName`, the `compressedLength` (q2pro `COM_Compress`)
port and `evaluateSize`. Keyed on `EngineKind`, populated only for `r1q2`/`q2pro`/`vanilla`.
Alongside it the finding model: `Finding { id, level, engine, messageKey, params?, fixKey?,
subject, source? }`, `FindingSubject { kind: 'cvar'|'bind'|'alias'|'file'|'profile', id }`,
`summarize()`. Prose stays out — message text is i18n keys, `source:` citations are literal
strings (story 003 precedent).

- Files: `src/shared/config/engine-limits.ts` (new), `src/shared/config/validation.ts` (new),
  `src/shared/config/engine-limits.test.ts` (new).
- Mirror: `src/shared/config/cvar-facts.ts` for the `byEngine`/citation style and
  `hasEngineFacts` gating; upstream `src/core/engines.ts` for the numbers.
- Accept: `npm test` green; tests prove the three buffer sizes, that q2pro measures compressed
  and discards on overflow while r1q2 truncates, and that `limitsFor('yquake2')` yields no
  limits rather than r1q2's numbers.

### D2 — Pure serializer moves to `shared` [x]

Move `renderProfileFile`, `renderLoaderFile`, `profileFileName`, `OWNERSHIP_MARKER`,
`sentinelLine` to `src/shared/config/render.ts` unchanged; `src/main/modules/config/render.ts`
becomes a re-export so `writer.ts`, `index.ts` and `render.test.ts` keep working byte-for-byte.

- Files: `src/shared/config/render.ts` (new), `src/main/modules/config/render.ts`,
  `src/main/modules/config/render.test.ts` (import path only, assertions unchanged).
- Mirror: the existing `render.ts` itself — this is a move, not a rewrite.
- Accept: `npm test` and `npm run build` green with `render.test.ts` assertions untouched;
  no node/electron import enters `src/shared/`.

### D3 — Structural checks (lines, buffer, aliases, quotes) [x] (delegated agent appeared stalled for ~15 min with zero output and no reply to a status ping; orchestrator implemented a stopgap version directly, but the delegated agent then resumed on its own and produced a materially stronger implementation — proper quote-aware tokenizer mirroring `config-parser.ts`, per-rule engine-source citations, strongly-connected-component cycle detection, root-only depth reporting — which was kept in place of the stopgap after independent verification; a bug in its own test helper's byte-count arithmetic was fixed by the orchestrator)

`validateStructure(files, engine)` over the rendered files: per-line length ≥ 1024 →
`error`; total size against `evaluateSize` → `warning` near the limit, `error` over it, with
the engine's own consequence (whole file discarded / truncated / EFBIG); alias name ≥ 32,
alias name containing a space, alias defined twice; alias expansion depth > 16 and alias
cycles; a `"` inside an already-quoted value (no in-quote escaping). Every finding carries the
subject derived from the line's head tokens.

- Files: `src/shared/config/validate-structure.ts` (new),
  `src/shared/config/validate-structure.test.ts` (new),
  `src/renderer/src/i18n/locales/en.json` (`config.validation.*` message keys).
- Mirror: upstream `src/core/validator.ts` (alias + size + quote blocks) for rule content;
  `src/main/modules/config/core/config-parser.ts` for Quake tokenizing semantics.
- Accept: tests cover a 40-char alias name, a 3-deep and a cyclic alias chain, a 1100-byte
  line, a 9 KB file under vanilla vs. r1q2 vs. q2pro, and a message containing `"`. Covers
  the alias/loop/quote/buffer/line half of AC 2.

### D4 — Cvar checks [x]

`validateCvars(cvars, engine)` through story 003's resolver: cvar absent on this engine, value
matching an `EngineValueNote` (reported at the note's own level), numeric value outside the
engine's clamp range (only where no note already explains the value), and a choice value only
other engines accept. Findings carry `{kind:'cvar', id:name}` and the fact's `source:`.

- Files: `src/shared/config/validate-cvars.ts` (new),
  `src/shared/config/validate-cvars.test.ts` (new),
  `src/renderer/src/i18n/locales/en.json`.
- Mirror: upstream `src/core/validator.ts` cvar block; `src/shared/config/cvar-facts.ts`
  (`resolveCvar`, `noteForValue`, `isChoiceAccepted`, `enginesAcceptingChoice`).
- Accept: tests prove `r_maxfps 0` is an error-level finding on r1q2 and produces no finding
  on q2pro, that an out-of-range value reports the clamp, and that an absent cvar is reported
  rather than skipped. Covers the per-engine cvar-meaning half of AC 2.

### D5 — Multi-engine aggregation and the Validation tab [x] (implemented directly by the orchestrator, no nested delegation, after the D3/D4 concurrency incident — see Done)

`validateProfileForEngines(profile, installations)` in the config module's lib: derive the
distinct engines via story 003's `engineScope()`, run D3+D4 once per engine, and return
`{ status, byEngine }` — equally weighted, no merge, no ranking across engines. A
`ValidationPanel` renders one section per engine (engine label + `summarize()` counts + finding
list with level badge, subject label and optional fix), and renders the four scope states
explicitly: `unassigned` / `unresolved` / `noFacts` all show "nothing to validate against"
naming the reason, never r1q2's numbers. A new always-present `validation` tab in `ConfigView`
carries an error/warning count badge.

- Files: `src/renderer/src/modules/config/lib/validation-scope.ts` (new),
  `src/renderer/src/modules/config/lib/validation-scope.test.ts` (new),
  `src/renderer/src/modules/config/ValidationPanel.tsx` (new),
  `src/renderer/src/modules/config/ConfigView.tsx`,
  `src/renderer/src/i18n/locales/en.json`.
- Mirror: `src/renderer/src/modules/config/lib/engine-scope.ts` + `EngineScopeSelect.tsx` for
  the scope states and their wording; `src/renderer/src/components/installations/ChecksList.tsx`
  for the severity-list markup; `PreservedLinesPanel.tsx` for panel/tab plumbing.
- Accept: a profile assigned to an r1q2 and a Q2PRO installation shows two equally-weighted
  sections; an unassigned profile shows the explicit empty state. Covers AC 1 and AC 3.

### D6 — Validation follows the unsaved draft [x] (implemented directly by the orchestrator, no nested delegation)

Lift the in-progress edit state out of `SettingsTab` into a `useProfileDraft(profile)` hook
owned by `ConfigView`, returning `{ draft, patch }`. `SettingsTab` keeps its debounced save but
edits the shared draft; any tab added by 006/008 is adapted the same way. `ValidationPanel`
validates `draft`, so findings update as the user types, before any save.

- Files: `src/renderer/src/modules/config/lib/useProfileDraft.ts` (new),
  `src/renderer/src/modules/config/ConfigView.tsx`,
  `src/renderer/src/modules/config/SettingsTab.tsx`, plus the 006/008 tab(s) if they hold
  their own draft state at build time.
- Mirror: `SettingsTab.tsx`'s existing `localCvars` + 500 ms debounce + `'idle'|'saving'|
  'saved'` status — preserve that behaviour exactly, only move where the state lives.
- Accept: changing a cvar re-runs validation without saving; the existing autosave and its
  status label still behave as before, including on profile switch. Covers AC 4.

## Coverage

| AC | Deliverable |
| --- | --- |
| Runs against every assigned engine, equally weighted | D5 (aggregation), D1 (per-engine limits) |
| Alias name length / loop depth / no in-quote escaping / buffer size / 1024-byte line | D1 (facts) + D3 (structural rules) |
| Per-engine cvar meaning (part of the same AC) | D4 |
| Explicit "nothing to validate against", never a default to r1q2 | D5 (scope states) + D1 (`limitsFor` yields nothing off-scope) |
| Reflects in-progress edit state without saving | D6 |

## Model Hints

- D1 → default (mechanical port; the discipline is "copy verbatim", not judgement).
- D2 → default (a move plus a re-export, pinned by existing assertions).
- D3 → **deliverable-hard** — alias cycle/depth detection and the per-engine size rule
  (q2pro's comment-stripped measurement vs. r1q2's raw truncation) are subtle enough to look
  correct while being wrong, and they run on the exact bytes that get written to disk.
- D4 → default.
- D5 → default.
- D6 → **deliverable-hard** — it rewires draft state through tabs written by stories 006/008
  earlier in this same sprint, so it carries a real regression risk on the existing debounced
  autosave and the profile-switch reseed.
- Review: → **story-review-hard** — the story relocates story 004's write-pipeline serializer
  and rewires other stories' draft state, so the review has to look for silent regressions in
  on-disk output and autosave, not just judge new code.

## Test Plan (manual acceptance)

Run `npm run dev` and drive the real UI.

1. Config → open a profile assigned to one r1q2 installation. Open the new **Validation** tab:
   it names R1Q2 as the engine being checked.
2. Set `r_maxfps` to `0` in the **Settings** tab. Switch back to Validation **without waiting
   for a save**: an error-level finding names `r_maxfps` and explains R1Q2's 5-FPS behaviour.
3. Assign the same profile to a Q2PRO installation. Validation now shows two sections, R1Q2
   and Q2PRO, side by side and equally weighted; the `r_maxfps 0` finding appears only under
   R1Q2.
4. Create an alias/layer (story 006) with a name longer than 31 characters: a finding names
   `MAX_ALIAS_NAME`. Shorten it — the finding disappears without saving first.
5. Build a message (story 008) containing a `"`: a finding explains that Quake 2 has no
   escaping inside quotes.
6. Grow the profile until the rendered file passes 8190 bytes and assign it additionally to a
   vanilla `quake2.exe` installation: the vanilla section reports the file as discarded
   entirely, while R1Q2's section does not.
7. Unassign the profile from every installation: the Validation tab shows an explicit
   "nothing to validate against" state — no findings, no R1Q2 numbers.
8. Assign it only to a Yamagi installation: the tab again says there is nothing to validate
   against, naming the unsupported engine.

## Done

**Summary.** Ported source-cited engine limits and buffer-budget math into
`src/shared/config/engine-limits.ts` (extending story 008's file rather than duplicating it) and
a new `validation.ts` finding model (D1). Moved the pure profile-file serializer and the
switch-bind chain generator from `src/main/modules/config/` to `src/shared/config/`, with
main's copies reduced to `export *` re-exports so `writer.ts`/`index.ts`/existing tests keep
working byte-for-byte (D2). Built the structural checks (alias name/space/duplicate/cycle/depth,
per-line length, per-file size budget, in-quote-escaping) in `validate-structure.ts` (D3) and the
per-engine cvar checks (absent/note/range/choice) in `validate-cvars.ts` (D4), both pure and
tested against hand-built rendered-text fixtures. Aggregated both across every distinct assigned
engine in `validation-scope.ts` and surfaced the result in a new, always-present **Validation**
tab (`ValidationPanel.tsx`) with a tab-badge count (D5). Lifted the in-progress edit state
(cvars, categories, actions) out of `SettingsTab`/`AdvancedTab`'s own `useState` into a shared
`useProfileDraft` hook owned by `ConfigView`, so the validator sees an edit the instant it
happens rather than after a debounced save round-trips (D6).

**Commit message:**
```
009: multi-engine validator - structural + cvar checks, Validation tab, shared draft state
```

**Verification:**
- `npm test` → 384 tests passing (24 files), 0 failing.
- `npm run typecheck` → clean (both `tsconfig.node.json` and `tsconfig.web.json`).
- `npm run build` → succeeds (main/preload/renderer all build).
- Code review (clean agent, `story-review-hard` tier per Model Hints): first pass returned
  **FAIL** with 8 findings (F1–F8, see Decisions below); all 8 were fixed and re-verified by the
  orchestrator directly (re-run test/typecheck/build green after each fix; F1–F4 traced by hand
  against the actual code). A second `story-review-hard` follow-up pass was dispatched to confirm
  the fixes but did not return a verdict in time to include here — per the sprint's explicit
  deviation ("on a real blocker... document honestly and move on" / "do not spawn another nested
  review pass, wrap this story up"), the orchestrator's own hand-verification of each fix (see
  Decisions) is what this Done section relies on instead of that second agent's output.
- `live-smoke-required: true` and this story has a visible UI surface (the Validation tab) — this
  sandbox cannot run Electron's GUI (`npm run dev` has no display/runtime here), so the manual
  `## Test Plan` above has NOT been run against the real app. Status stays `in-progress` per the
  sprint deviation; live acceptance is handed to the user.

**Decisions (implementation):**
- D1/D2 were delegated to fresh agents and completed cleanly on the first pass (engine-limits.ts
  extended in place per the story's own note that story 008 already created it; render.ts/
  switch-bind.ts moved together since `switch-bind.ts` is pure and `render.ts` depends on it —
  moving only one would have made `shared` depend on `main`).
- D3's delegated agent appeared stalled (zero output, no reply to a status ping) for roughly 15
  minutes; the orchestrator implemented a stopgap `validate-structure.ts` directly. The original
  agent then resumed on its own and produced a substantially stronger implementation (a real
  quote-aware tokenizer mirroring `config-parser.ts`, strongly-connected-component cycle
  detection reporting one finding per cycle at its alphabetically-first member, per-rule engine
  source citations, chunk-root-only depth reporting) which replaced the stopgap after the
  orchestrator verified it independently. A bug in that agent's own test helper's byte-count
  arithmetic (`fileOfAtLeast` assumed 61 bytes/line, actual was 58) was fixed by the orchestrator.
- D4 was delegated and completed cleanly, independently verified (10/10 tests at handoff).
- D5 and D6 were implemented directly by the orchestrator (no further nested delegation) after
  the D3 concurrency pattern made continued delegation too risky for the time remaining.
- **Review finding F1 (critical, fixed):** the first `useProfileDraft` only reseeded the shared
  draft on `profile.id` change, so edits from `LayersPanel`, `OverviewKeyboardPanel`'s
  `KeyBindDialog`, `AssignmentsMenu` and `RenameProfileDialog` — none of which call `patch()` —
  never reached the draft, silently going stale (breaking Test Plan steps 3/4/6/7/8). Fixed by
  extracting a pure, now-tested `mergeProfileUpdate(prev, profile)`: on a profile switch the
  fresh profile wins outright; on a same-id external update, every field is taken from the fresh
  profile except `cvars`/`categories`/`actions` (the only fields anything ever calls `patch()`
  for), which stay whatever the draft already had, preserving the original race-avoidance the
  removed per-tab `useState`s relied on.
- **F2 (fixed):** a failed debounced save (`SettingsTab`'s cvars, `AdvancedTab`'s action
  add/remove) left a permanent phantom edit in the draft, since the draft now survives tab
  switches (unlike the removed per-tab state, which self-corrected on remount). Fixed by
  reverting the optimistic patch to `profile.cvars`/`profile.actions` on the failure branch of
  each save.
- **F3 (fixed):** cvar-note findings used generic wrapper prose pointing at a note the
  Validation tab never renders, instead of the note's own specific explanation (breaking Test
  Plan step 2, "explains R1Q2's 5-FPS behaviour"). Fixed by using `note.messageKey` directly as
  the finding's `messageKey`; the now-unused `config.validation.cvar.noteError`/`noteWarning`
  i18n keys were removed.
- **F4 (fixed):** `SettingsTab.handleChange` read `draft.cvars` from the render closure rather
  than a functional updater — a narrower guarantee against two edits landing in one tick than the
  removed `setLocalCvars(prev => ...)` had. Fixed by giving `useProfileDraft`'s `patch` a
  functional-updater overload, mirroring `useState`'s own.
- **F5 (partially addressed):** D6 shipped with zero automated tests, which is how F1 passed a
  green run. `mergeProfileUpdate` (the exact logic F1 was wrong in) is now pure, exported and
  covered by `useProfileDraft.test.ts` (profile switch, null selection, same-id external update
  refreshing unpatched fields, same-id external update preserving patched fields). The hook's own
  `useState`/`useEffect` wiring remains untested — this repo has no React Testing Library in its
  devDependencies, and adding one was judged out of scope for a deliverable fix cycle.
- **F6 (fixed, cosmetic):** the tab badge and `ValidationPanel` each independently ran
  `validateProfileForEngines` on the same draft. `ConfigView` now computes it once and passes the
  result down; `ValidationPanel` takes `result: ProfileValidation` instead of recomputing.
- **F7 (fixed, cosmetic):** `render.ts` had CRLF line endings after the D2 move, unlike every
  sibling file in `src/shared/config/`; normalized to LF.
- **F8 (fixed, cosmetic):** `ConfigView.tsx` repeated `draftOrSelected ?? selected` at three call
  sites; replaced with a named `activeProfile()` helper plus a comment explaining why the
  fallback is required (TypeScript cannot propagate the `selected &&` JSX guard's narrowing back
  to a variable computed before it).
- Not implemented: nothing dropped from the story's Plan/Deliverables — all six deliverables and
  all four acceptance criteria are covered.
