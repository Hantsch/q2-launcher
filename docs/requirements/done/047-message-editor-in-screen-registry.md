---
id: 047
title: The message editor is covered by ui:verify like every other surface
status: done # draft -> ready -> in-progress -> done
created: 2026-08-22
---

## Requirement

Story 037 took `npm run ui:verify` to 18/18 screens with zero axe violations and fixed a
form-control labelling defect across the app with a shared `Field`/`useId()` helper. `MessageEditor`
(`src/renderer/src/modules/config/components/MessageEditor.tsx`) was not in the screen registry then
and still is not — so it never got the fix and it never gets a screenshot or an axe pass.
`docs/UI-VERIFICATION.md` names it as a known blind spot.

That matters more than it did before: S07's story 041 grew the message editor (colour cvars used as
`$r`-style text variables are now recognised and rendered there), and S06's story 029 made it the
surface behind the drop-row "With message" checkbox. It is now a real authoring surface that no
automated check has ever looked at.

## Acceptance Criteria

- [x] `MessageEditor` is a screen registry entry, reachable by the harness through the real UI
      (open a message entry from the Controls tab), screenshotted at both viewports and covered by
      the axe report on every full run.
- [x] The full run's axe report stays at zero critical/serious/moderate/minor violations with the new
      screen included — any labelling defect the new coverage exposes is fixed, using the existing
      shared `Field`/`useId()` helper rather than a local workaround.
- [x] The colour-code/`$r` variable rendering story 041 added is visible in the committed screenshot,
      so a regression in it is reviewable from the report alone.
- [x] `docs/UI-VERIFICATION.md` no longer lists `MessageEditor` as a blind spot, and its screen
      count is updated.
- [x] The two other reachable blind spots the same section names — `RemoveInstallationDialog` and
      `DetectDialog` — are either added in the same pass or the doc states, per surface, why they
      stay out. No blind spot stays on the list without a reason.

## Open Questions

_None — all detail decisions are recorded below._

## Decisions (Sprint)

1. **All three named, reachable blind spots are added, none deferred** — `MessageEditor`,
   `RemoveInstallationDialog` and `DetectDialog`; opening the two dialogs is side-effect-free
   (`RemoveInstallationDialog.tsx:24-46` only removes on confirm; `DetectDialog.tsx:45-70` only
   scans on `autoStart` or an explicit Start click), so there is no reason to leave either out.
2. **The `DetectDialog` screen captures the pre-scan state only and never clicks Start** — the
   harness's "never trigger `detection:scan`" guarantee (docs/UI-VERIFICATION.md, Isolation) is
   more valuable than a screenshot of a result list built from the developer's real machine.
3. **`MessageEditor` gets two registry entries, not one** — `ControlsTab.tsx:1237` (message action,
   `showKeyCapture` on) and `ControlsTab.tsx:1269` (drop-row, `showKeyCapture={false}`, `titleName`
   set) render different control sets, so covering only one leaves the other's axe surface unchecked;
   AC 1 names the first, story 029's surface is the second.
4. **The label defect is fixed with `Field`'s existing `htmlFor` prop plus `useId()` in
   `MessageEditor`**, not `useControlId()` — the raw `<input>` (MessageEditor.tsx:265) sits in JSX
   the same component renders, so it cannot read the context `Field` provides; `htmlFor` is the
   shared helper's own escape hatch and no local workaround is needed.
5. **The `populated` fixture gains a `drops` action with a `{ kind: 'message' }` command and a
   `$r`-style colour cvar on "Plain Profile"** — today no seeded action carries a message at all
   (`fixture.mjs:158-166`) and no seeded cvar passes `isColorCvar` (`color-cvars.ts:33`), so without
   this the screenshots would show an empty editor and AC 3 could not be met.
6. **The Detect trigger is the Library header "Auto Detect" button** (`LibraryView.tsx:78`) — it is
   rendered unconditionally, unlike the empty-state button and the rail's menu item, which would
   need an extra open-menu step for the same result.
7. **The doc's screen count is recomputed from `SCREENS`, never carried forward** — it says 17 while
   the array already holds 18 entries, so the truth pass fixes the existing drift too.
8. **Toasts and native-picker-gated surfaces stay on the blind-spot list with their existing
   reasons** — AC 5 concerns only the two named dialogs; both remaining entries already state why
   they are unreachable by construction.
9. **No unit test is added for the registry** — none exists today (nothing under `src/**` or
   `scripts/**` references `SCREENS`), and `npm run ui:verify` is the gate this story is about.
10. **Zero violations is read as zero at every impact level, including `minor`/`moderate`** — AC 2
    is stricter than `ui:verify`'s exit code (which only fails on serious/critical), so acceptance
    reads `a11y.md`'s summary table, not just the exit code.

## Plan

Order matters: renderer hooks first, then fixture data, then registry, then run-and-fix, then doc.

