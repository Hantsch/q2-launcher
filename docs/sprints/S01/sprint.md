---
sprint: S01
status: in-progress
branch: sprint/01
milestone: Config module — foundation (docs/concepts/config-module.md)
---

# Sprint S01 — Config module foundation

## Goal

Prove the central-profile model end to end: create a profile in the launcher's own design
system, assign it to real installations with a default, edit its cvars, save, and see the
correct `config.cfg`/`autoexec.cfg` land on disk (with backup) for every non-running assigned
installation — or import an existing config as the starting point instead of building one from
scratch.

## Stories (in build order)

- [ ] 001 — Config module scaffold and central profile store (built, live acceptance pending)
- [ ] 002 — Profile-installation assignment and default profile (interrupted: session limit, WIP committed, resume with /sprint 01)
- [ ] 003 — Settings/cvar editor with per-engine defaults and clamps
- [ ] 004 — Write profile to assigned installations on save
- [ ] 005 — Import an existing config into a new profile

## Notes

This is the first of (at least) two sprints for the Config module — see
[docs/concepts/config-module.md](../../concepts/config-module.md). Not covered here, planned
for a follow-up sprint once this foundation is built and accepted: keyboard/overview tab with
test mode, alternate binding layers, advanced tab (categories, messages, macros, symbol
picker), the multi-engine validator, cleanup of redundant per-mod config copies, and the
in-session profile-switch bind (F9-style cycle + console echo).

Story 005 (import) is ordered last because it is independent of 002–004 in principle, but
verifying its result as a *usable* profile benefits from assignment/write already working.
