---
id: 195
title: a quoted search matches exactly
status: done # draft -> ready -> in-progress -> done
created: 2026-10-01
---

## Requirement

As a player searching the server list, I can put my search term in quotes to find only the
servers where it matches whole, instead of every server whose name merely contains it. Searching
for `ffa` finds every server with "ffa" somewhere in it; searching for `"ffa"` finds the server
that is called exactly that. Without quotes, search behaves as it does today.

Idea taken from a review of ozy24/q2connect, whose search does the same.
Concept: [game-browser.md](../concepts/game-browser.md) §8, GB-L5.

## Acceptance Criteria

- [x] **AC1** — A search term wrapped in double quotes matches a row only when the quoted text
      equals the server name, the address, or a player name in full, case-insensitively.
- [x] **AC2** — A search term without quotes behaves exactly as before: case-insensitive substring
      on name, address and (where fetched) player names.
- [x] **AC3** — Quotes with surrounding whitespace (`"ffa"`) count as quoted; whitespace inside
      the quotes is part of the term.
- [x] **AC4** — A term with an opening quote and no closing one (`"ffa`), or empty quotes (`""`),
      is treated as plain substring text, never as an error and never as "match everything".
- [x] **AC5** — Player names are matched exactly only where stage 2 has fetched the roster, as
      for the unquoted search; a server without a fetched roster never matches on a player name.
- [x] **AC6** — The search field tells the user that quotes mean "exact" (placeholder or hint, an
      i18n key), so the feature is discoverable without documentation.

## Open Questions

- ~~**Q1**~~ answered → Decisions (Sprint) — — Double quotes only, or also single quotes as q2connect does? Single quotes occur inside
  server and player names (`o'brien`), so accepting them risks false exact searches.
  Recommendation: double quotes only.
- ~~**Q2**~~ answered → Decisions (Sprint) — Does the exact match see Quake's high-bit "green"
  characters as their plain ASCII equivalents (concept open point 10)? Whatever the answer, it
  must be the same one the unquoted search uses.

## Decisions (Sprint)

- **(User)** Quote characters: double quotes only
- **Q2 — no high-bit normalisation in this story:** the exact match compares exactly what the
  unquoted search compares (`toLowerCase()` of the decoded latin1 string, no `& 0x7f`); the
  unquoted search does no normalisation today (`src/shared/servers/list-filter.ts:55`) and
  concept open point 10 is unsettled, so adding it only to the quoted path would break the
  "same answer" rule and adding it to both would change AC2's "exactly as before".
- **Quote detection:** the raw term is trimmed; it is "quoted" when it is at least 3 characters,
  starts with `"` and ends with `"` — this is the smallest rule that makes `""` and a lone `"`
  fall through to substring (AC4) while `" "` keeps its inner whitespace (AC3).
- **Inner text is lowercased but not trimmed**, and any `"` inside it (`"a"b"` → `a"b`) is
  literal — AC3 says inner whitespace is part of the term and there is no escape syntax to invent.
- **Field values are compared as-is** (lowercased, not trimmed) — AC1 says "equals … in full",
  and the displayed name is the value.
- **Discoverability = placeholder text change, no new hint element:** the existing key
  `servers.filter.searchPlaceholder` gets the quote hint — AC6 allows a placeholder, and a new
  hint line would cost the filter bar height for one sentence.
- **Own flow, existing flow untouched:** the e2e proof is a new flow `servers-quoted-search`
  mirroring `servers-filter-search`, because its fixture ("Zulu" on B and D) has no name that
  distinguishes exact from substring and story 120's assertions must not move.
- **Parser lives next to `matchesSearch`** in `src/shared/servers/list-filter.ts` — the matcher is
  already pure shared code used by the renderer; no IPC or main change is needed.

## Plan

Small, two-layer change: the matcher in `src/shared` learns the quoted mode, the renderer only
changes a placeholder string, and a new flow proves it on the real surface.

1. D1 — `matchesSearch` (`src/shared/servers/list-filter.ts:55`) parses the term: quoted →
   `value.toLowerCase() === inner` on name / address / roster player names; otherwise today's
   code path unchanged. Unit tests in `list-filter.test.ts`.
2. D2 — placeholder text, new flow `scripts/flows/servers-quoted-search.mjs`, changelog line.

`filterServers`, `isFilterActive`, `ServersView.tsx` and `ServerListFilterBar.tsx` need no
code change (`isFilterActive` already treats any non-blank search as active).

## Deliverables

