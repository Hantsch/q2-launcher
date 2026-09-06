# Profile file metadata format

Story 042 gives the launcher's rendered `.cfg` files a defined, versioned metadata format so a
launcher-written file can be re-imported without losing what the UI already knows about it —
display name, category, entry kind, key-slot pairing, layer membership — none of which the plain
Quake II config syntax has a place for. Story 050 then cut the tag down to the fields the file
genuinely cannot say itself: entry identity and key-slot order come from the file's own text and
line order instead of from a hash or an index. This document is the grammar reference; the
implementation is `src/shared/config/profile-metadata.ts` (grammar), `src/shared/config/render.ts`
(what each line writes) and `src/shared/config/profile-restore.ts` (how a line is read back), and
their tests.

## Where it lives

Everything rides inside a `//` comment the config already has a reason to carry. Story 040 already
attaches a trailing comment (the display name) to every generated alias, bind and section-header
line; this story defines a machine-readable tail for that same comment rather than inventing a
second comment, a header block, or a side file.

```
bind mouse1 "+attack"   // Attack [q2l cid=movement:attack]
```

A human reading the file still sees a normal comment — prose, then a bracketed tail. A player who
deletes the bracketed tail entirely still has a readable comment and a working bind; a player who
never learns the format never has to.

## Grammar

```
// <prose> [q2l key1=value1 key2=value2 ...]
```

- `<prose>` is free text — typically the display name story 040 already writes. It may be empty.
- The tag is the literal sigil `[q2l`, then zero or more space-separated `key=value` tokens, then a
  closing `]`. Nothing may follow the `]` except the end of the line.
- A comment with no `[q2l` tail is plain prose — every pre-042 comment and every foreign config's
  comment parses this way, unchanged.
- The tag is always the *last* thing in the comment. `parseMetaTag` anchors on the last occurrence
  of `[q2l` in the text for exactly this reason: prose comes first, the machine part comes last, and
  there is never more than one tag per comment.

## Header block

Every rendered profile file opens with a fixed, four-line header block (`render.ts#buildHeaderBlock`)
— a small, cosmetic name card, not a technical dump:

```
// ==============================================================================
//  My Profile
// ==============================================================================
//                              [q2l v=1 id=3f9c2a1e-fd01-4353-81c9-3e6961d5ac72]
```

