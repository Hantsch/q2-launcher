---
id: 211
title: config profile shapes are declared once
status: ready # draft -> ready -> in-progress -> done
created: 2026-10-02
---

## Requirement

As the maintainer I want a field added to `ConfigAction` or `ConfigProfile` to be a one-file
change the compiler checks end to end, so that a missed twin schema can no longer silently strip
the field on IPC or on load, and so that import and refresh feed the restore pipeline through one
adapter instead of two.

Today ([review 2026-10-01](../reviews/2026-10-01-codebase-review.md), F15, F36, F37):

- The shapes exist three times: TS interfaces in `src/shared/modules/config.ts`; IPC zod in
  `src/main/modules/config/schemas.ts` (653 lines); persisted zod in `src/main/lib/schemas.ts`
  (~650 lines). The two zod trees are 1:1 twins (`configCommandSchema`/`configCommandPersistedSchema`,
  `actionEntryKindSchema`/`…PersistedSchema`, `normalizeActionKeys`/`normalizeLegacyActionKeys`,
  the two-parts `superRefine` twice). Only two schemas are typed `z.ZodType<Contract>`. The
  IPC-side `normalizeActionKeys` still accepts pre-story-050 keys "until renderer call sites land
  it" — they landed (zero renderer hits); it is kept alive only by one test.
- `toRestoreInput` exists twice (`import.ts` over `Record`s, `file-source.ts` over `Map`s) for
  the same `RestoreProfilePartsInput`; the field list `cvars, binds, actions, categories,
cvarSections, layers, writeUnbindall, sectionHeaderStyle` is re-spelled in four places and
  story-059 comments record that `cvarSections` was once dropped on one path only.
- `main/modules/config/render.ts` and `switch-bind.ts` are one-line `export * from '@shared/config/…'`
  shims used by eight files; the 2,457-line main-side `render.test.ts` tests the pure shared
  renderer; two `ConfigProfile` fixture corpora (515 and 2,627 lines) sit in production source
  with no non-test importer.

## Acceptance Criteria

- [ ] **AC1** — `src/shared/config/profile-schema.ts` exports the shape schemas, each declared
      `: z.ZodType<ContractType>`, so a drift between interface and schema fails `tsc`; an
      `expectTypeOf` test asserts `z.infer<typeof configActionSchema>` is assignable to and from
      `ConfigAction`.
- [ ] **AC2** — `main/modules/config/schemas.ts` imports the shared shapes and adds only payload
      caps; `main/lib/schemas.ts` (or, after story 207, `config/persisted.ts`) wraps them with
      its forgiving `.catch()` defaults and keeps `normalizeLegacyActionKeys`; the IPC-side
      `normalizeActionKeys` and its test are deleted.
- [ ] **AC3** — One `toRestoreInput(file, folded)` next to `restoreProfileParts`, consumed by
      import and refresh; one `RestoredProfileFields` type plus `restoredToProfileFields(...)`
      used by `parseCanonicalProfile`, `commitImportFiles`, `createFromImport` and
      `adoptFromFile`; the round-trip and file-source-pipeline tests pin both paths.
- [ ] **AC4** — The two main-side re-export shims are deleted and their eight importers point at
      `@shared/config/*`; the main-side render test moves next to the shared one (merged, no
      duplicated cases); the fixture corpora live under `src/shared/config/fixtures/` or
      `src/test-support/` and are not part of a production import graph.
- [ ] **AC5** — Every existing config test passes; the IPC wire format and the persisted format
      are byte-identical before and after (round-trip fixtures are the gate).

## Decisions (Sprint)

- **(User)** Q1: Order vs. story 207: retype the wrappers here first; 207 moves them later (not in S33).
- **D-A** Story 207 is already done: the persisted twins live in `src/main/modules/config/persisted.ts`
  (+ `persisted-migrations.ts`), not `main/lib/schemas.ts` (which holds no config shapes) — so AC2's
  "after story 207" branch applies and Q1 has nothing left to order; the wrappers are retyped in place.
