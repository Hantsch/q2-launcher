---
id: 007
title: In-session profile-switch bind
status: in-progress
created: 2026-08-16
---

## Requirement

As a user with more than one profile assigned to an installation, I want a bindable key that
cycles to the next assigned profile during play and echoes its new name to the console, so I
can switch between profiles without restarting the game — without it ever changing my
installation's default profile.

See [docs/concepts/config-module.md §4](../concepts/config-module.md#4-core-terms--model) and
CFG-6. Reuses the self-rewriting alias-pair mechanism story 006 builds for toggle layers.

## Acceptance Criteria

- [x] An installation with more than one assigned profile exposes a user-assignable key (no
      fixed default beyond suggesting F9) that cycles through its assigned profiles in order.
- [x] Pressing the bound key in-game execs the next assigned profile's file and echoes the new
      profile's name to the console.
- [x] The switch is session-only: the installation's designated default profile is unchanged,
      and the default is what loads on the next launch.
- [x] The generated switch-bind alias/exec chain is written to disk on profile save, through
      the same backup-once/diff-skip write pipeline as story 004.
- [x] An installation with 0 or 1 assigned profiles shows no switch-bind control.

## Open Questions

_None — direct numbered profile selection (bind 1–9) is explicitly out of scope per the
concept's open point 2._

## Decisions (Sprint)

1. **The bind is per installation, not per profile** — it cycles *that installation's* assigned
   profiles, so it cannot live on `ConfigProfile` (a profile is assigned to many installations);
   it is stored as `configSwitchBinds: Record<installationId, string /* key name */>`.
2. **State lives in `src/main/services/state.ts` next to `configPlayedMods`** — that is the
   precedent story 004 already established for per-installation config-module data, with the same
   `src/main/lib/schemas.ts` parse-with-`.catch()` pattern; inventing a second storage location
   for the same kind of data would be the bigger shell change.
3. **No new IPC channel** — two added module handlers (`switchBinds` to read the map,
   `setSwitchBind` to set/clear one entry) over the shell's existing `module:invoke` envelope; the
   map cannot ride along on `list`, which returns profiles, not per-installation data. Per
   ARCHITECTURE.md ("a module can never widen the renderer's IPC surface") and story 002 decision 5.
4. **The chain is generated into the loader `autoexec.cfg`, not into a per-profile file** — story
   004 decision 3 already declared the loader the single place the switch bind would edit, and it
   is the only generated file every profile file's `exec` cannot clobber (a profile file is what
   the chain *execs*).
5. **Chain shape (my assumption for the "self-rewriting alias pair" story 006 builds for toggle
   layers, since 006 is unrefined at this time): one step alias per profile plus one indirection
   alias that each step rewrites** — the generalised n-way form of a 2-way toggle pair, and the
   only form Quake 2 supports without nested quotes:

   ```
   alias q2l_sw1 "exec q2l-profile-<id1>.cfg; echo Profile: <name1>; bind F9 q2l_switch; alias q2l_switch q2l_sw2"
   ...
   alias q2l_swN "... ; alias q2l_switch q2l_sw1"
   alias q2l_switch q2l_sw<successor of the default>
   bind F9 q2l_switch
   ```

   If 006 lands a shared alias-emitting helper first, D1 uses it instead of duplicating it.
6. **Each step re-applies `bind <key> q2l_switch`** — the profile file a step execs may itself bind
   that key (story 006 makes binds editable), which would otherwise kill the cycle after one press.
7. **The indirection alias starts at the successor of the installation's default** — the default is
   what the loader already execed at launch, so the first press must move on, not re-exec it.
8. **Cycle order = the module's profile-list order filtered to that installation** — stable across
   saves and identical to what the UI shows, so "next" is never surprising.
9. **The echoed name is sanitized and truncated** (strip `"`, `;`, `$`, `//`, control chars;
   cap at 40 chars; fall back to the profile id) — Quake has no in-quote escaping, `$` triggers
   macro expansion, and every line must stay far below the 1024-byte `Cbuf_Execute` limit.
10. **Alias names are fixed short tokens (`q2l_switch`, `q2l_sw<n>`)** — well inside
    `MAX_ALIAS_NAME` (32) for any profile count, and independent of user-chosen profile names.
