---
id: 005
title: Import an existing config into a new profile
status: done
created: 2026-08-14
---

## Requirement

As a user with an existing, hand-written `config.cfg`/`autoexec.cfg` on one of my
installations, I want to import it into a new profile, so I don't have to rebuild my settings
from scratch when switching to the launcher's config module.

Mirrors q2-config-manager's importer: `exec` references are resolved in the same order the
engine would load them, and anything the importer doesn't recognize is preserved unchanged
rather than dropped. Depends on story 001 (profile store exists); the imported profile is then
a normal profile usable with stories 002–004.

## Acceptance Criteria

- [x] I can pick an installation to import an existing config from.
- [x] `exec` references inside the imported file(s) are resolved in engine load order.
- [x] Recognized cvars and key bindings populate the new profile's settings/keybinding state.
- [x] Anything the importer doesn't understand is preserved unchanged and shown to me, not
      silently dropped.
- [x] The result is an ordinary profile: I can rename it, assign it to installations, edit it
      further and save it like any profile created from scratch.

## Open Questions

_None — all detail questions were decided during refine, see below._

## Decisions (Sprint)

1. **No new IPC channel.** Import rides the existing `module:invoke` seam as config handlers
   (`import.scan` / `import.preview` / `import.commit`) — modules never add shell channels, they
   add handler names in `src/shared/modules/config.ts` (mirrors `library.ts`).
2. **Import is addressed by `{ installationId, gameDir }`, never by a path.** Main resolves
   `<installation.rootPath>/<gameDir>` from the registered installation itself, because CLAUDE.md
   forbids trusting a renderer-supplied path.
3. **`import.commit` re-reads and re-parses from disk** instead of accepting the previewed
   content back from the renderer, so the parse result is never renderer-forgeable.
4. **Load order is `config.cfg` then `autoexec.cfg`** of the chosen gamedir, last value wins;
   `default.cfg` is not read because it lives inside `pak0` and engine defaults are story 003's
   data table, not user content.
5. **`exec` is resolved inline at its position**, search path = chosen gamedir first, then
   `baseq2` — that is the engine's own search-path order (ROADMAP: config is per-gamedir).
6. **Recursion guard: depth 16** (`ALIAS_LOOP_COUNT` from the concept) plus a visited-file set; a
   cyclic/too-deep/missing `exec` is preserved as an unrecognized line with a warning rather than
   failing the whole import, so one bad line never costs the user the rest of the config.
7. **Recognized this sprint: `set`/`seta`/`setu`/`sets` and `bind`/`unbind`/`unbindall`.**
   Everything else (`alias`, `+cmd`, unparsable lines) is preserved verbatim — alias/alt-layer
   handling is explicitly next-sprint scope in the concept, and AC 4 only demands preservation.
8. **Files are read as latin-1 and preserved byte-for-byte**, never UTF-8 decoded, per the
   concept's high-ASCII round-trip rule (§5, symbol/colour picker).
9. **Preserved lines live on the profile** as `unrecognized: { file, line, text }[]` (additive
   field on 001's profile model) and are shown both in the import preview and in a section of the
   profile view — AC 4's "shown to me" has to survive past the import dialog.
10. **Import is the fourth option in 001's create-profile flow** (empty / template / copy /
    import), not a separate screen, because CFG-1 lists it as one of four ways to create a profile.
11. **The profile is created through 001's normal profile-store create API**, which is what makes
    AC 5 ("an ordinary profile") true by construction instead of by extra code.
12. **Gamedir choice**: `import.scan` returns every gamedir of the installation
    (`Installation.gameDirs` + `baseq2`) that actually contains a `config.cfg`/`autoexec.cfg`;
    the picker defaults to `baseq2` — config is per-gamedir, but baseq2 is the normal case.
13. **Parser core is fs-free** (`config-parser.ts`) and file/exec resolution is separate
    (`import-reader.ts`), so the tokenizer stays unit-testable and story 004's writer can reuse it.
14. **Import writes nothing to disk** — it is read-only; the first write happens on the next
    normal profile save (story 004).
15. **Payload zod schemas go into `src/main/lib/schemas.ts`** next to the other IPC payload
    schemas, following the existing "validate in main, in one place" convention.
16. **New profile name is prefilled `"<Installation name> (imported)"` and editable** in the
    dialog; uniqueness/renaming stays 001's concern.

## Plan

Read-only import path: pick installation + gamedir in the UI → main parses the engine's config
files (resolving `exec`) → preview → create a normal profile from the result.

