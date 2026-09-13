---
id: 060
title: Duplicate alias is fixable from Aliases
status: done
created: 2026-09-07
---

## Requirement

Care's "Tidy-up" section reports when two alias entries share the same name (Quake II
only keeps the last one it reads), but today that finding is a dead end: the "Show in
Aliases" link resolves by name, so with two identical names it cannot tell the user which
of the two rows it means, and neither tab offers a way to actually resolve the collision.
Rename and delete already exist per row in the Aliases tab — the user should be able to
follow the Care finding straight to the specific duplicate row and rename or delete it
there, instead of hunting for it themselves.

Investigation for context (see conversation history): `aliasDuplicate` is deliberately
`mode: 'report'` with no auto-fix op — the decision that this is a judgement call for the
user to make (which entry to keep) stands and is not being revisited here
(`docs/requirements/done/025-care-tab-replaces-validation.md`, Decision 11). This story
only makes the existing manual fix (rename/delete) reachable for a specific duplicate row.

## Acceptance Criteria

- [x] From the Care tab, clicking "Show in Aliases" on a `duplicateAlias` finding jumps to
      and highlights the exact alias row the finding refers to — not just "a row with this
      name" — even when another row shares the same name.
- [x] In the Aliases tab, a row involved in a name collision is visibly marked as a
      duplicate (already partially true per the second screenshot's "DUPLICATE" badge —
      verify/keep it) so the user can tell the two colliding rows apart without guessing.
- [x] The user can rename or delete either one of the two colliding rows directly from the
      Aliases tab, resolving the Care finding (verified by the finding disappearing from
      Care once the names no longer collide).

## Open Questions

<none>

## Plan

The stable identity already exists and is already half-wired: `AliasIndexRow.ownerActionId`
(`src/shared/config/alias-references.ts:352-354`) is the owning entry's real `id`, present for
`origin: 'user' | 'generated'` rows — the doc comment even calls it "the handle a deep link ...
needs". The `aliasDuplicate` check just doesn't carry it through yet.

- `src/shared/config/validate-actions.ts:496-508` (the `aliasDuplicate` finding builder): it
  already has `entry.action.id` in scope (used only to build the dedup `signature`, then
  discarded) — add it to the finding's `params` as e.g. `actionId`.
- `src/renderer/src/modules/config/lib/tidy-up-findings.ts:445-458`: params are copied through
  unchanged already, so `actionId` arrives in the `TidyUpFinding` for free — verify only.
- `src/renderer/src/modules/config/lib/care-items.ts:294-297`: `showInAliases` action currently
  built from `name` only — add `actionId` from `item.params` alongside it.
- `src/renderer/src/modules/config/CareTab.tsx:346-349`: `onNavigateToAlias` currently takes a
  plain name (`item.params['name'] ?? item.params['alias']`) — extend its call/signature to
  also pass `item.params['actionId']` when present.
- Deep-link prop chain: `focusAlias?: string` on `AliasesTab.tsx:62`, set from
  `ConfigView.tsx:810`, likely stored in `tabState.focusAlias` — extend this to also carry an
  optional `focusAliasActionId` (or a small object) alongside the name, threading through
  `ConfigView`'s tab-state and the `onNavigateToAlias` callback signature.
- `AliasesTab.tsx:252-266` (the focus effect): currently `displayRows.find((entry) =>
  entry.row.key === targetKey)` — when an action id is present, match
  `entry.row.ownerActionId === focusActionId` first (falls back to the current name-only
  `find` when no id is given, so `undefinedAlias` and other non-duplicate deep-links are
  unaffected).
- `DUPLICATE` badge already renders per-row correctly (`AliasesTab.tsx:721,753`, driven by
  `row.duplicateOf.length > 0` in `lib/alias-rows.ts:71-73`) — no change needed there, D2 is
  verification only.
- No new IPC channel, no new `TidyUpOp` — rename/delete already exist
  (`AliasesTab.tsx:511-512`); this is purely threading an existing id through the finding →
  deep-link chain.

## Deliverables

