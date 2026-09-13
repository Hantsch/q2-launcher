---
id: 012
title: Raw config view with reveal-in-folder
status: done
created: 2026-08-18
---

## Requirement

As a user, I want to see the physical, rendered text of a profile's config file — exactly what
would be written to disk — so I can verify what the launcher is actually going to produce
without guessing from the UI. From that same view I want to open the folder/file explorer at
the location where that file lives on disk, so I can inspect or hand-edit it myself if needed.

## Acceptance Criteria

- [x] A profile has a view showing the raw, rendered config file content as plain text, exactly
      as it would be (or was) written to a target installation.
- [x] The raw view is reachable without leaving the profile's own screens (not buried only inside
      an unrelated write-target flow).
- [x] From the raw view, an action opens the OS file explorer at the folder containing the
      written file, for an installation the profile is assigned to.
- [x] If the profile has not been written to any installation yet, this is communicated clearly
      rather than silently failing or opening a folder that doesn't exist.

## Open Questions

None.

## Decisions (Sprint)

- **Surface = a new "Raw file" tab on the profile detail screen** (`DetailTab` gets `'raw'`), not a
  dialog and not a new view — AC 2 asks for the profile's own screens, and the detail screen already
  owns the tab pattern (`overview | settings | advanced | writeTargets | validation | preserved`).
- **Reuse the existing `preview` handler instead of adding a `raw` handler** — it already returns the
  exact rendered `PreviewFile[]` for a `(profileId, installationId)` pair; a second near-identical
  path is precisely the drift `previewProfileFiles`' own doc comment warns about.
- **`previewProfileFiles` stays pure (no fs)** and the on-disk check happens in the handler via the
  existing `isFile()` from `src/main/lib/fs-utils.ts` — the pure renderer is shared with the write
  path and must keep producing identical bytes.
- **"Not written yet" is answered per file by `onDisk: boolean`**, not by new persisted state — the
  repo records no `writtenTo`/`lastWritten` anywhere, so disk existence is the only honest signal and
  needs no state-file migration.
- **No new IPC channel for reveal**: `app:revealPath` already accepts a file path
  (`shell.showItemInFolder`) and its `isAllowedRevealTarget` allowlist already covers
  `installation.rootPath`, under which every target `.cfg` lives — so the renderer never gains a new
  privilege and main still validates the path (CLAUDE.md: paths from the renderer are never trusted).
- **Reveal is per file row, not one button per tab** — the loader file also lands in mod folders, so
  the files can sit in different directories; a row-level action is unambiguous.
- **Installation choice: default assignment → active installation (if assigned) → first assignment**,
  with a `Select` shown only when the profile has more than one assignment — the rendered text is
  installation-specific, so the view must name which target it is showing.
- **No assignments at all → `EmptyState`, no fetch** — there is no target path to render or reveal,
  which is the other half of AC 4.
- **A `CodeBlock` atom is extracted** into `components/ui/primitives.tsx` because the `<pre>` class
  string is already copy-pasted verbatim in two places and this story would be the third;
  `LayersPanel.tsx` is deliberately left untouched to avoid an unrelated edit.
- **No copy-to-clipboard** — not in the acceptance criteria; reveal-in-folder covers the "inspect it
  yourself" need the requirement actually states.
- **Tests target `.ts` only** (installation-pick logic + main handler) — vitest runs `environment:
  node` with `include: ['src/**/*.{test,spec}.ts']`, so adding jsdom/testing-library for one tab
  would be a stack change this story does not justify; the tab itself is accepted through the UI.

## Plan

Config traffic rides the single `module:invoke` channel, so `src/shared/ipc.ts`, the preload
allowlist and `src/main/ipc/*` are all untouched.

