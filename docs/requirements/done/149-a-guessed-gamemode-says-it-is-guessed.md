---
id: 149
title: a guessed gamemode says it is guessed
status: done # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

Filtering by "duel" or "CTF" is one of the main reasons to have a demo library — but the demo
content carries no `deathmatch`/`dmflags` (concept `docs/concepts/demo-browser.md` §6.3). So the
gamemode comes from the sidecar, from a file-name pattern, or from a **mod heuristic** — e.g. game
dir `ctf` → CTF, an OpenTDM pattern hit → TDM, exactly two players → duel. A heuristic value is a
guess, and the user sees it as one (§8.3, DEMO-13).

Order for the gamemode: **sidecar → file-name pattern → heuristic → unknown**. The heuristic table is
concept open point §17.5 and is fixed in this story.

## Acceptance Criteria

- [x] **AC1** — The gamemode resolver applies sidecar → pattern → heuristic → unknown, as pure code
      with a unit test per rung.
- [x] **AC2** — The heuristic table decided in Q1 is implemented and documented in the concept
      (§17.5 resolved), each rule with a unit test.
- [x] **AC3** — A heuristic gamemode is shown as **guessed** — as visible text, distinct from a
      sidecar or pattern value — in the row ([[150]]) and the detail view ([[155]]).
- [x] **AC4** — A demo no rule matches shows "unknown" gamemode, not an empty cell.
- [x] **AC5** — The gamemode filter ([[153]]) treats guessed and known values the same unless Q2
      decides otherwise.

## Open Questions

- [x] ~~**Q1 — Heuristic table** (§17.5): which game dirs, pattern hits and player counts map to
      which mode, and in which order the rules are tried.~~ answered → Decisions (Sprint)
- [x] ~~**Q2 — Filtering guesses** — should the filter be able to exclude guessed gamemodes?~~
      decided → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Heuristic scope: the concept's sketch (game dir e.g. `ctf` → CTF, an OpenTDM
  pattern hit → TDM, exactly two players → duel) is sufficient scope for v1. Refine expands it
  mechanically to cover other known mod dirs from [[139]]'s shipped patterns, but does not
  invent new heuristic categories beyond that sketch.
- **Heuristic table, in this order (first match wins):** (1) game dir `ctf` → `ctf`; (2) exactly
  two players → `duel`; (3) [[139]]'s OpenTDM pattern matched, or game dir `opentdm` → `tdm`. Game
  dirs compare case-insensitively. Reason: CTF is fixed by the mod itself and outranks player count,
  while OpenTDM also runs 1v1, so two players must be tried before the OpenTDM → TDM rule.
- **Mechanical expansion stops at `opentdm`:** of [[139]]'s shipped origins only OpenTDM implies a
  mode; r1q2/Q2PRO patterns carry no mod, and AQ2-TNG (`action`) runs DM, teamplay, CTF and tourney
  under one dir, so mapping it would invent a heuristic the user excluded.
- **Vocabulary:** heuristic values are the ids `ctf` / `tdm` / `duel` (labels "CTF" / "TDM" /
  "Duel"); sidecar and pattern values are free text, trimmed, and normalised to a known id when they
  match one case-insensitively — so the filter dropdown never lists "CTF" and "ctf" separately.
- **Pattern rung** reads an optional `gamemode` on [[139]]'s name facts (added as an optional field
  if 139's type lacks it); no shipped pattern fills it, the rung exists for [[140]] templates —
  AC1 requires the rung, and inventing a gamemode token here would pre-empt 139/140's syntax.
- **Player count** for the duel rule is the effective players/sides count from [[148]]'s resolver;
  no count known → the rule does not fire. Reason: one player list, one precedence, no second truth.
- **Sources:** the result is `{ value, source }` with source `sidecar` / `name` / `guessed` /
  `none`; `none` means unknown and renders as the visible text "unknown" (AC4). Reason: aligns with
  [[148]]'s source vocabulary (AC5 there already names "guessed").
