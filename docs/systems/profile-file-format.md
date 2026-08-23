# Profile file metadata format

Story 042 gives the launcher's rendered `.cfg` files a defined, versioned metadata format so a
launcher-written file can be re-imported without losing what the UI already knows about it —
display name, category, entry kind, key-slot pairing, layer membership — none of which the plain
Quake II config syntax has a place for. This document is the grammar reference; the implementation
is `src/shared/config/profile-metadata.ts` and its tests.

## Where it lives

Everything rides inside a `//` comment the config already has a reason to carry. Story 040 already
attaches a trailing comment (the display name) to every generated alias, bind and section-header
line; this story defines a machine-readable tail for that same comment rather than inventing a
second comment, a header block, or a side file.

```
bind q "ssg_sg"   // SSG + SG [q2l e=3f9a1c22 k=alias slot=1]
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

## Key registry

| key       | where it appears           | meaning                                                        |
| --------- | --------------------------- | --------------------------------------------------------------- |
| `v`       | header block only           | format version this file was written with (`META_FORMAT_VERSION`) |
| `e`       | bind/alias/override lines   | entry ref — deterministic 8-hex FNV-1a of `action.id`, not an index; used to pair the two lines of a two-slot entry and to survive insertions without renumbering the whole file |
| `k`       | bind/alias/override lines   | the entry's `kind`                                              |
| `cid`     | bind/alias/override lines   | catalogue id (`catalogId`), when the entry is catalogue-backed  |
| `an`      | anchor lines only           | the entry's own `aliasName`. Emitted only where no alias line exists to spell it out as code — an entry that keeps its alias line gets no `an`, since that line's own name *is* the value and a tag would be a second source able to drift from it |
| `slot`    | bind/alias/override lines   | which of the entry's two key slots this line is: `1` or `2`     |
| `mod`     | bind/alias/override lines   | that slot's `keyModifier`                                       |
| `key`     | anchor lines only           | the key of the slot this line records. Only ever emitted where the config text cannot say it — an anchor line is a comment, so it has no code to read a key off. A real `bind` line never carries it: the line already spells its key, and a second, tag-side copy could only drift from it |
| `cat`     | section header (category)   | category id — a built-in id is adopted as-is on import; an unrecognised one mints a local category named from the header's title |
| `layer`   | section header (layer)      | layer ref                                                        |
| `mode`    | section header (layer)      | layer mode                                                       |
| `trigger` | section header (layer)      | layer trigger key; the key is omitted entirely (not emitted as empty) when the trigger is `null` |

`KNOWN_META_KEYS` in `profile-metadata.ts` lists these in the exact order `formatMetaTag` always
emits them — that fixed order is part of the format's determinism guarantee: the same fields always
render to the same string, which is what a byte-equality test on rendered output depends on.

### Anchor lines

Almost every tag rides on a line the config needs anyway. One shape has no such line, and it gets a
comment-only **anchor line** in an `Entries: <category>` section of its own (placed after the bind
sections and before the layer sections, so an anchor sits under its own category header and outside
every layer section).

**A modified key slot** (`Alt+W`). Quake II has no modifiers, so that binding is not a `bind` line at
all — it is an override inside the modifier layer's generated `+alt`/`-alt` alias pair, and that pair
covers *every* override of the layer at once, so there is no per-override line for a tag to ride on.
Nothing else in the file can say which of the entry's two slots that key is, or which modifier it
carries — not even the entry's own alias line, which is the entry rather than one of its keys. So
every modified slot is anchored, whether or not the entry keeps an alias line: without that, an entry
whose *both* slots are modified had its primary and secondary decided by a guess on import.

**An entry with no line at all gets nothing, on purpose.** A continuous catalogue row with no key
mirrors as its own bare `+forward`, so its alias line is dropped (a self-mirroring `alias weapnext
weapnext` is dropped outright too) and with no key there is no bind line either — so such an entry
leaves no trace in the file and is dropped on re-import, exactly as before this story. An earlier
review round did give it a `slot`/`key`-less *entry* anchor to keep its name, kind, category and
catalogue id; that was reverted, because the file has nowhere to record what an unbound entry *runs*,
so the entry came back with `commands: []` — and the Controls tab's slot editor is find-or-create on
`catalogId` (`catalog-binds.ts#applySlot`), so the next bind of that same row reused the empty entry
and produced a key pointing at an alias nothing defines. Being dropped is better: `freshAction` then
regenerates the row's commands from the catalogue. The *reader* still accepts a slot-less anchor from
a hand-edited or older file rather than choking on it.

