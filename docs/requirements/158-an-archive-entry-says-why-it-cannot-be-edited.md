---
id: 158
title: an archive entry says why it cannot be edited
status: ready # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

Demos inside a `.zip` ([[143]]) are read-only by decision: there is nowhere simple to put a sidecar
for an entry, and renaming inside an archive is not a file action. The user still sees the actions —
they are visible, disabled, and say why, the same way a platform gap is explained (concept
`docs/concepts/demo-browser.md` §3, §8.1, DEMO-15; CLAUDE.md platform-parity rule applied to
archives).

## Acceptance Criteria

- [ ] **AC1** — For an archive entry, the sidecar editor ([[155]]) is visible but disabled, with the
      reason as visible text (e.g. "Demos inside an archive are read-only — extract it to annotate
      it").
- [ ] **AC2** — For an archive entry, rename ([[157]]) is visible but disabled, with the reason as
      visible text.
- [ ] **AC3** — The reasons are i18n keys.
- [ ] **AC4** — The main-side sidecar-write and rename handlers reject an archive-entry id even if
      called directly, with a typed error.
- [ ] **AC5** — Reveal, copy path ([[156]]) and Play ([[159]]/[[160]]) stay available for entries.

## Open Questions

<!-- None known from the concept. -->

## Decisions (Sprint)

- The single source of truth for "is an archive entry" is the shared `archiveEntry` field of the
  discovered demo (`src/shared/modules/replays.ts:190`, non-null for a zip row) — the renderer gates
  on it and main gates on `ResolvedDemo.kind === 'archive-entry'`, so neither side guesses from a
  path string.
- The sidecar editor stays fully visible for an entry with its inputs disabled (one `<fieldset
  disabled>` around the form, Save/Cancel disabled) and **one** reason notice above the form, not a
  per-field message — one reason for one cause, and the effective values stay readable (AC1).
- Reason texts (en): edit — "Demos inside an archive are read-only — extract it to annotate it.";
  rename — "Demos inside an archive can't be renamed — the archive is read-only."; row — "Read-only
  (in an archive)" — taken from AC1's example and kept parallel so the user learns one rule.
- i18n keys live under `replays.archive.readOnly.{edit,rename,row}` in
  `src/renderer/src/i18n/locales/en.json`, next to the existing `replays.*` tree (AC3).
- The row's quick favourite/rating controls from [[155]] AC9 also write the sidecar, so on an
  archive row they are disabled too and the row shows the short reason as visible text — otherwise
  AC1 would be bypassable one click away from the editor.
- The disabled controls reference their reason with `aria-describedby`, so the visible text is also
  what a screen reader announces — the platform-parity rule asks for visible text, this keeps it
  accessible without adding a tooltip.
- Main-side, the sidecar-write rejection already exists (`sidecar-store.ts:105`, key
  `replays.sidecar.error.archiveEntry`, store-level test `sidecar-store.test.ts:186`); this story
  adds only the rename guard (key `replays.rename.error.archiveEntry`, in [[157]]'s rename failure
  union) and proves both through the registered IPC handler, because AC4 says "even if called
  directly".
- The rename guard runs before any filesystem call and before the "currently playing" check of
  [[157]] AC6 — an archive entry can never be renamed, so its reason is the one the user must see.
- Reveal and copy path ([[156]]) are untouched and asserted enabled for an entry in the e2e flow;
  Play ([[159]]/[[160]]) is built in S28, so the flow asserts "a Play control, if present, is
  enabled" (live once 159 lands) and [[160]] AC2 proves playing a zip entry end to end — this story
  must not add any lock on Play.
- A new flow `replays-archive-readonly` is written rather than extending 143's `replays-zip-entries`,
  so 143's flow stays about discovery; it reuses that flow's `setup()`/`teardown()` building and
  removing `pack.zip`, because the shared fixture must stay archive-free at rest (S26 gate note).
- No deliverable is marked hard: all three are guards/disabled states on code [[155]]/[[157]] already
  built, with no new path or cross-module logic.

## Plan

Builds after [[155]] (detail panel + editor + row quick favourite/rating) and [[157]] (rename
channel + control). Locate their files by the testids/channels they introduced; the names below
marked "(from 155/157)" are the expected ones.

1. **Main (D1):** in [[157]]'s rename service add `if (resolved.kind === 'archive-entry') return
   fail('replays.rename.error.archiveEntry')` as the first check after the unknown-id check; add the
   key to the rename failure union/type and to `en.json`. Add registered-handler tests
   (`registry.invoke`, as `index.test.ts:295`) proving `sidecar.write` and the rename channel both
   return `{ ok: false, error: { key: '…archiveEntry' } }` for an archive-entry id and touch no file.
2. **Renderer detail (D2):** in the detail panel/editor, derive `const readOnly = demo.archiveEntry
   !== null`; wrap the form in `<fieldset disabled={readOnly}>`, disable Save/Cancel, render the
   reason notice (`replays.archive.readOnly.edit`); disable the rename control and render
   `replays.archive.readOnly.rename` beside it. Reveal/copy path untouched. Component tests + new
   e2e flow `replays-archive-readonly`.
3. **Renderer row (D3):** in `ReplaysView.tsx`'s row, disable the quick favourite/rating controls
   for an archive row and render `replays.archive.readOnly.row` as visible text; extend the flow.
4. i18n: all three `replays.archive.readOnly.*` keys added in D2/D3 respectively; no prose over IPC.

## Deliverables

- **D1 — main rejects rename (and sidecar write) of an archive entry, proven at the IPC handler.**
  Files: [[157]]'s rename service in `src/main/modules/replays/` (the module that implements the
  rename channel registered in `src/main/modules/replays/index.ts`), `src/shared/modules/replays.ts`
  (add `archiveEntry` to the rename failure type if it is a union), `src/renderer/src/i18n/locales/en.json`
  (`replays.rename.error.archiveEntry`: "Demos inside an archive can't be renamed — the archive is
  read-only."), tests in the rename service's own `*.test.ts` and `src/main/modules/replays/index.test.ts`.
  Mirror: the existing sidecar guard `src/main/modules/replays/sidecar-store.ts:101-107` and the
  resolver `index.ts:135` (`file.archiveEntry ? { kind: 'archive-entry' } : …`). The guard runs
  after the unknown-id check and **before** any fs call and before [[157]]'s "currently playing"
  check. Tests: (a) rename service with a resolver returning `{ kind: 'archive-entry' }` returns
  `{ ok: false, error: { key: 'replays.rename.error.archiveEntry' } }` and performs no fs rename
  (spy/fake fs asserts zero calls); (b) `index.test.ts` registered-handler test: an index entry with
  `archiveEntry` set, invoked via `registry.invoke` on `REPLAYS_HANDLERS.sidecarWrite` and on the
  rename channel, returns the respective `…archiveEntry` error key; (c) the existing i18n-key
  presence test in `index.test.ts` (~line 400) also asserts `replays.rename.error.archiveEntry`.
- **D2 — detail panel: editor and rename visible, disabled, with the reason as visible text.**
  Files: [[155]]'s detail panel / sidecar editor component(s) under
  `src/renderer/src/modules/replays/` (+ their `*.test.tsx`), [[157]]'s rename control component
  (+ test), `src/renderer/src/i18n/locales/en.json`, new `scripts/flows/replays-archive-readonly.mjs`.
  Gate: `const readOnly = demo.archiveEntry !== null` (shared field, never a path heuristic).
  Editor: whole form in `<fieldset disabled={readOnly}>`, Save and Cancel disabled, one notice
  above the form, testid `replays-archive-readonly-edit`, text `t('replays.archive.readOnly.edit')`
  = "Demos inside an archive are read-only — extract it to annotate it."; the effective values
  with their sources stay rendered. Rename: the control stays rendered, `disabled`, with visible text
  testid `replays-archive-readonly-rename`, `t('replays.archive.readOnly.rename')` = "Demos inside an
  archive can't be renamed — the archive is read-only." Each disabled control has
  `aria-describedby` pointing at its notice. Reveal / copy path ([[156]]) are not touched.
  Mirror: `src/renderer/src/modules/servers/join/JoinServerButton.tsx` (disabled + inline reason,
  doc comment lines 23-26). Tests: component tests for (a) archive entry → fieldset disabled, Save
  disabled, notice text present, rename disabled with its text; (b) loose file → none of that
  (no notice, controls enabled). Flow `replays-archive-readonly.mjs`: copy `setup()`/`teardown()`
  and the 7za guard from `scripts/flows/replays-zip-entries.mjs`; open Demos, click the `pack.zip`
  row for `test.dm2` (selector as in that flow), assert the editor's inputs are disabled and
  `replays-archive-readonly-edit` is visible with the English text, the rename control is disabled
  and `replays-archive-readonly-rename` is visible, the reveal and copy-path controls are enabled,
  and a Play control — only if one exists in the panel — is enabled; then select the loose
  `FINAL.DM2` row and assert neither notice is present; `shot('replays-archive-readonly')`.
- **D3 — demo row: quick favourite/rating disabled on an archive row, with a visible reason.**
  Files: `src/renderer/src/modules/replays/ReplaysView.tsx` (or the row component [[150]]/[[155]]
  extracted), its `*.test.tsx`, `src/renderer/src/i18n/locales/en.json`,
  `scripts/flows/replays-archive-readonly.mjs`. For a row with `archiveEntry !== null`: the quick
  favourite and rating controls stay rendered and `disabled`, `aria-describedby` → a visible text
  element testid `replays-archive-readonly-row`, `t('replays.archive.readOnly.row')` = "Read-only
  (in an archive)". Loose rows unchanged. Tests: component test (archive row → controls disabled +
  text; loose row → enabled, no text); flow step in `replays-archive-readonly.mjs` asserting the
  `test.dm2` zip row's favourite control is disabled and `replays-archive-readonly-row` is visible,
  and the `FINAL.DM2` row's is enabled.

## Model Hints

- D1, D2, D3 → default tier.
- Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/replays-archive-readonly.mjs` › "replays-archive-readonly" (editor
  inputs disabled, `replays-archive-readonly-edit` visible); unit: D2's detail/editor component test
  › "an archive entry shows the editor disabled with its reason"; row side (D3) › component test
  "an archive row disables quick favourite and rating with its reason" + the flow's row step.
- AC2 → e2e `scripts/flows/replays-archive-readonly.mjs` › "replays-archive-readonly" (rename
  disabled, `replays-archive-readonly-rename` visible); unit: D2's rename control test › "an archive
  entry cannot be renamed and says why".
- AC3 → unit `src/main/modules/replays/index.test.ts` › i18n-key presence test extended with
  `replays.rename.error.archiveEntry` (D1), and the e2e flow asserts the rendered English strings
  for `replays.archive.readOnly.{edit,rename,row}` (a missing key would render the raw key) (D2/D3).
- AC4 → unit `src/main/modules/replays/index.test.ts` › "sidecar write and rename reject an
  archive-entry id at the handler" (D1); unit in [[157]]'s rename service test › "renaming an
  archive entry is refused before any file is touched" (D1); existing
  `src/main/modules/replays/sidecar-store.test.ts` › "the store refuses unknown ids, archive entries,
  vanished demos and unreadable sidecars".
- AC5 → e2e `scripts/flows/replays-archive-readonly.mjs` › "replays-archive-readonly" (reveal and
  copy path enabled for the entry; Play asserted enabled when present) (D2); Play end to end on a
  zip entry is proven by [[160]] AC2 in S28 (see Decisions).

## Done

<!-- Filled by /build 158. -->