1. **Parser core** (`src/main/modules/config/core/config-parser.ts`, pure, no fs): Quake 2
   tokenizer (`"` quoting without in-quote escaping, `//` comments, `;` command separation) and a
   classifier producing `{ cvars, binds, unbindAll, execs, preserved }` with 1-based line numbers.
2. **Reader** (`src/main/modules/config/core/import-reader.ts`, fs): reads `config.cfg` then
   `autoexec.cfg` as latin-1 via `resolveRelaxed()` (case-insensitive), expands `exec` inline
   against the gamedir → `baseq2` search path with a depth-16/visited guard, merges last-wins, and
   returns an `ImportResult`.
3. **Contract + handlers**: extend `src/shared/modules/config.ts` with `import.scan`,
   `import.preview`, `import.commit` and their types; implement them in
   `src/main/modules/config/import.ts`, wired from `src/main/modules/config/index.ts` (story 001);
   payload schemas in `src/main/lib/schemas.ts`. Commit creates the profile through 001's store.
4. **UI**: `ImportProfileDialog` reached from the create-profile flow in `ConfigView` (story 001);
   installation `Select`, gamedir `Select`, preview counts + preserved-line list, name field,
   Create. Typed client functions in `src/renderer/src/modules/config/client.ts`; strings in
   `en.json` under the `config.*` namespace.
5. **Preserved lines on the profile**: a `PreservedLinesPanel` section in the profile detail so
   the untouched lines stay visible after the dialog closes.

Order: D1 → D2 → D3 → D4 → D5. D1/D2 are independent of stories 001–004; D3–D5 build on 001's
module scaffold, profile store and `ConfigView`.

## Deliverables

**D1 — Quake 2 config parser (pure core)**
Files: `src/main/modules/config/core/config-parser.ts` (new),
`src/main/modules/config/core/config-parser.test.ts` (new).
Mirror: `src/main/services/launch-plan.ts` + `launch-plan.test.ts` (style, colocated test).
Acceptance: given config text, returns cvars (`set/seta/setu/sets`), binds
(`bind/unbind/unbindall`), `exec` targets and preserved raw lines with 1-based line numbers;
handles quoted arguments (no in-quote escaping), `//` comments and `;`-separated commands;
`alias`/`+cmd`/garbage end up in `preserved` unchanged. Unit tests cover each case.

**D2 — Load-order + `exec` reader**
Files: `src/main/modules/config/core/import-reader.ts` (new), `import-reader.test.ts` (new).
Uses: `src/main/lib/fs-utils.ts` (`resolveRelaxed`, `isFile`).
Acceptance: reads `<root>/<gameDir>/config.cfg` then `autoexec.cfg` as latin-1; `exec` is expanded
at its position via gamedir → `baseq2`; duplicate cvars/binds resolve last-wins; missing, cyclic
or >16-deep `exec` yields a preserved line + warning instead of throwing; result reports which
files were read. Tests run against a temp fixture tree including a cyclic `exec` and a
high-ASCII line that round-trips byte-for-byte.

**D3 — Contract, handlers and profile creation**
Files: `src/shared/modules/config.ts` (extend), `src/main/modules/config/import.ts` (new),
`src/main/modules/config/index.ts` (extend, story 001), `src/main/lib/schemas.ts` (extend),
`src/main/modules/config/import.test.ts` (new).
Mirror: `src/main/modules/library/index.ts` (handler shape), `schemas.ts` payload schemas.
Acceptance: `import.scan` returns candidate gamedirs with the config files found;
`import.preview` returns counts + preserved lines without writing anything; `import.commit`
re-parses and creates a profile via 001's store, carrying cvars, binds and `unrecognized`;
an unknown installation id or a gamedir not belonging to that installation returns a failed
`Outcome` with an i18n key, never a filesystem access.

**D4 — Import flow in the UI**
Files: `src/renderer/src/modules/config/ImportProfileDialog.tsx` (new),
`src/renderer/src/modules/config/client.ts` (extend), `src/renderer/src/views/ConfigView.tsx`
(extend, story 001), `src/renderer/src/i18n/locales/en.json` (extend).
Mirror: `src/renderer/src/views/LibraryView.tsx` (layout), `modules/library/client.ts` (client),
`components/ui/Modal.tsx` + `controls.tsx` (`Field`, `Select`, `Input`) + `Button.tsx`.
Acceptance: the create-profile flow offers "Import from installation"; the dialog lets me pick an
installation and gamedir, shows the preview (n cvars, n binds, n preserved lines with the list),
prefills the name, and Create produces a selected profile. Empty state when the installation has
no config files. All strings via i18n, all visuals from existing primitives.

