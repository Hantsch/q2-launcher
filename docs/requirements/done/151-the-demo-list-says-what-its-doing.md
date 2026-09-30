---
id: 151
title: the demo list says what it's doing
status: done # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

A user opens the Demos view and always knows why they see what they see: the scan is still running
(and how far it is), there are no demos at all (and where to add a folder), or one source could not
be read while the others could (concept `docs/concepts/demo-browser.md` §10 "States", DEMO-19) — the
same explicitness the servers list got in [[121]].

## Acceptance Criteria

- [x] **AC1** — While a scan runs, the list shows a loading state with live counts from [[144]]'s
      progress event (scanned / total).
- [x] **AC2** — With no demos in any source, the list shows "no demos found" with a link into the
      demos settings section where extra folders are added ([[142]]).
- [x] **AC3** — A source that is missing or unreadable (deleted extra folder, permission denied,
      archive that fails to open) shows a per-source error naming the source and the reason, while
      demos from every other source stay listed.
- [x] **AC4** — After a scan finishes, the loading state gives way to the list (or the empty state)
      without a manual reload.
- [x] **AC5** — Each state is a `ui:verify` screen with zero axe violations.

## Open Questions

<!-- None known from the concept. None raised in refine. -->

## Decisions (Sprint)

- **Loading mirrors [[121]]:** while a scan runs, a status strip with live counts sits between the
  header and the list, and rows already known (cache-first, [[144]]) stay listed under it — the
  servers list does exactly this, and hiding cached rows during a refresh would be a regression.
- **No empty flash:** the view starts in "scanning" (it always calls `scan.start` on mount), so
  "no demos found" appears only after a `running: false` push with zero rows — an empty cache
  during a running scan is not "no demos".
- **Counts are the sum over all sources** (`scanned` / `total` of every `scan.progress` source); a
  push with no sources yet ("still discovering") shows the existing "Looking for demos…" line
  without numbers — one number pair is what AC1 asks for, and [[144]] only knows totals after
  discovery.
- **What counts as a per-source error:** an extra folder that is missing / not a folder / not
  readable, an installation `demos` folder that exists but cannot be read, and a zip that fails to
  open (the three existing `ArchiveError` codes); an installation game dir *without* a `demos`
  folder is normal and never an error — otherwise every fresh installation would show a warning.
- **Reasons are a closed enum** `missing | notAFolder | permissionDenied | unreadable |
  extractor-missing | archive-unreadable | archive-too-large`, sent as codes and translated in the
  renderer — CLAUDE.md: main sends keys/codes, never prose; the archive codes keep their existing
  spelling from `zip-demos.ts` so nothing is remapped.
- **Errors ride on `scan.progress`** (a `sourceErrors` array on every push: the last finished
  scan's while running, the new scan's on the final push; a throwing scan keeps the previous) — the
  view already subscribes to it and always starts a scan on mount, so no new handler is needed.
- **An error names its source** with the same label a row uses (installation · game dir, or the
  extra folder's path) plus the archive's *file name* for a zip — the extra-folder path already
  crosses IPC in `demoSourceSchema`; a full archive path is not needed to name it.
- **Settings link** reuses `ServersView`'s `handleOpenSourceSettings` pattern (route to Settings,
  scroll `settings-section-replays` into view) — that section is where [[142]] adds extra folders.
- **Default-size button** for the empty state's link, so no new touch-target deviation row is
  needed.
- **Loading is made observable by a harness-only scan hold:** a file
  `<userData>/harness-replays-scan-hold-ms`, honoured only under the UI harness (same gate as
  `discoveryHomeDir`), pauses the scan after discovery — screens cannot carry env vars, a
  userData file is variant-scoped by construction (the lesson of 951be08), and a five-demo fixture
  scans too fast to screenshot otherwise.
- **Permission denied is proven at unit level** (error-code classification with injected `EACCES`/
  `EPERM`) — Windows cannot deny a folder read in a fixture reliably; the rendering path of a
  reason is the same one the e2e flows prove with a missing folder and a broken zip.

## Plan

Builds on [[150]]'s rewritten `ReplaysView` (build order 150 → 151): this story does not touch the
row/list rendering, only what surrounds it.

1. **Discovery reports source errors** (main, pure-ish): `discoverDemos` returns `sourceErrors`
   (replacing `archiveErrors`) with a `DemoSource`, optional archive name and a reason code; a new
   `listDirOrReason` in `fs-utils.ts` classifies `readdir` failures. Shared schema in
   `src/shared/modules/replays.ts`.
