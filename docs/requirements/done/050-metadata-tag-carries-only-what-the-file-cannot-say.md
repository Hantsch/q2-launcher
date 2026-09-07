---
id: 050
title: The metadata tag carries only what the file cannot say itself
status: done
created: 2026-09-03
---

## Requirement

The `[q2l …]` tag story 042 added to every generated line has grown into noise. A player opening
their own `.cfg` sees this on each bind:

```
bind mouse1 "+attack"   // Attack [q2l e=b8df77ed k=bind cid=movement:attack slot=1]
```

Three of those four fields carry nothing the file does not already say, or nothing anyone needs:

- `e` — an opaque 8-hex ref. Unreadable, unexplainable to the person whose file it is, and only
  there to pair the two lines of a two-key entry.
- `k=bind` — it is a `bind` line. The kind is visible from the line itself, and the reader already
  has a function that derives an entry's kind from its body (`entryKindFor`, story 041).
- `slot=1` — irrelevant. A command may be bound as often as the player likes, and file order
  already says which one comes first. First occurrence is slot 1, the next one slot 2.

What must stay is the part the config syntax genuinely has no place for: the catalogue link, the
display name, category and layer membership, and — for a modified key that has no `bind` line at
all — the anchor's key and modifier.

Goal: the tag shrinks to the non-derivable minimum, and slot identity comes from the order the
lines appear in the file instead of from a field. The file stays lossless in the story-042 sense
(render → parse → restore is still a fixed point), and a file written by the current version still
imports.

## Acceptance Criteria

- [x] `e`, `k` and `slot` no longer appear in any tag the renderer writes.
- [x] The bind line above renders as `// Attack [q2l cid=movement:attack]`.
- [x] An entry's key slots are recovered from file order: the first line claiming a key for that
      entry is slot 1, the second is slot 2.
- [x] Two `bind` lines running the same command are paired back into one entry with two keys — no
      ref field involved.
- [x] A modified key slot's anchor line still identifies its entry and still carries its key and
      modifier, without `e`/`slot`.
- [x] Story 042's round-trip property still holds on the whole fixture corpus: render → parse →
      restore → render is byte-identical.
- [ ] ~~A file written by the *current* (pre-050) format still imports with the same result as
      before — old tags are read, the dropped keys are ignored rather than reported as unknown.~~
      Dropped by user decision (see Decisions (Sprint)): pre-release app, no old format to support.
- [x] `docs/systems/profile-file-format.md` describes the reduced key registry, the order rule and
      the per-entry multi-slot model; the removed keys are named as removed, with the reason.

## Decisions (Sprint)

- **(User)** Anchor identity without `e`: the anchor comment links to its entry via its own
  prose display name, not via `cid`/`an`. If the user later renames the entry's display text
  inconsistently across its lines, the anchor and the entry drift apart into two separate rows in
  the UI — accepted as the user's own mistake, not something the parser must reconcile.
- **(User)** More than two key slots: the data model is extended to support an arbitrary number
  of key slots per entry, not capped at two. This widens this story's scope beyond the original
  "drop and warn" framing — the order rule (first occurrence = slot 1, etc.) now applies to all
  slots, not just the first two.
- **(User)** No `META_FORMAT_VERSION` bump and no old-format import compatibility: the app is
  still pre-release with no real installed base, so there is nothing to migrate. The acceptance
  criterion "a file written by the current (pre-050) format still imports with the same result as
  before" is dropped — the writer and reader both move to the reduced tag shape directly, with no
  dual-format support.

- Registry after the cut: `v`, `cid`, `an`, `key`, `mod`, `cat`, `layer`, `mode`, `trigger`. `an`
  stays because an anchor-only entry has no line whose *code* could spell its alias name; `v` stays
  unchanged at 1 (no bump, per the user decision above).
- **Every entry line always emits the tag, even with no fields** (`// My Thing [q2l]`): with `e`
  gone, tag *presence* is the only thing that still distinguishes a launcher-owned bind line from a
  raw bind a user typed and commented themselves - without it such a line would come back unowned
  and move into the "other binds" section on the next render, breaking the fixed point.
- Entry identity on read comes from the config text: an alias line is identified by its alias name
  (a chunk-split `_p<n>` family folds onto its base line, which references it), a bind line by its
  bind value, and the two join when a bind value equals a grouped alias name - that is exactly the
  pairing AC4 asks for, with no ref involved.
