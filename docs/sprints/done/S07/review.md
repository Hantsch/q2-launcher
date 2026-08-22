# Sprint S07 review — The written file stops looking machine-generated

## Overview

Goal: a saved profile no longer carries dead alias lines or uuid-fragment names, is grouped
into readable, commented sections instead of a flat sorted dump, and importing a real
hand-written config turns into real Controls entries instead of preserved lines.

| Story | Status | Commit |
| --- | --- | --- |
| 038 — No alias line for an action the engine can bind directly | done | `28e337f` |
| 039 — Aliases get readable names I control, and must be unique | done | `3bcf055` |
| 040 — The profile file is written structured, commented and human-readable | done | `4d078d7` |
| 041 — Import understands aliases, press/release pairs and unbindall | done | `7ec292b` |

All four stories in the sprint are done. No story is blocked.

## Implemented stories

**038** — The writer no longer emits an `alias` line for an action whose mirrored bind value is
its own command and whose alias name nothing references (the exact `q2l_a_attack_3137`-style
dead-line case). A shared reference graph (`src/shared/config/alias-references.ts`) replaces a
duplicated ad-hoc scan inside Care's validator, and a committed fixture corpus asserts the
invariant across profile shapes, not just one hand-built case.

**039** — Alias names are now derived from the entry's display name (`SSG + SG` → `ssg_sg`),
overridable, and unique within a profile (a collision is a Care warning, never an auto-appended
counter suffix). Mirror ownership — "did our own write pass produce this bind value" — no longer
depends on the `q2l_a_` name prefix; it now rests on the key-scoped rule story 034 introduced,
plus a demoted *legacy-format* marker for migrating old profiles. This was the highest-risk
story in the sprint (five call sites depended on the prefix as an identity test) and needed four
build/review rounds before the mechanism held under adversarial re-verification — see Findings.

**040** — The profile `.cfg` now renders as commented, banner-separated sections (player/mouse/
etc. cvar groups, aliases by category, one section per modifier/hold layer, binds grouped by
category) with column-aligned values and a trailing `// <display name>` comment on every
generated line, instead of one flat sorted dump. Output stays byte-identical/deterministic.
`unbindall` at the top of the file is now a per-profile setting (default on), exposed as a
checkbox in the Raw File tab — new scope added mid-sprint by user decision, beyond the story's
original sketch.

**041** — `config-parser.ts` now parses `alias` definitions (including press/release pairs,
alias-to-alias chains in any definition order, and `unbindall` in file order across `exec`
chains) into real Controls entries instead of preserving them as opaque text. Importing the
user's own real `dm.cfg`/`dmalias.cfg`/`gfx.cfg` (now committed fixtures under `docs/fixtures/`)
turns ~90 previously-preserved alias lines into 96 real actions, with only comment/banner/
genuinely-unparseable lines still preserved verbatim.

## Findings & decisions

- **Story 039 needed four fix rounds**, not one. Two independent `story-review-hard` passes each
  found a real, reproduced regression after a prior pass self-reported "done": a self-referential
  alias line (`alias weapnext weapnext`) that the naming change could newly produce, first for a
  single-command body, then for a multi-command body, then for a chunked-action edge case in the
  cycle-detection carve-out itself. Each hole was only found by actually rendering constructed
  profiles and running the real validators against them — reading the diff was not enough. Take
  this as the standing bar for any future story touching the mirror/alias-render mechanism:
  self-reported "done" on this code path is not trustworthy without an adversarial re-render pass.
- **User decision, recorded in 039's story file:** when an action's own command list contains a
  segment that collides with its own alias name but the body has *other* real commands too, the
  writer must keep the alias line (never silently drop content) and surface a new Care finding
  (`aliasSelfReference`) instead — the launcher's user decides whether to fix it, not the writer.
  This is now the standing rule for that shape.
- **New scope added mid-sprint (040):** `unbindall` became a per-profile setting rather than a
  fixed header line, per user decision during the clarification round. Also decided during that
  round: bind grouping is by action category (not keyboard region, avoiding a code move out of
  the renderer), and deliberately empty binds are now dropped rather than written.
- **New scope added mid-sprint (041):** colour cvars used as `$r`-style text variables in chat
  messages are now recognised and rendered as colour codes by the message editor, per user
  decision — larger than the story's original "keep as ordinary cvar" fallback option.
- **Deferred by user decision, not silently dropped (041):** the `alias cali "bind KP_END ...;
  ..."`-style construct (an alias that rebinds keys, functionally a toggle layer) is not
  auto-classified. The import flow asks the launcher's user whether to treat it as a plain alias
  or attempt it as a layer.
- **Backlog note (041):** self-rewriting toggles and `wait` chains import as plain, opaque alias
  entries. The user noted a dedicated alias-management menu is wanted for these to become
  first-class UI entries — not built this sprint, already tracked by stories 044/045.
- **Fixtures added:** `docs/fixtures/dm.cfg`, `dmalias.cfg`, `gfx.cfg` — the user's own real,
  ~20-year-old DM config — are now committed and are what story 041's import acceptance criterion
  is verified against.

## Blocked / open

None. All four sprint stories are done. 042 (round-trip losslessly) and 043 (`.cfg` becomes
source of truth) remain deliberately held back per the sprint's own scope note, pending a
decision round before refine; 044/045 remain unscheduled.
