---
id: 176
title: The Demos view shows only what helps right now
status: ready # draft -> ready -> in-progress -> done
created: 2026-09-30
---

## Requirement

The Demos view carries two pieces of permanent chrome that do nothing for me most of the time:

- The **console command field** at the bottom is only useful while a demo plays. When nothing
  plays it sits there disabled with "Not available: no demo is playing" — a whole band of the
  screen spent on a control I cannot use.
- The **sort caption** under the header ("Favourites first, then newest") repeats what the list
  already shows and only adds noise.

Both go: the console field appears only while a demo plays, the sort caption disappears.

## Acceptance Criteria

- [ ] **AC1** — With no demo playing, the Demos view shows no console command field and no
      "no demo is playing" text.
- [ ] **AC2** — While a demo plays, the console command field is shown and sends a line exactly as
      today ([[166]]); story [[173]]'s Windows stage hint is still shown next to it.
- [ ] **AC3** — When the demo ends (finish, stop or game exit), the console command field disappears
      again.
- [ ] **AC4** — The Demos view shows no sort caption under its header, neither for the default order
      nor for a column sort; the column headers still mark the active sort column and direction.

## Open Questions

- ~~Q1: When the field is only there during playback, it has no "why disabled" state left. Is there a
  platform case where a demo plays but the field cannot send (a channel that does not exist)? If so,
  that case keeps its visible reason (CLAUDE.md platform-parity rule) — refine checks
  `ConsoleCommandField.tsx`'s current reasons.~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Refine checks ConsoleCommandField's current reasons: the field only shows during playback, and any case where it can't send keeps a visible reason (platform-parity rule)
- **Dec1 — No platform case loses a reason.** `ConsoleCommandField.tsx`'s only non-session reason is `disabled.noSession`; main has a playback channel on both win32 and Linux (`playback-control.ts:149`, `windows-channel.ts`, `linux-channel.ts`), so no "demo plays but cannot send" platform case exists — the validator reasons (`error.*`) and main's refusal stay visible text exactly as today, only `disabled.noSession` goes (it can no longer be seen).
- **Dec2 — "Playing" means `session !== null && session.view?.ended !== true`.** AC3 lists "finish" and the channel rejects every send after `Demo finished` (`linux-channel.ts:74`, `linux-channel.test.ts:74`), so a finished demo whose session is still open must hide the field too.
- **Dec3 — The field's band stays reserved while the stage is up; the field is hidden, not unmounted, inside it.** Story 170's stage box must not change size when the session goes live (checked by `scripts/flows/replays-stage.mjs`); rendering the field only once live would shrink the picture after the game window was already placed on it, so `ReplaysView` renders the field only in `stageMode` and the field renders `invisible` + `aria-hidden` + `inert` while not live — outside `stageMode` (no demo at all) it is not in the DOM.
- **Dec4 — Direction stays accessible via sr-only text on the active header button.** The caption was the only text naming the sort direction (the header arrow is `aria-hidden`); removing it without a replacement would leave screen-reader users with no direction, so the active column button gets an `sr-only` span with the existing `replays.sort.direction.{asc,desc}` text.
- **Dec5 — Dead i18n keys go.** `replays.console.disabled.*` and `replays.sort.current.*` lose their last user; `replays.console.error.noSession` (still used for main's refusal / thrown IPC) and `servers.sort.current.*` (Servers view, out of scope) stay.
- **Dec6 — Finish is proven through the real field.** The stub engine clamps `seek 100%` to the demo end and then prints `Demo finished`, so sending `seek 100%` through the console field drives the real finish path without a new fixture lever.

## Plan

Renderer-only story, two independent pieces, both in `src/renderer/src/modules/replays/`.

1. **Console field only while playing (D1).** `ConsoleCommandField.tsx` derives
   `live = session !== null && session.view?.ended !== true`. Not live → the section renders
   `invisible`, `aria-hidden="true"`, `inert`, with no reason line text (the `disabled.noSession`
   branch is deleted). Live → exactly today's behaviour (validator reasons, main refusal, story 173
   stage hint). `ReplaysView.tsx` renders `<ConsoleCommandField />` only when `stageMode`
   (`stageArmed || session !== null`), so with no demo at all it is absent from the DOM, and during
   the armed-not-yet-live window / after finish its band is still reserved (story 170 stage box).
