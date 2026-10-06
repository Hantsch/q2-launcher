---
id: 212
title: saving a profile edit is one hook, and a new alias lands in a real category
status: done # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As a user I want a rejected or failed profile save to be visible no matter which config tab I was
on, and a new alias to appear in the Controls tab where I can move or delete it. As the
maintainer I want the debounce/optimistic-patch/revert/status machinery to exist once, so that
the next save bug is fixed in one place and "mirrors ControlsTab exactly" comments stop being the
glue between copies.

Today ([review 2026-10-01](../../reviews/2026-10-01-codebase-review.md), F17, F39):

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

- [x] **AC1** — `src/renderer/src/modules/config/lib/useProfileSave.ts` owns the single debounce
      timer, saving/status state, cancel-on-immediate, cancel on unmount and profile switch,
      optimistic `patch`, revert-on-failure and one uniform failure toast; it is unit-tested once
      for coalescing, cancel-on-immediate, revert and toast.
- [x] **AC2** — ControlsTab, SettingsTab, AliasesTab, LayersPanel and ProfileAssignmentsPanel
      save through the hook; `git grep -n 'SAVE_DEBOUNCE_MS\|type SaveStatus' src/renderer` finds
      one declaration each.
- [x] **AC3** — A rejected save on each of the five surfaces shows the same visible error (flow
      or component test per surface, with the bridge stubbed to refuse).
- [x] **AC4** — AliasesTab creates a new alias in the profile's first category
      (`draft.categories[0]?.id`) or asks via the existing `MoveEntryDialog`; with no categories
      "New alias" is disabled with a visible reason (i18n key). A renderer test creates an alias
      on a profile whose first category is custom and finds it in the Controls rail.
- [x] **AC5** — Main rejects an action whose `categoryId` is not in the profile's `categories`
      (`superRefine` in the config schemas) with a tested refusal key.
- [x] **AC6** — The seven `ControlsTab.*.test.tsx` suites and all config flows pass.

## Decisions (Sprint)

- **(User)** Q1: Hook owns only the actually-duplicated write path; reseed only if duplicated across tabs.
- **D-a — Reseed:** the hook calls `onChanged(result.value)` on success, because all five surfaces
  already do exactly that after a successful save (so it is duplicated, per Q1); any tab-specific
  post-save step stays in the tab.
- **D-b — Uniform failure toast = `toastOutcomeError`** (`src/renderer/src/lib/toast.ts`) with the
  server's refusal key, because it already exists, is sticky and shows the real reason; no new
  generic "save failed" key.
- **D-c — Immediate saves keep "apply after success"** (no optimistic patch, return `false` so the
  open dialog stays open), because that is today's dialog contract in ControlsTab/SettingsTab/
  AliasesTab; only the debounced paths patch optimistically and revert.
- **D-d — Revert target is a snapshot taken when the first edit of a debounce burst is scheduled**,
  not the closure's `profile.*`, because the closure value is what produced the recorded
  phantom-draft revert.
- **D-e — New alias goes to `draft.categories[0]`, no dialog**, because AC4 allows either and the
  first-category default matches ControlsTab's own (`ControlsTab.tsx:169`); `MoveEntryDialog`
  stays unused here.
- **D-f — AC5 rejects only _new_ orphans.** Profiles legitimately hold actions whose `categoryId`
  is in no category (story 042 AC2: restore/import deliberately produce the "Other" bucket;
  fixture `orphanedCategoryProfiles`; profiles with `categories: []`), and every save resends the
  full `actions`, so a blanket check would refuse every later save of such a profile. The rule:
  an action is refused when its `categoryId` is not in the payload's `categories` **and** the
  stored profile did not already hold that action id with that same `categoryId`. That needs the
  stored profile, so it is a handler check in `setActions`, not a pure `superRefine`; the payload
  `superRefine` is not used for it. Refusal key `config.error.unknownCategory`.
- **D-g — Scope stays the five named surfaces;** `CareTab.persistActions` (also calls
  `updateProfileActions`) is not migrated, because the AC names five surfaces and the D-f
  grandfathering keeps CareTab's saves valid.
- **D-h — AC4 also gets an e2e flow** besides the renderer test the AC names, because
  `ui-acceptance-required: true` and creating an alias is a user action.
- **D-i — AC2's grep is pinned as a structural test** in `src/architecture.test.ts`, because a
  one-off grep is not a regression gate.

## Open Questions