1. **Renderer (production code, small):** in
   `src/renderer/src/modules/config/components/MessageEditor.tsx` fix the broken label pairing
   (`useId()` + `Field htmlFor` + `input id`) and add `data-testid`s the harness can wait on
   (dialog content, channel select, text input, save). In
   `src/renderer/src/views/LibraryView.tsx` add `data-testid` to the installation-rail remove
   `IconButton` (line ~329) and the header "Auto Detect" `Button` (line ~78) — both spread `...rest`
   onto the `<button>` (`components/ui/Button.tsx`), so no component change is needed. If the
   messages-category row's edit trigger in `ControlsTab.tsx` has no testid, add one there too.
2. **Fixture (`scripts/lib/fixture.mjs`):** on "Plain Profile" add (a) a `drops`-category action
   using a real `catalogId` from the drops catalogue, with `commands: [{ kind: 'message', channel:
   'say', text: '... $r ...' }]`, (b) a `kind: 'message'` action for the Team-messages path, and
   (c) a colour cvar (e.g. `r: '\x7f\x88\x88\x7f'`) so `colorCvarTokens` resolves the `$r` token.
   Keep it literal/deterministic — `ui:seed` must stay byte-identical across runs.
3. **Registry (`scripts/lib/screens.mjs`):** four new `populated`/`BOTH_VIEWPORTS` entries —
   `config-controls-message`, `config-controls-drop-message`, `install-remove-dialog`,
   `install-detect-dialog` — each `navigate()` clicking real testids and waiting on the dialog's
   own content (or `getByRole('dialog')`, as `keybind-dialog` does), with no cleanup clicks
   (`resetToBaseState()` owns that). Update the header comment's testid list and entry count.
4. **Run and fix:** full `npm run ui:verify`, then fix every finding the four new screens expose,
   using `Field`/`useControlId` rather than one-off `aria-label`s.
5. **Doc (`docs/UI-VERIFICATION.md`):** recount screens from `SCREENS` (18 → 22), drop the three
   surfaces from "Known blind spots", extend the dialog-entry examples with the message-editor path,
   and state per remaining entry why it stays out.

Affected files: `MessageEditor.tsx`, `LibraryView.tsx`, possibly `ControlsTab.tsx`,
`scripts/lib/fixture.mjs`, `scripts/lib/screens.mjs`, `docs/UI-VERIFICATION.md`.

## Deliverables

**D1 — Harness hooks and the label fix in the renderer.** [x]
Files: `src/renderer/src/modules/config/components/MessageEditor.tsx`,
`src/renderer/src/views/LibraryView.tsx`, `src/renderer/src/modules/config/ControlsTab.tsx`
(only if the messages-row edit trigger lacks a testid). Mirror: `Input`/`Select` adopting
`useControlId` in `src/renderer/src/components/ui/controls.tsx:69-130`, and the existing
`drop-message-edit-<catalogId>` testid at `ControlsTab.tsx:701`.
Acceptance: the message text `<input>` is programmatically associated with its `Field` label
(`useId()` + `htmlFor` + `id`); the editor exposes stable testids for its content container,
channel select, text input and Save; the remove and "Auto Detect" buttons in `LibraryView` carry
testids; `npm run build`, `npm test`, `npm run typecheck` green.

**D2 — Fixture data so the editor has something to show.** [x]
Files: `scripts/lib/fixture.mjs`. Mirror: the existing `FIXTURE_CONFIG_CFG` /
`populatedConfigProfiles()` style at `fixture.mjs:135-229`.
Acceptance: "Plain Profile" has one `drops` action with a `{ kind: 'message' }` command whose text
references `$r`, one `kind: 'message'` action for the Team-messages path, and a cvar whose value
passes `isColorCvar` (`src/shared/config/color-cvars.ts:33`); `npm run ui:seed` twice produces
byte-identical fixtures; the existing `config-controls` / `config-settings` screens still render
(the new cvar appears as a normal row, no crash, no console error).

**D3 — Four registry entries.** [x]
Files: `scripts/lib/screens.mjs`. Mirror: `config-import-review` (waits on a testid inside the
dialog) and `keybind-dialog` (waits on `getByRole('dialog')`), `screens.mjs:248-290`.
Acceptance: `npm run ui:verify -- --screens=config-controls-message,config-controls-drop-message,install-remove-dialog,install-detect-dialog`
writes 8 PNGs (4 screens x 2 viewports) with no `unreachable`/`error` entry in `run.json`; the
message-editor shots visibly show the preview's `$r` colour-cvar badge; the detect shot shows the
pre-scan state (no scan was run); the header comment's testid list and entry count are updated.

**D4 — Full green run.** [x]
Files: whatever D3's report names (renderer components only; use `Field`/`useControlId`).
Acceptance: a full `npm run ui:verify` exits `0`, `run.json` has 22 screens all `written`, and
`a11y.md`'s summary table shows 0 critical, 0 serious, 0 moderate, 0 minor. Paste the summary lines
into `## Done`.