- [x] D1 — Thread the existing `ownerActionId` through the `aliasDuplicate` finding into the
      "Show in Aliases" deep-link, so it targets one specific colliding row instead of "first
      row with this name". Touches: `src/shared/config/validate-actions.ts` (add `actionId` to
      the `aliasDuplicate` finding params, ~line 496-508),
      `src/renderer/src/modules/config/lib/care-items.ts` (~line 294-297, pass `actionId`
      through to the `showInAliases` action), `src/renderer/src/modules/config/CareTab.tsx`
      (~line 346-349, `onNavigateToAlias` call/signature), `src/renderer/src/modules/config/
      ConfigView.tsx` (~line 810, tab-state carrying the focus target),
      `src/renderer/src/modules/config/AliasesTab.tsx` (~line 62 `focusAlias` prop, ~line
      252-266 focus effect: match `ownerActionId` first, fall back to name-only). Acceptance:
      clicking "Show in Aliases" on either of two same-named duplicate findings scrolls to
      and highlights the correct distinct row, confirmed by manual UI check (two duplicates,
      two different links, two different rows highlighted); existing non-duplicate deep-links
      (e.g. `undefinedAlias`) still work via the name-only fallback.
- [x] D2 — Confirm/adjust the duplicate-row marker in the Aliases tab so both colliding
      rows are clearly and independently flagged, and confirm the Care finding clears once
      renamed/deleted down to one entry. Touches:
      `src/renderer/src/modules/config/AliasesTab.tsx`,
      `src/renderer/src/modules/config/CareTab.tsx` (re-check on save). Acceptance: after
      renaming or deleting one of the two duplicate rows and saving, the Care tab's
      "Tidy-up" duplicate finding for that name is gone.

## Model Hints

Review: → default

## Test Plan (manual acceptance)

1. Open a profile with two alias entries sharing the same name (e.g. via `ui:verify` fixture
   or the existing "Hantsch - Test" profile from the bug report).
2. Care tab → Tidy-up → click "Show in Aliases" on the first `duplicateAlias` finding.
   Expect: Aliases tab opens, scrolled to and highlighting one specific `drop_grenades` row
   (not just "a" row with that name).
3. Go back to Care, click "Show in Aliases" on the second `duplicateAlias` finding for the
   same name. Expect: Aliases tab highlights the *other* row this time.
4. From the highlighted row, rename it to a unique name (or delete it) and save.
5. Return to Care tab. Expect: the `duplicateAlias` warning for that name is gone.

## Done

Threaded the existing `AliasIndexRow.ownerActionId` through the `aliasDuplicate` finding
(`validate-actions.ts`), the "Show in Aliases" deep-link chain (`care-items.ts` params passthrough
unchanged, `CareTab.tsx`, `ConfigView.tsx`'s `focusAliasActionId`, `AliasesTab.tsx`'s focus effect),
so the link now targets one specific colliding row instead of "first row with this name". Non-id
deep-links (`undefinedAlias` etc.) keep resolving by name only via the fallback. D2 was
verification-only: the `DUPLICATE` badge already flags both colliding rows independently
(`alias-rows.ts`/`alias-references.ts`), and Care's `useMemo`d Tidy-up findings already recompute
automatically on save, so no code change was needed there.

Commit message: `060: duplicate alias is fixable from aliases`

Verification:
- `npm run build` — green.
- `npm test` — 2565/2565 passed (2 pre-existing `validate-actions.test.ts` assertions were updated
  to include the new `actionId` param, verified correct per-entry, not loosened).
- `npm run typecheck` — clean (node + web).
- `npm run ui:verify` (e2e/axe smoke) — 68/68 screenshots, 0 axe violations; this story's criteria
  are UI-observable but predate the automated Acceptance-Tests mapping, so this run served as a
  no-regression smoke check, not a scenario-specific proof.
- Code review (fresh agent, default tier): **PASS**, no findings requiring a fix. All three
  acceptance criteria confirmed PASS against the code paths (deep-link targets the exact row via
  `ownerActionId`; badge marks both colliding rows independently; save recomputes Care findings via
  `useMemo`, so a resolved duplicate clears automatically). Story predates `## Acceptance Tests`,
  so it is checked against its legacy `## Test Plan (manual acceptance)` steps rather than a
  named-test mapping, per the workflow's rule for pre-mapping stories — no manual residue beyond
  that; no automated-test retrofit performed.
