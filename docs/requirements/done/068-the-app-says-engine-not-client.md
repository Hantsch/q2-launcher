---
id: 068
title: the app says engine, not client
status: done
created: 2026-09-07
---

## Requirement

The launcher calls the same thing two different names. Internally everything is an *engine*
(`EngineKind`, `engineKind`, the engine badge from story 065), but several user-visible labels
still say "Client" — the Create-installation dialog's dropdown, the library's detail row, the
detection error messages. As a user I read one word for one concept: **engine**. "Client" as a
term for the executable stays where it genuinely means the binary ("Client executable" → engine
executable), but it never names the engine itself.

On top of that, only two engines are actually supported for now: **R1Q2** and **Q2PRO**. Everything
else the detector knows (yquake2, KMQuake II, vkQuake2, Q2RTX, remaster, vanilla) should keep being
*recognised* — an existing installation must not lose its label — but I should not be able to pick
an unsupported engine when I create a new installation, and an installation running one should say
so instead of pretending it is fully supported.

## Acceptance Criteria

- [x] **AC1** — No user-visible string in `src/renderer/src/i18n/locales/en.json` uses "client"/
      "Client" as a name for the engine. Where the word means the executable it reads as engine
      executable instead.
- [x] **AC2** — The Create-installation dialog's engine dropdown offers exactly R1Q2 and Q2PRO;
      the label above it reads "Engine".
- [x] **AC3** — Detection still classifies all engines in `ENGINE_DEFINITIONS`: an installation on
      an unsupported engine keeps its own badge label and is not degraded to `unknown`.
- [x] **AC4** — An installation whose engine is outside the supported set is marked as unsupported
      where its engine is shown, in text (not by colour alone).
- [x] **AC5** — Which engines are supported is data on `EngineDefinition`, not a hard-coded list in
      the dialog — adding a third supported engine is a one-line change in `src/shared/types/engine.ts`.

## Open Questions

None — everything below was decided in refine against the ACs, story 065, the roadmap's
"Identity, icons and the first profile" milestone and CLAUDE.md.

## Decisions (Sprint)

- **AC1 is enforced zero-tolerance, not by allowlist**: the test asserts that *no* string value in
  `en.json` contains `client` (case-insensitive), because an allowlist of "technically means the
  client half of client/server" strings is a debate this story does not need. Three cvar-help
  strings are therefore reworded too: `freelook`'s vanilla note ("unconfigured 3.20 client" →
  "engine"), `hand`'s warning ("not by the client" → "not by the engine" — the sentence already
  said "engine" for the same thing two clauses later), and `cl_maxfps`'s description ("Caps the
  client tick" → "Caps the local tick (packets and physics)").
- **Only `en.json` values are in scope**: i18n *key* names and code identifiers are not user
  visible, so `config.controls.messageEditor.macroBar.clientLabel` (its value says nothing about a
  client) and the `scope: 'client'` macro data / `client/cl_main.c` source citations in
  `src/shared/config/*` stay as they are — AC1 names `en.json` explicitly.
- **Two keys are renamed anyway, because their value changes meaning**: `hero.stat.client` →
  `hero.stat.engine` ("Engine", `HeroPanel.tsx:108`) and `installation.engine` →
  `installation.engineExecutable` ("Engine executable", `ActionBar.tsx:273`) — that row's *value* is
  an executable path, so AC1's "where the word means the executable" clause applies to its label.
- **`library.column.engine` is updated but not deleted**: the key has no reference in `src/renderer`
  today; removing dead keys is a cleanup of its own, and AC1 only asks that its string not say
  "Client".
- **Support is a required `supported: boolean` on `EngineDefinition`** (not `supported?: true`, not
  a separate array): required means `tsc` forces every present and future definition to state its
  answer, and flipping one `false` to `true` is exactly AC5's one-line change.
- **The dialog reads a derived `SUPPORTED_ENGINE_DEFINITIONS`** from `engine.ts` rather than
  filtering inline, so no call site can grow a second definition of "supported".
