---
id: 145
title: a demo I cannot parse still shows up
status: done # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

A demo from an unusual build, a half-written file, a corrupt download — the header parser
([[136]]/[[137]]) cannot read it. It is still the user's file: it appears in the list, marked as
unreadable with the reason, and shows whatever the file name and file time can tell (concept
`docs/concepts/demo-browser.md` §15, DEMO-7). A demo never silently disappears because the parser
does not understand it.

## Acceptance Criteria

*(Rescoped to the data layer for S26 — see Decisions (Sprint) "Scope vs. sprint cut". The
user-visible list marker, detail rendering, sidecar/reveal/rename and Play live in [[150]],
[[155]], [[146]]/[[156]]/[[157]] and [[159]] respectively.)*

- [x] **AC1** — A file the parser (`[[136]]`/`[[137]]`) reports as unparsable still becomes an
      index entry, flagged `readable: false`, never dropped from the index.
- [x] **AC2** — The entry carries the parser's closed reason code (plus `protocol`/`version` data
      where relevant) and an exhaustive `Record<Reason, …>` i18n-key mapping ships with its
      `en.json` strings, unit-tested for every reason code.
- [x] **AC3** — The entry's name facts come from [[139]] and its effective date is the file's
      modification/creation time with source `file-time`; every parsed field is `null`, never a
      partial result of the failed parse.
- [x] **AC4** — The entry has the same id kind as a readable demo and carries no readability gate
      on the data side — nothing about sidecar, reveal, copy path or rename is disabled here at
      the data layer; each of those stories ([[146]], [[156]], [[157]]) adds its own AC proving it
      works for an unreadable demo on the real surface.
- [x] **AC5** — *(moved to [[159]], S28)* — Play's disabled-with-reason behaviour for an
      unreadable demo is implemented and tested there; this story ships only the reason's i18n
      key (`replays.unreadable.playDisabled`).

## Open Questions

- [x] ~~**Q1 — Playing an unreadable demo** — the game dir is unknown: disable Play with the reason,
      or offer Play in a chosen installation and let the engine decide?~~ answered → Decisions
      (Sprint)
- [x] ~~**Q2 — Scope vs. sprint cut (blocks refine).**~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Scope vs. sprint cut: option A — rescope 145 to the data layer and keep it in S26.
  AC1 → the replays list/index read returns the unparsable file as an entry flagged
  `readable: false`, never dropped. AC2 → the entry carries the closed reason code (+
  `protocol`/`version` data) and a typed, exhaustive reason→i18n mapping plus its `en.json`
  strings ship here (render tested by a unit test; the detail view that hosts it is [[155]]).
  AC3 → the entry's name facts come from [[139]] and its effective date is the file time with
  source `file-time`. AC4 → the entry has the same id kind and no readability gate on the data
  side; "also for an unreadable demo" becomes one added AC each in [[146]], [[156]], [[157]]
  (their refine proves it on the real surface). AC5 → moves to [[159]] as an AC there, carrying
  the Play-disabled decision below verbatim; the reason's i18n key ships here. [[150]] already
  owns the visible row marker (its AC references 145).

- **(User)** Play on an unreadable demo: disable Play with the reason, consistent with the
  module's disabled+reason pattern elsewhere, rather than letting the user guess an
  installation for an engine that may reject a gamedir mismatch.
- **Reason → i18n keys** are `replays.unreadable.reason.<code>` for exactly [[136]]'s closed union
  (`empty`, `truncated`, `not-a-demo`, `unknown-protocol`, `header-too-large`, `unreadable`, treated
  as a snapshot) plus whatever [[137]] adds for MVD2 (e.g. an out-of-range version); the mapping is
  a `Record<Reason, …>` so a new code fails typecheck until it has a key; `unknown-protocol`
  interpolates `{{protocol}}` ("Unknown protocol 36"). Reason: CLAUDE.md — main sends codes, never
  prose, and an exhaustive record makes a sibling's new code impossible to forget.