In order: an `=`-ruled banner line, the profile's own name (`trimEnd()`ed — the only prose in the
block), a second `=`-ruled banner line, then the `[q2l ...]` tag alone on its own last line,
right-aligned so its closing `]` lands on `BANNER_WIDTH` (80) — falling back to a plain
left-aligned `//  <tag>` (the name line's own shape) on the rare file whose tag alone is too long
for that (only reachable from a hand-edited store with an absurd profile id), never truncated.

That tag line is the file's *only* technical content, and it is the one compact
`[q2l v=1 id=<uuid>]` line — nothing else in the block is machine-readable. `v` is the format
version (`META_FORMAT_VERSION`, still 1 as of this story) and `id` is the profile's own stable
ownership id; `id` is registered in `KNOWN_META_KEYS` (`profile-metadata.ts`) directly after `v`,
and — like `v` — is only ever emitted in the header block's tag, never on a per-line tag. `id`'s
*presence* alongside `v` is what tells this new banner shape apart from the header-only,
`v`-alone tag that shipped before it; its *absence* on an otherwise well-formed header tag is not
an error, it just means the file predates this shape (see "Legacy header shape" below).

### Legacy header shape (read-only)

A profile file written before this story carries a different, five-line header instead:

```
// q2-launcher profile 3f9c2a1e-fd01-4353-81c9-3e6961d5ac72 - hand-edited changes are read back
// ==============================================================================
//  My Profile [q2l v=1]
//  Q2 Launcher - hand-edited changes to this file are read back
// ==============================================================================
```

A sentinel comment line naming the profile's id in prose, an `=` rule, the name with an inline
`[q2l v=1]` tag (no `id`), a fixed hand-edit sentence (`HAND_EDIT_SENTENCE`), then a closing `=`
rule. This shape is still **read** — `src/shared/config/file-ownership.ts`'s
`readOwnershipStamp`/`isLauncherOwnedFile` recognise it as launcher-owned exactly as before, so a
profile from before this story is not orphaned or reported as "changed outside the launcher" — but
it is never **written** any more: the very next time that profile is saved, its header is rewritten
into the new four-line banner shape above, keeping its id and name. Treat this shape as legacy and
read-only, not as an alternative current format.

## Key registry

The current registry, after story 050's cut and story 045's, 051's and 052's additions, is twelve
keys:

| key       | where it appears           | meaning                                                        |
| --------- | --------------------------- | --------------------------------------------------------------- |
| `v`       | header block only           | format version this file was written with (`META_FORMAT_VERSION`, still 1) |
| `id`      | header block only           | the profile's own stable ownership id (story 051) — see "Header block" above; registered in `KNOWN_META_KEYS` directly after `v`, and, like `v`, never emitted on a per-line tag |
| `cid`     | bind/alias/anchor/unbound lines | catalogue id (`catalogId`), when the entry is catalogue-backed  |
| `an`      | anchor lines and unbound lines | the entry's own `aliasName`. Emitted only where no alias line exists to spell it out as code — an entry that keeps its alias line gets no `an`, since that line's own name *is* the value and a tag would be a second source able to drift from it. On an anchor or unbound line, present exactly when the entry actually has a non-empty `aliasName` of its own — never unconditionally, since forcing it onto a line for an entry with no alias name at all would let the reader restore a name the file never really recorded |
| `key`     | anchor lines only           | the key of the slot this line records. Only ever emitted where the config text cannot say it — an anchor line is a comment, so it has no code to read a key off. A real `bind` line never carries it: the line already spells its key. Never on an unbound line (story 052 D2) — an unbound entry has no key slot at all |
| `mod`     | anchor lines only           | that slot's `modifier`                                          |
| `cat`     | section header (category)   | category id — since story 052 D4, a template id (`movement`/`weapons`/`drops`) is minted as an ordinary local category like any other, keeping only its own id (not a fresh one) rather than being adopted as-is with nothing created; its `nameKey` is re-attached when the header's title is still exactly the template's own default name. An id this build doesn't recognise as a template mints a local category named from the header's title |
| `ord`     | section header (category)   | that category's position in `profile.categories`, counting only the categories that carry at least one entry — the same value on all three of a category's headers. It is the only thing in the file that can state the order of two categories whose sections never share a block: the writer emits its category sections in three separate passes (aliases, then binds, then `Entries:`), so a category whose entries are all unbound (`Entries:` only) and one whose entries are all bound (`Binds:` only) render byte-identically whichever order the profile has them in. A file written without the field (an older build, or a hand-deleted tag) simply falls back to the section layout, as this reader always did |
| `layer`   | section header (layer)      | layer ref                                                        |
| `mode`    | section header (layer)      | layer mode                                                       |
| `trigger` | section header (layer)      | layer trigger key; the key is omitted entirely (not emitted as empty) when the trigger is `null` |
| `lbl`     | a toggle/press-release state's own alias line only | that state's display label (story 045) — never on the dispatch alias or a `_p<n>` chunk line |

`KNOWN_META_KEYS` in `profile-metadata.ts` lists these in the exact order `formatMetaTag` always
emits them — that fixed order is part of the format's determinism guarantee: the same fields always
render to the same string, which is what a byte-equality test on rendered output depends on.

### Removed: `e`, `k`, `slot`

Three fields story 042 originally defined are gone as of story 050. A hand-written `e=…`, `k=…` or
`slot=…` token is no longer meaningful — it round-trips as an unrecognised key (see "Unknown keys"
below) rather than being dropped, but the writer never emits any of the three again and the reader
no longer looks for them.

- **`e`** — an opaque 8-hex entry-ref hash (`fnv1a32` of `action.id`). Its only job was to pair the
  several physical lines of one logical entry back together on import. That pairing is now done
  from the config text itself: an alias line by its alias name, a bind line by its bind value (see
  "Entry identity and grouping on read" below) — there is nothing left for a hash to do, and
  `render.ts`'s whole ref machinery (`fnv1a32`, `entryRefHex`, `entryRefFor`, `buildEntryRefs`) was
  deleted with it.
- **`k`** — the entry's `kind` (`bind`/`alias`/`message`/…). Redundant: the reader already has
  `entryKindFor` (story 041), which infers an entry's kind from its own commands and lines. A
  tag-side copy could only ever drift from what the line's own body already says.
- **`slot`** — which of an entry's key slots (`1`, `2`, …) a line records. Redundant once an
  entry's key count stopped being capped at two: file order already says which slot is which — the
  first line that claims a key for an entry is slot 1, the next is slot 2, and so on (see "Slot
  identity: file order, not a field" below).

## Toggle and press/release entries

A `toggle` entry (story 045) renders as three alias lines: two state aliases plus a dispatch alias
that always points at state 1. A `press-release` entry renders as two independent aliases, `+<base>`
and `-<base>`, with no dispatch alias between them.

```
alias zoom_s1 "fov 90; alias zoom zoom_s2"    // Zoom [q2l cid=movement:zoom lbl=In]
alias zoom_s2 "fov 120; alias zoom zoom_s1"   // Zoom [q2l cid=movement:zoom lbl=Out]
alias zoom zoom_s1                            // Zoom [q2l cid=movement:zoom]

alias +duck "+moveDown"                       // Duck [q2l cid=movement:duck]
alias -duck "-moveDown"                       // Duck [q2l cid=movement:duck]
```

`lbl` is the state's own display label (set on `ActionEntryPart.label`), and it rides only on that
state's own alias line — the line whose name is that half's rendered name
(`alias-render.ts#twoPartAliasNames`). Every other line the entry produces (the dispatch alias, and
any `_p<n>` chunk line under either half) carries the entry's plain tag, with no `lbl` at all — a
chunk line is a fragment of one half's body, not the state itself, and the dispatch alias is neither
state. A `press-release` half can carry a `lbl` too, by the same rule, even though today's UI does not
expose one for that kind.

## Slot identity: file order, not a field

An entry's `keys` is `ConfigAction.keys?: readonly ActionKeySlot[]` — an arbitrary number of
`{ key, modifier? }` slots, not capped at two, read and written through one accessor module,
`src/shared/config/action-slots.ts` (`actionKeySlots`, `keySlotAt`, `withKeySlot`, `clearKeySlot`,
`keySlotCount`).

On read, an entry's slot claims are simply taken **in the order the claiming lines appear in the
file, bind lines before anchor lines**: the first line that claims a key for that entry is slot 1,
the second is slot 2, and so on, with no cap and no possibility of a slot conflict — a claim just
appends. This is why the two AC-level guarantees hold with no `slot` field at all: two `bind` lines
running the same command are recovered as one entry with two keys purely because both lines claim
the same command value, in the order they appear; a hand-added third `bind` line on the same value
becomes a legitimate third slot.

On write, the same rule runs in reverse: `buildAnchorLines` walks an entry's slots in ascending
index order and emits one anchor per **modified** slot (a slot carrying a `modifier`) in that same
order, so the anchors of one entry always appear in the file in slot order — reordering that loop
would silently permute the entry's keys on the next import.

### The documented slot-swap consequence

Because slot identity is positional rather than tagged, an entry whose **modified** slot sits
before its **plain** slot in the rendered file comes back with the two swapped after a reload.

Concretely: an anchor line (for a modified slot) is always written in the "Entries" section, which
comes *after* every bind section but *before* every layer section. If an entry's slot 1 is
modified and its slot 2 is plain, the *plain* slot's `bind` line is written earlier in the file (in
its category's bind section) than the *modified* slot's anchor line (in the entries section) — so
on the next read, the plain slot's bind line is scanned and claimed first, becoming slot 1, and the
modified slot's anchor line is claimed second, becoming slot 2. The intra-entry slot **order**
flips once; nothing is lost — both keys and both modifiers survive intact, and the file re-renders
byte-identical to what was just read (the render is a pure function of the now-swapped slot array),
so the swap is a fixed point: it happens once, on the entry's first save through this rule, and
never again on top of itself.

## The marker tag

Every entry line — bind, alias or anchor — always carries a `[q2l …]` tag, even one with no fields
at all: a bare `// <name> [q2l]`. `render.ts#entryTag` is what forces this onto a line that
otherwise has nothing to say: it never returns `''`, and `formatMetaTag({})` renders exactly the
bare `[q2l]` for an empty field set. The prose and the tag stay two separate halves all the way to
the line (`cfg-layout.ts#fitProseAndTag` joins them under the line's byte budget), because prose is
the half allowed to give way when a line runs out of room and the tag is not.

This is deliberate, not decorative. With `e` gone, tag **presence** is now the only signal left that
distinguishes a launcher-owned line from a line the user typed and commented themselves. Before
story 050, a fieldless entry line still carried something (`e=…`) that identified it as owned; with
that field gone, an entry line with a genuinely empty tag set (no `cid`, not an anchor) would look
exactly like plain prose if the tag were omitted — and on the next render it would read back
unowned and move into the "other binds" section, breaking the round-trip fixed point one render
later. The bare `[q2l]` marker is what keeps that from happening.

## Anchor lines

Almost every tag rides on a line the config needs anyway. One shape has no such line, and it gets a
comment-only **anchor line** in an `Entries: <category>` section of its own (placed after the bind
sections and before the layer sections, so an anchor sits under its own category header and outside
every layer section).

**A modified key slot** (`Alt+W`). Quake II has no modifiers, so that binding is not a `bind` line at
all — it is an override inside the modifier layer's generated `+alt`/`-alt` alias pair, and that pair
covers *every* override of the layer at once, so there is no per-override line for a tag to ride on.
Nothing else in the file can say which of the entry's slots that key is, or which modifier it
carries — not even the entry's own alias line, which is the entry rather than one of its keys. So
**every** modified slot is anchored — every slot of every entry, in slot order, with no cap of two —
including for an entry that keeps its own alias line, because that line names the entry, not one of
its keys, and carries no `key`/`mod` at all.

An anchor line carries the entry's `cid` (when catalogue-backed) plus, on that line only:
`key`/`mod` — the anchor's own slot's key and modifier — and `an` — the entry's `aliasName` —
**only when the entry has no bind or alias line of its own** (an anchor-only entry). `an` stays in
the registry specifically for that case: such an entry has no other line whose own code could spell
its display name, so the tag is the only place left for it to live. An entry that does have an
alias or bind line never gets `an`/`key`/`mod` repeated on its other lines — one fact, one place.

**An entry with no line at all used to get nothing, on purpose — story 052 D2 gives it one instead.**
A continuous catalogue row with no key mirrors as its own bare `+forward`, so its alias line is
dropped (a self-mirroring `alias weapnext weapnext` is dropped outright too) and with no key there is
no bind line either — so before story 052 such an entry left no trace in the file at all and was
dropped on re-import. An earlier review round (story 042) did give it a slotless *entry* anchor to
keep its name, kind, category and catalogue id; that was reverted, because the file had nowhere to
record what an unbound entry *runs*, so the entry came back with `commands: []` — and the Controls
tab's slot editor is find-or-create on `catalogId` (`catalog-binds.ts#applySlot`), so the next bind of
that same row reused the empty entry and produced a key pointing at an alias nothing defines. Being
dropped was better than that, at the time: `freshAction` would regenerate the row's commands from the
catalogue.

Story 052 removes the reason that revert was needed (its own D4/D8 replace the lazy
find-or-create-by-`catalogId` path with something that no longer treats a restored empty entry as
dangerous), and gives this exact entry shape a line that *does* carry what it runs — see "Unbound
lines" below. D2 wrote that line and D3 reads it back
(`profile-restore.ts#claimsUnboundEntry`), so such an entry now survives a save/reload/re-import
round trip with its name, category, `catalogId` and command intact.

A **slotless anchor** is not an anchor to the reader either, and the doc used to claim otherwise: a
comment-only line whose tag carries no `key` fails `profile-restore.ts#claimsEntryAnchor` (that
field is the whole discriminator - see below), so it is neither an anchor nor a section header. It
stays a preserved, unrecognised comment line rather than becoming a keyless, commandless entry -
which is the same outcome the revert above wanted, reached by the reader simply not recognising the
shape.

```
// --- Entries: Movement [q2l cat=movement] -----------------------------------
// Forward [q2l cid=movement:forward key=w mod=ALT]
// Next weapon [q2l an=weapnext key=MWHEELUP mod=ALT]

// --- Layer: Alt (hold, on ALT) [q2l layer=… mode=hold trigger=ALT] ----------
alias +alt bind w +forward  // Alt
alias -alt unbind w         // Alt
bind ALT   +alt             // Alt
```

Both example lines carry `key`/`mod`, because that is what makes them anchors at all; the first
belongs to a catalogue-backed entry that has an alias or bind line of its own elsewhere (hence no
`an`), the second to an anchor-only entry whose `aliasName` has no other line to live on.

A slot anchor carries the entry's identity and which slot it is; the *command* is still read back out
of the layer override the anchor names, because that is where the profile really keeps it. A slot that
does have a bind line never gets an anchor — one fact, one place — and neither does an *unmodified*
slot with no bind line: the file's bind table is the observable truth about which key runs what, so
recording a key claim it contradicts would hand that key back to the entry on import.

An anchor is a comment-only line, and so is a section-header banner, so the reader has to tell the
two apart: **the tag decides, never the prose**. A line carrying a non-empty `key` field, with no
`cat`/`layer`/`v` field, is an entry anchor line, whatever its display name looks like — a name
containing `---` or `===` must not be read as a banner, or it would mint a category out of the
user's own prose and re-file every line below it in that section under it.
`profile-restore.ts#claimsEntryAnchor` is the one predicate both scans consult, so they cannot
disagree about which line is which. (`key` replaced `e` as this discriminator when story 050
removed the `e` field — `key` is exactly as narrow a signal, since only an anchor line ever carries
a non-empty `key`.)

Anything the ACs already list that is *not* in this table (command order, `keepEmptyAlias`) is
deliberately left out of the tag: it is already carried by the plain config text itself (the rendered
body order, a rendered `""`), so a tag for it would just be a second, driftable source of the same
fact.

## Unbound lines

Story 052 D2 gives the `Entries: <category>` section a second shape, a sibling of the anchor line
rather than a section of its own: an **unbound line**, for the one entry shape neither a real config
line nor an anchor line ever covers — a plain `bind`/`message` entry with no key slot at all (so no
`bind` line, and no modifier layer to anchor it into) and no alias line either (a catalogue's own
continuous row that nothing calls by name, or an entry seeded with no commands at all — see
`STANDARD_TEMPLATE`, story 052 D1's "every catalogue row becomes an action, unbound"). Before this
deliverable such an entry left nothing in the file at all (see "An entry with no line at all" above);
an unbound line is what a re-import needs so the entry's identity and, load-bearingly, its *command*
are not lost.

```
// --- Entries: Movement [q2l cat=movement] -----------------------------------
//bind "+moveleft"   // Strafe left [q2l cid=movement:moveleft]
//bind ""            // Crouch [q2l cid=movement:crouch]
```

The grammar is a whole config line commented out, `//bind "<cmd>"`, with the same trailing
`  // <prose> [q2l ...]` every real bind/alias/anchor line in this file carries
(`attachTaggedComment`). To a human it reads as a bind the launcher has commented out because nothing
is bound there yet; to the reader (`profile-restore.ts#claimsUnboundEntry`, story 052 D3) the tag's
presence is what says the line is launcher-owned rather than something the user typed and commented
themselves — the same rule "The marker tag" above states for every other entry line.

**How it is read back.** `claimsUnboundEntry` is the discriminator, the sibling of
`claimsEntryAnchor` and consulted by the same two scans (`claimedByEntryScan`, so a claimed line can
never *also* be minted as a section header out of its own display prose): the comment text starts
`bind ` with an argument, a readable `[q2l …]` tag is present, and the tag carries none of the
fields that make a tagged comment something else — `key` (an anchor), `cat`/`layer` (a section
header), `v` (the header block). The line is then split back into its two halves with the config
tokenizer itself (`stripLineComment`, `tokenize` — so a `//` inside a quoted body is part of the
command, not the start of the display comment) and restores an entry with that command (`""` → no
commands at all), the display prose as its name, `cid` as its `catalogId`, `an` as its `aliasName`
and the section it sits in as its category. Every unbound line becomes an entry **of its own**,
never matched onto an existing group the way an anchor is: the writer emits one only for an entry
with no other line, so there is nothing to match onto, and matching could only fold two rows into
one — two commandless seeded rows in one category say the same thing (`//bind ""`) by design. For
the same reason an anchor line is never matched onto an unbound entry: an unbound entry has no key
slot at all, which is precisely why it got this shape instead of an anchor. Being claimed is also
what keeps the line out of the import preview's `preserved` list
(`RestoreProfilePartsResult.consumedCommentLines`, subtracted by `import.ts#preservedLinesFor`).

**The body carries the command, never just a marker.** `<cmd>` is `bindValueFor(action)` — the exact
value the mirror would write on a key if this entry had one, the same function `buildBindOwnerIndex`
itself uses — for an entry that has at least one command, and the empty string `""` for an entry with
no commands at all (most of `STANDARD_TEMPLATE`'s seeded rows). This is the fix for exactly what made
story 042's reverted "entry anchor" attempt worse than the loss it was trying to prevent: that shape
carried no command at all, so a restored entry came back with `commands: []` and the Controls tab's
find-or-create-by-`catalogId` slot editor could reuse it as the base of a fresh bind, producing a key
that pointed at an alias nothing defined. An unbound line's body is what lets the restore recover
the real command instead of an empty stand-in — even when that command is deliberately the empty
string, which is why `//bind ""` round-trips as "genuinely no command" rather than being treated as
garbage.

**Tag fields, and which ones an unbound line never carries.** Same as an anchor-only entry: `cid`
when catalogue-backed, and `an` (the entry's own `aliasName`) — present exactly when the entry has
one, since an unbound entry by definition has no alias line of its own to spell it out as code, but
an entry seeded with no name of its own gets no `an` either; forcing one on would fabricate a name
the file never really carried. Never `key`/`mod`: an unbound entry
has no key slot at all, modified or otherwise — if it did, it would be an anchor (or a real bind),
not this shape. `render.ts#isUnboundEntry` is the one predicate that decides which shape an entry
gets; the two are mutually exclusive by construction (an anchored entry's command already lives in
its modifier layer's alias, so it never also qualifies as unbound).

**Only a `bind`/`message` entry can be unbound.** A `kind: 'alias'`, `'toggle'` or `'press-release'`
entry always renders at least one alias line of its own (story 045 D3's "always kept" guard in
`actionsWithAliasLine`), so giving one of those an unbound line too would record the same fact twice
— "one fact, one place" holds here exactly as it does for the anchor/bind-line split above. A bound
entry (a real key, a real bind or alias line) is likewise never given a second, unbound trace next to
it.

## Entry identity and grouping on read

With no `e` ref to key on, `profile-restore.ts#groupEntryLines` groups a file's tagged lines back
into entries purely from what the config text itself says:

- **An alias line**, by its alias name. A chunk-split `_p<n>` family (a long body split across
  several `alias` lines) folds onto its base line, which references it — the whole family is one
  entry.
- **A bind line**, by its bind value. `render.ts` writes one value per entry (`bindValueFor`) on
  every one of its keys, so several `bind` lines running the same command are one entry with several
  keys — a third such line, hand-added or otherwise, is simply a third key.
- **The two join** by sharing that one key space: a bind value that *equals* a grouped alias name
  lands in that alias line's group — exactly what the mirror wrote there — a lookup rather than a
  guess.
- **An anchor line**, by `matchAnchor`: scoped to its own category section, then in two steps, the
  second consulted only when the first had nothing to say — by `cid` when the anchor carries one,
  else by **exact** display prose. Each step demands exactly one candidate; two candidates is
  ambiguity and the file has stopped being able to say which.
- **An unbound line**, by its own position (`unbound:<file>:<line>`) and nothing else: it is one
  entry per line, by construction (see "Unbound lines" above for why matching it onto anything would
  only ever fold two rows into one).

  The prose match is exact and nothing wider. An earlier version had a third step that accepted a
  *prefix* relationship in either direction, for a long display name `fitProseAndTag` might cut to
  different lengths on different line kinds. It could not tell that apart from two genuinely
  different sibling names where one nests inside the other (`Reload` and `Reload weapon`), and
  merging those two costs one of them its name, its commands and its key with no warning at all —
  the one failure this whole section must not have. The truncation case it was for is unreachable
  anyway: a prose cut needs a display name past the comment line's byte budget (over a thousand
  characters), and the persisted schema caps an entry name at 120.

**Every key above is scoped to the category section the line sits in.** Two entries can legitimately
share one *bind value* — a continuous catalogue row bound in two categories mirrors as its own bare
`+forward` in both — and keyed on the bare value those two collapsed into a single entry on read: one
`cid` and one set of keys survived and the other entry was gone without a warning. Every line of one
entry sits in one category scope by construction (`Aliases: X`, `Binds: X` and `Entries: X` are one
scope, `sectionCategoryKey`), which is the scope anchors were already matched in, so scoping the
whole key space costs a healthy file nothing.

### The one lossy shape: two entries, one alias name

An entry's derived alias name is a slug of its display name with **no id suffix** (story 039's own
decision: the name is the user's contract with whatever binding calls it, so a collision is reported
by Care's `aliasDuplicate` rule, never silently renamed). Two entries whose display names slug to
the same thing — `Fire` and `fire!` both give `fire` — therefore render two `alias fire` lines.

Quake II's alias name space is flat and whole-file: the engine keeps only the *last* definition of a
name, so in the game both keys already run the last entry's commands. Every reader here folds `alias`
lines the same way, and it does so **before** the entry reconstruction runs, so the earlier
definition's body is gone before anything can attribute it to an entry. Section scoping does not help
— the fold is by name across the whole file, whether the two lines sit in one category section or in
two.

That loss cannot be undone on read, so it is **reported where it happens**: the fold itself emits an
`entry-alias-duplicate` warning per discarded definition, naming the alias name and the line whose
body did not survive (`file-source.ts#foldConfig` for a profile's own canonical file,
`import-reader.ts#applyAlias`'s `duplicateAliases` for an installation import). A reload surfaces it
as its own warning toast next to the "reloaded" notice (`RefreshedProfileResult.droppedAliases`), an
import lists it in the preview dialog.

**Every** adopt path surfaces that toast, not just the automatic one. There are three ways a file
gets adopted, and all three build the warning from the same
`file-source-refresh.ts#droppedAliasWarning`: the automatic re-read on config-tab open and window
focus (`ConfigView`), **Care → Sync → Reload**, and the conflict dialog's **Take the file** — the
latter two through the shared `adoptProfileFromFile`, which owns the toast so a take-the-file button
cannot be added without it. On the startup rebuild path (`rebuild.ts`, a canonical file with no
profile record) there is no renderer to toast at yet and `ConfigProfile` has no field for a read
warning, so the dropped names go to the log instead — the profile comes back one entry short either
way, but never silently.

This is the one shape the launcher can write that is not a fixed point: a re-render of the reloaded
profile has only one `fire` entry left to write. Fixing it at the source would mean disambiguating
alias names at render time, which contradicts story 039's decision above and would rename a name the
user may have bound something else to by hand — so the file format states the ambiguity and the app
says out loud what it cost, rather than pretending the round trip held.

**Entry order comes from the file too.** The rendered file carries the action order three times, as
a subsequence each: the alias sections, the bind sections and the anchor sections, each sorted by
the owning action's index. The reader orders its entries by the one order consistent with all three
(`orderGroupsByFile`), not by "aliases first" — otherwise an aliasless entry (a continuous
catalogue row bound to its bare `+command`) sorted behind every alias-backed entry of its category
regardless of where its bind line actually sat, and `compareOwnedBinds` then swapped the two bind
lines on the next render: a byte difference on a file nobody had edited.

An anchor that cannot be matched unambiguously — because the user renamed one of an entry's lines
differently from the others, because its prose is only a truncation of the entry's own, or because a
step's candidate set has more than one match — becomes a
standalone entry of its own rather than being dropped or guessed onto the wrong one. This is
accepted drift, not a bug: "if the user later renames the entry's display text inconsistently
across its lines, the anchor and the entry drift apart into two separate rows in the UI" is the
user's own decision from this story's refine — splitting is the safe failure direction, since a
wrong *merge* would silently rewrite which keys one Controls-tab row owns, while a split leaves
every key and every config line intact and visible, just filed under two rows instead of one.

A code line carrying no `[q2l` tag at all is not an entry line — tag presence is the whole
launcher-owned signal now that `e` is gone (see "The marker tag" above). An untagged hand-added
`alias` line is not dropped either: it degrades through story 041's inference (`entryKindFor`) the
same way a wholesale untagged file does, so nothing is silently lost.

Entry **kind** (`bind`/`alias`/`message`/…) is always inferred from the line's own content
(`entryKindFor`, story 041) — never stored in the tag. The old `resolveKind` function and the
`tag-kind-unknown`/`tag-kind-contradicted` warnings it produced were removed along with `k`.

## Unknown keys

A key that is not in this registry is never dropped. It round-trips into `fields` exactly like a
known key, and is additionally reported (`unknownKeys` from `parseMetaTag`, or the reconstruction
layer's warnings) so a caller can surface "this file uses fields this version doesn't recognise"
instead of the data silently vanishing. A hand-edited `e=…`/`k=…`/`slot=…` left over from an older
file, or typed by hand, is one example of such a key — read back, reported, and otherwise ignored.
This is what makes the format forward-compatible: a future launcher version can add a key, and an
older launcher parsing that file still recovers every field it *does* understand instead of failing
the whole tag — or worse, the whole line.

## The version rule

`v` lives once, in the header block's tag — never repeated on a per-line tag. It stays at `1`;
story 050 did not bump it, since the writer and reader both moved to the reduced tag shape directly
with no dual-format support (a pre-release app has no installed base of files in the old shape to
migrate). Story 051 did not bump it either, for the same reason: `v` alongside `id` versus `v`
alone is already a free discriminator between the new banner header shape and the legacy one (see
"Header block" above), so nothing about the version number itself needed to change. An
unrecognised `v` (larger than this build's `META_FORMAT_VERSION`) is not fatal. Parsing is
tag-by-tag and key-by-key regardless of `v`: an unknown `v` just means "this file may carry keys I
don't recognise", and any key that genuinely is unrecognised is reported the same way an unknown
key under a *known* `v` would be. A file with no `v` at all (no `[q2l …]` tag anywhere) is not a
042-era file at all — it falls back to the plain, pre-042 import path.

## Escaping

A tag **value** percent-escapes exactly four characters:

| character | escape |
| --------- | ------ |
| space     | `%20`  |
| `%`       | `%25`  |
| `]`       | `%5D`  |
| `/`       | `%2F`  |

Decoding reverses only these four two-hex sequences (case-insensitively); any other `%xx` a decoder
encounters is left exactly as written, because a well-formed tag this module produced can never
contain one. Escaping `%` itself is what keeps the scheme unambiguous in both directions: every
literal `%` in a value becomes `%25` on the way out, so a decoder never has to guess whether a `%`
it sees on the way in was already an escape.

Escaping `/` is what keeps the *tag text* free of a literal `//` substring — required because these
lines already live inside a `//` comment, and a second `//` inside a comment is used elsewhere in
this codebase as a command separator. Since every `/` in a value is escaped, `//` cannot occur
structurally anywhere in a rendered tag.

A character above the latin-1 range (code point over `0xFF`) is dropped from a value outright
rather than mangled, matching `cfg-layout.ts`'s `sanitizeComment` — the writer encodes every
rendered file as latin-1, so nothing that cannot survive that trip may reach this format's output.
CR/LF/tab are folded to a space before escaping, for the same reason: left alone, any one of them
would cut the rendered line early or reopen it as two.

### Prose is not escaped — it is neutralised

Prose (the display name) is not tag content, so it is not percent-escaped. But a display name is
user-typed text, and a player could type a literal `[q2l cat=weapons]` hoping to forge a category or
catalogue id. `neutralizeProse` closes this by rewriting every literal `[q2l` substring in prose to
`(q2l` before the comment is ever written. After that rewrite, the exact substring the parser
anchors on can no longer occur in prose, so a forged "tag" always reads back as inert text, never as
a real one. This transform is one-way (a display name that genuinely contained the text `[q2l`
loses that exact spelling once) — the accepted cost of a single, unambiguous sigil.

## Examples

A dual-key weapon entry, both slots — one plain, written as two `bind` lines on the same command
(paired back together purely because the command matches, no field involved):

```
bind q "ssg_sg"       // SSG + SG [q2l cid=weapons:ssg_sg]
bind mouse2 "ssg_sg"  // SSG + SG [q2l cid=weapons:ssg_sg]
```

An entry with no catalogue link at all still gets the bare marker tag, so it is still recognised as
launcher-owned on the next read:

```
bind f1 "gg"   // GG [q2l]
```

A category section header:

```
// --- Weapons [q2l cat=weapons] -------------------------------------------
```

A header block carrying the version and ownership marker (see "Header block" above):

```
// ==============================================================================
//  My Profile
// ==============================================================================
//                              [q2l v=1 id=3f9c2a1e-fd01-4353-81c9-3e6961d5ac72]
```

A display name that tried to forge a tag, after `neutralizeProse`:

```
bind f1 "gg"   // GG (q2l cat=weapons) [q2l cid=weapons:gg]
```