11. **No chain is emitted at all when an installation has fewer than 2 assigned profiles** — the
    on-disk side of AC5, so a removed assignment also removes the bind from the game, not just the
    control from the UI.
12. **Changing the bind key writes immediately through the story-004 pipeline for that one
    installation** — otherwise the setting would only reach disk on the next unrelated cvar edit;
    it is an explicit user action, and it reuses `writeInstallationFiles` unchanged (no second
    write path, backup-once/diff-skip intact).
13. **The chain never touches launcher state** — it is pure engine config; the installation's
    default assignment is only ever changed through the existing `setDefault` handler, which is
    what makes AC3 (session-only) true by construction rather than by a guard.
14. **Key selection reuses `resolveQuakeKeyName()` from
    `src/renderer/src/modules/config/lib/keyboard-layout.ts`** (already shipped with the overview
    tab) for press-to-capture, with F9 pre-suggested — no dependency on story 006's editor.
15. **UI host is `InstallationProfilesPanel.tsx`**, the existing per-installation row list — the
    only surface that already enumerates installations with their assigned profile count, which is
    exactly the condition AC5 keys off.

## Plan

Extend the existing story-004 pipeline; add no new write path and no new IPC channel.

1. **Chain generator** — `src/main/modules/config/switch-bind.ts` (+ `.test.ts`): pure
   `renderSwitchBindChain({ key, profiles, defaultProfileId })` → string lines (empty for < 2
   profiles). Owns name sanitizing, alias naming, line-length and `MAX_ALIAS_NAME` limits.