- **D-B** Where a constraint lives: a rule *both* trees enforce today goes into the shared shape; a
  rule only the IPC tree has (`.min(1)`/`.max(n)` length and count bounds) is an IPC-side cap; a rule
  only the persisted tree has (`.catch()`, forgiving-row preprocess, legacy `entryKind`, legacy keys)
  stays persisted-side — because the persisted tree is looser (e.g. `AltLayer.id` is `z.string()`
  there), and a shared shape stricter than it would start dropping stored user rows on load.
- **D-C** The shared module exports, per object shape, a plain `z.object` (for `.extend()` overrides,
  which keep key position and so output key order) *and* a `: z.ZodType<Contract>`-annotated final
  schema — because a `ZodType`-annotated constant has no `.extend`, and both trees must extend.
- **D-D** The whole-`ConfigProfile` schema stays in `persisted.ts` (there is no IPC twin of a whole
  profile to dedupe); it gets a `z.ZodType<ConfigProfile, unknown>` annotation plus a key-set
  `expectTypeOf` test, so an added `ConfigProfile` field — optional ones too — fails the build there.
- **D-E** The IPC-side legacy-key fold is deleted with no replacement test: a legacy-shaped payload's
  `key`/`keyModifier` fields are then simply stripped by zod, which is fine because no renderer call
  site sends that shape (zero hits) and the persisted fold still loads old `state.json`.
- **D-F** AC5's "byte-identical" gate is a characterization test written *first* (D1), against the
  unchanged code: it serialises parse outputs with `JSON.stringify` (so key order counts) and records
  accept/reject verdicts — the existing round-trip tests alone do not cover malformed rows or caps.
- **D-G** The single `toRestoreInput(file, folded, options)` takes a structural entry source
  (`Iterable`s of positioned alias/bind/cvar entries, each with an optional per-entry `file` that
  overrides the default) plus `{ comments, layerAliases?, newId }` — because import's multi-file
  `ImportResult` cannot become a single-file fold without changing its last-wins semantics, while the
  `RestoreProfilePartsInput` field mapping (the place `cvarSections`/`firstLine` once diverged) can be
  written once.
- **D-H** `RestoredProfileFields` is `Pick<ConfigProfile, 'cvars' | 'binds' | 'actions' | 'categories'
  | 'cvarSections' | 'layers'>`; `writeUnbindall`/`sectionHeaderStyle` stay outside it, because they
  are detected from the raw text by `adoptFromFile`'s callers, never produced by the restore.
- **D-I** The shim importers are every file that imports `./render` or `./switch-bind` inside
  `src/main/modules/config/` (`index.ts` plus ~17 tests), not "eight" — the AC counts what exists.
- **D-J** "Merged" for the render tests means one location, deduplicated, not one file: the five
  `render.*.test.ts` files (≈2.4k lines) keep their split next to `src/shared/config/render.test.ts`,
  because a single 2.7k-line test file is worse to work in and the AC's point is location + no dupes.
- **D-K** "Not part of a production import graph" is enforced by `src/architecture.test.ts`: every
  importer of `src/shared/config/fixtures/` is a test file or a helper whose own importers are all
  test files — because helpers like `round-trip/helpers.ts` are test-only but not named `*.test.ts`.

## Open Questions

- [x] answered → Decisions (Sprint) — **Q1** — Order relative to story 207: do the persisted wrappers move into the module first
      (207) or get retyped here first? Either order works; avoid doing both in one sprint on the
      same file.

## Plan

Pure refactor, no user-visible change, no CHANGELOG entry. Order matters: the gate comes first.

1. **D1 gate** — characterization test of today's IPC and persisted parse behaviour (outputs as
   JSON strings + accept/reject verdicts), written and green against the unchanged code.
