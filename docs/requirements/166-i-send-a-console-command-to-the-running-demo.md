---
id: 166
title: I send a console command to the running demo
status: ready # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

Anything the timeline does not cover — `cl_demosnaps`, `scr_demobar 2`, `fov 110`, a screenshot — a
user types into a command field next to the timeline, and it goes to the running engine (concept
`docs/concepts/demo-browser.md` §12.1, DEMO-26, DEMO-29). It is the user's own line to the user's own
local game, but it still ends up in a pipe or a control file, so main validates it as **one printable
line with a length cap** before it goes anywhere (§12.3).

## Acceptance Criteria

- [ ] **AC1** — While a demo plays, a command field next to the timeline sends the entered line to
      the engine through [[164]]'s channel.
- [ ] **AC2** — Main validates the line with a zod schema: exactly one line, printable characters
      only, no control characters, length ≤ the cap decided in Q1.
- [ ] **AC3** — A rejected line is not sent, and the user sees the reason next to the field.
- [ ] **AC4** — On the Windows cfg-polling route, a line cannot break out of the control file's
      structure (e.g. terminate the polling alias); a unit test pins it.
- [ ] **AC5** — Without a running session the field is disabled with its reason as visible text.
- [ ] **AC6** — The field is keyboard operable (Enter sends) with visible focus.

## Open Questions

- [x] ~~**Q1 — Length cap** — Quake's console line limit, or smaller?~~ answered → Decisions (Sprint)
- [x] ~~**Q2 — History** — does the field keep a command history (Up/Down)? Not in the concept.~~ answered → Decisions (Sprint)
- [x] ~~**Q3 — Output** — does the user see the engine's reply, or only send?~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Output: Send only in v1; no engine reply shown.
- **(User, sprint-level)** Playback goes through Q2PRO only; there is no r1q2 playback, so the
  field has no r1q2 variant.
- **Q1 — Length cap: 255 characters.** Q2PRO's console input field holds 255 characters
  (`MAX_FIELD_TEXT` 256 incl. terminator), so the launcher never accepts a line the in-game console
  itself could not take, and the line stays far below the 1024-char cfg/tokenizer limit even after
  the Windows route's framing.
- **Q2 — History: none in v1.** Neither the concept nor any AC asks for it; the field clears after a
  successful send and keeps its text after a rejection so the user can fix it. A history is a
  follow-up story if wanted.
- **D-A — "Printable" means ASCII `0x20`–`0x7E`.** Q2 engines are 8-bit-char and non-ASCII bytes
  would reach the console as garbage or coloured glyphs; this is the same rule
  `nameTemplateTextSchema` already uses. Leading/trailing whitespace is trimmed; an empty line is
  not sent (Send disabled, no error).
- **D-B — `;` and `$` are allowed.** Several commands in one line and cvar macros are ordinary
  console behaviour on the user's own local game; the validation guards the *transport's
  structure*, not what the user chooses to run (typing `alias <loop> ""` by hand is the user's
  choice, not a breakout).
- **D-C — Windows breakout guard (AC4): the free line never enters the guarded `if` string.** The
  spike's guard `if $seq != N then "<command>; set seq N; echo ACK N"` has no quote escaping in
  Q2's tokenizer, so a `"` in the line would close the string and move `set seq N` outside the
  guard (endless re-fire) or append arbitrary structure. Instead the route writes the line alone to
  a per-sequence command cfg and the guard only ever holds fixed text
  (`if $seq != N then "exec <cmdfile_N>; set seq N; echo ACK N"`); quotes, `//` and `;` then only
  affect the user's own line. Rejecting `"` instead was discarded because it would forbid ordinary
  commands (`bind x "..."`) on Windows only.
- **D-D — The field stays visible without a session.** [[165]] lets the timeline "disappear or
  return to idle"; the console field renders in the idle state too, disabled with its reason as
  visible text, so AC5 holds regardless of how 165 renders its idle timeline.

## Plan

Send-only free console line, Q2PRO only, validated in main, over [[164]]'s channel. Builds on 164
(channel + Windows cfg-polling route + stubbed engine) and 165 (timeline component + e2e seam);
build order is 164 → 165 → 166.

1. **Shared validator (D1):** `src/shared/replays/console-line.ts` — `CONSOLE_LINE_MAX = 255`, a zod
   `consoleLineSchema` and `validateConsoleLine(raw)` returning `{ ok: true, line } | { ok: false,
   reason }`. Mirrors `src/shared/replays/demo-rename.ts` (`validateDemoRename`). Used by main
   (authoritative, AC2) and by the renderer (immediate reason, AC3).