- **Q2 — yes, guesses can be excluded:** the gamemode filter matches guessed and known values of the
  same mode alike by default (AC5); an opt-in "exclude guessed" flag drops every guessed row, also
  under "any gamemode". Unknown rows match only "any". This story ships the pure predicate +
  option derivation; [[153]] wires the toggle. Reason: AC3 already surfaces guessed-ness, so the
  filter distinction costs one boolean and lets a user trust a "duel" list.
- **AC3 surface split:** this story ships the guessed marker as data, a pure describer and the i18n
  strings; rendering it in the row and detail view is [[150]] AC2 / [[155]] (S27), per the sprint
  note that higher `[[NNN]]` ids are "used later" mentions. Reason: S26 is the data layer and has
  no row or detail view to render into.
- **No CHANGELOG entry** — nothing user-visible changes until [[150]] renders it.

## Plan

1. **Pure module** `src/shared/demos/gamemode.ts` (D1): types, the ordered heuristic table as data,
   `resolveGamemode`, `describeGamemode`, `gamemodeFilterMatches`, `gamemodeFilterOptions`; unit
   test per rung, per heuristic rule, per filter case. Same commit: concept §8.3/§17.5 updated.
2. **Wire + strings** (D2): [[148]]'s effective-value resolver takes its gamemode field from
   `resolveGamemode` (instead of plain precedence); `replays.gamemode.*` keys in `en.json` with a
   key-existence test.

Order: D1 → D2. No IPC, no main, no renderer component changes.

## Deliverables

- **D1 — gamemode resolver, heuristic table, filter predicate (pure shared code) + tests.**
  Files: `src/shared/demos/gamemode.ts` (new), `src/shared/demos/gamemode.test.ts` (new),
  `docs/concepts/demo-browser.md` (§8.3, §17.5). Mirror: `src/shared/servers/row-markers.ts`
  (`deriveGamemode`: pure, never throws, unknown stays unknown) and
  `src/shared/servers/list-filter.ts` for the filter shape. `src/shared` rule: no `node:*`, no DOM,
  no electron.
  - `export type KnownGamemode = 'ctf' | 'tdm' | 'duel'`;
    `export type GamemodeSource = 'sidecar' | 'name' | 'guessed' | 'none'`;
    `export interface EffectiveGamemode { value: string | null; source: GamemodeSource }`
    (`value` is a `KnownGamemode` id or free text; `null` only with `source: 'none'`).
  - `resolveGamemode(input: { sidecar?: string; nameFact?: string; gameDir?: string;
    matchedPatternId?: string; playerCount?: number }): EffectiveGamemode` — rungs in order:
    sidecar (trimmed, non-empty) → `nameFact` (trimmed, non-empty) → heuristic → `{ value: null,
    source: 'none' }`. Sidecar/name values equal to a known id case-insensitively are normalised
    to the id. Use the OpenTDM pattern id exported by story 139's engine in `src/shared/demos/`
    (grep for it; do not hard-code a second copy of the string).
  - Heuristic table as an exported ordered array `GAMEMODE_HEURISTICS` of `{ id, mode, test }`,
    first match wins: (1) `gameDir` = `ctf` (case-insensitive) → `ctf`; (2) `playerCount === 2` →
    `duel`; (3) `matchedPatternId` is the OpenTDM pattern, or `gameDir` = `opentdm` → `tdm`.
    Result source is `'guessed'`.
  - `describeGamemode(g): { labelKey?: string; text?: string; guessedKey?: string }` — known id →
    `labelKey: 'replays.gamemode.<id>'`; free text → `text`; `none` → `labelKey:
    'replays.gamemode.unknown'`; `guessedKey: 'replays.gamemode.guessed'` only when source is
    `guessed`. Export `GAMEMODE_I18N_KEYS` (all five keys) for D2's key test.
  - `gamemodeFilterMatches(g, filter: { gamemode: string | null; excludeGuessed: boolean })` —
    `gamemode: null` = any; otherwise value must equal it (case-insensitive); `excludeGuessed`
    rejects every `guessed` row; `none` matches only `gamemode: null` (and is never excluded as
    guessed). `gamemodeFilterOptions(gs: EffectiveGamemode[]): string[]` — distinct non-null
    values, guessed and known merged, sorted.
  - Tests (`gamemode.test.ts`): one per rung (sidecar wins over name + heuristic; name wins over
    heuristic; heuristic; unknown); blank sidecar falls through; normalisation `"CTF"` → `ctf`; one
    per heuristic rule plus the two ordering cases (`ctf` dir with 2 players → `ctf`; OpenTDM with 2
    players → `duel`); `Action` / `baseq2` dir with 4 players → unknown; describer cases; filter:
    guessed `duel` matches a `duel` filter by default, is dropped with `excludeGuessed`, unknown
    only under "any", options merge guessed and known.
  - Concept: §8.3 names the table and order; §17.5 marked resolved with the table, the
    `action` exclusion reason and the exclude-guessed filter decision.