- **`isEngineSupported(kind)` is false for everything except `r1q2`/`q2pro`**, including `custom`
  and `unknown` (neither is in `ENGINE_DEFINITIONS`) — one rule with no exceptions is testable over
  all ten `EngineKind`s, whereas "only mark named engines" would need a second rule for a case the
  user cannot act on differently.
- **AC4's marker is one interpolated i18n string, `engine.unsupportedLabel` = "{{engine}}
  (unsupported)"**, composed in a single renderer helper (`lib/engine-display.ts`) — translators get
  the whole phrase including the parentheses, and ASCII parentheses keep flow/unit selectors simple
  (no `·`).
- **The marker goes inside the existing badge, not into a second badge next to it**: 065 guarantees
  the badge is `shrink-0` and stays visible while the name truncates; a second `shrink-0` sibling
  would double that reserved width in every dense row.
- **AC4's scope is where an *installation's* engine is named**: `EngineBadge` (all eight call sites)
  plus `HeroPanel`'s engine stat tile. The config module's engine mentions
  (`CvarRow` "not on {{engine}}", `EngineScopeSelect`, `CareTab.omitted`) speak about the engine
  scope of a *cvar*, not about an installation's support status, and `AddExistingDialog`'s candidate
  subtitle sits in the same row as a badge that now carries the marker.
- **No fourth fixture installation.** AC4's e2e path is the existing third populated install
  (`engineKind: 'unknown'`, added by 065), whose badge now reads "Unknown engine (unsupported)"; a
  fourth install would ripple through 34 `ui:verify` screens and 17 flows just to e2e a second
  unsupported engine, which is a pure label mapping the unit test covers for all ten kinds.
- **The existing 065 flow is updated, not duplicated**: `scripts/flows/engine-badge-surfaces.mjs`
  pins `UNKNOWN_ENGINE_LABEL = 'Unknown engine'` (line 37) and two unit tests assert that exact text
  — they move to the marked form in the same deliverable that changes the badge, so the suite is
  never knowingly red.
