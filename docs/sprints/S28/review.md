# Sprint S28 — Review

**Goal:** a demo plays in Q2PRO while the launcher drives it from a timeline and a console field; the config profile can bind demo actions and record every map automatically.

**Merge note:** the regression gate is green apart from 4 pre-existing failures and one unattributed flake (see below). Nothing blocks the merge.

## Overview

| Story | Status | Commit |
| --- | --- | --- |
| 159 play a demo in Q2PRO | done | c6069f9 (+ fix 5647b5a) |
| 160 copy-in / cleanup | done | 6a829c2 |
| 161 r1q2 fallback → Q2PRO-only guard | done (scope cut) | e80ca8a |
| 162 mvd2 plays and seeks | done | 29f2e90 |
| 163 playback session pipes | done | f748d10 |
| 164 launcher speaks to a running demo | done | db393e2 |
| 165 timeline | done | e4f852c |
| 166 console command field | done | 2b49e08 |
| 167 demo actions bindable | done | 879c67d (+ fix 89ef511) |
| 168 auto-record | done | 9f0a558 |

## Implemented stories

- **159** Play in the detail panel for the active Q2PRO installation; disabled with a visible reason otherwise (not Q2PRO, mod missing, Steam, game running…).
- **160** Demos from elsewhere are copied to `demos/_launcher/`, removed after the game exits, swept at startup; zip entries extracted.
- **161** Cut by the user to "Q2PRO only": tests pinning that non-Q2PRO installs never launch demos and `demomap` never appears.
- **162** MVD2 (plain and `.gz`) plays; `demoSeekCommand` uses `seek` for both formats; MVD2 note in the detail panel.
- **163** `LaunchService` playback option (main-only stdio pipes); normal launches unchanged.
- **164** Playback channel: Windows cfg polling, Linux stdin/stdout, 250 ms position events, `playback.state`.
- **165** Timeline strip in the Demos view: play/pause, jumps, seek bar, speed; stub engine speaks the real transport.
- **166** Console field with a shared line validator; Windows commands go into a per-sequence cfg, never into the guard string.
- **167** `Demo playback` catalog category (unbound), speed `if`-chain, migration v4, seek/speed disabled with reason on r1q2 profiles.
- **168** Composite auto-record switch in Settings (r1q2 `cl_autorecord`, Q2PRO `cl_beginmapcmd` + `com_time_format`).

## Findings & decisions

- **User decisions:** Q2PRO-only playback for now (161 cut, no r1q2 fallback); the active installation must be Q2PRO, else a notice (no tie-break); timeline in the Demos view only; seek/speed disabled with reason on r1q2 profiles; auto-record appends with `;` into `cl_beginmapcmd`, as a composite setting, plain `.dm2`; console is send-only.
- Technical open questions (steps, length cap, history, position source, interval, followed player, seek verb, detached/Windows pipes) were delegated to the refine agents rather than asked; each is recorded with a reason in its story.
- 165 refines "Demos view only" to a full-width strip inside that view that disappears when the game exits; it also added a CLAUDE.md deviation row (36px transport buttons).
- 163/164: launcher quit destroys the pipes; on Linux an engine that does not ignore SIGPIPE could die on its next print — mitigated by `set sys_console 0` before release, residual risk accepted.
- Story 157's AC6 (rename while playing) can now be e2e-proven; not done here.
- Linux paths (159 AC7, 164 Linux channel, stub-engine stdin/stdout branch) are proven by unit/component tests only — flows run on Windows.
- Low, unfixed (167): speed-row alias names are long and truncate; a conflict marker can hide a row's unavailable-reason text.
- Trail hygiene: 160's trail has a duplicate `story · done` line; build agents wrote minute-precision stamps for some events (monotonic).

## Blocked / open

None. Unattributed flake: `servers-scan-settings` (red once in two gate runs).

## Regression gate

See `sprint.md` → Regression gate. Regressions from this sprint (167 ×2, 159 ×1) were found and fixed; 4 pre-existing failures (`replays-extra-folders`, `servers-filter-search`, `servers-master-sources`, `servers-sort-order`) reproduce at the sprint base; one unattributed flake.

## Acceptance

Every story's criteria map to named tests in its `## Done` section (unit, component and `ui:flow` flows: `replays-play-q2pro`, `replays-play-mvd2`, `replays-copy-in*`, `replays-timeline`, `replays-console-command`, `demo-actions-bind`, `autorecord-setting`).
Manual residue: see `testplan.md` (164 latency/CPU/map change; 167 pressing a bound key in a real demo).
Covered below the real surface: Linux behaviour (159, 164); 161's guards (unit level, no user action); 168 AC5 (vanilla disabled) by component test.

## Tier record

| Story | Ds | hard | review | cycles | agents | build min |
| --- | --- | --- | --- | --- | --- | --- |
| 159 | 3 | 1 | default | 0 | 6 | 19 |
| 160 | 4 | 1 | default | 1 | 6 | 20 |
| 161 | 1 | 0 | default | 1 | 5 | 4 |
| 162 | 3 | 0 | default | 1 | 5 | 9 |
| 163 | 2 | 1 | default | 1 | 4 | 10 |
| 164 | 4 | 1 | default | 1 | 8 | 19 |
| 165 | 4 | 1 | default | 1 | 8 | 37 |
| 166 | 4 | 1 | default | 1 | 7 | 16 |
| 167 | 5 | 1 | default | 1 | 8 | 75 |
| 168 | 3 | 0 | default | 0 | 5 | 30 |
| **Total** | **33** | **7** | 10× default | 8 | 62 | 239 |

No second-stage (hard) reviews were used, so there is nothing to compare. The gate, not review, caught the 167 and 159 regressions.

## Changelog

Every user-facing story (159, 160, 162, 165, 166, 167, 168) added its CHANGELOG entry during build; none were late.