- Anchor to entry matching: within the same section, by `cid` when the anchor carries one, else by
  exact display prose. Ambiguous or unmatched anchors become their own entry - the drift the user
  already accepted. ~~else by a *unique* prefix relationship (prose truncation is a plain prefix
  cut, `fitProseAndTag`)~~ - dropped in the story review (finding 1): the prefix relation cannot
  tell a truncated name from two sibling names that nest (`Reload` inside `Reload weapon`) and
  merged the two, losing one entry's name, commands and key with no warning; the truncation case it
  was for needs a display name of 1000+ characters, which the persisted schema's 120-char cap makes
  unreachable. The User's decision names the entry's own prose, and exact match is that.
- **Two entries deriving one alias name is lossy, and is reported at the fold, not at the group**
  (story review, finding 4, second round). `derivedAliasName` has no id suffix (story 039's
  decision - the name is the user's contract with whatever binding calls it, so a collision is
  reported by Care, never silently renamed), so `Fire` and `fire!` both render `alias fire`. Quake
  II's alias name space is flat and whole-file: the engine keeps only the last definition, and every
  reader folds `alias` lines last-definition-wins by name *before* the entry reconstruction runs, so
  the earlier body is gone before any group exists to attribute it to. Section scoping keeps the
  *groups* apart (and genuinely fixes the bind-value key space, where nothing folds anything away)
  but cannot put that body back. The first fix reported `entry-alias-duplicate` from
  `buildEntry`, which is downstream of the fold and therefore unreachable - the warning was dead
  code and the entry still vanished silently. It is now raised by the fold itself
  (`file-source.ts#foldConfig`) and surfaced on the reload path as
  `RefreshedProfileResult.droppedAliases` -> its own warning toast next to the "reloaded" notice;
  the installation-import path already listed `duplicateAliases` in the preview dialog.
  **Residual limitation, accepted and documented in `profile-file-format.md`:** this is the one
  shape the launcher can write for which story 042's fixed point does not hold - the reloaded
  profile has one entry fewer, so a re-render differs. Preventing it at the source would mean
  disambiguating alias names at render time, which contradicts story 039's decision and would rename
  a name the user may have hand-bound something else to.
- **One adopt path, not three** (story review, finding 1, third round). The second round's fix
  threaded `droppedAliases` through `refreshFromFiles` -> `ConfigView`'s toast, but `ConfigView`
  only fires on tab-open and window-focus resume: **Care -> Sync -> Reload** and the conflict
  dialog's **Take the file** each read `entry.outcome === 'adopted'` themselves and used only
  `entry.profile`, so a hand-edited alias collision adopted through either button was lost with no
  word at all - the exact silence the second-round fix existed to remove, on the two paths the
  story's own Test Plan and `profile-file-format.md` name. Both buttons now delegate their whole
  adopt to `lib/file-source-refresh.ts#adoptProfileFromFile` (its error toast and the dropped-alias
  warning included) and keep only what is genuinely theirs (`fetchSyncState`;
  `onResolved`/`onClose`); `ConfigView` builds its own warning from the same
  `droppedAliasWarning`. A future take-the-file button gets the warning by construction rather than
  by remembering to add it.
- **Known gap: no test renders the click itself.** `vitest.config.ts` runs `environment: 'node'`
  and `include: ['src/**/*.{test,spec}.ts']`; the one jsdom-based test in the repo
  (`lib/profile-changes.test.ts`) cannot run on the installed toolchain at all - jsdom 30 requires
  Node >= 22.19 and this machine runs Node 20, so `npm test` reports it as a worker-start error
  (pre-existing, unrelated to this story). The regression tests therefore drive the *handler* both
  buttons run, with `refreshProfilesFromFiles`/`pushToast` substituted exactly as each component
  passes them, and the components hold no adopt logic left to diverge. Closing the gap properly is
  a toolchain change (Node bump, or a DOM environment that runs on Node 20), not a story-050 fix.
- **The batched "Fix all safe findings" path uses the same position-preserving clear as every other
  slot-clearing path** (story review, finding 2, third round). `tidy-up.ts#applyRemoveShadowedBind`
  still used the index-shifting `clearKeySlot`, and `applyTidyUpOps` re-checks each op against the
  draft the previous ops left, identifying an action claim by `(actionId, slot)` where `slot` is an
  array index. So two ops against two slots of one action - ordinary for a re-imported profile, and
  exactly what the batch button queues - had the first removal renumber the second op's slot, which
  then came back `rejected`: one of two shadowed keys stayed bound. It now writes
  `withKeySlot(action, slot, { key: '' })`, the same clear `bind-collision.ts#releaseKey` and
  `bind-slot-collision.ts`' replace paths use (finding 5, first round), so no later slot moves and
  every op in a batch still finds the claim it was minted for.
