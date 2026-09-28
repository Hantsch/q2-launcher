---
id: 137
title: an mvd2 tells its map and players
status: done # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

Some servers record every match server-side as `.mvd2` — Q2PRO's multi-view demo, containing all
players rather than one POV (AQ2-TNG with `use_mvd2`, Q2PRO `sv_mvd_autorecord`). Those demos
belong in the same library, with the same facts as a `.dm2` ([[136]]): map, level name, mod and
players (concept `docs/concepts/demo-browser.md` §6.4, DEMO-5).

The format differs (§6.4): `MVD2` magic, then `[uint16 LE length][data]` blocks with 0 as the end
marker; the header is `mvd_serverdata` (protocol 37, version 2009–2012, game dir) followed by
configstrings. **aq2replay** (MIT) is the porting reference for MVD2. Same rules as [[136]]: pure
code, header only, typed failure instead of a throw.

## Acceptance Criteria

- [x] **AC1** — For an `.mvd2`, the parser returns map, level name, game dir and every player name
      from the configstrings, in the same result shape [[136]] returns.
- [x] **AC2** — An `.mvd2` has no POV; the result says so explicitly rather than inventing one.
- [x] **AC3** — An `.mvd2.gz` yields exactly the same facts as the same demo uncompressed.
- [x] **AC4** — The result records the MVD protocol version, and a version outside 2009–2013 returns
      a typed "unparsable" result naming the version. *(Range corrected from 2009–2012 at refine:
      current Q2PRO writes 2013 — see Decisions (Sprint).)*
- [x] **AC5** — Header-only and bounded, like [[136]] AC8; garbage or truncation returns "unparsable"
      with a reason, never a throw.
- [x] **AC6** — Format is detected from the content (the `MVD2` magic), not only from the extension:
      a mis-named file is parsed as what it is.

## Open Questions

- [x] ~~**Q1 — Configstring layout** for MVD protocol 37 — same indices as protocol 34, or its
      own?~~ answered → Decisions (Sprint)
- [x] ~~**Q2 — Real sample** — same question as [[136]] Q1, for MVD2.~~ answered → Decisions
      (Sprint)

## Decisions (Sprint)

- **(User)** Real sample: the user supplied a real capture at
  `docs/fixtures/demos/PFAU_20221127-053327_q2dm1.mvd2`. Use it as a fixture alongside the
  synthetic/documented-format ones; no separate real-sample gate blocks this story.
- **Q1 — Configstring layout (verified in q2pro `master`, `src/server/mvd/parse.c`
  `MVD_ParseServerData`, `src/server/mvd.c` `emit_gamestate`):** MVD uses the same two tables as
  [[136]] — `cs_remap_old` (protocol-34 indices: `CS_NAME` 0, `CS_MODELS` 32, `CS_PLAYERSKINS`
  1312, end 2080) unless `version >= 2011` **and** flags carry `MVF_EXTLIMITS` (bit 2), then
  `cs_remap_new` (0 / 62 / 12862 / 13630). Flags are a `uint16` after the version when
  `version >= 2012`, otherwise the serverdata opcode byte's top 3 bits (`cmd >> 5`). Reason: read
  from source, nothing left for the user.
