---
id: 211
title: config profile shapes are declared once
status: draft # draft -> ready -> in-progress -> done
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

## Open Questions

- [ ] **Q1** — Order relative to story 207: do the persisted wrappers move into the module first
      (207) or get retyped here first? Either order works; avoid doing both in one sprint on the
      same file.

## Plan

<!-- Filled by /refine 211. -->

## Deliverables

<!-- Filled by /refine 211. -->

## Model Hints

<!-- Filled by /refine 211. -->

## Acceptance Tests

<!-- Filled by /refine 211. -->

## Done

<!-- Filled by /build 211. -->