- **S14's standing selector rule was executed, and came back clean**: `grep -ni client scripts/`
  yields only `clientWidth`/`getBoundingClientRect` — no `getByRole`/`getByText` selector anywhere in
  `scripts/flows/` or `scripts/lib/screens.mjs` depends on the word "Client", so the rename breaks no
  existing flow. (The sprint note's worry does not materialise; recorded here so nobody re-greps.)
- **AC2 needs a trigger the harness can drive**: the library's "Create installation" button has no
  testid, so it gets `data-testid="library-create"` (mirror: `library-auto-detect` in
  `LibraryView.tsx:80`). The dialog itself is drivable without the native folder picker — the
  picker only gates *submit*, and the engine `Select` renders immediately.
- **No new screen in `scripts/lib/screens.mjs`.** The create dialog gets its evidence from the new
  flow's `shot()` calls; adding a screen would put a never-before-audited dialog into the axe gate,
  which is a separate story's risk to take.
- **AC3 is proven at unit level, not e2e**: it is a claim about classification data
  (`ENGINE_DEFINITIONS` complete, own label kept, not degraded to `unknown`), not about something
  the user does — `classifyEngine` in `inspector.ts` iterates `ENGINE_DEFINITIONS` and is untouched
  by this story, so the guard belongs on the table and the badge label.

## Plan

1. **Data (`src/shared/types/engine.ts`).** Add required `supported: boolean` to
   `EngineDefinition`, set `true` on `r1q2`/`q2pro` and `false` on the other six, export
   `SUPPORTED_ENGINE_DEFINITIONS` (filtered) and `isEngineSupported(kind)` (false for `custom`/
   `unknown`). Fix the stale "Client executables" doc comments to "Engine executables". Detection
   keeps reading the full table — `inspector.ts` is not touched.
2. **Vocabulary (`en.json` + two call sites).** Rewrite the "Client" values:
   `installation.engine`→`installation.engineExecutable` "Engine executable",
   `hero.stat.client`→`hero.stat.engine` "Engine", `dialog.create.engineLabel` "Engine",
   `library.column.engine` "Engine", `dialog.addExisting.executableLabel` "Engine executable" +
   its hint, `installations.error.notQuake2`, `validation.noExecutable`,
   `validation.engineUnknown`, plus the three cvar-help strings from the Decisions. Update
   `HeroPanel.tsx:108` and `ActionBar.tsx:273` to the renamed keys. New key
   `engine.unsupportedLabel` = "{{engine}} (unsupported)".
3. **Create dialog (`CreateInstallationDialog.tsx`).** Options from
   `SUPPORTED_ENGINE_DEFINITIONS`; default stays `r1q2`. Add `data-testid="library-create"` to the
   library's create button.
4. **Unsupported marker.** New `src/renderer/src/lib/engine-display.ts` with
   `engineDisplayLabel(kind, t)` = `engineLabel(kind)` when supported, else
   `t('engine.unsupportedLabel', { engine: engineLabel(kind) })`. `EngineBadge.tsx` and
   `HeroPanel`'s stat value use it; all eight badge call sites inherit it unchanged.
5. **Harness.** Update the two unit expectations and `engine-badge-surfaces.mjs`'s
   `UNKNOWN_ENGINE_LABEL`; new `scripts/flows/engine-not-client.mjs` (mirror:
   `scripts/flows/care-duplicate-name.mjs`) walks home → library → create dialog and asserts the
   dropdown, the "Engine" field label, the marked badge, and that no visible text on home/library
   matches `/\bclient\b/i`. Re-run `npm run ui:verify`.

Order: 1 → 2 → (3, 4 independent) → 5. Renderer + shared data only; no IPC channel, no
`webPreferences`, no main-process behaviour change.

## Deliverables

- [x] **D1 — Support is data on `EngineDefinition`.** `src/shared/types/engine.ts` (+ `index.ts`
  re-export if it enumerates names), plus its test in new `src/shared/types/engine.test.ts`
  (mirror: `src/shared/config/engine-limits.test.ts`).
  *Accepted when:* `EngineDefinition.supported` is required, `r1q2`/`q2pro` are the only `true`
  entries, `SUPPORTED_ENGINE_DEFINITIONS` yields exactly those two in table order,
  `isEngineSupported` is false for the other six plus `custom`/`unknown`,
  `ENGINE_DEFINITIONS.map(d => d.kind)` still lists all eight kinds, and `engineLabel(kind)` still
  returns each unsupported engine's own label (not "Unknown engine").
- [x] **D2 — The vocabulary says engine.** `src/renderer/src/i18n/locales/en.json`,
  `src/renderer/src/components/shell/HeroPanel.tsx`,
  `src/renderer/src/components/shell/ActionBar.tsx`, plus its test in new
  `src/renderer/src/i18n/vocabulary.test.ts` (mirror: `src/shared/config/comment-labels.test.ts` —
  static `import en from './locales/en.json'`, no `node:fs`).
  *Accepted when:* the test walks every string value in `en.json` and finds no `/client/i` match;
  `installation.engineExecutable` and `hero.stat.engine` exist, the old keys are gone, and no
  `t('installation.engine')`/`t('hero.stat.client')` call remains in `src/renderer`;
  `engine.unsupportedLabel` exists as `{{engine}} (unsupported)`.
- [x] **D3 — Only supported engines are selectable.**
  `src/renderer/src/components/installations/CreateInstallationDialog.tsx`,
  `src/renderer/src/views/LibraryView.tsx` (create-button testid), plus its test in new
  `src/renderer/src/components/installations/CreateInstallationDialog.test.ts` (mirror:
  `src/renderer/src/modules/config/InstallationProfilesPanel.test.ts` —
  `// @vitest-environment jsdom`, RTL via `createElement`, `initI18n('en')` in `beforeAll`).
  *Accepted when:* the dialog's engine `<select>` has exactly two options, `R1Q2` and `Q2PRO`, its
  accessible name is "Engine", the default value is `r1q2`, the option list is derived from
  `SUPPORTED_ENGINE_DEFINITIONS` (flipping a `supported` flag in a test-local fixture changes the
  option count), and the library create button carries `data-testid="library-create"`.
- [x] **D4 — An unsupported engine says so, in text.** New
  `src/renderer/src/lib/engine-display.ts`, `src/renderer/src/components/ui/EngineBadge.tsx`,
  `src/renderer/src/components/shell/HeroPanel.tsx` (stat value), plus tests in
  `src/renderer/src/components/ui/EngineBadge.test.ts` (existing — the `'Unknown engine'`
  expectation at line 68 becomes the marked form) and
  `src/renderer/src/modules/config/InstallationProfilesPanel.test.ts` (existing — lines 101, 143).
  *Accepted when:* the badge reads `R1Q2`/`Q2PRO` bare, `Quake II RTX (unsupported)` and
  `Unknown engine (unsupported)` for the rest, the marker is text inside the badge's accessible
  name (no colour-only signal, no second badge node), the composition exists once in
  `engine-display.ts`, and the marker is asserted for all ten `EngineKind`s.
- [x] **D5 — Acceptance flow + green harness.** New `scripts/flows/engine-not-client.mjs` (mirror:
  `scripts/flows/care-duplicate-name.mjs`), `scripts/flows/engine-badge-surfaces.mjs`
  (`UNKNOWN_ENGINE_LABEL`, line 37 + its header comment), `docs/UI-VERIFICATION.md` (flow list
  entry).
  *Accepted when:* `npm run ui:flow engine-not-client` passes — create dialog opened from
  `library-create`, engine select offers exactly `R1Q2` + `Q2PRO` under a field labelled "Engine",
  the unknown-engine install's badge reads `Unknown engine (unsupported)` on rail/hero/library
  while an `r1q2` install's badge carries no marker, and `/\bclient\b/i` matches no visible text on
  home or library — and `npm run ui:flow engine-badge-surfaces` plus `npm run ui:verify` stay green
  (34/34 screens, no new axe violation).

## Model Hints

- D1 → default
- D2 → default
- D3 → default
- D4 → default
- D5 → **deliverable-hard** — it has to keep story 065's flow and the whole 17-flow/34-screen
  harness green while the badge text everyone selects on changes, and it drives the create-
  installation dialog, a path no flow has ever opened (no selector precedent, native folder picker
  one step away).
- Review: → default — renderer + shared data table only; no IPC channel, no main-process
  behaviour, no `webPreferences` surface touched.

## Acceptance Tests

- AC1 → unit `src/renderer/src/i18n/vocabulary.test.ts` › "no user-visible string calls the engine
  a client" (walks every string value in `en.json`, asserts no `/client/i`) plus › "the executable
  labels name the engine executable" — delivered and asserted by D2; additionally proven on the
  real surface by e2e `scripts/flows/engine-not-client.mjs` › "no visible text on home or library
  says client" (D5).
- AC2 → e2e `scripts/flows/engine-not-client.mjs` › "the create dialog offers R1Q2 and Q2PRO under
  an Engine label" (user action: open the dialog from the library, read the select's options and its
  field label) — delivered by D3, asserted by D5; DOM-level twin in unit
  `src/renderer/src/components/installations/CreateInstallationDialog.test.ts` › "only supported
  engines are offered".
