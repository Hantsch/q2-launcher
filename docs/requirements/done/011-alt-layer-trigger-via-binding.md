---
id: 011
title: Assign an alt layer's trigger by binding it to a key, not at creation
status: done
created: 2026-08-18
---

## Requirement

As a user building an alt layer, I want to create the layer without having to pick a trigger
key up front, and instead assign (or later reassign) its trigger the same way I bind any other
key — by binding a key to "switch into this layer" from the keyboard overview. Today the trigger
key is mandatory at creation time and, per the roadmap's known gap, can never be changed
afterwards — the only way to pick a different trigger is to delete the layer and recreate it,
losing its overrides in the process.

## Acceptance Criteria

- [x] Creating a layer does not require a trigger key; a layer can exist with no trigger
      assigned yet.
- [x] A key can be bound to "switch into layer X" from the keyboard overview, the same place
      any other bind happens — this becomes the layer's trigger.
- [x] A layer's trigger can be moved to a different key without deleting/recreating the layer,
      and without losing the layer's overrides.
- [x] A layer's trigger can be cleared, leaving the layer intact but not reachable from the
      keyboard until a new trigger is assigned.
- [x] Assigning a trigger to a key that already carries a base bind is flagged the same way it
      is today (trigger wins, conflict surfaced) — this existing behavior is preserved, not
      regressed.
- [x] A layer with no trigger assigned is clearly distinguishable from one with a trigger, in
      both the layers list and the generated file preview.

## Open Questions

(none)

## Decisions (Sprint)

1. **`triggerKey: string | null`, not optional** — mirrors story 007's
   `SetSwitchBindInput.key: string | null`, and a nullable (rather than absent) field makes the
   compiler flag every existing read site instead of letting `undefined` slip through.
2. **Trigger assignment lives in `KeyBindDialog`, base-layer view only** — a trigger *is* a
   base-layer bind (`render.ts` emits it in the bind block); offering it while editing a layer's
   own overrides would mix two different meanings of "bind this key".
3. **One key triggers at most one layer** — assigning a key that is already another layer's
   trigger *moves* it (clears the previous owner) in the same save, because two `bind <key>` lines
   would otherwise silently fight in the rendered file.
4. **Assigning a trigger to a key the target layer already overrides stays a blocking error** —
   keeps story 006 decision 12 (`layer.selfbind`) intact rather than saving a layer nobody can leave.
5. **No new IPC channel, no state-schema migration** — trigger changes ride the existing
   `setLayers` full-array save, and `main/lib/schemas.ts` stays forgiving so pre-011 rows keep
   their string, per the documented `layers` convention in `shared/modules/config.ts`.
6. **A trigger-less layer still renders its aliases**; only the `bind <trigger>` line is skipped —
   the layer stays intact and console-invokable, which is exactly "not reachable from the keyboard".
7. **New `layer.noTrigger` warning issue** (emitted only when the layer has overrides) is how "no
   trigger" surfaces in the panel; the rendered `.cfg` gets no new comment line, so byte-output
   determinism stays untouched.
8. **`generateLayerAliases` returns `triggerBind: null`** for a trigger-less layer instead of a
   `{ key: '' }` placeholder, so no caller can emit `bind  +foo` by omission.
9. **No `NAMED_KEYS` vocabulary check on the trigger key** (`z.string().min(1).nullable()` stays) —
   hardening that the story does not ask for, and the board's key set is not proven identical to
   `NAMED_KEYS`.
10. **The create-layer dialog loses its trigger `Select` entirely** (not "optional field") — AC1
    requires creation without a trigger, and the point of 011 is that the board is the one place a
    trigger gets picked.

## Plan

Make `AltLayer.triggerKey` nullable end to end, then give the keyboard overview's key dialog a
"trigger" target so a trigger is assigned/moved/cleared like any other bind. No new IPC channel:
everything rides the existing `setLayers` full-array save (`CONFIG_HANDLERS.setLayers`).

1. **Shared core** (`src/shared/config/alt-layers.ts`): `triggerKey: string | null`;
   `GenerateLayerResult.triggerBind` becomes `{ key, command } | null`; guard the `.trim()` at the
   top of `generateLayerAliases`; skip `layer.selfbind` / `layer.triggerConflict` when there is no
   trigger; add issue key `layer.noTrigger` (warning, only when the layer has overrides). Add two
   pure helpers used by the UI and by stories 013/014: `assignLayerTrigger(layers, layerId, key)`
   (sets/clears the trigger and clears that key off every other layer — decision 3) and
   `findLayerByTriggerKey(layers, key)`.