2. **D2 (hard)** — new `src/shared/config/profile-schema.ts` with the shared sub-shapes (D-B/D-C);
   `persisted.ts` derives from it, keeping `.catch()`/forgiving rows/`normalizeLegacyActionKeys`;
   whole-profile schema typed + key-set type test (D-D). Systems doc line.
3. **D3** — IPC `schemas.ts` derives from the shared shapes, adding only caps; delete
   `normalizeActionKeys` + its test case (D-E).
4. **D4** — one `toRestoreInput` in `src/shared/config/profile-restore-input.ts` (D-G); import,
   file-source and the round-trip helper use it.
5. **D5** — `RestoredProfileFields` + `restoredToProfileFields` in the same file (D-H), used by the
   four call sites; one cross-path round-trip test.
6. **D6** — move the main-side render/switch-bind tests next to the shared ones, deduplicated.
7. **D7** — delete the two shims, repoint their importers, architecture rule against `export *` shims.
8. **D8** — move `profile-fixtures.ts` under `src/shared/config/fixtures/`, architecture rule on
   fixture importers (D-K).

D1 must stay green unchanged through D2–D3 (its snapshot is not regenerated); D6–D8 are mechanical.

## Deliverables

- [ ] **D1 — Characterization gate for the two schema trees.** New test
      `src/main/modules/config/schema-parity.test.ts` (+ its `__snapshots__/` file via
      `toMatchFileSnapshot` or `toMatchSnapshot`), written against the **unchanged** code and green
      there. Two describes:
      (a) "persisted profile parse is unchanged" — run every `ROUND_TRIP_FIXTURES` profile
      (`@shared/config/fixtures/profiles`) through `persisted.ts`'s exported profile parse path
      (`configProfileSchema` or the exported `parse*` that wraps it) after a `JSON.parse(JSON.stringify(...))`
      round, plus a hand-written malformed corpus: a command with a `"` and with a non-latin-1 char,
      empty action id, empty layer id, `triggerKey: 42`, a legacy `entryKind` on a category, a legacy
      `key`/`keyModifier`/`secondaryKey` action, a bad `modifier`, a one-part `toggle`, a malformed
      sub-category row, `cvars: 7` on a cvar section, a mangled `baseline`. Snapshot
      `JSON.stringify(output)` (key order counts).
      (b) "IPC payload verdicts are unchanged" — for `setProfileActionsInputSchema`,
      `setProfileCvarsInputSchema`, `setProfileLayersInputSchema` (from `./schemas`): valid payloads
      built from the fixtures, and each boundary on both sides (`name` 120/121, `commands` 64/65,
      `keys` 64/65, key length 20/21, `actions` 500/501, `categories`/`subcategories`/`cvarSections`
      64/65, cvar names 512/513, `frames` at 0/1/`MAX_WAIT_FRAMES`/+1, empty `id`, one-part toggle,
      quote in text). Snapshot `success` plus `JSON.stringify(data)` per case. **Exclude** the legacy
      key shape from (b) — D3 deliberately changes it. Touches only the new test + snapshot.