- **Wire layout of the header** (same sources): `"MVD2"`, then block `[uint16 LE len][payload]`
  (0 = end). First message: byte `cmd` with `cmd & 31 == 4` (`mvd_serverdata`), `int32` protocol
  (37), `uint16` version, [`uint16` flags if ≥ 2012], `int32` servercount, string gamedir, `int16`
  clientNum (the MVD dummy's slot, −1 = none), then **inline** `[uint16 index][string]` pairs until
  `index == layout end` — no separate `configstring` messages. The real fixture confirms it
  (version 2010, flags 1, terminator 2080 at offset 5544, block 1 = 7123 B ends at 7129). Reason:
  `rec_start` writes the whole gamestate as one message or errors "gamestate overflowed".
- **Accepted versions 2009–2013**, not 2009–2012 (AC4 amended). Reason: q2pro's `MVD_SUPPORTED`
  is `2009..PROTOCOL_VERSION_MVD_CURRENT` = 2013 (`PLAYERFOG`), and extended-limits servers write
  `CURRENT` — rejecting 2013 would call every current rerelease-API MVD unparsable; 2013's header
  is byte-identical to 2012's (it only changes frame playerstate bits).
- **Header = the first block only**; `MVD2_HEADER_MAX_BYTES = 4 + 2 + 65535 = 65541`. Reason: the
  whole serverdata + configstring table sits in one `uint16`-length block, so the bound is exact.
- **No POV is explicit**: the result carries `format: 'mvd2'` and `pov: null` (typed as the
  literal `null`), and `clientNum` is never used as a POV. Reason: `format` is what tells "no POV
  by nature" apart from a `.dm2` whose POV slot is empty (AC2).
- **The dummy is not a player**: `players` skips slot `clientNum` when `0 ≤ clientNum < 256`
  (in the fixture slot 20 = `[MVDSPEC]`); otherwise [[136]]'s rule (slot order, up to first `\`,
  empty skipped, no dedup — the fixture yields `['lamb shanker', 'lamb shanker']`). Reason: the
  dummy is Q2PRO's recording spectator, listing it would invent a player.
- **Result shape** reuses [[136]]'s field names and conventions (`gameDir` empty → `baseq2`,
  `map` stripped of `maps/`/`.bsp` or `null`, `decodeLatin1`, `largestBlockBytes`,
  `bytesConsumed`, layout tables imported from `dm2-header.ts`) plus `format`, `mvdVersion`.
  Unparsable reasons are [[136]]'s closed union plus `unknown-version` (with `version`); a major
  protocol ≠ 37 is `unknown-protocol` (with `protocol`). Reason: [[145]] consumes one shape and
  maps codes to i18n keys (no prose across IPC).
- **Format detection** lives in one pure dispatcher `parseDemoHeader(bytes)`: first 4 bytes
  `MVD2` → MVD2 parser, anything else → `parseDm2Header` (result tagged `format: 'dm2'`). The main
  reader sniffs gzip first (as [[136]]), so `.mvd2.gz` and mis-named files take the same path.
  Reason: AC6 — content decides, the extension never does.
- **Main read bound** for `readDemoHeader(path)` is [[136]]'s `DM2_HEADER_MAX_BYTES` (1 MiB),
  since the format is unknown before the bytes are read. Reason: one bounded read serves both
  formats; the MVD2 parser itself never looks past 65541 bytes.
- **First message must be `mvd_serverdata`** (no `nop` skipping); a terminator missing inside a
  complete block 1 → `not-a-demo`; block 1 or its length word cut by end of input → `truncated`.
  Reason: `rec_start` always writes serverdata first; strict rules keep the parser simple.
- **Depends on [[136]] being built first** (imports `decodeLatin1` path, layout tables,
  `parseDm2Header`, `readDemoPrefix`). **No UI, no CHANGELOG entry, no i18n keys.** Reason:
  nothing user-visible ships; [[145]] shows the result.

## Plan

1. **D1 — pure MVD2 parser + format dispatcher** (`src/shared/demos/`): `parseMvd2Header(bytes)`
   reads magic, block 1, serverdata, inline configstrings; picks the layout by version/flags;
   extracts facts; never throws. `parseDemoHeader(bytes)` sniffs `MVD2` and dispatches.
   Test-side writer `buildMvd2(opts)` mirrors [[136]]'s `buildDm2`.
2. **D2 — main reader** `readDemoHeader(path)` in `src/main/lib/demo-bytes.ts` =
   `readDemoPrefix(path, DM2_HEADER_MAX_BYTES)` → `parseDemoHeader`; tests on the real
   `PFAU_…q2dm1.mvd2`, its gzip copy, mis-named copies of both fixtures, and a 32 MiB synthetic.

Order: [[136]] D1+D2 → D1 → D2.

Result shape (D1 exports it):

```ts
type Mvd2Version = 2009 | 2010 | 2011 | 2012 | 2013
type Mvd2Header = { ok: true; format: 'mvd2'; protocol: 37; mvdVersion: Mvd2Version
  layout: 'original' | 'extended'; gameDir: string; levelName: string; map: string | null
  pov: null; players: string[]; largestBlockBytes: number; bytesConsumed: number }
type Mvd2Unparsable = { ok: false; reason: Dm2Unparsable['reason'] | 'unknown-version'
  protocol?: number; version?: number }
type DemoHeaderResult = (Dm2Header & { format: 'dm2' }) | Mvd2Header | Dm2Unparsable | Mvd2Unparsable
```

