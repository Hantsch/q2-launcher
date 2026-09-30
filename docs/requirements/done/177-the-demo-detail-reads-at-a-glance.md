---
id: 177
title: The demo detail reads at a glance
status: done # draft -> ready -> in-progress -> done
created: 2026-09-30
---

## Requirement

The demo detail panel ([[155]]) is a long list of rows where half the content is noise: a subheader
("What the browser knows") that says nothing, the name shown twice (header and first row), a
"Source" row with an internal installation id, a "Format" row that the file name already says, and a
provenance label ("from the demo", "from the file name", "file time", "guessed") behind every value.

The panel should read at a glance: the demo's name is the prominent header, and below it the facts
I care about, in the order I care about them — first the file, then the match:

1. File name, Length, Recorded
2. *(visual gap)*
3. Map, Mod, Gamemode, Players, Point of view

This changes concept DEMO-13 ("the detail view shows each value's source"): the effective-value
precedence stays, only its display in the detail panel goes.

## Acceptance Criteria

- [x] **AC1** — The panel header shows the demo's effective name (falling back to the file name) as
      its prominent title — visibly larger/stronger than today's `text-sm` header and than the field
      values below it.
- [x] **AC2** — The panel shows no "What the browser knows" subheader.
- [x] **AC3** — The facts list shows no Name, Source or Format row.
- [x] **AC4** — The facts list shows, top to bottom, File name, Length, Recorded, then a visible gap,
      then Map, Mod, Gamemode, Players, Point of view; a fact with no value anywhere is omitted as
      today, never shown blank.
- [x] **AC5** — No value in the facts list carries a provenance label ("from the demo", "from the
      file name", "file time", "guessed").
- [x] **AC6** — The MVD2 note and the sidecar-issue list are still shown when they apply.
- [x] **AC7** — The demo list row's gamemode carries no "(guessed)" marker; a guessed gamemode reads
      like a reported one (e.g. "Duel"). *(Added in refine from the (User) decision below.)*

## Open Questions

- ~~Q1: "Length" vs. "Duration" — the user's list says "Duration (Length)". Keep the label "Length"
  (matches the list column) or rename both to "Duration"? Recommendation: keep "Length", one word
  for one thing across list and detail.~~ answered → Decisions (Sprint)
- ~~Q2: The list row still shows "Duel (guessed)" under the file name. Does the provenance removal
  apply to the row as well, or only to the detail panel (as asked)? Recommendation: detail panel
  only in this story; the row is a separate decision.~~ answered → Decisions (Sprint)
- ~~Q3: Host, description, tags, favourite and rating also come out of `buildDemoDetail` today. Host
  is not in the user's list — drop it or append it after Point of view? Description and tags move
  to the edit story [[178]], favourite and rating to [[179]].~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Label: keep "Length"
- **(User)** Provenance removal: applies to the list row too (drop "(guessed)" noise in the row, not only the detail panel)
- **(User)** Host: dropped from the detail
- The list-row provenance decision gets its own AC7, because an uncovered in-scope behaviour is
  exactly what the coverage gate exists to prevent.
- Description, tags, favourite and rating leave the facts list in this story (AC4 names the list
  exactly); they stay editable in the existing notes form until [[178]] (AC8) and [[179]] give them
  their new reading-mode places.
- `buildDemoDetail` keeps each field's `source` in the model — only the display drops it — because
  `DemoNotesEditor`'s map placeholder (and [[178]]'s edit-mode placeholder decision) still needs it,
  and DEMO-13's precedence is unchanged.
- The model returns the facts as one flat `fields` array in display order, each field tagged with
  `group: 'file' | 'match'`, because that keeps `DemoNotesEditor`'s `fields.find(id === 'map')`
  working untouched while giving the panel what it needs for the gap.
- The gap is two separate `<dl>` groups (`replays-detail-facts-file`, `replays-detail-facts-match`)
  with a larger spacing between them than between rows, because a measurable DOM structure is what
  an e2e flow can prove, where a blank row would be neither semantic nor testable.
- The title becomes `text-lg font-semibold` (18px) in a header grown from `h-9` to `min-h-12 py-2`,
  still truncating, because AC1 asks for visibly stronger than the 14px values and the header must
  later hold [[179]]'s favourite toggle and [[178]]'s file-action icons.
- The Gamemode fact is rendered through `describeGamemode` (translated label, e.g. "TDM") instead
  of the raw id, because the detail should read the same as the list row it describes.
- `ValueSourceLabel.tsx` and its test are deleted, because the panel was their only user and the
  story removes that use (no orphaned component left behind).
- `describeGamemode` loses `guessedKey` and `replays.gamemode.guessed` leaves the locale and
  `GAMEMODE_I18N_KEYS`, because the list row was its only consumer; the gamemode filter's
  `excludeGuessed` logic stays, since it is filtering, not a per-value label.
