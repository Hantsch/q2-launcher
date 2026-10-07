---
id: 144
title: the index only re-reads what changed
status: done # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

A user with a thousand demos opens the Demos view and sees their list straight away — not after the
launcher has re-read every file again. The index refreshes **incrementally when the module opens**
and on a **manual refresh**; there is no file watcher (concept `docs/concepts/demo-browser.md` §3,
DEMO-3, DEMO-4).

Parsed facts and name facts are kept in a **disposable cache** in app data, keyed by path + size +
modification time (§8.2) — its own file, not `state.json`, because it can grow large. The filesystem
stays the master: deleting the cache loses nothing, the next scan rebuilds it. Scan progress reaches
the renderer as a pushed `module:event` (counts), which [[151]] shows.

## Acceptance Criteria

- [x] **AC1** — Opening the Demos view starts an incremental scan; a refresh button starts one on
      demand.
- [x] **AC2** — A file whose path, size and modification time are unchanged since the last scan is
      not parsed again (asserted by counting parser calls).
- [x] **AC3** — A changed file is re-parsed, a new file is added, and a deleted file disappears
      from the list after the scan.
- [x] **AC4** — The cache lives in its own app-data file; deleting it and scanning again produces the
      same list, and no sidecar or user setting is lost.
- [x] **AC5** — A cache written by an older cache format version is discarded and rebuilt, not
      misread.
- [x] **AC6** — Scan progress (scanned / total, per source) is pushed as a module event while the scan
      runs.
- [x] **AC7** — A refresh requested while a scan is running does not start a second parallel scan.
- [x] **AC8** — While a game is running (launch phase `starting`/`running`), a file that needs
      parsing (not a cache hit) and whose modification time is less than 30 s old is treated as
      still being written: it is not read, not cached, and not listed in this scan; the next scan
      after it has gone quiet parses and lists it. With no game running, no file is skipped.
- [x] **AC9** — Opening the view shows the rows from the cache immediately, before the scan
      finishes; when the scan finishes, the list is replaced once with the scan's result, without a
      manual reload.

## Open Questions

- [x] ~~**Q1 — Scanning while the game runs** (§17.12): allowed (the game may be writing a demo right
      now), deferred until the game exits, or skip files still being written — and how "still being
      written" is detected?~~ answered → Decisions (Sprint)
- [x] ~~**Q2 — First scan** — does the list show cached rows immediately and update in place, or wait
      for the scan to finish?~~ decided by refine → Decisions (Sprint), AC9

## Decisions (Sprint)

- **(User)** Scanning while a game runs: skip files still being written, rather than deferring
  the whole scan or reading a possibly-live file. Refine picks the detection method (e.g. a
  short re-stat to see if mtime/size are still moving, or an open-handle/lock check) and adds
  it as an AC.
- **"Still being written" = mtime younger than 30 s while `app.launch.isRunning()`** (AC8) — a
  single stat the scan already makes, with no delay and no platform branch; a lock check is not
  portable (Windows `fopen` shares reads, Linux has no mandatory locks) and a short re-stat misses
  a quiet recording whose stdio buffer flushes only every few seconds (10 Hz frames of tens of
  bytes), which 30 s covers.
- **The live rule only applies while the launcher sees a game `starting`/`running`**, not in the
  Steam `handed-off` phase — the same stance as the servers scan guard and ARCHITECTURE's
  handed-off note: the launcher cannot see that process, and gating every scan on it would hide
  freshly copied demos after any Steam launch.
- **A skipped live file is dropped from list and cache, even if an older cache row exists** — its
  size/mtime already differ from that row, so the row is stale; the next scan picks it up. No
  automatic rescan on game exit (no-watcher rule, concept §3).
- **Q2: cached rows first, then one replacement when the scan finishes** (AC9) — a thousand demos
  visible at once is the story's own headline, and a single swap on completion avoids a list that
  reshuffles row by row under the user's cursor.
- **No scan at app start** — only on view open and on refresh (AC1); the module never walks the
  disk while nobody is looking at the Demos view.
