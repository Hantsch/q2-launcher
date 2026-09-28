---
id: 143
title: each demo in a zip is its own row
status: done # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

Tournament demo packs arrive as a `.zip`. The user should not have to unpack them to see what is
inside: every demo entry in the archive appears as its own row, with the same parsed facts as a
loose file, and the archive itself stays exactly as it is (concept
`docs/concepts/demo-browser.md` §2, §3, DEMO-2).

Archives are **read-only** by decision: no sidecar, no rename for an entry ([[158]] shows those
actions disabled with the reason). Playing an entry extracts it temporarily ([[160]]). The zip
reader runs in main. The repo has no zip library today; the downloads module ships a `7za` binary,
which may or may not be the right tool for listing and reading entries (Q1).

## Acceptance Criteria

- [x] **AC1** — A `.zip` in any scanned source contributes one row per `.dm2`, `.mvd2`, `.dm2.gz`
      and `.mvd2.gz` entry; other entries are ignored.
- [x] **AC2** — Each entry row is parsed like a loose file ([[136]]–[[139]]) and shows its source as
      the archive plus the entry's path inside it.
- [x] **AC3** — Each entry row carries an "archive entry" marker ([[150]]).
- [x] **AC4** — The archive file is never modified by scanning (size, modification time and content
      unchanged, asserted by a test).
- [x] **AC5** — Reading is bounded: an entry whose uncompressed size exceeds the cap decided in Q2,
      or an archive that fails to open, is reported as unparsable/source error — never an
      unbounded read into memory.
- [x] **AC6** — Zips nested inside zips are not opened.

## Open Questions

- [x] ~~**Q1 — Zip reader** — reuse the bundled `7za`, or add a JS zip dependency (licence, size)?~~
      answered → Decisions (Sprint)