- [ ] **D2 — Shared sub-shapes; the persisted tree derives from them.** New
      `src/shared/config/profile-schema.ts` (zod only, no node/electron) exporting: `actionTextSchema`
      (latin-1 + no `"`, moved from `main/modules/config/schemas.ts:163`, messages kept),
      `modifierTriggerSchema`, `configCommandSchema` (raw/message/wait, `frames` int 1..`MAX_WAIT_FRAMES`),
      `actionEntryKindSchema`, `TWO_PART_ACTION_KINDS` + one `refineActionParts(action, ctx)`,
      and for `ActionEntryPart`, `ActionKeySlot`, `ConfigAction`, `ConfigActionCategory`,
      `ConfigActionSubcategory`, `ConfigCvarSection`, `ConfigCvarSubsection`, `AltLayer`: a plain
      `…ObjectSchema` (`z.object`, extendable) **and** a final `…Schema: z.ZodType<Contract>`
      (types from `src/shared/modules/config.ts` / `@shared/config/alt-layers`). Rule for what goes
      in: a constraint *both* `persisted.ts` and `main/modules/config/schemas.ts` enforce today; IPC-only
      `.min(1)`/`.max(n)` stay out (D3 adds them); persisted-only `.catch()`/preprocess stay out.
      Then rewrite `src/main/modules/config/persisted.ts`'s twins (`altLayerPersistedSchema`,
      `persistedActionTextSchema`, `configCommandPersistedSchema`, `actionEntryKindPersistedSchema`,
      `actionEntryPartPersistedSchema`, the category/sub-category/cvar-section/sub-section/key-slot/
      action object schemas, `refineActionParts`, `TWO_PART_ACTION_KINDS`) as
      `shared…ObjectSchema.extend({ field: <shared field>.optional().catch(…) })` overrides of only
      the fields that are forgiving today; keep `normalizeLegacyActionKeys`
      (`persisted-migrations.ts`), `parseForgivingRows`, the legacy `entryKind`, the baseline's
      `kind: …catch('bind')` extend. Annotate the whole-profile schema
      `z.ZodType<ConfigProfile, unknown>`. Tests: new `src/shared/config/profile-schema.test.ts` —
      "configActionSchema infers exactly ConfigAction" (`expectTypeOf<z.infer<typeof configActionSchema>>()`
      `.toEqualTypeOf<ConfigAction>()`, or assignable both ways), the same for each other shared
      schema, and "the persisted profile schema's output keys are ConfigProfile's keys"
      (`expectTypeOf<keyof z.output<…>>().toEqualTypeOf<keyof ConfigProfile>()`). No `as` casts to
      satisfy an annotation. Gate: D1's snapshot passes **unregenerated**; `persisted*.test.ts`
      green. Add one bullet to `docs/systems/config-module.md` §6 "Persistence": profile sub-shapes are
      declared once in `src/shared/config/profile-schema.ts`; IPC adds caps, `persisted.ts` adds
      forgiveness. Files: the two new shared files, `persisted.ts`, the systems doc.

- [ ] **D3 — The IPC tree derives from the shared shapes.** In
      `src/main/modules/config/schemas.ts` replace `configCvarSubsectionSchema`,
      `configCvarSectionSchema`, `altLayerSchema`, `actionTextSchema`, `configWaitCommandSchema`,
      `configCommandSchema`, `modifierTriggerSchema`, `configActionSubcategorySchema`,
      `configActionCategorySchema`, `actionEntryKindSchema`, `actionEntryPartSchema`,
      `TWO_PART_ACTION_KINDS`, `actionKeySlotSchema`, `configActionSchema` with imports from
      `@shared/config/profile-schema`, adding **only** the caps the IPC tree has today via `.extend()`
      field overrides (`name` `.min(1).max(120)`, ids `.min(1)`, `commands`/`keys`/`subcategories`/
      `subsections` `.max(64)`, `label` `.max(120)`, slot `key` `.max(20)`, cvar-name lists
      `.max(512)`, …) and re-applying the shared `refineActionParts`. Keep exporting
      `configActionSchema`/`actionTextSchema` from `./schemas` if anything imports them there (re-export
      from shared is fine). Delete `normalizeActionKeys` and its `z.preprocess` wrapper, and the test
      "normalises the legacy key/keyModifier/secondaryKey/secondaryKeyModifier shape into keys" plus
      its doc comment in `src/main/modules/config/schemas.test.ts` (~:462-505). Gate: D1's snapshot
      passes unregenerated; `schemas.test.ts` green. Files: `schemas.ts`, `schemas.test.ts`.