## Deliverables

- [x] **D1 — `.mvd2` header parser (pure) + format dispatcher + synthetic writer + tests.**
  Files: new `src/shared/demos/mvd2-header.ts`, `src/shared/demos/mvd2-writer.ts`,
  `src/shared/demos/demo-header.ts`, `src/shared/demos/mvd2-header.test.ts`,
  `src/shared/demos/demo-header.test.ts`. Mirror `src/shared/demos/dm2-header.ts` /
  `dm2-writer.ts` (story 136; pure, no `node:*`, no `Buffer`, `DataView`, `decodeLatin1` from
  `src/shared/servers/protocol.ts`; import 136's layout tables and `Dm2Header`/`Dm2Unparsable`
  types instead of redefining them).
  Spec: export `MVD2_HEADER_MAX_BYTES = 65_541`, the types `Mvd2Version`, `Mvd2Header`,
  `Mvd2Unparsable`, `DemoHeaderResult` exactly as:
  `Mvd2Header = { ok: true; format: 'mvd2'; protocol: 37; mvdVersion: 2009|2010|2011|2012|2013;
  layout: 'original'|'extended'; gameDir; levelName; map: string|null; pov: null; players:
  string[]; largestBlockBytes; bytesConsumed }`, `Mvd2Unparsable = { ok: false; reason:
  Dm2Unparsable['reason'] | 'unknown-version'; protocol?: number; version?: number }`,
  `DemoHeaderResult = (Dm2Header & { format: 'dm2' }) | Mvd2Header | Dm2Unparsable | Mvd2Unparsable`.
  `parseMvd2Header(bytes)` rules: length 0 → `empty`; first 4 bytes ≠ `MVD2` → `not-a-demo`;
  fewer than 6 bytes, or block 1 (`uint16 LE` len at offset 4) reaching past the input →
  `truncated`; len 0 → `not-a-demo`. Inside block 1 only: `cmd` byte, `cmd & 31` ≠ 4 →
  `not-a-demo`; `int32 LE` protocol ≠ 37 → `unknown-protocol` + `protocol`; `uint16` version
  outside 2009–2013 → `unknown-version` + `version`; flags = next `uint16` if version ≥ 2012, else
  `cmd >> 5`; `int32` servercount; NUL-terminated gamedir; `int16` clientNum; then loop
  `uint16` index: `== layout end` → done, `> end` → `not-a-demo`, else NUL-terminated string.
  Layout `extended` iff version ≥ 2011 and `flags & 4`, else `original`. A field or string
  running past the end of block 1, or no terminator before it → `not-a-demo` (block complete
  but malformed). Facts as story 136: `gameDir` empty → `baseq2`; `levelName` = `CS_NAME`
  (empty string if absent — MVD has no level string in serverdata); `map` = `CS_MODELS+1` minus
  `maps/` / `.bsp` (case-insensitive) or `null`; `players` = each `CS_PLAYERSKINS` slot's name up
  to the first `\`, slot order, empty skipped, **slot `clientNum` skipped when 0 ≤ clientNum <
  256**, no dedup; `pov: null` always; `largestBlockBytes` = block 1 len; `bytesConsumed` =
  `6 + len`. Never reads past `MVD2_HEADER_MAX_BYTES`, never throws (bounds checks, no
  try/catch crutch), every loop advances.
  `parseDemoHeader(bytes)` in `demo-header.ts`: `MVD2` magic → `parseMvd2Header`; else
  `parseDm2Header`, and an `ok` dm2 result is returned with `format: 'dm2'` added.
  Writer `buildMvd2(opts)` → `Uint8Array`: `version`, `flags`, `protocol` (default 37),
  `gameDir`, `clientNum`, `configstrings: Record<number,string>`, `layout` (picks the terminator),
  `trailingBlocks` (N filler frame blocks after block 1), `terminate` (append `uint16 0`); writes
  flags as a word for ≥ 2012 and into `cmd >> 5` below.
  Tests (names in Acceptance Tests): facts from a synthetic 2010 original-layout demo; a
  2011/2012/2013 extended demo (flags 4) filled **only at extended indices** and an original one
  only at original indices, so a wrong table fails; the flags-word vs. extrabits split (a 2012
  demo whose `cmd` top bits say extended but flags word says not → `original`); `pov` null and
  the `clientNum` slot excluded; versions 2008 and 2014 → `unknown-version` with `version`;
  protocol 34 in an MVD2 → `unknown-protocol`; empty / cut / garbage → reasons; parsing stops at
  block 1 regardless of 32 MiB of trailing blocks (`bytesConsumed` ≤ `MVD2_HEADER_MAX_BYTES`);
  2000 seeded truncations/byte flips never throw; high-bit name bytes survive; the dispatcher
  sends `MVD2…` bytes to the MVD path and a `buildDm2` demo to the dm2 path (`format` checked).

- [x] **D2 — main-side `readDemoHeader` + real-fixture tests.**
  Files: `src/main/lib/demo-bytes.ts` (add `readDemoHeader`; leave 136's `readDm2Header` and
  `readDemoPrefix` unchanged), `src/main/lib/demo-bytes.test.ts` (add a `describe` block).
  Mirror 136's `readDm2Header` and its temp-dir tests.
  Spec: `readDemoHeader(path): Promise<DemoHeaderResult>` = `readDemoPrefix(path,
  DM2_HEADER_MAX_BYTES)` → `parseDemoHeader(bytes)`; `ok: false` → `{ ok: false, reason:
  'unreadable' }`. Never rejects.
  Tests: the real `docs/fixtures/demos/PFAU_20221127-053327_q2dm1.mvd2` (resolve from repo root)
  deep-equals `{ ok: true, format: 'mvd2', protocol: 37, mvdVersion: 2010, layout: 'original',
  gameDir: 'opentdm', levelName: 'The Edge', map: 'q2dm1', pov: null, players: ['lamb shanker',
  'lamb shanker'], largestBlockBytes: 7123, bytesConsumed: 7129 }` (no `[MVDSPEC]`); its
  `gzipSync` copy as a temp `.mvd2.gz` deep-equals the same; the `.mvd2` copied to a temp
  `x.dm2` still yields `format: 'mvd2'`, and `test.dm2` copied to `x.mvd2` yields `format: 'dm2'`
  with 136's facts (map `q2rdm2`); a 32 MiB synthetic MVD2 (plain and gzipped) is read with file
  bytes **measured independently of the return value** (spy on `FileHandle.read` / sum the read
  stream's `data` chunks) — plain ≤ `DM2_HEADER_MAX_BYTES`, gzip ≤ `DM2_HEADER_MAX_BYTES + 128 KiB`;
  a gzip copy cut inside block 1 → `truncated`.

## Model Hints

- D1 → default
- D2 → default
- Review: → default — the plausible wrong implementations (dummy listed as a player, `clientNum`
  used as POV, flags read from the wrong place, bound asserted from the return value) are each
  pinned by a named test against the real fixture or an index-disjoint synthetic, which a default
  review can check against the diff.

## Acceptance Tests

- AC1 → unit `src/shared/demos/mvd2-header.test.ts` › "an mvd2 reports map, level name, game dir and players from its inline configstrings"
  and › "an extended-limits mvd2 reads the extended configstring layout"
  and unit `src/main/lib/demo-bytes.test.ts` › "the real PFAU q2dm1 mvd2 reports its map, level, game dir and players"
- AC2 → unit `src/shared/demos/mvd2-header.test.ts` › "an mvd2 has no POV and never lists the MVD dummy as a player"
  (+ the real-fixture test above: `pov: null`, no `[MVDSPEC]`)
- AC3 → unit `src/main/lib/demo-bytes.test.ts` › "a gzipped mvd2 yields exactly the facts of the uncompressed one"
- AC4 → unit `src/shared/demos/mvd2-header.test.ts` › "the mvd version is recorded and one outside 2009-2013 is unknown-version"
  and › "flags come from the word from 2012 on and from the opcode bits before"
- AC5 → unit `src/shared/demos/mvd2-header.test.ts` › "parsing stops after the first block regardless of trailing frames"
  and › "empty, truncated, garbage and wrong-magic mvd2 input return a typed unparsable reason"
  and › "mutated mvd2 demos never throw and always return a result"
  and unit `src/main/lib/demo-bytes.test.ts` › "a 32 MiB mvd2 is read only up to the header bound, plain and gzipped"
  and › "a cut gzipped mvd2 is truncated"
- AC6 → unit `src/shared/demos/demo-header.test.ts` › "the format is chosen by the MVD2 magic, not by the caller"
  and unit `src/main/lib/demo-bytes.test.ts` › "a mis-named demo is parsed as what its bytes are"
  (no user action in this story, so no e2e line; [[145]] shows the result)

## Done

Built the `.mvd2` header parser on top of [[136]]: pure parser + format dispatcher + synthetic
writer (D1), then the main-side `readDemoHeader` proven against the real PFAU fixture, its gzip
copy, mis-named copies both ways, and a 32 MiB bound check (D2). One real bug found and fixed
before review: the `players` loop iterated the whole remaining configstring range instead of just
`MAX_CLIENTS` (256) slots, bleeding `opentdm`'s CS_GENERAL scoreboard strings ("Home"/"Away"/
"READY"/timer) into the real fixture's player list — fixed to match [[136]]'s bound, tests
corrected to the exact spec'd fixture facts.

Commit message: `137: parse an .mvd2's map, level, game dir and players from its header`