- **An unparsable entry carries no parsed facts** — every parsed field is `null`, never a partial
  result of the failed parse. Reason: [[136]]'s "a missing fact is `null`, never a guess".
- **The "unreadable" marker is text** (`replays.unreadable.marker`, "Unreadable"), not colour or an
  icon alone. Reason: `/design-tokens` non-colour status rule, kept in full by every CLAUDE.md
  deviation row.
- **Play's reason text** is its own key, `replays.unreadable.playDisabled` ("Can't play: this demo's
  header could not be read, so its mod is unknown."). Reason: CLAUDE.md platform-parity/disabled
  rule — the reason is visible text and an i18n key, and it follows the (User) decision above.
- **The reason union is nine codes**: [[136]]'s six, [[137]]'s `unknown-version` and [[143]]'s
  `entry-too-large`/`encrypted`. Reason: 143 (built before this story) widens the union and
  defers its two strings to "the map [[145]] ships" ("Too large to read inside an archive",
  "Encrypted archive entry"), so this story owns all nine keys.
- **`unknown-version` interpolates `{{version}}`** ("Unknown MVD version 2008"), like
  `unknown-protocol`. Reason: [[137]] carries `version` for that code for exactly this purpose.
- **Readability is decided by the header result alone**: `ok: false` → `readable: false`. A
  readable header with an undeterminable duration stays readable (duration unknown, [[138]] AC4).
  Reason: the header is what gives map/mod/players; the duration has its own "unknown" state.
- **For an unreadable entry the duration is not computed or kept (`null`)**, and the header slot
  holds only the parser's `ok: false` value. Reason: that is the real "partial result" risk — a
  cut or oversized header can still yield a frame count, which AC3 forbids.