1. **Data** — teach the existing config `preview` handler whether each rendered file is already on
   disk: add `onDisk: boolean` to `PreviewFile` (`src/shared/modules/config.ts`), make the handler
   in `src/main/modules/config/index.ts` async and map `previewProfileFiles(...)` through
   `isFile(file.path)`. `previewProfileFiles` itself stays pure. Input schema unchanged.
2. **Shared UI** — extract the duplicated `<pre>` styling into a `CodeBlock` atom
   (`components/ui/primitives.tsx`), then extract the fetch + file-list body of
   `PreviewProfileDialog.tsx` into a reusable `RawConfigPanel.tsx` (loading / error / empty / per
   file: path, on-disk badge, reveal button, `CodeBlock`). The dialog then only wraps that panel in
   `Modal`, so preview and the new tab can never diverge.
3. **Tab wiring** — pure helper `lib/raw-view.ts` (`pickRawInstallationId`) + its test; add `'raw'`
   to `DetailTab`, one entry to the `tabs` array and one render branch in `ConfigView.tsx`; the
   branch renders the installation `Select` (only when >1 assignment), `RawConfigPanel`, or an
   `EmptyState` when the profile has no assignment at all.
4. **i18n** — new `config.raw.*` keys in `src/renderer/src/i18n/locales/en.json`; main returns keys
   only, never prose.