- Locale keys orphaned by this story (`replays.detail.knownSection`, `replays.detail.field.name/
  host/format/source/levelName`) are removed; `replays.source.*` stays because `DemoNotesEditor`
  still uses it, and `field.description/tags/favourite/rating` stay for [[178]]/[[179]].
- `replays-rename.mjs`'s "set by you" assertions are replaced by checks on the value and on the
  renamed sidecar's JSON, because the flow's intent (the value moves into the sidecar) is unchanged
  while its visible provenance proof no longer exists.

## Plan

Three small deliverables, in order: shared model → detail panel → list row.

1. **Model** (`src/shared/replays/demo-detail.ts`): `buildDemoDetail` emits only the seven facts in
   display order — `fileName`, `duration`, `date` (group `file`), then `map`, `mod`, `gamemode`,
   `sides`, `pov` (group `match`) — omitting any fact with no value as today. `name`, `host`,
   `format`, `source`, `levelName`, `description`, `tags`, `favourite`, `rating` are gone from
   `DetailFieldId` and the output; `sourceValue()` and the `demoSourceKey` import go with them.
   `source` stays on each field. `knownPlayers`/`sidecarIssues` unchanged.
2. **Panel** (`DemoDetailPanel.tsx`): bigger header title; no "What the browser knows" `<h3>`; two
   `<dl>` groups with a gap; no `ValueSourceLabel`; gamemode via `describeGamemode`. Delete
   `ValueSourceLabel.tsx` + test, prune locale keys. Rewrite the `replays-demo-detail` flow to prove
   AC1–AC6 on the real UI; fix `replays-rename`'s provenance assertions.
3. **List row** (`DemoRow.tsx`): drop the "(guessed)" suffix; remove `guessedKey` from
   `describeGamemode`, the key from `GAMEMODE_I18N_KEYS` and the locale; flip the row test and the
   `replays-demo-rows` flow's duel assertion.

Build order matters for [[178]]/[[179]], which reshape the same panel afterwards.

## Deliverables

- [x] **D1 — the detail model carries the seven facts in two ordered groups.**
  Files: `src/shared/replays/demo-detail.ts`, `src/shared/replays/demo-detail.test.ts`.
  `buildDemoDetail(row, sidecar)` returns `fields` in exactly this order, each with a new
  `group: 'file' | 'match'` property next to `id`/`value`/`source`: `fileName` (file, `row.fileName`,
  source `null`), `duration` (file, `row.durationMs` when finite, source `null`), `date` (file,
  `row.effective.date`), `map`, `mod`, `gamemode`, `sides`, `pov` (all match, from `row.effective.*`
  with their effective source). A fact with no value is omitted (existing `hasValue` guard). Remove
  `name`, `host`, `format`, `source`, `levelName`, `description`, `tags`, `favourite`, `rating` from
  `DetailFieldId` and from the output, and delete the now-unused `sourceValue()` helper and
  `demoSourceKey` import. Keep `knownPlayers` and `sidecarIssues` exactly as they are. The
  `sidecar` parameter becomes unused — keep the signature (callers pass it; [[178]] will read
  description/tags from it) and prefix it `_sidecar` or leave a one-line comment, whichever the
  lint/typecheck accepts. `DemoNotesEditor.tsx` consumes `fields.find(f => f.id === 'map')` and
  must keep compiling unchanged. Update the unit tests: replace "the detail lists every effective
  value with its source" with **"the detail lists the file facts, then the match facts, in order"**
  (asserts the id sequence and groups for a fully populated row, and that no removed id appears)
  and add **"a fact with no value anywhere is omitted"** (e.g. a row with `pov` and `durationMs`
  unset lacks those ids, no blank entries). Keep the known-players and sidecar-state tests.
  Acceptance: `npx vitest run src/shared/replays/demo-detail.test.ts` green, `npm run typecheck`
  green.