- **The entry keeps 144's parse result shape and gains `readable` + `unreadable`** (`{ reason,
  protocol?, version? } | null`); no flat copy of the parsed facts is added. Reason: [[148]]'s
  resolver takes the raw header result and treats `ok: false` as "no demo rung" — one shape, no
  parallel copy to drift.
- **AC3's "effective date with source file-time" is [[148]]'s `'file'` rung, reached when the name
  has no date.** This story guarantees the inputs (name facts, `fileTime: { birthtimeMs, mtimeMs }`
  on the entry, no header date); the arbitration is [[148]]'s, whose tests already cover
  `ok: false` → absent and the file-time fallback. Reason: 148 is built after 145 and owns the
  precedence (sidecar → content → name → file time); a second date rule here would drift from it.
- **A zip entry's `fileTime`** is `{ birthtimeMs: 0, mtimeMs: entry modified ?? archive mtime }`
  unless 143 already put a file time on its rows. Reason: 143's rule, and 148's "birthtime `0` →
  modification" fallback then picks the right value.
- **The projection runs where 144 turns a (cached) parse result into an entry**, so the cache shape
  does not change and `REPLAYS_INDEX_CACHE_VERSION` is not bumped. Reason: 144 bumps only when a
  cached shape changes; an unreadable result is cached like any other and not re-parsed.
- **No CHANGELOG entry, no UI.** Reason: nothing user-visible ships until [[150]]/[[155]] mount the
  marker and reason in S27.

## Plan

Triage: clear and ready — a data-layer projection plus one i18n mapping.

1. **D1 — pure readability projection** `src/shared/demos/readability.ts`: the nine-code union
   (checked both ways against the parsers' built union), its zod schema, `demoReadability(header)`.
2. **D2 — the index keeps unreadable demos**: wire D1 into 144's entry building (and 143's zip-row
   path if separate); `fileTime` on every entry; duration `null` for unreadable; real-fs test
   through the scan service / `index.read`.
3. **D3 — reason → i18n mapping** in the renderer's replays module plus the `replays.unreadable`
   block in `en.json`, tested for every code.

Order: D1 → D2; D3 needs only D1.

## Deliverables

- **D1 — readability projection (pure) + tests.**
  Files: new `src/shared/demos/readability.ts`, new `src/shared/demos/readability.test.ts`. Mirror
  the pure style of `src/shared/demos/dm2-header.ts` (no `node:*`, no DOM, no electron; zod allowed,
  as in `src/shared/schemas.ts`).
  Exports: `DEMO_UNREADABLE_REASONS = ['empty', 'truncated', 'not-a-demo', 'unknown-protocol',
  'header-too-large', 'unreadable', 'unknown-version', 'entry-too-large', 'encrypted'] as const`;
  `type DemoUnreadableReason`; a compile-time two-way equality check between that type and the
  reason union of every unparsable result an index row can carry (`Extract<DemoHeaderResult,
  { ok: false }>['reason']` from `src/shared/demos/demo-header.ts` — story 143 widened it with
  `entry-too-large`/`encrypted`; locate where) so a new parser code fails typecheck until listed;
  `demoUnreadableSchema = z.object({ reason: z.enum(DEMO_UNREADABLE_REASONS), protocol:
  z.number().int().optional(), version: z.number().int().optional() })` + `type DemoUnreadable`;
  `demoReadability(result: DemoHeaderResult): { readable: true; unreadable: null } | { readable:
  false; unreadable: DemoUnreadable }` — copies `reason`, and `protocol`/`version` only when present.
  Tests: › "every unparsable reason becomes readable false with its code" (`it.each` over
  `DEMO_UNREADABLE_REASONS`, plus `protocol` 36 and `version` 2008 passed through, absent keys stay
  absent); › "a parsed header is readable with no reason" (a `buildDm2` and a `buildMvd2` demo from
  `src/shared/demos/dm2-writer.ts` / `mvd2-writer.ts` through `parseDemoHeader`); › "the real
  parsers' failures project to their reason" (empty bytes, 64 random bytes, a protocol-35 `buildDm2`,
  a version-2008 `buildMvd2` → `empty`, `not-a-demo`, `unknown-protocol` + 35, `unknown-version` +
  2008). Acceptance: tests pass; `npm run typecheck` clean.

- **D2 — unreadable demos stay in the index + tests.**
  Files: `src/main/modules/replays/incremental-scan.ts` (story 144; wherever a parse result becomes
  an entry), the index entry schema/type (element of `index.read`'s response in
  `src/shared/modules/replays.ts`), `src/main/modules/replays/zip-demos.ts` only if 143's zip rows
  are built outside that path, `src/main/modules/replays/scan-service.test.ts` (add a `describe`).
  Read those files first; mirror 144's existing test setup (temp userData + temp demo folder, real
  fs). Spec: every entry gains `readable: boolean` and `unreadable: DemoUnreadable | null` from D1's
  `demoReadability` (schema via `demoUnreadableSchema`), computed from the (cached) parse result —
  do not change the cached row shape, do not bump `REPLAYS_INDEX_CACHE_VERSION`. Every entry carries
  `fileTime: { birthtimeMs: number; mtimeMs: number }` from the file's stat (reuse the field if 144
  already has one); a zip-entry row uses `{ birthtimeMs: 0, mtimeMs: entry modified ?? archive
  mtime }` unless 143 already set one. For `readable: false`: the header slot is exactly the
  parser's `ok: false` value, the duration is not computed and is `null`, and name facts come from
  the same 139 matcher as for readable entries. Nothing drops or filters an entry for being
  unreadable; add no field that gates actions on readability.
  Tests (real parsers, real files in the temp demo folder: `2026-09-26-2130-q2dm1.dm2` = 64 garbage
  bytes, `empty.dm2` = 0 bytes, `broken.dm2` = the first 100 bytes of `docs/fixtures/demos/test.dm2`,
  plus a full copy `good.dm2`): › "an unparsable demo file is still an index entry, flagged
  unreadable" (after a scan `index.read` lists all four; the three bad ones `readable: false` with
  `not-a-demo` / `empty` / `truncated`, `good.dm2` `readable: true`, `unreadable: null`); › "an
  unreadable entry carries its name facts and file time and no parsed fact" (the garbage file's
  name facts give map `q2dm1` and date 2026-09-26 21:30; `broken.dm2`'s `fileTime` equals
  `fs.stat`'s `birthtimeMs`/`mtimeMs`; each unreadable header slot deep-equals `{ ok: false, reason
  … }` with no map/players/gameDir key; duration `null`); › "an unreadable entry has the same id
  kind and fields as a readable one" (both ids match `/^[0-9a-f]{16}$/` and equal discovery's id for
  that file; `Object.keys` of an unreadable and the readable entry are identical; every entry parses
  with the index entry schema).
  Acceptance: those tests pass; the existing 141/143/144 tests stay green; `npm run typecheck` clean.

- **D3 — reason → i18n mapping + en strings + tests.**
  Files: new `src/renderer/src/modules/replays/unreadable-reason.ts`, new
  `src/renderer/src/modules/replays/unreadable-reason.test.ts` (mirror the `initI18n('en')` setup
  of `src/renderer/src/modules/servers/ServersListStatus.test.tsx`), edit
  `src/renderer/src/i18n/locales/en.json` (inside the existing top-level `replays` block). Import
  `DEMO_UNREADABLE_REASONS`, `DemoUnreadableReason`, `DemoUnreadable` from
  `@shared/demos/readability`.
  Spec: `UNREADABLE_REASON_KEYS: Record<DemoUnreadableReason, string>` mapping each code to
  `replays.unreadable.reason.<code>` (literal code, hyphens kept — `en.json` already has hyphenated
  keys); `unreadableReasonMessage(u: DemoUnreadable): { key: string; params?: { protocol?: number;
  version?: number } }` passing `protocol`/`version` when present. Strings (`replays.unreadable`):
  `marker` "Unreadable"; `playDisabled` "Can't play: this demo's header could not be read, so its
  mod is unknown."; `reason`: `empty` "The file is empty.", `truncated` "The file ends before its
  header is complete.", `not-a-demo` "This is not a Quake II demo.", `unknown-protocol` "Unknown
  protocol {{protocol}}", `header-too-large` "The header is larger than any known demo.",
  `unreadable` "The file could not be read.", `unknown-version` "Unknown MVD version {{version}}",
  `entry-too-large` "Too large to read inside an archive", `encrypted` "Encrypted archive entry"
  (keep 143's wording if it already added these two).
  Tests: › "every unreadable reason code has an en string" (`it.each` over
  `DEMO_UNREADABLE_REASONS`: `t(key, params)` is non-empty, not the key itself, contains no `{{`);
  › "unknown protocol and version interpolate their number" (36 → "Unknown protocol 36", 2008 →
  "Unknown MVD version 2008"); › "the unreadable marker and play-disabled reason have en strings"
  (exact strings above). Acceptance: tests pass; `npm run typecheck` clean.

## Model Hints

- D1 → default — a pure projection with a compile-time exhaustiveness check.
- D2 → default — wiring into 144's existing entry building, every rule pinned by a real-fs test.
- D3 → default — a key record and eleven strings.
- Review: → default — the plausible wrong implementations (dropping or filtering unreadable files,
  keeping a frame count for a failed header, a reason missing from the record) each fail a named
  test or typecheck, which a default review can check against the diff.

## Acceptance Tests

- AC1 → unit `src/main/modules/replays/scan-service.test.ts` › "an unparsable demo file is still an
  index entry, flagged unreadable" (D2); unit `src/shared/demos/readability.test.ts` › "the real
  parsers' failures project to their reason" (D1). No user action (data layer, rescoped); the visible
  row marker is [[150]]'s e2e.
- AC2 → unit `src/shared/demos/readability.test.ts` › "every unparsable reason becomes readable
  false with its code" (D1); unit `src/renderer/src/modules/replays/unreadable-reason.test.ts` ›
  "every unreadable reason code has an en string" and › "unknown protocol and version interpolate
  their number" (D3); exhaustiveness by `npm run typecheck` (D1's two-way check, D3's `Record`).
- AC3 → unit `src/main/modules/replays/scan-service.test.ts` › "an unreadable entry carries its name
  facts and file time and no parsed fact" (D2); the date arbitration (name date, else file time,
  source `'file'`) is [[148]]'s `src/shared/demos/effective-values.test.ts` › "the effective date is
  the sidecar override, else the name date, else the file time", run on these entry fields in S27.
- AC4 → unit `src/main/modules/replays/scan-service.test.ts` › "an unreadable entry has the same id
  kind and fields as a readable one" (D2); the per-action proof on the real surface is [[146]],
  [[156]], [[157]]'s added AC.
- AC5 → moved to [[159]]; the key it ships is proven by unit
  `src/renderer/src/modules/replays/unreadable-reason.test.ts` › "the unreadable marker and
  play-disabled reason have en strings" (D3).

## Done

Shipped the data-layer projection: `src/shared/demos/readability.ts` (D1) turns any parser
`ok: false` result into a closed `readable/unreadable` shape with a compile-time exhaustiveness
guard; `src/main/modules/replays/scan-service.ts` + `discovery.ts` + `zip-demos.ts` (D2) wire it
into every entry (loose and zip), add `fileTime`/`nameFacts`, keep name facts and file-time for
unreadable rows, never drop/filter, never bump `REPLAYS_INDEX_CACHE_VERSION`;
`src/renderer/src/modules/replays/unreadable-reason.ts` + `en.json` (D3) ship the nine-code
`Record` mapping and strings, unit-tested for every code including interpolation.

Commit message: `145: an unreadable demo still becomes an index entry`

Verification (narrow gate): `npm run build` green, `npm run typecheck` green,
`npx vitest run --changed HEAD` green (111 files/1657 tests), plus the required extra sweep
`npx vitest run src/main/modules/replays src/shared/modules/replays.test.ts src/shared/demos
src/shared/replays` green (20 files/215 tests) — no collateral breakage from 144's setup change.
No e2e run: story is scoped to the data layer only (Decisions "Scope vs. sprint cut"), no
list/detail UI ships here. AC → test mapping, all confirmed ran+passed: AC1 →
`scan-service.test.ts` "an unparsable demo file is still an index entry, flagged unreadable" +
`readability.test.ts` "the real parsers' failures project to their reason"; AC2 →
`readability.test.ts` "every unparsable reason becomes readable false with its code" +
`unreadable-reason.test.ts` "every unreadable reason code has an en string" / "unknown protocol
and version interpolate their number" + typecheck exhaustiveness; AC3 → `scan-service.test.ts`
"an unreadable entry carries its name facts and file time and no parsed fact"; AC4 →
`scan-service.test.ts` "an unreadable entry has the same id kind and fields as a readable one";
AC5 → `unreadable-reason.test.ts` "the unreadable marker and play-disabled reason have en
strings" (i18n key only, behaviour moved to 159). No manual residue. Default-tier review PASSed
with no findings (verified the exhaustiveness check empirically by injecting a fake reason and
confirming typecheck failed, then reverted).

Decisions (implementation-detail, not in story): `entry-too-large`/`encrypted`/`unreadable` are
zip-layer codes (never emitted by `parseDemoHeader` itself), so D1's exhaustiveness check is a
one-way assertion (every parser reason ⊆ the 9-code union) rather than a literal two-way type
equality — documented in `readability.ts`'s header comment; this still fails typecheck on any
new parser code left out of the union, which is what the story asks for. `discovery.ts` and
`index.ts` needed touching beyond D2's named file list because `discoveredDemoSchema` gained
required fields and every `DiscoveredDemo` construction site had to supply them — confirmed
necessary by the reviewer, not scope creep.

tiers: D 3 / hard 0 · review default · cycles 1 · agents 5
