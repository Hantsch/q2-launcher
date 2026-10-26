---
id: 261
title: The demo players are split by team
status: draft # draft -> ready -> in-progress -> done
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

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