- [x] **D2 — the panel reads at a glance.** Depends on D1.
  Files: `src/renderer/src/modules/replays/components/DemoDetailPanel.tsx`,
  `DemoDetailPanel.test.tsx` (same folder), delete `ValueSourceLabel.tsx` and
  `ValueSourceLabel.test.tsx` (same folder), `src/renderer/src/i18n/locales/en.json`,
  `scripts/flows/replays-demo-detail.mjs`, `scripts/flows/replays-rename.mjs`.
  - Header: keep the sticky bar and close button; grow it from `h-9` to `min-h-12 py-2`; the
    `<h2 data-testid="replays-detail-title">` becomes `text-lg font-semibold text-ink`, still
    `min-w-0 truncate`, text = `row.effective.name.value ?? row.fileName` (unchanged fallback).
  - Remove the `<h3>` "What the browser knows" and the `ValueSourceLabel` import/usage.
  - Render the facts as two `<dl>`s split by `field.group`: `data-testid="replays-detail-facts-file"`
    then `data-testid="replays-detail-facts-match"`, rows inside with the existing
    `space-y-2`, the two groups separated by a clearly larger gap (e.g. wrapper `space-y-5`, vs.
    `space-y-2` between rows). A group with no facts is not rendered. Each row keeps
    `data-testid="replays-detail-field-<id>"` (other flows select `-map`/`-date`), the `<dt>` label
    `t('replays.detail.field.<id>')` and the value in `<dd>` — nothing else in the `<dd>`.
  - `fieldValueText`: drop the `tags`/`favourite` cases; add `gamemode` rendered via
    `describeGamemode({ value, source })` from `@shared/demos/gamemode` →
    `labelKey ? t(labelKey) : text` (never a guessed marker).
  - MVD2 note, play action, file actions, sidecar-issue list and the notes editor stay as they are.
  - Delete `ValueSourceLabel.tsx` + its test (only user was this panel). In `en.json` remove
    `replays.detail.knownSection` and `replays.detail.field.name/host/format/source/levelName`;
    keep `replays.source.*` (used by `DemoNotesEditor.tsx`) and
    `field.description/tags/favourite/rating`.
  - Unit test `DemoDetailPanel.test.tsx`: replace "the panel shows each value with its source as
    text" with **"the panel shows the name as its title and the facts without provenance"**
    (title text is "Grand final"; no `replays-detail-field-name`/`-source`/`-format`/`-host`; no
    "What the browser knows"; panel text contains none of "set by you", "from the demo", "from the
    file name", "file time", "guessed"; gamemode reads "CTF"). Keep the sidecar-issues and mvd2
    tests green.
  - Flow `scripts/flows/replays-demo-detail.mjs` (flow name `replays-demo-detail`, same
    `replays-rows` variant and fixtures): rewrite its steps to prove on the real UI —
    (a) the tdm row's title shows "Fixture TDM Match" and its computed `font-size` is larger than
    that of a fact value's `<dd>` and larger than 14px; (b) no text "What the browser knows" in the
    panel; (c) no `replays-detail-field-name/-source/-format` elements; (d) the field test ids, in
    DOM order, are a subsequence of `fileName, duration, date | map, mod, gamemode, sides, pov`
    with the file ones inside `replays-detail-facts-file` and the match ones inside
    `replays-detail-facts-match`, and the vertical distance between the last file row's bottom and
    the first match row's top exceeds the distance between two rows inside one group; (e) for the
    mvd, tdm and duel rows the panel text contains none of the provenance strings; (f) the mvd row
    shows `demo-detail-mvd2-note`. Keep the closing step and the `replays-demo-detail` screenshot.
    Update the selector header comment.
  - Flow `scripts/flows/replays-rename.mjs`: replace the two "set by you" assertions (map, date)
    with: the map field still contains `q2dm1`, the renamed sidecar JSON carries `map: "q2dm1"`,
    and the date field shows a non-empty value; rewrite the comment above it accordingly.
  Acceptance: `npx vitest run src/renderer/src/modules/replays/components/DemoDetailPanel.test.tsx`,
  `npm run ui:flow -- replays-demo-detail`, `npm run ui:flow -- replays-rename` green;
  `npm run typecheck` green.

- [x] **D3 — the list row drops "(guessed)".** Independent of D2's files except `en.json`.
  Files: `src/shared/demos/gamemode.ts`, `src/shared/demos/gamemode.test.ts`,
  `src/renderer/src/modules/replays/components/DemoRow.tsx`, `DemoRow.test.tsx` (same folder),
  `src/renderer/src/i18n/locales/en.json`, `scripts/flows/replays-demo-rows.mjs`,
  `scripts/lib/fixture.mjs` (doc comments near `writeReplaysRowsFixture`, ~l.2257/2272 only),
  `scripts/lib/screens.mjs` (~l.1403 comment only).
  Remove `guessedKey` from `GamemodeDescription` and `describeGamemode` (it returns only
  `labelKey` or `text`), remove `'replays.gamemode.guessed'` from `GAMEMODE_I18N_KEYS` and from
  `en.json` (`replays.gamemode.guessed` only — `replays.source.guessed` stays). Keep
  `resolveGamemode`'s `'guessed'` source and the filter's `excludeGuessed` logic untouched. In
  `DemoRow.tsx` delete the `({t(gamemodeDescription.guessedKey)})` span. Tests: in
  `gamemode.test.ts` replace "a guessed value carries the guessed marker" / "sidecar and name
  values carry no guessed marker" with **"a guessed value is described like a reported one"**; in
  `DemoRow.test.tsx` replace "a guessed gamemode is marked guessed" with **"a guessed gamemode
  carries no guessed marker"** (text is "Duel", no "guessed"). In `replays-demo-rows.mjs` rename
  the step to `'the two-single-player-sides row resolves gamemode "duel", with no guessed marker'`
  and invert the check at ~l.135 (must NOT include "guess"); update the header comment at l.13.
  Acceptance: `npx vitest run src/shared/demos/gamemode.test.ts
  src/renderer/src/modules/replays/components/DemoRow.test.tsx`, `npm run ui:flow --
  replays-demo-rows`, `npm run typecheck` green.

## Model Hints

All deliverables on the default tier — markup, a reordered pure function and a removed label; no
cross-module state, no new path.

Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/replays-demo-detail.mjs` › "replays-demo-detail" (D2, step a), with unit
  `src/renderer/src/modules/replays/components/DemoDetailPanel.test.tsx` › "the panel shows the
  name as its title and the facts without provenance"
- AC2 → e2e `scripts/flows/replays-demo-detail.mjs` › "replays-demo-detail" (D2, step b), with the
  same unit test
- AC3 → e2e `scripts/flows/replays-demo-detail.mjs` › "replays-demo-detail" (D2, step c), with unit
  `src/shared/replays/demo-detail.test.ts` › "the detail lists the file facts, then the match
  facts, in order" (D1)
- AC4 → e2e `scripts/flows/replays-demo-detail.mjs` › "replays-demo-detail" (D2, step d: order,
  groups, gap), with unit `src/shared/replays/demo-detail.test.ts` › "the detail lists the file
  facts, then the match facts, in order" and › "a fact with no value anywhere is omitted" (D1)
- AC5 → e2e `scripts/flows/replays-demo-detail.mjs` › "replays-demo-detail" (D2, step e), with unit
  `DemoDetailPanel.test.tsx` › "the panel shows the name as its title and the facts without
  provenance"
- AC6 → e2e `scripts/flows/replays-demo-detail.mjs` › "replays-demo-detail" (D2, step f: mvd2
  note), with unit `DemoDetailPanel.test.tsx` › "renders itemized sidecar issues when the live
  read reports an error" and › "an mvd2 row states who the camera follows; a dm2 row does not"
  (kept green; the sidecar-issue list needs a corrupt sidecar the `replays-rows` fixture's
  `replays-marker-sidecar-error` row may not open in the panel — unit level is the proof for that
  half)
- AC7 → e2e `scripts/flows/replays-demo-rows.mjs` › "replays-demo-rows" (D3, the duel step), with
  unit `src/renderer/src/modules/replays/components/DemoRow.test.tsx` › "a guessed gamemode carries
  no guessed marker" and `src/shared/demos/gamemode.test.ts` › "a guessed value is described like
  a reported one"

Coverage: AC1/AC2/AC5/AC6 → D2; AC3/AC4 → D1 + D2; AC7 → D3. Regression flow touched:
`replays-rename` (D2).

## Done

Summary: the demo detail model now emits seven facts (file name, length, recorded | map, mod,
gamemode, players, point of view) in two groups; the panel shows the name as a large title, two
`<dl>` groups with a gap, no provenance labels and no subheader; the list row drops "(guessed)".
`ValueSourceLabel` and orphaned locale keys are removed.

Commit message: `177: demo detail reads at a glance — name title, file/match fact groups, no provenance labels, no "(guessed)" in row`

Verification: narrow gate — `npm run build`, `npm run typecheck`, `npx vitest run --changed HEAD` (140 files / 1978 tests) and `npm run ui:flow -- replays-demo-detail|replays-demo-rows|replays-rename` (each run once) all green; review (default tier, 1 cycle) PASS. AC -> test as verified: AC1-AC5 -> `replays-demo-detail` flow steps + `DemoDetailPanel.test.tsx`/`demo-detail.test.ts` named tests passed; AC6 -> mvd2 flow step + kept unit tests passed; AC7 -> `replays-demo-rows` duel step + `DemoRow.test.tsx`/`gamemode.test.ts` named tests passed. No manual residue. Full gate pending (sprint's).

Decisions:
- The notes editor below the facts keeps its `replays.source.*` "(from the demo)" labels (kept per story decision); AC5 concerns the facts list, so the flow's provenance check covers title + both fact groups, while the unit test checks the whole panel.
- `DemoNotesEditor.test.tsx` got `group: 'match'` on its field literals (typecheck only).
- Unfixed minor review notes: the `as` cast around `describeGamemode` args in `DemoDetailPanel.tsx`, `truncate` on `<dd>` without tooltip, stale "Story 155 D1" header comment, thin "omitted" unit test (covers duration/pov only).
- CHANGELOG entry added under `### Changed` (repo uses Keep-a-Changelog headings, not `# Features`).

tiers: D 3 / hard 0 · review default · cycles 1 · agents 5
