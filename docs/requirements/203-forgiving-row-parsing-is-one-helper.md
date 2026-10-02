---
id: 203
title: forgiving row parsing is one helper
status: ready # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As the maintainer I want "parse this persisted list row by row, drop the bad rows, dedupe, log
what was dropped" to be one helper with one policy, so that a new persisted collection costs one
line instead of 10–20 and a change to the drop/dedupe/log policy is made once.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F25): `src/main/lib/schemas.ts`
contains `parseForgivingRows` with the comment "generalized so categories and actions can reuse it
instead of duplicating the map-safeParse-filter dance", yet the same file has 27 `safeParse`
calls and 8 hand-written `parseXRow` helpers each followed by `.map(parseXRow).filter(row !== null)`;
three address-keyed rows are byte-identical; the envelope idiom
`safeParse(raw === undefined ? {} : raw)` is copied four times; `dedupeByKey` is applied
afterwards in eight places; `parseModWarning` bypasses zod entirely. `mods/install-records`,
`mods/catalog-parse` and `downloads/manifest-parse` each hand-roll the same loop with their own
log line.

## Acceptance Criteria

- [ ] **AC1** — `src/main/lib/forgiving.ts` exports `parseForgivingRows` (moved),
      `parseForgivingEnvelope(schema, raw, fallback)`, `parseKeyedRows(schema, raw, { keyOf, refine? })`
      and `dedupeByKey`, with an `onDrop` callback for module log lines; one unit test file covers
      drop, dedupe-first-wins, missing envelope and the callback.
- [ ] **AC2** — The hand-written `parseXRow` + map/filter pairs and the four envelope blocks in
      `lib/schemas.ts` are expressed through the helpers; the file's `safeParse` count drops by at
      least half and no `function parse*Row` remains that only wraps `safeParse`.
- [ ] **AC3** — `parseModWarning` is a zod schema with `.catch()` like its siblings.
- [ ] **AC4** — The three module loops (`install-records`, `catalog-parse`, `manifest-parse`)
      use `parseKeyedRows`/`parseForgivingRows` and keep their log wording via `onDrop`.
- [ ] **AC5** — Behaviour is unchanged: `schemas.test.ts` passes without weakening any assertion;
      redundant per-row cases that now test the helper may be deleted once the helper's own test
      covers them.

## Open Questions

- ~~**Q1**~~ answered → Decisions (Sprint) — Does story 207 (modules own their persisted state) want this helper in
  `src/main/lib` or in `src/shared`? It uses no node API, so shared is possible; the review
  recommends `src/main/lib` because only main parses persisted files.

## Decisions (Sprint)

- **(User)** helper location: `src/main/lib`.
- **D-a** `refine` returns `U | null` (no reason string); a refused row reaches `onDrop` with its
  parsed value, so a caller (the catalog's pinned check) builds its own wording from it — keeps the
  helper's contract minimal while AC4's wording survives.
- **D-b** `keyOf` takes one key function _or_ a record of named key functions checked in order, and
  keys are recorded only for kept rows — the mod catalog dedupes on id _and_ gamedir with separate
  messages and today only records a row's keys after every check passed.
- **D-c** Pipeline order is fixed: shape (`schema`) → `refine` → dedupe; caps (`slice`, `capServerHistory`)
  stay at the caller after the helper — this is today's order in every caller (address is normalised
  before the address dedupe, caps cut after dedupe).
- **D-d** `parseForgivingEnvelope(schema, raw, fallback)` treats `raw === undefined` as `{}`, and
  `fallback` is a function returning an _envelope-shaped_ value (fresh per call) — then all four
  envelope callers keep one return path; servers' fallback envelope seeds `DEFAULT_MASTER_SOURCES`
  so the garbage-input result equals today's `cloneDefaultServersState()` (proved by the existing
  `parseServersState` tests).
- **D-e** `parseHomeLayout` keeps its own strict envelope (it is not one of the four
  `raw === undefined ? {} : raw` blocks and a missing key must fall back wholesale), but its tile
  rows and `moduleId` dedupe go through `parseKeyedRows`.
- **D-f** Exported `parseInstallation`/`parseConfigProfile` stay (public API used by tests, not
  `parse*Row` helpers); `parseInstallations`/`parseConfigProfiles` become `parseForgivingRows` calls.
- **D-g** `configWriteFailuresSchema`'s record-entry filter stays as is — it filters a record, not
  an array, and AC2 is about the row helpers.
- **D-h** AC2's counting claims are proven by a source-scan test (precedent: `renderer-source.test.ts`
  reads sources) rather than left to review — a structural AC with no test is an unverifiable promise.
