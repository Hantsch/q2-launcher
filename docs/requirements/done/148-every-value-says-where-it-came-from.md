---
id: 148
title: every value says where it came from
status: done # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

The same fact can come from four places: what the user wrote (sidecar, [[146]]), what the demo
content says ([[136]]/[[137]]), what the file name says ([[139]]/[[140]]) and the file time. The
browser shows one **effective value** per field and makes it visible where that value came from, so
a user knows whether "q2dm1" is something they typed, something the demo recorded, or a guess from
the name (concept `docs/concepts/demo-browser.md` §5, §8.3, DEMO-13).

**Precedence per field: sidecar → demo content → file name → file time (date only).** What the user
entered always wins; the content is reliable for map, game dir and players. The resolver is pure
shared code. The gamemode's extra heuristic rung is [[149]].

## Acceptance Criteria

- [x] **AC1** — For every field, the resolver returns the first of sidecar → content → name → file
      time that has a value, plus which source it came from; a unit test covers each rung for each
      field.
- [x] **AC2** — The effective name is the sidecar name, else the file name.
- [x] **AC3** — The effective players/sides are the sidecar's sides, else the players from the demo
      content, else the players from the name facts.
- [x] **AC4** — The effective date is the sidecar's override, else the name-fact date, else the file
      time per the rule decided in Q1.
- [x] **AC5** — The detail view ([[155]]) shows each effective value's source as visible text
      (sidecar / demo / name / file / guessed), not only colour or an icon.
- [x] **AC6** — Clearing a field in the sidecar makes the next lower source's value effective again.

## Open Questions

- [x] ~~**Q1 — Which file time** — creation (≈ start of recording) or modification (≈ end), and what
      when the platform does not report creation time reliably (§6.3, §17.6)?~~ decided by refine →
      Decisions (Sprint)
- [x] ~~**Q2 — Mod vs. game dir** — is the effective "mod" the parsed game dir as-is, or mapped to a
      display name (`opentdm` → "OpenTDM")?~~ decided by refine → Decisions (Sprint)

## Decisions (Sprint)

- **Q1 — file time = creation time when trustworthy, else modification time.** Trustworthy means
  `birthtimeMs` is finite, `> 0` and `≤ mtimeMs`; otherwise `mtimeMs`. Reason: §6.3 — creation ≈
  start of recording is the date a user remembers; Linux reports `0` where the file system gives no
  birth time, and a Windows copy/download stamps creation with the copy time while keeping the
  modification time (creation > modification), so in both cases modification is the honest fallback.
- **Q2 — effective mod = the parsed game dir as-is** (e.g. `opentdm`), no display-name mapping.
  Reason: correctness first, and the server browser's precedent shows the raw `gamedir` as its mod
  (`src/renderer/src/modules/servers/ServerDetailHeader.tsx:106`, `list-filter.ts` filters on raw
  `row.mod`); no mapping table exists to reuse, and inventing one is out of scope.
- **Resolved field set:** `name`, `map`, `mod`, `gamemode`, `sides`, `date`, `pov`, `host`.
  Reason: these are the fields with more than one possible source; single-source values (level name,
  description, tags, favourite, rating, duration) have nothing to arbitrate and are passed through by
  their consumer.
- **Rungs per field** (first with a value wins): `name` sidecar → file name; `map` sidecar → demo →
  name facts; `mod` sidecar → demo game dir; `gamemode` sidecar only (149 appends pattern +
  heuristic); `sides` sidecar → demo players → name-fact players; `date` sidecar → name-fact date →
  file time; `pov` demo → name facts; `host` name facts. Reason: §8.3's order, restricted to the
  sources that actually carry each fact (§6.2/§6.3/§7).
- **Source codes** are a closed union `'sidecar' | 'demo' | 'name' | 'file' | 'guessed'`; the
  effective-name fallback (the file name itself) is `'name'`, and `'file'` is used only by the
  file-time date rung. Reason: `'name'` already means "read off the file name", so the file-name
  fallback shares it; `'guessed'` is declared now so [[149]] adds a rung, not a type change.
- **"Has a value"** = not `null`/`undefined`, not a blank string after trim, not an empty array.
  Reason: AC6 — a cleared field must fall through whether the editor removes the key or writes `""`/`[]`.
- **Demo/name rungs for `sides` yield one side without team or result** holding the player list.
  Reason: neither the demo header nor a name pattern says who played on which side (§6.3); a name
  pattern's team names are not tied to player lists, so the resolver does not invent sides from them.
- **Effective date is epoch ms.** Sidecar ISO date-time → `Date.parse`; name-fact wall-clock time is
  interpreted in the process's local time zone; an unparsable sidecar date falls through. Reason:
  one comparable number serves sort ([[152]]) and filter ([[153]]); a recorder's time zone is not
  in the file name, and the user's own is the best available guess.
