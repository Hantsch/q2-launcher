---
sprint: S05
status: in-progress # planned | in-progress | done
branch: sprint/S05
milestone: Config module — profile-as-a-file (docs/systems/config-module.md)
---

# Sprint S05 — A profile is a file, not a bookkeeping tab

## Goal

A config profile is a real `<name>.cfg` that exists the moment the profile does, kept in sync
automatically, readable with real Quake II syntax highlighting from a single viewer used
everywhere a config's text is shown, and the maintenance side of a profile (validation, sync
state, tidy-up actions) lives in one Care tab instead of being split across Validation, Write
targets and a "Preserved lines" side tab.

## Stories (in build order)

<!-- Order = the order the build phase works through. Dependent stories go last. -->

- [x] 022 — A profile is a real `<name>.cfg` that exists before any assignment
- [x] 023 — Raw File absorbs Write targets — see and open the profile's file anywhere
- [ ] 024 — Read the config in the launcher with Quake 2 syntax highlighting
- [ ] 025 — Validation becomes Care — report, tidy-up actions and sync state in one place

## Notes

Dependency-driven order, not size-driven:

- **022 first** — the on-disk data model (canonical `<name>.cfg`, per-installation sync state,
  rename/collision handling). 023 and 025 both render data 022 produces.
- **023 before 024** — 023 introduces the Raw File viewer that 024 then highlights; building the
  highlighter before the viewer it replaces the plain `CodeBlock` in would have nothing to attach
  to.
- **025 last** — folds in Preserved lines and the story 010 mod-copies cleanup, and renders 022's
  per-installation sync/retry state, so it depends on the most upstream work of the four.

All four stories are drafts filed 2026-08-19 (`37cef54`) with real open questions still
unresolved (see each file's `## Open Questions`) — `/refine`'s clarification round is expected to
do real work here, not just flip `status`. Two cross-story open questions worth resolving once,
not four times: where the launcher-owned canonical file lives (userData vs. a visible "profiles"
folder), and where the played-mods per-installation selection is configured once the Write
targets tab is gone (022/023 both ask this).

Scope boundary carried over from S04: this sprint is the on-disk/schema rework, deliberately not
mixed with the UI-polish backlog (029 drop-message checkbox, 030 titlebar, 031 Downloads rename,
032 Downloads badge, 033 planned-module copy) or the still-unfiled `RawConfigPanel` config-raw
crash — those are candidates for S06.
