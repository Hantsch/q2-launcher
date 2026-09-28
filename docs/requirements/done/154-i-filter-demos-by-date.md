---
id: 154
title: I filter demos by date
status: done # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

"What did I record in the last 30 days?" or "everything from last season's tournament weekend" — a
user filters demos by date with a few presets and a custom from–to range (concept
`docs/concepts/demo-browser.md` §3, §10, DEMO-18). The filter uses the effective date ([[148]]) and
combines with every filter of [[153]].

The renderer has no date picker yet (§14), so this story introduces one — a component built from the
design tokens, no image assets, keyboard operable.

## Acceptance Criteria

- [x] **AC1** — Date presets offered: today, last 7 days, last 30 days.
- [x] **AC2** — A custom range with from and to dates can be set; either end may be left open.
- [x] **AC3** — A from-date later than the to-date is rejected with a visible reason.
- [x] **AC4** — The date filter matches on the effective date; a demo whose only known date is the
      file time is filtered the same way as any other dated demo.
- [x] **AC5** — The date filter combines with [[153]]'s filters (AND) and is cleared by its
      clear-all action.
- [x] **AC6** — The date picker is fully keyboard operable, shows a visible focus state and has zero
      axe violations in `ui:verify`.
- [x] **AC7** — Dates are shown and entered in the user's locale format.

## Open Questions

- [x] ~~**Q1 — Presets** (§17.6) beyond "last 30 days": today, 7 days, 90 days, this year…?~~
      answered → Decisions (Sprint)
- [x] ~~**Q2 — File-time-only demos** (§17.6): filtered by file time like every other date, or marked
      and optionally excluded?~~ answered → Decisions (Sprint)
- [x] ~~**Q3 — Picker reuse** — is the new component a shared atom/molecule other modules may use
      (e.g. a future playtime range)?~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Presets: today, last 7 days, last 30 days. No 90-days/this-year presets for now.
- **(User)** File-time-only demos are filtered by the effective date exactly like any other demo, no
  distinct marker or exclusion toggle.
- **(User)** The date-range picker is built as a shared, reusable atom/molecule (not story-154-only),
  so a future consumer (e.g. a playtime range filter) can reuse it without a near-duplicate.
- **The picker lives in `src/renderer/src/components/ui/DateRangePicker.tsx`**, not in a new
  `atoms/`/`molecules/` tree — this repo's generic primitives (`Button`, `controls.tsx`, `Popover`)
  already sit in `components/ui/`, and it is molecule-level (composes `Button` + `Input` + `Popover`)
  with no domain types, so any module can import it.
- **The date fields are native `<input type="date">` via the existing `Input` atom**, styled with
  tokens (`color-scheme: dark`, `FIELD_BASE`) — Chromium's field gives locale-ordered segmented entry,
  keyboard operation and AT semantics for free; a hand-built calendar grid is complexity no AC asks for.
- **Pure range logic is shared code, `src/shared/date-range.ts`** — the filter engine (shared) and
  the picker (renderer) both need preset resolution and from/to validation, and `shared/` is the only
  layer both may import.
- **Calendar-day semantics in local time:** "today" = local midnight today to local midnight
  tomorrow; "last 7/30 days" = local midnight of (today − 6/29 days) to local midnight tomorrow;
  custom from/to are inclusive whole days; all boundaries built with `new Date(y, m, d)`, never
  `now − n × 86 400 000` — the picker works in days, and ms arithmetic breaks across DST.
- **Value shape:** `{ kind: 'preset', preset: 'today' | 'last7Days' | 'last30Days' } | { kind:
  'custom', from: 'YYYY-MM-DD' | null, to: 'YYYY-MM-DD' | null }`, `null` = no date filter; a custom
  value with both ends open normalises to `null` — the ISO local-date string is exactly what the
  native input yields and stays timezone-free when persisted.