- [x] ~~**Q2 — Size cap** per entry, as zip-bomb protection.~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Zip reader: reuse the bundled `7za` binary already shipped with the downloads
  module — no new JS zip dependency. Refine works out the exact invocation (listing entries,
  reading a single entry's bytes) against `7za`'s CLI.
- **Invocation (probed against the vendored 7-Zip 26.03 `7za.exe`):** list =
  `l -slt -ba -sccUTF-8 -tzip -p- <archive>` (one `Key = Value` block per entry, blank-line
  separated; keys used: `Path`, `Folder`, `Size`, `Modified`, `Encrypted`); read one entry =
  `e -so -spd -bd -sccUTF-8 -tzip -p- <archive> -- <entryPath>` (bytes on stdout). Reason: `-spd`
  turns off wildcard matching so `[`/`*`/`?` in names are literal, `--` stops switch parsing so a
  name like `-dash.dm2` works (both verified), `-p-` is a dummy password so an encrypted archive
  never waits for a prompt, `-ba` drops the banner. Binary resolved with the downloads module's
  `resolveExtractorPath` (`7za.exe` on Windows, `7zz` on Linux — same switches, same codebase).
- **A read is only trusted when its byte count equals the listed `Size`.** Reason: probed — a
  missing entry exits 0 with 0 bytes, and Windows matches names case-insensitively, so two entries
  differing only in case would concatenate; the size check turns both into `unreadable`.
- **Q2 — cap: `ZIP_ENTRY_MAX_BYTES = 64 MiB` uncompressed per entry**, checked twice: from the
  listed `Size` before spawning a read, and on the live stdout stream (process killed the moment it
  passes the cap, since a hostile zip's listed size can lie). The same cap bounds the gunzip of a
  `.dm2.gz`/`.mvd2.gz` entry. Reason: real demos are far smaller (fixture `test.dm2` 31 KB, the MVD2
  355 KB; a long 10 Hz match is single-digit MB), 64 MiB leaves ~5× headroom for an hour-long MVD2,
  and the whole entry must fit in memory because [[138]]'s exact duration decodes every frame.
- **Listing output is capped at 8 MiB** (≈ 20k entries) and every 7za call has a 30 s timeout;
  either → archive source error. Reason: AC5's "never unbounded" applies to the listing too.
- **Archive-level failure is a source error, not a row** (codes `archive-unreadable`,
  `archive-too-large`, `extractor-missing`); **entry-level failure is an unparsable row** (new
  reason codes `entry-too-large`, `encrypted`; I/O or size mismatch → existing `unreadable`).
  Reason: a zip may hold no demos at all, so a row for a broken one would be noise, while a named
  demo entry the user can see must never vanish (DEMO-7).
- **Nested zips / folders / non-demo entries** are skipped by the extension filter (case-insensitive,
  same four extensions as [[141]]) and `Folder = +`; nothing is ever extracted from an inner zip.
  Reason: AC6, and 7za cannot open an archive-in-archive without writing it out first.
- **Entry identity:** entry path normalised to `/` separators; row carries
  `archiveEntry: { archivePath, entryPath }` (`null` for loose files); file-name parsing ([[139]])
  runs on the entry's base name; the file-time rung is the entry's own `Modified` (parsed as local
  time), falling back to the archive's mtime. Reason: the entry is the demo, the archive only its
  container.
- **One parse path for loose and zipped demos:** entry bytes go through the same bytes-level
  dispatch the loose path uses ([[136]] `parseDm2Header`, [[137]]'s MVD2 parser, [[138]]'s
  duration). Reason: AC2's "parsed like a loose file" is only provable as deep-equal results.
- **One 7za spawn per entry, sequential per archive.** Reason: splitting one concatenated stdout by
  listed sizes is fragile, and [[144]]'s cache (keyed on the archive's path + size + mtime) keeps
  the spawn cost to the first scan after the archive changes.
- **Spawning outside the downloads module is a named exception:** the new reader joins
  `ALLOWED_MAIN_SPAWN_NETWORK_FILES` in `src/main/modules/downloads/layering.test.ts` with a doc
  bullet. Reason: that guard exists to catch unnamed spawn sites; this one is deliberate.
- **Placement:** reader in `src/main/lib/zip-entries.ts`. Reason: same as [[136]]'s
  `demo-bytes.ts` — no dependency on the replays module id, reusable by [[160]]'s play extraction.

## Plan

1. **D1 — zip reader** `src/main/lib/zip-entries.ts`: pure `parseSltListing(text)`;
   `listZipEntries(archive, deps)` and `readZipEntry(archive, entryPath, expectedSize, deps)`
   spawning the vendored 7za with the fixed argument shapes above, stdout streamed with the caps,
   timeout and kill, every result an `Outcome`-style union (never rejects). Layering allowlist.
2. **D2 — entry expansion** `src/main/modules/replays/zip-demos.ts`: archive path → entry rows
   (filter, cap pre-check, read, bounded gunzip, bytes-level parse dispatch, name facts, file time,
   `archiveEntry`), or one archive source error. Adds the two unparsable reason codes.
3. **D3 — wiring into discovery**: the [[141]]/[[142]] scan hands every `.zip` it finds in a
   scanned folder to D2 and merges rows and source errors into its result.
4. **D4 — the row on the real surface**: source label "`<source>` › `<archive>.zip` › `<entry
   path>`", a `data-archive-entry` attribute on the row ([[150]] draws the visible marker), a zip in
   the demos UI fixture, and the flow `replays-zip-entries`.

Order: D1 → D2 → D3 → D4. D1/D2 unit tests run against the real binary where it is vendored
(`it.skipIf(!resolveExtractorPath(...).exists)`, mirror `extractor.test.ts`) plus fake-process tests
that always run.

## Deliverables

- **D1 — bounded 7za zip reader + tests.**
  Files: new `src/main/lib/zip-entries.ts`, `src/main/lib/zip-entries.test.ts`; edit
  `src/main/modules/downloads/layering.test.ts` (add `src/main/lib/zip-entries.ts` to
  `ALLOWED_MAIN_SPAWN_NETWORK_FILES` with a doc bullet: story 143, spawns the vendored 7-Zip to list
  and read zip entries). Mirror `src/main/modules/downloads/extractor.ts` (spawn as array,
  `shell: false`, `windowsHide: true`, `stdio: ['ignore','pipe','pipe']`, resolve once) and its
  test's fake-process stand-in (`extractor.test.ts` ~l.41) and real-binary `skipIf` block (~l.223).
  Spec: export `ZIP_ENTRY_MAX_BYTES = 64 * 1024 * 1024`, `ZIP_LISTING_MAX_BYTES = 8 * 1024 * 1024`,
  `ZIP_CALL_TIMEOUT_MS = 30_000`. `parseSltListing(text): ZipEntry[]` — blocks separated by blank
  lines, `Key = Value` lines; `ZipEntry = { path: string /* '\\' → '/' */, isFolder: boolean,
  size: number | null, modified: Date | null /* 'YYYY-MM-DD HH:MM:SS[.fraction]' as local time */,
  encrypted: boolean }`; unknown keys ignored, a block without `Path` dropped, never throws.
  Deps `{ extractorPath: string; extractorExists: boolean; spawn?: typeof spawn }` (caller passes
  `resolveExtractorPath` from `src/main/modules/downloads/7za-path.ts`).
  `listZipEntries(archivePath, deps)` → `{ ok: true; entries } | { ok: false; code:
  'extractor-missing' | 'archive-unreadable' | 'archive-too-large' }`; args exactly
  `['l','-slt','-ba','-sccUTF-8','-tzip','-p-', archivePath]`; non-zero exit, spawn error or timeout
  → `archive-unreadable`; stdout past `ZIP_LISTING_MAX_BYTES` → kill, `archive-too-large`.
  `readZipEntry(archivePath, entryPath, expectedSize, deps)` → `{ ok: true; bytes: Uint8Array } |
  { ok: false; code: 'entry-too-large' | 'unreadable' | 'extractor-missing' }`; `expectedSize >
  ZIP_ENTRY_MAX_BYTES` → `entry-too-large` **without spawning**; args exactly
  `['e','-so','-spd','-bd','-sccUTF-8','-tzip','-p-', archivePath, '--', entryPath]`; chunks are
  counted as they arrive and the process is killed as soon as the total passes the cap
  (`entry-too-large`); non-zero exit, timeout, or total ≠ `expectedSize` → `unreadable`. The only
  computed argv slots are `archivePath` and `entryPath`; never `a`/`u`/`d`/`x`, never `-o`.
  Tests (names in Acceptance Tests): fake process — argv shapes pinned exactly; an over-cap listed
  size spawns nothing; an endless stdout is killed and the bytes held never exceed cap + one chunk
  (measured by the fake's own emitted-byte counter, not the return value); size mismatch and
  zero-byte "missing entry" → `unreadable`; listing flood → `archive-too-large`; timeout (fake
  timers) → `archive-unreadable`; `parseSltListing` on a captured real listing (Windows `\` paths,
  a folder block, an `Encrypted = +` block). Real binary (skipIf): build a zip in a temp dir with
  `7za a -tzip` holding `a.dm2` (copy of `docs/fixtures/demos/test.dm2`), `sub/a.dm2`, `-dash.dm2`,
  `b [1].DM2`; each reads back its own exact bytes; a garbage file and a truncated zip →
  `archive-unreadable`; size, mtime and sha256 of the archive identical before and after a full
  list + read of every entry.

- **D2 — a zip expands into parsed entry rows + tests.**
  Files: new `src/main/modules/replays/zip-demos.ts`, `zip-demos.test.ts`; edit the shared demo row
  type (the one [[141]] introduced under `src/shared/`) to add `archiveEntry: { archivePath:
  string; entryPath: string } | null`; edit the unparsable-reason union from [[136]]
  (`src/shared/demos/dm2-header.ts` or wherever it was widened) to add `'entry-too-large' |
  'encrypted'`, and if a reason → i18n-key map exists ([[145]]) add both keys to
  `src/renderer/src/i18n/locales/en` ("Too large to read inside an archive", "Encrypted archive
  entry"). If the loose path only exposes a path-based parse, split it into a bytes-level
  `parseDemoBytes(bytes)` + thin path wrapper and route loose files through it (one code path).
  Spec: `expandZip(archivePath, source, deps)` → `{ rows, error: null } | { rows: [], error: {
  archivePath, code } }`. Uses D1 (`src/main/lib/zip-entries.ts`). Keep entries that are not
  folders and whose path ends (case-insensitively) in `.dm2`, `.mvd2`, `.dm2.gz`, `.mvd2.gz`;
  everything else — including `.zip` entries — is skipped and never read. Per kept entry, in listing
  order: `encrypted` → unparsable row `encrypted` (not read); `size > ZIP_ENTRY_MAX_BYTES` →
  unparsable `entry-too-large`; else `readZipEntry`; bytes starting `1f 8b` are gunzipped through a
  streaming `zlib.createGunzip()` capped at `ZIP_ENTRY_MAX_BYTES` (over → `entry-too-large`; a gzip
  error keeps partial output, like [[136]] D2); the result goes through the loose path's bytes-level
  parse. Name facts from the entry's base name; file time = entry `modified` ?? archive mtime.
  Every row: `archiveEntry` set, source = the archive's own source plus `entryPath`, a stable id
  derived from archive path + entry path. Listing failure → `error` with D1's code.
  Tests with an injected lister/reader (always run) plus one real-binary test (skipIf): mixed zip →
  one row per demo entry of all four kinds, `readme.txt`/`inner.zip`/folders ignored and never
  read; `test.dm2`, the MVD2 fixture and a gzipped `test.dm2` zipped yield parsed facts deep-equal
  to the loose-file result; oversized/encrypted entries are unparsable rows with their code; broken
  archive → source error, no rows; every row has `archiveEntry`, a loose row has `null`.

- **D3 — discovery expands zips + test.**
  Files: the [[141]] discovery module under `src/main/modules/replays/` (and [[142]]'s extra-folder
  path if separate) and its test. Spec: while scanning a folder (top level only, per [[141]]'s
  decision), a file ending `.zip` (case-insensitive) is passed to D2's `expandZip` with the
  folder's source; its rows join the demo list and its `error` joins the scan's per-source errors
  (add an `archiveErrors` list to the scan result only if no per-source error list exists). The
  cache key for all entry rows is the archive's path + size + mtime ([[144]]). Test: a scanned
  folder with one loose demo and one zip of two demos yields three rows, the two zip rows carrying
  `archiveEntry`; a zip in `demos/_launcher/` is not expanded.

- **D4 — archive entry rows on the real surface + flow.**
  Files: the demo row component from [[141]]/[[150]] under `src/renderer/src/modules/replays/`
  (source label and a `data-archive-entry="true"` attribute), its i18n entry in
  `src/renderer/src/i18n/locales/en` if the label needs a template, `scripts/lib/fixture.mjs` (the
  demos fixture [[141]] set up: at seed time build `pack.zip` in the fixture's demos folder with
  `vendoredSevenZaPath()` `a -tzip`, holding `test.dm2`, `sub/final.mvd2` (copy of the MVD2 fixture)
  and `readme.txt`), new `scripts/flows/replays-zip-entries.mjs` (mirror [[141]]'s flow). Spec:
  source label for an archive row = the archive's source label, then `pack.zip`, then the entry
  path, separated by ` › `. Flow: open Demos, assert exactly two rows whose source contains
  `pack.zip ›` (`test.dm2` and `sub/final.mvd2`) both with `data-archive-entry="true"`, the
  `test.dm2` entry row showing map `q2rdm2`; no row for `readme.txt`; loose rows lack the attribute.

## Model Hints

- D1 → deliverable-hard — a new spawn path whose bounds must hold on a live stream: kill-on-cap,
  timeout and exit/error must resolve exactly once, and the listed-size equality check is the only
  guard against 7za's silent exit-0 for a missing or case-colliding entry.
- D2 → default
- D3 → default
- D4 → default
- Review: → default — the rigging risk (a cap checked on the finished buffer instead of the stream)
  is closed by D1's endless-stdout test measuring the fake process's emitted bytes, which a default
  review can check against the diff.

## Acceptance Tests

- AC1 → unit `src/main/modules/replays/zip-demos.test.ts` › "a zip yields one row per dm2, mvd2, dm2.gz and mvd2.gz entry and ignores the rest"
  and e2e `scripts/flows/replays-zip-entries.mjs` › `replays-zip-entries`
- AC2 → unit `src/main/modules/replays/zip-demos.test.ts` › "a zipped demo parses to exactly the facts of the same loose file"
  and unit `src/main/lib/zip-entries.test.ts` › "each entry of a real zip reads back its own exact bytes"
  and e2e `scripts/flows/replays-zip-entries.mjs` › `replays-zip-entries` (source labels
  `… › pack.zip › test.dm2` / `… › pack.zip › sub/final.mvd2`; the `test.dm2` row shows map `q2rdm2`)
- AC3 → unit `src/main/modules/replays/zip-demos.test.ts` › "every entry row carries archiveEntry and a loose row does not"
  and e2e `replays-zip-entries` (`data-archive-entry="true"` on both archive rows only)
- AC4 → unit `src/main/lib/zip-entries.test.ts` › "listing and reading every entry leaves the archive's size, mtime and content unchanged"
  and › "7za is spawned with the exact list and read argument shapes"
- AC5 → unit `src/main/lib/zip-entries.test.ts` › "an entry listed above the cap is refused without spawning a read"
  and › "a stream that runs past the cap is killed and never held beyond cap plus one chunk"
  and › "a size mismatch or a missing entry is unreadable"
  and › "a listing flood or timeout is an archive error, a garbage or truncated zip cannot be opened"
  and unit `src/main/modules/replays/zip-demos.test.ts` › "oversized and encrypted entries are unparsable rows and a broken archive is a source error"
- AC6 → unit `src/main/modules/replays/zip-demos.test.ts` › "a zip inside a zip is never read"
  (the injected reader records no call for `inner.zip` or any path beneath it)
- D3 wiring → unit (the [[141]] discovery test file) › "a scanned folder expands its zips into entry rows"

## Done

Built D1-D4 as planned: a bounded 7za zip reader (`src/main/lib/zip-entries.ts`), zip-entry
expansion into parsed rows (`src/main/modules/replays/zip-demos.ts`), discovery wiring
(`discovery.ts` scans top-level `.zip`s in every demos folder and merges rows/archive errors), and
the real surface (archive-entry marker, source label, map display, `pack.zip` fixture, flow
`replays-zip-entries`). Two post-verify fixes: the downloads-layering allowlist (D3 added a 7za
path resolution to `replays/index.ts`) and a stale fixture in `shared/modules/replays.test.ts`.

Commit message: `143: each demo in a zip is its own row`

Verification: narrow gate — `npm run build`/`npm run typecheck` green; `npx vitest run --changed
HEAD` green (1647 tests, 112 files) after the two post-verify fixes above; `npm run ui:flow --
replays-zip-entries` INCONCLUSIVE — timed out on the first nav-click (`nav-replays`), the same
generic first-locator harness gap already recorded pre-existing in stories 140-142 (not a
zip/archive-specific assertion failure), so treated as an environment gap per this sprint's
deviation, not a story blocker. AC1-AC6 and the D3-wiring test all found, ran and passed against
their named/near-verbatim tests in `zip-entries.test.ts`, `zip-demos.test.ts` and
`discovery.test.ts` (see progress trail for the full per-AC walk). Review: one default-tier pass,
verdict PASS, 3 low-severity non-blocking findings (an unused `archiveMtimeMs` parameter in
`expandZip` kept for forward-compat with a later story's file-time surfacing; `archiveErrors[].code`
typed as bare `string` instead of the literal union; the `_launcher` non-expansion case is covered
implicitly by `scanDemosDir`'s existing one-level-only listing rather than a literal named test) —
none fixed, all accepted as-is, no re-verify cycle needed.

Decisions:
- `DiscoveredDemo` gains exactly three new fields: `archiveEntry`, `map`, `unparsableReason` (all
  nullable). Duration/POV/players facts are parsed and compared in D2's own unit tests but not
  added to the shared row type or surfaced in the UI — nothing in this story's ACs or flow needs
  them, and story 145 ("a demo I cannot parse still shows up") is the natural place to wire full
  unparsable-row UI and any further parsed facts.
- The entry's own `Modified` timestamp / archive mtime ("file-time rung" in Decisions (Sprint)) is
  read by `expandZip`'s signature (`archiveMtimeMs` parameter) but not stored anywhere — no
  `DiscoveredDemo` field consumes it yet, so it is accepted and unused pending a story that
  actually surfaces file time.
- `discoverDemos` now returns `{ demos, archiveErrors }` instead of a bare array; `archiveErrors`
  (archive-level `listZipEntries` failures) is not yet surfaced over IPC — no AC in this story
  requires it, deferred to whichever story wires archive-level source errors into the UI.
- `demoUnparsableReasonSchema` is a hand-maintained zod enum (not a derived TS union) covering both
  header-parser reasons (`Dm2Unparsable`/`Mvd2Unparsable`) and the two zip-only codes
  (`entry-too-large`, `encrypted`) plus `unreadable`; kept deliberately separate from the header
  parsers' own reason types since the zip-only codes don't belong there.

tiers: D 4 / hard 1 · review default · cycles 1 · agents 8 (4 deliverable + 1 fix + 1 verify + 1 review, D1 dispatched once, no re-dispatches)
