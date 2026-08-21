---
id: 037
title: ui:verify covers every surface and its report is green
status: draft
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

- [ ] A full `npm run ui:verify` run is recorded (not `--screens=…`), and the run summary says
      `run: full`.
- [ ] The write-preview dialog and the import preview are entries in the screen registry, are
      reached by the harness, and are screenshotted and audited like every other screen.
- [ ] Every axe violation the full run reports is either fixed or recorded as a deliberate,
      justified exception in the story's Done section — no violation is left unmentioned.
      `page-has-heading-one` in particular is decided, not ignored.
- [ ] Zero `critical` and zero `serious` violations across all screens and both viewports; the
      run exits 0.
- [ ] Story 027's remaining check is confirmed on the real desktop: during a full run, typing in
      another window is uninterrupted and no app window takes focus. Confirmed → 027 goes to
      `done`.
- [ ] `docs/UI-VERIFICATION.md` matches what the harness now does — screen count, what is and is
      not covered, and how a dialog entry is added.
- [ ] Any surface still out of reach after this story is named in `docs/UI-VERIFICATION.md` as a
      known blind spot, so the next person does not have to rediscover it.

## Open Questions

- Should the exit-code gate be tightened to fail on `moderate` too, once the run is green? That
  makes the gate honest but means every future moderate finding blocks a sprint — a real
  trade-off, not a detail.
- `page-has-heading-one`: does the app get a real (possibly visually-hidden) `h1` per screen, or
  is the rule disabled for a single-window desktop app with no page-document semantics? Either
  answer is defensible; it should be decided once and written down.
- Are the two dialogs reachable from the existing fixtures without new seed data (the populated
  fixture has profiles and an unrecognised import candidate — is that enough to open both), or
  does the fixture need to grow?
- Are there other modal surfaces worth adding in the same pass (the "fix all safe findings"
  warning modal, `KeyBindDialog`, `MessageEditor`), or does this story deliberately stay at the
  two S05 named the gap for?