- **D-i** No CHANGELOG entry — internal refactor, nothing user-visible changes (CLAUDE.md changelog rule).
- **D-j** No systems doc covers persisted-state parsing; the doc update is the "State and persistence"
  paragraph of `docs/ARCHITECTURE.md`.

## Plan

1. **D1 — the helper.** New `src/main/lib/forgiving.ts` with `parseForgivingRows` (moved out of
   `lib/schemas.ts`), `parseKeyedRows`, `parseForgivingEnvelope`, `dedupeByKey` (moved) and an
   `onDrop` callback; `lib/schemas.ts` imports the two moved functions. Own test file.
2. **D2 — `lib/schemas.ts` uses it.** Replace the 8 `parseXRow` helpers + map/filter pairs, the four
   `raw === undefined ? {} : raw` envelope blocks, the hand-rolled unlock/extraFolders row loops and
   `parseInstallations`/`parseConfigProfiles`; `parseModWarning` becomes a zod schema with `.catch()`.
   Source-scan test for the counts; ARCHITECTURE.md sentence.
3. **D3 — the three module loops.** `mods/install-records.ts`, `mods/catalog-parse.ts`,
   `downloads/manifest-parse.ts` go through the helper; log wording kept via `onDrop` and pinned by
   exact-wording test cases.

Order D1 → D2 → D3 (D2 and D3 are independent of each other once D1 lands). No IPC, no renderer,
no shared-layer change; behaviour is unchanged (AC5) — `schemas.test.ts`, `catalog-parse.test.ts`,
`manifest-parse.test.ts`, `install-record.test.ts` are the regression net and are not weakened.

## Deliverables

- **D1 — `src/main/lib/forgiving.ts` + `src/main/lib/forgiving.test.ts`** (also touches
  `src/main/lib/schemas.ts`: delete its local `parseForgivingRows` (≈line 553) and `dedupeByKey`
  (≈line 1276) and import them from `./forgiving` — no other change there). Pure module: imports only
  `zod`, no node/electron. Exports:
  - `type RowDrop<T, U>` — discriminated on `reason`: `{ reason: 'invalid'; index; row: unknown; error: z.ZodError }`
    | `{ reason: 'refused'; index; row: unknown; parsed: T }` | `{ reason: 'duplicate'; index; row: unknown; parsed: U; key: string }`
    (`index` = position in the raw array; `key` = the name of the key that collided, `'key'` for a single key function).
  - `parseForgivingRows<T>(schema: z.ZodType<T>, raw: unknown, options?: { onDrop?: (drop) => void }): T[]` —
    non-array `raw` → `[]`; each element `safeParse`d; failures dropped (and reported `invalid`). Same
    behaviour as the current one in `lib/schemas.ts`.
  - `parseKeyedRows<T, U = T>(schema, raw, { keyOf, refine?, onDrop? }): U[]` — pipeline per row, in this
    order: shape (`schema.safeParse`, else `invalid`) → `refine?.(parsed)` returning `U | null` (`null` →
    `refused`) → dedupe. `keyOf` is either `(row: U) => string` or a record of named key functions
    (`{ id: r => r.id, gamedir: r => r.gamedir.toLowerCase() }`) checked in declaration order; the first
    already-seen key drops the row as `duplicate` with that key's name. **Keys are recorded only for rows
    that are kept** (a row dropped for a duplicate gamedir does not reserve its id). First occurrence wins.
  - `parseForgivingEnvelope<T>(schema: z.ZodType<T>, raw: unknown, fallback: () => T): T` —
    `schema.safeParse(raw === undefined ? {} : raw)`; on failure returns `fallback()` (a fresh value per call).
  - `dedupeByKey<T>(rows: T[], keyOf: (row: T) => string): T[]` — moved unchanged, first wins.
    Test file covers: invalid row dropped while siblings survive, non-array raw → `[]`, refine-null
    dropped, dedupe first-wins, multi-key dedupe with keys recorded only for kept rows, envelope
    `undefined` → `{}` path, envelope garbage → `fallback()` (and two calls return distinct objects), and
    `onDrop` called once per drop with the right `reason`/`index`/`key`. Use the shared test-support kit
    in `src/test-support/` where it offers a fit (story 225), no ad-hoc logger.