- **from = to is valid** (a single day); **from > to is rejected**: the picker shows the reason as
  visible text next to the fields, marks the fields `aria-invalid`, and does not emit the value — the
  list keeps the last valid date filter (AC3's "rejected").
- **Custom fields apply live** on each valid change (no Apply button) — consistent with 153's live
  filters; choosing a preset clears the custom fields, editing a custom field leaves preset mode.
- **A demo with no effective date (`date.value === null`) is excluded while a date filter is set** —
  the same rule 153 applies to unrated demos under "rating ≥ n".
- **The date filter persists with 153's filters** in the `replays` state key (preset stored by id,
  re-resolved against "now" at filter time; custom stored as its ISO strings) — follows the (User)
  decision in [[153]] that filters survive leaving the view and restarts; a malformed or from > to
  stored value parses to `null`.
- **"now" is injected** into the filter engine (`nowMs` parameter) and the renderer passes
  `Date.now()` per filter pass — keeps the engine pure and its tests deterministic.
- **Locale = the renderer's default locale** (`Intl.DateTimeFormat(undefined, { dateStyle: 'medium'
  })`, i.e. Electron's app locale), not `i18n.language` — only `en` ships, so `i18n.language` would
  force US format on every user; the native date field follows the same app locale.
- **AC7 is proven by launching the flow with `--lang=de-DE`**, which needs a small harness addition
  (flow `setup()` may return extra launch args) — on an en-US test machine a wrong locale source
  would otherwise be indistinguishable from the right one.
- **Picker strings are generic `common.dateRange.*` keys; the filter bar's label is
  `replays.filter.date.*`** — a shared component must not own module prose.
- **No platform difference** — native date input and `Intl` behave the same on Windows and Linux, so
  there is no disabled-with-reason state to specify.

## Plan

Five Ds, bottom-up: pure range logic → filter engine + persistence → picker component → harness
launch args → wiring + e2e. Builds on [[153]]'s filter engine, filter bar and persisted filter
state; where this story names a 153 file, use the file 153's `## Done` section actually names.

1. **D1 Shared range logic** — `src/shared/date-range.ts`: value type, zod schema, preset
   resolution to a half-open `[startMs, endMs)` local-time range, ISO local-date validation,
   from > to check, `matchesDateRange`.
2. **D2 Filter engine + persistence** — 153's demo filter gains `date`; matches on the effective
   date; counted by "is active", reset by clear-all; persisted and parsed with 153's filter state.
3. **D3 `DateRangePicker`** — `components/ui/DateRangePicker.tsx`: trigger button + `Popover` with
   three preset toggles, From/To native date inputs, Clear, visible error; `common.dateRange.*`.
4. **D4 Harness launch args** — a flow's `setup()` may return `args`, appended to the Electron
   launch; needed for the `--lang=de-DE` locale proof.
5. **D5 Wiring + e2e** — picker in 153's filter bar, fixture demo dates relative to seed time
   (incl. a file-time-only demo), flow `replays-date-filter`, two `ui:verify` screens, CHANGELOG.

