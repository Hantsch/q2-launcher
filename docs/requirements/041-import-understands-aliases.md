---
id: 041
title: Import understands aliases, press/release pairs and unbindall
status: draft # draft -> ready -> in-progress -> done
created: 2026-08-22
---

## Requirement

`config-parser.ts` recognises `set*`, `bind`, `unbind`, `unbindall` and `exec`. Everything else —
"`alias`, `+`-prefixed commands, comment-only lines" — is preserved verbatim as an unclassified
line. That was an explicit S01 deferral ("`alias`/`+cmd`/alt-layer content is preserved verbatim
but not parsed — explicitly deferred to the follow-up sprint"), and it never happened.

The consequence, measured against my own real config: `dmalias.cfg` is **~90 alias definitions and
nothing else**. Importing it today produces a profile with zero entries and ninety preserved lines
— a Care tab full of rows the user has to hand-copy into the Controls tab one at a time. `dm.cfg`'s
`bind KP_END "drop_shotgun"` becomes a bind pointing at an alias the launcher has no record of,
which Care then reports as an undefined alias reference. The launcher cannot honestly claim to
import real configs while the single most common construct in them is unclassified text.

The alias idioms real configs actually use, all present in my files:

- Plain command aliases: `alias s_ok "say_team $g [ OK / COMING ] ... $loc_here $g"`
- Press/release pairs: `alias +slow "..."` / `alias -slow "..."`, bound as `bind SHIFT +slow`
- Alias calling alias: `alias lol "lol1;lol2;lol3"`, `alias blaster "use blaster; ...;
  blaster_settings"`, `alias dall "…"`
- Empty aliases used as user-editable hooks: `alias blaster_settings ""`
- Aliases that rebind keys: `alias cali "bind KP_END fuck; bind KP_DOWNARROW hure; …"` — the same
  construct the launcher's own hold layers generate
- Self-rewriting toggles: `alias zoom zoomin` / `alias zoomin "…; alias zoom zoomout"`
- `wait` chains: `alias wait5 "wait; wait; wait; wait; wait"`
- Colour cvars used as text variables: `set r ""` then `$r` inside a `say_team`

## Acceptance Criteria

- [ ] `alias <name> <body>` and `alias <name> "<body>"` are parsed into a real entry, not a preserved
      line: a `kind: 'alias'` action with the parsed name and its body split into commands on
      top-level `;`, using the same quote/`;`/`//` rules the tokenizer already implements.
- [ ] A `+x`/`-x` pair is recognised as a press/release pair and imported as such (two entries that
      the UI shows as belonging together, or one entry with both halves — the story decides).
- [ ] A bind whose command is a bare token matching an imported alias name becomes a reference to
      that entry, so Care reports neither an undefined alias nor an unreferenced one.
- [ ] A bind whose command is a raw `+command` (`bind e "+forward"`) is adopted as a bind entry
      without inventing an alias for it — the same rule story 038 establishes for the writer.
- [ ] An alias body that is a `say`/`say_team` command is imported as a message entry with its
      channel and text, and its chat macros (`$$loc_here`, `%l`, `%h`, `%a`, …) survive verbatim.
- [ ] An alias body containing `bind` commands is imported without being mangled, even where the
      launcher cannot model it as a layer.
- [ ] `unbindall` is honoured in file order: binds before it are discarded, binds after it win.
- [ ] `exec <file>` chains are followed as they already are, and an alias defined in an exec'd file
      resolves for a bind in the file that exec'd it.
- [ ] Alias-to-alias references resolve across the whole import, in any definition order (`lol`
      defined before `lol1` still resolves).
- [ ] A duplicate alias name across the imported set is reported (last-definition-wins, the engine's
      behaviour), not silently merged.
- [ ] Anything genuinely unparseable is still preserved verbatim — the story removes preserved lines
      by understanding them, never by dropping them.
- [ ] Importing `dmalias.cfg` + `dm.cfg` + `gfx.cfg` from `docs/fixtures/` (committed as a fixture)
      produces a profile whose Controls tab shows the aliases as entries, and the number of preserved
      lines is at most the comment/banner lines and the constructs named in Open Questions.

## Open Questions

- Self-rewriting toggles (`alias zoom zoomin` / `alias zoom zoomout`) and `wait` chains: imported as
  plain alias entries with raw bodies (correct but opaque in the UI), or is a first-class toggle
  entry kind in scope? Suggest raw bodies here and a separate story for the entry kind.
- An imported alias needs a `categoryId`. Which one — a single "imported" category, a guess from the
  body (`drop …` → drops, `use …` → weapons), or does the import dialog ask?
- `alias cali "bind KP_END fuck; …"` is functionally a toggle layer. Recognise it as an alt layer, or
  import it as a plain alias entry? A wrong layer guess is worse than a verbatim alias.
- Colour cvars (`set r ""` with alt-charset bytes) used as `$r` text variables: keep as ordinary
  cvars (they are), or does the message editor need to know they are colour codes?
- Real configs carry mod-side macros this repo's `CHAT_MACROS` does not list (`%N`, `%T`, `%L`).
  Extend the catalogue, or pass unknown `%x` through untouched and unvalidated?

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