- **D2 — `src/main/lib/schemas.ts` expressed through the helpers** (files: `src/main/lib/schemas.ts`,
  `src/main/lib/schemas.test.ts`, `docs/ARCHITECTURE.md`). Helpers in `./forgiving`:
  `parseForgivingRows(schema, raw, {onDrop?})`, `parseKeyedRows(schema, raw, { keyOf, refine?: (parsed) => U | null })`
  (shape → refine → dedupe, first wins), `parseForgivingEnvelope(schema, raw, fallback: () => T)`
  (`undefined` raw is `{}`), `dedupeByKey`. Changes:
  - `parseInstallations`/`parseConfigProfiles` → `parseForgivingRows(installationSchema|configProfileSchema, raw)`.
    Keep the exported `parseInstallation`/`parseConfigProfile` (tests use them).
  - `parseHomeLayout`: keep its own strict `{ tiles: z.array(z.unknown()) }` envelope (missing key →
    `DEFAULT_HOME_LAYOUT` wholesale); tiles via `parseKeyedRows(tilePlacementSchema, …, { keyOf: t => t.moduleId })`;
    delete `parseTilePlacement` and the inline Set filter.
  - `parseServersState`: envelope via `parseForgivingEnvelope(serversStateEnvelopeSchema, raw, () => ({ sources:
structuredClone(DEFAULT_MASTER_SOURCES), favourites: [], manualServers: [], history: [], watchlist: [], quickFilters: [] }))`
    — the garbage-input result must stay equal to today's `cloneDefaultServersState()` (scan/listSort are read
    off `raw` as today; delete `cloneDefaultServersState` if unused). Sources: `parseKeyedRows(serverSourceEntrySchema,
…, { refine: validate via validateMasterSourceAddress → {...row, address: normalized} | null, keyOf: id })`.
    The three address-keyed rows (favourites/manualServers/history) share **one** refine function
    (`parseServerAddress` → normalised address or `null`) and `keyOf: r => r.address`; history keeps
    `capServerHistory(...)` around the result. Watchlist `keyOf: id`; quickFilters `keyOf: name.toLowerCase()`
    then `.slice(0, QUICK_FILTER_MAX)`. Delete all six `parse*Row` functions.
  - `parseUnlockState`: `parseForgivingEnvelope(unlockStateEnvelopeSchema, raw, () => ({ codes: [] }))` then
    `parseKeyedRows(unlockCodeEntrySchema, …, { keyOf: code }).slice(0, MAX_UNLOCK_CODES)`.
  - `parseNameTemplatesState`: envelope fallback `() => ({ entries: [], removedShippedIds: [] })` (equal to
    `DEFAULT_NAME_TEMPLATES_STATE`; delete `cloneDefaultNameTemplatesState` if unused); entries via `parseKeyedRows(storedNameTemplateSchema, …, { refine:
non-null template must pass nameTemplateTextSchema, keyOf: id })`; removedShippedIds via
    `parseKeyedRows(z.string(), …, { keyOf: id => id })`. Delete `parseNameTemplateRow`.
  - `parseExtraFolders`: envelope fallback `() => ({ extraFolders: [] })`, rows via
    `parseKeyedRows(storedExtraFolderSchema, …, { keyOf: r => pathKey(r.path) })`.
  - `parseModWarning` → `modWarningSchema` (zod, like its siblings): `z.object({ enabled: z.boolean().catch(true),
trustedMods: z.array(z.unknown()).catch([]).transform(rows => parseKeyedRows(modDirSchema, rows, { keyOf: d => d })) })
.catch(() => ({ enabled: true, trustedMods: [] }))`, where `modDirSchema` is
    `z.string().regex(MOD_DIR_PATTERN).refine(d => d !== '.' && d !== '..').transform(d => d.toLowerCase())`.
    `parseReplaysState` calls `modWarningSchema.parse(raw?.modWarning)`.
  - Leave `configWriteFailuresSchema`'s record filter and the field-level `listSort`/`listFilter` safeParses alone.
  - Update doc comments that say "mirrors X exactly"/name deleted helpers so they point at `lib/forgiving.ts`.
  - `schemas.test.ts`: **no assertion weakened**; per-row cases that only re-test the helper may be deleted.
    Add `describe('schemas.ts uses the forgiving helpers (story 203)')` › "schemas.ts holds no hand-rolled row
    parser": reads `src/main/lib/schemas.ts` as text and asserts (a) `safeParse` occurrences ≤ 13 (today 27),
    (b) no match for `/function parse\w*Row\(/`, (c) no `raw === undefined ? {} : raw`. Plus a case
    "modWarning is a zod schema that catches garbage": `parseReplaysState({ modWarning: 'x' })`,
    `{ modWarning: [] }`, `{ modWarning: null }` each → `{ enabled: true, trustedMods: [] }`.
  - `docs/ARCHITECTURE.md` "State and persistence", the "Parsing is deliberately forgiving" paragraph: one
    sentence that row-level dropping, dedupe and envelope fallback go through `src/main/lib/forgiving.ts`.