- **Inputs are the real exported types of the earlier stories** (136/137 header result, 139 name
  facts, 146 sidecar type, 147's partial "valid fields" sidecar) plus an `fs.Stats`-compatible
  `{ birthtimeMs, mtimeMs }`; all of them are built before 148 (numeric build order). Reason: no
  parallel shape to drift; an unparsable demo (`ok: false`) simply contributes no demo rung.
- **The resolver is pure and not wired into an index/detail handler here.** Reason: sprint S26 is the
  data layer; its first consumers are the row ([[150]]) and detail view ([[155]], whose AC1 restates
  this AC5) in S27, which call it with the index entry.
- **AC5 is delivered as a renderer `ValueSourceLabel` component plus i18n keys**, unit-tested; the
  real-surface e2e is [[155]] AC1, where the detail view mounts it. Reason: no detail view exists in
  S26 and the sprint allows only the surface a story needs; showing a label is not a user action.
- **Labels (en):** sidecar "set by you", demo "from the demo", name "from the file name", file "file
  time", guessed "guessed". Reason: visible text a user understands without knowing the word
  "sidecar"; §8.3's list names the sources, not the wording.
- **No CHANGELOG entry.** Reason: the label is not mounted anywhere users see until [[155]].

## Plan

Triage: clear and ready — a pure resolver plus one small label component.

1. **D1 — pure resolver** `src/shared/demos/effective-values.ts`: `ValueSource` union,
   `Effective<T>`, `hasValue`, `firstValue(rungs)`, `effectiveFileTime(stats)`,
   `resolveEffectiveValues(inputs)` over the field/rung table in Decisions. Table-driven unit test
   per field × rung, the clear-a-field cases (AC6) and the file-time rule (Q1).
2. **D2 — source label** `src/renderer/src/modules/replays/components/ValueSourceLabel.tsx` + a
   `replays.source.*` block in `en.json`; RTL test per source and a key-coverage guard over the
   `VALUE_SOURCES` list exported by D1.

Order: D1 → D2 (D2 imports `ValueSource`/`VALUE_SOURCES` from D1).

## Deliverables

- **D1 — effective-value resolver (pure) + its tests.**
  Files: new `src/shared/demos/effective-values.ts`, new `src/shared/demos/effective-values.test.ts`.
  Mirror the pure-module style of `src/shared/demos/dm2-header.ts` (no `node:*`, no DOM, no electron).
  Exports:
  - `VALUE_SOURCES = ['sidecar', 'demo', 'name', 'file', 'guessed'] as const`, `type ValueSource`.
  - `type Effective<T> = { value: T; source: ValueSource } | { value: null; source: null }`.
  - `hasValue(v)`: false for `null`/`undefined`, a string blank after trim, an empty array; else true.
  - `firstValue<T>(rungs: ReadonlyArray<{ source: ValueSource; value: T | null | undefined }>):
Effective<T>` — first rung with `hasValue`, else `{ value: null, source: null }`. Exported for
    [[149]] to extend the gamemode rungs.
  - `effectiveFileTime({ birthtimeMs, mtimeMs }): number` — `birthtimeMs` if finite, `> 0` and
    `≤ mtimeMs`, else `mtimeMs`.
  - `resolveEffectiveValues(inputs): EffectiveValues` where `inputs = { fileName: string; sidecar:
<146's sidecar field type, partial — 147 passes only its valid fields> | null; header: <136/137's
header result> | null; nameFacts: <139's name-facts result> | null; fileTime: { birthtimeMs:
number; mtimeMs: number } }`. Import those types from the modules 136/137/139/146/147 created
    (all built before this story); a header with `ok: false` and a name result with no match count as
    absent. `EffectiveValues` has `name`, `map`, `mod`, `gamemode`, `sides`, `date`, `pov`, `host`,
    each `Effective<…>`. Rungs: `name` sidecar.name → fileName (source `'name'`, the base file name
    as-is); `map` sidecar.map → header.map (`'demo'`) → nameFacts.map (`'name'`); `mod` sidecar.mod →
    header.gameDir raw (`'demo'`); `gamemode` sidecar.gamemode only; `sides` sidecar.sides →
    `[{ players: header.players }]` (`'demo'`) → `[{ players: nameFacts players }]` (`'name'`), a demo
    /name rung with an empty player list has no value; `date` (epoch ms) `Date.parse(sidecar.date)`
    (NaN = no value) → name-fact date as local wall-clock time (`'name'`) → `effectiveFileTime`
    (`'file'`, always a value); `pov` header.pov (`'demo'`, MVD2 has none) → nameFacts pov
    (`'name'`); `host` nameFacts host (`'name'`). Build each field with `firstValue`.
    Tests (names under Acceptance Tests): an `it.each` table covering every field × every rung (each row
    supplies only that rung and the ones below it, asserting value + source); the name and sides
    specifics; the date chain incl. unparsable sidecar date; the three file-time cases (creation used;
    creation `0` → modification; creation > modification → modification); clearing: the same inputs
    with the sidecar field present, then removed, then `""`/`[]`, then `sidecar: null`, each time the
    next lower source becomes effective.
    Acceptance: those tests pass; `npm run typecheck` clean.

- **D2 — visible source label + strings + its tests.**
  Files: new `src/renderer/src/modules/replays/components/ValueSourceLabel.tsx`, new
  `src/renderer/src/modules/replays/components/ValueSourceLabel.test.tsx` (mirror the jsdom +
  `initI18n('en')` setup of `src/renderer/src/modules/servers/ServersListStatus.test.tsx`), edit
  `src/renderer/src/i18n/locales/en.json` (inside the existing top-level `replays` block from [[135]]
  add `source: { sidecar: "set by you", demo: "from the demo", name: "from the file name", file:
"file time", guessed: "guessed" }`).
  Component: `ValueSourceLabel({ source }: { source: ValueSource | null })` renders
  `t(\`replays.source.${source}\`)`as plain text in a`<span data-testid="value-source"
  data-source={source}>`using a muted text token (no raw palette class, no icon-only rendering);`source === null`renders nothing. Import`ValueSource`/`VALUE_SOURCES`from`@shared/demos/effective-values`.
Tests: for every entry of `VALUE_SOURCES`the component's text content equals that en label (a
missing key would render the key itself and fail); every`VALUE_SOURCES`member has a non-empty
string at`replays.source.<member>`in`en.json`; `null`renders nothing.
Acceptance: those tests pass;`npm run typecheck` clean.