2. **Contract + main handler (D2):** new invoke `REPLAYS_HANDLERS.playbackConsoleSend`
   (`'playback.consoleSend'`) in `src/shared/modules/replays.ts`, loose outer payload schema
   `{ line: z.string().max(1024) }.strict()`; handler in `src/main/modules/replays/` validates with
   `validateConsoleLine`, answers `Outcome<void>` with `replays.console.error.<reason>` keys or
   `replays.console.error.noSession`, and only on success calls 164's channel `send(line)`.
3. **Windows breakout guard (D3):** 164's Windows cfg-polling route writes a free line into its own
   per-sequence command cfg and the guard `exec`s it (decision D-C); command files are written
   before the control file and removed after ACK and on channel close. Unit test pins AC4.
4. **Renderer field (D4):** `ConsoleCommandField` beside 165's timeline in the Demos view, client
   call, i18n keys, disabled-with-reason state, Enter sends; e2e flow `replays-console-command`
   against 164/165's stubbed engine.

Linux needs no extra encoding: stdin gets `line + "\n"` and D1 already rejects every line break.

## Deliverables

- **D1 — Console-line validator (shared, pure) plus its test.** New
  `src/shared/replays/console-line.ts`, mirroring `src/shared/replays/demo-rename.ts`
  (`validateDemoRename`: pure, no node/DOM, returns a reason code the caller maps to an i18n key).
  Export `CONSOLE_LINE_MAX = 255`; `consoleLineSchema` (zod): string, trimmed, min 1, max
  `CONSOLE_LINE_MAX`, every char in `0x20`–`0x7E` (so no `\r`, `\n`, tab, other control chars, no
  non-ASCII); `validateConsoleLine(raw: string)` → `{ ok: true; line: string } | { ok: false;
  reason: 'empty' | 'multiline' | 'control' | 'nonAscii' | 'tooLong' }` implemented via
  `consoleLineSchema` (reason order: `multiline` for any `\r`/`\n`, then `control`, `nonAscii`,
  `tooLong`, `empty` after trim). `;`, `$`, `"`, `//` are allowed (they are console syntax the
  user may use). Test `src/shared/replays/console-line.test.ts`: "a single printable line up to
  255 chars is accepted and trimmed", "a line break is rejected as multiline", "a control
  character is rejected", "a non-ASCII character is rejected", "256 characters are rejected as
  too long", "whitespace only is empty", "quotes, semicolons and $ are accepted".

- **D2 — `playback.consoleSend` contract and main handler plus its test.** Files:
  `src/shared/modules/replays.ts` (add `playbackConsoleSend: 'playback.consoleSend'` to
  `REPLAYS_HANDLERS` with a doc comment; add `replaysConsoleSendSchema = z.object({ line:
  z.string().max(1024) }).strict()` and register it in the module's handler→schema map next to
  `replaysDemoRenameSchema`); `src/main/modules/replays/playback-console.ts` (new —
  `createPlaybackConsole({ channelFor })` with `send(line): Promise<Outcome<void>>`: run
  `validateConsoleLine` from `@shared/replays/console-line`; on failure return
  `fail(\`replays.console.error.${reason}\`)` **without** touching the channel; with no current
  playback session return `fail('replays.console.error.noSession')` (map [[164]]'s typed
  no-session error to this key); otherwise call the channel's send with the *trimmed* line and
  return `ok(undefined)`); `src/main/modules/replays/index.ts` (register the handler, mirroring
  how `demoRename` is wired). Use `fail`/`ok`/`Outcome` from `@shared/types/common`. Test
  `src/main/modules/replays/playback-console.test.ts` with a fake channel: "a valid line is sent
  once, trimmed", "an invalid line never reaches the channel and names its reason", "no session
  is a typed noSession failure". Update `src/shared/modules/replays.test.ts` if it enumerates
  handlers/schemas.

- **D3 — Windows route: a free line cannot break out of the control file, plus its test.** File:
  [[164]]'s Windows cfg-polling route in `src/main/modules/replays/` (the module that writes the
  control file with the exactly-once guard `if $seq != N then "<command>; set seq N; echo ACK N"`)
  and its test file beside it. Change the encoding so a **free console line never appears inside
  the guarded `if` string**: for sequence N write the line alone, as the only line, to a
  per-sequence command cfg in the same game dir (named with the route's existing file prefix +
  `_cmd_N.cfg`), **then** atomically write the control file whose guard holds only fixed text:
  `if $seq != N then "exec <prefix>_cmd_N.cfg; set seq N; echo ACK N"`. Delete command file N
  after its ACK is seen, and all remaining command files when the channel closes (164's cleanup,
  AC5 there). Put the text building in a pure function (e.g. `encodeControlCommand(seq, line) →
  { controlText, commandFileName, commandText }`) so the test needs no filesystem. If 164 already
  routes every command through such a file, this D reduces to the test. Test names: "a console
  line cannot break out of the control file" — for hostile lines (`say "x"; alias loop ""`,
  `a" ; set seq 99 ; "`, `echo //x`, `$seq`, `}`) the control text equals the fixed template for
  that N byte-for-byte and never contains the line; the command text is exactly the line with one
  trailing newline; and "the command file is written before the control file and removed after
  ACK" (fake fs, write order recorded).

