# Sprint S08 — Review

## Overview

Goal: a profile file carries everything the launcher knows about it, so it survives being taken
to another machine and imported back; and the file — not `state.json` — becomes the profile's
source of truth. Plus two guardrails the repo still owed: no `'unsafe-inline'` in the production
CSP, and no unscreened authoring surface left in `ui:verify`.

| Story | Status | Commit |
| --- | --- | --- |
| 046 — production CSP drops `'unsafe-inline'` | done | `046: drop 'unsafe-inline' from production style-src, wire CSP-violation gate into ui:verify` |
| 047 — MessageEditor joins the screen registry | done | `047: message editor, remove/detect dialogs join the screen registry` |
| 042 — profile file round-trips losslessly | done | `042: profile files round-trip losslessly through launcher metadata tags` |
| 043 — .cfg becomes the source of truth | done | `043: the .cfg file becomes the source of truth, state.json becomes a cache` |

All four stories in the sprint list are done. No blocked or carried-over stories.

## Implemented stories

**046** — `style-src` in the production CSP dropped `'unsafe-inline'`; `DEV_CSP` is unchanged for
Fast Refresh. `ui:verify`'s harness now gates its exit code on both live CSP-violation events and
the served header itself, closing a gap where violations were collected but never actually failed
the run. `docs/ARCHITECTURE.md` names the permitted dynamic-style mechanism (React's `style` prop
/ CSS custom properties) so the token does not quietly come back.

**047** — `MessageEditor`, `RemoveInstallationDialog` and `DetectDialog` joined the screen
registry (18 → 22 screens), closing every named `ui:verify` blind spot. A real label-association
defect in `MessageEditor` was fixed with the existing `Field`/`useId()` helper rather than a local
workaround, and the fixture profile grew a message action and a colour cvar so the `$r` rendering
story 041 added is now visible in the committed screenshots.

**042** — A versioned `[q2l ...]` trailing-comment tag on each bind/alias line, plus fixed-anchor
category section headers (up to two levels, style-configurable), carry display name, kind,
catalogue id, slot pairing/modifier, category and layer membership through
`render → parse → restore` as a fixed point. The profile `id` is never adopted from an imported
file; the import dialog now distinguishes "restore" from "best-effort". This story needed **eight**
adversarial review/fix rounds — consistent with the carry-over precedent story 039 set in S07 for
this exact code path (`src/shared/config/alias-references.ts`-adjacent mirror/render logic) — and
was interrupted once mid-build by an API session limit, resumed cleanly from the progress trail.

**043** — Inverts sync-engine decision 8 for the canonical file only: explicit Save replaces
write-on-every-keystroke, a re-read-before-write gate keyed on the file's real on-disk hash (not
just a dirty flag) refuses to clobber an unread hand-edit, external edits are either silently
adopted (profile has no unsaved changes) or surfaced as a two-pane conflict (it does), a deleted or
corrupt `state.json` record rebuilds from its file with the same id, and existing profiles migrate
to the current file format once on first run. An adversarial pass beyond the per-deliverable tests
found and fixed three real defects: a hand-edit-clobber race reachable through
`assign`/`setDefault`/rename-cascade/the startup retry sweep, `refreshFromFiles` resolving a
profile's file by stale name instead of ownership sentinel, and a corrupt/binary file being
silently adopted over the last good cache instead of reported `unparseable`.

## Findings & decisions

Aggregated from `## Decisions (Sprint)` across the four stories, build feedback and review
findings — input for future sprint planning:

- **Metadata format (042, user decision):** a trailing `[q2l k=v ...]` tag at the end of the
  `//` comment already on each config line, not a separate line or an end-of-file block. Category
  sections are their own comment headers preceding a group of bindings (up to two levels, matching
  `dm.cfg`'s "Main Key's" / "1st row" structure), not a per-entry tag — and the header decoration
  is a user-configurable per-profile setting (`sectionHeaderStyle`).
- **Source-of-truth mechanics (043, user decisions):** change detection is a re-read on focus/tab-
  open/before-write, not `fs.watch`; write cadence became an explicit Save (a real UX change from
  the prior auto-write-on-keystroke behaviour); conflicts are shown whole-file, not per-entry; the
  cache stays inside `state.json`; a profile whose file was deleted outside the launcher is an
  error state awaiting a decision, not an auto-delete.
- **Adversarial review is now the expected cost of touching this code path, not a sign of trouble.**
  042 took eight review/fix rounds, 043's closing pass still found three real cross-cutting bugs a
  per-deliverable test plan did not surface (a save-path race, a stale-name lookup, and a silently-
  adopted corrupt file). Both stories budgeted for it up front per the sprint's carry-over rule and
  neither self-certified "done" from a single diff read.
- **Known, accepted limitations, documented rather than silently left (042):** a `dashes`-style
  section title that both fills the banner width exactly and ends in a decoration-shaped run is
  indistinguishable from one with fill stripped; a hand-appended alias positioned after a file's
  last layer section is not recovered; an untagged comment starting with a reserved category-title
  prefix (`Aliases:` / `Binds:` / `Entries:`) is read as a real section header even if it is not.
- **Known, accepted limitation (043):** keyless catalogue entries cannot round-trip (a 042 format
  constraint), and a hand-added free-text comment is not adopted into the cache on a refresh.
- **Process note:** one build agent hit a mid-session API limit during story 042 and had to be
  resumed by a fresh agent reading the story's own progress trail — the trail
  (`docs/sprints/S08/progress.md`) proved sufficient to resume without losing state or redoing
  finished work, validating the "state lives in files" design of this workflow.

## Blocked / open

None. All four stories are done, verified (`npm run build`, `npm test` — 1612 tests, `npm run
typecheck`, all green) and passed a live `npm run ui:verify` smoke run (0 critical/serious/
moderate/minor axe violations, 24/24 screens, 48/48 screenshots) as their closing gate.

Per this workflow's own acceptance rules: **"done" here means build/test/typecheck green plus a
passing live UI smoke run — it is not yet a user-performed manual acceptance pass.** See
`testplan.md` for the manual acceptance steps; the milestone's roadmap entry is marked "built,
acceptance pending" until the user runs them.