- **D2 — wire into the effective-value resolver + i18n strings.**
  Files: story 148's effective-value resolver in `src/shared/demos/` and its test (find it by grep
  for the per-field precedence resolver 148 added), `src/renderer/src/i18n/locales/en.json`,
  `src/renderer/src/i18n/gamemode-keys.test.ts` (new; mirror `vocabulary.test.ts`'s `stringAt`).
  - The resolver's gamemode field calls `resolveGamemode` from `src/shared/demos/gamemode.ts` with
    sidecar gamemode, name-fact gamemode, the effective game dir/mod, the matched pattern id from
    the name facts and the effective players/sides count; its result (value + `GamemodeSource`)
    replaces the plain precedence for that field. If 148's source union lacks `'guessed'`/`'none'`,
    add them there rather than keeping a parallel type. Its existing per-field tests stay green;
    add one test: a demo in game dir `ctf` with no sidecar/name gamemode resolves to `ctf` /
    `guessed`.
  - `en.json`, under the existing top-level `replays` block: `replays.gamemode.ctf` "CTF",
    `.tdm` "TDM", `.duel` "Duel", `.unknown` "unknown", `.guessed` "guessed".
  - `gamemode-keys.test.ts`: every key in `GAMEMODE_I18N_KEYS` resolves to a non-empty string.

## Model Hints

- D1 → default. D2 → default.
- Review: → default (a pure table with a test per rule and per rung; no wrong-but-green shape a
  default review would miss).

## Acceptance Tests

- AC1 → unit `src/shared/demos/gamemode.test.ts` › "sidecar wins over name fact and heuristic",
  "name fact wins over heuristic", "heuristic applies when sidecar and name are empty", "no rung
  yields unknown"; integration in `<148 resolver test>` › "a ctf game dir resolves to a guessed
  ctf gamemode" (D2).
- AC2 → unit `src/shared/demos/gamemode.test.ts` › "ctf game dir guesses ctf", "exactly two
  players guesses duel", "OpenTDM pattern or opentdm dir guesses tdm", "ctf dir outranks two
  players", "two players outrank OpenTDM", "action dir alone guesses nothing"; concept §17.5
  resolved (D1, checked in review).
- AC3 → unit `src/shared/demos/gamemode.test.ts` › "a guessed value carries the guessed marker",
  "sidecar and name values carry no guessed marker"; unit
  `src/renderer/src/i18n/gamemode-keys.test.ts` › "every gamemode key has visible text". The
  row/detail rendering is proven by [[150]] AC2 and [[155]]'s e2e flows in S27 (no row/detail
  surface exists in S26) — a named hand-off, not a manual residue.
- AC4 → unit `src/shared/demos/gamemode.test.ts` › "unknown describes as the unknown label, never
  empty"; `gamemode-keys.test.ts` covers `replays.gamemode.unknown`.