Changed files: `src/shared/demos/mvd2-header.ts`, `mvd2-writer.ts`, `demo-header.ts`,
`mvd2-header.test.ts`, `demo-header.test.ts` (new); `src/shared/demos/dm2-header.ts` (additive —
exported `Dm2Layout`/`ORIGINAL_LAYOUT`/`EXTENDED_LAYOUT` for reuse, no behavior change);
`src/main/lib/demo-bytes.ts`, `demo-bytes.test.ts` (added `readDemoHeader` + tests, `readDm2Header`
unchanged).

Verification — narrow gate only (no `--full`): `npm run build` green, `npm run typecheck` green,
`npx vitest run --changed HEAD` green (4 files / 34 tests). No e2e — pure/main-only story, no
user-facing surface (per [[145]]). AC → test mapping, all passed: AC1
`mvd2-header.test.ts`/"...reports map, level name, game dir and players..." +
"...extended-limits mvd2 reads the extended configstring layout" + `demo-bytes.test.ts`/"the real
PFAU q2dm1 mvd2 reports its map, level, game dir and players"; AC2
`mvd2-header.test.ts`/"...has no POV and never lists the MVD dummy as a player"; AC3
`demo-bytes.test.ts`/"a gzipped mvd2 yields exactly the facts of the uncompressed one"; AC4
`mvd2-header.test.ts`/"the mvd version is recorded..." + "flags come from the word from 2012
on..."; AC5 `mvd2-header.test.ts`/"parsing stops after the first block..." + "empty, truncated,
garbage and wrong-magic mvd2 input return a typed unparsable reason" (name corrected from the
story's draft "wrong-protocol" wording) + "mutated mvd2 demos never throw..." + `demo-bytes.test.ts`/
"a 32 MiB mvd2 is read only up to the header bound, plain and gzipped" + "a cut gzipped mvd2 is
truncated"; AC6 `demo-header.test.ts`/"the format is chosen by the MVD2 magic, not by the caller" +
`demo-bytes.test.ts`/"a mis-named demo is parsed as what its bytes are". No manual residue. Review
(default tier, one cycle): PASS, no blocking findings — one non-blocking observation noted and left
as-is: `mvd2-header.ts`'s `map` field returns `''` rather than `null` for an empty (but present)
`CS_MODELS+1` configstring, unlike [[136]]'s `null`-on-empty guard; no real fixture or spec text
exercises this, not covered by any AC. Standalone build (no `--full`): the full regression gate
(`npm test`, `npm run ui:verify`, `npm run ui:flows`) has not run — run it before merging, or use
`/build 137 --full`.

Decisions: none beyond what the story's own Decisions (Sprint) section already recorded; no new
implementation-detail calls were needed beyond the bug fix above.

tiers: D 2 / hard 0 · review default · cycles 1 · agents 6
