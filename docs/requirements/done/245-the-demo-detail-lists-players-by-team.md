---
id: 245
title: the demo detail lists players by team
status: done # draft -> ready -> in-progress -> done
created: 2026-10-04
---

## Requirement

As a player looking at a demo, the detail shows who played as a list grouped by team, like the
server browser's player list but without score and ping, with the team names taken from the demo
itself.

User feedback 2026-10-04: players should be listed like in the server browser, only without score and
ping; the team names can be extracted from the demo file. Example demo:
`C:\Games\Q2Pro\opentdm\demos\shad-maq_PFDE3_q2rdm2_20260922-161521.dm2`, statusbar
`... xr -32 yb -96 string "Home" xr -32 yb -48 string "Away" ...`.

What that demo carries (checked 2026-10-04, OpenTDM):

- the statusbar/layout configstring names the teams: `string "Home"`, `string "Away"`;
- print lines name each player's team: `maq (Home)`, `shad (Away)`, `ping80 (Away)`;
- the scoreboard layout lists teams, players (`maq:31(male/grunt)`) and a ` Spectators` block
  (`piu-afk:40->maq`).

Today the parser reads the header and leading configstrings only (`dm2-header.ts`): players come
from `CS_PLAYERSKINS`, with no team, and the detail shows sides as one line of text. Sidecar `sides`
(user-entered) override the header.

## Acceptance Criteria

- [x] **AC1** — The detail shows players as a table/list in the server browser's style, without score
      and ping columns.
- [x] **AC2** — For the example OpenTDM demo, players are grouped under "Home" and "Away" with `maq`
      in Home and `shad` in Away; spectators are not listed as players.
- [x] **AC3** — Team names come from the demo; a team renamed in the match shows its final name.
- [x] **AC4** — A demo without recognisable teams (duel/FFA, unknown mod) shows one ungrouped list of
      its players, as today's header players.
- [x] **AC5** — Sides the user entered in the sidecar still win over the extracted teams.
- [x] **AC6** — The POV player is marked in the list (icon plus text, not colour alone).
- [x] **AC7** — Extraction stays within the existing scan budget: parsing a 1 MB demo for teams does
      not make the list scan noticeably slower (measured in refine).
- [x] **AC8** — The example demo (or a trimmed copy) is a test fixture.

## Open Questions

- ~~**Q1** — Which mods are in scope? Recommendation: OpenTDM first (the example), with a generic
  fallback; CTF (`red`/`blue` via skins) as a follow-up story if wanted.~~ answered → Decisions (Sprint)
- ~~**Q2** — Show spectators in their own collapsed group? Recommendation: yes, collapsed.~~ answered → Decisions (Sprint)
- ~~**Q3** — Are the extracted teams also used for the list's player search and the `sides` filter, or
  only in the detail? Recommendation: written into the index so search can use them.~~ answered → Decisions (Sprint)
- ~~**Q4** — Is the example demo fine to commit as a fixture (it names real players)? Ask the user.~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Mods in scope: OpenTDM AND CTF (red/blue via skins) in this story, plus a generic fallback.
- **(User)** Spectators: in their own collapsed group.
- **(User)** Extracted teams: written into the index so player search and sides filter use them.
- **(User)** Example demo as fixture: commit the real example demo (user accepts that it names real players).
- **OpenTDM team source:** membership and team names come from OpenTDM's per-client configstrings
  `CS_GENERAL + MAX_CLIENTS + slot` (`CS_TDM_SPECTATOR_STRINGS`) of the form `<name> (<team>)`, with the
  value at demo end winning. Reason: the statusbar's `string "Home"` labels are static HUD text that
  does not follow a rename, and the scoreboard's team column shows player names in OpenTDM's
  pseudo-1v1 mode (`maq`/`shad` in the example). The example's final strings say `maq (Home)`,
  `shad (Away)`, so this satisfies AC2 and AC3.
- **Stale strings:** a slot's `<name> (<team>)` string counts only while that slot's current
  `CS_PLAYERSKINS` name equals `<name>`. Names under the `Spectators` heading of the demo's last
  `svc_layout` scoreboard are spectators, whatever their string says. Reason: OpenTDM leaves stale
  strings behind. In the example, `ping80 (Away)` stays after ping80 has gone to spectator and slot 5
  has been reused by `HIMMO`.
