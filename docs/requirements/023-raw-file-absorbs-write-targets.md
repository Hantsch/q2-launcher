---
id: 023
title: Raw File absorbs Write targets — see and open the profile's file anywhere
status: ready # draft -> ready -> in-progress -> done
created: 2026-08-19
---

## Requirement

"Write targets" earns its own tab for nothing: I already know which installations a profile is
assigned to, and whether it landed there is visible from the file itself. The tab goes away and
its useful part moves into **Raw File**.

Raw File should let me navigate to the current profile's file — the profile's own `<name>.cfg`
(story 022) first, which exists even without an assignment, and then the copy in each assigned
installation. I want to look at it in the launcher, and I want to open it in whatever editor I
use, or open its folder.

## Acceptance Criteria

- [ ] The "Write targets" tab is gone; nothing that used to be reachable only there becomes
      unreachable.
- [ ] The automatic write-on-change that `WriteTargets` used to trigger still happens after that
      component is deleted — this is the regression to guard, and a test covers it.
- [ ] Raw File always shows the profile's own file, including for a profile assigned nowhere, with
      its full path visible and selectable.
- [ ] Below it, one entry per assigned installation: path, present/absent on disk, and whether the
      content matches the current profile.
- [ ] Each entry offers "Open in editor" (the OS default application for `.cfg`) and "Reveal in
      folder"; both are disabled with a reason when the file is not on disk.
- [ ] The file content is shown read-only in the launcher, byte-faithful (latin1/high-ASCII, no
      trimming, no reformatting).
- [ ] Switching profiles or installations re-reads the file rather than showing a stale copy.
- [ ] Opening a path goes through main with the usual path validation — no renderer-supplied path
      is trusted, and nothing but the profile's own files can be opened this way.

## Open Questions

- ~~With the tab gone, where do the per-installation write *errors* and the retry live?~~ answered
  → Decisions (Sprint)
- ~~Same question for the played-mods selection.~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Per-installation write errors and their retry live only in the Care tab (story 025) —
  this tab's per-installation rows show current present/matches status but no error/retry
  affordance, to avoid duplicating the same state and action across two tabs.
- **(User)** Played-mods selection (which gamedirs receive a copy) is configured per installation
  row, right here in Raw File — see story 022's Decisions.
- One new read handler `CONFIG_HANDLERS.rawFiles` (`{ profileId }` → canonical file + one entry per
  assignment) instead of extending `preview`: `preview` is per-installation and shared with other
  call sites, while this tab needs the whole profile in one round-trip.
