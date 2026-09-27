---
id: 168
title: my profile records every map on its own
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

Players want every map they play — or watch as a spectator — recorded as a demo without typing
`record` each time. Both engines can do it, but in different ways, and a player tip that circulates
(2026-09-27) shows how easy it is to get wrong. The config profile offers **one setting, "Record
every map automatically"**, and writes the engine's own way of doing it (verified in source,
concept `docs/concepts/demo-browser.md` §7):

| Engine | What the profile writes | Resulting file |
| --- | --- | --- |
| r1q2 | `set cl_autorecord 1` | `demos/2026-09-27-2130-q2dm1.dm2` |
| Q2PRO | `set cl_beginmapcmd "record ${cl_mapname}_${com_date}_${com_time}"` and `set com_time_format %H-%M-%S` | `demos/q2dm1_2026-09-27_21-30-00.dm2` |

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

- [ ] **AC1** — An r1q2 profile shows the setting; turning it on writes `set cl_autorecord 1` into
      the profile's config, turning it off removes it (or writes `0`, per the profile's baseline
      rules).
- [ ] **AC2** — A Q2PRO profile shows the same setting; turning it on writes the `cl_beginmapcmd`
      line with its quotes and `${…}` macros byte-for-byte as in the table above, plus
      `set com_time_format %H-%M-%S`.
- [ ] **AC3** — Reading a Q2PRO config that already contains exactly the recipe (as a player
      would have pasted it) shows the setting as on, and a render round-trip leaves the lines
      unchanged.
- [ ] **AC4** — A Q2PRO config whose `cl_beginmapcmd` holds something other than the recipe is
      handled as decided in Q1, and never loses the player's command without them seeing it.
- [ ] **AC5** — On an engine that has neither mechanism (vanilla), the setting stays visible,
      disabled, with the reason as visible text — an i18n key like every other label.
- [ ] **AC6** — The setting shows the engine-specific caveat (r1q2: same-minute overwrite;
      Q2PRO: console clock / `$com_time`) as visible text.
- [ ] **AC7** — The file name the setting produces on each engine matches [[139]]'s shipped
      pattern for that engine, and a test pins that link.

## Open Questions

- [ ] **Q1 — Existing `cl_beginmapcmd`** — append the `record …` with `;` and recognise it inside
      a compound command, or show the setting as "managed by you" (read-only, with the current
      value) and leave the cvar alone?
- [ ] **Q2 — Where it lives** — a row in the Settings tab (a new "Demos" group in the cvar
      catalog) or a composite setting outside the plain cvar rows, since on Q2PRO one switch
      writes two cvars?
- [ ] **Q3 — `com_time_format` when off** — remove our line on switch-off, or leave it, since it
      may since have been changed or relied on by the player?
- [ ] **Q4 — Compressed demos** — offer `record -z` (`.dm2.gz`, Q2PRO only) as an option, or keep
      v1 to plain `.dm2`? r1q2 cannot play `.gz` (concept §6.1).

## Plan

<!-- Filled by /refine 168, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by /refine 168. -->

## Model Hints

<!-- Filled by /refine 168. -->

## Acceptance Tests

<!-- Filled by /refine 168. -->

## Done

<!-- Filled by /build 168. -->