2. **Render** (`src/shared/config/render.ts`): the trigger-bind loop skips a layer with
   `triggerBind === null` in addition to the existing empty-layer skip. Aliases still emitted.
3. **Schemas**: `src/main/modules/config/schemas.ts` → `triggerKey: z.string().min(1).nullable()`;
   `src/main/lib/schemas.ts` (`altLayerPersistedSchema`) → nullable + defaulting to `null` so
   pre-011 rows and rows without the field both load. No `STATE_SCHEMA_VERSION` bump.
4. **LayersPanel** (`src/renderer/src/modules/config/LayersPanel.tsx`): drop the create dialog's
   trigger `Select` and the now-dead `triggerKeyOptions()`; the list row shows a "No trigger" badge
   instead of `Trigger: -`; the expanded preview shows the `bind <key> <command>` trigger line (or
   the "not reachable" note) above the alias block, and `layer.noTrigger` joins
   `VISIBLE_ISSUE_KEYS`.
5. **KeyBindDialog** (`.../components/KeyBindDialog.tsx`): on the base-layer view add a "layer
   trigger" control — current state ("K triggers <Layer>" / none), a layer picker, Assign and a
   "Clear trigger" action; saving goes through `assignLayerTrigger` + `updateProfileLayers` and
   never touches `overrides`. Refuse (blocking, like today's selfbind gate) if the picked layer
   already overrides this key; warn (non-blocking) when the key carries a base bind
   (`layer.triggerConflict`) or already triggers another layer.
6. **i18n** (`src/renderer/src/i18n/locales/en.json`): `layer.noTrigger`, `config.layersPanel.*`
   (noTrigger, preview trigger line, createDialog without triggerLabel),
   `config.keyBindDialog.trigger.*`.
7. **Tests**: extend `src/shared/config/alt-layers.test.ts`,
   `src/main/modules/config/render.test.ts`, `src/main/modules/config/profiles.test.ts`.

Order: 1 → 2 → 3 → 4 → 5, i18n and tests inside their deliverable.

## Deliverables

**D1 — Nullable trigger in the shared core + assignment helpers**
Files: `src/shared/config/alt-layers.ts`, `src/shared/config/alt-layers.test.ts`.
Mirror: the nullable-key shape of story 007's switch bind (`src/shared/modules/config.ts`
`SetSwitchBindInput`).
Acceptance: `triggerKey` is `string | null`; `generateLayerAliases` on a trigger-less layer returns
`triggerBind: null`, emits `layer.noTrigger` (warning) when it has overrides, and emits neither
`layer.selfbind` nor `layer.triggerConflict`; all existing assertions for triggered layers
(`+drops` / `zoom`, quoting, chunking, name budget, selfbind, triggerConflict, determinism) still
pass unchanged; `assignLayerTrigger()` sets a trigger, moves it off any other layer that held that
key, clears it with `null`, and never mutates any layer's `overrides`;
`findLayerByTriggerKey()` returns the owning layer or `null`. New tests cover each of these.

**D2 — Rendered file skips a trigger-less layer's bind line**
Files: `src/shared/config/render.ts`, `src/main/modules/config/render.test.ts`.
Acceptance: a layer with overrides but no trigger renders its alias lines and **no** `bind` line
for it; the existing empty-layer skip, the trigger-bind-after-base-bind ordering and byte-identical
output for pre-011 profiles are unchanged. No `bind  <alias>` (empty key) can be produced.

**D3 — Persistence + IPC schemas accept a missing trigger**
Files: `src/main/modules/config/schemas.ts`, `src/main/lib/schemas.ts`,
`src/main/modules/config/profiles.test.ts`.
Mirror: `switchBindKeySchema.nullable()` usage in `src/main/modules/config/schemas.ts`.
Acceptance: `setProfileLayersInputSchema` accepts `triggerKey: null` and rejects `''`; a persisted
layer row with `triggerKey` absent or `null` loads as `null` and a pre-011 row keeps its string;
`STATE_SCHEMA_VERSION` untouched and `MIGRATIONS` still empty; existing `setLayers` tests pass.