- **D1 — quoted search in the shared matcher, plus its unit tests.**
  Files: `src/shared/servers/list-filter.ts`, `src/shared/servers/list-filter.test.ts` (mirror the
  existing `describe('search matches …')` blocks around lines 233 and 255).
  In `matchesSearch(row, term)`: let `raw = term.trim()`. If `raw.length >= 3 &&
raw.startsWith('"') && raw.endsWith('"')`, the term is quoted: `inner = raw.slice(1, -1)
.toLowerCase()` (do **not** trim `inner`); the row matches when `row.name?.toLowerCase() ===
inner`, or `row.address.toLowerCase() === inner`, or — only when `Array.isArray(row.players)` —
  some `player.name.toLowerCase() === inner`. Otherwise run the existing substring logic
  unchanged (`raw.toLowerCase()`, empty → true). No high-bit/`& 0x7f` normalisation, no trimming
  of field values. Only double quotes count; single quotes are literal text. Never throws.
  Update the JSDoc to describe the quoted mode. Add one `describe` per behaviour with these
  test names:
  - `describe('a quoted search matches name, address or player name in full')` — `'"ffa"' matches
a row named "FFA" but not "FFA Classic"`, `matches an address exactly`, `matches a roster
player exactly but not a longer name containing it`, `is case-insensitive`.
  - `describe('quotes with surrounding whitespace still count as quoted')` — `' "ffa" ' is exact`,
    `whitespace inside the quotes is part of the term` (`'" ffa"'` does not match "ffa").
  - `describe('a malformed quote is plain substring text')` — `an unclosed quote is a substring
search`, `empty quotes do not match everything`, `a lone quote does not match everything`,
    `a single-quoted term is plain substring text`.
  - `describe('a quoted search matches player names only where a roster was fetched')` — numeric
    count and undefined `players` never match on a player name.
    Existing search tests must stay green unchanged (that is AC2's proof).

- **D2 — discoverable hint, end-to-end flow, changelog.**
  Files: `src/renderer/src/i18n/locales/en.json` (key `servers.filter.searchPlaceholder`, ~line
  880), `scripts/flows/servers-quoted-search.mjs` (new; mirror
  `scripts/flows/servers-filter-search.mjs` — its `bindResponder` UDP responders, `setup()`,
  `variant` export, `writePopulatedFixture` seeding and `visibleLabels`/`assertSet` helpers),
  `CHANGELOG.md` (one line under `## Unreleased`, e.g. "Server search: put a term in quotes to
  match it exactly."). If `src/renderer/src/modules/servers/ServerListFilterBar.test.tsx` asserts
  the old placeholder text, update that assertion.
  Placeholder text: `Name, address or player — "quotes" for exact`. Do not change
  `ServerListFilterBar.tsx` (it already reads the key).
  Flow fixture, three responders: **A** hostname `FFA`, players `"Zulu"`; **B** hostname
  `FFA Classic`, players `"Zulu2"`; **C** hostname `Cellar`, no players. Steps (each fills
  `servers-filter-search`, asserts the visible set, then clears):
  - `ffa` → A, B (substring unchanged); `"ffa"` → A only; `"ffa"` → A only;
  - `"zulu"` → A only (exact player); `zulu` → A, B;
  - `"ffa` → no rows (unclosed = literal substring `"ffa`); `""` → no rows, the no-match line is visible;
  - placeholder: the input's `placeholder` attribute contains `"quotes"`.
    Run with `npm run ui:flow -- servers-quoted-search`; also re-run
    `npm run ui:flow -- servers-filter-search` to confirm the existing search is untouched.

## Model Hints

No `deliverable-hard`: D1 is a ten-line pure function change with exhaustive unit tests, D2 is a
string, a changelog line and a flow copied from an existing one.

Review: → default

## Acceptance Tests

- AC1 → unit `src/shared/servers/list-filter.test.ts` › "a quoted search matches name, address or
  player name in full"; e2e `scripts/flows/servers-quoted-search.mjs` (`npm run ui:flow --
servers-quoted-search`), steps `"ffa"` → A and `"zulu"` → A.
- AC2 → unit `src/shared/servers/list-filter.test.ts` › existing "search matches server name or
  address for every row" and "search matches player names only where a roster was fetched"
  (unchanged); e2e `servers-quoted-search` steps `ffa` → A, B and `zulu` → A, B; regression e2e
  `servers-filter-search`.
- AC3 → unit `src/shared/servers/list-filter.test.ts` › "quotes with surrounding whitespace still
  count as quoted"; e2e `servers-quoted-search` step `"ffa"` → A.
- AC4 → unit `src/shared/servers/list-filter.test.ts` › "a malformed quote is plain substring
  text"; e2e `servers-quoted-search` steps `"ffa` → no rows and `""` → no rows.
- AC5 → unit `src/shared/servers/list-filter.test.ts` › "a quoted search matches player names
  only where a roster was fetched" (no-roster rows are not producible through the live UDP
  fixture once stage 2 has run, so this stays at unit level).
- AC6 → e2e `servers-quoted-search` step "placeholder mentions quotes".

Coverage gate: AC1 D1+D2 · AC2 D1 · AC3 D1+D2 · AC4 D1+D2 · AC5 D1 · AC6 D2 — every AC has a D
and a test.

## Done

Quoted search lands in the shared matcher (`list-filter.ts`: `"term"` = case-insensitive full equality on name, address, fetched roster names; everything else unchanged); placeholder carries the hint; new flow `servers-quoted-search`; one changelog line.

Commit message: `195: quoted search matches exactly — matcher quoted mode + unit tests, placeholder hint, flow, changelog`

Verification (narrow gate): `npm run build` green, `npm run typecheck` green, `npx vitest run --changed HEAD` green (112 files / 925 tests), `npm run ui:flow -- servers-quoted-search` green. AC → test as in `## Acceptance Tests`, all ran and passed (AC5 unit only, by design). Review: default stage, PASS, no findings needing a fix. No manual residue.
Open point: `npm run ui:flow -- servers-filter-search` is red at "AC1: mod=baseq2 shows B and C" (got {B}); also red on bare HEAD per the D2 agent (stash check) — pre-existing, left for the sprint gate.

Decisions:

- Story text said the flow step `"ffa` shows A, B. AC4 says an unclosed quote is plain substring text, i.e. the literal `"ffa`, which no fixture name contains, so the flow expects no rows; D2 and AC4 test lines corrected accordingly.
- Test name `' "ffa" ' is exact` was written as "a quoted term padded with spaces is exact" (same assertions).
- Changelog line follows the repo's `**Servers** —` style under Unreleased.

tiers: D 2 / hard 0 · review default · cycles 1 · agents 5