- **D4 — Console field beside the timeline plus its tests and e2e flow.** Files:
  `src/renderer/src/modules/replays/components/ConsoleCommandField.tsx` (new) +
  `ConsoleCommandField.test.tsx`; `src/renderer/src/modules/replays/client.ts` (add
  `consoleSend(line)` mirroring `renameDemo`); [[165]]'s timeline component in
  `src/renderer/src/modules/replays/` (render the field next to the timeline, **also in its idle /
  no-session state**); `src/renderer/src/i18n/locales/en.json` (`replays.console.*`: label,
  placeholder, send, `disabled.noSession` visible text, `error.empty|multiline|control|nonAscii|
  tooLong|noSession`); `scripts/flows/replays-console-command.mjs` (new, mirroring 165's timeline
  flow and its stubbed-engine seam). Mirror `src/renderer/src/modules/replays/RenameDemoDialog.tsx`
  (`Field` + `Input` from `components/ui/controls`, shared validator for the immediate reason,
  main's `Outcome` reason shown the same way). Behaviour: labelled text input + Send button;
  Enter sends; reason shown as text next to the field (`aria-describedby`) and nothing is sent when
  `validateConsoleLine` rejects; on success the field clears, on a main failure it keeps its text
  and shows the reason; without a session input and button are disabled and the
  `disabled.noSession` reason is **visible text**, not a tooltip; focus-visible ring from the
  shared controls, no raw palette classes. No history, no engine output (send only). Renderer
  tests: "a rejected line is not sent and shows its reason", "Enter sends a valid line and clears
  the field", "without a session the field is disabled with a visible reason". Flow
  `replays-console-command`: no session → field disabled with reason text visible; start playback
  against the stubbed engine; focus the field by keyboard, type `fov 110`, press Enter → the
  stubbed engine records exactly `fov 110`; type a line with a non-ASCII char, Enter → reason
  visible, stub records nothing new. The field is present on 165's timeline `ui:verify` screen
  (zero axe violations).

## Model Hints

- D3 → deliverable-hard — it changes [[164]]'s exactly-once polling protocol: a wrong write order
  (control file before its command file) or an early delete races the engine's `exec` and either
  drops or re-fires a command, a regression the timeline's own commands would inherit.
- Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/replays-console-command.mjs` › `replays-console-command`; unit
  `src/main/modules/replays/playback-console.test.ts` › "a valid line is sent once, trimmed"
- AC2 → unit `src/shared/replays/console-line.test.ts` › "a single printable line up to 255 chars
  is accepted and trimmed", "a line break is rejected as multiline", "a control character is
  rejected", "a non-ASCII character is rejected", "256 characters are rejected as too long";
  unit `src/main/modules/replays/playback-console.test.ts` › "an invalid line never reaches the
  channel and names its reason"
- AC3 → unit `src/renderer/src/modules/replays/components/ConsoleCommandField.test.tsx` › "a
  rejected line is not sent and shows its reason"; e2e `scripts/flows/replays-console-command.mjs`
  › `replays-console-command` (non-ASCII step)
- AC4 → unit, test file beside [[164]]'s Windows cfg-polling route in `src/main/modules/replays/` ›
  "a console line cannot break out of the control file", "the command file is written before the
  control file and removed after ACK"
- AC5 → unit `ConsoleCommandField.test.tsx` › "without a session the field is disabled with a
  visible reason"; e2e `scripts/flows/replays-console-command.mjs` › `replays-console-command`
  (no-session step); unit `playback-console.test.ts` › "no session is a typed noSession failure"
- AC6 → e2e `scripts/flows/replays-console-command.mjs` › `replays-console-command` (keyboard
  focus + Enter step); unit `ConsoleCommandField.test.tsx` › "Enter sends a valid line and clears
  the field"; focus visibility via 165's timeline `ui:verify` screen (zero axe violations)

## Done

<!-- Filled by /build 166. -->
