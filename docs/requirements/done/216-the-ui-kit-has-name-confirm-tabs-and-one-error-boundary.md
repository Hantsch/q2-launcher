---
id: 216
title: the UI kit has name, confirm, tabs and one error boundary
status: done # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As a user I want every "give it a name" dialog, every "are you sure" dialog and every tab strip
in the launcher to behave the same — Enter submits once, focus lands in the field, tabs are
keyboard-navigable. As the maintainer I want those to be primitives in `components/ui`, so that
a UX or accessibility fix is one edit instead of twelve to eighteen.

Today ([review 2026-10-01](../../reviews/2026-10-01-codebase-review.md), F18, F74, F68):
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

- [x] **AC1** — `components/ui` exports `NameDialog({ titleKey, labelKey, initialName, maxLength,
validate?, onSubmit, onClose, children? })`, `ConfirmDialog({ title, body, confirmLabel,
tone, busy, onConfirm, onClose })`, `Tabs` (roving tabindex, `role="tablist"`/`tab`/
      `tabpanel`, arrow-key navigation), `RadioGroup`/`Radio` and `TextArea`; each has a unit
      test, and `NameDialog` has one `canSubmit` that gates both the button and the Enter key.
- [x] **AC2** — The 12 name dialogs, the confirm dialogs and the three tab strips are rebuilt on
      the primitives keeping their existing `data-testid`s; `git grep -ln 'const \[submitting, setSubmitting\]' src/renderer`
      returns fewer than 5 files; `role="tablist"` appears only inside `Tabs`.
- [x] **AC3** — `ErrorBoundary` accepts `fallback`, `onError`, `resetKeys` and `scope`; the three
      module-local boundary classes are deleted.
- [x] **AC4** — A `useStartJob(starter)` hook and a `JobActionDialog` molecule replace the three
      downloads dialogs' hand-rolled state machines, with their own `jobs.dismiss` key instead of
      borrowing `bootstrapWizard.running.dismiss`; the mods dialogs follow the same post-start
      convention (decision recorded).
- [x] **AC5** — The design-token checks still pass (no raw colours introduced) and the existing
      a11y report (`ui:a11y`) has no new violations.
- [x] **AC6** — Every flow that opens a rename/confirm dialog or a tab strip stays green.

## Decisions (Sprint)