- [ ] **D4 — One restore adapter.** New `src/shared/config/profile-restore-input.ts` (sibling of
      `profile-restore.ts`, which defines `RestoreProfilePartsInput` at :378) exporting
      `toRestoreInput(file, folded, options): RestoreProfilePartsInput` where `folded` is a structural
      `RestoreEntrySource = { aliases: Iterable<{name, body, line, comment, codeWidth, file?}>;
      binds: Iterable<{key, command, line, comment, file?}>; cvars: Iterable<{name, value, line,
      comment, file?, firstFile?, firstLine?}> }` and `options = { comments: readonly {text, line,
      file?}[]; layerAliases?: readonly string[]; newId: () => string }`; an entry's own `file` wins
      over the `file` argument; `firstFile`/`firstLine` are copied only when present; `layerAliases`
      only when given. Replace `main/modules/config/import.ts:172`'s exported `toRestoreInput`
      (build the entry lists from `ImportResult`'s Records + `bindLines`/`cvarLines`/`cvarFirstLines`/
      `bindComments`/`cvarComments`, comments from `mergeForeignBannerComments`, call the shared one
      with `file = ''`) and `file-source.ts:188`'s private one (`folded.*.values()` with `file`).
      Repoint `main/modules/config/round-trip/helpers.ts` (:12, calls at ~110/219/250/382). Test:
      new `src/shared/config/profile-restore-input.test.ts` › "carries every RestoreProfilePartsInput
      field from a folded source" (per-entry file override, `firstFile`/`firstLine` present/absent,
      `layerAliases` present/absent). Gate: `import.test.ts`, `file-source*.test.ts`,
      `round-trip/*.test.ts` green. Files: the two new shared files, `import.ts`, `file-source.ts`,
      `round-trip/helpers.ts`.