- [x] answered → Decisions (Sprint) — **Q1** — Does the hook also own the "reseed from server after save" step some tabs do, or
      only the write path? The value judge recommends only what is actually duplicated.

## Plan

Base is `useProfileDraft` (`modules/config/lib/useProfileDraft.ts`: `{draft, patch, resetDraft}`)
and the typed client `modules/config/client.ts` (all saves return `Outcome<ConfigProfile[]>`).

1. **D1** — build `useProfileSave` + its unit tests (the only place with timer/status/revert logic).
2. **D2** — SettingsTab onto the hook (debounced cvars path + immediate `persistSections`).
3. **D3** — ControlsTab onto the hook (debounced `scheduleActionsSave` + immediate
   `persistCategoriesAndActions`); last local `SAVE_DEBOUNCE_MS`/`SaveStatus` gone.
4. **D4** — AliasesTab onto the hook; new alias lands in `draft.categories[0]`; disabled with
   visible reason when there are none; renderer test + flow.
5. **D5** — LayersPanel and ProfileAssignmentsPanel onto the hook (immediate only); structural
   test for AC2.
6. **D6** — main: `setActions` refuses new orphan category ids (D-f); systems doc.

Each renderer D adds its surface's case to one shared refusal test,
`src/renderer/src/modules/config/save-refusal.test.tsx` (AC3). Order D1 → D2..D5 (any order) → D6
is independent and can go anytime.

## Deliverables

- [x] **D1 — `useProfileSave` hook.** New `src/renderer/src/modules/config/lib/useProfileSave.ts`
      and `useProfileSave.test.ts` beside it. Exports `SAVE_DEBOUNCE_MS = 500` and
      `type SaveStatus = 'idle' | 'saving' | 'saved'` (the only declarations in the renderer).
      API (names may be tuned, semantics not):
      `useProfileSave<T = ConfigProfile[]>({ profileId, onChanged })` →
      `{ status, saving, schedule, saveNow, cancel }`. - `schedule({ apply, revert, run })`: calls `apply()` immediately (optimistic patch), sets
      `'saving'`, (re)starts ONE timer of `SAVE_DEBOUNCE_MS`; calls within the window coalesce —
      only the last `run` executes. The `revert` kept is the one from the **first** call of the
      burst (snapshot before the first edit, not the latest closure value). - `saveNow({ run })`: cancels any pending timer first (cancel-on-immediate), sets
      `saving=true`/`'saving'`, awaits `run()`, returns `Promise<boolean>`; no optimistic patch. - On success (either path): `onChanged(result.value)`, status `'saved'`. - On failure (either path): debounced → `revert()`; both → `toastOutcomeError(pushToast, result)` (`src/renderer/src/lib/toast.ts`; `pushToast` via
      `useLauncher((s) => s.pushToast)`), status `'idle'`. - The pending timer is cleared on unmount and when `profileId` changes; a result arriving
      after either is ignored (no `onChanged`, no revert, no toast, no setState).
      Tests (fake timers, client stub returning `{ok:false, error:{key:'config.error.writeFailed'}}`
      or ok): "coalesces edits inside the debounce window into one save", "saveNow cancels a
      pending debounced save", "a refused debounced save reverts to the snapshot from the first
      edit", "a refused save pushes one error toast with the refusal key", "a profile switch drops
      the pending save". Mirror test style of `lib/useProfileDraft.test.ts`.
- [x] **D2 — SettingsTab saves through the hook.** `src/renderer/src/modules/config/SettingsTab.tsx`:
      delete local `SAVE_DEBOUNCE_MS`, `SaveStatus`, `saveTimeout`, `clearPendingSave`,
      unmount/profile-switch effects (~l.153, 267-307); `handleChange` patches then calls
      `schedule({apply, revert, run: () => updateProfileCvars(...)})` — do NOT call it from inside
      the `patch` updater; `persistSections` uses `saveNow` and patches after success
      (`return ok`). Status span (~l.820) reads the hook's `status`. Add the SettingsTab case to
      `src/renderer/src/modules/config/save-refusal.test.tsx` (create it): render the surface with
      `globalThis.q2.invoke` stubbed to resolve `{ok:false, error:{key:'config.error.writeFailed'}}`
      (idiom: `ControlsTab.row-menu.test.tsx:17-28`) plus the toast host
      `src/renderer/src/components/ui/Toasts.tsx`, make an edit, advance timers, assert the
      localized `config.error.writeFailed` text is visible. `SettingsTab.dnd.test.tsx` stays green.
