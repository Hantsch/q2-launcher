---
id: 261
title: The demo players are split by team
status: ready # draft -> ready -> in-progress -> done
created: 2026-10-26
---

## Requirement

As a player, the demo's player table shows each team on its own side, with the team name clearly
highlighted, so I see at a glance who played for whom.

User feedback 2026-10-26: in the demo player table it is not clear which team a player belongs to; team
name and players look too similar. Better a table split in the middle with each team's players on its
side, the team name in a highlight colour.

Today `DemoPlayersPanel.tsx` renders one Name column with one `<tbody>` per side and a plain heading row.

## Acceptance Criteria

- [ ] **AC1** — A demo with exactly two teams shows them side by side, one column per team, each listing its
      players.
- [ ] **AC2** — The left team's heading uses the first side colour and the right team's the second, both
      distinct from player rows.
- [ ] **AC3** — The team heading shows the team name and, when set, its result.
- [ ] **AC4** — A demo without teams shows a single player list.
- [ ] **AC5** — A demo with more than two teams shows the teams stacked, each heading highlighted.
- [ ] **AC6** — The POV marker and the spectators section remain as today.
- [ ] **AC7** — Side colours come from design tokens and meet contrast in light and dark theme.

## Open Questions

## Decisions (Sprint)

- **(User)** Two fixed side colours (left side one colour, right side another, e.g. red/blue) on the team
  heading and a thin side border, independent of the team's name.
- Layout rule at the cut: exactly two teams → side by side; no teams → one list; more than two teams →
  stacked, each heading highlighted.
