---
id: 245
title: the demo detail lists players by team
status: draft # draft -> ready -> in-progress -> done
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

- [ ] **AC1** — The detail shows players as a table/list in the server browser's style, without score
      and ping columns.
- [ ] **AC2** — For the example OpenTDM demo, players are grouped under "Home" and "Away" with `maq`
      in Home and `shad` in Away; spectators are not listed as players.
- [ ] **AC3** — Team names come from the demo; a team renamed in the match shows its final name.
- [ ] **AC4** — A demo without recognisable teams (duel/FFA, unknown mod) shows one ungrouped list of
      its players, as today's header players.
- [ ] **AC5** — Sides the user entered in the sidecar still win over the extracted teams.
- [ ] **AC6** — The POV player is marked in the list (icon plus text, not colour alone).
- [ ] **AC7** — Extraction stays within the existing scan budget: parsing a 1 MB demo for teams does
      not make the list scan noticeably slower (measured in refine).
- [ ] **AC8** — The example demo (or a trimmed copy) is a test fixture.

## Open Questions

- **Q1** — Which mods are in scope? Recommendation: OpenTDM first (the example), with a generic
  fallback; CTF (`red`/`blue` via skins) as a follow-up story if wanted.
- **Q2** — Show spectators in their own collapsed group? Recommendation: yes, collapsed.
- **Q3** — Are the extracted teams also used for the list's player search and the `sides` filter, or
  only in the detail? Recommendation: written into the index so search can use them.
- **Q4** — Is the example demo fine to commit as a fixture (it names real players)? Ask the user.

## Decisions (Sprint)

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
