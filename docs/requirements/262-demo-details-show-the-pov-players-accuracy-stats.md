---
id: 262
title: Demo details show the POV player's accuracy stats
status: draft # draft -> ready -> in-progress -> done
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

## Plan

## Deliverables

## Model Hints

## Acceptance Tests

## Done