- AC3 → unit `src/shared/types/engine.test.ts` › "every known engine still classifies with its own
  label" (all eight kinds present in `ENGINE_DEFINITIONS`, `engineLabel` returns the definition's
  own label for the six unsupported ones, `isEngineSupported` does not change either) — delivered
  and asserted by D1; the badge half in `EngineBadge.test.ts` › "an unsupported engine keeps its own
  name" (D4).
- AC4 → e2e `scripts/flows/engine-not-client.mjs` › "an unsupported engine is marked unsupported
  where it is shown" (rail, hero, library card for the fixture's unknown-engine install; the
  supported install shows no marker) — delivered by D4, asserted by D5; plus unit
  `src/renderer/src/components/ui/EngineBadge.test.ts` › "the unsupported marker is text, for every
  engine kind" (all ten kinds, marker inside the badge text, no second node) and
  `InstallationProfilesPanel.test.ts`'s updated row expectations.
- AC5 → unit `src/shared/types/engine.test.ts` › "the supported set is data, in one place"
  (`SUPPORTED_ENGINE_DEFINITIONS` is derived from the `supported` flag) plus
  `CreateInstallationDialog.test.ts` › "the dialog reads the supported set, not a hard-coded list"
  (the option list follows `SUPPORTED_ENGINE_DEFINITIONS`; no `EngineKind` literal array in
  `CreateInstallationDialog.tsx`) — delivered by D1/D3.

