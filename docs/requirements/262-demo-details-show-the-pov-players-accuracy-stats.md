---
id: 262
title: Demo details show the POV player's accuracy stats
status: ready # draft -> ready -> in-progress -> done
created: 2026-10-26
---

## Requirement

As a player, the demo detail shows the recording player's weapon accuracy stats as a table when the demo
contains them, so I can review how I shot without replaying the match.

User feedback 2026-10-26: show the player-POV accuracy stats of the game in the demo details as a table;
they are contained in the demo.

Today the `.dm2` frame walk (`src/shared/demos/dm2-frames.ts`) skips `svc_print`, `svc_centerprint` and
`svc_stufftext`; no stats are extracted.

OpenTDM's end-of-match text, as found in the reference demo (high-bit "green" characters stripped, rows
shortened):

```
Stats for shad:
            Item | Acc. Kills Deaths Dealt Recvd Pick Miss
         Blaster |  16%     0      0    45   120    0    0
   Super Shotgun |  60%     1      3   372   246    7    3
Grenade Launcher |    -     -      0     -    42    0    2
         Railgun |  36%     3     11  1000  2000    6    3
    Combat Armor |    -     -      -     -     -   12   23
Total  | Kills Dths Sui TKs Tele Dealt Recvd TDealt TRecvd
Player |    10   27   1   0    0  3296  4791      0      0
```

## Acceptance Criteria

- [ ] **AC1** — For a `.dm2` containing an OpenTDM "Stats for <name>:" block, the demo detail shows a stats
      table with one row per item and the columns Item, Acc., Kills, Deaths, Dealt, Recvd, Pick, Miss.
- [ ] **AC2** — The Total line is shown below the table (kills, deaths, suicides, team kills, telefrags,
      dealt, received, team dealt, team received).
- [ ] **AC3** — `-` cells are shown as a dash, not as 0.
- [ ] **AC4** — The table is titled with the player name from the block.
- [ ] **AC5** — A demo without such a block shows no stats section at all.
- [ ] **AC6** — A demo with several blocks (e.g. a restarted match) shows the last one.
- [ ] **AC7** — Stats are part of the demo's indexed metadata, so reopening the detail does not re-read the
      file; existing index entries pick them up after a reindex.
- [ ] **AC8** — Parsing is proven on the reference demo's values (Railgun 36 %, 3 kills, 11 deaths, 1000
      dealt; Total 10 kills, 27 deaths).

## Open Questions

## Decisions (Sprint)

- **(User)** Stats are read from the demo itself; when found they are shown as a table in the demo details,
  otherwise nothing is shown.
- Source verified at the cut on the user's demo
  `C:\Games\Q2Pro\opentdm\demos\shad-maq_PFDE3_q2rdm2_20260922-161521.dm2` (POV shad, 705 KB): OpenTDM sends
  the table at match end as `svc_print` text. Only this format is in scope; `.mvd2` is out of scope.
- The same demo also prints "maq wins, 26 to 9." — a team result the detail could fill in later; not in
  this story.
- The reference demo is already committed as `docs/fixtures/demos/shad-maq_PFDE3_q2rdm2_20260922-161521.dm2`
  (story 245), so AC8 is proven on the real file and no synthetic stand-in is needed; synthetic demos only
  cover edge cases (AC5, AC6, split prints) — the sprint note's "synthetic unless allowed" was already
  answered by that commit.
- Verified in the fixture: the block arrives as two `svc_print` messages (level 2) before the block's
  `svc_frame` — `"Stats for shad:\n\n<header>\n<sep>\n<rows>\n"` then `"\n<Total header>\n<sep>\nPlayer |
  …\n\n"` — with high-bit characters; so the parser reads all print text as one line stream, masks every
  byte with `& 0x7f`, and never assumes one message per block.
- Columns are matched by the exact header tokens (`Acc. Kills Deaths Dealt Recvd Pick Miss`, `Kills Dths
  Sui TKs Tele Dealt Recvd TDealt TRecvd`); a block whose header differs is ignored — a misread table is
  worse than none, and only the verified format is in scope.
- A malformed or header-mismatched block never replaces an earlier complete one; among complete blocks
  the last in the file wins (AC6).
