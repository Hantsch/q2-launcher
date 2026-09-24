---
id: 123
title: the rules a server plays by, in full
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

[[122]] opens the detail view and shows who is playing; this story fills in what they are playing
by. A server's `status` reply carries its entire serverinfo string — every `CVAR_SERVERINFO` cvar
the running mod happens to expose (concept §6.2) — and that set is open-ended: baseq2 reports a
fairly small, well-known set, but any mod can and does add its own (`actionversion`, `matchmode`,
`roundlimit`, …). GB-D2 is unambiguous about the consequence: every key the server actually reported
is shown somewhere, not just the ones this launcher happens to recognise — recognised keys get a
readable label and formatting (concept §6.2's table: `hostname`, `mapname`, `gamename`/`gamedir`/
`game`, `maxclients`, `protocol`, `version`, `port`, `needpass`, `deathmatch`/`coop`/`ctf`/
`teamplay`, `dmflags`, `fraglimit`/`timelimit`/`capturelimit`, `cheats`, `maptime`/`uptime`,
`gamedate`), and everything else is listed raw underneath rather than silently dropped, so a
mod-specific rule is never lost just because this launcher does not know its name.

`dmflags` is the one key in that set that is actively hostile to read raw — it is a bitfield, and a
number like `16711680` tells a user nothing. GB-D3 decodes it into a named list of the rules it
actually switches (no falling damage, no health, instant weapon switch, and so on — concept §4's
tech-decisions table calls this "a table in the launcher"). But the bit meanings are the *vanilla*
Quake II meanings, and a mod is free to reuse a bit for something else entirely; the launcher has no
way to know if one has. The decoded list therefore carries a visible caveat saying exactly that, so a
decoded rule is read as "this is what dmflags means in vanilla Quake II", not as a guarantee about
what this particular mod is actually doing.

Renders inside the same detail view [[122]] opens ([[106]] supplies the module/container, [[108]]
the parsed protocol data this reads); GB-D6's per-field degradation discipline from [[122]] applies
here too — a malformed or unrecognised value in one key never breaks the rest of the table. Out of
scope: [[124]]'s ping history and local-context statements, and the actions row covered by
[[125]]/[[126]]/[[127]] in sprint 9.6.

## Acceptance Criteria

- [ ] **AC1** — Every serverinfo key the server actually reported in its `status` reply appears
      somewhere in the rule table; none are dropped.
- [ ] **AC2** — Each key from concept §6.2's known-key table (`hostname`, `mapname`,
      `gamename`/`gamedir`/`game`, `maxclients`, `protocol`, `version`, `port`, `needpass`,
      `deathmatch`/`coop`/`ctf`/`teamplay`, `dmflags`, `fraglimit`/`timelimit`/`capturelimit`,
      `cheats`, `maptime`/`uptime`, `gamedate`) that the server reported is shown with a readable
      label and formatting appropriate to its meaning, not as a raw key=value pair.
- [ ] **AC3** — Any reported key outside that known set is shown raw (its key and its value), not
      dropped and not silently merged into the known-key section.
- [ ] **AC4** — `dmflags` renders as a readable list of named rules (not a raw number), carrying a
      visible caveat stating it is the vanilla meaning and that mods may reuse bits.

## Open Questions

<!-- Leave empty. Filled during refine (`/refine <id>`) if the requirement is still
unclear. Must be resolved before status goes to `ready`. Inside a sprint these are put to the
user in the clarification round. -->

## Plan

<!-- Filled by `/refine 123`, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by `/refine 123`. -->

## Model Hints

<!-- Filled by `/refine 123`. -->

## Acceptance Tests

<!-- Filled by `/refine 123`. -->

## Done

<!-- Filled by `/build 123`. -->