Order: D1 → D2 → D3 (D2 consumes D1's `onDisk`, D3 mounts D2).

## Deliverables

### D1 — `preview` reports whether each rendered file exists on disk

- Files: `src/shared/modules/config.ts` (add `onDisk: boolean` to `PreviewFile`),
  `src/main/modules/config/index.ts` (the `CONFIG_HANDLERS.preview` handler → `async`, map through
  `isFile` from `../../lib/fs-utils`), `src/main/modules/config/index.test.ts` (extend the existing
  preview case).
- Mirror: the existing `handle(CONFIG_HANDLERS.preview, ...)` block in
  `src/main/modules/config/index.ts` — keep the `safeParse` → `fail('ipc.error.invalidPayload')` →
  profile/installation lookup shape exactly as it is.
- Do **not** add fs access to `previewProfileFiles` — it must stay the pure, shared renderer.
- Acceptance: `npm run build` + `npm test` green; a test asserts `onDisk === false` for a profile
  previewed against an installation whose `baseq2` holds no `q2l-profile-*.cfg`, and `true` after the
  file is created in a temp dir.

### D2 — `RawConfigPanel` + `CodeBlock`, with per-file reveal; `PreviewProfileDialog` reuses it

- Files: `src/renderer/src/components/ui/primitives.tsx` (new `CodeBlock`),
  `src/renderer/src/modules/config/RawConfigPanel.tsx` (new),
  `src/renderer/src/modules/config/PreviewProfileDialog.tsx` (reduced to `Modal` + panel),
  `src/renderer/src/i18n/locales/en.json`.
- `CodeBlock` carries the class string currently duplicated in `PreviewProfileDialog.tsx:80` /
  `LayersPanel.tsx:294` (`numeric max-h-64 overflow-auto rounded-sm border border-line bg-void p-3
  text-[11px] whitespace-pre text-ink-muted`) — semantic tokens only, no raw palette classes; leave
  `LayersPanel.tsx` alone.
- Props: `{ profile: ConfigProfile; installationId: string }`; the panel owns the
  `previewConfigProfile` fetch (cancel-on-unmount `useEffect` keyed `[profile.id, installationId]`,
  mirroring the current dialog).
- Per file row: absolute path (`data-selectable`), an on-disk `Badge`, and an `IconButton`
  (`FolderOpen`) calling `invoke('app:revealPath', file.path)`. When `onDisk === false` the button is
  `disabled` and the row says the file has not been written to this installation yet; on a failing
  `Outcome` push an error toast with `result.error.key` (do not swallow it like the existing
  `LibraryView` call site does).
- Acceptance: the existing "Preview…" button on the Write targets tab looks and behaves as before
  (same content, plus the new badge/reveal); reveal opens Explorer with the `.cfg` selected;
  `npm run build` green.

### D3 — "Raw file" tab on the profile detail screen

- Files: `src/renderer/src/modules/config/lib/raw-view.ts` + `raw-view.test.ts` (new),
  `src/renderer/src/modules/config/ConfigView.tsx`, `src/renderer/src/i18n/locales/en.json`.
- `pickRawInstallationId(profile, installations, activeInstallationId, currentId?)` — pure: keeps a
  still-valid current pick, else default assignment, else the active installation if assigned, else
  the first assignment, else `null`. Unit-tested (`.ts`, so vitest picks it up).
- `ConfigView.tsx`: add `'raw'` to `DetailTab`, one `tabs` entry (`config.tabs.raw`), one render
  branch inside the existing `<Panel className="p-6">`; local state for the picked installation.
  Render a `Select` of assigned installations only when `profile.assignments.length > 1`.
- No assignment → `EmptyState` with `config.raw.noAssignment`, and no request is fired.
- Acceptance: opening a profile → "Raw file" shows the rendered text without going through the Write
  targets tab; switching the installation re-renders the content; an unassigned profile shows the
  empty state; `npm run build` + `npm test` green.

### AC coverage

| AC | Deliverable |
| --- | --- |
| Raw rendered content as plain text | D1 (data) + D2 (rendering) |
| Reachable from the profile's own screens | D3 (tab) |
| Reveal in OS file explorer for an assigned installation | D2 (per-row reveal via `app:revealPath`) |
| "Not written yet" communicated clearly | D1 (`onDisk`) + D2 (disabled reveal + hint) + D3 (no-assignment empty state) |

## Model Hints

- D1 → default
- D2 → default
- D3 → default
- Review: → default — additive tab plus one reused, already-validated IPC channel; no new privilege,
  no state-file migration, no change to the write path.

## Test Plan (manual acceptance)

`npm run dev`, then:

1. Config → pick a profile that is assigned to at least one installation → open the **Raw file** tab.
   The rendered `.cfg` text appears, with the absolute target path above each file.
2. Compare against Write targets → **Preview…** for the same installation: identical content.
3. Click the reveal button on a file that is marked as on disk → Explorer opens with that `.cfg`
   selected.
4. Take a profile that was never written (assigned, but no write run yet): the tab still shows the
   text, each file is marked as not written, and the reveal button is disabled — nothing opens and no
   error appears.
5. Unassign the profile from every installation → the Raw file tab shows the empty-state message
   instead of content or a broken request.
6. Profile with two or more assignments: the installation selector switches the shown content.

## Done

**Summary.** Built in three deliverables, in plan order:

- **D1** — `PreviewFile` (`src/shared/modules/config.ts`) gained `onDisk: boolean`. The
  `CONFIG_HANDLERS.preview` handler (`src/main/modules/config/index.ts`) is now `async` and maps
  each rendered file through `isFile()` (`../../lib/fs-utils`) via `Promise.all`. `previewProfileFiles`
  itself stayed pure and fs-free — only its return type annotation changed to
  `Omit<PreviewFile, 'onDisk'>[]`, since the handler now adds `onDisk` after calling it. A new
  `describe('CONFIG_HANDLERS.preview handler', ...)` block in `index.test.ts` boots
  `configModule.setup()` against a real, temp-file-backed `StateStore` and asserts `onDisk` flips
  from `false` to `true` once the rendered `.cfg` is written to a temp `baseq2` dir. The existing
  `previewProfileFiles` pure-function tests were left untouched.
- **D2** — `CodeBlock` extracted into `src/renderer/src/components/ui/primitives.tsx`, carrying the
  `<pre>` class string previously duplicated in `PreviewProfileDialog.tsx`/`LayersPanel.tsx`
  (`LayersPanel.tsx` deliberately left untouched, per plan). New
  `src/renderer/src/modules/config/RawConfigPanel.tsx` owns the `previewConfigProfile` fetch and
  renders, per file: the absolute path, an on-disk `Badge`, an `IconButton` (`FolderOpen`) that is
  `disabled` when `!file.onDisk` and otherwise calls `invoke('app:revealPath', file.path)` — a
  failing `Outcome` is surfaced via `pushToast` (not swallowed, unlike `LibraryView`'s reveal call
  site) — and the file's content in a `CodeBlock`. `PreviewProfileDialog.tsx` is now just `Modal` +
  `RawConfigPanel`, so the Write targets tab's "Preview…" dialog and the new tab can never diverge.
- **D3** — new pure helper `pickRawInstallationId` (`src/renderer/src/modules/config/lib/raw-view.ts`,
  tested in `raw-view.test.ts`, 6 cases): still-valid current pick → default assignment → active
  installation if assigned → first assignment → `null`. `ConfigView.tsx` gained a `'raw'` `DetailTab`,
  a tab entry, and a render branch: an installation `Select` (only when `assignments.length > 1`),
  `RawConfigPanel`, or an `EmptyState` (`config.raw.noAssignment.*`) when the profile has no
  assignment at all — no request is fired in that case.

**Decisions** (implementation details settled autonomously — no user available to ask; all verified
against the plan and acceptance criteria):

- `pickRawInstallationId` accepts `installations: Installation[]` per the mandated signature but does
  not need it for the priority logic itself (`profile.assignments` already carries `installationId`,
  and live-installation reconciliation already happened in main before the profile reached the
  renderer) — kept as `_installations` with a comment rather than dropped, so the signature matches
  what the plan specifies and what `ConfigView.tsx` calls it with.
- On-disk badge tones: `success` for `onDisk: true`, `neutral` for `false` — reads as "informational
  state", not an error, since an unwritten file is an expected, common state (e.g. a freshly assigned
  profile), not a fault.