- **Team order:** teams follow the order their names appear as `string "<name>"` in the final
  `CS_STATUSBAR` (index 5, which holds the whole statusbar). Names that are not there follow in order
  of first appearance. Reason: Home is listed before Away, the way the HUD shows them.
- **CTF:** a player whose final `CS_PLAYERSKINS` skin is `<model>/ctf_r` or `<model>/ctf_b` is on
  team `Red` or `Blue`. These names are stored as game data, not i18n, the same way map names are.
  Reason: a CTF demo has no team-name configstring, and Red/Blue are the CTF mod's own team names.
  Detection order is OpenTDM first, then CTF.
- **Recognisable teams:** the roster is non-null only when at least one team has at least one
  player. Otherwise the demo falls back to today's ungrouped header players (AC4). Reason: one rule
  covers duel, FFA and unknown mods. This includes an OpenTDM 1v1 demo cut off before match end, whose
  strings still carry plain names.
- **Spectators:** these are the connected players at demo end who are not on a team, plus the
  last-layout `Spectators` names, deduplicated, in slot order and then layout order. Reason: the
  scoreboard lists spectators that are no longer in any skin slot (`piu-afk`, `B100D`, `damz.` in the
  example).
- **One pass:** the roster is collected inside the existing whole-file frame-count pass. The `.dm2`
  frame counter gains an optional observer for configstring and layout messages, and the file is not
  read a second time. Reason: AC7. Measured in refine: on the 705 KB example, already in memory, the
  frame count takes 0.32 ms per pass and the file read about 0.3 ms. Decoding the few hundred extra
  strings is a fraction of that. Budget: the full pass with roster collection takes at most 1.5× the
  frame count alone plus 1 ms (median of 20 runs).
- **mvd2 out of scope:** `.mvd2` rows get `roster: null` and use the fallback. Reason: the example and
  every AC are `.dm2`, and the mvd2 walker is a separate parser. This is recorded under Limitations in
  the systems doc.
- **Index shape:** `DiscoveredDemo.roster: { teams: { name: string; players: string[] }[]; spectators: string[] } | null`.
  `REPLAYS_INDEX_CACHE_VERSION` is bumped from 2 to 3. Reason: the cache file's own rule is "bump on
  any cached fact shape change", and the bump makes every existing demo re-parse once.
- **Effective sides:** when a roster exists, the demo rung of `sides` becomes one side per team
  (`{ team, players }`), and spectators are never part of `sides`. Reason: this follows from Q3 (User),
  and the gamemode player count then stops counting spectators. A side effect is that the list row's
  existing `sidesText` shows `Home vs Away`.
- **Search, not a new filter:** search also matches team names and every roster player. No new filter
  control is added. Reason: the free-text search is the only list filter that reads sides today, and
  that is where Q3 (User) applies.
- **Spectators group with a sidecar:** the collapsed spectators group comes from the demo roster even
  when the sidecar's sides win, but it omits names already on a displayed side. Reason: AC5 lets the
  sidecar override sides, and spectators are a separate demo fact.
- **Panel:** a new replays-internal `DemoPlayersPanel` copies the markup of the server browser's
  `ServerPlayersPanel` (title with the `Users` icon and a count, a stencil header, bordered rows), with
  a single name column and no sort. Reason: the shape exists only once, and modules may not import each
  other, so there is nothing to extract yet. The spectators group is a native `<details>`/`<summary>`
  that is closed by default, mirroring `FailureCauseDetail.tsx`.
- **POV mark:** the POV player's row shows a lucide `Eye` icon plus the visible i18n text "POV". This
  applies in every group, the ungrouped fallback included. Reason: AC6 asks for an icon plus text, not
  colour alone.
- **Sidecar side headings:** a side's heading is its team, followed by its result when set. When there
  is more than one side, an unnamed side is headed "Side {n}". A single unnamed side renders
  ungrouped. Reason: a user-entered side can lack a team.
- **Fixture:** the full example demo is committed as
  `docs/fixtures/demos/shad-maq_PFDE3_q2rdm2_20260922-161521.dm2` (705 KB), not a trimmed copy.
  Reason: the deciding strings are at the very end of the file, and trimming means rewriting blocks.