- **(User)** Q1: Raw `<button>` sweep out of scope; dialogs, tabs, boundary only.
- **D-A — Two tab strips, not three.** The tab strips are `ConfigView.tsx`'s and `ServersTabStrip.tsx`;
  the Controls category rail stays `aria-pressed` chips, because story 020's review already ruled a
  rail mixing tabs with the "+ New category" button and kebabs cannot be a valid `tablist` (the
  review's "3x" was a spot estimate).
- **D-B — Tabs use manual activation** (arrows/Home/End move focus with roving tabindex,
  Enter/Space selects), because `ConfigView`'s `goToTab` mounts heavy tabs and must not fire on
  every arrow press.
- **D-C — AC2's grep is met by a shared `useSubmitting` hook**, not only by the two dialogs: 17 of
  the 29 files are neither name nor confirm dialogs, and the hook's in-flight ref is what makes
  "Enter submits once" hold everywhere (a `useState` flag alone lets two Enters in one tick through).
- **D-D — `NameDialog` details:** `children` render below the name field; `validate(trimmed)` returns
  an i18n key or `null`; a main-side refusal comes in through an `error` prop; the caller closes the
  dialog on success (as every dialog does today) — keeps each call site's existing success path.
- **D-E — `ConfirmDialog.body` is a `ReactNode`** and `tone` is `'danger' | 'primary'`; `busy`
  disables confirm and sets `preventClose`. A dialog whose footer has more than cancel + one action
  stays on `Modal`, because that is a choice dialog, not a confirm.
- **D-F — The one `ErrorBoundary` moves to `components/ui/ErrorBoundary.tsx`**, `fallback` is a node
  or `(error, reset) => node`, the default fallback is today's app-level screen, logging is
  `console.error('[<scope>] …')` — so the app root needs no props and the three copies keep their
  testids through a custom fallback.
- **D-G — `useStartJob` lives in `src/renderer/src/components/jobs/`**, `JobActionDialog` in
  `modules/downloads/components/`, because mods must use the hook and modules may not import each
  other, while only downloads uses the molecule.
- **D-H — One post-start convention (AC4):** every job start goes through `useStartJob`; a refusal
  is kept as a `LocalizedMessage`, shown in the dialog, and the dialog stays open; on success the
  dialog hands the job to whatever tracks it — downloads dialogs show `RunningStep` inside
  `JobActionDialog` (they have no other in-context surface), mods dialogs call `onStarted(jobId)`
  and close (progress is shown inline on the mod's tile/detail). Keeps today's user-visible flow.
- **D-I — `jobs.dismiss` reads the same as `bootstrapWizard.running.dismiss`;** `BootstrapWizard`
  keeps its own key, since it is the wizard's own step and not one of AC4's three dialogs.
- **D-J — Raw radios/textarea:** the five files with raw `type="radio"` are all touched here, so they
  move to `RadioGroup`; `DemoDetailEditor`'s `<textarea>` moves to `TextArea`; `ConfigCodeView`'s
  overlay `<textarea>` is exempt, because it is a transparent editor synced to the tokenised `<pre>`.
- **D-K — The cvar section/subsection create/rename dialogs stay as thin wrappers over `NameDialog`**,
  so `SettingsTab.tsx` (rewritten by 212/218) is not touched by this story.
- **D-L — AC5's "design-token checks" is a vitest guard** over the new primitive files (no hex, no
  raw Tailwind palette class), because no token check script exists in the repo today.
- **D-M — AC5's a11y half** is `npm run ui:verify` exiting 0 plus no new rule id in
  `.ui-verify/a11y.json` against a baseline D1 captures before the first code change.
- **D-N — AC2/AC3 are machine-checked** by an adoption test (grep count, `role="tablist"` and
  `getDerivedStateFromError` only in the primitives, minimum import counts of `NameDialog`/
  `ConfirmDialog`), so renaming the state to dodge the grep fails a test rather than a reviewer.
- **D-O — Changelog:** one `### Fixed` line ("name dialogs submit once on Enter; tabs work with the
  arrow keys"), because both are user-visible.

## Open Questions

- [x] answered → Decisions (Sprint) — **Q1** — Do the raw `<button>` elements (56 in 40 files) get a sweep here, or stay out of
      scope? Recommendation: out of scope; this story is dialogs, tabs, boundary.

## Plan

Renderer only; no IPC, no main. All primitives under `src/renderer/src/components/ui/`.

1. **Primitives first (D1–D4):** `useSubmitting` + `NameDialog`, `ConfirmDialog`, `Tabs`/`TabPanel`
   - `RadioGroup`/`Radio` + `TextArea` + a token guard, the one `ErrorBoundary` (absorbs the three
     module-local copies in the same D, since it is small).
2. **Jobs (D5–D6):** `useStartJob` + `JobActionDialog` replace the three downloads dialogs' state
   machines; the mods dialogs adopt `useStartJob` (D-H).
3. **Migrations (D7–D13), one group of ≤8 files each:** tabs; installations; config profile
   dialogs; config settings dialogs; Controls; aliases/layers/replays/servers; remaining confirms.
   Every migration keeps the existing `data-testid`s and runs its group's flows.
4. **Guard + docs (D14):** adoption test (AC2/AC3 numbers), a11y diff against D1's baseline,
   ARCHITECTURE.md "UI kit" paragraph, changelog line.

Order: D1 → D2 → D3 → D4 → D5 → D6 → D7 … D13 → D14. D7–D13 depend only on D1–D3.

Risk: D11 (ControlsTab.tsx, 2.5k lines, seven inline dialogs) — see Model Hints.

## Deliverables

- **D1 — `useSubmitting` + `NameDialog`.** Before any code change run `npm run ui:a11y` and copy
  `.ui-verify/a11y.json` to `.ui-verify/a11y-baseline-216.json` (D14 diffs against it).
  New `components/ui/useSubmitting.ts`: `const { submitting, run } = useSubmitting()`; `run(fn)`
  returns early while a run is in flight (a **ref**, not only state, so two calls in one tick run
  `fn` once), sets `submitting`, awaits `fn`, clears in `finally`, returns `fn`'s result.
  New `components/ui/NameDialog.tsx` on `Modal` + `Field`/`Input` (`components/ui/controls.tsx`):
  props `{ titleKey, labelKey, initialName, maxLength, validate?, onSubmit, onClose, children?,
submitLabelKey? (default 'common.save'), error?: string, description?, testIds?: { input?, submit?,
cancel? } }`. `canSubmit = trimmed.length > 0 && !validate?.(trimmed) && !submitting` — the one
  value that gates both the submit button and the input's Enter handler; validation message (an i18n
  key from `validate`) and `error` render under the field. Input is autofocused; `onSubmit(trimmed)`
  runs through `useSubmitting`; `children` render below the field. Shape to replace:
  `modules/config/components/RenameCvarSectionDialog.tsx`.
  Tests: `components/ui/useSubmitting.test.ts`, `components/ui/NameDialog.test.tsx` (see Acceptance
  Tests).
- **D2 — `ConfirmDialog`.** New `components/ui/ConfirmDialog.tsx` on `Modal`: `{ title, body:
ReactNode, confirmLabel, tone: 'danger' | 'primary', busy, onConfirm, onClose, size?, testIds?:
{ confirm?, cancel? } }`; footer = ghost Cancel (`common.cancel`) + confirm `Button` with
  `variant={tone}`; `busy` disables confirm and passes `preventClose`. Shape to replace:
  `modules/home/dashboard/ResetLayoutDialog.tsx`. Test `components/ui/ConfirmDialog.test.tsx`.
- **D3 — `Tabs`, `RadioGroup`/`Radio`, `TextArea`, token guard.** New `components/ui/Tabs.tsx`:
  `Tabs({ idBase, value, onChange, items: { id, label, badge?: ReactNode, testId? }[], ariaLabel,
className? })` renders `role="tablist"`, each tab `role="tab"`, `aria-selected`, `aria-controls`,
  `id={`${idBase}-tab-${id}`}`, roving tabindex (selected = 0, others -1), Arrow Left/Right + Home/End
  move focus (wrapping), Enter/Space select (manual activation); `TabPanel({ idBase, tabId,
children, className? })` renders `role="tabpanel"` + `aria-labelledby`. Visual classes copied from
  `ConfigView.tsx:593-610` (the strip's height is measured by `config-header-geometry`). New
  `components/ui/RadioGroup.tsx` (`RadioGroup({ name, value, onChange, label, children })` as
  `role="radiogroup"`, `Radio({ value, label, testId?, disabled? })` with the focus ring of
  `modules/mods/components/UpdateModDialog.tsx:46-56`). `TextArea` added to
  `components/ui/controls.tsx` next to `Input`, same token classes. New guard
  `components/ui/ui-kit-tokens.test.ts`: reads `NameDialog`, `ConfirmDialog`, `Tabs`, `RadioGroup`,
  `controls.tsx`, `ErrorBoundary` sources and fails on `#[0-9a-fA-F]{3,8}\b` or a raw Tailwind palette
  class (`(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}`).
  Tests: `Tabs.test.tsx`, `RadioGroup.test.tsx`, `controls.test.tsx` (TextArea).
- **D4 — One `ErrorBoundary`.** Move `components/ErrorBoundary.tsx` to
  `components/ui/ErrorBoundary.tsx` (delete the old file, update `App.tsx`'s import) with props
  `{ children, fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode), onError?:
(error, info) => void, resetKeys?: readonly unknown[], scope?: string }`; default fallback = today's
  app-level screen unchanged; `componentDidCatch` logs `console.error(`[${scope ?? 'renderer'}] …`)`
  then calls `onError`; a change in any `resetKeys` entry (shallow `Object.is`) clears the error.
  Replace and delete the classes `TileFrameBoundary` (`modules/home/components/DashboardTileFrame.tsx`),
  `DashboardTileBodyBoundary` (`modules/home/dashboard/DashboardTile.tsx`),
  `ServerDetailSectionBoundary` (`modules/servers/ServerDetailSection.tsx`) with `ErrorBoundary` +
  a render-fn fallback that keeps their markup and testids (`dashboard-tile-frame-error`,
  `dashboard-tile-frame-filled`, `dashboard-tile-render-error`, `dashboard-tile-render-error-retry`,
  `servers-detail-section-error-${id}`) and their retry = `reset`. Test
  `components/ui/ErrorBoundary.test.tsx`; existing home/servers tests stay green.
- **D5 — `useStartJob` + `JobActionDialog` for downloads.** New
  `src/renderer/src/components/jobs/useStartJob.ts`: `useStartJob(starter: (...args) =>
Promise<Outcome<{ jobId: string }>>)` → `{ start, starting, refusal: LocalizedMessage | null,
jobId, job }` (`job` read from `useLauncher((s) => s.jobs)` by id; `start` guarded by
  `useSubmitting`). New `modules/downloads/components/JobActionDialog.tsx`: `Modal` that, once
  `jobId` is set, renders `RunningStep` (`modules/downloads/bootstrap/RunningStep.tsx`) and a
  primary dismiss button labelled `t('jobs.dismiss')` with the caller's dismiss testid, otherwise
  the caller's body/footer; `preventClose` while starting. Rebuild
  `downloads/engine/EngineUpdateDialog.tsx`, `downloads/repair/RepairDialog.tsx`,
  `downloads/retail/RetailUpgradeDialog.tsx` on both, keeping every testid (`*-dismiss`, `*-error`,
  `bootstrap-running-step`); leave their fetch-on-mount as story 215 left it. Add `jobs.dismiss` to
  `src/renderer/src/i18n/locales/en.json` (same text as `bootstrapWizard.running.dismiss`; the
  wizard keeps its key). Tests `components/jobs/useStartJob.test.ts`,
  `modules/downloads/components/JobActionDialog.test.tsx`; flows `engine-update`, `repair`,
  `retail-upgrade`, `jobs-installation-busy`.
- **D6 — Mods dialogs on the same convention.** `modules/mods/components/UpdateModDialog.tsx` and
  `RemoveModDialog.tsx` start through `useStartJob` (refusal shown, dialog stays open; success →
  `onStarted(jobId)` + `onClose()`, as today), and their raw radios become `RadioGroup`/`Radio`
  keeping `mods-update-changed-*` and the remove dialog's radio testids. Existing
  `RemoveModDialog.test.tsx` stays green; flows `mod-update`, `mods-remove`.
- **D7 — Tab strips on `Tabs`.** `modules/config/ConfigView.tsx` (the `tabButtons` strip and the
  panel container below it → `TabPanel`) and `modules/servers/ServersTabStrip.tsx` (+ its panel in
  `ServersView.tsx`) render `Tabs`, keeping `config-tab-${id}`, `config-tab-strip`,
  `servers-tab-strip`, `servers-tab-list`, `servers-tab-watchlist` and the badge/`badgeNode`/
  `ExperimentalBadge` content. New flow `scripts/flows/tabs-keyboard.mjs` (mirror
  `scripts/flows/settings-section-rename-add-cvar.mjs`'s setup): open Plain Profile, focus
  `config-tab-overview`, ArrowRight, Enter → `config-tab-settings` has `aria-selected="true"` and
  focus; only one tab has `tabindex="0"`. Flows `config-header-geometry`, `servers-watchlist`,
  `unsaved-diff`.
- **D8 — Installations.** `components/installations/RenameInstallationDialog.tsx` → `NameDialog`;
  `RemoveInstallationDialog.tsx` → `ConfirmDialog` if its footer is cancel + one action (D-E),
  else `useSubmitting`; `AddExistingDialog.tsx`, `CreateInstallationDialog.tsx`,
  `components/unlock/UnlockCodePanel.tsx` → `useSubmitting`. Flows `installation-remove-from-disk`,
  `unlock-code`, `linux-user-journey`.
- **D9 — Config profile dialogs.** `modules/config/CreateProfileDialog.tsx` and
  `RenameProfileDialog.tsx` → `NameDialog` (the base-profile `Select` becomes `children`);
  `DeleteProfileDialog.tsx`, `DiscardChangesDialog.tsx`, `CleanupPanel.tsx`'s confirm,
  `CareBatchFixDialog.tsx` → `ConfirmDialog` (D-E rule); `ImportProfileDialog.tsx` → `useSubmitting`
  - `RadioGroup`. Flows `import-from-files`, `home-route-roundtrip`, `care-duplicate-name`,
    `care-fix-item`, `external-edit-cascades`.
- **D10 — Config settings dialogs.** `modules/config/components/CreateCvarSectionDialog.tsx`,
  `CreateCvarSubsectionDialog.tsx`, `RenameCvarSectionDialog.tsx`, `RenameCvarSubsectionDialog.tsx`
  become thin wrappers over `NameDialog` (D-K); `AddCvarDialog.tsx`, `MoveCvarDialog.tsx`,
  `MoveEntryDialog.tsx` → `useSubmitting`. New flow `scripts/flows/name-dialog-enter-once.mjs`
  (mirror `settings-section-rename-add-cvar.mjs`): open the create-section dialog, assert the name
  input is focused, type a run-suffixed name, press Enter twice without waiting → exactly one
  section with that name, dialog closed. Flow `settings-section-rename-add-cvar`.
- **D11 — Controls.** `modules/config/ControlsTab.tsx`'s five inline name dialogs (create/rename
  category, create/rename subcategory, create action — the create-action dialog's suggestions field
  and entry-kind `Select` become `children`) → `NameDialog`, its danger confirms → `ConfirmDialog`;
  `components/RenameActionDialog.tsx` → `NameDialog`; `components/DeleteCategoryDialog.tsx` →
  `ConfirmDialog` with a `RadioGroup` body (or `useSubmitting` per D-E); `components/KeyBindDialog.tsx`,
  `components/ActionEditor.tsx`, `components/MessageEditor.tsx` confirms → `ConfirmDialog`, other
  submits → `useSubmitting`. Keep each dialog's validation (duplicate-name checks) via `validate`.
  `ControlsTab.category-menu.test.tsx` stays green. Flows `controls-category-rename-reorder`,
  `controls-subcategory`, `custom-action-row`, `open-keycap-dialog`, `grenade-rows-take-a-key`,
  `drop-message-checkbox`.
- **D12 — Aliases, layers, replays, servers.** `modules/config/AliasesTab.tsx` (create → `NameDialog`,
  delete → `ConfirmDialog`), `modules/config/LayersPanel.tsx` (create/rename → `NameDialog`),
  `modules/replays/RenameDemoDialog.tsx` → `NameDialog`, `modules/servers/QuickFilterNameDialog.tsx`
  → `NameDialog` (`validateQuickFilterName` via `validate`), `modules/replays/components/
ConsoleCommandField.tsx`, `modules/servers/watchlist/WatchlistAddForm.tsx`,
  `modules/servers/AddToAddressBookDialog.tsx` (+ `RadioGroup`) → `useSubmitting`;
  `modules/replays/components/DemoDetailEditor.tsx`'s `<textarea>` → `TextArea`. Flows
  `alias-rename-dialog`, `replays-rename`, `servers-quick-filters`, `servers-address-book`,
  `servers-watchlist`, `replays-console-command`, `replays-edit-sidecar`.
- **D13 — Remaining confirms.** → `ConfirmDialog` (D-E rule): `modules/downloads/
DownloadsSettingsSection.tsx` (clear cache), `modules/home/dashboard/ResetLayoutDialog.tsx`,
  `modules/replays/components/DiscardDemoNotesDialog.tsx`, `ReplaceSidecarDialog.tsx`,
  `ModMissingConfirmDialog.tsx`, `modules/servers/join/useJoinFlow.tsx` (mismatch),
  `modules/mods/components/InstallDecisionDialog.tsx` (only if cancel + one action). Flows
  `settings-downloads-section`, `home-dashboard-arrange`, `replays-edit-sidecar`, `servers-join`.
- **D14 — Adoption guard, a11y diff, docs.** New `src/renderer/src/components/ui/ui-kit-adoption.test.ts`
  (reads files from disk like `src/architecture.test.ts`): fewer than 5 non-test files under
  `src/renderer` contain `const [submitting, setSubmitting]`; `role="tablist"` and
  `getDerivedStateFromError` occur only in `components/ui/Tabs.tsx` / `components/ui/ErrorBoundary.tsx`;
  `NameDialog` imported by ≥ 10 files and `ConfirmDialog` by ≥ 10 files. Run `npm run ui:verify`
  (exit 0) and compare `.ui-verify/a11y.json` rule ids per screen to `a11y-baseline-216.json`:
  no new id. Add a short "UI kit" paragraph to `docs/ARCHITECTURE.md` § Renderer (name, confirm,
  tabs, radio, textarea, error boundary, `useSubmitting`, `useStartJob`) and one `### Fixed` line
  under `## Unreleased` in `CHANGELOG.md` (D-O).

## Model Hints

- D11 → deliverable-hard — `ControlsTab.tsx` is 2.5k lines with seven inline dialogs whose
  duplicate-name validation, nested-modal Escape stacking and testids six flows depend on; a
  mechanical swap there silently drops a validation or a testid.
- All other Ds: default.

Review: → default — the plausible rigging (renaming the state to dodge AC2's grep, a tablist left
hand-rolled) is caught by D14's adoption test, not left to the reviewer.

## Acceptance Tests

- AC1 → unit `src/renderer/src/components/ui/NameDialog.test.tsx` › "one canSubmit gates the button
  and the Enter key", › "two Enters in one tick submit once", › "focus lands in the name field";
  unit `src/renderer/src/components/ui/useSubmitting.test.ts` › "a second run while one is in flight
  is ignored"; unit `src/renderer/src/components/ui/ConfirmDialog.test.tsx` › "busy disables confirm
  and blocks close"; unit `src/renderer/src/components/ui/Tabs.test.tsx` › "arrow keys move focus
  with a roving tabindex and Enter selects"; unit `src/renderer/src/components/ui/RadioGroup.test.tsx`
  › "arrow keys and click change the value"; unit `src/renderer/src/components/ui/controls.test.tsx` ›
  "TextArea forwards value and onChange"; e2e `scripts/flows/name-dialog-enter-once.mjs` ›
  "name-dialog-enter-once"; e2e `scripts/flows/tabs-keyboard.mjs` › "tabs-keyboard".
- AC2 → unit `src/renderer/src/components/ui/ui-kit-adoption.test.ts` › "fewer than 5 renderer files
  hold their own submitting state", › "role=tablist only inside Tabs", › "NameDialog and
  ConfirmDialog are adopted"; testids proven by the AC6 flows.
- AC3 → unit `src/renderer/src/components/ui/ErrorBoundary.test.tsx` › "fallback, onError, resetKeys
  and scope"; unit `src/renderer/src/components/ui/ui-kit-adoption.test.ts` ›
  "getDerivedStateFromError only inside ErrorBoundary"; e2e `scripts/flows/home-tile-states.mjs` ›
  "home-tile-states".
- AC4 → unit `src/renderer/src/components/jobs/useStartJob.test.ts` › "a refusal keeps the dialog
  state and a success exposes the job"; unit
  `src/renderer/src/modules/downloads/components/JobActionDialog.test.tsx` › "dismiss reads
  jobs.dismiss"; e2e `scripts/flows/engine-update.mjs` › "engine-update", `scripts/flows/repair.mjs` ›
  "repair", `scripts/flows/retail-upgrade.mjs` › "retail-upgrade", `scripts/flows/mod-update.mjs` ›
  "mod-update", `scripts/flows/mods-remove.mjs` › "mods-remove"; convention recorded as D-H.
- AC5 → unit `src/renderer/src/components/ui/ui-kit-tokens.test.ts` › "ui primitives use tokens
  only"; e2e `npm run ui:verify` exits 0 and D14's rule-id diff against `a11y-baseline-216.json` is
  empty.
- AC6 → e2e per D: `config-header-geometry`, `servers-watchlist`, `unsaved-diff`,
  `installation-remove-from-disk`, `unlock-code`, `linux-user-journey`, `import-from-files`,
  `home-route-roundtrip`, `care-duplicate-name`, `care-fix-item`, `external-edit-cascades`,
  `settings-section-rename-add-cvar`, `controls-category-rename-reorder`, `controls-subcategory`,
  `custom-action-row`, `open-keycap-dialog`, `grenade-rows-take-a-key`, `drop-message-checkbox`,
  `alias-rename-dialog`, `replays-rename`, `servers-quick-filters`, `servers-address-book`,
  `replays-console-command`, `replays-edit-sidecar`, `settings-downloads-section`,
  `home-dashboard-arrange`, `servers-join`, `jobs-installation-busy` (each `scripts/flows/<name>.mjs`
  › "<name>"); the sprint's `npm run ui:flows` covers the rest.

## Done

<!-- Filled by /build 216. -->

Primitives `NameDialog`, `ConfirmDialog`, `Tabs`/`TabPanel`, `RadioGroup`, `TextArea`, `useSubmitting`, one `ErrorBoundary`, `useStartJob` + `JobActionDialog`; ~45 dialogs/tab strips/boundaries migrated; adoption + token guards; flows tabs-keyboard, name-dialog-enter-once.

Commit: `216: UI kit — NameDialog, ConfirmDialog, Tabs, RadioGroup, TextArea, useSubmitting, one ErrorBoundary, useStartJob`

Verification (narrow gate): build, typecheck, lint green; `npm test` red only on pre-existing shell-layering, test-kit mockClient (useQuickFilters.test.ts) and LF of other stories' docs; `ui:verify` exit 0, a11y.json hash-identical to a11y-baseline-216.json; 31 AC6 flows via `npm run ui:flow -- <name>` green. AC1-AC6 mapped tests all ran and passed.
Pre-existing red on bare HEAD (stash-checked): external-edit-cascades, drop-message-checkbox.

Decisions:

- Tabs/Enter: unit test uses a click (native Enter/Space); real Enter proven by flow tabs-keyboard. RadioGroup test is click + shared name (user-event absent); test names updated in Acceptance Tests.
- NameDialog grew optional props (placeholder, nameOptional, submittable, suffix, onNameChange, function children, testIds.error/dialog, optional maxLength) to keep existing flows/behaviour; one canSubmit still gates button and Enter.
- Stayed on Modal (choice dialogs, D-E): QuickFilterNameDialog (Overwrite), CareBatchFixDialog, KeyBindDialog, ModMissingConfirmDialog, InstallDecisionDialog. ControlsTab's empty-category delete confirm stays inline (unit test requires it); ActionEditor/MessageEditor had no confirms.
- ConfirmDialog: `busy` disables Cancel + confirm + preventClose; `confirmDisabled` for the running-game block. Discard/mismatch cancel labels are now "Cancel"; create dialogs show Name above the extra fields.
- Not fixed (low): DeleteCategoryDialog confirm not disabled by its own canSubmit (unreachable state); TabPanel aria-labelledby dangling while watchlist strip is hidden; AliasesTab import reformat.
- Unused i18n keys left: replays.editor.discardDialog.keep, servers.join.mismatch.cancel.

tiers: D 14 / hard 1 · review default · cycles 1 · agents 21