**D5 — `docs/UI-VERIFICATION.md` truth pass.** [x]
Files: `docs/UI-VERIFICATION.md`. Mirror: story 037's D7 pass on the same file.
Acceptance: every screen count in the doc matches `SCREENS` (22, including the stale "17" in the
per-variant-session and cold-start sections); the launch-count and partial-run example lines still
match reality; `MessageEditor`, `RemoveInstallationDialog` and `DetectDialog` are gone from "Known
blind spots"; the two remaining entries each state why they stay out; the dialog-entry section
documents the message-editor navigate path (including that the detect screen deliberately stops
before Start).

**AC coverage:** AC 1 → D1+D2+D3 · AC 2 → D4 · AC 3 → D2+D3 · AC 4 → D5 · AC 5 → D3+D5.

## Model Hints

D1 → default
D2 → default
D3 → default
D4 → default
D5 → default
Review: → default — harness scripts, fixture data, one doc and a two-line labelling fix; no IPC,
no write pipeline, no cross-module logic, and `ui:verify` itself is the objective check.

## Test Plan (manual acceptance)

1. `npm run ui:verify` — expect exit code `0`, `screens: 22`, `launches: 2`, and `a11y.md` with
   zero violations at every impact.
2. Open `.ui-verify/screenshots/config-controls-message@1280x800.png` and
   `config-controls-drop-message@1280x800.png` — the message editor is open, the text field is
   labelled, and the preview shows the `$r` colour-cvar badge (story 041's rendering).
3. Open `install-remove-dialog@1280x800.png` and `install-detect-dialog@1280x800.png` — the remove
   confirmation is visible; the detect dialog shows its pre-scan state with the Start button, not a
   candidate list.
4. Real-UI check by hand (`npm run dev`): Config → Plain Profile → Controls → a drops row → tick
   "With message" → "Edit message" → the editor opens, clicking its text label focuses the input,
   the preview shows the `$r` badge, Save persists. Then Library → installation rail → remove →
   Cancel, and Library → "Auto Detect" → the dialog opens without starting a scan → Close.

## Done

**Summary:** `MessageEditor` gained stable testids and a fixed label/`useId()`/`Field htmlFor`
association (D1); "Plain Profile" fixture data now carries a `drops` message action, a Team-messages
action, and a `$r`-resolving colour cvar so the editor has real content to show (D2); four new
`populated`/`BOTH_VIEWPORTS` screen registry entries cover the message editor from both its
invocation paths plus the `RemoveInstallationDialog` and pre-scan `DetectDialog` (D3); a full
`npm run ui:verify` run came back green on the first try with no further fixes needed (D4);
`docs/UI-VERIFICATION.md` had its screen counts corrected to 22 throughout (including pre-existing
drift from before this story) and its "Known blind spots" section pruned to the two surfaces that
still have a reason to stay out (D5).

**Commit message:** `047: message editor, remove/detect dialogs join the screen registry`

**Verification:**
- `npm run build` / `npm test` (1323 tests, 64 files) / `npm run typecheck` — all green throughout.
- Live smoke (`npm run ui:verify`, full run): exit `0`, `22/22` screens written (`44` shots across
  both viewports), `0 unreachable`/`0 error`, `a11y.md` summary: `0 critical, 0 serious,
  0 moderate, 0 minor` — at every impact level, per Decision 10's stricter-than-default read.
- Clean-agent review: verdict **PASS**. All 5 acceptance criteria independently verified
  (re-ran the scoped and full `ui:verify` passes) as PASS with file:line evidence. No weakened
  tests, no scope creep, no CLAUDE.md guardrail violations. Two non-blocking notes: the story's own
  `## Done`/status trail was still open at review time (fixed by this pass) and Decision 3's cited
  `ControlsTab.tsx` line numbers (1237/1269) drifted by a couple of lines once D1 inserted testids
  earlier in the file (cosmetic only — the referenced logic is unchanged and correct).

**Decisions made during the build (not already in the story):**
- The Team-messages `MessageEditor` trigger's testid is `action-edit-<actionId>`
  (`ControlsTab.tsx`), distinct from the pre-existing drop-row testid
  `drop-message-edit-<catalogId>` — needed so the two new screen entries can each target their own
  invocation path per Decision 3.
- Fixture drop action uses `catalogId: 'dropWeapon:railgun'` with commands
  `[{ kind: 'raw', text: 'drop railgun' }, { kind: 'message', channel: 'say', text: 'Dropped
  railgun $r' }]`; the Team-messages fixture action uses `channel: 'say_team'` — both literal and
  deterministic, confirmed byte-identical across two `npm run ui:seed` runs.
- `install-remove-dialog` and `install-detect-dialog` wait on `getByRole('dialog')` (mirroring
  `keybind-dialog`); the two `MessageEditor` screens wait on the `message-editor-content` testid
  (mirroring `config-import-review`'s pattern of waiting on a testid inside the dialog).
- The Controls-tab category rail defaults to `movement`; both new Controls-tab screen entries click
  the target category chip (by translated accessible name, matching existing navigation patterns in
  the file) before clicking the row's edit trigger, since the fixture's new actions live under
  `weapons`/`drops`.