- **D3 — the three module loops use the helper** (files: `src/main/modules/mods/install-records.ts`,
  `src/main/modules/mods/catalog-parse.ts`, `src/main/modules/downloads/manifest-parse.ts`,
  `src/main/modules/mods/catalog-parse.test.ts`, `src/main/modules/downloads/manifest-parse.test.ts`,
  `src/main/modules/mods/install-record.test.ts`, `src/main/lib/forgiving.test.ts`). Helpers in
  `src/main/lib/forgiving.ts` (import relatively, `../../lib/forgiving`): `parseForgivingRows(schema, raw, { onDrop? })`
  and `parseKeyedRows(schema, raw, { keyOf, refine?, onDrop? })` — shape → `refine` (`U | null`) → dedupe;
  `keyOf` may be a record of named key functions checked in order, keys recorded only for kept rows;
  `onDrop(drop)` gets `{ reason: 'invalid', index, row, error } | { reason: 'refused', index, row, parsed } |
{ reason: 'duplicate', index, row, parsed, key }`.
  - `install-records.ts`: `readModsState` → `parseForgivingRows(recordSchema, rows)` (no dedupe, no log — as
    today); `recordedGameDirs` → `new Set(parseForgivingRows(z.object({ gameDir: z.string().min(1) }), rows)
.map(r => r.gameDir.toLowerCase()))`. Keep `envelopeOf`.
  - `catalog-parse.ts`: envelope/schemaVersion checks unchanged; entries via `parseKeyedRows(entrySchema,
envelope.data.entries, { refine: e => e.versions.some(v => v.version === e.pinned) ? e : null, keyOf:
{ id: e => e.id, gamedir: e => e.gamedir.toLowerCase() }, onDrop })` where `onDrop` builds the label
    `mod catalog entry at index ${index}${idOf(row) ? ` (id: ${idOf(row)})` : ''}` and emits exactly today's
    four messages: `${label} dropped: ${error.message}`, `${label} dropped: pinned "${parsed.pinned}" names no
listed version`, `${label} dropped: duplicate id`, `${label} dropped: duplicate gamedir "${parsed.gamedir}"`.
  - `manifest-parse.ts`: packages via `parseForgivingRows(packageSchema, envelope.data.packages, { onDrop })`
    emitting exactly `manifest package at index ${index}${id ? ` (id: ${id})` : ''} dropped: ${error.message}`.
    `resolvePinned` unchanged.
  - Tests: in `catalog-parse.test.ts` add "each drop reason keeps its log wording" asserting the exact
    pinned/duplicate-id/duplicate-gamedir messages (and that a row dropped for a duplicate gamedir does not
    reserve its id); in `manifest-parse.test.ts` add "a dropped package logs its index and id" asserting
    the exact prefix `manifest package at index 1 (id: broken) dropped: `. Existing cases stay unweakened.
    In `src/main/lib/forgiving.test.ts` add "the module row loops go through the helper": reads the three
    source files and asserts each imports from `lib/forgiving` and none contains a `for (const` loop over
    rows calling `.safeParse(row)`.

## Model Hints

- D1, D2, D3 → default tier. D2 is the largest diff but every branch it touches has an existing
  `schemas.test.ts` case, and the risky equivalences (servers fallback, dedupe-before-cap, normalise-before-dedupe)
  are spelled out in the D.
- Review: → default — the plausible wrong implementations (changed log wording, keys reserved by dropped
  rows, weakened assertions, a left-over hand loop) are each pinned by a named test or the source scan.

## Acceptance Tests

- AC1 → unit `src/main/lib/forgiving.test.ts` › "drops an invalid row and keeps its siblings",
  "dedupe keeps the first occurrence", "a key is reserved only by a kept row",
  "a missing envelope parses as {} and garbage returns the fallback", "onDrop reports every drop with its reason" (D1)
- AC2 → unit `src/main/lib/schemas.test.ts` › "schemas.ts holds no hand-rolled row parser" (D2)
- AC3 → unit `src/main/lib/schemas.test.ts` › "modWarning is a zod schema that catches garbage", plus the existing
  "modWarning loads forgivingly and round-trips" (D2)
- AC4 → unit `src/main/lib/forgiving.test.ts` › "the module row loops go through the helper";
  `src/main/modules/mods/catalog-parse.test.ts` › "each drop reason keeps its log wording";
  `src/main/modules/downloads/manifest-parse.test.ts` › "a dropped package logs its index and id" (D3)
- AC5 → unit, the full existing suites `src/main/lib/schemas.test.ts`, `src/main/modules/mods/catalog-parse.test.ts`,
  `src/main/modules/downloads/manifest-parse.test.ts`, `src/main/modules/mods/install-record.test.ts` pass with no
  assertion weakened (diff-checked by the review) (D2, D3)
- No e2e line: no criterion describes a user action; nothing user-visible changes.

## Done

<!-- Filled by /build 203. -->
