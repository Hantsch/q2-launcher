---
id: 046
title: The production CSP no longer allows inline styles
status: done # draft -> ready -> in-progress -> done
created: 2026-08-22
---

## Requirement

Story 035 moved the shipped renderer onto a real `q2launcher://` origin and made the CSP travel
with every protocol response — but it deliberately left one directive unresolved:
`style-src 'self' 'unsafe-inline'`. That single token means any injected `<style>` block or
`style="..."` attribute still executes, which is exactly the class of attack the whole CSP exists
to stop. The repo's own security claim is therefore still one directive short of true, and the
roadmap has carried it as a ready follow-up ever since.

Nothing blocks it any more: Tailwind's output is requested as a real `./assets/*.css` file, not
inlined. What is unknown is how many inline `style={{ ... }}` usages the renderer still has and
whether any third-party dependency injects a stylesheet at runtime.

## Acceptance Criteria

- [x] The production CSP in `src/main/lib/renderer-source.ts` has no `'unsafe-inline'` in
      `style-src`.
- [x] A production build of the app renders every screen with no visual regression and no CSP
      violation in the console — verified by a full `npm run ui:verify` run in production mode
      (screenshots compared against the current ones, axe report still at zero
      critical/serious/moderate/minor).
- [x] Any inline style the renderer genuinely needs (a dynamic width, a computed colour) is
      expressed in a way the stricter CSP permits — a CSS custom property set on the element, a
      utility class, or a nonce — and the chosen mechanism is stated once in
      `docs/ARCHITECTURE.md`, so the next dynamic-style case does not reintroduce the token.
- [x] The dev-mode CSP may keep whatever Vite's HMR needs; the difference between dev and
      production is explicit in the file's comment, not accidental.
- [x] A regression guard fails if `'unsafe-inline'` reappears in the production `style-src`.

## Open Questions

_None — all detail decisions taken in refine, see "Decisions (Sprint)"._

## Decisions (Sprint)

- **The mechanism for dynamic styles stays React's `style={{ ... }}` prop; no refactor is planned
  up front.** `style-src` governs stylesheets and *parsed* `style` attributes, not CSSOM writes —
  React DOM applies the `style` prop through `node.style.setProperty(...)`, and the renderer has no
  `setAttribute('style', …)`, no `<style>` literal and no `dangerouslySetInnerHTML` anywhere
  (survey: 20 `style={{}}` sites plus `OverviewKeyboardPanel.tsx:318,322` `target.style.zoom`), so
  the expected outcome of flipping the token is zero violations and zero visual change.
- **The flip is therefore verified empirically instead of pre-emptively refactored.** A refactor of
  ~20 call sites to guard against a violation that the CSP spec says cannot happen would be the
  expensive half of the story; D4 measures first and only fixes what actually breaks.
- **AC3's "stated once in `docs/ARCHITECTURE.md`" lands in `### Design system`** (after line ~222,
  before `## Window chrome`) rather than in a new security section — that heading already owns the
  styling conventions (`styles/index.css`, Tailwind layering, floating-element positioning), and
  ARCHITECTURE.md has no CSP section to extend.
- **Two guards, not one, for AC5:** a unit test on the `PRODUCTION_CSP` constant
  (`src/main/lib/renderer-source.test.ts`, the file that already tests this module) catches a source
  edit, and the `ui:verify` harness's live header assertion catches a policy that is edited but not
  actually delivered. The constant test alone would pass on a build that never ships the header.
- **The harness gets a `securitypolicyviolation` collector.** Playwright's `page.on('console')` does
  not reliably surface browser-generated CSP violations, so "no CSP violation in the console" (AC2)
  is made a hard, spec-based assertion instead of a hope about console plumbing.
- **`DEV_CSP` is left untouched** (AC4): Vite/React Fast Refresh needs inline style injection, and
  the dev policy is delivered by a different mechanism (`onHeadersReceived`) than production's
  protocol handler — the story only asks that the difference be explicit in the comment.
- **The baseline screenshots are captured as D1, before the flip.** AC2 compares "against the
  current ones"; once the token is gone, the pre-change state is unrecoverable without a checkout
  dance.

## Plan

1. **D1 — baseline.** `npm run build` + `npm run ui:verify` on the untouched tree, copy
   `.ui-verify/screenshots/` to a temp dir outside the repo. Green run = the comparison basis.
2. **D2 — the flip.** `src/main/lib/renderer-source.ts`: `style-src 'self'` in `PRODUCTION_CSP`;
   replace the AC6 deferral comment with the dev-vs-production rationale (AC4). Add regression-guard
   tests to `src/main/lib/renderer-source.test.ts` (AC5).
3. **D3 — live guards.** `scripts/lib/harness.mjs`: extend the single
   `REQUIRED_CSP_DIRECTIVE` into a required-directive list that includes `style-src 'self';`, and
   collect `securitypolicyviolation` events into `RunLog.failures`. Note both in
   `docs/UI-VERIFICATION.md`.