```
// --- Entries: Movement [q2l cat=movement] -----------------------------------
// Forward [q2l e=369ffc00 k=bind cid=forward slot=1 mod=ALT key=w]
// Next weapon [q2l e=1a2b3c4d k=bind an=weapnext slot=1 mod=ALT key=MWHEELUP]

// --- Layer: Alt (hold, on ALT) [q2l layer=… mode=hold trigger=ALT] ----------
alias +alt bind w +forward  // Alt
alias -alt unbind w         // Alt
bind ALT   +alt             // Alt
```

A slot anchor carries the entry's identity and which slot it is; the *command* is still read back out
of the layer override the anchor names, because that is where the profile really keeps it. A slot that
does have a bind line never gets an anchor — one fact, one place — and neither does an *unmodified*
slot with no bind line: the file's bind table is the observable truth about which key runs what, so
recording a key claim it contradicts would hand that key back to the entry on import.

An anchor is a comment-only line, and so is a section-header banner, so the reader has to tell the
two apart: **the tag decides, never the prose**. A line carrying an `e` field (and no
`cat`/`layer`/`v`) is an entry line, whatever its display name looks like — a name containing `---`
or `===` must not be read as a banner, or it would mint a category out of the user's own prose and
re-file every line below it in that section under it. `profile-restore.ts#claimsEntryRef` is the one
predicate both scans consult, so they cannot disagree about which line is which.

Anything the ACs already list that is *not* in this table (command order, `keepEmptyAlias`) is
deliberately left out of the tag: it is already carried by the plain config text itself (the rendered
body order, a rendered `""`), so a tag for it would just be a second, driftable source of the same
fact. The own alias name is the same rule with one exception — `an` exists only for the anchor lines,
where there is no alias line to carry it and therefore nothing for it to drift from.

### Unknown keys

A key that is not in this registry is never dropped. It round-trips into `fields` exactly like a
known key, and is additionally reported (`unknownKeys` from `parseMetaTag`, or the reconstruction
layer's warnings) so a caller can surface "this file uses fields this version doesn't recognise"
instead of the data silently vanishing. This is what makes the format forward-compatible: a future
launcher version can add a key, and an older launcher parsing that file still recovers every field
it *does* understand instead of failing the whole tag — or worse, the whole line.

## The version rule

`v` lives once, in the header block's tag — never repeated on a per-line tag. An unrecognised `v`
(larger than this build's `META_FORMAT_VERSION`) is not fatal. Parsing is tag-by-tag and key-by-key
regardless of `v`: an unknown `v` just means "this file may carry keys I don't recognise", and any
key that genuinely is unrecognised is reported the same way an unknown key under a *known* `v`
would be. A file with no `v` at all (no `[q2l …]` tag anywhere) is not a 042-era file at all — it
falls back to the plain, pre-042 import path.

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

A dual-bind weapon entry, both slots:

```
bind q "ssg_sg"       // SSG + SG [q2l e=3f9a1c22 k=alias slot=1]
bind mouse2 "ssg_sg"  // SSG + SG [q2l e=3f9a1c22 k=alias slot=2]
```

(the two lines share the same `e` and differ in `slot` — this is how the two physical bind lines of
one logical entry are paired back together on import)

A category section header:

```
// --- Weapons [q2l cat=weapons] -------------------------------------------
```

A header block carrying the version marker:

```
// ================================================================================
//  My Profile [q2l v=1]
//  Hand-edit at your own risk — the launcher will overwrite this file on save.
// ================================================================================
```

A display name that tried to forge a tag, after `neutralizeProse`:

```
bind f1 "gg"   // GG (q2l cat=weapons) [q2l e=a1b2c3d4 k=alias slot=1]
```