- **The startup rebuild logs the dropped aliases it cannot toast** (story review, finding 3, third
  round). `rebuild.ts` reads a canonical file with no profile record at a point where no renderer
  exists and `ConfigProfile` has no field for a read warning, so the `entry-alias-duplicate`
  warnings genuinely have nowhere to go but `deps.log`. Only that one reason is logged: a
  metadata-stripped file legitimately produces a `tag-missing` per line, and drowning this out is
  how it went unnoticed.
- The read-side discriminator for an anchor line is the `key` field (only anchors ever carry it),
  replacing `claimsEntryRef`'s `e` check; a comment carrying `cat`/`layer`/`v` stays a header.
- Entry kind is always inferred (`entryKindFor`, story 041). `resolveKind` and the warnings
  `tag-kind-unknown` / `tag-kind-contradicted` disappear with `k`.
- Slot claims are taken in file order, bind lines before anchor lines. Consequence, accepted and
  documented in the format doc: an entry whose *modified* slot is slot 1 and whose plain slot is
  slot 2 comes back with the two swapped - both keys and both modifiers survive and the rendered
  file stays byte-identical, only the intra-entry order flips.
- Slot conflicts are structurally impossible once claims simply append, so `tag-slot-conflict` and
  `modifier-slot-unavailable` (both "no free slot" reasons) are removed together with their
  `en.json` strings.
- Model shape: `keys?: readonly ActionKeySlot[]` replaces `key`/`keyModifier`/`secondaryKey`/
  `secondaryKeyModifier` outright, read and written through one new accessor module
  (`src/shared/config/action-slots.ts`) - no hybrid `key` plus `extraKeys[]`, which would leave two
  representations of one concept for every future story to pay for.
- The persisted profile schema *does* accept the legacy four fields and normalizes them into `keys`
  on read (zod preprocess). This is not cfg-format compatibility (which the user dropped): without
  it every profile already on a dev machine loses all of its binds silently on the next load.
- The Controls tab keeps its two editable slot columns and its `'primary' | 'secondary'` vocabulary,
  mapped onto slot indices 0/1. Slots beyond two can only arise from hand-editing the `.cfg`; they
  are preserved, mirrored, rendered and counted in conflict detection, but not editable here - an
  N-slot editing surface is a story of its own, and inventing one now would redesign the controls
  grid (two fixed columns, `controls-grid.css`) inside a format story.
- Slot descriptors in shared results (`bind-collision.ts`, `tidy-up.ts`, `profile-diff.ts`) become
  numeric slot indices; the renderer keeps its existing labels for 0/1 and gets one new i18n string
  for index 3 and up, so a hand-added third key is still reportable and clearable.
- `render.ts`'s whole ref machinery (`fnv1a32`, `entryRefHex`, `entryRefFor`, `buildEntryRefs`,
  `MAX_ENTRY_REF_ROUNDS`, the `KeySlot` type) is deleted, and with it `round-trip.test.ts`'s
  `canonicalizeRefs` normalisation - there are no refs left to canonicalise.
- The existing exclusions stay untouched: layer-internal alias lines (positional) and switch-bind
  chain aliases (`SWITCH_ALIAS`/`q2l_sw<n>`) are still never entries, and a tagless hand-added
  alias line still degrades through story 041's inference (`tag-missing`).

## Open Questions

1. ~~**Anchor identity without `e`.**~~ answered → Decisions (Sprint)
2. ~~**More than two key slots.**~~ answered → Decisions (Sprint)
3. ~~**Version.**~~ answered → Decisions (Sprint)

## Plan

Two changes ride together: the tag shrinks (identity moves into the config text) and the key-slot
model loses its cap of two. The model refactor comes first, because writer and reader both need it.

1. **Tag grammar** (`shared/config/profile-metadata.ts`): drop `e`, `k`, `slot` from
   `KNOWN_META_KEYS`/`MetaTagFields`, rewrite the registry doc, and add a marker mode to
   `formatMetaComment` so an entry line can emit a bare `[q2l]`.
