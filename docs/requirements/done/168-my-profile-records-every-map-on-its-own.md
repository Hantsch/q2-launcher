---
id: 168
title: my profile records every map on its own
status: done # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

Players want every map they play — or watch as a spectator — recorded as a demo without typing
`record` each time. Both engines can do it, but in different ways, and a player tip that circulates
(2026-09-27) shows how easy it is to get wrong. The config profile offers **one setting, "Record
every map automatically"**, and writes the engine's own way of doing it (verified in source,
concept `docs/concepts/demo-browser.md` §7):

| Engine | What the profile writes                                                                                | Resulting file                        |
| ------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| r1q2   | `set cl_autorecord 1`                                                                                  | `demos/2026-09-27-2130-q2dm1.dm2`     |
| Q2PRO  | `set cl_beginmapcmd "record ${cl_mapname}_${com_date}_${com_time}"` and `set com_time_format %H-%M-%S` | `demos/q2dm1_2026-09-27_21-30-00.dm2` |

The Q2PRO line only works with its quotes intact and `$` untouched: Q2PRO does not expand macros
inside quotes, so the cvar keeps them and expands them at map entry. Unquoted, the map name would be
baked in (empty) when the config runs. `com_date_format` already defaults to `%Y-%m-%d`;
`com_time_format` defaults to minutes with a `.` (Windows) or `:` (Linux) — the colon is illegal in
Windows file names, so the setting fixes it to `%H-%M-%S`.

The file names are exactly the shipped patterns of [[139]], so demos this setting produces show
their date and map in the demo browser without any user template.

Known caveats, which the setting states rather than hides:

- r1q2 names to the minute and overwrites: rejoining the same map within one minute replaces the
  earlier demo.
- On Q2PRO, `com_time_format` also changes the console clock and any `$com_time` the player uses in
  their own binds.
- Q2PRO's `cl_beginmapcmd` is a single command string. A player who already uses it for something
  else must not lose that silently (Q1).

## Acceptance Criteria

- [x] **AC1** — An r1q2 profile shows the setting; turning it on writes `set cl_autorecord 1` into
      the profile's config, turning it off removes it (or writes `0`, per the profile's baseline
      rules).
- [x] **AC2** — A Q2PRO profile shows the same setting; turning it on writes the `cl_beginmapcmd`
      line with its quotes and `${…}` macros byte-for-byte as in the table above, plus
      `set com_time_format %H-%M-%S`.
- [x] **AC3** — Reading a Q2PRO config that already contains exactly the recipe (as a player
      would have pasted it) shows the setting as on, and a render round-trip leaves the lines
      unchanged.
- [x] **AC4** — A Q2PRO config whose `cl_beginmapcmd` holds something other than the recipe is
      handled as decided in Q1, and never loses the player's command without them seeing it.
- [x] **AC5** — On an engine that has neither mechanism (vanilla), the setting stays visible,
      disabled, with the reason as visible text — an i18n key like every other label.
- [x] **AC6** — The setting shows the engine-specific caveat (r1q2: same-minute overwrite;
      Q2PRO: console clock / `$com_time`) as visible text.
- [x] **AC7** — The file name the setting produces on each engine matches [[139]]'s shipped
      pattern for that engine, and a test pins that link.

## Open Questions

- [ ] ~~**Q1 — Existing `cl_beginmapcmd`** — append the `record …` with `;` and recognise it inside~~ answered → Decisions (Sprint)
      a compound command, or show the setting as "managed by you" (read-only, with the current
      value) and leave the cvar alone?
- [ ] ~~**Q2 — Where it lives** — a row in the Settings tab (a new "Demos" group in the cvar~~ answered → Decisions (Sprint)
      catalog) or a composite setting outside the plain cvar rows, since on Q2PRO one switch
      writes two cvars?
- [ ] ~~**Q3 — `com_time_format` when off** — remove our line on switch-off, or leave it, since it~~ answered → Decisions (Sprint)
      may since have been changed or relied on by the player?
- [ ] ~~**Q4 — Compressed demos** — offer `record -z` (`.dm2.gz`, Q2PRO only) as an option, or keep~~ answered → Decisions (Sprint)
      v1 to plain `.dm2`? r1q2 cannot play `.gz` (concept §6.1).

## Decisions (Sprint)

