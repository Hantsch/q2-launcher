---
id: 212
title: saving a profile edit is one hook, and a new alias lands in a real category
status: draft # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As a user I want a rejected or failed profile save to be visible no matter which config tab I was
on, and a new alias to appear in the Controls tab where I can move or delete it. As the
maintainer I want the debounce/optimistic-patch/revert/status machinery to exist once, so that
the next save bug is fixed in one place and "mirrors ControlsTab exactly" comments stop being the
glue between copies.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F17, F39):

- `SAVE_DEBOUNCE_MS = 500` and `type SaveStatus` are declared twice verbatim;
  `saveTimeout`/`clearPendingSave`/`setStatus('saving')` appear 18x in `ControlsTab.tsx` and 17x
  in `SettingsTab.tsx`; 28 IPC save call sites across 21 TSX files. Failure handling differs per
  copy: SettingsTab toasts; ControlsTab's `else` branches only `setStatus('idle')`; AliasesTab
  returns `false` and leaves the dialog open; LayersPanel and ProfileAssignmentsPanel drop the
  error. Review notes record a stale-debounce overwrite and a phantom-draft revert that had to be
  fixed per copy.
- `AliasesTab.handleCreateAlias` hardcodes `categoryId: BUILT_IN_ACTION_CATEGORIES[0].id`
  ("movement") citing ControlsTab's default, which has since become
  `(profile.categories ?? [])[0]?.id ?? ''` (story 052: no category is special). The payload
  schema requires only `categoryId: z.string().min(1)` and no handler checks existence. On a
  profile without a `movement` category the alias is saved, visible in Aliases, and cannot be
  found, moved or deleted in Controls — a persisted orphan.

## Acceptance Criteria

- [ ] **AC1** — `src/renderer/src/modules/config/lib/useProfileSave.ts` owns the single debounce
      timer, saving/status state, cancel-on-immediate, cancel on unmount and profile switch,
      optimistic `patch`, revert-on-failure and one uniform failure toast; it is unit-tested once
      for coalescing, cancel-on-immediate, revert and toast.
- [ ] **AC2** — ControlsTab, SettingsTab, AliasesTab, LayersPanel and ProfileAssignmentsPanel
      save through the hook; `git grep -n 'SAVE_DEBOUNCE_MS\|type SaveStatus' src/renderer` finds
      one declaration each.
- [ ] **AC3** — A rejected save on each of the five surfaces shows the same visible error (flow
      or component test per surface, with the bridge stubbed to refuse).
- [ ] **AC4** — AliasesTab creates a new alias in the profile's first category
      (`draft.categories[0]?.id`) or asks via the existing `MoveEntryDialog`; with no categories
      "New alias" is disabled with a visible reason (i18n key). A renderer test creates an alias
      on a profile whose first category is custom and finds it in the Controls rail.
- [ ] **AC5** — Main rejects an action whose `categoryId` is not in the profile's `categories`
      (`superRefine` in the config schemas) with a tested refusal key.
- [ ] **AC6** — The seven `ControlsTab.*.test.tsx` suites and all config flows pass.

## Decisions (Sprint)

- **(User)** Q1: Hook owns only the actually-duplicated write path; reseed only if duplicated across tabs.

## Open Questions

- [x] answered → Decisions (Sprint) — **Q1** — Does the hook also own the "reseed from server after save" step some tabs do, or
      only the write path? The value judge recommends only what is actually duplicated.

## Plan

<!-- Filled by /refine 212. -->

## Deliverables

<!-- Filled by /refine 212. -->

## Model Hints

<!-- Filled by /refine 212. -->

## Acceptance Tests

<!-- Filled by /refine 212. -->

## Done

<!-- Filled by /build 212. -->