- i18n: all new copy added under a single `config.raw.*` namespace shared by D2 and D3
  (`onDisk`/`notOnDisk`/`notWritten`/`reveal`/`installationLabel`/`noAssignment.title`/
  `noAssignment.body`), plus `config.tabs.raw` — no separate namespace per deliverable, since both
  belong to the same user-facing feature.
- The "Raw file" tab was placed immediately after "Write targets" in the tab order — both tabs are
  about what ends up on disk, so they read naturally as neighbors; the story did not mandate an exact
  slot.

**Verification:**

- `npm run build` — green.
- `npm test` — 450/450 passing across 27 files (run via PowerShell; an earlier Bash-tool run during
  D2's own verification showed a uniform whole-suite failure including files nobody touched, which
  matches the known Bash/Git-Bash + vitest environment glitch already seen and confirmed non-real in
  story 011 — the PowerShell re-run is the authoritative result).
- `npx tsc -p tsconfig.node.json --noEmit` and `-p tsconfig.web.json --noEmit` — both clean.
- Clean-agent code review: **PASS** on all 4 acceptance criteria (evidence at `file:line` in each
  case), zero findings — no weakened/deleted tests, no scope creep, no new IPC channel, the
  `app:revealPath` allowlist (`src/main/ipc/app.ts`) untouched, `CodeBlock` uses only semantic design
  tokens, reveal failures surfaced via toast rather than swallowed, `LayersPanel.tsx` confirmed
  untouched. No fixes were needed.
- **Live UI smoke: not performed.** This environment has no way to drive the actual Electron window
  (no Playwright installed in this project, no `ui-verify` harness scaffolded yet, and headless
  agents cannot drive a GUI) — per this project's P2 policy (`live-smoke-required: true`), the story
  is **built, live acceptance pending** rather than `done`. The `## Test Plan (manual acceptance)`
  section above is ready to run as-is once a live pass is possible.

**Commit message** (for the orchestrator to use):

```
012: raw config view with reveal-in-folder
```