2. **Scan service carries them** on every `scan.progress` push; `index.ts` passes them through
   `discover`, and wires the harness-only scan hold.
3. **Renderer states:** pure `list-state.ts` (derive state + progress line), `ReplaysListStatus.tsx`
   (loading strip / empty + settings link / per-source errors), wired into `ReplaysView.tsx`; i18n
   keys under `replays.list.*`; CHANGELOG entry.
4. **Surface proof:** fixture variants `replays-list-loading` / `replays-list-error`, three
   `ui:verify` screens (loading, empty, error), three `ui:flow` scripts.

Order: D1 → D2 → D3 → D4. Files: `src/main/lib/fs-utils.ts`, `src/main/modules/replays/
{discovery,scan-service,index}.ts`, `src/shared/modules/replays.ts`,
`src/renderer/src/modules/replays/{list-state.ts,ReplaysListStatus.tsx,ReplaysView.tsx}`,
`en.json`, `CHANGELOG.md`, `scripts/lib/{fixture,screens}.mjs`, `scripts/flows/replays-list-*.mjs`.

## Deliverables

- [x] **D1 — discovery reports per-source errors.**
  - `src/shared/modules/replays.ts`: add `replaysSourceErrorReasonSchema = z.enum(['missing',
    'notAFolder', 'permissionDenied', 'unreadable', 'extractor-missing', 'archive-unreadable',
    'archive-too-large'])` and `replaysSourceErrorSchema = z.object({ source: demoSourceSchema,
    archiveName: z.string().min(1).nullable(), reason: replaysSourceErrorReasonSchema })`, plus
    exported types `ReplaysSourceError` / `ReplaysSourceErrorReason`. Do not touch
    `replaysScanProgressSchema` here (D2 does).
  - `src/main/lib/fs-utils.ts`: add `listDirOrReason(dir)` → `{ ok: true, listing: DirListing } |
    { ok: false, reason: 'missing' | 'notAFolder' | 'permissionDenied' | 'unreadable' }`, sharing
    `listDir`'s entry loop (do not change `listDir`'s behaviour — it has many callers), plus an
    exported pure `dirReadFailureReason(code: string | undefined)`: `ENOENT`→`missing`,
    `ENOTDIR`→`notAFolder`, `EACCES`/`EPERM`→`permissionDenied`, anything else→`unreadable`.
  - `src/main/modules/replays/discovery.ts`: `discoverDemos` returns `{ demos, sourceErrors }`
    (replaces `ArchiveError`/`archiveErrors`; update the doc comments that say "never throws /
    contributes nothing" to say what is now reported). Rules: (a) an extra folder whose scan
    `listDirOrReason` fails → one error `{ source: { kind: 'extraFolder', path: canonical },
    archiveName: null, reason }`; (b) an installation (root or write-dir) `demos` folder that
    `findDemosDir` found but that cannot be listed → one error with the installation source for
    that game dir; (c) a game dir with **no** `demos` folder, or a write dir the engine never
    created, is **not** an error; (d) each failed zip → `{ source, archiveName: <zip file name>,
    reason: <existing code> }`; (e) an extra folder skipped because it equals an installation's
    demos dir produces nothing. Demos from every other source are unaffected.
  - Callers: `src/main/modules/replays/index.ts`'s legacy `demosList` handler just keeps
    destructuring `demos` (compile fix only; D2 rewires `discover`).
  - Tests in `src/main/modules/replays/discovery.test.ts` (mirror its existing temp-dir setup):
    "a missing extra folder is reported and the other sources still list", "a file where an
    extra folder should be is reported as notAFolder", "an installation game dir without a demos
    folder reports nothing", "a broken zip is reported with its archive name while its folder's
    loose demos still list"; and in the existing `src/main/lib/fs-utils.test.ts` (extend) ›
    "dirReadFailureReason classifies ENOENT, ENOTDIR, EACCES, EPERM and other codes".

- [x] **D2 — the scan service pushes source errors; harness scan hold.**
  - `src/shared/modules/replays.ts`: `replaysScanProgressSchema` gains
    `sourceErrors: z.array(replaysSourceErrorSchema)` (required; `replaysSourceErrorSchema`
    already exists from D1).
  - `src/main/modules/replays/scan-service.ts`: `CreateReplaysScanServiceOptions.discover` now
    resolves to `{ demos: DiscoveredDemoFile[]; sourceErrors: ReplaysSourceError[] }`. The service
    keeps `lastSourceErrors` (initially `[]`). Every push while running carries `lastSourceErrors`;
    on success, after the snapshot swap, `lastSourceErrors` becomes this scan's errors and the
    final `running: false` push carries them; on a throw, the previous `lastSourceErrors` stay.
    New optional option `holdAfterDiscovery?: () => Promise<void>`, awaited right after the
    post-discovery `emitProgress(true)` (the one that carries the totals) and before
    `runIncrementalScan`.
  - `src/main/modules/replays/index.ts`: `discover` returns both fields of `discoverDemos`. Add
    exported `scanHoldMs({ env, userData })`, mirroring `discoveryHomeDir`'s signature and exact
    harness gate: `0` unless `isUiHarnessEnabled` and `<userData>/harness-replays-scan-hold-ms`
    exists and holds a positive integer (clamp to ≤ 60 000; unreadable/garbage → 0). Read at each
    scan start; `holdAfterDiscovery` sleeps that long (skip when 0).
  - Tests: `src/main/modules/replays/scan-service.test.ts` (extend; every push must still pass
    `replaysScanProgressSchema`) › "the final push carries this scan's source errors",
    "running pushes carry the previous scan's source errors", "a throwing scan keeps the previous
    source errors", "holdAfterDiscovery runs after the totals push and before any parse";
    `src/main/modules/replays/index.test.ts` (extend, mirror the `discoveryHomeDir` tests) ›
    "scanHoldMs is 0 outside the harness, reads the file under it, and ignores garbage".

- [x] **D3 — the list says what it's doing (renderer).** Do not change the row/list markup story
  150 left in `ReplaysView.tsx` — only its loading/empty branches and what sits above the list.
  - New `src/renderer/src/modules/replays/list-state.ts` (mirror
    `src/renderer/src/modules/servers/list-state.ts`): `deriveReplaysListState({ scanning,
    rowCount })` → `'loading' | 'empty' | 'populated'` (`loading` wins while scanning, even with
    rows; `empty` only when not scanning and 0 rows), and `describeReplaysScanProgress(progress)` →
    `{ key: 'replays.list.loading' }` when no source has a total yet, else
    `{ key: 'replays.list.loadingProgress', params: { scanned, total } }` summed over all sources.
  - New `src/renderer/src/modules/replays/ReplaysListStatus.tsx` (mirror
    `src/renderer/src/modules/servers/ServersListStatus.tsx`): loading strip `role="status"
    aria-live="polite"` `data-testid="replays-list-loading"` with `data-scanned`/`data-total`
    and a `Spinner`; empty block `data-testid="replays-list-empty"` with the existing
    `replays.list.empty` text and a **default-size** `Button` `data-testid="replays-list-empty-settings"`
    (`replays.list.openSettings`); a source-errors block `data-testid="replays-list-source-errors"`
    with one row per error `data-testid="replays-list-source-error"` carrying `data-reason`, an
    `AlertTriangle` icon plus text (never colour alone) `t('replays.list.sourceError', { source,
    reason })`. Source label: installation → `replays.list.source` ({installation, gameDir}),
    extra folder → `replays.source.extraFolder` ({path}); with an `archiveName` →
    `replays.list.sourceErrorArchive` ({ base, archive }). Reason →
    `replays.list.sourceErrorReason.<reason>`. Renders nothing when populated and no errors.
  - `src/renderer/src/modules/replays/ReplaysView.tsx`: `scanning` starts `true` (the view always
    calls `scanStart()` on mount) and is set `false` if `scanStart()` resolves `ok: false`; keep
    the latest `ReplaysScanProgress` and its `sourceErrors` in state; render `ReplaysListStatus`
    between the header and the scroll area; the list itself renders whenever rows exist. The
    settings handler mirrors `ServersView.tsx`'s `handleOpenSourceSettings` (`setRoute(ROUTE_SETTINGS)`,
    double `requestAnimationFrame`, scroll `[data-testid="settings-section-replays"]` into view).
    Remove the old inline `replays-list-loading`/`replays-list-empty` `<p>`s (their testids move to
    the new component).
  - `src/renderer/src/i18n/locales/en.json` (`replays.list`): `loadingProgress` ("Reading demos…
    {{scanned}} of {{total}}"), `openSettings` ("Add a demo folder in Settings"), `sourceError`
    ("Couldn't read {{source}}: {{reason}}"), `sourceErrorArchive` ("{{base}} · {{archive}}"),
    `sourceErrorReason.{missing,notAFolder,permissionDenied,unreadable,extractor-missing,
    archive-unreadable,archive-too-large}` (plain user wording, e.g. "the folder no longer
    exists", "access was denied", "the archive could not be opened").
  - `CHANGELOG.md`: one `### Added` line in the current section (Keep-a-Changelog headings).
  - Tests: new `src/renderer/src/modules/replays/list-state.test.ts` › "loading wins while a scan
    runs, even with rows", "empty only after the scan finished with no rows", "progress sums every
    source and has no numbers before discovery"; extend
    `src/renderer/src/modules/replays/ReplaysView.test.tsx` (mirror its client mocks) › "an empty
    cache during a running scan shows loading, not empty", "a finished scan with source errors
    lists each error next to the remaining demos".

- [x] **D4 — surface proof: fixtures, screens, flows.**
  - `scripts/lib/fixture.mjs`: `writeReplaysListLoadingFixture({ holdMs = 15000 } = {})` =
    `writePopulatedFixture({ variant: 'replays-list-loading' })` plus the text file
    `<that variant's userData>/harness-replays-scan-hold-ms` = `holdMs`;
    `writeReplaysListErrorFixture()` = `writePopulatedFixture({ variant: 'replays-list-error',
    stateOverrides })` whose `replays` state (keep every other field `populatedStateDocument`
    puts under `replays`) lists two extra folders: one path under the variant's userData that is
    never created, one variant-scoped folder under that userData holding `broken.zip` (a few
    garbage bytes — fails whether or not 7za is vendored). Nothing of either may be written into
    `gameRoot()` or the `populated` variant (see the 951be08 regression note on
    `writeReplaysDemosFixture()`). Register both in `writeFixture` and `FIXTURE_VARIANTS`; export
    the missing-folder path and `REPLAYS_FIXTURE_DEMOS` stays as is.
  - `scripts/lib/screens.mjs` (mirror `servers-list-loading`/`-empty`/`-error` and the existing
    `replays-list` entry): `replays-list-loading` (variant `replays-list-loading`,
    `coldStart: true`, waits until `replays-list-loading`'s `data-total` > 0),
    `replays-list-empty` (variant `empty`, waits for `replays-list-empty`), `replays-list-error`
    (variant `replays-list-error`, waits for `replays-list-source-errors` **and** a
    `replays-demo-row`). Add the new testids to the file's header testid index.
  - Flows (mirror `scripts/flows/replays-discovered-list.mjs`; each `export const variant` and
    reseeds itself in `setup()` like `bootstrap-wizard.mjs` does):
    - `scripts/flows/replays-list-loading.mjs` (variant `replays-list-loading`, setup calls
      `writeReplaysListLoadingFixture({ holdMs: 3000 })`): set a `window` marker, open Demos,
      assert `replays-list-loading` visible with `data-total` = `REPLAYS_FIXTURE_DEMOS.length` and
      its text containing both numbers; then wait (≤ hold + 8 s) for `replays-demo-list` with
      `REPLAYS_FIXTURE_DEMOS.length` rows and `replays-list-loading` gone, and assert the marker
      survived (no reload).
    - `scripts/flows/replays-list-empty.mjs` (variant `empty`): open Demos, assert
      `replays-list-empty` text, click `replays-list-empty-settings`, assert
      `settings-section-replays` is visible and in the viewport.
    - `scripts/flows/replays-list-error.mjs` (variant `replays-list-error`, setup calls
      `writeReplaysListErrorFixture()`): wait for scan end; assert exactly two
      `replays-list-source-error` rows — one `data-reason="missing"` whose text contains the
      missing folder's path, one whose text contains `broken.zip` with `data-reason` in the three
      archive codes — and that all `REPLAYS_FIXTURE_DEMOS` rows are still listed.
  - Verify: `npm run ui:flow -- replays-list-loading` / `-empty` / `-error`, and
    `npm run ui:verify` with zero axe violations on the three new screens.

## Model Hints

- D1–D4 → default tier (no D carries a cross-module subtlety beyond what its own tests pin).
- Review: → default — the tempting wrong implementations (empty flash during a running scan,
  every demos-less game dir reported as an error, errors hiding other sources) are each pinned by a
  named unit test and an e2e assertion.

## Acceptance Tests

- AC1 → e2e `scripts/flows/replays-list-loading.mjs` › "replays-list-loading" (strip visible with
  `data-total` = fixture count and both numbers in its text); unit
  `src/renderer/src/modules/replays/list-state.test.ts` › "progress sums every source and has no
  numbers before discovery".
- AC2 → e2e `scripts/flows/replays-list-empty.mjs` › "replays-list-empty" (text + link lands on
  `settings-section-replays`).
- AC3 → e2e `scripts/flows/replays-list-error.mjs` › "replays-list-error" (missing folder + broken
  zip named with reason, fixture demos still listed); unit
  `src/main/modules/replays/discovery.test.ts` › "a missing extra folder is reported and the other
  sources still list" / "a broken zip is reported with its archive name while its folder's loose
  demos still list" / "an installation game dir without a demos folder reports nothing"; unit
  `src/main/lib/fs-utils.test.ts` › "dirReadFailureReason classifies ENOENT, ENOTDIR, EACCES,
  EPERM and other codes" (permission denied — see Decisions); unit
  `src/main/modules/replays/scan-service.test.ts` › "the final push carries this scan's source
  errors".
- AC4 → e2e `scripts/flows/replays-list-loading.mjs` › "replays-list-loading" (loading gives way to
  the list, marker proves no reload); unit `src/renderer/src/modules/replays/ReplaysView.test.tsx`
  › "an empty cache during a running scan shows loading, not empty"; `list-state.test.ts` › "empty
  only after the scan finished with no rows".
- AC5 → e2e `npm run ui:verify` › screens `replays-list-loading`, `replays-list-empty`,
  `replays-list-error` (plus the existing populated `replays-list`), zero axe violations each.

Coverage: AC1 → D2+D3+D4 · AC2 → D3+D4 · AC3 → D1+D2+D3+D4 · AC4 → D3+D4 · AC5 → D4.

## Done

Discovery/scan-service now report per-source errors (`ReplaysSourceError`, closed reason enum) on
every `scan.progress` push instead of silently dropping unreadable extra folders/demos dirs/zips;
demos from unaffected sources keep listing. Renderer gained `list-state.ts` +
`ReplaysListStatus.tsx`: a loading strip with live scanned/total counts, an empty state with a
settings link, and a per-source error block — wired into `ReplaysView.tsx` without touching 150's
row/list rendering. A harness-only scan hold (`harness-replays-scan-hold-ms`) makes the loading
state screenshot/flow-able. New fixtures/screens/flows prove all three states plus the existing
populated screen at zero axe violations.

Commit message: `151: the demo list says what it's doing`

Verification — narrow gate: `npm run build` green, `npm run typecheck` green,
`npx vitest run --changed HEAD` green (160 files, 2319 passed, 8 skipped, 0 failed),
`npm run ui:flow -- replays-list-loading` / `-empty` / `-error` all green (loading flow's initial
data-total=0 vs 5 race — asserting before the first real progress push landed — fixed in the flow
itself, no product code change), `npm run ui:verify` scoped to `replays-list,
replays-list-loading, replays-list-empty, replays-list-error` green (0 axe violations, both
viewports, all four screens). AC → test mapping, all verified passing: AC1 → e2e
`replays-list-loading` flow + unit `list-state.test.ts` › "progress sums every source and has no
numbers before discovery"; AC2 → e2e `replays-list-empty` flow; AC3 → e2e `replays-list-error`
flow + unit `discovery.test.ts` (3 named cases) + `fs-utils.test.ts` ›
"dirReadFailureReason classifies…" + `scan-service.test.ts` › "the final push carries this scan's
source errors"; AC4 → e2e `replays-list-loading` flow (no-reload marker) + unit
`ReplaysView.test.tsx` › "an empty cache during a running scan shows loading, not empty" +
`list-state.test.ts` › "empty only after the scan finished with no rows"; AC5 → `ui:verify` on the
four screens, 0 axe violations each. No manual residue. Clean-agent review (default tier,
foreground, no hard stage per Model Hints): PASS, no findings — the three risk implementations
(empty flash during a running scan, demos-less game dir wrongly flagged, one source's error
hiding another's demos) each confirmed pinned by a non-tautological test. Full regression gate not
run here — sprint's job.

Decisions: none beyond what's already recorded under "Decisions (Sprint)"; the loading e2e flow's
data-total race (fixed by polling for the real total instead of asserting right after visibility)
was a test-only fix, not a spec or implementation decision.

tiers: D 4 / hard 0 · review default · cycles 0 · agents 7