4. **D4 — measure and document.** Production `ui:verify` run, screenshot comparison against D1's
   baseline, axe still clean; fix any genuine violation; write the dynamic-style rule into
   `docs/ARCHITECTURE.md`.

Order matters: D1 before D2 (baseline), D3 before D4 (the run must be able to fail).

## Deliverables

### D1 — Pre-change screenshot baseline [x]

- No source change. Run `npm run build`, then `npm run ui:verify`; copy
  `.ui-verify/screenshots/` (including `flows/`) to a directory outside the repo (scratchpad) and
  record the path plus the screen list in the build notes.
- **Acceptance:** the run exits 0, and a baseline copy exists for every screen the registry
  (`scripts/lib/screens.mjs`) defines. If the run is already red before any change, stop and report
  — that is a pre-existing failure, not this story's.

### D2 — `style-src 'self'` in the production CSP, with a regression guard [x]

- `src/main/lib/renderer-source.ts`: remove `'unsafe-inline'` from `PRODUCTION_CSP`'s `style-src`.
  Replace the `AC6:` deferral doc comment above it with a comment that states (a) production allows
  no inline styles and dynamic values go through the `style` prop / CSS custom properties (CSSOM,
  which `style-src` does not govern), and (b) why `DEV_CSP` still carries the token (Fast Refresh /
  HMR inject stylesheets) — i.e. the dev↔prod difference is deliberate, not drift. `DEV_CSP` itself
  is unchanged.
- `src/main/lib/renderer-source.test.ts` (mirror the existing `describe` blocks in that file): a
  test asserting `PRODUCTION_CSP` contains `style-src 'self';` and that the whole policy contains no
  `'unsafe-inline'` / `'unsafe-eval'` at all, plus a test documenting that `DEV_CSP` intentionally
  does allow inline styles.
- **Acceptance:** `npm test` and `npm run typecheck` green; the new test fails if `'unsafe-inline'`
  is put back into the production `style-src`. (AC1, AC4, AC5)

### D3 — The harness fails on a CSP violation and on a weakened live header [x]

- `scripts/lib/harness.mjs`: turn the `REQUIRED_CSP_DIRECTIVE` constant (line 42) into a list of
  required directives — keep `script-src 'self'`, add `style-src 'self';` (with the trailing
  semicolon, so `style-src 'self' 'unsafe-inline'` does not satisfy it) — and report every missing
  one in the `HarnessError`. Keep the mirroring comment convention of lines 34-42.
- Same file: right after the `page.on('console')` / `page.on('pageerror')` wiring (lines 195-203),
  install a `securitypolicyviolation` listener in the page that pushes
  `{ violatedDirective, blockedURI, sourceFile, lineNumber }` into a page-global array; add a
  `cspViolations` field to `RunLog` (lines 70-119), drain the array into it before the run is
  evaluated, and surface each entry in `RunLog.failures` / `format()` like the existing
  `console error:` lines. Also register it via `page.addInitScript` so a navigation keeps the
  collector.
- `docs/UI-VERIFICATION.md`: extend the "Production-mode guarantee" section (lines ~229-253) with
  the added directive and the violation gate.
- **Acceptance:** `npm run ui:verify` still exits 0 on the current tree; temporarily re-adding
  `'unsafe-inline'` to `PRODUCTION_CSP` makes it fail with a missing-directive error (revert after
  checking). (AC5, live half)

### D4 — Verified clean in production, and the rule written down [x]

- Run `npm run build` + `npm run ui:verify`. Compare every screenshot against D1's baseline
  (byte-identical is the expected pass; otherwise open both and judge — any structural or
  colour difference is a regression to fix, not to accept). Confirm `.ui-verify/a11y.json` still
  reports zero critical/serious/moderate/minor findings and that `cspViolations` is empty.
- If a genuine violation appears, fix it at the call site with a CSS custom property or a utility
  class in `src/renderer/src/styles/`. If more than ~3 sites need real refactoring, stop and report
  back instead of reworking the UI inside this story.
- `docs/ARCHITECTURE.md`: in `### Design system` (after ~line 222, before `## Window chrome`), a
  short "Dynamic styles under the production CSP" paragraph: the production policy is
  `style-src 'self'`; dynamic values are set through React's `style` prop or a CSS custom property
  (CSSOM writes, which `style-src` does not cover); `setAttribute('style', …)`, `<style>` literals
  and CSS via `dangerouslySetInnerHTML` are the forms that *are* blocked and must not be
  introduced.
- **Acceptance:** `ui:verify` exits 0 with no console error, no CSP violation and no screenshot
  regression; the ARCHITECTURE.md paragraph exists and names the permitted and forbidden forms.
  (AC2, AC3)

## Model Hints