## Model Hints

- D1 → default — a rung table over already-typed inputs; the one subtle rule (file time) is spelled
  out with its three test cases.
- D2 → default — a text-only presentational component and five strings.
- Review: → default — no hidden behaviour a default review would miss: every rung and the fallback
  rule are pinned value-and-source by the table test, and the label test fails on a missing key.

## Acceptance Tests

- AC1 → unit `src/shared/demos/effective-values.test.ts` › "each field takes the first rung that has
  a value and reports its source" (it.each over field × rung, D1)
- AC2 → unit `src/shared/demos/effective-values.test.ts` › "the effective name is the sidecar name,
  else the file name" (D1)
- AC3 → unit `src/shared/demos/effective-values.test.ts` › "the effective sides are the sidecar's,
  else the demo's players, else the name's players" (D1)
- AC4 → unit `src/shared/demos/effective-values.test.ts` › "the effective date is the sidecar
  override, else the name date, else the file time" and › "file time prefers creation and falls back
  to modification when creation is missing or later" (D1)
- AC5 → unit `src/renderer/src/modules/replays/components/ValueSourceLabel.test.tsx` › "every value
  source is shown as visible text" and › "every value source has an en label" (D2). Real-surface
  gap, named on purpose: no detail view exists in S26; [[155]] AC1's e2e flow proves the label in
  the detail view (for the sprint review).
- AC6 → unit `src/shared/demos/effective-values.test.ts` › "clearing a sidecar field makes the next
  lower source effective again" (D1)

## Done

Built the pure precedence resolver (D1: `src/shared/demos/effective-values.ts` —
`VALUE_SOURCES`/`ValueSource`, `Effective<T>`, `hasValue`, `firstValue`, `effectiveFileTime`,
`resolveEffectiveValues` over the field/rung table from Decisions) and the visible source label
(D2: `src/renderer/src/modules/replays/components/ValueSourceLabel.tsx` + `replays.source.*` en
strings, merged into the existing `replays.source` object which already held `extraFolder`).

Commit message: `148: every value says where it came from`

Verification: narrow gate only (no `--full`). `npm run build`, `npm run typecheck`,
`npx vitest run --changed HEAD` (695 tests, green) and the sprint's required collateral check
`npx vitest run src/main/modules/replays src/shared/modules/replays.test.ts src/shared/demos
src/shared/replays` (293 tests, green, no regressions) all passed. No e2e run: this story has no
criterion mapped to `e2e`/`e2e-story` (AC5's real-surface e2e is [[155]], named as a deliberate
gap in `## Acceptance Tests`). AC1–AC6 each verified against their named test in
`effective-values.test.ts` / `ValueSourceLabel.test.tsx`, all found and passing. Clean-agent
review (stage default, no hard stage — `Review: → default`): PASS, no findings, 0 fix cycles.

Decisions: none beyond what's already recorded in `## Decisions (Sprint)` — no new
implementation-detail calls were needed during build; the plan's shape (field/rung table,
`firstValue` export, `Effective<T>`) was followed as written.

No CHANGELOG entry (per Decisions — the label isn't mounted anywhere users see until [[155]]).

Narrow gate only. The full regression gate (`npm test`, `npm run ui:verify`, `npm run
ui:flows`) has not run — run it before commit/merge, or use `/build 148 --full`.

tiers: D 2 / hard 0 · review default · cycles 0 · agents 4