- **(User)** Existing cl_beginmapcmd: Append the record command with ";" and recognise it inside a compound command (removed cleanly on switch-off).
- **(User)** Where it lives: Composite setting in the Settings tab, outside the plain cvar rows (one switch writes both cvars on Q2PRO).
- **(User)** Compressed demos: Plain .dm2 only in v1; no record -z.
- Q3 `com_time_format` when off: switch-off deletes `com_time_format` only while its value is still
  exactly `%H-%M-%S`; any other value belongs to the player and stays. This restores the engine
  default when the value was ours, and never overwrites a choice the player made later.
- Which engine drives the switch: the Settings tab's existing engine scope (`EngineScopeSelect`,
  `lib/engine-scope.ts`). `ConfigProfile` has no engine field, and every row already resolves
  against that scope. Each engine's mechanism is read and written independently. A non-`ok` scope
  status (unassigned / unresolved / no facts) shows the switch disabled, with that reason as
  visible text, the same rule as AC5.
- r1q2 off deletes the `cl_autorecord` key, so the line disappears, rather than writing `0`. It is a
  non-catalogue cvar, and for those an absent key is the profile's baseline (AC1 allows either).
- The rendered form follows the renderer's house style (`set <name> "<value>"`, name-column
  aligned). `set cl_autorecord "1"` and `set com_time_format "%H-%M-%S"` are the same command to
  the engine. AC2's byte-for-byte clause is pinned on the `cl_beginmapcmd` value inside its quotes.
- "On" for Q2PRO means one `;`-separated segment of `cl_beginmapcmd` (trimmed, inner whitespace
  collapsed) equals `record ${cl_mapname}_${com_date}_${com_time}`. `com_time_format` is not part
  of the on-state; switching on (re)asserts it. Switching on is idempotent and never appends twice.
- The three cvars also keep showing as plain rows (non-catalogue, "Other" bucket). The player's own
  `cl_beginmapcmd` stays visible and editable, and that is how AC4's "without them seeing it" holds.
- The sprint's "playback through Q2PRO only" cut does not touch this story. Recording on r1q2 is
  not playback, so the r1q2 half stays in scope.

## Plan

Pure recipe logic goes in `src/shared/config/`, plus one composite control in the Settings tab and
one fixture profile with one `ui:flow`. There is no IPC change: the switch edits `profile.cvars`
through the tab's existing save path (`updateProfileCvars` → `ProfilesStore.setCvars`).

1. **D1 — `src/shared/config/autorecord.ts`** (pure, no node/DOM) holds the two recipes. Each one
   carries the [[139]] pattern id it produces (`r1q2-autorecord` and `q2pro-beginmapcmd` from
   `src/shared/replays/name-patterns.ts`). It also holds `readAutorecord(cvars, engine)` and
   `applyAutorecord(cvars, engine, on)`, which implement the rules under Decisions. Tests pin
   the rules, the [[139]] link (AC7) and the parse → render round-trip of a pasted recipe (AC2/AC3).
2. **D2 — the `AutorecordSetting` component**, placed in `SettingsTab.tsx` between the header
   toolbar and the section list. It is fed by the tab's `engine` scope and scope status, and it
   writes the whole next `cvars` map in one immediate save (the `persistSections` path, not the
   debounced one). It shows the engine-specific caveat and, when unavailable, the reason. All of
   these strings are i18n keys in `en.json`.
3. **D3 — the fixture profile "Autorecord Profile"** (r1q2 + q2pro assignments, with a seeded
   `cl_beginmapcmd "echo welcome"`), and the flow `scripts/flows/autorecord-setting.mjs`. The flow
   toggles the switch on both engines through the real UI and reads the written config from
   disk. D3 also adds the CHANGELOG entry.

Order: D1 → D2 → D3. The main risk: D2 must not clobber a pending debounced plain-row edit when it
saves.

## Deliverables