- **Existing fixture changes meaning:** `test.dm2` is OpenTDM too. It now yields Home
  `[sd.kgm/sauDove]` with spectator `WallFly[BZZZ]`, and the tests and flows that encoded its old
  sides, which counted spectators, are updated in D3. Reason: this is the intended behaviour, not a
  regression.

## Plan

1. **Parser (shared, pure):** `src/shared/demos/dm2-roster.ts` collects the roster from configstring
   and layout messages. `dm2-frames.ts` gets an optional observer, so one pass yields both the frame
   count and the roster (D1).
2. **Index (main):** the whole-file reader returns duration plus roster. `readDemoFacts`, the zip
   path and discovery placeholders carry `roster`. The schema gains a field and the cache version is
   bumped. The systems doc is updated (D2).
3. **Effective values (shared + callers):** the three copies of `headerFromRow` are extracted into
   one helper. The demo rung of `sides` uses the teams, which covers AC5 because the sidecar rung
   stays first. Existing test.dm2 assertions are updated (D3).
4. **Search and detail model (shared):** search covers team names and roster players.
   `buildDemoDetail` returns `playerGroups` (teams, or the ungrouped list, plus spectators and the
   POV) (D4).
5. **UI (renderer + flow):** `DemoPlayersPanel` replaces the one-line sides text in the detail. It
   comes with i18n keys, a component test, a `replays-teams` fixture variant, an e2e flow and a
   changelog line (D5).

Order D1 → D2 → D3 → D4 → D5. Each D builds on the previous one's types.

## Deliverables