2. **Model** (`shared/modules/config.ts`, new `shared/config/action-slots.ts`, zod mirrors in
   `main/lib/schemas.ts` + `main/modules/config/schemas.ts`): `keys: ActionKeySlot[]` replaces the
   four `key`/`secondary*` fields; one accessor module is the only way to read/write slots; the
   store schema still reads the legacy shape and normalises it.
3. **Shared consumers onto the accessor**, in two batches: the ones that already build a 2-element
   slot array (`action-mirror`, `alias-references`, `modifier-layers`) and the ones that hardcode
   primary/secondary semantics (`bind-collision`, `bind-adoption`, `tidy-up`, `profile-diff`).
4. **Renderer** keeps its two-column surface; only its reads generalise and its writes go through
   the accessor so extra slots survive (`catalog-binds`, `bind-conflicts`, `bind-slot-collision`,
   `ControlsTab`, `ActionEditor`, `CareTidyUpSection`).
5. **Writer** (`shared/config/render.ts`): `entryTag` shrinks to `cid` (plus an anchor's
   `key`/`mod`/`an`), all ref machinery is deleted, every entry line carries the marker tag, and
   anchors are emitted for every modified slot of every entry, in slot order.
6. **Reader** (`shared/config/profile-restore.ts`): grouping by alias name / bind value / anchor
   match replaces `groupByEntryRef`; slot claims append in file order with no cap; kind is inferred;
   the four dead warning reasons and their `en.json` strings go.
7. **Re-verify story 042's fixed point** (`fixtures/profiles.ts`,
   `main/modules/config/round-trip.test.ts`, `render-invariants.test.ts`): new fixtures for a
   hand-added third key, a modified slot 1 next to a plain slot 2, two bind lines on one value and
   an anchor-only entry, plus adversarial hand-edit passes (tag deleted, prose renamed
   inconsistently, forged `cat=`, leftover `e=`/`slot=`).
8. **Docs** (`docs/systems/profile-file-format.md`): reduced registry, the order rule, the
   multi-slot model, and the three removed keys named as removed with their reason.

Not touched: the loader `autoexec.cfg` (`switch-bind.ts`), layer section internals, the cvar side of
the file, and `META_FORMAT_VERSION` (stays 1).

## Deliverables