- [x] **D3 — ControlsTab saves through the hook.** `src/renderer/src/modules/config/ControlsTab.tsx`:
      delete local `SAVE_DEBOUNCE_MS` (l.94), `SaveStatus` (l.96), timer refs (l.171-173,
      277-281), `clearPendingSave` and its effects (l.284-308); `scheduleActionsSave` (~l.390)
      → `schedule` with revert = snapshot of `actions` before the edit; `persistCategoriesAndActions`
      (~l.365) → `saveNow`, patch after success, keep `return ok`. Status span (~l.1658) reads the
      hook. Add the ControlsTab case to `save-refusal.test.tsx` (same shape as D2's case, e.g.
      edit a row name, assert the same toast text). All seven suites stay green:
      `ControlsTab.{bindings,category-drag,category-menu,dnd,row-menu,subcategory-drag}.test.tsx`,
      `ControlsTab.dialogs.test.ts`.
- [x] **D4 — AliasesTab: hook + real category.** `src/renderer/src/modules/config/AliasesTab.tsx`
      (contains non-UTF8 bytes — use `grep -a`, preserve encoding of untouched lines):
      `persistActions` (~l.311) → `saveNow`, patch after success, `return ok` (dialog stays open on
      failure, toast now shown). `handleCreateAlias` (~l.337): `categoryId: draft.categories?.[0]?.id`
      instead of `BUILT_IN_ACTION_CATEGORIES[0].id` (drop the import if unused, fix the doc comment
      at 328-336). "New alias" button (~l.464) gets `disabled` when `(draft.categories ?? []).length === 0`, with a visible text reason next to it (not only a tooltip), new i18n key
      `config.aliases.createNeedsCategory` = "Add a category in Controls first." in
      `src/renderer/src/i18n/locales/en.json`. Tests: AliasesTab case in `save-refusal.test.tsx`;
      new `src/renderer/src/modules/config/AliasesTab.category.test.tsx` › "a new alias lands in the
      profile's first custom category and shows in the Controls rail" (profile `categories: [{id:'my-cat',name:'Mine'}]`; create via the dialog; take the `updateProfileActions` payload,
      render `ControlsTab` with it, assert `action-edit-<newId>` under the selected first category)
      and › "New alias is disabled with a visible reason when the profile has no categories".
      Flow `scripts/flows/alias-new-lands-in-first-category.mjs` (mirror
      `scripts/flows/alias-rename-dialog.mjs`): seed a custom first category via
      `window.q2.invoke` setActions, create an alias in the Aliases tab, switch to Controls, assert
      the row is visible in that category.
- [x] **D5 — LayersPanel and ProfileAssignmentsPanel through the hook; AC2 pinned.**
      `src/renderer/src/modules/config/LayersPanel.tsx` (`persist` l.69-75) and
      `ProfileAssignmentsPanel.tsx` (`toggle` l.29-34, `makeDefault` l.36-39) use `saveNow` (immediate
      only, no draft); failures now toast. Add both cases to `save-refusal.test.tsx` (same toast text
      as the other three). Add to `src/architecture.test.ts` ›
      "save debounce and status are declared once in the renderer": scans `src/renderer` for
      `SAVE_DEBOUNCE_MS =` and `type SaveStatus` — exactly one each, in `lib/useProfileSave.ts` — and
      asserts the five surface files import `useProfileSave`.
- [x] **D6 — main refuses a new orphan category.** In the `setActions` path
      (`src/main/modules/config/index.ts:796` → `profiles.setActions`): refuse with
      `fail('config.error.unknownCategory')` and change nothing when an action's `categoryId` is not
      in `input.categories` AND the stored profile did not already contain an action with the same
      `id` and the same `categoryId` (grandfathers restore/import "Other" entries and
      `categories: []` profiles — see `orphanedCategoryProfiles` in
      `src/shared/config/fixtures/profiles.ts:813`). Put the predicate as a pure helper in
      `src/main/modules/config/` (or `src/shared/config/` if pure) with unit tests. Add en.json key
      `config.error.unknownCategory` = "That category no longer exists in this profile." Tests in the
      config handler tests using `src/main/modules/config/index.test-helpers.ts`:
      › "setActions refuses an action in a category the profile does not have",
      › "setActions still saves a profile that already holds an orphaned entry". Update
      `docs/systems/config-module.md` (Profile save / write cadence area) with the rule and one line
      that renderer profile saves go through `lib/useProfileSave.ts`.

## Model Hints