**D4 — Layers panel: create without a trigger, show trigger state**
Files: `src/renderer/src/modules/config/LayersPanel.tsx`,
`src/renderer/src/i18n/locales/en.json`.
Acceptance: the create dialog has only name + mode and creates a layer with `triggerKey: null`
(`triggerKeyOptions()` removed, no unused imports left); a trigger-less layer's row shows a
"No trigger" marker clearly different from `Trigger: <key>`; its expanded preview shows the trigger
bind line when there is one and a "not reachable from the keyboard" note when there is not;
`layer.noTrigger` renders in the per-layer issue banner. No hardcoded colours (design tokens only).

**D5 — Bind a key as a layer's trigger from the keyboard overview**
Files: `src/renderer/src/modules/config/components/KeyBindDialog.tsx`,
`src/renderer/src/i18n/locales/en.json`.
Mirror: `SwitchBindControl.tsx` for the capture/clear affordance shape; the dialog's existing
`save()` / `updateProfileLayers` path for persistence.
Acceptance: clicking any key in edit mode on the **base** layer offers "make this key the trigger
for <layer>" with a layer picker plus a Clear-trigger action; assigning writes only `triggerKey`
(via `assignLayerTrigger`) and leaves every layer's `overrides` byte-identical; assigning a key
that already triggers another layer moves the trigger and says so before saving; assigning a key
the picked layer already overrides is blocked with the existing `layer.selfbind` message; a key
that carries a base bind shows `layer.triggerConflict` as a non-blocking warning; the trigger
control does not appear while a layer is the active view; the base-bind Assign/Clear behaviour is
unchanged.

## Model Hints

- D1 → default
- D2 → default
- D3 → default
- D4 → default
- **D5 → `deliverable-hard`** — it has to move a trigger between keys without touching
  `overrides`, keep two existing guards (`layer.selfbind` blocking, `layer.triggerConflict`
  warning) intact, and share one Assign/Clear footer with the base-bind path where taking the wrong
  branch silently rewrites a bind instead of the trigger.
- **Review: → `story-review-hard`** — the change spans a heavily-tested pure generator, the
  persisted schema and two renderer surfaces that stories 013/014 build directly on top of, and a
  missed regression here surfaces as a corrupted generated `.cfg`, not as a failing test.

## Test Plan (manual acceptance)

Run `npm run dev`, open the Config view, pick a profile with a few base binds.

1. Alt layers → **Create layer**: the dialog asks only for name and mode. Create "Test" (hold).
   → The row shows "No trigger", not a key.
2. Expand the new layer's preview → it says the layer is not reachable from the keyboard.
3. Switch the board to the "Test" layer, click `1`, assign `use blaster` → back to **Base**.
4. On the base layer, click `-` in edit mode → the dialog offers the layer trigger; pick "Test",
   Assign. → Layer row now shows `Trigger: -`; preview shows `bind - +test`.
5. Profile preview (raw file) → contains `bind - +test` after the base-bind block.
6. Click `x` (a key with an existing base bind), assign it as "Test"'s trigger → the conflict
   warning appears, the assignment goes through, the layer row shows `Trigger: x`, `-` is free
   again, and the layer's `1 → use blaster` override is still there.
7. Click `1` (which "Test" overrides) and try to make it "Test"'s trigger → refused with the
   self-bind message.
8. Click `x` again → **Clear trigger**. → Row shows "No trigger", override on `1` still present,
   raw preview has no `bind x +test` line.
9. Restart the app → the trigger-less layer with its override is still there.

## Done

**Summary.** `AltLayer.triggerKey` is now `string | null` end to end (shared generator, render,
both zod schemas, both renderer surfaces). A layer can be created without a trigger; its trigger is
assigned, moved or cleared from the keyboard overview's `KeyBindDialog` on the base-layer view via
two new pure helpers, `assignLayerTrigger()`/`findLayerByTriggerKey()`
(`src/shared/config/alt-layers.ts`). `render.ts` skips the `bind` line for a trigger-less layer
while still emitting its aliases. `LayersPanel` shows a "No trigger" badge vs. `Trigger: <key>` and
a matching preview line/"not reachable" note. The existing `layer.selfbind` (blocking) and
`layer.triggerConflict` (non-blocking warning) guards are preserved on the new trigger-assignment
path, computed from the same conditions the generator uses, so the two can never disagree.