- **D1 — autorecord recipes as pure shared logic.** New `src/shared/config/autorecord.ts` (pure: no
  node, DOM or electron imports; mirror the style of `src/shared/config/cvar-defaults.ts`) and
  `src/shared/config/autorecord.test.ts`, plus one added case in
  `src/main/modules/config/round-trip.test.ts`.
  - Export `AUTORECORD_RECIPES` for `r1q2` and `q2pro`. Each has a `patternId` that references an
    id in `SHIPPED_NAME_PATTERNS` (`src/shared/replays/name-patterns.ts`: `r1q2-autorecord`,
    `q2pro-beginmapcmd`). The Q2PRO command constant is
    `record ${cl_mapname}_${com_date}_${com_time}`, with literal `$`, `{` and `}` (a plain string,
    not a template literal). The time format is `%H-%M-%S`.
  - `readAutorecord(cvars: Record<string,string>, engine: EngineKind | null)` returns
    `{ kind: 'unavailable' }` for anything but `r1q2`/`q2pro`, and otherwise
    `{ kind: 'available', engine, on }`.
    - r1q2: on iff `cvars.cl_autorecord` trims to a non-zero number.
    - Q2PRO: on iff some `;`-separated segment of `cvars.cl_beginmapcmd`, trimmed and with inner
      whitespace collapsed to one space, equals the command constant. `com_time_format` does not
      affect the state.
  - `applyAutorecord(cvars, engine, on)` returns a NEW map and never mutates the input. The map is
    unchanged for unavailable engines. Other keys are never touched.
    - r1q2 on → `cl_autorecord: '1'`. Off → the key is deleted.
    - Q2PRO on, when not already on → the value becomes the command alone if the key is absent or
      blank, and otherwise `<existing trimmed, trailing ';' dropped>; <command>`. It always sets
      `com_time_format: '%H-%M-%S'`.
    - Q2PRO off → remove every matching segment and rejoin the rest with `; `. Delete the key when
      nothing remains. Delete `com_time_format` only when its value is exactly `%H-%M-%S`.
  - Tests in `autorecord.test.ts`, named for the ACs:
    - "r1q2 on writes cl_autorecord 1 and off removes it"
    - "q2pro on writes the cl_beginmapcmd recipe and com_time_format byte-for-byte"
    - "a recipe pasted exactly as players share it reads as on"
    - "a foreign cl_beginmapcmd is kept: on appends with ';' and off restores it"
    - "switching on twice appends once"
    - "com_time_format is removed on off only while it is still ours"
    - "vanilla and unknown engines are unavailable"
    - "each engine's recipe produces a name its 139 pattern parses". This one asserts that each
      `patternId` exists in `SHIPPED_NAME_PATTERNS`. It builds the Q2PRO name by substituting
      `${cl_mapname}`→`q2dm1`, `${com_date}`→ the date in Q2PRO's default `%Y-%m-%d` and
      `${com_time}`→ the time in the recipe's `%H-%M-%S`, plus `.dm2`. It builds the r1q2 name
      from r1q2's own `%Y-%m-%d-%H%M-<map>.dm2` format. For both, it asserts that `parseDemoName`
      returns `matched` with that `patternId`, map `q2dm1` and the date.
  - In `round-trip.test.ts`, add the case "a pasted q2pro autorecord recipe survives parse and
    render". Mirror the existing fixed-point cases in that file.
    - Input: the three lines exactly as in the story table:
      `set cl_beginmapcmd "record ${cl_mapname}_${com_date}_${com_time}"`,
      `set com_date_format %Y-%m-%d` and `set com_time_format %H-%M-%S`.
    - They parse into cvars that `readAutorecord(…, 'q2pro')` reports as on.
    - The rendered file contains the `cl_beginmapcmd` value inside double quotes, byte-for-byte.
    - Re-parse + re-render is a fixed point.
  - Acceptance: `npx vitest run src/shared/config/autorecord.test.ts src/main/modules/config/round-trip.test.ts`
    is green, and `npm run typecheck` is green.

