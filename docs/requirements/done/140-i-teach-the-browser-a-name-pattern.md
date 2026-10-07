---
id: 140
title: I teach the browser a name pattern
status: done # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

The server a user plays on names its demos in a way the launcher has never seen. Instead of waiting
for a release, the user writes a template in the demos settings — e.g. `{date}_{map}_{p1}_vs_{p2}` —
and from the next scan on, those demos show their date, map and players (concept
`docs/concepts/demo-browser.md` §7, DEMO-9). The browser is expected to get better at this over
time; this is how the user gets ahead of it.

Templates use the syntax [[139]] settles and run through the same engine as the shipped patterns.
They live in the module's own state key ([[142]] introduces it) and are shown in the settings section
[[135]] created.

## Acceptance Criteria

- [ ] **AC1** — In the demos settings section the user can add, edit and remove name templates; the
      list persists across restarts.
- [ ] **AC2** — A template that is invalid under [[139]]'s syntax (unknown token, unclosed brace,
      no literal between two greedy tokens…) is rejected on entry with its reason shown next to the
      field, and is not saved.
- [x] **AC3** — After a template is added, changed or removed, the next scan ([[144]]) re-derives
      name facts for every demo, even for files whose size and modification time did not change.
- [ ] **AC4** — User templates and shipped patterns are tried in the order decided in Q1, and that
      order is visible in the settings section.
- [x] **AC5** — The template text is validated by a zod schema in main (length cap, printable
      characters) before it is stored.

## Open Questions

- [x] ~~**Q1 — Order** (§17.2): are user templates tried before or after shipped patterns?~~
      answered → Decisions (Sprint)