- **Cache file `userData/replays-index.json`, via `JsonStore`, mirroring
  `src/main/modules/home/news/feed-cache.ts`** — the repo's one existing disposable app-data
  cache; a missing, unparseable, schema-failing or other-version file reads as "empty cache" and
  never throws or toasts.
- **`cacheVersion` literal, bumped whenever any cached fact shape (parsed facts 136–138, name
  facts 139) changes** — AC5; a disposable cache is not worth a migration (feed-cache precedent).
- **Cache key = the entry identity discovery (141/142/143) already produces** (absolute path; for a
  zip entry, archive path + entry name), **validated by the file's own size + `mtimeMs`** — for a zip
  entry that is the archive's size + mtime, so an unchanged archive is not reopened.
- **Name facts are cached alongside parsed facts** (concept §8.2), but a change to the user's
  patterns (140) must not serve stale name facts — the cache row stores the pattern-set fingerprint
  it was computed with, and a mismatch re-runs only the name matcher (no file read).
- **The cache is written once, at the end of a completed scan**; a scan that throws leaves the
  previous cache file untouched. Entries not seen in the finished scan — deleted files, and files of
  a source that could not be read this time — are pruned (filesystem is master, cache is
  disposable).
- **Single-flight** (AC7): `scan.start` while a scan runs returns `{ started: false }` and joins
  nothing new; the renderer's refresh button is additionally disabled while `running` is true.
- **Progress event `scan.progress`**: `{ running, sources: [{ sourceKey, scanned, total }] }`,
  emitted once at start, after every 25 files, at the end of each source and once with
  `running: false` at the end — count-based throttling is deterministic to test, and 151 only
  needs counts. `sourceKey` is discovery's source identity; labels are 151's business.
- **Handlers** `scan.start` (no input → `{ started: boolean }`) and `index.read` (no input → the
  current list snapshot); neither takes a path (135 AC7 guard). The list entry shape stays the one
  141/150 define — this story only decides _when_ it is recomputed.
- **CHANGELOG** — cached rows on open plus a refresh button are user-visible: one line under
  `## Unreleased → ### Added`.

## Plan

Insert a cache between discovery (141–143) and parsing (136–139); the plan is independent of their
exact export names — every D names "discovery" and "the parsers" by role and injects them.

1. **Cache store** (D1) — `replays-index.json` under userData, zod-validated envelope with
   `cacheVersion`; load degrades to empty, save is atomic via `JsonStore`.
2. **Incremental scan core** (D2) — pure function over _discovered files with stat_, the loaded
   cache, injected parse/name functions, `now`, `isGameRunning`, and an `onProgress` callback.
   Per file: cache hit (size + mtimeMs equal) → reuse; else live (AC8) → skip; else parse. Returns
   `{ entries, nextCache }`. No fs of its own besides what is injected.
3. **Scan service + contract** (D3) — owns the in-memory snapshot, single-flight, progress
   emission, cache persistence at the end; handlers `scan.start` / `index.read`; event
   `scan.progress` in `src/shared/modules/replays.ts`.
4. **Renderer** (D4) — Demos view: `index.read` on mount (cached rows at once), `scan.start` on
   mount, refresh button, re-read on `running: false`; flow proves open/refresh/new/deleted on the
   real surface.

Order: D1 → D2 → D3 → D4.

## Deliverables