- **D2 — the "Record every map automatically" switch in the Settings tab.** New
  `src/renderer/src/modules/config/components/AutorecordSetting.tsx` and
  `AutorecordSetting.test.tsx` (React Testing Library; mirror an existing component test under
  `src/renderer/src/modules/config/`). It edits `src/renderer/src/modules/config/SettingsTab.tsx`
  and `src/renderer/src/i18n/locales/en.json`.
  - Props: `cvars`, `engine: EngineKind | null`, the engine-scope status
    (`EngineScopeStatus` from `lib/engine-scope.ts`) and `onChange(nextCvars)`. The component uses
    `readAutorecord`/`applyAutorecord` from `src/shared/config/autorecord.ts`. These are D1's pure
    functions: `applyAutorecord(cvars, engine, on)` returns the next map, and `readAutorecord`
    returns `{kind:'unavailable'}` or `{kind:'available', engine, on}`. No recipe strings go in
    the renderer.
  - It renders a labelled `Switch` from `src/renderer/src/components/ui/controls`, the same way the
    header's `writeCatalogDefaults` switch does (`SettingsTab.tsx` ~852), with testid
    `config-autorecord-switch`. It also renders a one-line description and the caveat as visible
    text (testid `config-autorecord-caveat`):
    - r1q2: rejoining the same map within one minute overwrites the earlier demo.
    - Q2PRO: it also changes the console clock and any `$com_time` in your own binds. The Q2PRO
      caveat also says the command is added to any existing `cl_beginmapcmd`.
  - Unavailable (`kind:'unavailable'`, or a scope status that is not `ok`): the switch stays
    rendered and `disabled`, with the reason as visible text (testid `config-autorecord-reason`),
    never only as a tooltip.
    - Vanilla or another engine: "Not available on {{engine}}: it has no way to record every map
      automatically." Reuse `engineLabel`, as `CvarRow.tsx` ~295 does for
      `config.cvar.notOnEngine`.
    - No engine in scope: a reason saying that the profile has no r1q2 or Q2PRO installation
      assigned.
  - All strings are new keys under `config.settings.autorecord.*` in `en.json`. Run
    `src/renderer/src/i18n/vocabulary.test.ts`.
  - Wiring in `SettingsTab.tsx`:
    - Place the control above the section list, below the header toolbar.
    - On toggle, compute `applyAutorecord(<current draft cvars, including any pending debounced
plain-row edit>, engine, on)`. Save the result through the same immediate, non-debounced
      path that `persistSections` uses (SettingsTab.tsx ~330), so both Q2PRO cvars change in one
      save. A pending debounced edit must not be lost, and must not later overwrite the switch's
      result.
    - No IPC or shared contract change.
    - Do not touch the header geometry: the control lives in the tab body, not the shared header,
      and `scripts/flows/config-header-geometry.mjs` must still pass.
  - Tests in `AutorecordSetting.test.tsx`:
    - "vanilla shows the switch disabled with its reason as visible text"
    - "no engine in scope shows the switch disabled with its reason"
    - "r1q2 shows the same-minute overwrite caveat"
    - "q2pro shows the console clock caveat"
    - "toggling calls onChange with applyAutorecord's map"
  - Acceptance: those tests and `vocabulary.test.ts` are green; `npm run typecheck` and
    `npm run ui:flow -- config-header-geometry` are green.

- **D3 — fixture profile, real-UI flow and changelog.** Edits `scripts/lib/fixture.mjs` and adds a
  new `scripts/flows/autorecord-setting.mjs`. Mirror `scripts/flows/settings-section-rename-add-cvar.mjs`
  for navigation and `scripts/flows/raw-save-cascades.mjs` for reading the written `.cfg` from disk
  with `readFileSync`. Also edits `CHANGELOG.md` (Keep-a-Changelog `### Added` under the current
  version).
  - Fixture: a new profile "Autorecord Profile", assigned to one existing r1q2 fixture installation
    and one existing healthy Q2PRO fixture installation (e.g. `INSTALL_ENGINE_UPDATE_ID`, not
    `INSTALL_FAILED_ID`), with `cvars: { cl_beginmapcmd: 'echo welcome' }`. Keep it off the
    profiles other flows select by name. After the change, run `npm run ui:flows` for regressions;
    flows that count profiles or assignments are the likely ones to need adjusting.
  - Flow `autorecord-setting`. It uses the Settings tab controls `config-autorecord-switch`,
    `config-autorecord-caveat` and `config-autorecord-reason`, and picks the engine through the
    tab's `EngineScopeSelect`. Steps:
    1. Open Config › Autorecord Profile › Settings.
    2. Scope r1q2 and assert the same-minute caveat is visible. Switch on: the profile's written
       config contains a `set cl_autorecord` line with value `"1"`. Switch off: there is no
       `cl_autorecord` line.
    3. Scope Q2PRO and assert the console-clock caveat is visible. Switch on: the config contains
       `set cl_beginmapcmd` with value
       `"echo welcome; record ${cl_mapname}_${com_date}_${com_time}"` and `set com_time_format`
       with `"%H-%M-%S"`. Switch off: `cl_beginmapcmd` is `"echo welcome"` again and there is no
       `com_time_format` line.
    4. Screenshot each state.
    5. Keep the flow idempotent across runs: start by switching off if a previous run left the
       switch on.
  - CHANGELOG: one short user-facing line for the new setting.
  - Acceptance: `npm run ui:flow -- autorecord-setting` is green, and `npm run ui:flows` is green.