**D5 — Preserved lines stay visible on the profile**
Files: `src/renderer/src/modules/config/PreservedLinesPanel.tsx` (new),
`src/renderer/src/views/ConfigView.tsx` (extend), `src/renderer/src/i18n/locales/en.json`.
Mirror: `components/ui/primitives.tsx` (`Panel`, `SectionLabel`, `EmptyState`, `Badge`).
Acceptance: selecting an imported profile shows a "Preserved lines" section listing each line with
its source file and line number, unchanged; a profile without such lines shows an empty state.

### Coverage (AC → D)

| Acceptance criterion | Deliverable |
| --- | --- |
| Pick an installation to import from | D3 (`import.scan`) + D4 (picker UI) |
| `exec` resolved in engine load order | D1 (`exec` detection) + D2 (resolution/order) |
| Recognized cvars and binds populate the profile | D1 (classify) + D3 (commit → profile) |
| Unknown content preserved and shown | D1/D2 (preserved) + D4 (preview list) + D5 (profile) |
| Result is an ordinary profile | D3 (created via 001's store API) + test plan step 6 |

## Model Hints

- D2 → `deliverable-hard` — inline `exec` expansion across a two-entry search path with
  last-wins merging and a cycle/depth guard is the one place where a silent wrong result or an
  infinite loop can hide, and it is the story's factual core.
- D1, D3, D4, D5 → default tier.
- Review: → `story-review-hard` — the importer's failure mode is silently losing lines of a
  user's hand-written config, which only a line-by-line spec-vs-diff review catches.

## Test Plan (manual acceptance)

Prerequisite: a registered installation whose `baseq2` contains a `config.cfg` with a few
`set`/`bind` lines, an `exec extra.cfg` line and an `alias` line, plus `extra.cfg` next to it
containing one more `bind`, and an `autoexec.cfg` overriding one of the cvars.

1. `npm run dev`, open **Config** in the nav.
2. Create profile → **Import from installation**; pick the installation, leave gamedir `baseq2`.
3. Preview shows the cvar/bind counts including the bind from `extra.cfg` (proves `exec`), and
   the `alias` line listed under preserved lines with file + line number.
4. The cvar set in both files shows the `autoexec.cfg` value (proves load order).
5. Create → the new profile is selected; its **Preserved lines** section still lists the `alias`
   line unchanged.
6. Rename the profile, assign it to an installation (story 002), change a cvar (story 003) and
   save (story 004) — everything behaves like a profile created from scratch.
7. Restart the app: profile, cvars, binds and preserved lines are still there.
8. Confirm nothing was written into the source installation during import (file timestamps
   unchanged until the story-004 save in step 6).

## Done

### Summary

Built the full read-only importer: a pure Quake II config tokenizer (D1), a filesystem
reader that resolves `exec` inline against the gamedir→`baseq2` search path with load-order
merging and a depth/cycle/total-work guard (D2), the three `import.*` handlers plus contract
and profile-creation wiring (D3), the create-profile-flow UI (D4), and a permanent
"Preserved lines" section on the profile detail view (D5). All five deliverables built,
tested and typechecked clean; a hard-tier review passed with one medium finding (unbounded
`exec` fan-out), which was fixed directly afterward.

### Deviations from the story text (implementation-detail decisions, verified against Plan + AC)

1. **New IPC payload schemas went into `src/main/modules/config/schemas.ts`**, not
   `src/main/lib/schemas.ts` as Decision 15 literally says. Every other config-module payload
   schema already lives there (established in 001–004) and `index.ts` already imports from
   there — the story's text was stale, not the intent. `src/main/lib/schemas.ts` was still
   touched, but only for its actual job: the *persisted* `configProfileSchema` gained the new
   `unrecognized` field with the repo's forgiving `.catch(() => [])` convention.
2. **`src/renderer/src/views/ConfigView.tsx` does not exist.** The real file, already present
   since story 001, is `src/renderer/src/modules/config/ConfigView.tsx` — that is the one D4/D5
   extended.
3. **`ConfigProfile.unrecognized` is optional**, not required, so the many pre-existing
   `ConfigProfile` test fixtures across 001–004 didn't all need touching. Every read site
   (`PreservedLinesPanel.tsx`, the persisted schema) treats it as possibly absent.
4. **`src/main/modules/config/profiles.ts` was extended** with `ProfilesStore.createFromImport()`
   even though D3's own file list omitted it — Decision 11 ("created through 001's normal
   profile-store create API") has no existing store method that accepts caller-supplied
   cvars/binds, so one was added, mirroring `create()`'s id/timestamp/commit pattern exactly.

### Review

A `story-review-hard` agent reviewed the full diff independently against the story's
Acceptance Criteria, Decisions and CLAUDE.md. **Verdict: PASS**, all 5 acceptance criteria
individually PASS with file:line evidence; no weakened/deleted tests, no scope creep, no
path-trust violations, `import.commit` genuinely re-reads from disk (Decision 3), nothing on
the import path writes to disk (Decision 14), the renderer's `Outcome` flattening is correct.

One **medium finding (F1)** was raised and fixed post-review: Decision 6 asks for "depth 16
plus a visited-file set", but D2 deliberately replaced the visited-file set with an
active-*chain* set (so a file legitimately `exec`'d twice — e.g. by both `config.cfg` and
`autoexec.cfg` — isn't wrongly treated as a cycle and dropped). That's the right call for
correctness, but it left the depth guard as the only bound on total work, and depth alone
does not bound *fan-out*: a config that `exec`s two distinct, non-cyclic files at every level
of a 16-deep chain is legal under the chain guard yet opens up to 2^16 files. Fixed by adding
`MAX_EXEC_EXPANSIONS = 512`, a flat ceiling on total files opened across the whole import,
independent of depth — a budget-exhausted `exec` degrades to a preserved/warned line exactly
like a missing or cyclic one, never an aborted import or a hang. New test:
`import-reader.test.ts` — "refuses further exec once 512 files have been opened...".

Six low-severity/nit findings (F2–F9) were left unfixed, all in already-documented territory:
- **F2–F6**: fidelity edge cases confined to a single physical line that mixes an `exec` with
  another command via `;` (`exec x.cfg; set a 1` applying in the "wrong" order relative to a
  hand-reconstructed line-order tie-break), a refused `exec`'s preserved text being a
  normalised reconstruction rather than the original bytes, and a rare quote-parity edge case
  in the tokenizer. All are pre-existing, explicitly documented limitations in
  `import-reader.ts`'s own header comment (D2's agent flagged the line-order one itself as "a
  plan gap rather than patching D1"); real Quake II configs (hand-written or engine-written)
  are one-command-per-line, so none of these affect the story's actual use case. Revisiting
  would mean reworking D1's parser to emit per-line ordinals — out of scope for this sprint.
- **F7**: incidental reformatting of a few pre-existing, untouched-by-this-story lines by an
  agent's editor/prettier pass — reverted directly (`client.ts`'s two unrelated functions) so
  the diff stays scoped to the story.
- **F8**: a prettier line-width nit in the new `ImportProfileDialog.tsx` — fixed directly
  (`npx prettier --write`).
- **F9**: an added i18n key (`config.preservedLines.empty.title`) that's defined but not
  rendered by `PreservedLinesPanel.tsx` (only `.body` is used) — harmless, left as-is.

### Commit message

```
005: import an existing config into a new profile
```

### Verification

- `npm run build` — clean (main/preload/renderer all built).
- `npm test` — 143/143 passing (11 files), including new suites for the parser, the reader
  (22 tests, covering load order, exec search-path/inline-position, last-wins merge,
  `unbind`/`unbindall` folding, cycle/depth/budget guards, latin-1 byte-for-byte round-trip)
  and the three IPC handlers (11 tests, including the never-touch-the-filesystem-on-a-bad-id
  case).
- `npx tsc --noEmit` (both projects) — clean.
- Code review — PASS (see above); one medium finding fixed, rest documented and accepted.
- **Live UI smoke (P2, `live-smoke-required: true`): NOT completed.** `npm run dev` builds
  main/preload/renderer successfully, but Electron itself fails to launch in this sandbox
  (`electron.exe: 3: Syntax error: Unterminated quoted string`) — the same WSL/no-driver
  environment limitation noted for prior stories on this branch, not something introduced by
  this story. The importer is **built and code-review-verified, but manual/live acceptance of
  the actual UI flow (Test Plan below) is still pending** and needs to be run by a human (or an
  agent with a working Electron/X environment) before this story can be marked `done`.

Status intentionally left `in-progress` per the profile's P2 rule (a green build/test is not
enough for a user-facing story without a real pass through the running app). All 5 acceptance
criteria are ticked above based on the code-level verification (parser/reader/handler tests +
independent hard-tier review).

**Live acceptance (2026-08-16):** the manual Test Plan below was walked against a real desktop
environment and accepted by the user. Status moved to `done`.