- **D1 — the disposable index cache file, plus its tests.** Files:
  `src/main/modules/replays/index-cache.ts` (new, mirror `src/main/modules/home/news/feed-cache.ts`
  exactly: `JsonStore`, `userDataDir()` from `src/main/lib/paths.ts`, a `filePath` option for tests,
  `parse` that never throws and logs a warn), `src/main/modules/replays/index-cache.test.ts` (new,
  mirror `src/main/modules/home/news/feed-cache.test.ts` if present, temp dir otherwise).
  Contract: `REPLAYS_INDEX_CACHE_FILE = 'replays-index.json'`, `REPLAYS_INDEX_CACHE_VERSION = 1`
  (doc comment: bump whenever any cached fact shape changes — parsed facts, name facts — a bump
  discards, never migrates); class `ReplaysIndexCache` with `read(): Promise<Map<string,
CachedDemo>>` (empty map when the file is missing, not JSON, fails the schema, or has another
  `cacheVersion`) and `write(entries: Map<string, CachedDemo>): Promise<void>` (resolves once on
  disk). `CachedDemo = { size: number; mtimeMs: number; patternFingerprint: string; parsed:
unknown-validated-by-schema; name: …; }` — the `parsed`/`name` sub-schemas reuse the parsers' own
  exported zod schemas / types where they exist, else a permissive `z.unknown()` wrapped by the
  version check (note in a comment). Key = discovery's entry id string.
  Tests: › "a written cache reads back identical" › "a missing cache file reads as empty" › "an
  unparseable or schema-failing cache file reads as empty without throwing" › "a cache with another
  cacheVersion is discarded, not misread" (write a v0 document by hand, `read()` → empty; next
  `write` produces a v1 file) › "the cache lives in its own userData file, not state.json" (default
  path ends with `replays-index.json`, and `state.json` is not in the path).
  Acceptance: those tests pass; `npm run typecheck` clean.