2. **Loader integration** — `src/main/modules/config/render.ts`: `renderLoaderFile(defaultProfile,
   switchBind?)` appends the chain after the existing `exec` line. Existing sentinel/latin1/`\n`
   rules unchanged; existing `render.test.ts` cases must stay green (no arg = today's output).
3. **Contract + state + handlers** — `src/shared/modules/config.ts` (`setSwitchBind`,
   `switchBinds`, their input/result types), `src/main/services/state.ts` +
   `src/main/lib/schemas.ts` (`configSwitchBinds` slice), `src/main/modules/config/schemas.ts`
   (payload validation: installation id + key name from the known key vocabulary),
   `src/main/modules/config/index.ts` (feed the switch bind into both
   `writeProfileToAssignedInstallations` and `previewProfileFiles`; `setSwitchBind` persists and
   then writes that one installation).
4. **UI** — a `SwitchBindControl` used by `InstallationProfilesPanel.tsx`: rendered only when the
   installation has ≥ 2 assigned profiles, shows the current key or "not set", a capture button
   (press any key) and a clear action; `client.ts` gets the typed calls, `en.json` the
   `config.switchBind.*` keys.

Order: 1 → 2 → 3 → 4. Steps 1–3 are main-only and unit-testable; step 4 attaches to the existing
panel.

## Deliverables

- **D1 — Pure chain generator.** `src/main/modules/config/switch-bind.ts` + `switch-bind.test.ts`.
  Deterministic ordered chain, step aliases, indirection alias starting at the default's successor,
  per-step `bind` re-apply, name sanitizing/truncation, `''` for 0/1 profiles. *Mirror:*
  `src/main/modules/config/render.ts` (pure module) and `render.test.ts` (test style).
  *Accepted when:* tests cover 2 and 4 profiles, default in the middle of the order, a name with
  `"`/`;`/`$`/high-ASCII, every emitted alias name ≤ 32 chars, every emitted line < 1024 bytes, and
  an empty result for < 2 profiles. **Covers AC 1 (order), AC 2, AC 5 (disk side).**
- **D2 — Loader carries the chain.** `src/main/modules/config/render.ts` (+ `render.test.ts`):
  optional second argument appends D1's chain to the loader text. *Accepted when:* the no-argument
  call is byte-identical to today's output, the with-chain call places the chain after the `exec`
  line, and the whole file still round-trips latin1. **Covers AC 4 (content side).**
- **D3 — Contract, state slice and handlers.** `src/shared/modules/config.ts`,
  `src/main/services/state.ts`, `src/main/lib/schemas.ts`, `src/main/modules/config/schemas.ts`,
  `src/main/modules/config/index.ts` (+ `index.test.ts`). `switchBinds` returns the map,
  `setSwitchBind` validates, persists, and triggers the existing write for that installation only;
  `writeProfileToAssignedInstallations` and `previewProfileFiles` both pass the installation's
  switch bind and its ordered assigned profiles into the loader render. *Mirror:* the
  `setPlayedMods` handler + `configPlayedMods` slice in the same files. *Accepted when:* saving a
  profile writes a loader containing the chain for a 2-profile installation; a malformed payload
  returns `fail('ipc.error.invalidPayload')`; a test pins that no code path changes any
  assignment's `isDefault`; running-installation skip/pending behaviour is unchanged.
  **Covers AC 3, AC 4, AC 1 (persistence).**
- **D4 — Per-installation switch-bind control.** `src/renderer/src/modules/config/
  SwitchBindControl.tsx`, `InstallationProfilesPanel.tsx`, `client.ts`,
  `src/renderer/src/i18n/locales/en.json`. Shown only for installations with ≥ 2 assigned profiles;
  press-to-capture via `resolveQuakeKeyName`, F9 suggested, current key displayed, clear action.
  Design-system primitives only (`Badge`, `Button`, `SectionLabel`, `controls.tsx`). *Mirror:*
  `WriteTargets.tsx` (client calls + status handling), `ProfileAssignmentsPanel.tsx` (row layout).
  **Covers AC 1 (user-assignable key), AC 5 (UI side).**

**Coverage gate (AC → D):** AC1 → D1 + D3 + D4 · AC2 → D1 + D2 · AC3 → D3 · AC4 → D2 + D3 ·
AC5 → D1 + D4.

## Model Hints

- `D1 → deliverable-hard` — the generated alias chain is the whole feature and it is unforgiving:
  one stray quote, a wrong successor, or a missing `bind` re-apply produces a config that looks
  fine on disk but silently breaks after the first press, and no test can see that for you.
- D2, D3, D4 → default tier.
- `Review: → default` — the irreversible parts of the pipeline (backup-once, diff-skip, atomic
  write, path trust) are untouched by this story; only generated text and one additive state slice
  change, and D1's risk is already carried by the hard tier.

## Test Plan (manual acceptance)

1. `npm run dev`, Config: create two profiles (e.g. "Duel" and "CTF"), assign both to the same
   installation, keep "Duel" as default.
2. In the "By installation" panel that installation now shows a switch-bind control — press its
   capture button and hit **F9**. An installation with only one assigned profile shows no control.
3. Save/edit a cvar on either profile. Open Preview: `baseq2/autoexec.cfg` contains the `exec` of
   the *default* profile followed by the `q2l_sw…` alias chain and `bind F9 q2l_switch`.
4. Launch that installation. In-game press **F9**: the console echoes `Profile: CTF`. Press again:
   `Profile: Duel`. Repeat a few times — it keeps cycling (no dead press).
5. Quit the game, return to the launcher: the installation's default is still "Duel", unchanged.
   Launch again — the game comes up on "Duel".
6. Unassign one of the two profiles: the control disappears, and the next save produces a loader
   with no alias chain and no `bind`.

## Done

**Summary.** Built the in-session profile-switch bind end to end, reusing story 006's
self-rewriting-alias mechanism generalized from a 2-way toggle to an n-way ring:

- D1 — `src/main/modules/config/switch-bind.ts` (+ `.test.ts`, new): pure
  `renderSwitchBindChain`/`renderSwitchBindChainLines`, generating `q2l_sw<n>` step aliases plus the
  `q2l_switch` indirection alias, each step re-applying `bind <key> q2l_switch` and echoing a
  sanitized/truncated profile name; `''` for fewer than 2 profiles or no usable key.
- D2 — `render.ts`/`render.test.ts`: `renderLoaderFile` gained an optional second argument that
  appends D1's chain after the loader's `exec` line; the no-argument call stays byte-identical.
- D3 — `src/shared/modules/config.ts` (`SetSwitchBindInput`, two new `CONFIG_HANDLERS` entries over
  the existing `module:invoke` envelope, no new IPC channel), `state.ts`/`schemas.ts`
  (`configSwitchBinds` persisted slice, same forgiving `.catch()` convention as `configPlayedMods`),
  `main/modules/config/schemas.ts` (`setSwitchBindInputSchema`, validated against the shared
  `NAMED_KEYS`/`normalizeBindKey` vocabulary), `write-plan.ts` (`assignedProfilesFor`, the pure
  per-installation/list-order filter that is also the on-disk half of AC5), `index.ts`
  (`writeProfileToAssignedInstallations` and `previewProfileFiles` both feed the switch bind into
  the loader render; new `switchBinds`/`setSwitchBind` handlers, the latter persists and immediately
  writes that one installation through the unchanged `writeInstallationFiles`).
- D4 — `SwitchBindControl.tsx` (new), wired into `InstallationProfilesPanel.tsx` (shown only for
  ≥2 assigned profiles), `client.ts` (`getSwitchBinds`/`setSwitchBind`), `en.json`
  (`config.switchBind.*`). Press-to-capture mirrors `OverviewKeyboardPanel`'s existing
  `resolveQuakeKeyName` listener pattern; F9 is pre-suggested when nothing is bound; a clear action
  is always available.

**Decisions made during implementation** (beyond the story file's own numbered decisions):

- D1's exports ended up as both a joined string (`renderSwitchBindChain`) and a line array
  (`renderSwitchBindChainLines`), since `render.ts` mixes both conventions across its own two
  functions; D2 uses whichever fits at its one call site.
- `WriteProfileDeps.switchBindFor` was made optional (defaulting to "no bind") rather than updating
  every pre-existing test call site in `index.test.ts` that built a `WriteProfileDeps` object before
  this story existed - smaller, less invasive diff for the same effect.
- `setSwitchBind`'s immediate write does **not** consult `isInstallationRunning`/defer via the
  `pendingWrites` map the way `writeProfileToAssignedInstallations` does: there is no
  pending-writes-shaped entry keyed for "a switch-bind change, not a profile save", and decision 12
  does not ask for one. A running installation simply keeps whatever chain it already loaded until
  its next launch - the same precedent AC3 already relies on for the default profile itself. Called
  out inline in `index.ts` for the next reader.
- `InstallationProfilesPanel.tsx` fetches `switchBinds` itself on mount (mirrors `WriteTargets.tsx`'s
  `getWriteState()` fetch) rather than lifting the map into `ConfigView.tsx`, since `ConfigView.tsx`
  has no existing per-installation, cross-profile state to piggyback on.

**Review finding, fixed:** the clean-agent review (default tier, per Model Hints) caught a real bug:
`setSwitchBindInputSchema`'s single-character branch accepted `;`, `"`, `$` and a bare space as a
"valid" key (they are printable ASCII), but `switch-bind.ts`'s own `sanitizeKeyName` strips exactly
those characters before rendering - so binding the physical `;` key, say, would have validated,
persisted, and reported a successful write while silently emitting **no chain and no bind at all**
on disk (AC1/AC4 violated without any visible error). Fixed in `schemas.ts` by excluding `"`, `$`,
`;` (and space, via tightening the range to exclude it) from the single-character branch, with a
doc comment explaining why; added 4 regression tests in `schemas.test.ts` (`it.each` over
`;`/`$`/`"`/space). Re-verified after the fix: 237/237 tests green (up from 233), typecheck and
build both clean.

**Verification:**
- `npm run build` — green (main/preload/renderer all build).
- `npm test` — 237/237 tests green across 14 files (was 233 before the review-fix regression tests).
- `npm run typecheck` (`typecheck:node` + `typecheck:web`) — clean.
- Code review (default tier, clean agent): one confirmed finding (above), fixed and re-verified; no
  other correctness bugs, no weakened tests, no scope creep, no CLAUDE.md guardrail violations
  (no new IPC channel, no renderer-supplied path trusted unvalidated, no image assets).
- **Live smoke NOT performed.** This session's sandbox cannot run `npm run dev` (Electron GUI
  crashes with "Cannot read properties of undefined (reading 'isPackaged')" - no real display/
  runtime available here), so the manual test plan above (press F9 in-game, watch the console echo,
  confirm the cycle and the unchanged default on relaunch) has not been driven through the real app.
  Per this sprint's live-smoke-required policy, status stays `in-progress` pending that manual pass.

**Commit message (prepared, not committed by this session):**
```
007: in-session profile-switch bind

Adds an n-way self-rewriting alias chain (generalizing story 006's toggle
pair) so a bindable key cycles an installation's assigned profiles in-game,
session-only and written through the existing backup-once/diff-skip pipeline.
```
