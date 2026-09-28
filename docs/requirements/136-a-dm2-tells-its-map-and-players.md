---
id: 136
title: a dm2 tells its map and players
status: ready # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

A demo file knows more than its name: which map was played, in which mod, who was on the server and
who recorded it. The demo browser shows those facts for every demo without the user typing anything
(concept `docs/concepts/demo-browser.md` §6, DEMO-5). This story is the header parser for `.dm2`
files — the client-side, single-POV format both r1q2 and Q2PRO write.

Research already fixed what the parser needs (§6.1–6.2): a `.dm2` is `[int32 LE length][payload]`
blocks ending in `0xFFFFFFFF`; the first block starts with `svc_serverdata` (protocol, game dir,
playernum, level name) followed by configstrings. Demos on disk are almost always protocol 34, with
Q2PRO's 3434–3436 "extended limits" layout as the one known variant. `record -z` writes
`.dm2.gz`. The parser only reads the header — not frames, not entity state.

The parser is pure TypeScript (gzip through `node:zlib` behind a thin main-side wrapper), unit
testable without an installation. **packetflinger/libq2** (Apache-2.0) is the porting reference;
nothing GPL is copied (§4). The user has no sample demo yet, so the fixtures are built by a
test-side writer from the documented format — refine decides whether a real demo is required
before done (Q1).

## Acceptance Criteria

- [ ] **AC1** — For a protocol-34 `.dm2`, the parser returns the map from configstring
      `CS_MODELS+1` (`maps/q2dm1.bsp` → `q2dm1`).
- [ ] **AC2** — It returns the level name from `CS_NAME`.
- [ ] **AC3** — It returns the game dir from `svc_serverdata`; an empty game dir is reported as
      `baseq2`.