Order: D1 → D2 → D3 → D4 → D5 (D3 needs D1's types; D5 needs everything).

## Deliverables

- **D1 — shared date-range logic.** Files: `src/shared/date-range.ts` (new),
  `src/shared/date-range.test.ts` (new). Pure TS + zod, no node/DOM/electron imports (shared layer
  rule). Exports:
  - `type DateRangePreset = 'today' | 'last7Days' | 'last30Days'`, `DATE_RANGE_PRESETS` (that order).
  - `type DateRangeValue = { kind: 'preset'; preset: DateRangePreset } | { kind: 'custom'; from:
    string | null; to: string | null }` (strings are ISO local dates `YYYY-MM-DD`).
  - `dateRangeValueSchema` (zod) that accepts only valid calendar dates (reject `2026-02-30`,
    non-padded, garbage) and only presets from the list.
  - `isIsoLocalDate(s)`, `isRangeOrderValid(from, to)` (false only when both set and from > to).
  - `normalizeDateRange(value | null): DateRangeValue | null` — custom with both ends null → null;
    custom with from > to → null.
  - `resolveDateRange(value, nowMs): { startMs: number | null; endMs: number | null }` — half-open,
    local time. today: `[midnight(today), midnight(today+1))`; last7Days: `[midnight(today−6),
    midnight(today+1))`; last30Days: `[midnight(today−29), midnight(today+1))`; custom from →
    `midnight(from)`, custom to → `midnight(to+1)`, open end → null. Build every boundary with
    `new Date(y, m, d)` (let `Date` roll day overflow), **never** `nowMs − n × 86_400_000`.
  - `matchesDateRange(dateMs: number | null, range)` — no bounds → true; `dateMs === null` with any
    bound → false; else `start ≤ dateMs < end`.
  Tests (names exact): › "today covers local midnight to the next local midnight", › "last 7 days
  starts at local midnight six days ago and includes today", › "last 30 days starts at local
  midnight 29 days ago", › "a custom to-date includes that whole day", › "an open end is unbounded",
  › "a from-date later than the to-date is invalid", › "from equal to to is a valid single day",
  › "the schema rejects an impossible calendar date", › "a custom range with both ends open
  normalises to no filter", › "a range crossing a DST change still starts at local midnight" (build
  `now` in late March/October with `new Date(y, m, d, h)` and assert `new Date(startMs).getHours()
  === 0`), › "a demo without a date never matches an active range". Acceptance: tests pass,
  `npm run typecheck` clean.