- `matches` is computed by comparing the on-disk bytes (latin1, via `writer.ts`'s `readExisting`)
  against freshly rendered content — reusing the write pipeline's own diff-skip comparison means
  "matches" can never disagree with "a write would change nothing".
- Open/reveal is addressed by ids (`{ profileId, installationId: string | null, mode }`), never by a
  path — main resolves the path from its own state, so AC 8 holds by construction rather than by an
  allowlist check on renderer input.
- That action is a config-module handler, not a new top-level `app:openPath` channel — a
  module-scoped, id-addressed action cannot be repurposed to open any other launcher-known file,
  which a generic path channel could.
- The automatic write-on-change moves out of a tab into `useProfileAutoWrite(profile)`, called by
  `ConfigView`'s detail screen: a tab-scoped effect only fires while that tab is mounted, which is
  why today's trigger in `WriteTargets` effectively almost never runs — tab independence is what
  CFG-3 actually requires.
- Its trigger rule is extracted into pure `lib/auto-write.ts` with a co-located unit test, because
  Vitest here runs `environment: 'node'` with no jsdom/@testing-library (`vitest.config.ts:13`), so
  a hook/component test is not available as the covering test AC 2 asks for.
- Per-installation rows show path/status/actions plus an expandable rendered-file view (the existing
  `RawConfigPanel`) rather than embedding every copy's full text — the tab stays scannable while the
  content view the deleted Preview dialog offered stays reachable (AC 1).
- `PreviewProfileDialog` and `lib/raw-view.ts` (with the installation `<Select>`) are deleted: with
  every assignment listed at once, the picker and the modal have no remaining entry point.
- Played-mods checkboxes are seeded from the `rawFiles` response's per-installation `playedMods`
  rather than from a second getter channel — this closes `WriteTargets`' documented "selection does
  not survive a reload" gap without widening the contract twice.
- This story consumes story 022 through exactly two seams: the canonical-file path helper and the
  name-based `profileFileName(profile)`; if 022 also exposes a per-installation sync helper,
  `rawFiles` reuses it instead of duplicating the comparison.
- `config.writeTargets.*` and `config.previewDialog.*` keys are deleted and the new row strings are
  added under `config.raw.*` — main keeps sending keys only, and only `en` ships.
- A failed `rawFiles` outcome renders as an inline error, never an empty or crashing tab; the
  still-unfiled `RawConfigPanel` config-raw crash itself stays S06 scope per the sprint notes.
- Each disabled action states its reason as adjacent text, not only as a `title`/colour — non-colour,
  non-hover status indication per `/design-tokens`.

## Plan

Order: contract + main read (D1) → privileged open action (D2) → save the write trigger (D3) →
UI (D4–D6) → remove the old surface (D7). D3 lands **before** D7 so there is never a commit in
which nothing triggers a write.

1. **Contract** (`src/shared/modules/config.ts`): add `rawFiles` and `openFile` to
   `CONFIG_HANDLERS`, plus `RawFilesInput`, `RawProfileFile { path, content, onDisk }`,
   `RawInstallationTarget { installationId, path, onDisk, matches, playedMods }`,
   `RawFilesResult { canonical, installations }`, `OpenProfileFileInput`. No `src/shared/ipc.ts`
   change and no preload change — config rides the already-allowlisted `module:invoke`.
2. **Main** (`src/main/modules/config/index.ts`, `schemas.ts`, `writer.ts`): a pure
   `collectRawFiles(...)` helper next to `previewProfileFiles` (same testable shape), reading the
   canonical file latin1-faithfully and comparing rendered vs. on-disk for `matches`; `playedMods`
   from `app.state.configPlayedMods()`. `openFile` resolves the path itself, requires it to exist and
   to be the profile's own `.cfg`, then `shell.openPath` (editor) / `shell.showItemInFolder`
   (reveal) — mirroring `src/main/ipc/app.ts:34-71`. Export `readExisting` if still module-private.
3. **Write trigger** (`src/renderer/src/modules/config/lib/auto-write.ts` + test,
   `ConfigView.tsx`): the `lastSeenUpdatedAt` rule from `WriteTargets.tsx:105-130` becomes a pure
   function; a `useProfileAutoWrite` hook (same file or `lib/useProfileAutoWrite.ts`) calls
   `writeConfigProfile` and is mounted by the detail screen, not by a tab.
4. **UI** (`RawFileTab.tsx` new, `ConfigView.tsx`, `RawConfigPanel.tsx`, `en.json`): canonical file
   section first (selectable path, on-disk badge, open/reveal, read-only `CodeBlock`), then one row
   per assignment (name, path, present + matches badges, open/reveal, played-mods checkboxes,
   expand → `RawConfigPanel` for that installation). Fetch keyed on `[profile.id, profile.updatedAt]`
   so a save or a profile switch re-reads (AC 7).
5. **Removal** (`WriteTargets.tsx`, `PreviewProfileDialog.tsx`, `lib/raw-view.ts` + test,
   `ConfigView.tsx` `DetailTab`/`tabs`, `en.json`, `scripts/lib/screens.mjs:130-133`, stale
   `.ui-verify/screenshots/config-writeTargets@*.png`).

## Deliverables

- **D1 — `rawFiles` read handler.** Contract types + `CONFIG_HANDLERS.rawFiles`, `schemas.ts`
  payload schema, `collectRawFiles(...)` + handler in main, typed client function.
  *Files:* `src/shared/modules/config.ts`, `src/main/modules/config/schemas.ts`,
  `src/main/modules/config/index.ts`, `src/main/modules/config/writer.ts` (export `readExisting`),
  `src/main/modules/config/index.test.ts`, `src/renderer/src/modules/config/client.ts`.
  *Mirror:* the `preview` handler (`index.ts:391-410`) + `previewProfileFiles` (`index.ts:182-215`);
  client style `client.ts:145-147`.
  *Acceptance:* unit tests prove canonical `onDisk` false→true, `matches` true only for
  byte-identical latin1 content, one entry per assignment, `playedMods` echoed, unknown profile →
  `config.error.profileNotFound`.

- **D2 — `openFile` (open in editor / reveal in folder).** Handler + schema + client; id-addressed,
  existence + `.cfg` + own-file check before any `shell` call.
  *Files:* `src/shared/modules/config.ts`, `src/main/modules/config/schemas.ts`,
  `src/main/modules/config/index.ts`, `src/main/modules/config/index.test.ts`,
  `src/renderer/src/modules/config/client.ts`.
  *Mirror:* `src/main/ipc/app.ts:34-71` (`app:revealPath` + `isAllowedRevealTarget`).
  *Acceptance:* a test asserts a mocked `shell.openPath`/`showItemInFolder` is called for a resolved
  own file and is **not** called for an unknown profile, an unknown installation, or a missing file
  (each returning a `fail` key); no input field carries a path.

- **D3 — Auto-write survives the deletion.** Pure trigger rule + hook mounted by the detail screen;
  `WriteTargets` still present and its own effect removed so there is exactly one trigger.
  *Files:* `src/renderer/src/modules/config/lib/auto-write.ts` (new),
  `src/renderer/src/modules/config/lib/auto-write.test.ts` (new),
  `src/renderer/src/modules/config/ConfigView.tsx`, `src/renderer/src/modules/config/WriteTargets.tsx`.
  *Mirror:* `WriteTargets.tsx:105-130` for the rule, `lib/useProfileDraft.ts` for hook style and
  `lib/useProfileDraft.test.ts` for the pure-test style.
  *Acceptance:* tests cover — first sighting of a profile id is not a write, an unchanged
  `updatedAt` is not a write, a bumped `updatedAt` is, and switching away and back without an edit
  is not; editing a cvar in the Settings tab still writes with no Write-targets tab open.

- **D4 — Raw File tab: the profile's own file.** New `RawFileTab` replacing the tab body: canonical
  path (selectable), on-disk badge, open/reveal buttons, byte-faithful read-only content, inline
  error state, no assignment required.
  *Files:* `src/renderer/src/modules/config/RawFileTab.tsx` (new),
  `src/renderer/src/modules/config/ConfigView.tsx`, `src/renderer/src/i18n/locales/en.json`.
  *Mirror:* `RawConfigPanel.tsx` (fetch + `CodeBlock` + badge + `IconButton` idiom).
  *Acceptance:* a profile assigned nowhere shows its file with full path and content instead of the
  old "not assigned" empty state; a re-fetch happens on profile switch and after a save.

- **D5 — Per-installation rows.** One row per assignment: installation name, copy path,
  present/matches badges, open/reveal, and an expand that renders `RawConfigPanel` for that
  installation. Disabled actions state their reason as text.
  *Files:* `src/renderer/src/modules/config/RawFileTab.tsx`,
  `src/renderer/src/modules/config/RawConfigPanel.tsx`, `src/renderer/src/i18n/locales/en.json`.
  *Mirror:* the row layout of `WriteTargets.tsx:145-221`.
  *Acceptance:* rows show absent vs. present vs. present-but-differs distinctly; both actions are
  disabled with a visible reason when the file is absent; expanding re-reads that installation's
  rendered files.

- **D6 — Played-mods per row.** Checkbox list from `installation.gameDirs` (minus `baseq2`), seeded
  from D1's `playedMods`, persisted through the existing `setPlayedMods`.
  *Files:* `src/renderer/src/modules/config/RawFileTab.tsx`,
  `src/renderer/src/i18n/locales/en.json`.
  *Mirror:* `WriteTargets.tsx:132-143` and `:197-213`.
  *Acceptance:* a toggled selection survives leaving the profile and coming back (the gap
  `WriteTargets.tsx:49-58` documents), and an installation with no mod folders shows the empty note.

- **D7 — Remove the Write targets surface.** Delete `WriteTargets.tsx`, `PreviewProfileDialog.tsx`,
  `lib/raw-view.ts` (+ its test) and the `previewInstallationId`/`rawInstallationId` state; drop
  `writeTargets` from `DetailTab` and `tabs`; delete `config.tabs.writeTargets`,
  `config.writeTargets.*`, `config.previewDialog.*` and the now-unused `config.raw.installationLabel`
  / `config.raw.noAssignment.*`; drop the `config-writeTargets` screen entry and its stale
  screenshots.
  *Files:* the four renderer files above, `src/renderer/src/modules/config/ConfigView.tsx`,
  `src/renderer/src/i18n/locales/en.json`, `scripts/lib/screens.mjs`,
  `.ui-verify/screenshots/config-writeTargets@*.png`.
  *Acceptance:* `npm run typecheck` + `npm test` clean, no reference to `WriteTargets`,
  `previewConfigProfile`'s dialog or `config.writeTargets` left in `src/` or `scripts/`, and
  `npm run ui:verify` walks the config tabs without the removed one.

**Coverage (AC → D):** tab gone / nothing unreachable → D7 (+ D5 keeps the preview content
reachable) · auto-write survives, test covers → D3 · own file always shown, path visible and
selectable → D1 + D4 · one entry per assignment with present/matches → D1 + D5 · open in editor /
reveal, disabled with a reason → D2 + D4 (canonical) + D5 (rows) · byte-faithful read-only content
→ D1 (latin1 read) + D4 · re-read on profile/installation switch → D4 + D5 · path validation, no
renderer-supplied path trusted → D2 · played-mods per row (sprint decision) → D6.

## Model Hints

- `D2 → deliverable-hard` — it introduces a new privileged path: launching the OS default
  application for a file from renderer-initiated input, which must resolve every path in main and
  refuse anything that is not this profile's own `.cfg`.
- `D3 → deliverable-hard` — this is the story's named regression: every profile write in the app
  flows through this single trigger, and it must become tab-independent without writing on mere
  profile selection or writing twice.
- All other deliverables: default tier.
- `Review: → story-review-hard` — the diff deletes the component that carries the only existing
  write trigger and adds a shell-open privilege, so the review needs to check a silent regression
  and a security boundary, not just style.

## Test Plan (manual acceptance)

All steps through the real UI (`npm run dev`, or `npm run ui:verify` for the screenshot/a11y pass).

1. Open Config → a profile → **Raw file**: the profile's own `<name>.cfg` path is shown, selectable,
   and its content is rendered. Do this with a profile that is assigned to **no** installation.
2. Click **Open in editor** on that file: the OS default editor for `.cfg` opens it. Click **Reveal
   in folder**: its folder opens with the file selected.
3. Assign the profile to two installations (Assignments menu). Back in Raw file: one row per
   installation with its copy's path and status. Delete the copy of one installation on disk and
   reopen the tab — that row reads "not on disk" and both its actions are disabled with a reason.
4. Edit that file outside the launcher (add a line) and reopen the tab: the row reads
   "differs from this profile".
5. Go to **Settings**, change a cvar, wait a second, then return to Raw file: the installation rows
   are back in sync — i.e. the automatic write happened with no Write targets tab anywhere.
6. In one row, tick a mod folder under **Played mods**, leave the profile, come back: the tick is
   still there. Launch that installation and confirm `autoexec.cfg` is in that mod folder.
7. Expand a row: the rendered files for that installation are shown read-only, byte-faithful
   (check a high-ASCII/latin1 message string round-trips unchanged).
8. Confirm the **Write targets** tab is gone and no action from it is missing (errors/retry are
   expected to be absent here — they belong to Care, story 025).

## Done