No manual residue.

## Done

Summary: The app now speaks of "engine" everywhere a user reads it — `en.json` has zero
"client"/"Client" occurrences left, with the executable-path row relabelled "Engine executable".
`EngineDefinition` carries a required `supported: boolean` (true only for `r1q2`/`q2pro`), and the
create-installation dialog's dropdown, engine-display helper, and badge marking all derive from
that one flag instead of separate hard-coded lists. Detection keeps recognising and labelling all
eight known engine kinds; an installation on an unsupported one now reads e.g. "Unknown engine
(unsupported)" or "Quake II RTX (unsupported)" wherever its badge/stat is shown, as text, not by
colour alone.

Commit message: `068: the app says engine, not client`

Verification:
- build: `npm run build` — clean.
- typecheck: `npm run typecheck` (node + web) — clean.
- test: `npm test` — 2648/2649 passed; 1 failure
  (`src/main/modules/config/core/import-reader.test.ts` › "refuses further exec once 512 files
  have been opened…") is a pre-existing timing-sensitive stress test unrelated to this story's
  files (config import-reader, not touched by any deliverable); re-run in isolation
  (`npx vitest run src/main/modules/config/core/import-reader.test.ts -t "refuses further exec"`)
  passed cleanly, confirming flake rather than regression.
- e2e: `npm run ui:flow engine-not-client` PASS, `npm run ui:flow engine-badge-surfaces` PASS,
  `npm run ui:verify` PASS — 34/34 screens, 0 axe violations.
- Review: clean-agent review verdict **PASS**, no findings.
- AC → test mapping as verified:
  - AC1 → `src/renderer/src/i18n/vocabulary.test.ts` (no `/client/i` in any `en.json` string) +
    e2e `engine-not-client.mjs` (no visible "client" text on home/library) — both passed.
  - AC2 → e2e `engine-not-client.mjs` (dropdown offers R1Q2+Q2PRO under "Engine") +
    `CreateInstallationDialog.test.ts` — both passed.
  - AC3 → `src/shared/types/engine.test.ts` (all eight kinds classify, keep own labels) +
    `EngineBadge.test.ts` — both passed.
  - AC4 → e2e `engine-not-client.mjs` (marker on rail/hero/library, supported shows none) +
    `EngineBadge.test.ts` (all ten kinds, marker is text not a second node) +
    `InstallationProfilesPanel.test.ts` — all passed.
  - AC5 → `src/shared/types/engine.test.ts` ("supported set is data, in one place") +
    `CreateInstallationDialog.test.ts` ("reads the supported set, not a hard-coded list") —
    both passed.
  - No manual residue.
- Open points: none. `docs/UI-VERIFICATION.md`'s flow list was already missing a few unrelated
  entries (`care-duplicate-name`, `grenade-rows-take-a-key`, `unsaved-diff`) from earlier stories;
  D5 added this story's own entry but left that pre-existing drift alone as out of scope.