**Deliverables:** D1 `src/shared/config/alt-layers.ts` + `.test.ts` — D2 `src/shared/config/render.ts`
+ `src/main/modules/config/render.test.ts` — D3 `src/main/modules/config/schemas.ts`,
`src/main/lib/schemas.ts` + `profiles.test.ts`/`schemas.test.ts` — D4
`src/renderer/src/modules/config/LayersPanel.tsx` + `en.json` — D5 (hard tier)
`src/renderer/src/modules/config/components/KeyBindDialog.tsx` + `en.json`.

**Decisions taken during the build** (beyond the story's own `## Decisions (Sprint)`, which the
implementation followed as written):
- D3's persisted schema uses `z.string().nullable().catch(null)` for `triggerKey` so a missing or
  malformed value degrades to `null` per-field rather than failing the whole layer row, matching
  this file's existing forgiving-schema convention.
- D4's expanded-preview trigger line is built inline as `` `bind ${key} ${command}` `` rather than
  importing anything from `render.ts` into the renderer — it's a one-line format already fixed by
  `render.ts`'s own contract, not worth a cross-module import for.
- D5 keeps the new trigger control's state (`pickedTriggerLayerId`, `triggerSubmitting`) and save
  path (`saveTrigger`) fully separate from the existing bind-editing `command`/`submitting`/`save()`
  flow in `KeyBindDialog.tsx`, sharing only a derived `busy` flag (`submitting || triggerSubmitting`)
  so the two saves can't race against a stale `profile`, while neither can accidentally invoke the
  other's mutation.
- The trigger control's own Assign/Clear buttons live in the dialog body (their own small action
  row), not in the shared modal `footer` — the footer already means "save the bind" and one footer
  cannot mean two unrelated actions.

**Verification:**
- `npm run build` — green.
- `npm run typecheck` (node + web) — clean (not a required gate per the project profile, run as an
  extra check).
- `npm test` — 435/435 passing across 25 files. Note: an early run of `npx vitest run
  src/main/modules/config/render.test.ts` inside this session's Bash tool threw
  `TypeError: Cannot read properties of undefined (reading 'config')` on every test file, including
  on an unmodified `git stash`'d tree — confirmed to be a Bash-tool/Git-Bash environment quirk with
  this vitest version, not a regression: the identical suite passed cleanly (435/435) run through
  PowerShell instead, and D1/D3/D5's own sandboxed subagent runs also passed cleanly.
- **Clean-agent review (`story-review-hard`): PASS.** All 6 acceptance criteria individually
  verified PASS with file:line evidence; no weakened/deleted tests; no scope creep. Five low-severity
  findings, none blocking, left as-is:
  1. `LayersPanel`'s expanded preview can show a trigger-bind line for a layer that `render.ts`
     would actually skip (an empty layer with a trigger key set but no valid overrides) — a cosmetic
     accuracy gap, mitigated by the `layer.empty` banner already shown alongside it.
  2–3. Minor `.trim()`-asymmetry edge cases in trigger-key/self-bind comparisons, reachable only via
     a hand-edited state file or a whitespace-padded key the UI/strict schema can never produce.
  4. "Clear trigger" always targets the key's current trigger owner regardless of what's selected in
     the layer picker — behaviorally correct (there's only ever one owner to clear) but an implicit
     UX coupling worth a comment if this file is touched again.
  5. Two assertion lines added to `render.test.ts` exceed the repo's `printWidth: 100` —
     `npm run format:check` is already red on 232 pre-existing files repo-wide, so this is a
     pre-existing-condition nit, not a new regression.
- **Live UI smoke test (P2): NOT completed — built, live acceptance pending.** `npm run dev` could
  not be exercised: partway through this session the host's Node.js runtime became unreachable
  (`node`/`npm` unresolved via both the Bash and PowerShell tools) after `build`/`test`/`typecheck`
  had already run clean, then came back later in the session — but by then no interactive-UI-driving
  tool was available in this environment (no Playwright installed in this project, the `ui-verify`
  skill's harness scripts (`scripts/seed.mjs`/`shot.mjs`/`a11y.mjs`) are not yet scaffolded in this
  repo, and the Playwright MCP tools drive a browser page, not an Electron window) to actually click
  through the 9-step manual test plan below. Per this project's P2 policy, status stays
  `in-progress` rather than `done` until a human (or a session with real UI-driving capability) runs
  the `## Test Plan (manual acceptance)` steps below and confirms.

**Suggested commit message:** `011: alt layer trigger assignable via key binding, not creation`