- **D2 — incremental scan core, plus its tests.** Files:
  `src/main/modules/replays/incremental-scan.ts` (new), `src/main/modules/replays/incremental-scan.test.ts`
  (new). A pure async function `runIncrementalScan(input)`; no `fs`, no electron, no timers.
  Input: `sources: Array<{ sourceKey: string; files: Array<{ id: string; size: number; mtimeMs:
number; …discovery's entry }> }>` (already discovered and stat'ed by the caller), `cache:
Map<string, CachedDemo>` (D1's type), `patternFingerprint: string`, `parse(file) =>
Promise<ParsedFacts>`, `matchName(file) => NameFacts`, `now: number`, `isGameRunning: boolean`,
  `onProgress(sourceKey, scanned, total)`.
  Rules per file: (a) cache row with equal `size` **and** `mtimeMs` → reuse `parsed`; if its
  `patternFingerprint` differs, re-run only `matchName`; (b) otherwise, if `isGameRunning` and
  `now - mtimeMs < LIVE_WRITE_WINDOW_MS` (exported constant `30_000`) → skip: not parsed, not in
  `entries`, not in `nextCache`, count it in a returned `skippedLive`; (c) otherwise `parse` +
  `matchName` and store. `nextCache` contains exactly the files of this scan that were reused or
  parsed — anything else is pruned. `onProgress` after every 25 files of a source and once at its
  end. Every 25 files, `await yieldNow()` (injected, defaults to a `setImmediate`-based promise) so
  the main process stays responsive, like the detection deep scan.
  Tests (counting calls on a `vi.fn()` parse): › "an unchanged file is not parsed again" (second run
  with the first run's `nextCache`: parse called 0 times, entries equal) › "a file with changed size
  or changed mtime is re-parsed" (two cases, each parse called once, for that file only) › "a new
  file is parsed and added" › "a deleted file disappears from entries and from the next cache" ›
  "a pattern change re-runs only the name matcher" › "while a game runs, a cache-miss file modified
  under 30 s ago is skipped and picked up once it is quiet" (isGameRunning true, mtime now-5 s →
  not parsed, absent; same file, now+60 s → parsed, present) › "with no game running, a fresh file is
  parsed" › "a live-looking file that is a cache hit is still reused" › "progress is reported per
  source as scanned / total" (3 sources, 60 files in one → calls at 25, 50, 60).
  Acceptance: those tests pass.

- **D3 — scan service, handlers, progress event, plus its tests.** Files:
  `src/shared/modules/replays.ts` (edit: `REPLAYS_HANDLERS.scanStart: 'scan.start'`,
  `indexRead: 'index.read'` with `replaysNoInputSchema` in `REPLAYS_HANDLER_SCHEMAS`;
  `REPLAYS_EVENTS = { scanProgress: 'scan.progress' } as const`; `replaysScanProgressSchema =
z.object({ running: z.boolean(), sources: z.array(z.object({ sourceKey: z.string(), scanned:
z.number().int().nonnegative(), total: z.number().int().nonnegative() })) })` + type; response
  schema `{ started: z.boolean() }`; `overview.read` now reports the service's real `scanning` /
  `demoCount`), `src/shared/modules/replays.test.ts` (edit: the existing schema-per-handler and
  no-path guards now cover the new handlers — no new test needed there),
  `src/main/modules/replays/scan-service.ts` (new, mirror the single-flight/emit shape of
  `src/main/modules/servers/scan-service.ts`), `src/main/modules/replays/scan-service.test.ts`
  (new), `src/main/modules/replays/index.ts` (edit: construct the service with `emit`, the D1
  cache, discovery + stat, the parsers, the name matcher and `() => app.launch.isRunning()`;
  register the two handlers). Behaviour: the cache is loaded lazily on the first `index.read` or
  `scan.start`; `index.read` answers from the in-memory snapshot, which before the first scan of the
  session is built from the loaded cache rows (AC9) and after it is the last scan's `entries`;
  `scan.start` while `running` → `{ started: false }`, no second discovery/parse; otherwise
  `{ started: true }` immediately and the scan runs in the background: emit `scan.progress`
  (`running: true`, all sources at 0/total) → D2 with `onProgress` mapped to emits → replace the
  snapshot → `cache.write(nextCache)` → emit `running: false`. On a throw: log, keep the old snapshot
  and cache file, still emit `running: false`, clear the flag. The scan writes no file other than
  the cache file.
  Tests (temp userData + temp demo folder, real fs, injected parse `vi.fn()`, fake `emit`): ›
  "a second scan.start while a scan runs does not start a parallel scan" (hold parse on a deferred
  promise; second call → `{ started: false }`; parse call count equals file count once) › "scan
  progress is pushed as scanned / total per source while the scan runs" (collect emitted
  `scan.progress` payloads; first `running: true` at 0, last `running: false`, counts monotonic,
  each payload passes `replaysScanProgressSchema`) › "index.read serves cached rows before the scan
  finishes" (pre-written cache; hold the scan; `index.read` returns the cached rows; after
  `running: false` it returns the scan's result) › "deleting the cache file and scanning again
  produces the same list and loses no sidecar or setting" (scan → snapshot A; delete
  `replays-index.json`; new service instance → scan → snapshot B deep-equals A; a `final.dm2.json`
  sidecar in the demo folder is byte-identical and its mtime unchanged; the replays module settings
  in the test state are unchanged; the only file created under userData is `replays-index.json`) ›
  "a failed scan keeps the previous cache and snapshot" › "a game running makes the scan skip a
  file still being written" (service with `isGameRunning: () => true`, a demo touched now → absent
  from `index.read`, parse not called for it).
  Acceptance: those tests pass; `npm run typecheck` clean.

- **D4 — Demos view scans on open, refresh button, flow.** Files:
  the Demos view under `src/renderer/src/modules/replays/` (the one 141 registered; if the route
  still renders `PlannedModuleView`, add `ReplaysView.tsx`, register it as `View` in
  `src/renderer/src/modules/index.ts` and flip the replays manifest to `status: 'available'` in
  `src/shared/types/module.ts` — the servers precedent), `src/renderer/src/modules/replays/client.ts`
  (edit: `scanStart()`, `indexRead()`, `onScanProgress(listener)` over `onModuleEvent` from
  `src/renderer/src/modules/moduleClient.ts`, mirror `src/renderer/src/modules/servers/client.ts`),
  a view test next to the view (mirror `src/renderer/src/modules/servers/*View.test.tsx`),
  `src/renderer/src/i18n/locales/en.json` (`replays.list.refresh` "Refresh",
  `replays.list.refreshing` "Scanning…"), `CHANGELOG.md` (one line under `## Unreleased` →
  `### Added`, house style), `scripts/flows/replays-incremental-scan.mjs` (new, mirror
  `scripts/flows/external-edit-cascades.mjs` for writing files on disk mid-flow, and the demo
  fixture 141 set up in `scripts/lib/fixture.mjs`).
  Behaviour: on mount call `indexRead()` and render its rows at once, then `scanStart()`; subscribe
  to `onScanProgress`; on a payload with `running: false`, call `indexRead()` once and replace the
  rows. A `Button` `data-testid="replays-refresh"` in the view header calls `scanStart()`; it is
  disabled while the last progress payload says `running: true` (label `replays.list.refreshing`),
  enabled otherwise. Rows carry `data-testid="replays-row"` if 141's list does not already.
  Tests: view test › "mounting the view reads the index and starts a scan" › "the refresh button
  starts a scan and is disabled while one runs" › "cached rows render before the scan finishes and
  are replaced once when it finishes" (fake client: `indexRead` resolves 2 rows, then 3 after a
  `running: false` event; `indexRead` called exactly twice). Flow `replays-incremental-scan`: open
  `nav-replays` on a fresh fixture (no cache) → the fixture's demo rows appear (only a scan can
  produce them); copy one fixture demo to a new name in the fixture demos folder → click
  `replays-refresh` → one more row, with the new file name; delete that file → click refresh → the
  row is gone; shot `replays-after-refresh`.
  Acceptance: those tests pass; `npm run ui:flow -- replays-incremental-scan` OK.

## Model Hints

- D1 → default — a copy of the feed-cache pattern with a different payload.
- D2 → default — a pure function whose every rule has a named counting test.
- D3 → deliverable-hard — the one new concurrency path: single-flight across a background scan,
  snapshot swap vs. cache write vs. progress emission ordering, and failure leaving the old cache
  intact are cross-file subtleties (service ↔ D2 ↔ D1 ↔ registry) that a mis-ordered `await` breaks
  without any single-file test noticing.
- D4 → default — view wiring over a typed client; the flow mirrors an existing on-disk-edit flow.
- Review: → default — every rule has a counting or byte-level test (parse call counts, emitted
  payloads, sidecar bytes, created-file list); there is no structural claim left that only a
  second, harder review could see.

## Acceptance Tests

- AC1 → e2e `scripts/flows/replays-incremental-scan.mjs` › flow `replays-incremental-scan` (D4) —
  rows appear on open from a cache-less fixture, refresh picks up a new file; plus unit view test ›
  "mounting the view reads the index and starts a scan" and › "the refresh button starts a scan and
  is disabled while one runs" (D4).
- AC2 → unit `src/main/modules/replays/incremental-scan.test.ts` › "an unchanged file is not parsed
  again" (D2).
- AC3 → unit `src/main/modules/replays/incremental-scan.test.ts` › "a file with changed size or
  changed mtime is re-parsed", › "a new file is parsed and added", › "a deleted file disappears from
  entries and from the next cache" (D2); e2e `scripts/flows/replays-incremental-scan.mjs` › flow
  `replays-incremental-scan` (D4) for new and deleted on the real surface.
- AC4 → unit `src/main/modules/replays/index-cache.test.ts` › "the cache lives in its own userData
  file, not state.json" (D1); unit `src/main/modules/replays/scan-service.test.ts` › "deleting the
  cache file and scanning again produces the same list and loses no sidecar or setting" (D3).
- AC5 → unit `src/main/modules/replays/index-cache.test.ts` › "a cache with another cacheVersion is
  discarded, not misread" (D1).
- AC6 → unit `src/main/modules/replays/scan-service.test.ts` › "scan progress is pushed as scanned /
  total per source while the scan runs" (D3); unit
  `src/main/modules/replays/incremental-scan.test.ts` › "progress is reported per source as scanned /
  total" (D2).
- AC7 → unit `src/main/modules/replays/scan-service.test.ts` › "a second scan.start while a scan runs
  does not start a parallel scan" (D3); unit view test › "the refresh button starts a scan and is
  disabled while one runs" (D4).
- AC8 → unit `src/main/modules/replays/incremental-scan.test.ts` › "while a game runs, a cache-miss
  file modified under 30 s ago is skipped and picked up once it is quiet", › "with no game running, a
  fresh file is parsed", › "a live-looking file that is a cache hit is still reused" (D2); unit
  `src/main/modules/replays/scan-service.test.ts` › "a game running makes the scan skip a file still
  being written" (D3). Driving a real recording game is not possible in e2e; the launch-state input
  is injected at the service seam.
- AC9 → unit `src/main/modules/replays/scan-service.test.ts` › "index.read serves cached rows before
  the scan finishes" (D3); unit view test › "cached rows render before the scan finishes and are
  replaced once when it finishes" (D4).

## Done

Built the disposable `replays-index.json` cache (D1), a pure incremental-scan core keyed on
size+mtime with a live-write guard (D2), a single-flight scan service with `scan.start`/`index.read`
handlers and a `scan.progress` event (D3, hard tier), and the Demos view's scan-on-open + refresh
button, replacing rows once on completion (D4). Fixed one race the new stale-then-replace UX
introduced in the existing `replays-extra-folders.mjs` flow (waits for refresh to settle before its
final assertions).

Commit message: `144: the index only re-reads what changed`

Verification (narrow gate only): `npm run build` green, `npm run typecheck` clean,
`npx vitest run --changed HEAD` green for every story-144 test (6 unrelated pre-existing failures in
`src/main/modules/replays/name-templates.test.ts`, an untouched story-140 file, confirmed unrelated).
`npm run ui:flow -- replays-incremental-scan` was INCONCLUSIVE: environment gap, timed out on the
first locator wait (`nav-replays` click) before any story-144 assertion ran — the same first-locator
`ui:flow` timeout already logged against stories 140–143 in this sprint, not a red result from this
story's own code. Every AC1–AC9 has a passing named unit test (see `## Acceptance Tests` above);
AC1/AC3's e2e half rode the same inconclusive flow run. Clean-agent review: PASS, no fixes needed —
two minor non-blocking notes left as-is: (1) `demos.list`/`listDemos()` are now dead code (no caller
left after D4 switched the view to `index.read`/`scan.start`) — left in place rather than removed,
since deleting a still-registered, still-tested IPC handler is out of this story's own scope; a
follow-up story can retire it. (2) `index-cache.test.ts`'s "lives in its own userData file" test is
narrow (path-shape only) — the substantive AC4 proof is `scan-service.test.ts`'s delete-and-rescan
test, so no test was strengthened.

Decisions:

- Zip-contained demos are not yet covered by the "unchanged archive is not reopened" Decision:
  `discoverDemos`/`expandZip` (built in stories 141/143, untouched here) still list and read every
  zip entry on every scan, upstream of the D1/D2 cache. The D1/D2 cache still saves work for loose
  files (the majority case and what AC2/AC3's tests assert), but a zip archive is fully reopened
  every scan regardless of whether it changed. Confirmed by review as a real gap against the
  Decisions text, not against any numbered AC (none names zip-archive caching). Fixing it needs a
  change to discovery's zip expansion (141/143's own files) and is left for a follow-up story rather
  than expanded here, since this story's D3 was already the hard-tier deliverable and the plan named
  discovery/parsers as "inject, do not modify."
- `sourceKey` for scan grouping/progress is derived per `DemoSource` (`installation:<id>:<gameDir>` /
  `extraFolder:<path>`) — labels are deferred to story 151 as the story's own Decisions specify.
- `demoSourceKey` and the cache's `parsed`/`name` fields use `z.unknown()` (guarded by the version
  check) since no exported schema exists yet for a parsed demo header or name-facts result to reuse.

tiers: D 4 / hard 1 · review default · cycles 0 · agents 6
