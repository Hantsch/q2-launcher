---
id: 067
title: An installation carries an icon I choose
status: done
created: 2026-09-07
---

## Requirement

An installation is identified in the UI by a square tile with a two-letter code
([format.ts:104](../../src/renderer/src/lib/format.ts#L104)), rendered in the installation rail
([InstallationRail.tsx:229](../../src/renderer/src/components/shell/InstallationRail.tsx#L229)),
on the library card
([LibraryView.tsx:224](../../src/renderer/src/views/LibraryView.tsx#L224)) and in the action bar
([ActionBar.tsx:74](../../src/renderer/src/components/shell/ActionBar.tsx#L74)). That code is
derived from the *engine*, not from the installation: two r1q2 installs both read `R1`, and the one
thing the tile is there for — telling them apart at a glance — it cannot do.

So the user wants to give an installation an icon. Two sources, both from the library:

**A shipped icon.** The repo already carries a set in
[assets/installations/](../../assets/installations) — `gate.png`, `portal.png`, `ring.png`,
`q2pro-logo.png`, `r1q2-logo.png`, `vanilla-logo.png`. The picker offers exactly what is in that
set, so adding an icon later is dropping a file in, not editing a component.

**Their own image.** The user picks any image from disk and it is used as that installation's icon.

Four existing constraints shape this and none of them may be quietly bent:

- **The repo rule is "no image assets in the UI"** (CLAUDE.md) — all surfaces are CSS/inline SVG.
  The one exception today is the boot splash hero, and it is documented as *the one bitmap the
  bundle emits*
  ([renderer-source.ts:67](../../src/main/lib/renderer-source.ts#L67)). An installation icon is a
  bitmap on a routine surface, so this story either comes with a recorded deviation in CLAUDE.md or
  it does not happen — see Open Questions.
- **Repo-root `assets/` is not in the renderer bundle.** Only `src/renderer/src/assets/` is
  (`import heroUrl from '../../assets/boot-hero.avif'`,
  [BootSplash.tsx:2](../../src/renderer/src/components/shell/BootSplash.tsx#L2)). The six files are
  also 115–520 KB each — authoring originals, not tile assets for a 44px box.
- **Paths from the renderer are never trusted** (CLAUDE.md). A user-picked image path has to be
  produced and owned by main, the way `installations:pickFolder`/`pickExecutable` already own their
  dialog result ([installations.ts:68-88](../../src/main/ipc/installations.ts#L68-L88)), and it has
  to be validated as an image before anything is persisted.
- **The production CSP is `img-src 'self' data: blob:`**
  ([renderer-source.ts:37](../../src/main/lib/renderer-source.ts#L37)). Whatever delivery the icon
  uses must fit inside that; relaxing the CSP for a cosmetic feature is not on the table.

Persistence-wise the record has room: `Installation` carries a per-module `moduleData` scratch space
([installation.ts:105](../../src/shared/types/installation.ts#L105)) and
`UpdateInstallationInput` ([installation.ts:124-137](../../src/shared/types/installation.ts#L124-L137))
is the existing edit path — it has `name` and `favorite`, but no icon field yet.

## Acceptance Criteria

- [x] **AC1** — From the library card I can open an icon picker and choose one of the icons shipped
      in `assets/installations`; the picker shows every file in that set and no hardcoded list of
      names in a component.
- [x] **AC2** — I can instead pick my own image file from disk through a native dialog, and it is
      used as that installation's icon.
- [x] **AC3** — The chosen icon replaces the code tile on every surface that shows one: rail,
      library card, action bar — and it survives a restart of the launcher.
- [x] **AC4** — A custom icon keeps working after the file I picked it from is moved, renamed or
      deleted.
- [x] **AC5** — I can clear the icon again; the tile falls back to today's engine/initials code,
      pixel-for-pixel as it is now.
- [x] **AC6** — A pick that is not a usable image (wrong format, corrupt, oversized) is refused with
      a translated message; the previous icon stays and nothing is persisted.
- [x] **AC7** — Main validates the picked path and reads the file; the renderer never reads a path
      itself, and the production CSP is unchanged.
- [x] **AC8** — The tile keeps its accessible name (installation name / today's label) with an icon
      present; the icon itself is decorative and adds no new axe violation.
- [x] **AC9** — An installation with no icon renders exactly as today — no layout shift, no empty
      image box, no extra request.

## Open Questions

All resolved 2026-09-07.

- [x] **The repo's "no image assets in the UI" rule.** → **Deviation recorded.** Bitmaps are allowed
      for installation identity only (the tile); everything else stays CSS/inline SVG. The exception
      goes into CLAUDE.md's Deviations table with this story as its reason (D1).
- [x] **What the shipped set is for.** → **Explicit user choice only, no per-engine defaults.** A
      fresh install shows today's code tile (AC9).
- [x] **How the shipped icons get into the bundle.** → **Converted copies in the bundle.** A script
      generates 128px `.avif` into `src/renderer/src/assets/installations/`; `assets/installations/`
      stays the authoring original. Generated files are committed, so a checkout needs no image
      tooling. Adding an icon later = drop a PNG in, re-run the script, commit.
- [x] **Where a custom image lives after the pick.** → **Main copies it into
      `userData/installation-icons/<id>.png`.** That is what makes AC4 true.
- [x] **How a custom icon reaches the renderer.** → **`data:` URL from main.** The CSP already allows
      `data:`, so AC7 costs nothing.
- [x] **Entry points.** → **Library card only.** New dialog kind next to `rename`/`cleanup`
      ([LibraryView.tsx:320-336](../../src/renderer/src/views/LibraryView.tsx#L320-L336)). The rail
      does not get a second trigger.
- [x] **Accepted formats and limits.** → **PNG and JPEG only**, source file ≤ 4 MB, re-encoded by
      main to a single 128px square PNG. **Reason for narrowing the filed `webp`/`avif`:** there is
      no image library in the repo (no `sharp`, no `jimp`) and Electron's built-in `nativeImage`
      decodes PNG and JPEG only. Supporting webp/avif would mean a native runtime dependency and its
      packaging cost, for a cosmetic feature. A `.webp`/`.avif` pick is AC6's refusal, with its own
      translated message. Say so if that trade is wrong — it is the one place this plan narrows the
      requirement.

### Named gap (for the sprint review)

**AC2's native file dialog is not reachable by the e2e harness.** `docs/UI-VERIFICATION.md` records
this as a by-construction blind spot: Playwright cannot drive `dialog.showOpenDialog`, and clicking
the trigger in a flow would block on a modal OS window. It is split, not waived:

- the trigger (button present, labelled, enabled, wired to the channel) → e2e,
- everything behind the dialog (validate, re-encode, copy, persist, return) → main unit tests with a
  stubbed `showOpenDialog`,
- the OS dialog itself → `manual residue`, the same status as the existing
  `pickFolder`/`pickExecutable` blind spot.

## Plan

**Shape.** `icon` becomes a first-class optional field on `Installation`, not a `moduleData` entry:
`moduleData` has no IPC write path today and no module owns installation identity — the icon sits
next to `favorite`, the existing precedent for "cosmetic identity on the record".

```ts
type InstallationIcon =
  | { kind: 'shipped'; id: string }   // id = basename in src/renderer/src/assets/installations
  | { kind: 'custom' }                // file at userData/installation-icons/<installationId>.png
```

Custom icons carry no path in the record — the location is derived from the installation id, so
there is never a renderer-supplied path in a read hot path (AC7) and a moved source file cannot
break anything (AC4).

**Three new IPC channels** (contract-first, `src/shared/ipc.ts` first):

| Channel | Request | Response |
| --- | --- | --- |
| `installations:setIcon` | `{ installationId, icon: ShippedIcon \| null }` | `Outcome<Installation>` |
| `installations:pickIconFile` | `{ installationId }` | `Outcome<Installation>` |
| `installations:iconDataUrl` | `installationId: string` | `string \| null` |

`pickIconFile` mirrors `installations:pickFolder`
([installations.ts:68-88](../../src/main/ipc/installations.ts#L68-L88)): main owns the dialog, main
validates, main copies. `setIcon` with `null` clears (AC5). `iconDataUrl` is only ever called for
`kind: 'custom'` — shipped icons come from the bundle, iconless installs call nothing (AC9).

**Order.**

1. **D1** — asset pipeline + manifest + the CLAUDE.md deviation. Nothing depends on the UI yet.
2. **D2** — pull today's tile markup out of the three surfaces into one `InstallationTile`, with no
   behaviour change. This is the AC5/AC9 baseline: whatever it renders now is what "pixel-for-pixel
   as it is now" means afterwards.
3. **D3** — contract only: types, zod schemas, channel map. `src/main/ipc/index.test.ts` and the
   compile-time allowlist guard ([ipc.ts:187-191](../../src/shared/ipc.ts#L187-L191)) go green.
4. **D4** — main: the icon store service and the three handlers.
5. **D5** — renderer: the tile actually shows the icon, plus fixture support so e2e can see it.
6. **D6** — renderer: the picker dialog and its trigger on the library card.

D1/D2/D3 are independent of each other; D4 needs D3; D5 needs D2+D3; D6 needs D1+D4+D5.

## Deliverables

### D1 — Shipped icon set in the bundle, plus the recorded deviation ✅

Add `sharp` as a **devDependency** only (never bundled — main uses `nativeImage`) and a
`scripts/generate-installation-icons.mjs` that reads `assets/installations/*.png` and writes 128px
square `.avif` into `src/renderer/src/assets/installations/`. Wire it as an npm script next to the
existing `"icon"` script; commit the generated files. Add
`src/renderer/src/lib/installation-icons.ts` — a manifest built with
`import.meta.glob('../assets/installations/*.avif', { eager: true, import: 'default' })` exposing
`SHIPPED_ICONS: { id, url }[]` sorted by id, plus `shippedIconUrl(id)`. **No component ever names an
icon file** (AC1). Record the deviation row in CLAUDE.md's Deviations table: *bitmaps allowed for
installation identity only*, reason = this story.

- Files: `package.json`, `scripts/generate-installation-icons.mjs`,
  `src/renderer/src/assets/installations/*.avif` (6, generated),
  `src/renderer/src/lib/installation-icons.ts`,
  `src/renderer/src/lib/installation-icons.test.ts`, `CLAUDE.md`.
- Mirror: `scripts/generate-icon.mjs` for the script shape; `BootSplash.tsx:2` for the asset import.
- Acceptance: the manifest test asserts all six ids are present and that the list is derived, not
  literal (adding a fixture file changes the result); `npm run build` emits the assets; CLAUDE.md
  has the row.

### D2 — One `InstallationTile`, three call sites, zero visual change ✅

Extract `src/renderer/src/components/installations/InstallationTile.tsx`. It takes the installation
and a `size` variant and renders exactly today's markup per site — the rail's
`aspect-square w-full` + `text-lg`, the library card's `size-11` + `text-sm`, the action bar's
`size-12` + `text-base text-flame-300` — with `className` passthrough for the per-site border/state
classes. Accessible naming stays where it is today: the rail's `aria-label` on the wrapping button
([InstallationRail.tsx:208](../../src/renderer/src/components/shell/InstallationRail.tsx#L208)), the
card's `title`, the action bar's none. **The tile does not own the button** — it renders the inner
box only, so no aria moves. No icon logic in this D.

- Files: `InstallationTile.tsx`, `InstallationTile.test.tsx`,
  `src/renderer/src/components/shell/InstallationRail.tsx`,
  `src/renderer/src/views/LibraryView.tsx`, `src/renderer/src/components/shell/ActionBar.tsx`.
- Acceptance: the unit test asserts the rendered code text and the class list per variant against
  the values captured from today's source; `npm run ui:verify` produces no new axe violation and the
  existing screens still render the same tiles.

### D3 — Contract: icon on the record and three channels ✅

`InstallationIcon` + `icon?: InstallationIcon` on `Installation`
([installation.ts:68-106](../../src/shared/types/installation.ts#L68-L106)); the three channels in
`IpcInvokeMap` **and** `INVOKE_CHANNELS`; payload schemas in `src/shared/ipc-schemas.ts` (a
shipped-icon id is a bounded slug, never a path); lenient persisted-shape entry in
`src/main/lib/schemas.ts` alongside `moduleData`
([schemas.ts:88](../../src/main/lib/schemas.ts#L88)). Handlers may be stubs returning a
"not implemented" `Outcome` — D4 fills them; the point of this D is that the contract and its guards
are green.

- Files: `src/shared/types/installation.ts`, `src/shared/ipc.ts`, `src/shared/ipc-schemas.ts`,
  `src/main/lib/schemas.ts`, `src/main/ipc/installations.ts`, `src/shared/ipc-schemas.test.ts`.
- Mirror: `updateInstallationInputSchema`
  ([ipc-schemas.ts:62-78](../../src/shared/ipc-schemas.ts#L62-L78)) and `pickPathInputSchema`.
- Acceptance: `npm run typecheck` green (the compile-time allowlist assertions at
  [ipc.ts:187-191](../../src/shared/ipc.ts#L187-L191) prove preload is in sync);
  `src/main/ipc/index.test.ts` covers the three new channels including invalid-payload rejection;
  schema tests reject a path-shaped shipped-icon id.

### D4 — Main: icon store, validation, delivery ✅

New `src/main/services/installation-icons.ts`:

- `setShipped(id, iconId)` / `clear(id)` — writes `icon` through the installations service's
  `commit` path ([installations.ts:201-246](../../src/main/services/installations.ts#L201-L246)) and,
  on clear, deletes any `userData/installation-icons/<id>.png`.
- `pickAndStore(id, window)` — `dialog.showOpenDialog` with a PNG/JPEG filter, then: stat ≤ 4 MB →
  `nativeImage.createFromPath` → reject if `isEmpty()` → `resize({ width: 128, height: 128 })` →
  `toPNG()` → write into `userData/installation-icons/` via `userDataDir()`
  ([paths.ts:5-6](../../src/main/lib/paths.ts#L5-L6)). Failure returns a **failed `Outcome` carrying
  an i18n key** (never prose, never the raw path) and persists nothing (AC6).
- `dataUrl(id)` — reads the stored PNG, returns `data:image/png;base64,…`, `null` if absent.
- Hook into `installations:remove` so a deleted installation takes its icon file with it.

- Files: `src/main/services/installation-icons.ts`, `src/main/services/installation-icons.test.ts`,
  `src/main/ipc/installations.ts`, `src/main/services/installations.ts`,
  `src/renderer/src/i18n/locales/en.json` (error keys),
  `src/main/lib/renderer-source.test.ts` (CSP-verbatim assertion).
- Mirror: `showOpenDialog()`
  ([installations.ts:93-104](../../src/main/ipc/installations.ts#L93-L104)); userData writes as in
  `src/main/modules/config/index.ts:1461`.
- Acceptance: unit tests with a stubbed `showOpenDialog` cover the happy path, the four refusals
  (>4 MB, wrong extension, corrupt bytes, cancelled) and AC4 (delete the source file after the pick,
  `dataUrl` still returns the icon).

### D5 — The tile shows the icon, on all three surfaces ✅

`useInstallationIcon(installation)` in `src/renderer/src/components/installations/` — returns
`shippedIconUrl(icon.id)` for `kind: 'shipped'`, and for `kind: 'custom'` fetches
`installations:iconDataUrl` once and caches it in the launcher store; returns `null` for no icon
**without touching IPC** (AC9). `InstallationTile` renders `<img alt="" aria-hidden="true">` filling
the box when a url is present, otherwise today's code span — same box, so no layout shift. Extend
`scripts/lib/fixture.mjs` (`makeInstallation()` at `:75`, `populatedInstallations()` at `:108`) so
the populated variant seeds one shipped-icon install, one custom-icon install (with its PNG written
into the fixture userData) and leaves the rest iconless.

- Files: `useInstallationIcon.ts`, `InstallationTile.tsx`, `InstallationTile.test.tsx`,
  `src/renderer/src/store/useLauncher.ts`, `scripts/lib/fixture.mjs`,
  `scripts/flows/installation-icon-tile.mjs`.
- Mirror: `updateInstallation`
  ([useLauncher.ts:217-221](../../src/renderer/src/store/useLauncher.ts#L217-L221)) for the
  store→IPC shape; `scripts/flows/controls-drag-reorder.mjs` for the flow shape.
- Acceptance: the e2e flow asserts rail, card and action bar all show the seeded icons after a fresh
  launch (AC3's restart half is exactly this — the fixture is on-disk state), that the iconless
  installs still show their code, and that the tile's accessible name is unchanged (AC8);
  `npm run ui:verify`'s axe report gains nothing.

### D6 — The picker dialog and its trigger ✅

New dialog kind `{ kind: 'installationIcon', installationId }` in the `DialogState` union
([useLauncher.ts:32-41](../../src/renderer/src/store/useLauncher.ts#L32-L41)), a case in
`components/installations/Dialogs.tsx:18-33`, and `SetInstallationIconDialog.tsx`: a grid of
`SHIPPED_ICONS` (D1's manifest), a "choose a file" button calling `installations:pickIconFile`, and a
"clear" action calling `setIcon(null)` — the latter enabled only when an icon is set. A failed
`Outcome` surfaces its i18n key as a translated inline message; the dialog stays open and the current
icon is untouched (AC6). Trigger: a new `size="sm"` IconButton in the library card's action cluster
next to rename/cleanup
([LibraryView.tsx:320-336](../../src/renderer/src/views/LibraryView.tsx#L320-L336)) — the existing
28px dense-row deviation already covers the size. Strings under `dialog.installationIcon.*` and
`installation.action.setIcon`.

- Files: `SetInstallationIconDialog.tsx`, `SetInstallationIconDialog.test.tsx`,
  `src/renderer/src/components/installations/Dialogs.tsx`, `src/renderer/src/store/useLauncher.ts`,
  `src/renderer/src/views/LibraryView.tsx`, `src/renderer/src/i18n/locales/en.json`,
  `scripts/flows/installation-icon-pick.mjs`.
- Mirror: `RenameInstallationDialog.tsx` end to end (dialog kind → cluster button → store action).
- Acceptance: the e2e flow opens the picker from the card, picks a shipped icon and sees every
  surface change; clears it and sees the code tile return; asserts the "choose a file" button is
  present, labelled and enabled **without clicking it** (the named gap above).

## Model Hints

- **D4 → `deliverable-hard`.** It is the only D that takes a renderer-triggered OS path, writes into
  `userData` and decodes untrusted bytes: a `nativeImage` that silently returns an empty image for a
  renamed `.txt`, a 4 MB stat check that has to run *before* the decode, and an icon-file lifecycle
  that has to be torn down by `installations:remove` or it leaks orphans into `userData` forever.
- **D1, D2, D3, D5, D6 → default.** D2 is a mechanical extraction whose regression surface is pinned
  by its own class-list test plus the existing `ui:verify` screens; D3 is contract typing that the
  compile-time guards catch; D5/D6 follow `RenameInstallationDialog` step for step.
- **Review: → `story-review-hard`.** The story crosses shared contract, main filesystem writes and
  three UI surfaces at once, and it lands a written deviation from a repo-wide rule ("no image assets
  in the UI") — a reviewer that only sees the diff has to check the deviation is scoped to the tile
  and has not quietly leaked onto other surfaces.

## Acceptance Tests

- AC1 → e2e `scripts/flows/installation-icon-pick.mjs` › "the picker offers every shipped icon"
  (D6), plus unit `src/renderer/src/lib/installation-icons.test.ts` › "the shipped set is derived
  from the asset directory, not from a literal list" (D1)
- AC2 → unit `src/main/services/installation-icons.test.ts` › "a picked PNG is stored and becomes the
  installation's icon" (D4, `showOpenDialog` stubbed) + e2e
  `scripts/flows/installation-icon-pick.mjs` › "the choose-a-file trigger is present and enabled"
  (D6). **manual residue:** the native `dialog.showOpenDialog` window itself — an OS-level dialog
  Playwright cannot drive, the same blind spot already recorded for
  `installations:pickFolder`/`pickExecutable` in `docs/UI-VERIFICATION.md`.
- AC3 → e2e `scripts/flows/installation-icon-tile.mjs` › "a seeded icon shows on rail, card and
  action bar after a fresh launch" (D5 — the fixture is on-disk state, so a fresh launch *is* the
  restart)
- AC4 → unit `src/main/services/installation-icons.test.ts` › "the icon survives deleting the file it
  was picked from" (D4)
- AC5 → e2e `scripts/flows/installation-icon-pick.mjs` › "clearing the icon brings the code tile
  back" (D6) + unit `src/renderer/src/components/installations/InstallationTile.test.tsx` › "without
  an icon the tile renders today's code and class list" (D2, extended in D5)
- AC6 → unit `src/main/services/installation-icons.test.ts` › "an unusable pick is refused and
  nothing is persisted" (D4, table-driven: >4 MB / wrong extension / corrupt bytes / cancelled) +
  unit `SetInstallationIconDialog.test.tsx` › "a failed outcome shows a translated message and keeps
  the dialog open" (D6)
- AC7 → unit `src/main/ipc/index.test.ts` › "the icon channels reject invalid payloads" (D3) + unit
  `src/shared/ipc-schemas.test.ts` › "a shipped-icon id may not be a path" (D3) + unit
  `src/main/lib/renderer-source.test.ts` › "the production CSP is unchanged" (D4 — asserts the CSP
  string verbatim, so any later relaxation fails the suite)
- AC8 → e2e `scripts/flows/installation-icon-tile.mjs` › "the tile keeps its accessible name with an
  icon present" (D5) + the `npm run ui:verify` axe report, which must gain no violation (D5)
- AC9 → unit `InstallationTile.test.tsx` › "never calls fetchIconDataUrl when the installation has
  no icon (AC9)" (D5, the store-boundary proof that no `installations:iconDataUrl` invoke is
  issued) + the variant class-list assertions (D2) + e2e
  `scripts/flows/installation-icon-tile.mjs` › "rail: shipped icon renders as an `<img>`, iconless
  install keeps its code tile" (D5, the DOM/visual half: no `<img>`, no layout placeholder, on the
  real built app). **Narrowed from the original plan during finishing/review:** an earlier version
  of the e2e flow tried to prove "no extra request" itself by reassigning `window.q2.invoke` from
  Playwright; that is not possible, because Electron's `contextBridge.exposeInMainWorld` deep-freezes
  the exposed bridge object (`Object.isFrozen(window.q2) === true`, `writable: false` on both
  `window.q2` and `window.q2.invoke` - confirmed empirically), which is the same guarantee that
  makes contextIsolation meaningful in the first place. Reaching around it would mean shipping
  renderer-observability code for one test's sake. The call-count guarantee is fully proven by the
  unit test instead; the e2e flow proves only what a unit test cannot reach (the real DOM render).

### Coverage gate

| AC | Deliverable | Test |
| --- | --- | --- |
| AC1 | D6 (+D1) | e2e picker flow + manifest unit |
| AC2 | D4 (+D6) | main unit with stubbed dialog + e2e trigger; OS dialog = residue |
| AC3 | D5 | e2e tile flow |
| AC4 | D4 | main unit |
| AC5 | D6 (+D2) | e2e picker flow + tile unit |
| AC6 | D4 (+D6) | main unit (table) + dialog unit |
| AC7 | D3, D4 | ipc coverage + schema unit + CSP-verbatim unit |
| AC8 | D5 | e2e tile flow (rail + library-card accessible-name assertions) + axe report |
| AC9 | D5 (+D2) | tile unit (call-count proof) + e2e tile flow (DOM proof) |

Every criterion has a deliverable and a named test. The single residue is AC2's OS dialog, with a
reason the profile accepts.

## Done

Picked up mid-story: all six deliverables (D1–D6) were already implemented in the working tree
when this session started, following a prior build agent's rate-limit cutoff before verification
and review. This session verified each deliverable against the plan, ran the full verification
suite, commissioned a `story-review-hard` review, fixed its findings, and closed out the story.

**What was built** (per the Plan): a shipped icon set generated at build time
(`scripts/generate-installation-icons.mjs` → 128px `.avif` in
`src/renderer/src/assets/installations/`, discovered via `import.meta.glob` so no component names a
file), one shared `InstallationTile` extracted from the rail/library-card/action-bar's previously
duplicated markup, an `InstallationIcon` field on `Installation` plus three new IPC channels
(`installations:setIcon`/`pickIconFile`/`iconDataUrl`, contract-first in `shared/ipc.ts` +
`ipc-schemas.ts`), a main-process `InstallationIconsService` that owns the OS file dialog, validates
(extension → size → decode, in that order), re-encodes to a fixed 128px PNG and stores it at
`userData/installation-icons/<id>.png` (never a renderer-supplied path), a renderer-side
`useInstallationIcon` hook with a request-once cache, and a `SetInstallationIconDialog` reachable
from the library card's new "Set icon…" action.

### Decisions

- **AC9's e2e leg dropped an unworkable spy, not the guarantee.** The original flow tried to prove
  "no extra `installations:iconDataUrl` call" by reassigning `window.q2.invoke` from Playwright.
  Confirmed empirically that this cannot work: Electron's `contextBridge.exposeInMainWorld`
  deep-freezes the exposed object (`Object.isFrozen(window.q2) === true`, `writable: false` on both
  `window.q2` and `window.q2.invoke`) — the same property that makes contextIsolation meaningful.
  Reaching around it would mean shipping renderer-observability code for one test's sake. The
  call-count guarantee is now proven entirely by the unit test
  (`InstallationTile.test.tsx` › "never calls fetchIconDataUrl when the installation has no icon
  (AC9)"); the e2e flow proves only the DOM/visual half (no `<img>`, no layout placeholder). Story's
  `## Acceptance Tests`/coverage gate updated to match.
- **Shipped-icon `<img src>` assertions compare values, not substrings.** Two e2e flows originally
  asserted an icon's `<img src>` contains its filename (e.g. `"gate"`). Wrong: Vite inlines bundled
  assets under its default 4 KB threshold as `data:` URLs instead of emitting a named file — three of
  the six shipped `.avif`s (`gate`, `portal`, `ring`) are under that threshold. Fixed both flows to
  compare `<img src>` values for equality against a known-correct reference (rail vs. library-card
  src equality in `installation-icon-tile.mjs`; the picker's own swatch `<img src>`, captured before
  the click, in `installation-icon-pick.mjs`) instead of substring-matching a filename.
- **Custom-icon fixture PNG made opaque, not transparent.** `scripts/lib/fixture.mjs`'s seeded custom
  icon was a fully transparent 1×1 pixel — real plumbing, but every e2e screenshot showed an empty
  box. Swapped for an opaque 1×1 orange pixel (this app's own flame accent, RGB 255,90,31), verified
  byte-for-byte via `sharp` (already a devDependency from D1) before wiring it in.
- **F1 fix left untested at first, then covered.** The `story-review-hard` review (see below) found a
  real bug: `useLauncher`'s `iconDataUrls` cache was never invalidated, so re-picking a custom icon
  (or clear-then-repick) would keep showing the *previous* `data:` URL on all three surfaces until a
  restart. Fixed with a `withoutIconDataUrl` helper called from both `setInstallationIcon` and
  `pickInstallationIconFile` on success. Initially shipped without a regression test on the
  (incorrect) assumption that this store had no test precedent; the review's confirmation pass
  pointed out `SetInstallationIconDialog.test.tsx` already stubs `window.q2.invoke` and drives the
  real store, so a regression test was added there and verified to actually fail without the fix
  (reverted the fix, confirmed red, restored it, confirmed green).

### Verification

- `npm run typecheck` — green.
- `npm run build` — green; confirmed all 6 shipped `.avif` assets reach the bundle (3 emitted as
  files, 3 inlined as `data:` URLs per Vite's default `assetsInlineLimit`, both valid).
- `npm test` — 2712/2712 (1 pre-existing, unrelated Windows timing flake in
  `import-reader.test.ts`'s 512-file-exec-expansion test under full-suite load; 32/32 green in
  isolation — same class of flake already documented for stories 065/068).
- `npm run ui:verify` — 34/34 screens, 0 axe violations.
- `npm run ui:flow -- installation-icon-tile` and `-- installation-icon-pick` — both green.

### Review

Two `story-review-hard` passes (per Model Hints — the story crosses the shared IPC contract, main
filesystem writes and three UI surfaces, plus a CLAUDE.md deviation from "no image assets in the
UI").

- **Pass 1: FAIL.** Confirmed AC1–AC9 individually PASS on the diff as it stood, but found two
  must-fix defects: **F1** (icon-cache invalidation bug, above) and **F2** (D2's rail extraction had
  moved `grid place-items-center` off `RailTile`'s `<button>` onto the child tile, leaving the button
  `display: inline-block` by default — a ~5px inline-formatting-context gap that shifted every rail
  tile below an icon-bearing one, breaking D2's own "zero visual change" claim; measured 59.33px vs.
  64.33px). Also six lower-severity findings (F3–F8: CLAUDE.md deviation wording not naming the
  picker dialog explicitly; AC9's story doc not yet updated for the dropped spy; the fixture's
  transparent custom-icon PNG; a latent accessibility regression where the library card's tile lost
  its distinguishing accessible name once an icon replaced its code-text content; a cancelled
  file-dialog surfacing as a red alert; unrelated uncommitted changes to other stories' files in the
  same branch).
- **Fixes applied:** F1 (cache invalidation + later a regression test), F2 (`RailTile`'s button
  className → `block`, re-measured pixel-identical to the untouched control tile), F3 (CLAUDE.md
  wording), F4 (story doc), F5 (opaque fixture pixel), F6 (`aria-label={installation.name}` on the
  library card's select-button, mirroring the rail's own pattern, plus a new e2e assertion). F7
  (cancel → red alert) and F8 (unrelated file changes) accepted as-is: F7 matches the story's own
  AC6 test-table design (cancel is one of four refusal cases, each with its own translated message);
  F8 predates this session and is out of scope for a story that is never committed by this agent.
- **Pass 2 (two independent confirmation runs, one via a fresh `story-review-hard` agent, one by
  resuming pass 1's agent): both PASS.** Re-verified F1/F2 concretely (F1: read the full
  invalidation→re-render→re-fetch chain; F2: re-measured all rail tiles at a uniform 59.333px,
  identical to the untouched "Add an installation" control). One residual, non-blocking finding
  (**R1**): the F1 fix's regression test didn't exist yet at review time — added afterward, verified
  it fails without the fix and passes with it. Two informational notes accepted as documented, not
  fixed: **N1**, the e2e tile flow's `railTile()` helper is a page-wide role+name locator that would
  become ambiguous if a future edit reused it after navigating to Library (now that the library card
  shares the rail's `aria-label` pattern) — commented in place rather than restructured, since no
  current step does that; **N2**, a stale test comment in `ipc-schemas.test.ts` claiming the shipped
  icon lookup does a filesystem join (it doesn't — it's a bundled manifest map) — corrected.

### AC → test mapping, as verified

| AC | Test(s) | Result |
| --- | --- | --- |
| AC1 | `installation-icons.test.ts` (manifest derived, not literal) + e2e `installation-icon-pick.mjs` | PASS |
| AC2 | `installation-icons.test.ts` › pickAndStore + e2e trigger-present assertion; **manual residue:** the native `dialog.showOpenDialog` window, same class as `pickFolder`/`pickExecutable` | PASS (trigger); residue as planned |
| AC3 | e2e `installation-icon-tile.mjs` (fixture is on-disk state, so a fresh launch is the restart) | PASS |
| AC4 | `installation-icons.test.ts` › "the icon survives deleting the file it was picked from" | PASS |
| AC5 | e2e `installation-icon-pick.mjs` + `InstallationTile.test.tsx` | PASS |
| AC6 | `installation-icons.test.ts` (table: >4MB / wrong extension / corrupt bytes / cancelled) + `SetInstallationIconDialog.test.tsx` | PASS |
| AC7 | `ipc/index.test.ts` + `ipc-schemas.test.ts` + `renderer-source.test.ts` (CSP pinned verbatim) | PASS |
| AC8 | e2e `installation-icon-tile.mjs` (rail `aria-label` unaffected + library-card `aria-label` fix/assertion) + axe report | PASS |
| AC9 | `InstallationTile.test.tsx` (call-count proof) + e2e `installation-icon-tile.mjs` (DOM proof) | PASS |

Commit message: `067: an installation carries an icon I choose`