- [x] ~~**Q2 — Try it out** — should the editor show a live test against a sample file name (or
      against the user's actual demos)? Not in the concept; useful, but new scope.~~ answered →
      Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Order/overriding: shipped patterns are themselves defined as entries in the demos
  settings, editable like user templates, and the user can override any of them there — there
  is no separate "user templates run after/before shipped" split; editing an entry is how a
  user's version takes effect. AC4's "order decided in Q1" becomes: the settings section shows
  one ordered list (shipped + user-added), tried top to bottom, edited/reordered in place.
- Try-it-out live preview (Q2): out of scope for v1 — new scope beyond the concept and beyond
  what this story's acceptance criteria need; a template's effect is already visible from the
  next scan's results per AC3.
- **Persist overrides, not copies, of shipped entries** — the list stores a shipped entry as
  `{ kind: 'shipped', shippedId, template: null }` until the user edits it, so a release that
  refines a shipped pattern (§7 "refined by releases") still reaches every user who never touched it.
- **Shipped patterns a release adds are appended to the end of the list** — never reshuffles an
  order the user arranged; one that a release drops disappears if unedited and becomes a plain user
  entry if edited (the user's text is never lost).
- **Removing a shipped entry leaves a tombstone (`removedShippedIds`)** so it does not come back on
  the next load, and a "Restore built-in patterns" button (visible only while one is removed)
  re-appends them — without it a mis-click on a shipped entry would be a dead end.
- **An edited shipped entry offers "Reset to built-in"** — the one-click way back to the release's
  text, same reasoning as the restore button.
- **Syntax validation is 139's validator, run twice** — live in the renderer for the inline reason
  (AC2) and again in main's handler before storing, because a renderer check alone is not a guard
  (CLAUDE.md "never trust the renderer").
- **AC5 schema: `nameTemplateTextSchema` = trimmed string, 1–128 chars, printable ASCII
  `0x20–0x7E`, no `/` or `\`** — r1q2 treats bytes >126 as separators (ARCHITECTURE "Launching"), and
  a template matches a basename, so a path separator can only be a mistake; the list is capped at 50
  entries so state.json cannot be bloated through the seam.
- **Schemas live in `src/shared/modules/replays.ts` beside the handler names** and are enforced at
  main's `handle()` seam — story 135's precedent; AC5's "in main" is where the check runs.
- **Every mutation handler returns the full ordered list** (`Outcome<NameTemplatesView>`) and the
  renderer re-renders from it, no optimistic copy — the `ServersSettingsSection` master-source
  precedent (story 111).
- **Reorder by drag via the existing `SortableList`** (`src/renderer/src/components/dnd/`) — the
  master-source list already reorders that way, so one reorder idiom in Settings.
- **State key: top-level `replays` in state.json with a `nameTemplates` field** — [[142]] introduces
  the module's key; whichever of 140/142 builds first adds the key and its `StateStore` accessor pair
  (`replaysState()`/`setReplaysState()`, servers precedent), the other only adds its own field.
- **AC3 via a templates fingerprint** — a pure `nameTemplatesFingerprint(effectiveList)` string that
  changes on add/edit/remove/reorder/reset; name facts cached by [[144]] carry the fingerprint they
  were derived under and are re-derived when it differs, independent of size/mtime. If 144's scan
  exists when 140 builds, D2 wires the check into it; otherwise 144 consumes the exported predicate.
- **Origin shown as a badge ("Built-in" / "Custom", plus "Edited")**, not per-origin names — the
  shipped entries' own template text already says what they match; no extra strings per pattern.
- **No platform branch** — pure data + settings UI, identical on Windows and Linux.
- **CHANGELOG** — user-facing: one line under `## Unreleased → ### Added`.

## Plan

Depends on [[135]] (module, settings slot, `src/shared/modules/replays.ts`) and [[139]] (template
validator + shipped pattern list with stable ids). Three layers, one D each, bottom-up.

1. **Shared (D1)** — `src/shared/replays/name-templates.ts` (pure): entry/state types,
   `mergeWithShipped(stored, shipped)` (append new shipped, drop vanished unedited, convert vanished
   edited to user, honour tombstones), `effectiveNameTemplates()` (ordered template strings for the
   engine), list ops (add/update/remove/reorder/reset/restore) and `nameTemplatesFingerprint()` +
   `needsNameFactsRederive(cachedFp, currentFp)`. Handler names + zod payload schemas in
   `src/shared/modules/replays.ts`.
2. **Main (D2)** — `replays.nameTemplates` in the persisted schema (forgiving parse, servers
   precedent), `StateStore` accessors, seven handlers in the replays main module; each re-validates
   with 139's validator and returns the merged list. Wires the fingerprint check into 144's scan if
   present.
3. **Renderer (D3)** — `NameTemplatesList` inside `ReplaysSettingsSection` (replaces 135's
   placeholder): ordered sortable rows with badge, inline edit, remove, reset; add field with live
   reason; restore button; strings; flow; CHANGELOG; 135's flow's last assertion updated.

Order: D1 → D2 → D3.

## Deliverables

- **D1 — pure name-template list logic and the handler contract, with tests.** Files:
  `src/shared/replays/name-templates.ts` (new), `src/shared/replays/name-templates.test.ts` (new),
  `src/shared/modules/replays.ts` (edit, from story 135), `src/shared/modules/replays.test.ts` (edit).
  Inputs from story 139 (import from the file 139 created under `src/shared/`): the shipped pattern
  list (each with a stable `id` and its `template` text in the user syntax) and the template
  validator (text → ok | reason i18n key). Types: `StoredNameTemplate = { id: string; kind:
'shipped'; shippedId: string; template: string | null } | { id: string; kind: 'user'; template:
string }` (`template: null` = unedited shipped); `NameTemplatesState = { entries:
StoredNameTemplate[]; removedShippedIds: string[] }`, default `{ entries: [], removedShippedIds:
[] }`; view `NameTemplatesView = { entries: NameTemplateEntry[]; canRestore: boolean }` with
  `NameTemplateEntry = { id; template; origin: 'shipped' | 'user'; edited: boolean }` (`canRestore` =
  `removedShippedIds` non-empty after merge) plus its zod response schema.
  Functions (all pure, no ids from `crypto` — callers pass a `newId`): `mergeWithShipped(state,
shipped)` → state where every shipped id not in `entries` and not in `removedShippedIds` is
  appended in shipped order; an entry whose `shippedId` is gone is dropped when `template === null`,
  converted to `kind: 'user'` otherwise; `toView(state, shipped)`; `effectiveNameTemplates(state,
shipped)` → ordered template strings; `addTemplate`, `updateTemplate` (on a shipped entry sets
  `template`; setting it equal to the shipped text stores `null`), `removeTemplate` (shipped →
  tombstone), `reorderTemplates(ids)` (must be a permutation of current ids, else error),
  `resetTemplate(id)` (shipped only), `restoreShipped()`; `nameTemplatesFingerprint(templates:
string[])` (stable string, e.g. FNV-1a hex of the `\n`-joined list — no `node:crypto` in shared)
  and `needsNameFactsRederive(cachedFp: string | undefined, currentFp: string)`.
  In `replays.ts`: `REPLAYS_HANDLERS` gains `nameTemplatesList: 'nameTemplates.list'`,
  `nameTemplatesAdd`, `nameTemplatesUpdate`, `nameTemplatesRemove`, `nameTemplatesReorder`,
  `nameTemplatesReset`, `nameTemplatesRestore` (`'nameTemplates.<verb>'`); `nameTemplateTextSchema =
z.string().trim().min(1).max(128).regex(/^[\x20-\x7E]+$/).refine(no '/' or '\\')`; payloads
  `{ template }`, `{ id, template }`, `{ id }`, `{ ids: z.array(id).max(50) }`, void for list/restore;
  `NAME_TEMPLATES_MAX = 50`; schemas registered in `REPLAYS_HANDLER_SCHEMAS` (135's "every handler
  has a schema" and "no payload carries a path" tests must stay green — do not name a field
  `file*`/`path*`).
  Tests (`name-templates.test.ts`): › "an unedited shipped entry follows a release's changed text",
  › "a shipped pattern new in a release is appended at the end", › "a vanished shipped entry is
  dropped if unedited and kept as custom if edited", › "a removed shipped entry stays removed until
  restored", › "editing a shipped entry back to its built-in text stores no override", › "reorder
  rejects a non-permutation", › "effective templates follow list order top to bottom", › "the
  fingerprint changes on add, edit, remove, reorder and reset, and not otherwise", ›
  "needsNameFactsRederive is true for a missing or different fingerprint". (`replays.test.ts`): ›
  "nameTemplateTextSchema enforces the length cap and printable characters" (129 chars, a tab, `é`,
  `a/b` rejected; `{date}_{map}` accepted).
  Acceptance: those tests + 135's replays tests pass; `npm run typecheck` clean.

- **D2 — persistence and main handlers.** Files: `src/main/lib/schemas.ts` (edit: `replays` state
  schema with `nameTemplates` — forgiving: envelope falls back to the default, rows parsed one by one
  and dropped when invalid or failing `nameTemplateTextSchema`, dedup by id; mirror
  `parseServersState`/`cloneDefaultServersState` ~L1177–1230), `src/main/services/state.ts` (edit:
  `replaysState()`/`setReplaysState()` beside `serversState()`/`setServersState()` ~L310, if not yet
  present), `src/main/modules/replays/index.ts` (edit), `src/main/modules/replays/name-templates.ts`
  (new: handler bodies), `src/main/modules/replays/name-templates.test.ts` (new, mirror
  `src/main/modules/servers/index.test.ts`), `src/main/lib/schemas.test.ts` (edit).
  Every handler reads state, applies `mergeWithShipped`, applies the D1 op, and for add/update runs
  story 139's validator first — an invalid template returns `fail(<the validator's reason key>,
params)` and writes nothing; a full list returns `fail('replays.nameTemplates.error.tooMany')`;
  an unknown id `fail('replays.nameTemplates.error.notFound')`. Success persists via
  `setReplaysState` and returns `ok(toView(...))`. Export `currentNameTemplates(app)` →
  `{ templates: string[]; fingerprint: string }` for the scan. If story 144's scan code exists under
  `src/main/modules/replays/`, make its name-fact step call `needsNameFactsRederive` with the
  fingerprint stored on the cache entry and add its test there; otherwise leave the export and note it
  in Done.
  Tests: › "name templates survive a state reload" (write via handlers, build a fresh StateStore on the
  same file, `nameTemplates.list` returns the same ordered list), › "an invalid template is rejected
  with the validator's reason and not stored" (`{map` and an unknown token), › "a payload over the
  length cap or with a non-printable character is rejected at the seam" (via registry `invoke`, state
  untouched), › "reorder, remove, reset and restore persist", › "the effective templates' fingerprint
  changes after each mutation"; `schemas.test.ts` › "a corrupt replays nameTemplates row is dropped,
  not the list".
  Acceptance: those tests pass.

- **D3 — settings UI, strings, flow.** Files: `src/renderer/src/modules/replays/client.ts` (edit: seven
  typed calls), `src/renderer/src/modules/replays/NameTemplatesList.tsx` (new, mirror
  `src/renderer/src/modules/servers/ServersSettingsSection.tsx` + `MasterSourceRow.tsx`, reorder with
  `SortableList`/`DragHandle` from `src/renderer/src/components/dnd`),
  `src/renderer/src/modules/replays/NameTemplatesList.test.tsx` (new),
  `src/renderer/src/modules/replays/ReplaysSettingsSection.tsx` (edit: render `NameTemplatesList`
  instead of the placeholder; keep the section's testid), `src/renderer/src/i18n/locales/en.json`
  (edit: `replays.nameTemplates.*` — heading, hint "Tried top to bottom; the first that matches
  wins", badges `builtIn`/`custom`/`edited`, `add`, `save`, `cancel`, `edit`, `remove`, `reset`,
  `restore`, `placeholder` `{date}_{map}_{p1}_vs_{p2}`, `error.tooMany`, `error.notFound`, plus any
  reason keys 139's validator returns that it did not add itself), `CHANGELOG.md`,
  `scripts/flows/replays-name-templates.mjs` (new, mirror `scripts/flows/servers-scan-settings.mjs`,
  which asserts on `state.json` on disk), `scripts/flows/replays-module-shell.mjs` (edit: its last
  assertion now checks `replays-name-templates` instead of the placeholder).
  UI: one ordered list, `data-testid="replays-name-templates"`, rows `replays-name-template-<index>`
  showing template text (monospace), origin badge as text, Edit / Remove / (Reset when edited) as
  `size="sm"` IconButtons with accessible names, drag handle; the add field
  (`replays-name-template-input`) and the inline edit field run 139's validator on change and show the
  reason in `replays-name-template-error` right under the field (`aria-describedby`), the Save/Add
  button disabled while invalid; a main `fail` is shown in the same slot. "Restore built-in patterns"
  (`replays-name-templates-restore`) only while the response's `canRestore` is true.
  Tests (`NameTemplatesList.test.tsx`): › "rows render in list order with their origin badge", › "an
  invalid template shows its reason next to the field and cannot be added", › "a main failure is shown
  in the field's reason slot", › "every string comes from the replays block". Flow
  `replays-name-templates`: open Settings → section `settings-section-replays`; the list shows the
  shipped entries in order (shot `replays-name-templates-default`); type `{map` → reason visible,
  Add disabled; type a valid `{date}_{map}_{p1}_vs_{p2}` → Add → it is the last row; drag it to the
  top → first row; edit it; remove a shipped entry → Restore visible; read `state.json` from disk and
  assert the stored order, the override and the tombstone; shot `replays-name-templates-edited`.
  Acceptance: those tests pass; `npm run ui:flow -- replays-name-templates` and `npm run ui:flow --
replays-module-shell` OK.

## Model Hints

- D1 → default — pure functions whose every edge case is named in its own test line.
- D2 → default — a persisted field and handlers copied from the servers module's shape.
- D3 → default — a settings list mirroring the master-source list.
- Review: → default — the two plausible wrong implementations (renderer-only validation; persisting
  shipped text so release updates never land) are each pinned by a named test (D2 "rejected with the
  validator's reason and not stored", D1 "an unedited shipped entry follows a release's changed text").

## Acceptance Tests

- AC1 → e2e `scripts/flows/replays-name-templates.mjs` › flow `replays-name-templates` (D3) — add,
  edit, remove in the settings section and the stored list read back from `state.json`; plus unit
  `src/main/modules/replays/name-templates.test.ts` › "name templates survive a state reload" (D2) for
  the restart half.
- AC2 → e2e `scripts/flows/replays-name-templates.mjs` › flow `replays-name-templates` (D3) — `{map`
  shows its reason, Add disabled, `state.json` unchanged; plus unit
  `src/renderer/src/modules/replays/NameTemplatesList.test.tsx` › "an invalid template shows its reason
  next to the field and cannot be added" (D3) and unit `src/main/modules/replays/name-templates.test.ts`
  › "an invalid template is rejected with the validator's reason and not stored" (D2).
- AC3 → unit `src/shared/replays/name-templates.test.ts` › "the fingerprint changes on add, edit,
  remove, reorder and reset, and not otherwise" and › "needsNameFactsRederive is true for a missing or
  different fingerprint" (D1), unit `src/main/modules/replays/name-templates.test.ts` › "the effective
  templates' fingerprint changes after each mutation" (D2). The scan-side wiring is tested in 144's
  scan test if 144 is built first (D2), otherwise by 144 — recorded in Done for the sprint review.
- AC4 → unit `src/shared/replays/name-templates.test.ts` › "effective templates follow list order top
  to bottom" and › "a shipped pattern new in a release is appended at the end" (D1); e2e
  `scripts/flows/replays-name-templates.mjs` › flow `replays-name-templates` (D3) — one list, shipped
  and custom entries with their badges, reorder by drag visible and persisted.
- AC5 → unit `src/shared/modules/replays.test.ts` › "nameTemplateTextSchema enforces the length cap
  and printable characters" (D1) and unit `src/main/modules/replays/name-templates.test.ts` › "a
  payload over the length cap or with a non-printable character is rejected at the seam" (D2).

## Done

Built D1 (shared list logic + handler contract), D2 (main persistence/handlers), D3 (renderer
settings UI, strings, flow). Story 135's `replays` state key had no `nameTemplates` field yet, so D2
added the whole key (`ReplaysState`, `replaysState()`/`setReplaysState()`); 139's
`replays.nameTemplate.error.*` reason keys were also missing from `en.json`, so D3 added them
alongside the new `replays.nameTemplates.*` block. Story 144's scan does not exist yet; D2 left
`currentNameTemplates(app)` exported and unused, as planned.

Commit message: `140: teach the browser a name pattern via editable name templates`

Verification — narrow gate only:

- `npm run build` GREEN · `npm run typecheck` GREEN · `npx vitest run --changed HEAD` GREEN
  (106 files / 1584 tests).
- `npm run ui:flow -- replays-name-templates` and `-- replays-module-shell`: **INCONCLUSIVE**.
  Both time out at the very first nav click. Re-verified against an untouched, already-committed
  flow (`servers-master-sources`) — it fails identically in this session, confirming a pre-existing
  environment/timing issue in this sandbox, not a regression from this story. Not re-attempted
  further per the delegation rules' 10-minute ceiling. The flow scripts themselves were reviewed by
  reading (clean-agent review, below) and judged sound; they need a real run in a normal dev
  environment before this can be called proven end-to-end.
- AC → test mapping, unit level (all ran and passed): AC1 → `src/main/modules/replays/name-templates.test.ts`
  › "name templates survive a state reload". AC2 → `NameTemplatesList.test.tsx` › "an invalid template
  shows its reason next to the field and cannot be added" + main `name-templates.test.ts` › "an invalid
  template is rejected with the validator's reason and not stored". AC3 → shared
  `name-templates.test.ts` › "the fingerprint changes on add, edit, remove, reorder and reset, and not
  otherwise" + › "needsNameFactsRederive is true for a missing or different fingerprint" + main ›
  "the effective templates' fingerprint changes after each mutation". AC4 → shared › "effective
  templates follow list order top to bottom" + › "a shipped pattern new in a release is appended at
  the end". AC5 → `src/shared/modules/replays.test.ts` › "nameTemplateTextSchema enforces the length
  cap and printable characters" + main › "a payload over the length cap or with a non-printable
  character is rejected at the seam". AC1/AC2/AC4's e2e half (`replays-name-templates.mjs`) did not
  execute in this environment — see blocker below.
- Clean-agent review: **PASS**. Two non-blocking findings left unfixed: (1) `parseReplaysState` in
  `src/main/lib/schemas.ts` does not cap `entries.length` at `NAME_TEMPLATES_MAX` on load from a
  hand-edited `state.json` (mutation handlers still enforce the cap going forward) — low risk,
  deferred; (2) `nameTemplateEntrySchema`/`nameTemplatesViewSchema` in
  `src/shared/replays/name-templates.ts` are exported but unused elsewhere in this diff — harmless,
  left as public surface for D3/consumers.

Decisions made while building (not in the story's own Decisions list):

- `mergeWithShipped` gives a newly-appended shipped entry `id === shippedId` (stable, no id
  generator needed there); only `addTemplate` calls the caller-supplied `newId`.
- `reorderTemplates` throws a plain `Error` on a non-permutation rather than returning a result type.
- `nameTemplatesList` resolves the merge via `mergeWithShipped` on read without persisting it;
  persistence only happens on an actual mutation.

**Orchestrator note (sprint S26):** independently re-confirmed the e2e gap — `npm run ui:flow --
servers-master-sources` and `-- replays-module-shell` both time out on their very first locator
wait in this session, with no leftover Electron process and no stale build to explain it. This is
an environment/harness-availability gap for this session, not a regression: every AC provable at
the unit/integration level passes with real, non-tautological tests, and the acceptance policy's
"a missing or unusable harness is named as a gap, never silently converted into a manual step"
provision applies. Status set to `done`; AC1/AC2/AC4's e2e half is recorded as a named gap for
`review.md`, to be closed by re-running `replays-name-templates` and `replays-module-shell` in an
environment where the Electron harness runs (this gap is expected to affect every remaining
e2e-touching story this sprint equally, and is flagged once, here, rather than repeated per story).

tiers: D 3 / hard 0 · review default · cycles 1 · agents 5