- [ ] **AC4** — It returns the recording player (POV) from `CS_PLAYERSKINS + playernum`, up to the
      first `\`.
- [ ] **AC5** — It returns every player name from every non-empty `CS_PLAYERSKINS` slot.
- [ ] **AC6** — A protocol 3434–3436 demo yields the same facts through that variant's configstring
      layout, and the result records which protocol the demo uses (needed by [[161]]).
- [ ] **AC7** — A `.dm2.gz` yields exactly the same facts as the same demo uncompressed.
- [ ] **AC8** — The parser stops after the header: it reads a bounded number of bytes regardless of
      file size, and the bound is asserted by a test.
- [ ] **AC9** — A truncated, empty, garbage or unknown-protocol file returns a typed "unparsable"
      result with a reason — it never throws out of the parser and never loops; [[145]] shows it.

## Open Questions

- [x] ~~**Q1 — Real sample before done?** Synthetic fixtures prove the format as documented; is one
      real protocol-34 demo (and one 343x) required as a fixture before this is done, and whose
      licence covers it (§17.3)?~~ answered → Decisions (Sprint)
- [x] ~~**Q2 — 343x layout** — which Q2PRO constants (`CS_MODELS`, `CS_PLAYERSKINS`, …) apply in the
      extended layout; confirm from source before planning.~~ answered → Decisions (Sprint)
- [x] ~~**Q3 — Oversized packets** (`record -e` / `cl_demomsglen`, §6.1) — does the header parser
      flag them so [[161]] can disable r1q2 playback, or is that detected elsewhere?~~ answered →
      Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Real sample: the user supplied real captures at `docs/fixtures/demos/` —
  `test.dm2` (protocol 34) and `PFAU_20221127-053327_q2dm1.mvd2` (MVD2, used by [[137]]). Use
  them as fixtures alongside the synthetic/documented-format ones; no separate real-sample
  gate blocks this story. No 343x real sample exists — that variant stays synthetic-only.
- **Q2 — 343x layout (verified in q2pro `master`):** protocols 3434/3435/3436
  (`PROTOCOL_VERSION_EXTENDED_MINIMUM`/`_LIMITS_2`/`_PLAYERFOG`, `inc/common/protocol.h:33-36`) use
  `cs_remap_new` (`src/shared/shared.c:1347-1368`): `CS_NAME` 0, `CS_MODELS` 62, `CS_PLAYERSKINS`
  12862, `MAX_CONFIGSTRINGS` 13630 (protocol 34: 0 / 32 / 1312 / 2080). The demo's `svc_serverdata`
  is byte-identical in shape (`src/client/demo.c:420-427`, no extra field after the level name),
  opcodes and the uint16 configstring index are unchanged — only the index table differs. Reason:
  read from source, so nothing is left for the user to decide.
- **Q3 — Oversized packets:** the parser reports `largestBlockBytes` (the largest header block's
  payload length) and passes no verdict; [[161]] owns the "r1q2 cannot play this" rule. Reason: the
  header is the only part read, so a number is honest where a yes/no would claim more than it saw.
- **Accepted protocols** are exactly 34, 3434, 3435, 3436; anything else is `unknown-protocol`.
  Reason: §6.1 — r1q2 and Q2PRO both write 34 (or 343x) to disk, so 35/36 in a file means corruption.
- **Header end** = the first message after `svc_serverdata` that is not `svc_configstring` (normally
  `svc_spawnbaseline`, opcode 14), or the `0xFFFFFFFF` terminator. Reason: `CL_Record` writes all
  configstrings before baselines; the real `test.dm2` header ends at byte 5542, block 5.
- **Byte bound** `DM2_HEADER_MAX_BYTES = 1 MiB` of (decompressed) file bytes; a header not finished
  inside it is `header-too-large`. Reason: a full extended configstring table is at most
  13630 × 68 B ≈ 0.93 MiB, a protocol-34 one ≈ 0.14 MiB.
- **Unparsable reasons** are a closed code union — `empty`, `truncated`, `not-a-demo` (first
  message is not `svc_serverdata`, or a block length is negative other than the terminator),
  `unknown-protocol`, `header-too-large`, `unreadable` (I/O error, main wrapper only). Reason: main
  sends codes, [[145]] maps them to i18n keys (CLAUDE.md: no prose across IPC).
- **Strings** are decoded byte-identically with `decodeLatin1` (`src/shared/servers/protocol.ts`),
  high-bit bytes kept. Reason: the server browser does the same for player names and renders the Q2
  charset at display time (`src/shared/config/q2-charset.ts`) — the parser does not pre-render.
- **Map** = `CS_MODELS+1` with a leading `maps/` and trailing `.bsp` removed (case-insensitive),
  `null` if the slot is empty; **POV** `null` if `playernum` is out of range or its slot is empty;
  **players** in slot order, empty names skipped. Reason: a missing fact is `null`, never a guess.
- **gzip is sniffed by magic** (`1f 8b`), not by extension. Reason: the same wrapper then serves
  [[137]]'s `.mvd2.gz` and a misnamed file; a gzip error after partial output parses what was
  decompressed (so a cut `.gz` reports `truncated` like a cut `.dm2`).
- **Placement:** pure parser in `src/shared/demos/`, bounded reader in `src/main/lib/demo-bytes.ts`.
  Reason: neither depends on the module id [[135]] creates, and `src/shared/servers/` is the
  precedent for pure protocol parsers.
- **No UI, no CHANGELOG entry, no i18n keys** in this story. Reason: nothing user-visible ships;
  [[145]] shows the result.

## Plan

1. **D1 — pure parser** `src/shared/demos/dm2-header.ts`:
   `parseDm2Header(bytes: Uint8Array): Dm2HeaderResult`. Walks `[int32 LE len][payload]` blocks
   with a `DataView`; message loop inside blocks: first must be `svc_serverdata` (12: int32
   protocol, int32 servercount, byte attractloop, string gamedir, int16 playernum, string level),
   then `svc_configstring` (13: uint16 index, string) until any other opcode → done. Picks the
   layout table by protocol, extracts facts, never throws, every loop advances or returns.
   Test-side writer `src/shared/demos/dm2-writer.ts` builds synthetic demos (protocol, layout,
   configstrings, trailing frame bytes, block splitting) — mirrors `src/shared/servers/reply-fixtures.ts`.
2. **D2 — main bounded reader** `src/main/lib/demo-bytes.ts`: `readDemoPrefix(path, maxBytes)`
   (plain: one bounded `FileHandle.read`; gzip: `createReadStream` → `createGunzip`, stop and
   destroy at `maxBytes`) and `readDm2Header(path)` = prefix → `parseDm2Header`. Tests run the real
   `docs/fixtures/demos/test.dm2`, its gzipped copy, and large synthetic files.

Order: D1 then D2 (D2 imports D1's parser and writer).

Result shape (D1 exports it):

```ts
type Dm2Protocol = 34 | 3434 | 3435 | 3436
type Dm2Header = { ok: true; protocol: Dm2Protocol; layout: 'original' | 'extended'
  gameDir: string; levelName: string; map: string | null; pov: string | null
  players: string[]; largestBlockBytes: number; bytesConsumed: number }
