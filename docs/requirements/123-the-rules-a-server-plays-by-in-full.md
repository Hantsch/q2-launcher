---
id: 123
title: the rules a server plays by, in full
status: ready # draft -> ready -> in-progress -> done
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
scope: [[124]]'s ping history, and the actions row covered by [[125]]/[[126]]/[[127]]
(milestone 9.6).

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

## Decisions (Sprint)

- **Source of the table = the latest `status` reply's serverinfo map, verbatim.** An `info` reply
  never replaces or merges into it — AC1 is about what the `status` reply reported, and the `info`
  infostring carries non-serverinfo keys (`clients`) of its own.
- **The raw map is retained on `ServerListEntry.serverinfo?`** (main keeps it; it reaches the
  renderer in the normal scan snapshot) — today `mergeSuccessfulReply` reads five keys and throws
  the rest away, and the transient `scan.server` push is not something a detail view opened later
  can read. If [[122]] already added an equivalent field, D2 reuses it instead of adding a second.
- **Before any `status` reply exists the Rules section shows a stated empty state** ("no rule data
  yet") — GB-D6 degradation, never a blank area and never a table built from the `info` reply.
- **The table repeats known keys the header already shows** (hostname, mapname, …) — AC2 asks for
  every known key in the table, and "shown somewhere" is then checkable on the table alone.
- **Known keys match exactly (case-sensitive), like the engine's `Info_ValueForKey`**; `Hostname`
  is an unknown key and goes to the raw section.
- **A known key whose value its formatter cannot read** (e.g. `timelimit\abc`) keeps its label and
  shows the raw value verbatim with a visible "not understood" note — GB-D6: degraded, not dropped,
  not moved to the raw section, never throws.
- **Known rows follow concept §6.2's table order; raw rows are sorted by key (case-insensitive)** —
  a JS record does not keep wire order for integer-like keys, so sorted is the only stable order.
- **dmflags decodes the 16 baseq2 bits (`q_shared.h` `DF_*`, bits 0–15) and lists only set bits.**
  Any set bit above 15 is listed as "unknown bit N" rather than dropped (the story's `16711680`
  example is exactly such a value); `0` states "no rule switches set". The story's "instant weapon
  switch" example is not a vanilla dmflags bit — vanilla bit 4 is "instant items" — so the decoder
  follows `q_shared.h`, not the example. Rogue/Xatrix pack bits are not vanilla and stay "unknown".
- **The caveat is visible text directly above the decoded list**, one i18n key, shown whenever the
  decoded list is shown (also for `0`); the raw `dmflags` number stays visible next to it.
- **Values are server-controlled text rendered as plain React text** (no markup, no links), in the
  same text treatment [[118]]'s row uses for server names.
- **Gamemode flags reuse [[118]]'s `servers.gamemode.*` labels only for the derived mode; each flag
  key (`deathmatch`/`coop`/`ctf`/`teamplay`) is its own labelled on/off row** — AC2 asks for each
  key, not the derived mode (the header shows that).

## Plan

Build order 122 → **123** → 124; this story renders a Rules section into [[122]]'s detail view.

1. **Shared, pure (D1):** `src/shared/servers/dmflags.ts` (vanilla bit table + `decodeDmflags`) and
   `src/shared/servers/rule-table.ts` (`buildRuleTable(serverinfo)` → known rows with typed value
   descriptors, raw rows, dmflags decode). No i18n in shared — descriptors, not strings.
2. **Main (D2):** `ServerListEntry.serverinfo?` = the latest `status` reply's full map, kept across
   `info`-only replies and stale rounds.
3. **Renderer (D3):** `ServerRulesPanel.tsx` maps the model to labelled rows, a raw section, a
   dmflags section with caveat, and an empty state; mounted in 122's detail view; i18n under
   `servers.rules.*`; e2e flow `servers-detail-rules` against an inline UDP responder.

Affected: `src/shared/servers/{dmflags,rule-table}.ts(+tests)`, `src/shared/modules/servers.ts`,
`src/main/modules/servers/scan-service.ts(+test)`, `src/renderer/src/modules/servers/
ServerRulesPanel.tsx(+test)`, 122's detail view file, `src/renderer/src/i18n/locales/en.json`,
`scripts/flows/servers-detail-rules.mjs`, `CHANGELOG.md`.

## Deliverables

- **D1 — the rule-table model and dmflags decoder (shared, pure)** plus tests
  `src/shared/servers/dmflags.test.ts` and `src/shared/servers/rule-table.test.ts`. Files:
  `src/shared/servers/dmflags.ts`, `src/shared/servers/rule-table.ts`, the two tests. Mirror
  `src/shared/servers/infostring.ts` (reuse its `readIntKey`) and `row-markers.ts` from [[118]]. No
  node/DOM/electron imports.
  - `DMFLAG_BITS` — exactly this table (value → id): 1 `no-health`, 2 `no-items`, 4
    `weapons-stay`, 8 `no-falling`, 16 `instant-items`, 32 `same-level`, 64 `skin-teams`, 128
    `model-teams`, 256 `no-friendly-fire`, 512 `spawn-farthest`, 1024 `force-respawn`, 2048
    `no-armor`, 4096 `allow-exit`, 8192 `infinite-ammo`, 16384 `quad-drop`, 32768 `fixed-fov`.
  - `decodeDmflags(raw: string)` → `{ ok: true; value: number; rules: DmflagId[]; unknownBits:
    number[] }` (rules in bit order, `unknownBits` = set bit indices ≥ 16) or `{ ok: false; raw }`
    when `raw` is not a non-negative decimal integer ≤ 2^31−1 (trim whitespace; `"abc"`, `"-1"`,
    `"1.5"`, `""` are not ok). Use unsigned bit tests up to bit 30; never throws.
  - `buildRuleTable(serverinfo: Record<string,string>)` → `{ known: KnownRuleRow[]; raw: {key,
    value}[]; dmflags?: { raw: string; decoded: ReturnType<typeof decodeDmflags> } }`. Known keys,
    in this order, exact-case: `hostname`, `mapname`, `gamename`, `gamedir`, `game`, `maxclients`,
    `protocol`, `version`, `port`, `needpass`, `deathmatch`, `coop`, `ctf`, `teamplay`, `dmflags`,
    `fraglimit`, `timelimit`, `capturelimit`, `cheats`, `maptime`, `uptime`, `gamedate`. Each
    reported known key becomes one `KnownRuleRow { key; value: RuleValue }`; `dmflags` also fills
    `dmflags`. `RuleValue` is a union: `text` (hostname, mapname, gamename/gamedir/game, version,
    gamedate), `int` (maxclients, port), `protocol` (int + `engine: 'vanilla'|'r1q2'|'q2pro'|
    undefined` for 34/35/36), `needpass` (`password` = bit 0, `spectatorPassword` = bit 1), `flag`
    (deathmatch/coop/ctf/teamplay/cheats: int, 0 = off, non-zero = on), `limit` (fraglimit/
    capturelimit: int, 0 = none), `minutes` (timelimit: int or decimal, 0 = none), `duration`
    (maptime/uptime: non-negative integer = seconds; any other non-empty string = `text` verbatim,
    since mods report `mm:ss` strings), `dmflags` (the int), and `unparsed { raw }` whenever the
    key's parser rejects the value. Every other key goes to `raw`, sorted by key
    case-insensitively. Invariant: every input key appears exactly once across `known` ∪ `raw`.
  - Tests (names literal): dmflags.test.ts › "decodes each vanilla bit to its rule",
    "lists set bits above the vanilla table as unknown" (`16711680` → no rules, unknownBits
    16..23), "zero decodes to no rules", "rejects a non-integer value without throwing";
    rule-table.test.ts › "every reported key lands in exactly one section", "known keys get typed
    values in table order", "unknown keys are listed raw and sorted", "a malformed known value is
    unparsed, not dropped or moved", "an empty map yields an empty table".

- **D2 — main keeps the status reply's full serverinfo on the entry** plus its test in
  `src/main/modules/servers/scan-service.test.ts`. Files: `src/shared/modules/servers.ts`,
  `src/main/modules/servers/scan-service.ts`, `scan-service.test.ts`. (If story 122 already added a
  field carrying the latest status reply's raw serverinfo map to `ServerListEntry`, reuse it and
  only add the tests.)
  - Add `serverinfo?: Record<string, string>` to `ServerListEntry`, doc comment: "the latest
    `status` reply's full serverinfo map, verbatim; never taken from an `info` reply".
  - In `mergeSuccessfulReply` (`scan-service.ts`): `serverinfo: result.kind === 'status' ?
    { ...result.reply.serverinfo } : existing?.serverinfo`. Check that `mergeStaleRound`
    (`scan-merge.ts`) and every other place building an entry spreads `existing` so the field
    survives a stale round; fix any that rebuilds field by field.
  - Tests (names literal): "a status reply's full serverinfo is kept on the entry" (includes a
    mod key like `matchmode`), "an info-only reply keeps the previous status serverinfo" (info
    reply carries `clients`, which must not appear), "a stale round keeps the last serverinfo".

- **D3 — the Rules section in the detail view** plus its tests `src/renderer/src/modules/
  servers/ServerRulesPanel.test.tsx` and the e2e flow `scripts/flows/servers-detail-rules.mjs`.
  Files: `src/renderer/src/modules/servers/ServerRulesPanel.tsx`, its test, the detail view
  component story 122 created in `src/renderer/src/modules/servers/` (mount only),
  `src/renderer/src/i18n/locales/en.json` (the `servers` block at ~line 662), the flow,
  `CHANGELOG.md` (`### Added`). Read `/frontend-guidelines` and `/design-tokens` first; tokens
  only, no hex/palette classes, no images.
  - `ServerRulesPanel({ serverinfo }: { serverinfo: Record<string,string> | undefined })` calls
    `buildRuleTable` from `@shared/servers/rule-table`. `undefined` → heading plus stated empty
    state `servers.rules.empty` ("No rule data yet — the server has not answered a full status
    query."). Otherwise three sub-sections, each with a heading, `data-testid`s `rules-known`,
    `rules-raw`, `rules-dmflags`, one row per entry (`data-testid="rule-row"`, `data-key=<key>`):
    - **Known:** label `servers.rules.key.<key>` + formatted value: text verbatim; ints; protocol
      `34 (vanilla)` / `35 (r1q2)` / `36 (Q2PRO)` / bare number; needpass "Password: yes/no ·
      Spectator password: yes/no"; flag On/Off; limit "None" for 0; minutes "N min"/"None";
      duration `h:mm:ss`; dmflags the number (the decoded list is its own section); `unparsed` →
      raw value verbatim plus visible `servers.rules.unparsed` ("not understood") text.
    - **Raw ("Other keys reported by the server"):** key and value as-is, monospace; empty value
      shown as `servers.rules.emptyValue`. Section omitted only when there are no raw keys.
    - **dmflags** (only when `dmflags` was reported): visible caveat `servers.rules.dmflags.caveat`
      ("Vanilla Quake II meaning — mods may reuse these bits for other rules.") directly above a
      list of `servers.rules.dmflags.rule.<id>` names, then `servers.rules.dmflags.unknownBit`
      ("Unknown bit {{bit}}") per unknown bit; `0` → `servers.rules.dmflags.none`; not ok →
      raw value + `servers.rules.unparsed`. English rule names include at least `no-falling` →
      "No falling damage", `no-friendly-fire` → "No friendly fire", `instant-items` → "Instant
      items" (the flow asserts the first two literally); every `DmflagId` gets a name.
    - Values rendered as plain text nodes. The component never throws on any map.
  - Mount it in 122's detail view below the players panel, passing the selected entry's
    `serverinfo`.
  - Unit tests (names literal): "renders every reported key as a row", "shows the dmflags caveat
    with the decoded rules", "a malformed value degrades on its own row", "states an empty state
    without status data".
  - E2e flow `servers-detail-rules` (mirror `scripts/flows/servers-scoped-refresh.mjs`: inline
    `dgram` responder, never import `src/`; manual server via `scripts/lib/fixture.mjs`). The
    responder's `status` reply serverinfo: `hostname`, `mapname\q2dm1`, `gamename\baseq2`,
    `maxclients\16`, `protocol\34`, `deathmatch\1`, `dmflags\65800` (8+256+65536),
    `timelimit\abc`, `fraglimit\20`, `matchmode\1`, `actionversion\2.1`; the `info` reply must not
    carry `matchmode`. Scan, open the row (122's trigger), then assert: rows exist for all 11 keys
    (`data-key`), `matchmode`/`actionversion` sit inside `rules-raw`, `fraglimit`'s row reads "20"
    under its label, `timelimit`'s row shows "abc" + the not-understood text while the other rows
    still render, `rules-dmflags` shows the caveat text, "No falling damage", "No friendly fire"
    and "Unknown bit 16"; screenshot the section.

## Model Hints

- D1, D2, D3 → default (all bounded; the bit table and key order are pinned in the D text, so
  the reviewer checks against the spec, not the implementer's own table).
- Review: → default — the plausible wrong implementations (a self-invented bit table, a table
  fed by the `info` reply) are both caught by pinned values in D1's tests and by the flow's
  status-only `matchmode` key.

## Acceptance Tests

- AC1 → unit `src/shared/servers/rule-table.test.ts` › "every reported key lands in exactly one
  section" (D1); unit `src/main/modules/servers/scan-service.test.ts` › "a status reply's full
  serverinfo is kept on the entry" + "an info-only reply keeps the previous status serverinfo"
  (D2); e2e `scripts/flows/servers-detail-rules.mjs` › flow "servers-detail-rules" (all 11
  reported keys have a row, D3).
- AC2 → unit `src/shared/servers/rule-table.test.ts` › "known keys get typed values in table
  order" (D1); unit `src/renderer/src/modules/servers/ServerRulesPanel.test.tsx` › "renders every
  reported key as a row" (D3); e2e `scripts/flows/servers-detail-rules.mjs` › flow
  "servers-detail-rules" (`fraglimit` labelled "20", D3).
- AC3 → unit `src/shared/servers/rule-table.test.ts` › "unknown keys are listed raw and sorted"
  (D1); e2e `scripts/flows/servers-detail-rules.mjs` › flow "servers-detail-rules"
  (`matchmode`/`actionversion` inside `rules-raw`, D3).
- AC4 → unit `src/shared/servers/dmflags.test.ts` › "decodes each vanilla bit to its rule" +
  "lists set bits above the vanilla table as unknown" (D1); unit
  `src/renderer/src/modules/servers/ServerRulesPanel.test.tsx` › "shows the dmflags caveat with
  the decoded rules" (D3); e2e `scripts/flows/servers-detail-rules.mjs` › flow
  "servers-detail-rules" (caveat + "No falling damage" + "No friendly fire" + "Unknown bit 16", D3).
- GB-D6 floor (from [[122]], not a criterion here): unit `rule-table.test.ts` › "a malformed known
  value is unparsed, not dropped or moved", `ServerRulesPanel.test.tsx` › "a malformed value
  degrades on its own row", flow `servers-detail-rules` (`timelimit\abc`).

## Done

<!-- Filled by `/build 123`. -->