- "Teams" means groups with a heading; one named side (e.g. `test.dm2`'s Home only) uses the stacked
  layout with the side-1 colour — the cut rule names 0, 2 and >2, and one heading is still a team to
  highlight.
- Stacked headings alternate side 1 / side 2 by position (1st, 3rd, … red; 2nd, 4th, … blue) — only two side
  colours exist per the (User) decision, and alternation keeps neighbours distinct.
- Side colours are new semantic tokens `--color-side-1` (red) and `--color-side-2` (blue), not aliases of
  `--color-danger`/`--color-info` — a team colour is not a status, and /design-tokens forbids reusing a
  status token for another meaning.
- AC7 "light and dark theme": the app ships one theme (dark; `src/renderer/src/styles/index.css` has no light
  variant), so contrast is proven against that theme's surfaces (`base`, `panel`, `raised`); a future light
  theme re-checks its own token values.
- The thin side border is a 2px left border in the side colour on each team block, in both layouts — one
  rule for split and stacked.
- The "Name" column header goes away: the team heading is the column's header and a name-only list needs
  none (the existing unit test asserting `['Name']` is rewritten).
- The split stays two columns at every detail-pane width (names truncate) — the user asked for the split,
  and a breakpoint flip would bring back the ambiguity.
- AC4 and AC5 are proven by component tests, not flows: they are rendering rules with no user action, and
  the teams fixture has no team-less or three-team demo; the flow covers the two-team path the user saw.
- The flow's axe check is scoped to the players panel so it asserts only this story's surface
  (docs/UI-VERIFICATION.md#what-a-flow-may-assert); the flow axe idiom already exists twice, so it is
  extracted into a shared helper before a third use.

## Plan

Renderer-only change in the replays module plus two tokens; `playerGroups` (shared) is unchanged.

1. D1 — tokens `--color-side-1` / `--color-side-2` in the `@theme` block, a unit test proving their
   contrast, and the shared flow axe helper (extracted from the two existing copies).
2. D2 — `DemoPlayersPanel.tsx` picks a layout from the groups (`single` / `split` / `stacked`) and renders
   each team as a block with a side-coloured heading and left border; component tests, the
   `replays-detail-teams` flow extended (side by side, colours, axe), CHANGELOG line, systems doc line.

Order: D1 → D2 (D2 uses the tokens and the helper).

## Deliverables

- [ ] **D1 — Side-colour tokens and a shared flow axe helper.**
  - `src/renderer/src/styles/index.css`: in `@theme`, under the status colours, add `--color-side-1` (a red,
    around `#ff6a5f`) and `--color-side-2` (a blue, around `#62b0ff`), each with a short comment and its
    contrast ratio like the neighbouring tokens. Both must reach ≥ 4.5:1 against `--color-base`,
    `--color-panel` and `--color-raised`. They are semantic team-side colours, not aliases of
    `--color-danger`/`--color-info`.
  - New `src/renderer/src/styles/side-tokens.test.ts` (vitest, node env): reads `index.css`, extracts the hex
    values of `--color-side-1`, `--color-side-2`, `--color-base`, `--color-panel`, `--color-raised`, computes
    WCAG relative-luminance contrast and asserts ≥ 4.5:1 for each side token on each surface, and side-1 ≠
    side-2. Test name: "the side colours meet text contrast on every surface".
  - New `scripts/lib/flow-axe.mjs` exporting `assertNoAxeViolations(page, label, context?)`: the idiom now
    copied verbatim in `scripts/flows/home-tile-states.mjs` (≈ lines 64–95) and
    `scripts/flows/replays-date-filter.mjs` (≈ lines 116–145) — read `node_modules/axe-core/axe.min.js` via
    `REPO_ROOT` (`scripts/lib/paths.mjs`) once, inject if `window.axe` is missing, run with `AXE_RUN_OPTIONS`
    from `scripts/lib/session.mjs`; with a `context` CSS selector call `axe.run(context, options)`. Replace both
    copies with the import; their behaviour is unchanged.
  - Acceptance: the token test is green; `npm run ui:flow -- home-tile-states` and
    `npm run ui:flow -- replays-date-filter` stay green.

- [ ] **D2 — The player table splits by team.** File: `src/renderer/src/modules/replays/components/DemoPlayersPanel.tsx`
  (+ its test, the flow, CHANGELOG, systems doc). Input unchanged: `DemoDetail['playerGroups']` from
  `src/shared/replays/demo-detail.ts` (`groups[].heading` is `null` only for a single team-less side).
  - Layout: `teams = groups.filter(g => g.heading !== null)`. No teams → `single` (today's ungrouped list, no
    heading); exactly 2 → `split` (CSS grid, two equal columns, `min-w-0`, names `truncate`, two columns at
    every width); 1 or > 2 → `stacked` (one block per team, vertical). Wrapper
    `data-testid="replays-detail-teams"` with `data-layout="single|split|stacked"`.
  - Each team block is its own `<table>` with one `<tbody>`: the heading row
    (`data-testid="replays-detail-team"`, `th scope="rowgroup"`) then the player rows
    (`data-testid="replays-detail-player-row"`) — the flow's `tbody` walk keeps working. The block carries
    `data-side="1|2"`: split → left 1, right 2; stacked → by position, odd 1, even 2. It has a 2px left border
    (`border-side-1/2`) and the heading text uses `text-side-1/2`, `font-medium`; player rows stay `text-ink`.
    No hex values, no raw palette classes.
  - Heading text unchanged: `team · result` (whichever is set), else `replays.detail.players.side`. Drop the
    `<thead>` "Name" header in every layout. `PlayerName` (POV marker) and the spectators `<details>` untouched.
  - Tests in `DemoPlayersPanel.test.tsx` (rewrite the `['Name']` test as "no score or ping column"; keep the
    POV and spectator tests): "two teams sit side by side, left side 1 and right side 2"; "the heading shows the
    team name and its result"; "a demo without teams shows one list without headings"; "more than two teams
    stack, each heading highlighted" (3 groups → `stacked`, `data-side` 1,2,1, each heading's class contains
    `text-side-`).
  - Flow `scripts/flows/replays-detail-teams.mjs`, on the example demo (Home [maq] / Away [shad]), new steps:
    "Home and Away sit side by side" — `data-layout="split"`, Home block's bounding box left of Away's with
    overlapping vertical range; "each team heading carries its own side colour" — computed `color` of heading 1
    ≠ heading 2 and each ≠ a player row's; "the players panel passes axe" —
    `assertNoAxeViolations(page, 'players panel', '[data-testid="replays-detail-field-sides"]')` from
    `scripts/lib/flow-axe.mjs`. Existing steps stay.
  - `CHANGELOG.md` under `## Unreleased` / `### Changed`:
    `- **Replays** — Demo details show the two teams side by side, each in its own colour.`
  - `docs/systems/replays-module.md`, the `components/DemoPlayersPanel.tsx` entry: "players by side — two teams
    side by side, otherwise stacked; side colours from `--color-side-1/2`".

## Model Hints

- D1, D2 → default.
- Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/replays-detail-teams.mjs` › "Home and Away sit side by side"; unit
  `src/renderer/src/modules/replays/components/DemoPlayersPanel.test.tsx` › "two teams sit side by side, left side 1 and right side 2"
- AC2 → e2e `scripts/flows/replays-detail-teams.mjs` › "each team heading carries its own side colour"
- AC3 → unit `src/renderer/src/modules/replays/components/DemoPlayersPanel.test.tsx` › "the heading shows the team name and its result"
- AC4 → unit `src/renderer/src/modules/replays/components/DemoPlayersPanel.test.tsx` › "a demo without teams shows one list without headings"
- AC5 → unit `src/renderer/src/modules/replays/components/DemoPlayersPanel.test.tsx` › "more than two teams stack, each heading highlighted"
- AC6 → e2e `scripts/flows/replays-detail-teams.mjs` › "the point-of-view player carries the POV marker" and
  "spectators stay closed until opened, then list HIMMO" (existing steps, kept); unit › "the POV row shows an
  icon and the text POV", "spectators sit in a closed disclosure that names their count" (existing)
- AC7 → unit `src/renderer/src/styles/side-tokens.test.ts` › "the side colours meet text contrast on every surface";
  e2e `scripts/flows/replays-detail-teams.mjs` › "the players panel passes axe"

## Done