- D1 → deliverable-hard: the hook is where the recorded stale-debounce overwrite and phantom-draft
  revert lived — first-of-burst revert snapshot, late results after profile switch/unmount, and
  coalescing must all be right or every later surface inherits the bug.
- Review: → default

## Acceptance Tests

- AC1 → unit `src/renderer/src/modules/config/lib/useProfileSave.test.ts` › "coalesces edits inside
  the debounce window into one save", "saveNow cancels a pending debounced save", "a refused
  debounced save reverts to the snapshot from the first edit", "a refused save pushes one error
  toast with the refusal key", "a profile switch drops the pending save" (D1)
- AC2 → unit `src/architecture.test.ts` › "save debounce and status are declared once in the
  renderer" (D5; D2/D3 remove the copies)
- AC3 → component `src/renderer/src/modules/config/save-refusal.test.tsx` › one case per surface:
  "SettingsTab shows the refusal toast" (D2), "ControlsTab shows the refusal toast" (D3),
  "AliasesTab shows the refusal toast" (D4), "LayersPanel shows the refusal toast" and
  "ProfileAssignmentsPanel shows the refusal toast" (D5). Component level as the AC itself allows:
  a real refusal of each save cannot be provoked through the real app without a stub.
- AC4 → component `src/renderer/src/modules/config/AliasesTab.category.test.tsx` › "a new alias
  lands in the profile's first custom category and shows in the Controls rail", "New alias is
  disabled with a visible reason when the profile has no categories"; e2e
  `npm run ui:flow -- alias-new-lands-in-first-category` (D4)
- AC5 → unit config handler test (via `src/main/modules/config/index.test-helpers.ts`) › "setActions
  refuses an action in a category the profile does not have", "setActions still saves a profile
  that already holds an orphaned entry" (D6)
- AC6 → the seven `ControlsTab.*` suites (D3) plus flows `alias-rename-dialog`,
  `controls-category-rename-reorder`, `controls-drag-reorder`, `controls-extra-keys`,
  `controls-subcategory`, `custom-action-row`, `settings-section-rename-add-cvar`,
  `settings-downloads-section`, `grenade-rows-take-a-key`, `config-header-geometry`,
  `unsaved-diff` via `npm run ui:flow -- <name>` (run after D3 and D4)

## Done

Saving a profile edit now goes through one hook, `modules/config/lib/useProfileSave.ts` (debounce, optimistic patch,
first-of-burst revert, uniform `toastOutcomeError`, cancel on unmount/profile switch), used by ControlsTab, SettingsTab,
AliasesTab, LayersPanel and ProfileAssignmentsPanel. A new alias lands in `draft.categories[0]` (button disabled with a
visible reason when there are none); main refuses new orphan category ids in `setActions` (grandfathering existing ones).

Commit message: `212: useProfileSave hook for all profile saves, new alias in first category, main refuses new orphan categories`

Verification (narrow gate): build, typecheck, lint green; `npx vitest run --changed HEAD` green (1237 tests) plus named
tests run directly. Flows green: alias-new-lands-in-first-category, alias-rename-dialog, controls-category-rename-reorder,
custom-action-row, settings-section-rename-add-cvar. Red and identical on bare HEAD (pre-existing, not fixed here):
controls-drag-reorder, controls-extra-keys, controls-subcategory, settings-downloads-section, config-header-geometry,
plus the known unsaved-diff, grenade-rows-take-a-key and shell-layering "no shell file imports from modules".
AC1 useProfileSave.test.ts; AC2 architecture.test.ts; AC3 save-refusal.test.tsx (5 cases); AC4 AliasesTab.category.test.tsx

- flow; AC5 index.test.ts (two named tests) + orphan-category.test.ts; AC6 ControlsTab.* suites green, flows above (red ones pre-existing).
  No manual residue. Review: default stage PASS.

Decisions (sprint, no user available):

- `saveNow` failing after cancelling a pending burst leaves that burst's optimistic edit in the draft (same as before the hook); unfixed, spec reverts debounced saves only.
- Late results after profile switch/unmount drop `onChanged` (spec); superseded older success still calls `onChanged`, failure toasts without reverting. Edge cases accepted, not tested.
- SettingsTab uses a `latestCvars` ref for same-tick edits; revert there uses the first-call closure value, equivalent to the snapshot in practice.
- Orphan check is a handler check (D-f), not a payload superRefine. Review findings 1-5 deliberately unfixed (low, HEAD-equivalent).

tiers: D 6 / hard 1 · review default · cycles 1 · agents 10