- [ ] **D5 — One restored-fields type.** In `src/shared/config/profile-restore-input.ts` add
      `RestoredProfileFields = Pick<ConfigProfile, 'cvars'|'binds'|'actions'|'categories'|'cvarSections'|'layers'>`
      and `restoredToProfileFields(cvars, binds, restored)` (restored = the `actions`/`categories`/
      `cvarSections`/`layers` of `restoreProfileParts`' result). Use it in
      `file-source.ts#parseCanonicalProfile` (:274; `ParsedCanonicalProfile` extends
      `RestoredProfileFields`), `import.ts#commitImportFiles` (:439, ~:486-490),
      `profiles.ts#createFromImport` (:137; input = `RestoredProfileFields & { name, unrecognized }`)
      and `profiles.ts#adoptFromFile` (:670; `fields = RestoredProfileFields & { name,
      writeUnbindall, sectionHeaderStyle }`), adjusting its callers in `index.ts` (~1313, ~1445) and
      `round-trip/helpers.ts` (~264). `writeUnbindall`/`sectionHeaderStyle` stay detected from text
      by the callers. Tests: unit in `profile-restore-input.test.ts` › "restoredToProfileFields
      carries all six fields"; new `src/main/modules/config/round-trip/import-vs-refresh.test.ts` ›
      "import and refresh restore the same profile fields from a launcher-written file" — for each
      `ROUND_TRIP_FIXTURES` profile render the file, feed it through the import path and through
      `parseCanonicalProfile`'s path (via `round-trip/helpers.ts`), compare the six fields
      (ids normalised); a fixture that legitimately differs is excluded in the test with a named
      reason, never silently. Files: shared file + test, `file-source.ts`, `import.ts`, `profiles.ts`,
      `index.ts`, `round-trip/helpers.ts`, new test.

- [ ] **D6 — Render tests live with the renderer.** `git mv` `src/main/modules/config/render.actions.test.ts`,
      `render.cvars-and-header.test.ts`, `render.metadata.test.ts`, `render.profile-file.test.ts`,
      `render.sections.test.ts`, `render.test-helpers.ts` and `switch-bind.test.ts` into
      `src/shared/config/` (their `./render`/`./switch-bind` imports then resolve to the shared
      modules). Compare against `src/shared/config/render.test.ts` and `render-invariants.test.ts`
      and delete any case that asserts the same input → output twice (keep the more specific one).
      The moved files must import nothing from `src/main` (architecture test). Gate: same total
      passing case count minus the removed duplicates (state the count in the D's done note).

- [ ] **D7 — Delete the re-export shims.** Delete `src/main/modules/config/render.ts` and
      `switch-bind.ts`; repoint every remaining `./render` / `./switch-bind` import in
      `src/main/modules/config/` (`index.ts`, `import.test.ts`, `index.{sync,save,refresh,cleanup,raw-files}.test.ts`,
      `file-source-pipeline.test.ts`, `profiles.test.ts`, `writer.test.ts`, and any other grep hit)
      at `@shared/config/render` / `@shared/config/switch-bind`. Add to `src/architecture.test.ts`
      › "no production file is an export-star re-export of a shared module" (a production file whose
      only statement is `export * from '@shared/…'`). Files: the two deletions, `index.ts`, the test
      importers (mechanical one-line edits), `architecture.test.ts`.

- [ ] **D8 — Fixtures out of the production graph.** `git mv src/shared/config/profile-fixtures.ts
      src/shared/config/fixtures/profile-fixtures.ts`, repoint `render-invariants.test.ts`. Add to
      `src/architecture.test.ts` › "src/shared/config/fixtures is imported only by tests and
      test-only helpers": every edge in `ALL_EDGES` into `src/shared/config/fixtures/` comes from an
      `isTestFile` file or from a file whose every importer is an `isTestFile` file. Files:
      the moved fixture, `render-invariants.test.ts`, `architecture.test.ts`.

## Model Hints

- D2 → deliverable-hard — deriving the forgiving persisted tree from shared shapes can silently add
  a `min(1)`/bound or move a `.catch()` one level (field vs. row vs. whole array), which drops stored
  user rows on the next load with no error; it also needs the `.extend()`/`ZodType` split so output
  key order (the persisted bytes) does not move.
- Review: → story-review-hard — the plausible wrong implementation that passes tests and a default
  review is a shared schema satisfied by an `as z.ZodType<ConfigAction>` cast (AC1's compile-time
  guarantee becomes a no-op no test can see) or a persisted twin that is stricter than before only
  on an input the D1 corpus does not contain.

## Acceptance Tests

- AC1 → unit (type) `src/shared/config/profile-schema.test.ts` › "configActionSchema infers exactly
  ConfigAction" (plus one per shared shape) — `tsc` (`npm run typecheck`) is the drift gate itself.
- AC2 → unit `src/main/modules/config/schema-parity.test.ts` › "persisted profile parse is
  unchanged" and › "IPC payload verdicts are unchanged" (both unregenerated after D2/D3); plus
  `src/shared/config/profile-schema.test.ts` › "the persisted profile schema's output keys are
  ConfigProfile's keys"; deletion of `normalizeActionKeys` and its test is checked by the review diff.
- AC3 → unit `src/shared/config/profile-restore-input.test.ts` › "carries every
  RestoreProfilePartsInput field from a folded source" and › "restoredToProfileFields carries all six
  fields"; unit `src/main/modules/config/round-trip/import-vs-refresh.test.ts` › "import and refresh
  restore the same profile fields from a launcher-written file"; existing
  `src/main/modules/config/file-source-pipeline.test.ts` and `round-trip/*.test.ts` stay green.
- AC4 → unit `src/architecture.test.ts` › "no production file is an export-star re-export of a
  shared module" and › "src/shared/config/fixtures is imported only by tests and test-only helpers";
  the moved render tests run green from `src/shared/config/` (`npm test`).
- AC5 → unit `src/main/modules/config/schema-parity.test.ts` (both describes, snapshot written in D1
  before any change) plus the full `npm test` and `npm run typecheck` gate.
- No criterion describes a user action (pure refactor), so there is no `ui:flow` line and no manual
  residue.

## Done

<!-- Filled by /build 211. -->