- [x] **D1 — Roster collector in the frame pass (shared).** Copy the example demo from
      `C:\Games\Q2Pro\opentdm\demos\shad-maq_PFDE3_q2rdm2_20260922-161521.dm2` to
      `docs/fixtures/demos/` under the same name. New pure file `src/shared/demos/dm2-roster.ts` exports
      `type DemoRoster = { teams: { name: string; players: string[] }[]; spectators: string[] }` and
      `createDm2RosterCollector()`, which provides `onServerdata(protocol)`, `onConfigstring(index, value)`,
      `onLayout(text)` and `finish(): DemoRoster | null`. The collector works as follows:
  - Configstring layout comes from the protocol via `ORIGINAL_LAYOUT`/`EXTENDED_LAYOUT` in
    `dm2-header.ts`. `CS_GENERAL = CS_PLAYERSKINS + MAX_CLIENTS`, the OpenTDM strings sit at
    `CS_GENERAL + MAX_CLIENTS + slot`, and `CS_STATUSBAR = 5`.
  - It keeps the latest value per skin slot (name = text before the first `\`, skin = text after the
    last `/`), the latest string per slot, the latest statusbar and the latest layout. A second
    `svc_serverdata` (map change) resets everything.
  - OpenTDM rule: when a slot's string equals `` `${name} (${team})` `` and `name` is the slot's
    current skin name, that slot belongs to `team`.
  - CTF rule, used only if OpenTDM found no team: skins `ctf_r` and `ctf_b` map to `Red` and `Blue`.
  - Spectators: in the last layout, every `string`/`string2` quoted text after one whose trimmed text
    is `Spectators`, up to the next `string2`, is a name. Parse it with `^(.*):\d+(->.*)?\s*$` and
    take group 1, trimmed. Such names are removed from teams. The spectator list is the remaining
    connected non-team names (slot order) plus the layout names, deduplicated.
  - Team order follows the order of `string "<team>"` in the final statusbar, then first appearance.
  - The result is null when no team has a player.

  In `src/shared/demos/dm2-frames.ts`, `createDm2FrameCounter(observer?)` decodes and forwards a
  configstring (index plus latin1 value via `decodeLatin1` from `../servers/protocol`), a layout
  string and the serverdata protocol **only when an observer is given**. The skip path stays
  byte-identical, and so do the counting results. Tests:
  - In the new `src/shared/demos/dm2-roster.test.ts`, the real fixture (AC2, AC8) and synthetic demos
    built with `src/shared/demos/dm2-frames-writer.ts`: rename (AC3), stale slot string, CTF, duel
    without teams (AC4), and the timing budget (AC7). For the budget, the fixture is in memory, the
    full pass with the collector runs at most 1.5× the counter without it plus 1 ms, and the measure
    is the median of 20 runs.
  - In `src/shared/demos/dm2-frames.test.ts`, a case showing that the counts with and without an
    observer are equal on `docs/fixtures/demos/test.dm2` and on the new fixture.

- [x] **D2 — Roster in the index (main + shared schema).**
  - `src/main/lib/demo-bytes.ts`: `readDemoDuration` becomes
    `readDemoFullPass(path): Promise<{ duration: FrameCountResult; roster: DemoRoster | null }>`. The
    same single stream feeds `createDm2FrameCounter(collector)` for `.dm2`; `.mvd2` gives
    `roster: null`. Update its callers.
  - `src/shared/modules/replays.ts`: `discoveredDemoSchema` gains
    `roster: z.object({ teams: z.array(z.object({ name: z.string(), players: z.array(z.string()) })), spectators: z.array(z.string()) }).nullable()`.
  - `src/main/modules/replays/scan-service.ts`: `DemoHeaderFacts`, `toRow` and `readDemoFacts` carry
    `roster`. An unreadable header gives null.
  - `src/main/modules/replays/zip-demos.ts`: `durationOf` also returns the roster from the same
    in-memory bytes.
  - `src/main/modules/replays/discovery.ts`: the placeholders get `roster: null`.
  - `src/main/modules/replays/index-cache.ts`: `REPLAYS_INDEX_CACHE_VERSION = 3`.
  - Docs: `docs/systems/replays-module.md` gets the parser/index facts (roster field, OpenTDM and CTF
    rules, one pass) and two Limitations entries: mvd2 has no roster, and an OpenTDM 1v1 demo cut off
    before match end has no teams.
  - Tests: in `src/main/lib/demo-bytes.test.ts`, the fixture gives Home `[maq]` and Away `[shad]`,
    also for a gzipped copy. In `src/main/modules/replays/scan-service.test.ts`, a case asserting that
    `readDemoFacts` opens a loose demo for one full pass, not two (AC7, structural).
- [x] **D3 — Effective sides from the teams (shared + callers).** The `headerFromRow` shape exists three
      times: `src/main/modules/replays/demo-rows.ts:29`, `src/main/modules/replays/demo-rename.ts:66` and
      `src/renderer/src/modules/replays/row-patch.ts:14`. Extract it into
      `src/shared/replays/row-header.ts` as `headerFromRow(row: DiscoveredDemo)`, now including `roster`,
      and use that one helper in all three places. In `src/shared/demos/effective-values.ts`, `OkHeader`
      gains `roster: DemoRoster | null`. The `demo` rung of `sides` is
      `roster.teams.map(t => ({ team: t.name, players: t.players }))` when the roster is non-null,
      otherwise today's `[{ players: header.players }]`, with the sidecar rung staying first. Then run the
      replays tests and flows that read test.dm2-derived rows and update the assertions that encode the
      old spectator-inclusive sides or gamemode. Expect `src/shared/replays/list-filter.test.ts`,
      `src/main/modules/replays/scan-service.test.ts`, `src/main/modules/replays/zip-demos.test.ts`
      and `scripts/flows/replays-filter-search.mjs`; grep for `sauDove` and `WallFly`. Tests in
      `src/shared/demos/effective-values.test.ts`: a roster becomes team sides, sidecar sides still win
      over the roster (AC5), and no roster falls back to header players (AC4). Add a test for
      `row-header.ts`.
- [x] **D4 — Search and detail model (shared).**
  - `src/shared/replays/list-filter.ts`: `DemoFilterSubject` gains
    `rosterTerms: readonly string[]` (team names, team players, spectators). `demoFilterSubject` fills
    it from `row.roster`, and `matchesDemoSearch` includes it. Test in
    `src/shared/replays/list-filter.test.ts`: searching `Away` finds the roster demo.
  - `src/shared/replays/demo-detail.ts`: `DemoDetail` gains
    `playerGroups: { groups: { heading: { team?: string; result?: string; index: number } | null; players: { name: string; pov: boolean }[] }[]; spectators: { name: string; pov: boolean }[] }`.
    The groups come from `row.effective.sides.value`. A single side with no team gets a null heading
    (ungrouped); an unnamed side among several gets `{ index: n }`. Spectators are
    `row.roster?.spectators` minus names on any group. `pov` is
    `name === row.effective.pov.value` (exact match after trimming).
  - Tests in `src/shared/replays/demo-detail.test.ts` cover the grouped roster, the ungrouped
    fallback, sidecar override with spectators kept, and the POV flag.
- [x] **D5 — Players panel in the detail (renderer + e2e).**
  - New `src/renderer/src/modules/replays/components/DemoPlayersPanel.tsx` with props
    `{ groups: DemoDetail['playerGroups'] }`. Copy the markup of
    `src/renderer/src/modules/servers/ServerPlayersPanel.tsx` (the `PanelTitle` with `Users` icon and
    count, one `stencil` name header, and the row classes `border-b border-line/60`) without the
    score/ping columns or sort. There is one `<tbody>` per group, and a heading row
    (`data-testid="replays-detail-team"`) shows the team (plus result) or `replays.detail.players.side`
    ("Side {{n}}"). Player rows have `data-testid="replays-detail-player-row"`, and the POV row adds a
    lucide `Eye` icon (`aria-hidden`) plus visible text `replays.detail.players.pov` ("POV",
    `data-testid="replays-detail-player-pov"`). Spectators go in a closed native
    `<details data-testid="replays-detail-spectators">` whose `<summary>` reads
    `replays.detail.players.spectators` ("Spectators ({{count}})"), mirroring
    `src/renderer/src/modules/downloads/components/FailureCauseDetail.tsx`.
  - `src/renderer/src/modules/replays/components/DemoDetailPanel.tsx`: the `sides` field no longer
    renders as a `<dd>` text line. Instead `DemoPlayersPanel` renders below the match `<dl>` when it
    has groups or spectators; keep `data-testid="replays-detail-field-sides"` on its wrapper.
  - Add the new keys to `src/renderer/src/modules/replays/locale/en.json` and refresh the i18n bundle
    snapshot.
  - Add the component test `src/renderer/src/modules/replays/components/DemoPlayersPanel.test.tsx`.
  - Fixture: add a `replays-teams` variant to `scripts/lib/fixture/replays.mjs` and register it in
    `scripts/lib/fixture.mjs` `VARIANTS`, mirroring `writeReplaysSortOrderFixture`. It copies the
    example demo and `docs/fixtures/demos/test.dm2` into one installation's demos folder, plus a copy
    of the example with a sidecar `sides: [{ team: "Wolves", players: ["maq"] }]`.
  - New flow `scripts/flows/replays-detail-teams.mjs` (`variant = 'replays-teams'`).
  - `CHANGELOG.md`: add `- **Demos** — Demo detail lists players by team, spectators tucked away.`
    under `### Added`.
  - `docs/systems/replays-module.md`: one line about the detail's players panel.

## Model Hints

- D1 → deliverable-hard. The risk is that the change edits the decode loop of the exact frame
  counter. A mis-sized or double-advanced cursor in the new observer path silently changes every
  demo's duration. The membership rules also depend on cross-message state: a slot's skin name has to
  match its string, slots are reused, and the last layout overrides.
- Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/replays-detail-teams.mjs` › "replays-detail-teams" (the example row's
  detail shows `replays-detail-player-row` rows under `replays-detail-field-sides`, with no score or
  ping header). Component level: `src/renderer/src/modules/replays/components/DemoPlayersPanel.test.tsx`
  › "renders a name-only player table without score or ping columns".
- AC2 → e2e `scripts/flows/replays-detail-teams.mjs` › "replays-detail-teams" (headings Home then
  Away, maq under Home, shad under Away; `replays-detail-spectators` is closed and lists `HIMMO`).
  Unit: `src/shared/demos/dm2-roster.test.ts` › "the OpenTDM example puts maq in Home and shad in Away
  and no spectator on a team".
- AC3 → unit `src/shared/demos/dm2-roster.test.ts` › "a team renamed during the match shows its final
  name".
- AC4 → unit `src/shared/demos/dm2-roster.test.ts` › "a duel without team strings has no roster" and
  `src/shared/demos/effective-values.test.ts` › "no roster falls back to the header players"; e2e
  component `DemoPlayersPanel.test.tsx` › "a single unnamed side renders as one ungrouped list"
  (no fixture demo yields a roster-less row, so the flow does not cover the fallback).
- AC5 → unit `src/shared/demos/effective-values.test.ts` › "sidecar sides win over the demo roster";
  e2e `scripts/flows/replays-detail-teams.mjs` › "replays-detail-teams" (the sidecar copy shows Wolves
  with maq).
- AC6 → e2e `scripts/flows/replays-detail-teams.mjs` › "replays-detail-teams" (the shad row carries
  `replays-detail-player-pov` with visible text "POV"); component
  `DemoPlayersPanel.test.tsx` › "the POV row shows an icon and the text POV".
- AC7 → unit `src/shared/demos/dm2-roster.test.ts` › "collecting the roster keeps the full pass within
  budget of the frame count alone" and `src/main/modules/replays/scan-service.test.ts` › "a loose demo
  is read for one full pass, not two".
- AC8 → unit `src/shared/demos/dm2-roster.test.ts` › "the OpenTDM example puts maq in Home and shad in
  Away and no spectator on a team" (reads
  `docs/fixtures/demos/shad-maq_PFDE3_q2rdm2_20260922-161521.dm2`).

## Done

Roster (teams, spectators) is collected inside the existing `.dm2` frame-count pass and stored on the index row (cache v3). Effective `sides` become one side per team (sidecar still first), search matches team names and roster players, and the detail shows a name-only players panel per team with an Eye+"POV" mark and a closed spectators group.

Commit message: `245: demo detail lists players by team (roster from the dm2 frame pass, OpenTDM + CTF, spectators group)`

Verification (narrow gate): `npm run build`, `lint`, `typecheck` green; `npx vitest run --changed HEAD` 1596 tests green; comments/architecture tests green. e2e: the `--affected` selection pulled 123 flows and exceeded the 10-minute call (stopped, INCONCLUSIVE), so the story's named flow plus the touched areas ran instead: `npm run ui:flows -- replays-detail-teams replays-demo-detail replays-filter-search replays-edit-sides-tags replays-detail-quick-edit replays-demo-rows replays-discovered-list replays-edit-sidecar replays-quoted-search replays-zip-entries replays-sort-order replays-rename` 12/12 passed. Review: one default-tier cycle, PASS; findings fixed (flow asserts Home/Away exactly, panel test asserts Blue too, AC4 mapping corrected). Full regression gate pending (sprint's).
AC -> test: AC1/AC6 flow + DemoPlayersPanel.test.tsx; AC2/AC3/AC8 dm2-roster.test.ts + flow; AC4 dm2-roster.test.ts, effective-values.test.ts, DemoPlayersPanel.test.tsx (component level only); AC5 effective-values.test.ts + flow; AC7 dm2-roster.test.ts budget + scan-service.test.ts one-pass. No manual residue.

Decisions:

- `OkHeader.roster` is optional (`roster?: DemoRoster | null`) because `Dm2Header`/`Mvd2Header` are in the same union and carry no roster.
- `dm2-roster.test.ts` and `dm2-frames.test.ts` read fixtures via `node:fs`, so they were added to `tsconfig.web.json` exclude and the list pinned in `architecture.test.ts` (as `fixture-constants.test.ts`).
- `replays-teams` fixture puts the demos in an extra folder under the variant's userData, not an installation demos folder, because the shared `gameRoot()` would leak them into other flows. The scan covers both.
- `areas.json` gets a `replays-detail` area (every replays row was at the 12-flow cap); `replays-demo-detail.mjs` dropped `sides` from `MATCH_IDS` (the field now sits outside the match facts); `field.sides` i18n key removed; gamemode filter options in the flow fixture now include `tdm` (test.dm2 has a team player).
- Not fixed (low): `demo-detail.ts` still builds a `sides` entry in `fields` that the panel filters out; AC4 has no e2e step (no roster-less fixture row).

tiers: D 5 / hard 1 · review default · cycles 1 · agents 9