- AC5 → unit `src/shared/demos/gamemode.test.ts` › "a guessed duel matches the duel filter by
  default", "excludeGuessed drops guessed rows", "unknown matches only any", "filter options merge
  guessed and known values". UI wiring of the toggle is [[153]]'s.

## Done

Implemented the gamemode resolver as pure shared code: `src/shared/demos/gamemode.ts`
(`resolveGamemode`, the ordered `GAMEMODE_HEURISTICS` table, `describeGamemode`,
`gamemodeFilterMatches`/`gamemodeFilterOptions`, `GAMEMODE_I18N_KEYS`), wired into 148's
`resolveEffectiveValues` gamemode field, plus the five `replays.gamemode.*` i18n strings.
Concept `docs/concepts/demo-browser.md` §17 open point 5 resolved with the table.

Commit message: `149: a guessed gamemode says it is guessed`

Verification (narrow gate): `npm run build` green, `npm run typecheck` green, `npx vitest run
--changed HEAD` green (95 files/772 tests), plus the cross-story regression sweep
`src/main/modules/replays src/shared/modules/replays.test.ts src/shared/demos
src/shared/replays` green (27 files/315 tests) per the sprint deviation. No e2e-story flow
applies — this story has no UI/IPC surface (pure `src/shared` + i18n only).

AC → test mapping, all passed: AC1 → `gamemode.test.ts` › "sidecar wins over name fact and
heuristic", "name fact wins over heuristic", "heuristic applies when sidecar and name are
empty", "no rung yields unknown"; `effective-values.test.ts` › ctf-game-dir-guesses test.
AC2 → `gamemode.test.ts` › "ctf game dir guesses ctf", "exactly two players guesses duel",
"OpenTDM pattern or opentdm dir guesses tdm", "ctf dir outranks two players", "two players
outrank OpenTDM", "action dir alone guesses nothing"; concept §17.5 resolved. AC3 →
`gamemode.test.ts` › "a guessed value carries the guessed marker", "sidecar and name values
carry no guessed marker"; `gamemode-keys.test.ts` › "every gamemode key has visible text" —
row/detail rendering itself is a named hand-off to [[150]]/[[155]] (S27), not built here, per
the story's own AC3 surface-split decision. AC4 → `gamemode.test.ts` › unknown-label test;
`gamemode-keys.test.ts` covers `replays.gamemode.unknown`. AC5 → `gamemode.test.ts` › "a
guessed duel matches the duel filter by default", "excludeGuessed drops guessed rows",
"unknown matches only any", "filter options merge guessed and known values".

Review: clean-agent review 1 → PASS, no blocking findings. Two non-blocking notes: (1)
`effective-values.ts` casts `gamemodeResult.value as string` relying on `resolveGamemode`'s
unenforced value/source pairing invariant (true by inspection, not statically proven); (2)
`en.json`'s `unknown`/`guessed` strings are lowercase while some other `Unknown` strings
elsewhere are capitalised — this matches the story's own spec text verbatim, so left as-is.
No fix cycle needed.

Decisions (implementation detail, not in story spec): `ResolveEffectiveValuesInputs` gained
an optional `matchedPatternId?: string` field (the id `parseDemoName` reports), consumed only
by the gamemode rung; `NameFacts` gained an optional `gamemode?: string` field per the story's
own note (no shipped pattern fills it yet); `resolveGamemode`'s `'none'` source maps to the
existing `Effective<T>` convention `{ value: null, source: null }` rather than adding a
`'none'` member to `ValueSource`; `OPENTDM_PATTERN_ID` exported from `name-patterns.ts` as the
single source of truth for the OpenTDM id used by the heuristic table.

No CHANGELOG entry — per the story's own decision, nothing user-visible changes until [[150]]
renders the guessed marker.

tiers: D 2 / hard 0 · review default · cycles 1 · agents 4