**D1 - Tag registry shrink. [x]** `e`/`k`/`slot` gone from `KNOWN_META_KEYS`, `MetaTagFields` and the
module doc; a line with no fields emits the bare `[q2l]` marker. Files:
`src/shared/config/profile-metadata.ts`, `profile-metadata.test.ts`.
*Accepted when:* no code path can emit those three keys, a fieldless tag renders `[q2l]`, and
`parseMetaTag` reports a hand-written `e=...` as an unknown key rather than crashing.
~~`formatMetaComment` gains an explicit marker mode~~ - removed in the story review (finding 7): it
never acquired a caller, because the writer needs prose and tag as two separate halves
(`fitProseAndTag`'s budget lets prose give way, never the tag), so the real marker comes from
`render.ts#entryTag`'s empty-fields `formatMetaTag` call.

**D2 - Arbitrary key slots in the model. [x]** `ActionKeySlot { key, modifier? }` and
`ConfigAction.keys?: readonly ActionKeySlot[]` replace the four old fields; new
`src/shared/config/action-slots.ts` (`actionKeySlots`, `keySlotAt`, `withKeySlot`, `clearKeySlot`,
`keySlotCount`) is the single access point; both zod mirrors validate `keys` and normalise the legacy
shape on read. Files: `src/shared/modules/config.ts`, `src/shared/config/action-slots.ts` (+ test),
`src/main/lib/schemas.ts`, `src/main/modules/config/schemas.ts` (+ their tests). Mirror for module
shape and doc style: `src/shared/config/press-release.ts`.
*Accepted when:* an action with five slots round-trips through both schemas, a legacy-shaped stored
profile loads with its two slots intact, and `npm run typecheck` is green for the shared+main layer
(call sites follow in D3-D5).

**D3 - Shared slot consumers, array-shaped batch. [x]** `action-mirror.ts`, `alias-references.ts`,
`modifier-layers.ts` (+ their tests) read slots through the accessor and loop over all of them.
*Accepted when:* an unmodified slot 3 is mirrored into `profile.binds` and a modified slot 3 into its
modifier layer, and every existing test passes unchanged in behaviour.

**D4 - Shared slot consumers, primary/secondary batch. [x]** `bind-collision.ts`, `bind-adoption.ts`,
`tidy-up.ts`, `profile-diff.ts` (+ tests): slot descriptors become numeric indices, detection covers
all slots, adoption appends a new slot instead of stopping after the second.
*Accepted when:* a collision on a third key is reported and clearable, and a diff names the slot it
changed for any index.

**D5 - Renderer on the accessor. [x]** `lib/catalog-binds.ts`, `lib/bind-conflicts.ts`,
`lib/bind-slot-collision.ts`, `ControlsTab.tsx`, `components/ActionEditor.tsx`,
`CareTidyUpSection.tsx`, plus one `en.json` label for a slot index of 3 and up. Two editable columns
stay; `applySlot` writes slot 0/1 through `withKeySlot` and leaves further slots untouched.
*Accepted when:* editing or clearing slot 1 of an entry that has three keys keeps the third key, and
that third key still participates in conflict detection.

**D6 - Writer emits the reduced tag. [x]** `entryTag` down to `cid` only (an anchor adds
`key`/`mod`/`an`); all ref machinery and the `KeySlot` type deleted; entry lines always carry the
marker tag; anchor lines emitted per modified slot for all slots, in slot order. Files:
`src/shared/config/render.ts`, `src/main/modules/config/render.test.ts`.
*Accepted when:* the story's example renders exactly
`bind mouse1 "+attack"   // Attack [q2l cid=movement:attack]` and no rendered line anywhere in the
fixture corpus contains `e=`, `k=` or `slot=`.

**D7 - Reader recovers identity and slots from the file. [x]** `groupByEntryRef` replaced by
name/value/anchor grouping; claims append in file order, uncapped; `resolveKind` removed; anchor
discriminator on `key`; the four dead warning reasons plus their `en.json` strings removed. Files:
`src/shared/config/profile-restore.ts`, `profile-restore.test.ts`,
`src/renderer/src/i18n/locales/en.json`.
*Accepted when:* two bind lines on one value come back as one entry with two keys in file order, a
hand-added third bind line becomes slot 3, an anchor pairs with its entry via `cid`/prose, and an
inconsistently renamed anchor splits off as its own entry with no crash and no lost line.

**D8 - Round-trip re-verification (story 042's property). [x]** New fixtures: hand-added third key,
modified slot 1 next to a plain slot 2, two bind lines on one value, anchor-only entry, and an entry
with no `cid` (marker-tag-only line). `canonicalizeRefs` deleted. Adversarial passes: tag deleted,
prose renamed on one of an entry's lines, forged `cat=`, leftover `e=`/`slot=` from a hand-edit.
Files: `src/shared/config/fixtures/profiles.ts`, `src/main/modules/config/round-trip.test.ts`,
`src/shared/config/render-invariants.test.ts`.
*Accepted when:* render -> parse -> restore -> render is byte-identical for every fixture in the
corpus and every adversarial variant loses no config line.

**D9 - Format documentation. [x]** `docs/systems/profile-file-format.md`: reduced key registry, the
file-order slot rule (including the documented slot-swap consequence), the per-entry multi-slot
model, the marker tag, and `e`/`k`/`slot` named as removed with the reason. Touch
`docs/systems/config-module.md` only where it names a removed key.
*Accepted when:* no removed key is described as current anywhere in `docs/systems/`.

## Model Hints

- D6 -> `deliverable-hard` - the writer decides every byte of the file the fixed-point property is
  measured on; a wrong tag or a missing anchor silently changes what a re-import reconstructs.
- D7 -> `deliverable-hard` - identity moves from a hash to inferred pairing across three line kinds;
  a mis-grouped line merges or splits entries and rewrites a user's Controls tab.
- D8 -> `deliverable-hard` - this is the story's regression gate against constructed adversarial
  profiles, and the carry-over rule in `sprint.md` names re-render passes over
  `alias-references.ts`-adjacent code explicitly.
- D1, D2, D3, D4, D5, D9 -> default (mechanical, each with its own local acceptance).
- Review: -> `story-review-hard` - the change spans the file format, the persisted model and the
  renderer at once, and its central promise (a lossless round trip) is exactly the kind of thing a
  cheap review pass confirms by reading the tests instead of the edge cases.

## Test Plan (manual acceptance)

1. Config view -> **Controls**: bind `MOUSE1` to an existing catalogue entry, then save the profile.
2. Open the synced `.cfg` of the assigned installation in a text editor. Expected: the bind line
   reads `bind mouse1 "..."   // <name> [q2l cid=...]` - no `e=`, no `k=`, no `slot=`; an entry
   without a catalogue link shows the bare `// <name> [q2l]`.
3. In Controls, give the same entry a second key with a modifier (e.g. `Alt+R`), save, and re-open
   the file. Expected: one `bind` line for the plain key, one comment-only anchor line under the
   entry's category carrying `key=` and `mod=` and the same display name - and no `slot=`.
4. Hand-edit the file: add a third `bind` line with the same value as the entry's bind line
   (`bind f "<same value>"`), and save it in the editor.
5. Config view -> **Care -> Sync**: the profile's row reports the external edit; press **Reload**.
   Expected: the entry keeps its keys, the third key is not reported as an error, and no line is
   listed as unrecognised.
6. Save the profile again and use **Care -> Sync -> Compare**. Expected: no difference - the file the
   launcher writes is byte-identical to the one it read, third key included.
7. Hand-edit one anchor line's display name to something different from the entry's other lines, then
   **Reload**. Expected: two separate rows in Controls (the accepted drift), no crash, no lost line.
8. `npm run ui:verify` for the live smoke pass (P2), plus `npm test`, `npm run build`,
   `npm run typecheck`.

## Coverage gate

| Acceptance criterion | Deliverable |
| --- | --- |
| `e`/`k`/`slot` never written | D1, D6 |
| example bind renders as `// Attack [q2l cid=movement:attack]` | D6 |
| slots recovered from file order | D7 |
| two bind lines on one command pair into one entry | D7 |
| anchor still identifies its entry and carries key + modifier | D6 (write), D7 (read) |
| round-trip fixed point over the whole corpus | D8 |
| ~~old-format import~~ | dropped by user decision |
| `profile-file-format.md` updated | D9 |
| arbitrary key slots per entry (user decision) | D2, D3, D4, D5, D6, D7 |

## Done

**Summary.** The `[q2l …]` tag shrinks to its non-derivable minimum (`cid` for a bound entry, bare
`[q2l]` marker otherwise; `an`/`key`/`mod` on an anchor). `e`/`k`/`slot` are gone; entry identity on
read comes from the config text itself (alias name / bind value / anchor match), and key slots are
recovered from file order with no cap — `ConfigAction.keys?: ActionKeySlot[]` replaces the four old
`key`/`secondary*` fields through one accessor module (`shared/config/action-slots.ts`). Per user
decision, no `META_FORMAT_VERSION` bump and no pre-050 tag compatibility — this is a pre-release app
with nothing to migrate. Three story-review-hard rounds surfaced real data-loss bugs along the way
(anchor prefix-matching merging two entries, same-alias-name entries silently collapsing on reload
with the warning wired to the wrong path twice, a modifier-dropping editor save path, a key-order
fixed-point violation, an inconsistent slot-clear that broke the batched "fix all" action) — all
fixed and re-verified through the real render→import/restore pipeline, not just unit tests; see
`## Decisions (Sprint)` for the full trace of each.

**Commit message:** `050: tag shrinks to the non-derivable minimum, key slots move to file order`

**Verification.**
- `npm run typecheck`: clean (shared+main+web).
- `npm test`: 75 files / 1871 tests passed.
- `npm run build`: clean.
- Review: 3 rounds of `story-review-hard`, FAIL → FAIL (1 of 8 remaining) → FAIL (2 new/incomplete)
  → all confirmed findings fixed and re-verified; no open correctness findings remain.
- Live smoke (P2, `npm run ui:verify`): not run in this session — flag as **built, live acceptance
  pending** per the sprint's own acceptance policy. The manual Test Plan above is the authoritative
  UI acceptance path pending that pass.

**Known gap (documented, not fixed):** no automated test renders an actual click for the two
adopt-path fixes (Care → Sync → Reload, "Take the file") — the installed toolchain's jsdom test
cannot run at all on this machine's Node 20 (jsdom 30 needs Node ≥22.19). The regression tests
instead drive the exact handler each button calls with the exact dependencies each component passes,
which is what actually closed the finding (both buttons now delegate to one shared adopt function
with no adopt logic of their own left to diverge) — but a real DOM-level test remains a toolchain
change away, not a story-050 fix.
