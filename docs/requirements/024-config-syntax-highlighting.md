---
id: 024
title: Read the config in the launcher with Quake 2 syntax highlighting
status: draft # draft -> ready -> in-progress -> done
created: 2026-08-19
---

## Requirement

If the launcher shows me the raw config, it should be readable in the launcher — highlighted, not
a grey wall of text. A `bind`, a cvar, an `alias`, a string and a comment should be
distinguishable at a glance, the same way an editor with a Quake 2 config grammar does it.

There is an existing VS Code extension for exactly this grammar:
<https://github.com/amokmen/quake2-config-syntax>. Its token classes are a good reference for what
to recognise — check its licence before taking anything literally, and reimplement rather than
bundle a TextMate grammar and a highlighting engine into the app.

## Acceptance Criteria

- [ ] A pure tokenizer in `src/shared` splits config text into tokens: comments, commands
      (`bind`/`unbind`/`alias`/`set`/`exec`/…), key names, cvar names, numbers, quoted strings,
      `+`/`-` commands, and plain text.
- [ ] The tokenizer is unit-tested against real rendered profile output and against imported
      hand-written configs, including the engine's quoting rules (no nested quotes, `;` as a
      command separator) that `alt-layers.ts` documents.
- [ ] The read-only viewer renders those tokens with design-token colours, monospace, line
      numbers, and text that stays selectable and copyable as the original bytes.
- [ ] High-ASCII/latin1 characters (the symbol picker's output) render as-is and are not mangled by
      the highlighting.
- [ ] A ~2000-line config renders without a visible delay, and an unknown line degrades to plain
      text rather than breaking the rest of the file.
- [ ] The viewer replaces the plain `CodeBlock` in Raw File, in the write preview dialog and in the
      import preview, so there is one highlighted config renderer, not three.
- [ ] If anything is derived from the referenced repository, its licence and attribution are
      recorded in the repo.

## Open Questions

- Highlight only, or also fold long alias bodies / jump to a bind by key name? Search inside the
  file would be genuinely useful for a 500-line config.

## Plan

## Deliverables

## Model Hints

## Test Plan (manual acceptance)

## Done