- A map change (`svc_serverdata`) does **not** reset the stats, unlike the roster — a recording that runs
  past the match into the next map must keep the match's stats, which is what the user wants to review.
- A block whose Total part is missing (e.g. chat interleaved, cut demo) still shows the item table, with
  no Total line — the item table is the main value, AC2 applies when the line exists.
- The index field is optional (`stats` omitted when the demo has no block) rather than required-nullable
  like `roster` — keeps the change out of ~15 test row literals and the cache JSON small, with the same
  meaning.
- One combined collector (`dm2-facts.ts`) feeds roster + stats from the existing single frame pass,
  because the roster-collector wiring already exists twice (`demo-bytes.ts`, `zip-demos.ts`) and a third
  fact must not be wired twice again.
- Display: a separate `DemoStatsPanel` below the players panel, item names and player name verbatim (game
  data, never i18n); `-` cells render as `-`; accuracy as `36%`; the Total renders as a wrapping
  label/value list, not a second 9-column table, because the detail pane is too narrow for one; the item
  table sits in `overflow-x-auto` for narrow widths.
- Column labels are i18n keys with AC1's short game labels (Item, Acc., Kills, Deaths, Dealt, Recvd, Pick,
  Miss); Total labels use AC2's full words (Kills, Deaths, Suicides, Team kills, Telefrags, Dealt,
  Received, Team dealt, Team received) — the table mirrors the game, the list reads plainly.
- AC5/AC1–4 e2e reuse the existing `replays-teams` fixture variant (example demo + `test.dm2`, which has
  no block) — no new fixture variant.

## Plan

1. **Parser (shared, pure, D1):** `Dm2FrameObserver` gains optional `onPrint(level, text)`; the frame walk
   decodes print text only when an observer is given (skip path byte-identical). New
   `src/shared/demos/dm2-stats.ts` turns the print line stream into `DemoStats | null` (last complete
   block). New `src/shared/demos/dm2-facts.ts` combines the roster and stats collectors into one observer.
2. **Index (main + shared schema, D2):** `readDemoFullPass` and `zip-demos.ts` use the combined
   collector and return `stats`; `discoveredDemoSchema` gains optional `stats`; scan-service carries it;
   cache version bumps so existing entries are re-read (AC7). Systems doc updated.
3. **UI (renderer + e2e, D3):** `DemoStatsPanel` renders `row.stats` below the players panel in
   `DemoDetailPanel`; i18n keys, component test, flow `replays-detail-stats`, changelog line.

Order D1 → D2 → D3; each builds on the previous one's types.

## Deliverables

