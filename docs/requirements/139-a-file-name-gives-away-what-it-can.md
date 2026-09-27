---
id: 139
title: a file name gives away what it can
status: draft # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

The demo content does not store a date, a hostname, teams or a gamemode (concept
`docs/concepts/demo-browser.md` §6.3) — but the servers that auto-record often put exactly that into
the file name. The demo browser takes a file name apart with known patterns and turns it into
**name facts**: date/time, map, players, teams, host, POV (§5, §7, DEMO-8).

This story is the pattern engine plus the v1 set of **shipped** patterns (§7):

| Origin | Pattern |
| --- | --- |
| r1q2 `cl_autorecord 1` | `%Y-%m-%d-%H%M-<map>.dm2` |
| OpenTDM | `<player>-<teamA>-<teamB>-<hostname>-<map>_YYYY-MM-DD_HH-MM-SS`, unsafe characters → `_` |
| AQ2-TNG `use_mvd2` | `YYYYMMDD-HHMMSS-<map>.mvd2` |

Q2PRO `sv_mvd_autorecord` follows the mod's own `record` name and gets no pattern of its own;
TastySpleen and Q2Admin patterns are unknown until real samples exist (§17.3) — each becomes a new
story then. The ambiguity is real: OpenTDM splits on `-`, and team, host and map names can contain
`-` themselves. **A name that cannot be parsed unambiguously yields no name facts rather than wrong
ones.** The engine is the one [[140]]'s user templates run through, so the template syntax (§17.2)
is settled here.

## Acceptance Criteria

- [ ] **AC1** — `2026-09-26-2130-q2dm1.dm2` yields date 2026-09-26 21:30 and map `q2dm1` from the
      r1q2 pattern.
- [ ] **AC2** — An OpenTDM name yields POV player, both team names, hostname, map and date/time.
- [ ] **AC3** — `20260926-213000-urban.mvd2` yields date/time and map `urban` from the AQ2-TNG
      pattern.
- [ ] **AC4** — Compression suffixes are ignored for matching: `x.dm2.gz` matches as `x.dm2` would.
- [ ] **AC5** — A name that matches a pattern in more than one way (e.g. an OpenTDM name where a
      `-` inside a team or host name allows two splits) yields no name facts, and a test pins that.
- [ ] **AC6** — A name that matches no pattern yields no name facts, and the result says which
      pattern (if any) matched, for [[148]]'s source display.
- [ ] **AC7** — The shipped patterns are expressed in the same template syntax users write in
      [[140]], and the syntax (token vocabulary, date formats, separators) is documented in the
      concept (§17.2 resolved).
- [ ] **AC8** — The engine is pure shared code with a unit test per shipped pattern.

## Open Questions

- [ ] **Q1 — Template syntax** (§17.2): token vocabulary (`{date}`, `{time}`, `{map}`, `{p1}`,
      `{teamA}`, `{host}`, `{pov}`…), how date formats are written, and how separators that also
      occur inside values are handled.
- [ ] **Q2 — Several patterns match unambiguously but differently** — first wins in a fixed order,
      or no facts?

## Plan

<!-- Filled by /refine 139, once the Open Questions above are resolved. -->

## Deliverables

<!-- Filled by /refine 139. -->

## Model Hints

<!-- Filled by /refine 139. -->

## Acceptance Tests

<!-- Filled by /refine 139. -->

## Done

<!-- Filled by /build 139. -->