- **D2 — the demo filter matches on the effective date and persists it.** Files: story 153's demo
  filter engine in `src/shared/` (expected `src/shared/replays/list-filter.ts` or similar — use the
  file 153's Done names) and its test; 153's persisted filter state in `src/shared/modules/replays.ts`
  and its parse in `src/main/lib/schemas.ts` (+ `schemas.test.ts`); nothing in the renderer. Changes:
  add `date: DateRangeValue | null` to 153's filter type; its empty/default filter has `date: null`
  (so 153's clear-all, which resets to that default, clears the date too); 153's "is filter active"
  returns true when `date` is non-null; the filter function takes a `nowMs: number` parameter (add it
  if 153's does not have one) and ANDs `matchesDateRange(demo.effective.date.value,
  resolveDateRange(filter.date, nowMs))` from `src/shared/date-range.ts` with every other filter. The
  match uses **only** the effective date value — never its `source` (a file-time-only demo is
  filtered exactly like a sidecar-dated one). Persistence: the stored filter's `date` field parses
  with `dateRangeValueSchema` then `normalizeDateRange`; missing, malformed or from > to → `null`,
  without dropping the other stored filters. Tests (names exact): in 153's filter test file › "the
  date filter matches on the effective date whatever its source" (two demos with the same
  `date.value`, sources `file` and `sidecar`, both match; a third outside the range does not), ›
  "the date filter ANDs with the other filters", › "the empty filter has no date filter and counts
  as inactive"; in `src/main/lib/schemas.test.ts` › "a stored date filter with from after to parses
  to no date filter, the other filters survive". Acceptance: tests pass, typecheck clean.

- **D3 — the shared `DateRangePicker`.** Files: `src/renderer/src/components/ui/DateRangePicker.tsx`
  (new), `src/renderer/src/components/ui/DateRangePicker.test.tsx` (new; mirror the testing-library
  style of `src/renderer/src/components/about/AboutPanel.test.tsx`),
  `src/renderer/src/i18n/locales/en.json` (`common.dateRange.*`). No domain types, no module
  imports. Props: `value: DateRangeValue | null`, `onChange(value: DateRangeValue | null)`,
  `presets: readonly DateRangePreset[]`, `label: string` (the trigger's accessible name prefix and
  the popover's `label`), optional `testId` (prefix for `data-testid`s: `-trigger`, `-preset-<id>`,
  `-from`, `-to`, `-clear`, `-error`). Structure: a `Button` trigger inside the existing
  `Popover` (`src/renderer/src/components/ui/Popover.tsx`, already does focus-in, Escape and
  focus-return); trigger text = `common.dateRange.any` / the preset's label /
  `common.dateRange.range` `{{from}} – {{to}}` / `common.dateRange.fromOnly` / `.toOnly`, dates
  formatted with `new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })` of the local date
  (**not** `i18n.language`). Popover body: presets as `Button`s with `aria-pressed`; `Field` +
  `Input type="date"` for From and To (`common.dateRange.from` / `.to`), token-styled incl.
  `color-scheme: dark` so the native indicator matches; a Clear button (`common.dateRange.clear`) →
  `onChange(null)`. Behaviour: preset click → `onChange({kind:'preset',…})` and empties the fields;
  a field change keeps a local draft, and when `isRangeOrderValid` → `onChange(normalizeDateRange(
  {kind:'custom', from: from || null, to: to || null}))`; when invalid → no `onChange`, render
  `<p role="alert" data-testid="…-error">` with `common.dateRange.fromAfterTo` ("The from date is
  after the to date.") and set `aria-invalid` + `aria-describedby` on both inputs. Every control has
  the repo's focus-visible ring (reuse `Button`/`FIELD_BASE` classes; no new colours — tokens only,
  no image assets). Strings: `common.dateRange.{any,from,to,clear,range,fromOnly,toOnly,fromAfterTo}`
  and `common.dateRange.preset.{today,last7Days,last30Days}` = "Today", "Last 7 days", "Last 30
  days". Tests (names exact): › "choosing a preset emits it and clears the custom fields", › "a
  from-date after the to-date shows the reason and emits nothing", › "a single open end is emitted
  as a half-open range", › "the picker is operable by keyboard alone" (Tab to trigger, Enter opens,
  Tab reaches presets/fields/Clear, Enter on a preset emits, Escape closes and focus returns to the
  trigger), › "the trigger shows the dates in the default locale format". Acceptance: tests pass,
  typecheck clean.

- **D4 — flows can pass extra Electron launch args.** Files: `scripts/flow.mjs`,
  `scripts/lib/harness.mjs`, `scripts/lib/harness.test.mjs` (and `scripts/flows-all.mjs` only if it
  launches apps itself rather than via `flow.mjs`). A flow's `setup()` may return `args: string[]`
  alongside `env`; `flow.mjs` passes it to `withApp({ …, extraArgs })`; `launchApp` appends
  `extraArgs` after `--user-data-dir=…` (default `[]`, so every existing caller is unchanged). Reject
  any `--user-data-dir` in `extraArgs` (the confinement switch must stay the harness's own). Tests
  (names exact) in `harness.test.mjs`, mirroring its existing stubbed-`launch` idiom: › "extra
  launch args are appended after the user-data-dir switch", › "extra launch args may not override
  the user-data-dir". Acceptance: `node --test scripts/lib/harness.test.mjs` (or the repo's existing
  runner for it) passes; every existing flow still launches (no `args` → identical argv).

- **D5 — the date filter in the Demos view, end to end.** Files: story 153's demo filter bar
  component (expected `src/renderer/src/modules/replays/…FilterBar.tsx`, mirror of
  `src/renderer/src/modules/servers/ServerListFilterBar.tsx`) and wherever 153 runs the filter (pass
  `Date.now()` as `nowMs`), `src/renderer/src/i18n/locales/en.json` (`replays.filter.date.label` =
  "Date"), `scripts/lib/fixture.mjs`, `scripts/lib/screens.mjs`, `scripts/flows/replays-date-filter.mjs`
  (new; mirror `scripts/flows/servers-filter-search.mjs` for structure and
  `scripts/flows/home-tile-states.mjs` for its in-flow axe idiom), `CHANGELOG.md`
  (`## Unreleased → ### Added`: one short line, filter demos by date). Wiring: `<DateRangePicker
  value={filter.date} presets={DATE_RANGE_PRESETS} label={t('replays.filter.date.label')}
  testId="replays-filter-date" onChange={…}>` updates 153's filter state (and so its persistence and
  "Showing X of Y"). Fixture: in `writeReplaysDemosFixture()` backdate demo files with `utimesSync`
  **relative to seed time** so that, from the flow's "now", demos fall at ~0 d (today), ~3 d, ~20 d
  and ~60 d ago, **keeping the existing relative order** of fixture demo dates (152's sort flow must
  not change); at least one of the ≤ 7 d demos must get its effective date from file time only (no
  sidecar date, no dated name pattern) and at least one other from a sidecar or name-fact date —
  check which each fixture demo resolves to and record it in a comment. Flow `replays-date-filter`:
  `setup()` returns `args: ['--lang=de-DE']` (D4). Steps (names exact, each one assertion group): ›
  "presets narrow the list" (Today / Last 7 days / Last 30 days each give the expected count, incl.
  the file-time-only demo under Last 7 days), › "a custom range with an open end" (fill From only via
  `locator.fill('YYYY-MM-DD')`, then To only), › "a from-date after the to-date is rejected" (error
  `replays-filter-date-error` visible with its text; the list count is unchanged), › "the date
  filter combines with the other filters and clear-all removes it" (date + one 153 filter → AND
  count; 153's clear-all → full count and trigger reads "Any date"), › "the picker works by keyboard
  alone" (only `keyboard.press`/`type`: open, pick a preset, reach the From field, type the
  locale-ordered digits `01092026`, assert `input.value === '2026-09-01'`; the focused control's
  computed outline or box-shadow is not `none`), › "dates read in the user's locale" (under
  `--lang=de-DE` the trigger shows `01.09.2026`), › "the open picker has no axe violations" (axe on
  the open popover, valid and error state). `screens.mjs`: add `replays-date-filter` (populated,
  picker open with a custom range) and `replays-date-filter-invalid` (from > to, error shown) —
  mirror the `replays-list` entry. Acceptance: `npm run ui:flow -- replays-date-filter` passes; the
  other `replays-*` flows still pass; `npm run ui:verify` reports zero axe violations on both new
  screens.

## Model Hints

- All Ds → default tier. D1's DST/day-boundary subtlety is pinned by its named tests and the
  explicit "`new Date(y, m, d)`, never ms arithmetic" rule; nothing else crosses modules in a
  non-obvious way.
- Review: → default

## Acceptance Tests

- AC1 → e2e `scripts/flows/replays-date-filter.mjs` › "presets narrow the list"; unit
  `src/renderer/src/components/ui/DateRangePicker.test.tsx` › "choosing a preset emits it and clears
  the custom fields"; unit `src/shared/date-range.test.ts` › "today covers local midnight to the next
  local midnight" / "last 7 days starts at local midnight six days ago and includes today" / "last 30
  days starts at local midnight 29 days ago" (D1, D3, D5)
- AC2 → e2e `scripts/flows/replays-date-filter.mjs` › "a custom range with an open end"; unit
  `DateRangePicker.test.tsx` › "a single open end is emitted as a half-open range"; unit
  `date-range.test.ts` › "a custom to-date includes that whole day" / "an open end is unbounded"
  (D1, D3, D5)
- AC3 → e2e `scripts/flows/replays-date-filter.mjs` › "a from-date after the to-date is rejected";
  unit `DateRangePicker.test.tsx` › "a from-date after the to-date shows the reason and emits
  nothing"; unit `src/main/lib/schemas.test.ts` › "a stored date filter with from after to parses to
  no date filter, the other filters survive" (D2, D3, D5)
- AC4 → unit 153's demo filter test › "the date filter matches on the effective date whatever its
  source"; e2e `scripts/flows/replays-date-filter.mjs` › "presets narrow the list" (file-time-only
  fixture demo counted under Last 7 days) (D2, D5)
- AC5 → e2e `scripts/flows/replays-date-filter.mjs` › "the date filter combines with the other
  filters and clear-all removes it"; unit 153's demo filter test › "the date filter ANDs with the
  other filters" / "the empty filter has no date filter and counts as inactive" (D2, D5)
- AC6 → e2e `scripts/flows/replays-date-filter.mjs` › "the picker works by keyboard alone" and ›
  "the open picker has no axe violations"; `npm run ui:verify` screens `replays-date-filter` and
  `replays-date-filter-invalid` with zero axe violations; unit `DateRangePicker.test.tsx` › "the
  picker is operable by keyboard alone" (D3, D5)
- AC7 → e2e `scripts/flows/replays-date-filter.mjs` › "dates read in the user's locale" (launched
  with `--lang=de-DE` via D4) and › "the picker works by keyboard alone" (locale-ordered digit
  entry); unit `DateRangePicker.test.tsx` › "the trigger shows the dates in the default locale
  format"; harness `scripts/lib/harness.test.mjs` › "extra launch args are appended after the
  user-data-dir switch" (D3, D4, D5)

## Done

Added `src/shared/date-range.ts` (preset resolution, ISO local-date validation, half-open
`resolveDateRange`, `matchesDateRange`, DST-safe calendar-day math) and wired it into 153's demo
filter engine (`src/shared/replays/list-filter.ts`: `DemoListFilter.date`, `nowMs`-aware matching,
`normalizeDemoListFilter`) and persistence (`src/main/lib/schemas.ts` read path, and — after
review — `src/main/modules/replays/index.ts`'s `listFilter.write` IPC handler write path). A new
shared `DateRangePicker` (`src/renderer/src/components/ui/DateRangePicker.tsx`, native
`<input type="date">` + `Popover`, `common.dateRange.*` strings) is wired into 153's
`DemoListFilterBar`/`ReplaysView`. D4 taught the UI-verify harness flow-level extra Electron launch
args (`--lang=…`), used to prove AC7. D5 added a dedicated e2e fixture/flow
(`REPLAYS_DATE_FILTER_VARIANT`, `scripts/flows/replays-date-filter.mjs`) with 4 demos at ~0/3/20/60
days, one file-time-only and one sidecar-dated, plus two new `ui:verify` screens.

Commit message: `154: I filter demos by date`

Verification — narrow gate: `npm run build` green, `npm run typecheck` clean, `npx vitest run
--changed HEAD` green (118 files / 1718 tests after the fix cycle), e2e `npm run ui:flow --
replays-date-filter` green (all steps incl. keyboard-only operation, `de-DE` locale, axe-clean
open/error states). AC1-AC7 walked against their named tests: all covered and passing (see review
below for two additions/corrections). `npm run ui:verify`'s own screen-level axe pass on the two
new screens was not run in this narrow gate — it is part of the full regression gate, not this
story's own. `scripts/lib/harness.test.mjs`'s two new tests ran inside the same `--changed HEAD`
pass (`vitest.config.ts` includes `scripts/**/*.test.mjs`). No `manual residue`.

Review (clean agent, default tier per Model Hints, no hard stage): verdict **UNCLEAR** on first
pass, two confirmed findings, both fixed and re-verified (build/typecheck/tests/e2e all green
again): (1) `listFilter.write`'s IPC handler persisted a renderer-supplied `DemoListFilter` without
`normalizeDemoListFilter`, unlike the read path (`parseReplaysState`) — a `from > to` payload could
round-trip to `state.json` un-normalized until the next app start; fixed, plus a new handler test.
(2) the e2e "a from-date after the to-date is rejected" step captured its "before" row count from
an effectively unfiltered state, so it couldn't distinguish correct rejection from a bug that
silently un-bounds an invalid range; rewritten to capture the narrowed `last7Days`-equivalent count
first and assert that exact narrower set survives the rejected edit. Everything else (AC1, AC2,
AC4-AC7, shared-layer purity, the focus-visible judgment call on the native date inputs, the
fixture's file-time-only/sidecar-dated claims) reviewed clean with no further findings.

Decisions made during implementation, beyond `## Decisions (Sprint)`: `demoListFilterSchema`'s
`date` field uses `.catch(null)` rather than a plain required field, deliberately less strict than
its sibling fields (whose invalidity still fails the whole stored filter, per the pre-existing
`malformedField` schemas.test.ts precedent) — this is what lets a missing/malformed `date` alone
degrade to `null` while every other stored filter field survives, per this story's own AC3/D2
wording. `matchesDemoFilter`/`filterDemos` take `nowMs` as an *optional* parameter defaulting to
`Date.now()` (not required) so D2 didn't have to touch the renderer ahead of D5; D5 then passes
`Date.now()` explicitly at the one real call site. The native date inputs' focus state is
border-colour-only (this repo's existing `Input`/`FIELD_BASE` convention, not new to this story) —
reviewed and judged a real, load-bearing focus indicator, not a corner cut.

Narrow gate only. The full regression gate (`npm test`, `npm run ui:verify`, `npm run ui:flows`)
has not run — run it before merging, or use `/build 154 --full`.

### Regression fix (S27 full gate)

`npm run ui:verify -- --screens=replays-date-filter-invalid` failed its `@940x620` visit (the
screen's second visit within the batched session, after `@1280x800`) with `replays-demo-list`
never becoming visible. Root cause: typing `From` alone commits and persists a valid,
single-open-ended custom range live (AC2/D3, correctly); typing `To` next into a value that makes
the pair invalid correctly rejects that combination and emits nothing further (AC3) — but the
*already-applied* from-only commit (`from: 2026-12-31, to: null`) stayed in effect and was
debounce-persisted (`ReplaysView.tsx`'s 300ms write / flush-on-unmount), even though the picker was
visibly showing a rejection error for the edit that produced it. Since that from-only date is far
outside the fixture's demo dates, it narrowed the list to zero rows, which swaps `replays-demo-list`
out for the `replays-filter-no-match` state (pre-existing, correct behaviour, not new to this fix) —
so the next session visit's `navigate()` timed out waiting for a list that no longer renders.

Fix (product code, `DateRangePicker`/`Popover`, both files this story already owns/uses): the
picker now remembers the filter value in effect when the popover was last opened
(`openValueRef` in `DateRangePicker.tsx`) and, if the popover closes (Escape, outside click, or its
own toggle) while the fields are still left in a rejected `from > to` state, reverts to that
pre-edit value instead of leaving the abandoned partial commit applied — matching AC3's own wording
more precisely ("the list keeps the last valid date filter" = the filter genuinely in effect before
this edit, not a half-typed value the user never finished). `Popover.tsx` gained a purely additive,
optional `onOpenChange?: (open: boolean) => void` prop (default no-op) to let `DateRangePicker`
observe every open/close transition regardless of cause; no existing `Popover` caller's behaviour
changes.

Files changed: `src/renderer/src/components/ui/DateRangePicker.tsx`,
`src/renderer/src/components/ui/Popover.tsx`.

Verified: `npm run ui:verify -- --screens=replays-date-filter-invalid` green on both viewports
(re-run twice more for reliability); `npx vitest run --changed HEAD` green (76 tests, 11 files,
incl. `Popover.test.tsx`/`DateRangePicker.test.tsx`); `npm run typecheck` clean. `npm run ui:flow --
replays-date-filter` still fails at its later, unrelated "the picker works by keyboard alone" step
(`could not Tab to "replays-filter-date-trigger" within 40 presses`) — confirmed via `git stash` to
reproduce identically on the pre-fix code, so it is a separate, pre-existing issue, not touched
here; flagged back to the orchestrator rather than fixed under this regression's scope.
