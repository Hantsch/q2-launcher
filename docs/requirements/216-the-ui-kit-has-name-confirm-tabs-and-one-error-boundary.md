---
id: 216
title: the UI kit has name, confirm, tabs and one error boundary
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As a user I want every "give it a name" dialog, every "are you sure" dialog and every tab strip
in the launcher to behave the same — Enter submits once, focus lands in the field, tabs are
keyboard-navigable. As the maintainer I want those to be primitives in `components/ui`, so that
a UX or accessibility fix is one edit instead of twelve to eighteen.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F18, F74, F68):
`const [submitting, setSubmitting]` appears in 29 renderer files, 12 paired with
`[name, setName]`; `RenameCvarSectionDialog` and `RenameCvarSubsectionDialog` differ only in a
type name and two i18n keys; each copy's comment says "Mirrors RenameCategoryDialog's shape".
Drift: `RenameInstallationDialog` submits on Enter with `name.trim().length > 0` only (double
Enter double-submits) while others gate the button on `canSubmit` but not the key handler. 18 of
45 `Modal` usages are confirm dialogs (title + body + `variant="danger"` footer each). Three
hand-rolled tab strips, `role="tablist"` in zero files; 8 raw `type="radio"` inputs, 7 raw
`<textarea>`. Four error boundaries (`getDerivedStateFromError` in four files), three hand-rolled
copies with differing reset and logging. Three downloads dialogs hand-roll the same
fetch/start/track job state machine while mods dialogs use a different post-start convention.
`Button`/`Modal`/`Menu`/`HoverCard` have no unit tests.

## Acceptance Criteria

- [ ] **AC1** — `components/ui` exports `NameDialog({ titleKey, labelKey, initialName, maxLength,
validate?, onSubmit, onClose, children? })`, `ConfirmDialog({ title, body, confirmLabel,
tone, busy, onConfirm, onClose })`, `Tabs` (roving tabindex, `role="tablist"`/`tab`/
      `tabpanel`, arrow-key navigation), `RadioGroup`/`Radio` and `TextArea`; each has a unit
      test, and `NameDialog` has one `canSubmit` that gates both the button and the Enter key.
- [ ] **AC2** — The 12 name dialogs, the confirm dialogs and the three tab strips are rebuilt on
      the primitives keeping their existing `data-testid`s; `git grep -ln 'const \[submitting, setSubmitting\]' src/renderer`
      returns fewer than 5 files; `role="tablist"` appears only inside `Tabs`.
- [ ] **AC3** — `ErrorBoundary` accepts `fallback`, `onError`, `resetKeys` and `scope`; the three
      module-local boundary classes are deleted.
- [ ] **AC4** — A `useStartJob(starter)` hook and a `JobActionDialog` molecule replace the three
      downloads dialogs' hand-rolled state machines, with their own `jobs.dismiss` key instead of
      borrowing `bootstrapWizard.running.dismiss`; the mods dialogs follow the same post-start
      convention (decision recorded).
- [ ] **AC5** — The design-token checks still pass (no raw colours introduced) and the existing
      a11y report (`ui:a11y`) has no new violations.
- [ ] **AC6** — Every flow that opens a rename/confirm dialog or a tab strip stays green.

## Decisions (Sprint)

- **(User)** Q1: Raw `<button>` sweep out of scope; dialogs, tabs, boundary only.

## Open Questions

- [x] answered → Decisions (Sprint) — **Q1** — Do the raw `<button>` elements (56 in 40 files) get a sweep here, or stay out of
      scope? Recommendation: out of scope; this story is dialogs, tabs, boundary.

## Plan

<!-- Filled by /refine 216. -->

## Deliverables

<!-- Filled by /refine 216. -->

## Model Hints

<!-- Filled by /refine 216. -->

## Acceptance Tests

<!-- Filled by /refine 216. -->

## Done

<!-- Filled by /build 216. -->
