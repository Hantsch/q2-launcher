---
sprint: S02
status: in-progress
branch: sprint/S02
milestone: Config module — remaining scope (docs/concepts/config-module.md)
---

# Sprint S02 — Config module completion

## Goal

Finish the config module concept: a profile's bindings and alternate layers can be edited (not
just viewed), an in-session profile-switch bind reaches the game, the Advanced tab (categories,
messages, macros, symbol picker) is usable, the profile is validated against every engine it is
actually assigned to, and redundant per-mod config copies can be found and cleaned up. Once this
sprint is accepted, the config module concept is fully implemented and moves to
`docs/systems/`.

## Stories (in build order)

- [ ] 006 — Keybinding editor with alternate binding layers (built, live acceptance pending)
- [ ] 007 — In-session profile-switch bind (built, live acceptance pending)
- [ ] 008 — Advanced tab — categories, messages, macros, symbol picker (built, live acceptance pending)
- [ ] 009 — Multi-engine validator (built, live acceptance pending)
- [ ] 010 — Cleanup of redundant per-mod config copies (built, live acceptance pending)

## Notes

Order matters: 007 (profile-switch bind) reuses the self-rewriting alias-pair mechanism 006
builds for toggle layers, so 006 goes first. 009 (validator) checks alias/message content that
006 and 008 introduce, so it comes after both. 010 (cleanup) is independent and closes the
sprint.

This is the second and — per the concept — last planned sprint for the config module (S01:
[docs/sprints/S01](../S01/sprint.md), accepted 2026-08-16). CFG-7 (keyboard/overview tab) is
already built ad-hoc outside the story flow (`9b04099`, `54ca35f`, `9259a24` on `dev`) and is
not repeated here.
