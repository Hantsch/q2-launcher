# Sprint S10 review

## Overview

**Goal:** close the "Config, round two" milestone. Shrink the `[q2l …]` metadata tag to the
non-derivable minimum (050), then land toggle/press-release/`wait`-chain idioms as first-class
entries the launcher understands and can render, on top of that reduced tag (045).

| Story | Status | Commit |
| --- | --- | --- |
| 050 — The metadata tag carries only what the file cannot say | done | `7212f6a` |
| 045 — Toggles, press/release pairs and wait chains as first-class entries | done | `6739f9d` |

Both stories done, both committed on `sprint/S10`. `npm run build`/`test` (2043 tests)/`typecheck`
green on the branch tip. Live `npm run ui:verify` smoke pass was **not** run this session — see
"Blocked / open" below.

## Implemented stories

**050 — The metadata tag carries only what the file cannot say.** The `[q2l …]` comment shrinks
from `e`/`k`/`slot`/`cid` to just `cid` (plus `an`/`key`/`mod` on an anchor line, or a bare
`[q2l]` marker with none of those). Entry identity on read now comes from the config text itself —
alias name, bind value, or (for a modifier-only slot with no `bind` line) the entry's own prose
display name — instead of an opaque hash ref. Key slots move from a hardcoded two-slot model to an
uncapped `ConfigAction.keys?: ActionKeySlot[]` array recovered from file order, through one new
accessor module (`src/shared/config/action-slots.ts`). Per user decision, no `META_FORMAT_VERSION`
bump and no pre-050 tag-format compatibility requirement — this is a pre-release app with no
installed base to migrate.

**045 — Toggles, press/release pairs and wait chains as first-class entries.** Two new
`ActionEntryKind`s (`toggle`, `press-release`) and a real `wait` command kind
(`{ kind: 'wait'; frames }`) turn three idioms every hand-written Quake II config uses — alias
reassignment toggles, `+x`/`-x` hold pairs, and `waitN` frame-count helpers — into entries the
launcher renders, edits and imports natively instead of holding as opaque alias rows. A new shared
recogniser (`src/shared/config/entry-idioms.ts`) detects all three shapes out of plain config text,
used by both story 041's foreign-config import and story 042's own-file restore, since 050 removed
the tag field (`k`) that could otherwise have carried the kind. Care gained three findings for the
shapes a broken idiom degrades to (`toggleCrossWired`, `pressWithoutRelease`,
`releaseWithoutPress`).

## Findings & decisions

**The carry-over rule held again, on both stories.** `sprint.md`'s standing rule for
`alias-references.ts`-adjacent render/parse/mirror code — do not trust a "done" self-report without
an adversarial re-render pass against constructed edge-case profiles — was necessary both times.
050's build needed **3 full review-fix cycles**: round 1 found 8 confirmed issues including two
real data-loss bugs (an anchor prefix-match that silently merged two distinct entries, losing one's
name/commands/keys with no warning; a `MessageEditor` save path that silently dropped a key's
modifier); round 2 found the fix for the alias-name-collision case was still dead code on the path
it needed to cover (the warning was wired downstream of where the actual data loss happened); round
3 found the fix for *that* was itself only wired to one of three adopt paths (Care → Sync → Reload
and "Take the file" still adopted silently). 045's build also needed 3 full cycles, catching a
truncation-triggered round-trip break, Care checks blind to bound (not just orphaned) broken
shapes, unchecked generated-name (`_s1`/`_s2`) collisions, a `parts`-contract violation, an
incomplete cross-wire check, and a chunk-boundary `wait`-collapse bug — several of these only
surfaced because each review round re-verified the *previous* round's fix through the real
render→import/restore pipeline rather than trusting the fix agent's self-report or reading the
diff.

**Both stories hit their 3-cycle review-fix budget with one item each left over, both documented
as accepted residual limitations rather than chased into a 4th cycle:**
- **050:** two entries in the same category whose display names derive the same alias slug (e.g.
  both named "Fire") still cause a genuine loss at the Quake II engine's own alias-name fold — the
  file itself is ambiguous, not just the reader. Mitigated (a `droppedAliases` warning now fires on
  every adopt path — reload, sync, take-the-file, plus a startup log line), but not eliminated;
  documented in `docs/systems/profile-file-format.md` as "the one lossy shape".
- **045:** three entries whose full, never-truncated display names form a literal prefix chain
  (e.g. "Creep" / "Creep along" / "Creep along slowly") can still merge on restore under specific
  line-length conditions. Reproduced only via an adversarial sweep (46 hits out of a large
  constructed set), not from any fixture, generated name, or realistic UI path. Two mitigations
  (line-order tie-break, or a `RestoreWarning` on merges that required proving a truncation cut
  rather than finding exact prose equality) are sketched in story 045's `## Decisions (Sprint)` for
  a future story if this proves to matter in practice.

Both residual limitations trace to the same root cause: story 050's binding decision (the User's,
in the sprint clarification round) to make an entry's own prose text its restore-time identity,
rather than a synthetic ref field. That decision was made deliberately and accepted its own
drift-on-rename case ("the user's own mistake"); these two findings are further, narrower
consequences of the same tradeoff, not new design mistakes.

**Clarification-round decisions (binding, recorded in each story's own file):** 050 — anchor
identity via the entry's own prose display name (not `cid`/`an`); key-slot model extended to an
arbitrary number of slots per entry, not capped at two; no version bump, no old-tag-format
compatibility. 045 — toggle is its own `ActionEntryKind`, not a bind flag; no runtime/in-game
toggle-state tracking (always "state 1 after exec"); press/release sits next to the existing
hold-layer mechanism, does not replace it; `wait` is a real command kind, not just an editor
helper.

**Scope note:** the model refactor 050 needed (`ActionAction.keys[]` replacing the four
`key`/`secondary*` fields) touched far more files than either story's own diff would suggest —
every shared/renderer consumer of a key slot. This is the kind of foundational-format story this
milestone was scoped to absorb (see S08's review for the same pattern with 042/043); nothing here
suggests future format stories will be smaller.

## Blocked / open

Nothing is blocked. Both stories are `done`, committed, and merge-ready pending the live UI
acceptance pass below.

- **Live smoke (P2) not run this session.** Neither story's UI path was driven through the real
  running app (`npm run ui:verify`) — both are flagged **built, live acceptance pending** rather
  than fully accepted. `testplan.md` gives the exact manual steps.
- **045's one residual limitation (prefix-named-entry-triple collision on AC6)** — accepted as
  documented, not blocking, but worth a user decision on whether it's worth a future story's line-
  order or warning-based mitigation (see story 045's `## Decisions (Sprint)`).
- **This closes the "Config, round two" milestone** as scoped in the roadmap (038-045, 048-049,
  050 all done across S07-S10). No stories from this milestone remain unscheduled.
