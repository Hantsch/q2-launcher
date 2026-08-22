---
id: 037
title: ui:verify covers every surface and its report is green
status: done
created: 2026-08-21
---

## Requirement

`npm run ui:verify` is the gate this project accepts UI work with (`live-smoke-required: true`
in `.claude/ai-scrum.md`), so its report has to mean something. Right now two things stop it from
meaning what we act as if it means.

**It does not see everything.** The screen registry
([scripts/lib/screens.mjs](../../scripts/lib/screens.mjs)) holds 14 entries, all of which are
routes/tabs. Modal surfaces are not in it — S05 named the write-preview dialog and the import
preview explicitly as a gap: story 024's shared `ConfigCodeView` was swapped into both, and both
were accepted by hand only. A gate that is trusted as the sole check while it cannot reach the
dialogs is a gate that will one day pass a broken dialog.

**Its report is not green and nothing forces it to be.** The last report on disk
(`.ui-verify/a11y.json`) is a partial run (two entries, `config-care` only) and every audited
screen in it carries `page-has-heading-one` — moderate impact, so the run's exit-code gate
(`critical > 0 || serious > 0`, [scripts/verify.mjs:359](../../scripts/verify.mjs#L359)) lets it
through. Story 028 also reported two axe **criticals** (`select-name`, `label`); one of them was
fixed incidentally in S05 on the Care tab's installation picker, and nobody knows the state of
the other, because no full run has been recorded since.

What I want out of this story: run the thing fully, fix what it honestly reports, put the missing
surfaces in it, and leave behind a report where "green" is a fact rather than a hope.

This also closes the last open item of story [[027]] (`docs/requirements/027-quiet-ui-verification.md`,
still `in-progress`): its one experiential acceptance criterion — a full run that does not steal
focus, so I can keep working while it goes — is checkable by simply doing a full run on this
desktop, and this story's test plan is where that happens.

## Acceptance Criteria

- [x] A full `npm run ui:verify` run is recorded (not `--screens=…`), and the run summary says
      `run: full`.
- [x] The write-preview dialog and the import preview are entries in the screen registry, are
      reached by the harness, and are screenshotted and audited like every other screen.
- [x] Every axe violation the full run reports is either fixed or recorded as a deliberate,
      justified exception in the story's Done section — no violation is left unmentioned.
      `page-has-heading-one` in particular is decided, not ignored.
- [x] Zero `critical` and zero `serious` violations across all screens and both viewports; the
      run exits 0.
- [x] Story 027's remaining check is confirmed on the real desktop: during a full run, typing in
      another window is uninterrupted and no app window takes focus. Confirmed → 027 goes to
      `done`. **Confirmed by the user at S06 sprint acceptance (2026-08-22).**
- [x] `docs/UI-VERIFICATION.md` matches what the harness now does — screen count, what is and is
      not covered, and how a dialog entry is added.
- [x] Any surface still out of reach after this story is named in `docs/UI-VERIFICATION.md` as a
      known blind spot, so the next person does not have to rediscover it.

## Decisions (Sprint)

- **(User)** Build mode `ui:verify` drives: production-mode build (same decision as story 035).
- **(User)** Exit-code gate stays `critical > 0 || serious > 0`; tightening to `moderate` is a
  separate, deliberate follow-up once this run is green.
- **(User)** `page-has-heading-one`: disable the rule for this app — a single-window desktop app
  has no page-document semantics — and document the decision in the Done section.
- **(User)** Modal scope: stay at the two S05-named dialogs (write-preview, import preview); other
  modal surfaces (warning modal, `KeyBindDialog`, `MessageEditor`) get their own coverage later.
- Dialog reachability from the existing fixtures (the question left to refine): **write-preview yes,
  import preview no** — the write preview is computed from profile state and `Plain Profile`'s
  `fixture-install-favorite` assignment already renders the Raw row that mounts it, while
  `scanImportCandidates()` (`src/main/modules/config/import.ts:81-95`) only offers a gamedir that
  actually contains `config.cfg`/`autoexec.cfg` and the fixture's `baseq2` dirs are empty.
- The new fixture `config.cfg` goes into `fixture-install-writedir` only, because no current screen
  renders that installation's files, so no existing screenshot changes because of it.
- Both surfaces are reached via new `data-testid`s on their triggers rather than role/label
  lookups, matching the registry's documented convention and staying independent of `en` copy.
- Screen ids are `config-write-preview` and `config-import-preview`, keeping the `config-*` prefix
  every other config surface in the registry uses.
- `page-has-heading-one` is disabled through one axe run-option constant in `scripts/lib/session.mjs`,
  and the disabled rule is printed in `a11y.md`, so a weakened gate stays visible in the report
  instead of being silently baked into the harness.
- The registry holds **12** entries today, not 14 (the Requirement's and the doc's number are
  stale), and 031/033 add `downloads`/`mods`/`assets` earlier in this sprint — so the doc pass
  recomputes counts from `SCREENS` rather than restating a number.
- 027's focus criterion gets its own deliverable plus a live smoke pass, because only a human at a
  real desktop can confirm that typing in another window was never interrupted.

## Open Questions

- ~~Should the exit-code gate be tightened to fail on `moderate` too …~~ answered →
  Decisions (Sprint)
- ~~`page-has-heading-one`: does the app get a real …~~ answered → Decisions (Sprint)
- ~~Are the two dialogs reachable from the existing fixtures without new seed data …~~ answered →
  Decisions (Sprint) — refine checked the fixture: write-preview yes, import preview needs one
  seeded `config.cfg`.
- ~~Are there other modal surfaces worth adding in the same pass …~~ answered → Decisions (Sprint)

## Plan

Registry facts as found (the Requirement's "14 entries" is stale): `scripts/lib/screens.mjs` holds
**12** entries today, one of which (`keybind-dialog`) is already a modal — so the harness *can* do
dialogs, the two S05 surfaces simply were never added. Both surfaces need a testid on their
trigger, and one of them needs fixture data:

- **Write preview** = `RawConfigPanel` (`src/renderer/src/modules/config/RawConfigPanel.tsx`),
  mounted by `RawFileTab.tsx:245` when a per-installation row is expanded via the chevron button
  (`RawFileTab.tsx:200-214`, `aria-label` only, no testid). Its content comes from `config:preview`
  (profile state, not disk), so `Plain Profile` → `fixture-install-favorite` is enough.
  **Reachable with today's fixture.**
- **Import preview** = the preview block inside `ImportProfileDialog.tsx:120-300`, reached via
  Config list → "New profile" → source `import` → Continue → pick installation. It only renders
  once `import.scan` returns a candidate, and `scanImportCandidates()`
  (`src/main/modules/config/import.ts:81-95`) only lists a gamedir that really contains
  `config.cfg`/`autoexec.cfg`. The fixture's `baseq2` dirs are empty → today the dialog stops at
  its "no config files" empty state. **Fixture must grow one deterministic `config.cfg`.**

Order: testids (D1) → fixture (D2) → registry entries (D3) → axe rule + report transparency (D4)
→ full production-mode run recorded as an inventory (D5) → fix what it reports (D6) → docs truth
pass (D7) → close 027 (D8). D5 must run **after** the rest of S06 (029-036) has landed, per the
sprint's build order, so the run captures the finished UI including 035's `q2launcher://` scheme.

Affected files: `src/renderer/src/modules/config/{RawFileTab,ConfigView,CreateProfileDialog,ImportProfileDialog}.tsx`,
`scripts/lib/{fixture,screens,session}.mjs`, `scripts/verify.mjs`, `docs/UI-VERIFICATION.md`,
`docs/requirements/027-quiet-ui-verification.md`, plus whichever renderer files D5's inventory names.

## Deliverables

### D1 — Testids on the path to both surfaces ✓

- Files: `src/renderer/src/modules/config/RawFileTab.tsx` (expand button, ~line 200),
  `ConfigView.tsx` ("New profile" button, ~line 234), `CreateProfileDialog.tsx` (source `Select`,
  footer primary button), `ImportProfileDialog.tsx` (installation `Select`).
- Mirror: the `data-testid="config-profile-row"` pattern in `ConfigView.tsx:262` — a non-unique
  testid plus `.first()`/`.filter()` on the driver side is the established convention.
- Names: `config-raw-expand`, `config-create-profile`, `config-create-source`,
  `config-create-submit`, `config-import-installation`.
- Accept: the five attributes exist, nothing else about those components changes, and
  `npm run typecheck && npm test && npm run build` is green.

### D2 — Fixture gains an importable config ✓

- Files: `scripts/lib/fixture.mjs`.
- Write a fixed-content `baseq2/config.cfg` under the **`fixture-install-writedir`** installation
  only (see Decisions), containing a handful of `seta` cvars, several `bind`s including one
  duplicate bind, and one line the reader will not recognise — so the preview's count block, its
  duplicate-bind list and its preserved-line list all have content to render.
- Accept: `npm run ui:seed` run twice produces byte-identical files (no `Date.now()`, no random
  ids); no existing screen's rendered state changes (the file lives on an installation no current
  screen renders files for).

### D3 — Both surfaces enter the screen registry ✓

- Files: `scripts/lib/screens.mjs` (two entries plus the header comment's testid list and entry
  count).
- `config-write-preview`: `populated`, `BOTH_VIEWPORTS` — `configDetail('raw')`, then click
  `config-raw-expand` and wait for rendered file content (not the spinner).
- `config-import-preview`: `populated`, `BOTH_VIEWPORTS` — config list → `config-create-profile`
  → select `import` on `config-create-source` → `config-create-submit` → choose
  `Fixture WriteDir Install` on `config-import-installation` → wait for the preview block.
- Accept: `npm run ui:verify -- --screens=config-write-preview,config-import-preview` writes 4
  PNGs that visibly show preview content (no spinner, no empty state, no error boundary) and
  audits all four visits; `resetToBaseState()` still gets home afterwards (the import dialog is a
  `Modal`, so Escape closes it; the raw panel unmounts with the route).

### D4 — `page-has-heading-one` disabled, visibly ✓

- Files: `scripts/lib/session.mjs` (one exported `AXE_RUN_OPTIONS` / disabled-rules constant with
  the reason as a comment, passed into `window.axe.run(...)` at ~line 286), `scripts/verify.mjs`
  (`buildA11yMarkdown` summary and `printSummary` name the disabled rule(s)).
- Accept: `a11y.md` and the console summary both state which rules are disabled and why, the rule
  no longer appears for any screen, and the exit-code rule is otherwise untouched (still
  `critical > 0 || serious > 0`).

### D5 — Full production-mode run, recorded as an inventory ✓

- Runs after 029-036 have landed: `npm run ui:verify` with no `--screens=`, against the production
  build (035's `q2launcher://` renderer).
- Files: this story's `## Done` section only (no code).
- Accept: the summary line reads `run: full (N/N screens)`; the story records every violation as
  `screen · rule · impact · nodes`, plus any `unreachable`/`error` screen, any renderer console
  error, and the exit code — that inventory is what D6 works from. A harness/app failure found here
  belongs to D6's scope, it is not a reason to stop.

### D6 — Fix everything the inventory reports ✓

- Files: whatever D5 names. Anticipated from story 028's earlier findings and from reading the two
  dialogs: `select-name` on `Select`s wrapped in a `Field` without `htmlFor`
  (`src/renderer/src/components/ui/controls.tsx:12-38` never wires label → control), `label` on the
  `KeyBindDialog` filter input, `scrollable-region-focusable` on the `max-h-40 overflow-y-auto`
  lists in `ImportProfileDialog.tsx`.
- Fix at the reported call sites (`aria-label`, or `id` + `Field htmlFor`), not by redesigning
  `Field` — unless the same missing-name pattern shows up at three or more sites, in which case one
  small shared id helper in `controls.tsx` is the cheaper fix.
- Accept: a fresh full `npm run ui:verify` exits **0** with `0 critical, 0 serious` across all
  screens and both viewports; every remaining `moderate`/`minor` is listed in `## Done` as fixed or
  as a justified exception; `npm run typecheck && npm test && npm run build` green.

### D7 — `docs/UI-VERIFICATION.md` tells the truth ✓

- Files: `docs/UI-VERIFICATION.md`.
- Screen count recomputed from `SCREENS` (do not carry the "14 screens" number forward — it is
  wrong today and 031/033 change it again), the two dialog entries described, a short "how to add a
  dialog entry" note next to the existing "How to add a screen" (testid on the trigger, wait for the
  dialog/panel, rely on `resetToBaseState()`'s Escape), the disabled axe rule and its reason, the
  fixture's importable `config.cfg`, the stale `## Known issues` `RawConfigPanel`-crash section
  removed (fixed in 024), and a **blind spots** list naming what is still uncovered (the warning
  modal, `MessageEditor`, `DetectDialog`, toasts, anything behind a native OS dialog).
- Accept: every number and claim in the doc is checkable against the registry and `scripts/`; a
  reader can add a dialog entry from the doc alone.

### D8 — Close story 027

- Files: `docs/requirements/027-quiet-ui-verification.md` (status `done`, its own Done note),
  `git mv` into `docs/requirements/done/`, plus one line in `docs/requirements/done/INDEX.md`.
- Requires the live smoke pass from `## Test Plan` step 1 — a human at this desktop is the only
  thing that can confirm "typing elsewhere was uninterrupted"; `live-smoke-required: true` applies,
  so if this session cannot do it, 037 stays `in-progress` as "built, acceptance pending".
- Accept: 027 sits in `done/` with the confirmation recorded, and 037's Done section says who
  confirmed it and on which run.

## Model Hints

- D1, D2, D3, D4, D5, D7, D8 → default.
- D6 → `deliverable-hard` — it fixes accessibility defects whose set is only known at run time,
  across renderer components it does not own, where a wrong `aria-label`/`htmlFor` silently changes
  what a screen reader announces and a wrong `tabIndex` changes real keyboard order.
- Review: → default — the change surface is harness scripts, fixture data, `data-testid`s and
  accessibility attributes; no IPC channel, no main-process logic, no state shape.

## Test Plan (manual acceptance)

1. **027's focus check (the one criterion only a human can close).** Open an editor or terminal in
   another window, start `npm run ui:verify` there, and keep typing in a *different* window for the
   whole run. Expect: no app window takes focus, no keystroke lands in the launcher, typing is never
   interrupted. Note the run's `launches: N` line. → AC5
2. **Look at the four new screenshots** in `.ui-verify/screenshots/`:
   `config-write-preview@1280x800.png`, `@940x620.png`, `config-import-preview@1280x800.png`,
   `@940x620.png`. Expect: the write preview shows real file content with 023's path/badge/reveal
   header and 024's highlighting; the import preview shows cvar/bind counts plus the duplicate-bind
   and preserved-line lists — neither shows a spinner, an empty state or an error boundary. → AC2
3. **Drive both surfaces by hand once** (`npm run dev`, real UI, no console shortcuts): Config →
   `Plain Profile` → Raw File → expand the installation row; then Config → New profile → "Import
   from installation" → Continue → `Fixture WriteDir Install`. Expect both to look like the
   screenshots and to close cleanly with Escape / the collapse chevron. → AC2
4. **Read `.ui-verify/a11y.md`.** Expect: summary `0 critical, 0 serious`, the disabled-rule note
   naming `page-has-heading-one` with its reason, and every remaining finding also present in this
   story's Done section. Confirm the process exit code was `0`. → AC1, AC3, AC4

## Coverage (AC → D)

- AC1 (full run recorded, `run: full`) → D5, re-confirmed by D6's final run
- AC2 (both dialogs in the registry, reached, shot and audited) → D1 + D2 + D3
- AC3 (every violation fixed or justified; `page-has-heading-one` decided) → D4 + D5 + D6 + D7
- AC4 (zero critical/serious, exit 0) → D6
- AC5 (027's focus check confirmed on the real desktop; 027 → `done`) → D8 (+ Test Plan step 1)
- AC6 (`docs/UI-VERIFICATION.md` matches the harness) → D7
- AC7 (remaining blind spots named in the doc) → D7

## Done

**Summary.** Both S05-named dialogs (write preview, import preview) are now in the screen
registry, reached via new testids, screenshotted and audited at both viewports. The fixture
grew one deterministic `config.cfg` (under `fixture-install-writedir` only) so the import
preview has real content to show. `page-has-heading-one` is disabled app-wide via one
documented constant, visible in both `a11y.md` and the console summary. A full production-mode
`npm run ui:verify` run was executed twice: the first (inventory) run found 4 critical + 16
moderate violations across 3 screens; every one was fixed, and a second full run confirmed
`0 critical, 0 serious, 0 moderate, 0 minor` across all 17 screens × 2 viewports, exit code 0.
`docs/UI-VERIFICATION.md` was rewritten to match the harness's current state (17 screens, both
dialog entries, the disabled rule, the fixture addition, a "how to add a dialog" note, and a
"known blind spots" list). Story 027's remaining focus-steal criterion could not be closed by
this session — see below.

**D5 inventory (first full run, exit 2) and its fixes (D6):**

| Screen | Rule | Impact | Nodes | Disposition |
| --- | --- | --- | --- | --- |
| config-import-preview@1280x800/@940x620 | select-name | critical | 2 each | Fixed — `Field` now mints an id (`useId()`, or the caller's `htmlFor`) and wires it to its one control via `FieldControlIdContext`/`useControlId()` in `src/renderer/src/components/ui/controls.tsx`; `Select`/`Input`/`PathPicker` adopted it. Applied as a shared helper (not per-site patches) because 30+ `Field` sites lacked `htmlFor` — the ≥3-site threshold in D6's brief. |
| keybind-dialog@1280x800/@940x620 | label | critical | 1 each | Fixed by the same `Field` id-wiring helper (the failing node was the raw-command input, not the filter input as the plan anticipated — corrected during D6). |
| library-empty@1280x800/@940x620, config-empty@1280x800/@940x620 | heading-order | moderate | 1 each | Fixed — `EmptyState` title changed `h3` → `h2` in `src/renderer/src/components/ui/primitives.tsx` (it renders directly under a view's `h1`; `h3` skipped a level). |
| config-import-preview@1280x800/@940x620, keybind-dialog@1280x800/@940x620 | landmark-no-duplicate-banner, landmark-no-duplicate-contentinfo, landmark-unique | moderate | 1/1/2 each | Fixed, not a harness artifact — `Modal.tsx`'s dialog `<header>`/`<footer>` were real second `banner`/`contentinfo` landmarks because the modal portals to `document.body`, outside `<main>` where view headers already provide one. Changed to plain `div`s in `src/renderer/src/components/ui/Modal.tsx`; dialog naming still works via `aria-label`, no DOM-order/tabIndex change. |

Second full run after D6: 0 critical / 0 serious / 0 moderate / 0 minor, 34/34 shots written, 0
unreachable/error, exit code 0. Nothing remains to record as a justified exception.

**`page-has-heading-one` decision.** Disabled app-wide via `AXE_DISABLED_RULES` /
`AXE_DISABLED_RULES_REASON` in `scripts/lib/session.mjs`, reason: a single-window desktop app has
no page-document semantics for this rule to check. Both `a11y.md`'s summary and the console
`printSummary` name the disabled rule so the weakened gate stays visible rather than silently
baked in. The exit-code gate (`critical > 0 || serious > 0`, `scripts/verify.mjs`) is untouched.

**Review findings handled:**
- Review flagged that this Done section didn't exist yet at review time (the story's `## Done`
  was still empty while D5/D6's violation inventory only lived in the orchestrator's progress
  log) — fixed by writing this section (the review ran before step 8 of the build procedure,
  which is exactly what fills it in).
- Review noted a latent, pre-existing, out-of-scope defect: `MessageEditor.tsx` wraps a plain
  native `<input>` in a `Field` without going through the new `useControlId()` path, so it would
  hit the same `label` defect if it were ever added to the registry. `MessageEditor` is already
  listed as a known blind spot in `docs/UI-VERIFICATION.md`; no fix made here since it is not
  reachable by the harness and not in this story's scope — left for whoever wires it in.

**Story 027 (blocked, honest report).** D8 required a human at the real desktop to type in
another window for the whole duration of a full `npm run ui:verify` run and confirm no app
window ever stole focus. This build session drove `npm run ui:verify` twice via a blocking tool
call (Bash) with no concurrent ability to type elsewhere or observe window focus — an agent
cannot fulfil this criterion, and per this sprint's rules a live-smoke confirmation is not
fabricated. AC5 is therefore left unchecked, story 027 stays `in-progress`, and 037's status
stays `in-progress` for this one criterion only — every other AC and deliverable is complete.
Handing to the user: run `npm run ui:verify` once at this desktop while typing in another window
the whole time; if nothing steals focus, tick AC5 here, set 027's own Done note, move it to
`docs/requirements/done/`, add its `INDEX.md` line, and flip this story to `done`.

**Decisions made beyond the sprint's binding ones:**
- D6's `select-name`/`label` fix used the shared `Field` id-wiring helper (not per-call-site
  `aria-label`s) because the missing-name pattern recurred at 30+ sites, matching the D6
  deliverable's own "3 or more sites → shared helper" instruction.
- `Modal.tsx`'s header/footer landmark fix (plain `div`s instead of `<header>`/`<footer>`) was
  judged a real defect, not a harness artifact, after confirming no CSS selector, focus-trap, or
  ARIA role in the codebase depends on those tag names — recorded here since the D6 brief left
  open the possibility this was merely a harness quirk.

**Verification:** `npm run typecheck` — pass. `npm test` — 957/957 pass (54 files). `npm run
build` — pass. `npm run ui:verify` (full, twice) — final run: exit 0, `run: full (17/17
screens)`, 0 critical/serious/moderate/minor. Code review (clean agent, default tier): verdict
PASS with one documentation gap (this Done section, now filled) and one out-of-scope latent
finding (`MessageEditor`, documented above) — no review-fix cycle needed beyond writing this
section.

**Commit message:** `037: close ui:verify's dialog and axe gaps — write/import preview in the
registry, a11y fixes, full green run`

**Closed at S06 acceptance (2026-08-22).** The user confirmed the focus-steal check on the real
Windows desktop during the S06 sprint review, which was the single open acceptance criterion
(AC5) of this story and the last open one of [[027-quiet-ui-verification]]. Both stories are now
`done`; nothing in the code changed for this — the criterion was experiential only. The two
findings this story deliberately left open stay open and are documented as known blind spots in
`docs/UI-VERIFICATION.md` (`MessageEditor.tsx`'s unwired label, not in the screen registry).