2. **No sort caption (D2).** Delete `sortCaption` and the `replays-sort-current` `<p>` from
   `ReplaysView.tsx`; `DemoListHeader.tsx`'s active button gains an `sr-only` direction span.
3. i18n cleanup + CHANGELOG line per D; flows and unit tests updated in the D that changes the
   behaviour.

Order: D1, then D2 (both touch `ReplaysView.tsx` and `en.json`, at different lines).

## Deliverables

- **D1 — The console field shows only while a demo plays.**
  Files: `src/renderer/src/modules/replays/components/ConsoleCommandField.tsx`,
  `src/renderer/src/modules/replays/ReplaysView.tsx`, `src/renderer/src/i18n/locales/en.json`,
  `src/renderer/src/modules/replays/components/ConsoleCommandField.test.tsx`,
  `scripts/flows/replays-console-command.mjs`, `scripts/flows/replays-stop.mjs`, `CHANGELOG.md`.
  - `ConsoleCommandField.tsx`: replace `hasSession` with
    `live = usePlaybackStore(s => s.session !== null && s.session.view?.ended !== true)`. Delete the
    `!hasSession ? t('replays.console.disabled.noSession')` branch. When `!live`, the `<section>`
    keeps its markup but gets `className` `invisible` added plus `aria-hidden="true"` and `inert`,
    input/Send stay disabled, and no reason text is rendered (keep the empty `min-h-4` reason slot so
    the band's height matches the live one). Live: unchanged (validator reasons, server refusal with
    `role="alert"`, `showStageHint`). Update the doc comment (no longer "always rendered").
  - `ReplaysView.tsx` (currently line ~421): render `{stageMode && <ConsoleCommandField />}`.
    Do **not** gate on `session` there — the band must exist from the play click (`stageArmed`) so
    the stage picture's box does not change when the session goes live (story 170; guarded by
    `scripts/flows/replays-stage.mjs`, which must still pass unchanged — its `live` probe reads
    `!input.disabled`, which stays valid).
  - `en.json`: remove `replays.console.disabled` (the whole object). Keep `replays.console.error.noSession`.
  - Unit tests in `ConsoleCommandField.test.tsx`: replace "without a session the field is disabled
    with a visible reason" by **"without a session the field is hidden and names no reason"**
    (section has `aria-hidden="true"` and `inert`, document contains no "no demo is playing" text,
    `consoleSend` not called); add **"a finished demo hides the field"** (begin, `applyState('finished')`
    → section `aria-hidden="true"`); add **"the field hides again when the session ends"** (begin →
    not hidden; `applyState('ended')` → hidden). Existing send/reason/hint tests stay green.
  - Flow `replays-console-command.mjs`: first step becomes "with no demo playing there is no console
    field and no no-session text" — `replays-console-field` count is 0 and
    `page.getByText('no demo is playing')` count is 0 (shot `console-no-session`). The live steps stay.
    The final "the game exits" step additionally waits for `replays-console-field` `state: 'hidden'`
    (detached counts as hidden).
  - Flow `replays-stop.mjs`: after the second step's stop (timeline detached) assert
    `replays-console-field` is hidden. Append a last step **"a finished demo hides the console
    field"**: `rmSync(ignoreQuitFile)` if present, `playDemo`, type `seek 100%` into
    `replays-console-input` + Enter, wait for `replays-timeline-state` text `Finished`, then wait for
    `replays-console-field` `state: 'hidden'` while `replays-timeline` is still visible; clean up by
    `writeFileSync(files.quitFile, '')`, wait for the timeline detached, `rmSync(files.quitFile)`.
  - `CHANGELOG.md`: one line under the current version's `### Changed` (Keep-a-Changelog headings).