- D1 → default (run two npm scripts, copy a folder).
- D2 → default (one string literal plus two assertions in an existing test file).
- D3 → default (localised edits inside one harness file, mirroring patterns already there).
- D4 → `deliverable-hard` — it has to judge a full-UI screenshot comparison and, if a violation does
  appear, diagnose it live and choose a per-call-site fix without regressing any other surface.
- Review: → default — the functional change is a single removed CSP token, already fenced in by a
  unit test, a live header assertion and a violation gate.

## Test Plan (manual acceptance)

1. `npm run build` then `npm run ui:verify` — must exit 0 (no console error, no CSP violation, axe
   clean). This is the primary acceptance; the story adds no new UI surface.
2. Start the built app normally (`npm start`, production/scheme mode) and exercise the surfaces that
   compute styles at runtime, checking each still looks and moves as before:
   - **Downloads / progress**: a progress bar fills (dynamic `width`), including its indeterminate
     animation.
   - **Controls tab → keyboard overview**: the keyboard layout renders at the right size and the
     zoom-on-hover/scale behaviour still works (`OverviewKeyboardPanel`).
   - **Any popover**: the Settings assignments menu, a hover card and a shell menu open at the
     pointer, not at the top-left corner (dynamic `left`/`top`).
   - **Shell chrome**: titlebar, installation rail and action bar keep their heights/widths, and a
     toast appears above the action bar rather than off-screen.
3. Open DevTools' console on that run: no `Refused to apply inline style` message.

## Done

**Summary:** `PRODUCTION_CSP`'s `style-src` no longer carries `'unsafe-inline'` (now
`style-src 'self';`); `DEV_CSP` is untouched. Two regression guards were added: a unit test on
`PRODUCTION_CSP`/`DEV_CSP` in `renderer-source.test.ts`, and a live `ui:verify` guard —
`REQUIRED_CSP_DIRECTIVES` in `scripts/lib/harness.mjs` now requires `style-src 'self';` in the
served header, and a `securitypolicyviolation` listener drains into `RunLog.cspViolations`,
which is wired all the way through `session.mjs`'s `appFailed` into `verify.mjs`'s exit code
(a real CSP violation now fails `npm run ui:verify` with a non-zero exit). A production
`npm run build` + `npm run ui:verify` run confirmed zero visual regression (36/36 screenshots
byte-identical to the pre-change baseline), zero a11y findings, and zero CSP violations.
`docs/ARCHITECTURE.md` gained a "Dynamic styles under the production CSP" paragraph naming the
permitted (React `style` prop / `style.setProperty` CSS custom properties) and forbidden
(`setAttribute('style', …)`, literal `<style>` blocks, `dangerouslySetInnerHTML`-injected CSS)
forms. `docs/UI-VERIFICATION.md` documents the added directive and violation gate.

**Decisions:**
- The `cspViolations`-to-exit-code wiring was not fully closed by the original D3 deliverable —
  violations were collected but never actually failed `npm run ui:verify` (session.mjs/verify.mjs
  never consulted the field). Caught by the first clean-agent review; fixed in a review-fix cycle
  by folding `cspViolations.length > 0` into `session.mjs`'s `appFailed` computation, which already
  flows into `verify.mjs`'s existing `harnessOk`-based exit code — no parallel mechanism added.
  Verified empirically both green (no violations) and red (a temporarily reintroduced parsed
  `style="…"` attribute, fully reverted afterward).
- `scripts/flow.mjs` (the `ui:flow` entry point) still does not consult `log.failures`/
  `cspViolations`, so it cannot fail on a CSP violation even though it collects them the same way
  `ui:verify` does. This is a pre-existing gap outside this story's scope (`ui:verify`, not
  `ui:flow`, is what AC2/AC5 and `live-smoke-how` name) — left undocumented as a fix here, noted
  for a future story.
- `docs/ARCHITECTURE.md` was already failing `prettier --check` at HEAD before this story touched
  it; left as-is rather than reformatting the whole document into an unrelated diff.

**Verification:**
- `npm run build`: green. `npm run typecheck`: green (node + web). `npm test`: 64 files / 1323
  tests green.
- Live smoke (`npm run ui:verify`, production mode, per `live-smoke-how`): exit 0. 36/36
  registry screenshots byte-identical to the pre-change baseline; `.ui-verify/a11y.json` zero
  critical/serious/moderate/minor; `cspViolations` empty. Re-verified after the review-fix cycle.
- Code review: two clean-agent passes. First pass: FAIL (real gap — `cspViolations` collected
  but not gated into the exit code; doc wording claimed behavior that didn't exist yet). Fixed
  in one review-fix cycle. Second pass: PASS — fix traced end-to-end, no false-positive risk in
  the drain/slice logic, no scope creep, no weakened tests, no leftover temporary probe files.
- No open blockers.

**Commit message:** `046: drop 'unsafe-inline' from production style-src, wire CSP-violation gate into ui:verify`