type Dm2Unparsable = { ok: false; reason: 'empty' | 'truncated' | 'not-a-demo'
  | 'unknown-protocol' | 'header-too-large' | 'unreadable'; protocol?: number }
type Dm2HeaderResult = Dm2Header | Dm2Unparsable
```

## Deliverables

- **D1 — `.dm2` header parser (pure) + synthetic writer + tests.**
  Files: new `src/shared/demos/dm2-header.ts`, `src/shared/demos/dm2-writer.ts`,
  `src/shared/demos/dm2-header.test.ts`. Mirror `src/shared/servers/info-reply.ts` /
  `reply-fixtures.ts` (pure, no `node:*`, no `Buffer`; reuse `decodeLatin1` from
  `src/shared/servers/protocol.ts`).
  Spec: export `DM2_HEADER_MAX_BYTES = 1_048_576`, the layout tables
  (`original`: `CS_NAME` 0, `CS_MODELS` 32, `CS_PLAYERSKINS` 1312, `MAX_CONFIGSTRINGS` 2080, 256
  clients; `extended` for 3434/3435/3436: 0 / 62 / 12862 / 13630, 256 clients), the result types
  from the plan, and `parseDm2Header(bytes)`. Rules: input length 0 → `empty`. Blocks:
  `int32 LE` length, `-1` = end; other negative → `not-a-demo`; a block (or its length word)
  reaching past the input → `header-too-large` if `bytes.length >= DM2_HEADER_MAX_BYTES`, else
  `truncated`. Messages may span consecutive blocks only at message boundaries (each block holds
  whole messages). First opcode ≠ 12 → `not-a-demo`; protocol not in the accepted set →
  `unknown-protocol` with `protocol`. Strings are NUL-terminated; an unterminated string or short
  field inside a block → `truncated`. Configstring index ≥ the layout's `MAX_CONFIGSTRINGS` →
  `not-a-demo`. Header done at the first opcode other than 13 after serverdata, or at the `-1`
  terminator; reaching end of input before either → `truncated`/`header-too-large` as above.
  Facts: `gameDir` empty → `baseq2`; `levelName` from `CS_NAME` (fall back to serverdata's level
  string when `CS_NAME` absent); `map` from `CS_MODELS+1` stripped of `maps/` and `.bsp`
  (case-insensitive), `null` if absent; `pov` = `CS_PLAYERSKINS+playernum` up to the first `\`,
  `null` if out of range/empty; `players` = every `CS_PLAYERSKINS` slot's name (up to first `\`),
  slot order, empty skipped; `largestBlockBytes` = max header block payload length;
  `bytesConsumed` = file offset just past the last header block read. Never throws (wrap nothing
  in try/catch as a crutch — bounds-check instead), every loop iteration advances.
  Writer: `buildDm2(opts)` → `Uint8Array` with `protocol`, `gameDir`, `playernum`,
  `configstrings: Record<number,string>`, `maxBlockPayload` (splits messages across blocks),
  `trailingFrameBytes` (a `svc_spawnbaseline`/frame block of N filler bytes after the header),
  `terminate` (append `-1`).
  Tests in `dm2-header.test.ts` (names below in Acceptance Tests): AC1–AC6, AC8 (parser half),
  AC9 (parser half) plus a mutation fuzz: 2000 seeded truncations/byte flips of a synthetic demo
  never throw and always return a result; high-bit bytes in a name survive byte-identically; the
  343x test fills only extended indices and the 34 test only original ones, so a wrong table fails.

- **D2 — bounded main-side reader (plain + gzip) + real-fixture tests.**
  Files: new `src/main/lib/demo-bytes.ts`, `src/main/lib/demo-bytes.test.ts`. Mirror the
  temp-dir test style of `src/main/lib/fs-utils.test.ts`.
  Spec: `readDemoPrefix(path, maxBytes): Promise<{ ok: true; bytes: Uint8Array; compressed:
  boolean } | { ok: false }>` — open the file, sniff the first two bytes; plain → one
  `FileHandle.read` of at most `maxBytes`; gzip (`1f 8b`) → `createReadStream` (64 KiB
  `highWaterMark`) piped through `zlib.createGunzip()`, collect output until `maxBytes`, then
  destroy both streams; a gunzip error returns what was decompressed so far (`ok: true`); an I/O
  error (missing file, EACCES) → `ok: false`. `readDm2Header(path): Promise<Dm2HeaderResult>` =
  `readDemoPrefix(path, DM2_HEADER_MAX_BYTES)` → `parseDm2Header`, `ok: false` → `{ ok: false,
  reason: 'unreadable' }`. Never rejects.
  Tests: the real `docs/fixtures/demos/test.dm2` (resolve from repo root) yields protocol 34,
  `map` `q2rdm2`, `gameDir` `opentdm`, `levelName` `The Chastity Belt Duel  -  by JaLisK0`
  (two spaces around the dash), `pov` `sd.kgm/sauDove` (playernum 1), `players`
  `['WallFly[BZZZ]', 'sd.kgm/sauDove']`, `bytesConsumed` 6505 (end of block 5, where the header's
  `svc_spawnbaseline` sits at offset 5542); its `gzipSync` copy written to a temp `.dm2.gz` yields
  a deep-equal result (`bytesConsumed` counts decompressed bytes, so it is equal too); a 32 MiB synthetic demo (header + random-filler frames, plain
  and gzipped) is read with **file bytes measured independently of the function's return value**
  (spy on `FileHandle.read` / count the read stream's `data` chunk lengths) — plain ≤
  `DM2_HEADER_MAX_BYTES`, gzip ≤ `DM2_HEADER_MAX_BYTES + 128 KiB` — so a read-whole-file-then-slice
  implementation fails; a missing path → `unreadable`; a gzip cut in half → `truncated`.

## Model Hints

- D1 → default
- D2 → default
- Review: → default — the one rigging risk (the byte bound asserted from the function's own return
  value) is closed by D2's spec requiring an independent fs-level measurement, which a default
  review can check against the diff.

## Acceptance Tests

- AC1 → unit `src/shared/demos/dm2-header.test.ts` › "a protocol-34 demo reports its map from CS_MODELS+1"
  and unit `src/main/lib/demo-bytes.test.ts` › "the real test.dm2 reports its map, level, game dir, POV and players"
- AC2 → unit `src/shared/demos/dm2-header.test.ts` › "the level name comes from CS_NAME"
  (+ the real-fixture test above)
- AC3 → unit `src/shared/demos/dm2-header.test.ts` › "the game dir comes from serverdata and an empty one is baseq2"
- AC4 → unit `src/shared/demos/dm2-header.test.ts` › "the POV is the playernum skin slot up to the first backslash"
- AC5 → unit `src/shared/demos/dm2-header.test.ts` › "every non-empty player skin slot yields a player name"
- AC6 → unit `src/shared/demos/dm2-header.test.ts` › "a 3434-3436 demo yields the same facts through the extended layout and reports its protocol"
- AC7 → unit `src/main/lib/demo-bytes.test.ts` › "a gzipped demo yields exactly the facts of the uncompressed one"
- AC8 → unit `src/shared/demos/dm2-header.test.ts` › "parsing stops after the header regardless of trailing frames"
  and unit `src/main/lib/demo-bytes.test.ts` › "a 32 MiB demo is read only up to the header bound, plain and gzipped"
- AC9 → unit `src/shared/demos/dm2-header.test.ts` › "empty, truncated, garbage and unknown-protocol input return a typed unparsable reason"
  and › "mutated demos never throw and always return a result"
  and unit `src/main/lib/demo-bytes.test.ts` › "a missing file is unreadable and a cut gzip is truncated"
  (showing it is [[145]]'s; no user action here, so no e2e line)

## Done

<!-- Filled by /build 136. -->