- **D2 — The Demos view has no sort caption; the header still names the sort.**
  Files: `src/renderer/src/modules/replays/ReplaysView.tsx`,
  `src/renderer/src/modules/replays/components/DemoListHeader.tsx`,
  `src/renderer/src/modules/replays/components/DemoListHeader.test.tsx` (new; mirror the jsdom +
  `initI18n('en')` idiom of `ConsoleCommandField.test.tsx`), `src/renderer/src/i18n/locales/en.json`,
  `scripts/flows/replays-sort-order.mjs`, `CHANGELOG.md`.
  - `ReplaysView.tsx`: delete the `sortCaption` constant and the
    `<p data-testid="replays-sort-current">` element (currently lines ~311-317, ~338-340). Sort
    state, `handleSort` and `VirtualDemoList`'s `sort`/`onSort` are unchanged.
  - `DemoListHeader.tsx`: inside the active button, next to the `aria-hidden` arrow, add
    `<span className="sr-only" data-testid="replays-sort-direction">{t(`replays.sort.direction.${sort.direction}`)}</span>`.
    `aria-pressed` and the arrow stay.
  - `en.json`: remove `replays.sort.current` (both keys). Keep `replays.sort.column.*`,
    `replays.sort.direction.*`, and the Servers view's `servers.sort.current.*`.
  - Unit test `DemoListHeader.test.tsx` › **"the active column carries aria-pressed, an arrow and its
    direction as text"**: render with `{ column: 'map', direction: 'asc' }` → `replays-sort-map` has
    `aria-pressed="true"` and contains `replays-sort-direction` text `ascending`; with `desc` →
    `descending`; with `sort={null}` → no button pressed, no `replays-sort-direction`.
  - Flow `replays-sort-order.mjs`: replace the `replays-sort-current` text check (lines ~141-144) by
    "no sort caption in the default order" (`replays-sort-current` count 0 and
    `page.getByText('Favourites first, then newest')` count 0). After the map-ascending click assert
    `replays-sort-current` count 0 again and that `replays-sort-map`'s `replays-sort-direction` text
    is `ascending`; after the second map click (desc) that it is `descending`.
  - `CHANGELOG.md`: one line under the current version's `### Removed`.

## Model Hints

- D1, D2 → default tier. D1's one subtlety (the band must exist from `stageArmed`, not from
  `session`) is spelled out in the D and guarded by the existing `replays-stage` flow.

Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/replays-console-command.mjs` › `replays-console-command` (step "with no
  demo playing there is no console field and no no-session text"); unit
  `src/renderer/src/modules/replays/components/ConsoleCommandField.test.tsx` › "without a session the
  field is hidden and names no reason"
- AC2 → e2e `scripts/flows/replays-console-command.mjs` › `replays-console-command` (live send of
  `fov 110`, refused non-ASCII line with visible reason); e2e `scripts/flows/replays-stop.mjs` ›
  `replays-stop` (step "the windowed stage says in-game typing does not reach the game" — story 173
  hint); stage box unchanged: e2e `scripts/flows/replays-stage.mjs` › `replays-stage`
- AC3 → e2e `scripts/flows/replays-stop.mjs` › `replays-stop` (stop: field hidden after the stop
  step; finish: step "a finished demo hides the console field"); e2e
  `scripts/flows/replays-console-command.mjs` › `replays-console-command` (game exit: step "the game
  exits"); unit `ConsoleCommandField.test.tsx` › "a finished demo hides the field", "the field hides
  again when the session ends"
- AC4 → e2e `scripts/flows/replays-sort-order.mjs` › `replays-sort-order` (no caption in default and
  column sort; `aria-pressed` + direction text per click); unit
  `src/renderer/src/modules/replays/components/DemoListHeader.test.tsx` › "the active column carries
  aria-pressed, an arrow and its direction as text"

Coverage gate: AC1 → D1 · AC2 → D1 · AC3 → D1 · AC4 → D2 — every criterion has a deliverable and a
named test.

## Done