- [ ] **D1 — Stats collector in the frame pass (shared).**
  - `src/shared/demos/dm2-frames.ts`: `Dm2FrameObserver` gains optional
    `onPrint?(level: number, text: string): void`. In the `SVC_PRINT` case, when
    `observer?.onPrint` exists and the string ends inside the block, call it with the level byte and
    `decodeLatin1(bytes.subarray(textAt, p - 1))` — the same pattern the `SVC_LAYOUT` case uses. The cursor
    math stays exactly the skip path's (no second advance). Update the file doc comment's "Observing the
    walk" paragraph.
  - New `src/shared/demos/dm2-stats.ts` (pure; no node/DOM): exports
    ```ts
    export type DemoStatValue = number | null // null = the game's '-' cell
    export type DemoStatsItem = { item: string; accuracy: DemoStatValue; kills: DemoStatValue;
      deaths: DemoStatValue; dealt: DemoStatValue; received: DemoStatValue; pickups: DemoStatValue;
      missed: DemoStatValue }
    export type DemoStatsTotal = { kills: DemoStatValue; deaths: DemoStatValue; suicides: DemoStatValue;
      teamKills: DemoStatValue; telefrags: DemoStatValue; dealt: DemoStatValue; received: DemoStatValue;
      teamDealt: DemoStatValue; teamReceived: DemoStatValue }
    export type DemoStats = { player: string; items: DemoStatsItem[]; total: DemoStatsTotal | null }
    export interface Dm2StatsCollector { onPrint(level: number, text: string): void; finish(): DemoStats | null }
    export function createDm2StatsCollector(): Dm2StatsCollector
    ```
    Rules: concatenate every print's text (any level) into one stream; map each char code `c` to
    `c & 0x7f` (OpenTDM's high-bit "green" text); drop `\r`; split on `\n`, buffering the unterminated tail
    across prints (a line may be split over two messages). State machine over lines:
    - A line whose trim matches `^Stats for (.+):$` opens a block, `player` = group 1 trimmed (any open
      block is discarded unless complete — then it is committed first).
    - Inside a block, blank lines and separator lines (`^[-+\s]+$` with at least one `-`) are skipped.
      The first other line must be the item header: split on `|`, left trims to `Item`, right
      whitespace-tokens are exactly `Acc. Kills Deaths Dealt Recvd Pick Miss`; else discard the block.
    - Then item rows: exactly one `|`, left trimmed = item name (non-empty), right = 7 whitespace tokens,
      each `-` (→ `null`) or digits; the first (Acc.) may carry a trailing `%` (`36%` → 36). The first
      non-blank, non-separator line that is not a row ends the item table; a block with ≥ 1 row is
      complete.
    - Total: if that ending line is a header whose left trims to
      `Total` and whose right tokens are exactly `Kills Dths Sui TKs Tele Dealt Recvd TDealt TRecvd`, skip
      the separator and parse the next line `Player | <9 tokens>` (same `-`/digits rule) into `total`. Any
      other line instead means `total: null`, and that line is re-examined (it may open the next block).
    - Committing a complete block replaces the result (last complete block wins); an incomplete or
      mismatched block never replaces an earlier one. `svc_serverdata` does not reset anything.
    - `finish()` commits a still-open complete block and returns the result or `null`.
  - New `src/shared/demos/dm2-facts.ts`: `createDm2FactsCollector(): Dm2FrameObserver & { finish(): {
    roster: DemoRoster | null; stats: DemoStats | null } }`, forwarding `onServerdata`/`onConfigstring`/
    `onLayout` to `createDm2RosterCollector()` (`./dm2-roster.ts`) and `onPrint` to
    `createDm2StatsCollector()`.
  - Tests in new `src/shared/demos/dm2-stats.test.ts`:
    - real fixture `docs/fixtures/demos/shad-maq_PFDE3_q2rdm2_20260922-161521.dm2` run through
      `createDm2FrameCounter(createDm2FactsCollector())` (AC8, AC4, AC1, AC2, AC3): player `shad`; 10 item
      rows in file order Blaster … MegaHealth; Railgun `{ accuracy: 36, kills: 3, deaths: 11, dealt: 1000,
      received: 2000, pickups: 6, missed: 3 }`; Grenade Launcher `accuracy`, `kills`, `dealt` are `null`
      while `deaths` is 0; total `{ kills: 10, deaths: 27, suicides: 1, teamKills: 0, telefrags: 0, dealt:
      3296, received: 4791, teamDealt: 0, teamReceived: 0 }`.
    - synthetic demos built with `buildDm2Stream` / `print(...)` from `src/shared/demos/dm2-frames-writer.ts`:
      no block → `null` (AC5); two blocks with different values → the last (AC6); a block split mid-line
      over two prints parses; a block with an unknown header column is ignored and an earlier good block
      survives; a block without the Total part has `total: null`; high-bit text parses.
  - `src/shared/demos/dm2-frames.test.ts`: frame counts with and without the facts observer are equal on
    `docs/fixtures/demos/test.dm2` and on the example fixture.

- [ ] **D2 — Stats in the index (main + shared schema).**
  - `src/shared/modules/replays.ts`: `discoveredDemoSchema` gains `stats: <schema>.optional()` next to
    `roster` (omitted = the demo has no stats block / not parsed), mirroring `DemoStats` from
    `src/shared/demos/dm2-stats.ts` (`z.number().int().nonnegative().nullable()` per value, `total`
    nullable). Add a compile-time check that the zod output type equals `DemoStats`.
  - `src/main/lib/demo-bytes.ts`: `streamDemoDuration`/`readDemoFullPass` use `createDm2FactsCollector()`
    from `src/shared/demos/dm2-facts.ts` instead of the bare roster collector; `DemoFullPass` gains
    `stats: DemoStats | null` (`null` for `.mvd2` and on failure).
  - `src/main/modules/replays/zip-demos.ts`: `durationOf` uses the same facts collector and returns `stats`.
  - `src/main/modules/replays/scan-service.ts`: `DemoHeaderFacts`, `toRow` and `readDemoFacts` carry
    `stats`; a row only gets the `stats` key when non-null. `src/main/modules/replays/discovery.ts`
    placeholders need no change (the field is optional).
  - `src/main/modules/replays/index-cache.ts`: bump `REPLAYS_INDEX_CACHE_VERSION` by one (6 → 7, or to
    the next free value if a sibling sprint story already bumped it) — this is what makes existing entries
    pick up stats (AC7).
  - `docs/systems/replays-module.md`: the index-row facts gain `stats` (collected by `dm2-stats.ts` in
    the same single pass via `dm2-facts.ts`, last complete OpenTDM block wins, not reset on map change);
    Limitations gain: `.mvd2` has no stats, only OpenTDM's "Stats for" format is read.
  - Tests: `src/main/lib/demo-bytes.test.ts` › "the example demo's full pass carries shad's stats" (plain
    and gzipped copy; `test.dm2` → `stats: null`); `src/main/modules/replays/scan-service.test.ts` ›
    "readDemoFacts carries the stats from the one full pass" (the existing one-pass test keeps passing);
    `src/main/modules/replays/index-cache.test.ts` › "a row with stats reads back identical" and "a
    version-6 cache is discarded"; `src/main/modules/replays/zip-demos.test.ts` › "a zipped example demo
    carries its stats".

- [ ] **D3 — Stats table in the demo detail (renderer + e2e).**
  - New `src/renderer/src/modules/replays/components/DemoStatsPanel.tsx`, props `{ stats: DemoStats }`
    (type from `@shared/demos/dm2-stats`). Mirror `DemoPlayersPanel.tsx` in the same folder: an `<h3
    className="stencil …">` with lucide `Crosshair` (`aria-hidden`) and `t('replays.detail.stats.title',
    { name: stats.player })` ("Stats for {{name}}", `data-testid="replays-detail-stats-title"`); a
    `table w-full border-collapse text-left text-xs text-ink-dim` inside `overflow-x-auto`, `thead` with
    `th scope="col" className="stencil …"` for Item, Acc., Kills, Deaths, Dealt, Recvd, Pick, Miss
    (`replays.detail.stats.col.{item,accuracy,kills,deaths,dealt,received,pickups,missed}`), one row per
    item (`data-testid="replays-detail-stats-row"`, `border-b border-line/60`, item name verbatim as `th
    scope="row"`, numbers right-aligned with `numeric`). A cell is `-` for `null`, `${n}%` for accuracy,
    else the number. When `stats.total` is non-null, below the table a `<dl
    data-testid="replays-detail-stats-total">` in a wrapping grid of label/value pairs with keys
    `replays.detail.stats.total.{kills,deaths,suicides,teamKills,telefrags,dealt,received,teamDealt,teamReceived}`
    (Kills, Deaths, Suicides, Team kills, Telefrags, Dealt, Received, Team dealt, Team received) and a
    `stencil` caption `replays.detail.stats.total.title` ("Total"). Root wrapper
    `data-testid="replays-detail-stats"`. Design tokens only (no raw palette classes).
  - `src/renderer/src/modules/replays/components/DemoDetailPanel.tsx`: render `<DemoStatsPanel
    stats={row.stats} />` right after the `replays-detail-field-sides` block only when `row.stats` is
    present — nothing at all otherwise (AC5). Reads only the row: no client call.
  - Keys in `src/renderer/src/modules/replays/locale/en.json`; refresh
    `src/renderer/src/i18n/__snapshots__/en.bundle.json` via the bundle test.
  - Component test new `src/renderer/src/modules/replays/components/DemoStatsPanel.test.tsx`: "renders the
    eight columns and one row per item", "a null cell shows a dash, not 0", "the title carries the player
    name", "the total line lists all nine values", "no total → no total list". In
    `src/renderer/src/modules/replays/components/DemoDetailPanel.test.tsx`: "a row without stats renders
    no stats section" and "a row with stats renders the stats table".
  - New flow `scripts/flows/replays-detail-stats.mjs` (`variant = REPLAYS_TEAMS_VARIANT`, `setup` calls
    `writeReplaysTeamsFixture()`, helpers `openDemosRoot`/`rowFor` from `scripts/lib/replays-copy-in.mjs`
    — mirror `scripts/flows/replays-detail-teams.mjs`): open `REPLAYS_TEAMS_EXAMPLE_DEMO`; the title reads
    "Stats for shad"; column headers are exactly the eight; the Railgun row reads `36% 3 11 1000 2000 6 3`;
    the Grenade Launcher row's Acc. cell is `-` and its Deaths cell `0`; the total list shows Kills 10 and
    Deaths 27; then open `REPLAYS_TEAMS_HEADER_DEMO` (`test.dm2`) and assert `replays-detail-stats` has
    count 0. Add the flow to the `replays-detail` area in `scripts/flows/areas.json` and add
    `DemoStatsPanel.tsx` to that area's `paths`.
  - `CHANGELOG.md` under `## Unreleased` › `### Added`: `- **Demos** — Demo details show your OpenTDM
    accuracy stats as a table.` (merge into an existing `### Added` heading if a sibling story created
    one).

## Model Hints

- D1 → deliverable-hard. It edits the decode loop of the exact frame counter again — a mis-advanced cursor
  in the new print-observer path silently changes every demo's duration — and the line state machine
  must survive prints split mid-line, high-bit text, interleaved non-stat lines and a malformed block
  without clobbering an earlier good one.
- Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/replays-detail-stats.mjs` › "replays-detail-stats" (eight column headers,
  one row per item, Railgun row values); component
  `src/renderer/src/modules/replays/components/DemoStatsPanel.test.tsx` › "renders the eight columns and
  one row per item".
- AC2 → e2e `scripts/flows/replays-detail-stats.mjs` › "replays-detail-stats" (total list shows Kills 10,
  Deaths 27); component `DemoStatsPanel.test.tsx` › "the total line lists all nine values"; unit
  `src/shared/demos/dm2-stats.test.ts` › "the OpenTDM example yields shad's item rows and total".
- AC3 → unit `src/shared/demos/dm2-stats.test.ts` › "the OpenTDM example yields shad's item rows and
  total" (Grenade Launcher nulls vs. 0); component `DemoStatsPanel.test.tsx` › "a null cell shows a dash,
  not 0"; e2e `scripts/flows/replays-detail-stats.mjs` › "replays-detail-stats" (Grenade Launcher Acc. `-`,
  Deaths `0`).
- AC4 → e2e `scripts/flows/replays-detail-stats.mjs` › "replays-detail-stats" (title "Stats for shad");
  component `DemoStatsPanel.test.tsx` › "the title carries the player name".
- AC5 → e2e `scripts/flows/replays-detail-stats.mjs` › "replays-detail-stats" (`test.dm2` shows no
  `replays-detail-stats`); unit `src/shared/demos/dm2-stats.test.ts` › "a demo without a stats block has
  no stats"; component `src/renderer/src/modules/replays/components/DemoDetailPanel.test.tsx` › "a row
  without stats renders no stats section".
- AC6 → unit `src/shared/demos/dm2-stats.test.ts` › "with several blocks the last complete one wins" and
  › "a malformed block does not replace an earlier good one".
- AC7 → unit `src/main/modules/replays/scan-service.test.ts` › "readDemoFacts carries the stats from the
  one full pass"; `src/main/modules/replays/index-cache.test.ts` › "a row with stats reads back identical"
  and › "a version-6 cache is discarded"; component `DemoDetailPanel.test.tsx` › "a row with stats
  renders the stats table" (rendered from the row alone, no client read).
- AC8 → unit `src/shared/demos/dm2-stats.test.ts` › "the OpenTDM example yields shad's item rows and
  total" (reads `docs/fixtures/demos/shad-maq_PFDE3_q2rdm2_20260922-161521.dm2`: Railgun 36 %, 3, 11,
  1000; Total 10, 27).

## Done