## Model Hints

- D1, D2, D3 → default.
- Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/autorecord-setting.mjs` › "autorecord-setting" (r1q2 on/off on disk);
  unit `src/shared/config/autorecord.test.ts` › "r1q2 on writes cl_autorecord 1 and off removes it"
- AC2 → e2e `scripts/flows/autorecord-setting.mjs` › "autorecord-setting" (Q2PRO on, value on
  disk); unit `src/shared/config/autorecord.test.ts` › "q2pro on writes the cl_beginmapcmd recipe
  and com_time_format byte-for-byte"
- AC3 → unit `src/main/modules/config/round-trip.test.ts` › "a pasted q2pro autorecord recipe
  survives parse and render"; unit `src/shared/config/autorecord.test.ts` › "a recipe pasted
  exactly as players share it reads as on"
- AC4 → e2e `scripts/flows/autorecord-setting.mjs` › "autorecord-setting" (the seeded
  `echo welcome` is kept when switching on and restored when switching off); unit
  `src/shared/config/autorecord.test.ts` › "a foreign cl_beginmapcmd is kept: on appends with ';'
  and off restores it"
- AC5 → component `src/renderer/src/modules/config/components/AutorecordSetting.test.tsx` ›
  "vanilla shows the switch disabled with its reason as visible text", and › "no engine in scope
  shows the switch disabled with its reason". This is a display state, not a user action. The
  fixture has no vanilla installation to scope to, and adding one would shift every
  library-counting flow for a state the component test sees fully.
- AC6 → e2e `scripts/flows/autorecord-setting.mjs` › "autorecord-setting" (both caveats asserted
  visible); component `AutorecordSetting.test.tsx` › "r1q2 shows the same-minute overwrite
  caveat", "q2pro shows the console clock caveat"
- AC7 → unit `src/shared/config/autorecord.test.ts` › "each engine's recipe produces a name its
  139 pattern parses"

## Done

Added the "Record every map automatically" composite switch to the Settings tab: pure recipe logic in `src/shared/config/autorecord.ts` (r1q2 `cl_autorecord`, Q2PRO `cl_beginmapcmd` append/remove + `com_time_format`), the `AutorecordSetting` component with per-engine caveats and disabled-with-visible-reason states, fixture profile "Autorecord Profile", flow `autorecord-setting` and a CHANGELOG line. No IPC, contract or state-schema change (no version bump).

Commit message: `168: record every map automatically - autorecord setting (r1q2 cl_autorecord, Q2PRO cl_beginmapcmd), flow, fixture`

Verification (narrow gate): `npm run build`, `npm run typecheck` green; `npx vitest run --changed HEAD` green (104 files, 1027 tests); flows each after `ui:seed`, all OK: autorecord-setting, config-header-geometry, raw-save-cascades, settings-section-rename-add-cvar, controls-category-rename-reorder, drop-message-checkbox, demo-actions-bind, settings-downloads-section. Full gate pending (sprint's). Review 1 (default): PASS.
AC -> test: AC1/AC2/AC4/AC6 flow autorecord-setting + the named autorecord.test.ts cases; AC3 round-trip.test.ts + autorecord.test.ts; AC5/AC6 AutorecordSetting.test.tsx; AC7 autorecord.test.ts - all ran and passed. No manual residue.

Decisions:

- The switch edits the profile draft like every Settings row; the .cfg reaches disk on the header Save (the flow clicks Save after each toggle). "Immediate" means non-debounced (`persistSections`), not auto-saved.
- Fixture r1q2 assignment is `INSTALL_DEMO_UPGRADE_ID` (INSTALL_ONE/TWO resolve to engine unknown at runtime); Q2PRO is `INSTALL_ENGINE_UPDATE_ID`.
- `Switch` in `controls.tsx` gained an optional `testId` prop (needed for the testid).
- Component test uses react-dom `act` mounting (no RTL in this module tree).
- Unfixed review notes: no component test for r1q2 with non-ok scope status (path shared with the untested-by-name no-engine branch); one prettier import reflow in SettingsTab.tsx; pre-existing `persistSections` in-flight edit race, not from this story.

tiers: D 3 / hard 0 · review default · cycles 0 · agents 5
