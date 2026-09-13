# Sprint S12 review — The file is the hero

## Overview

**Goal:** the rendered `.cfg` opens with a small name card instead of a technical header,
Settings mirrors the file's own cvar sections (every cvar in the profile has a row, catalogue or
not), and the Raw file tab becomes an editor first — the code view gets the space, the admin
around it shrinks to a toolbar, and a quick change can be typed straight into the file and saved.

| Story | Status | Commit |
| --- | --- | --- |
| 051 — The file header is a small banner | done | `051: file header is a small banner, not a technical block` |
| 059 — Settings mirrors the file's own sections | done | `059: Settings mirrors the file's own cvar sections` |
| 057 — Raw file is an editor first, and I can edit inline | done | `057: raw file tab is an editor first, with inline editing and a real save path` |

All three stories built in the planned order (051 → 059 → 057) on `sprint/S12`, cut from `dev`.
`npm run build` / `npm run typecheck` / `npm test` are green at the sprint's final commit (2458
tests); `npm run ui:verify` is clean (0 axe violations across all screens) and the `ui:flow`
scripts for each story (settings section rename + add cvar, raw inline edit) pass against the
real running app.

## Implemented stories

**051 — file header.** The header is now four lines: a rule, the profile name (fixed launcher
look, no reference to section style), a rule, and the `[q2l v=1 id=...]` tag alone on its own
last line, right-aligned so it reads as a deliberate stamp rather than a dump. No id in prose, no
duplicated sentence, no tagline. Ownership detection, ownership migration on save, rebuild-from-
file and the round-trip property all go through one new shared module
(`src/shared/config/file-ownership.ts`) instead of three separate line-1 checks. A file carrying
the old (S10) header is still recognised and is rewritten to the new shape on its next save.

**059 — Settings mirrors the file's sections.** Settings now has a real, user-owned two-level
section model (`profile.cvarSections`, mirroring Controls' category/sub-category model from
052/053) instead of the fixed Player/Network/Graphics/Sound grouping. Every cvar in the profile
has a row — catalogue cvars keep their rich row, non-catalogue cvars get a plain name/value row.
Sections can be created, renamed, reordered, deleted and moved between; import files each cvar
under the section it was found in. Story 048's always-written catalogue defaults are now governed
by a per-profile toggle ("Write unset catalogue defaults", default on) that only affects
unplaced catalogue cvars in an imported profile, landing them in a reserved trailing "Defaults"
section when on.

**057 — Raw file is an editor first.** The code view now fills the tab's available height (no
16rem cap) and is editable in place via a hand-rolled transparent textarea over the existing
tokenised `<pre>` (keeps the production CSP's `style-src 'self'` intact — no CodeMirror, no
runtime `<style>` injection). `unbindall` and the section-header-style control collapsed into one
compact toolbar; per-installation copies were removed from this tab entirely (story 058, S13,
rehomes them into Care's Sync section). A raw edit is a first-class unsaved change with its own
save-bar entry, going through the same conflict guard and `adoptFromFile` read-back as any other
save; raw editing and the structured tabs are mutually exclusive while either has unsaved changes.

## Findings & decisions

Aggregated from each story's `## Decisions (Sprint)` and the build/review feedback — input for S13
planning and beyond:

- **User decisions this sprint deliberately diverged from every story's own recommendation** on
  four separate points: 051's banner uses one fixed launcher look (not the profile's section
  style) and puts the `[q2l ...]` tag on its own last line (not the name line); 059 uses two
  levels of sections (not one) and gives the user an explicit toggle for whether unplaced
  catalogue defaults get written, rather than a fixed auto-section. All four are recorded as
  `(User)` decisions in their stories.
- **059's template-profile writer output is no longer byte-identical** to before this story — a
  side effect of tags now being required for section-rename identity, which the story's own D2
  wording didn't anticipate as a conflict. Documented as a deliberate, accepted tradeoff in the
  story's Done section; worth a sentence in the profile-file-format doc if a future story touches
  template rendering again.
- **059 found a real IPC cap bug**: the cvar-name-list payload cap was 64 (meant for
  section/sub-section *count*, not list *length*), which silently broke every Settings edit on a
  profile with more than 64 cvars — i.e. exactly the real-world imported profiles (`dm.cfg`) this
  story exists for. Fixed; worth checking other list-shaped IPC payloads for the same count/length
  mix-up.
- **057 found and fixed a real conflict-guard bypass**: the raw-edit focus-resume file-refresh
  path could silently overwrite an in-progress raw draft, bypassing the same conflict dialog every
  other save path already goes through. Caught only in review round 2, after round 1 had already
  passed a different fix — same lesson S08–S11 already established: verify the *previous* round's
  fix through the real pipeline, don't trust a diff read.
- **057 left one accepted residual limitation**: no confirm dialog when navigating away from an
  unsaved raw draft loses it (documented, not blocking); the `config-raw` axe-wait timing gap is
  also carried forward as non-blocking.
- **Carry-over rule held again** (render.ts / profile-restore.ts-adjacent code): 051 and 059 both
  needed an adversarial re-render pass to catch real bugs before they'd have shipped — 051's
  blank-profile-name trailing-whitespace line, 059's cap bug and first-vs-last cvar-attribution
  mismatch against the literal `dm.cfg` acceptance criterion.
- **A dev-environment fix landed as part of 057**: a genuine jsdom/Node-20 incompatibility was
  silently skipping the hard-tier D5 test file; fixed via `patch-package` (new `patches/` dir,
  `postinstall` script). Not a story requirement, but a real gap in the safety net that was worth
  closing rather than working around.

## Blocked / open

None. All three stories built, reviewed and passed live smoke in this sprint — no story was
blocked or left in `draft`/`in-progress`.

Per the profile's live-smoke policy: all three stories had their user-facing paths driven through
the real running app (`ui:verify` + a dedicated `ui:flow` script each for 059 and 057; 051's
`config-write-preview` screen for the header). They are **built and live-smoke-tested this
session**, but formal user acceptance (the manual pass in `testplan.md`) is still the user's to
run and confirm — same status language as every prior sprint's review.
