---
id: 139
title: a file name gives away what it can
status: done # draft -> ready -> in-progress -> done
created: 2026-09-27
---

## Requirement

The demo content does not store a date, a hostname, teams or a gamemode (concept
`docs/concepts/demo-browser.md` §6.3) — but the servers that auto-record often put exactly that into
the file name. The demo browser takes a file name apart with known patterns and turns it into
**name facts**: date/time, map, players, teams, host, POV (§5, §7, DEMO-8).

This story is the pattern engine plus the v1 set of **shipped** patterns (§7):

| Origin                             | Pattern                                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------------------------- |
| r1q2 `cl_autorecord 1`             | `%Y-%m-%d-%H%M-<map>.dm2`                                                                |
| Q2PRO `cl_beginmapcmd` recipe (§7) | `<map>_%Y-%m-%d_%H-%M-%S.dm2`                                                            |
| OpenTDM                            | `<player>-<teamA>-<teamB>-<hostname>-<map>_YYYY-MM-DD_HH-MM-SS`, unsafe characters → `_` |
| AQ2-TNG `use_mvd2`                 | `YYYYMMDD-HHMMSS-<map>.mvd2`                                                             |

Q2PRO `sv_mvd_autorecord` follows the mod's own `record` name and gets no pattern of its own;
TastySpleen and Q2Admin patterns are unknown until real samples exist (§17.3) — each becomes a new
story then. The ambiguity is real: OpenTDM splits on `-`, and team, host and map names can contain
`-` themselves. **A name that cannot be parsed unambiguously yields no name facts rather than wrong
ones.** The engine is the one [[140]]'s user templates run through, so the template syntax (§17.2)
is settled here.

## Acceptance Criteria

- [x] **AC1** — `2026-09-26-2130-q2dm1.dm2` yields date 2026-09-26 21:30 and map `q2dm1` from the
      r1q2 pattern.
- [x] **AC1b** — `q2dm1_2026-09-26_21-30-00.dm2` yields date 2026-09-26 21:30:00 and map `q2dm1`
      from the Q2PRO recipe pattern (the map leads here, unlike r1q2).
- [x] **AC2** — An OpenTDM name yields POV player, both team names, hostname, map and date/time.
- [x] **AC3** — `20260926-213000-urban.mvd2` yields date/time and map `urban` from the AQ2-TNG
      pattern.
- [x] **AC4** — Compression suffixes are ignored for matching: `x.dm2.gz` matches as `x.dm2` would.
- [x] **AC5** — A name that matches a pattern in more than one way (e.g. an OpenTDM name where a
      `-` inside a team or host name allows two splits) yields no name facts, and a test pins that.
- [x] **AC6** — A name that matches no pattern yields no name facts, and the result says which
      pattern (if any) matched, for [[148]]'s source display.
- [x] **AC7** — The shipped patterns are expressed in the same template syntax users write in
      [[140]], and the syntax (token vocabulary, date formats, separators) is documented in the
      concept (§17.2 resolved).
- [x] **AC8** — The engine is pure shared code with a unit test per shipped pattern.

## Open Questions

- [x] ~~**Q1 — Template syntax** (§17.2): token vocabulary (`{date}`, `{time}`, `{map}`, `{p1}`,
      `{teamA}`, `{host}`, `{pov}`…), how date formats are written, and how separators that also
      occur inside values are handled.~~ answered → Decisions (Sprint)
- [x] ~~**Q2 — Several patterns match unambiguously but differently** — first wins in a fixed order,
      or no facts?~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **Q1 token vocabulary.** Text tokens `{map}`, `{pov}`, `{p1}`…`{p9}`, `{teamA}`, `{teamB}`,
  `{host}`, `{skip}`; digit tokens `{year}` (4), `{month}`, `{day}`, `{hour}`, `{min}`, `{sec}`
  (2 each); shorthands `{date}` ≡ `{year}-{month}-{day}` and `{time}` ≡ `{hour}-{min}-{sec}` —
  the concept's own example `{date}_{map}_{p1}_vs_{p2}` works as written, and word tokens avoid
  the `MM`/`mm` month/minute case trap of strftime/moment formats.
- **Q1 date formats.** There is no format sub-language: a date is spelled with the fixed-width
  digit tokens and ordinary literals (`{year}{month}{day}-{hour}{min}{sec}`), which covers all four
  shipped shapes with one rule; `{date}`/`{time}` use `-` because `:` is illegal in Windows names.
- **Q1 separators inside values.** Separators are plain literals; a text token matches any non-empty
  run, and the matcher counts _every_ way the name can be split — more than one split means
  ambiguous (AC5), so `-` inside an OpenTDM team or host is handled by refusing, not guessing.
- **Q1 validity rules** (the reasons [[140]] AC2 shows): empty template, unclosed `{`/stray `}`,
  unknown token, a token used twice (`{skip}` excepted, `{date}` counts as its three parts), two
  text tokens with no literal between them, a template that captures nothing, a date missing
  year/month/day, a time without a date or without `{min}`, and an extension anywhere but a trailing
  `.dm2`/`.mvd2` — each rejection is an i18n key plus params, never prose (CLAUDE.md i18n rule).
- **Q2 order.** The engine takes one ordered list `{ id, template }[]` and never knows "shipped" vs
  "user" — exactly [[140]]'s unified, editable, top-to-bottom list; the first pattern that matches
  **uniquely** wins, because that list's order _is_ the user-visible precedence.
- **Q2 ambiguity stops the walk.** A pattern that matches ambiguously ends the search with
  `ambiguous` (no facts) instead of falling through: a looser later pattern would otherwise fill in
  a wrong fact — e.g. an ambiguous OpenTDM name would fall to the Q2PRO pattern and report
  `pov-teamA-teamB-host-map` as the map.
- Shipped order is most-specific first — OpenTDM, AQ2-TNG, r1q2, Q2PRO recipe — because every
  OpenTDM name also matches the Q2PRO `{map}_{date}_{time}` shape.
- Names are normalised before matching: a trailing `.gz` is dropped, the name must end in
  `.dm2`/`.mvd2` (else `none`), and the template sees the stem; a template ending in `.dm2`/`.mvd2`
  is restricted to that format, one without matches both (OpenTDM ships without) — faithful to §7.
- Literals and extensions match ASCII-case-insensitively (Windows names are case-insensitive, `.DM2`
  exists); captured values keep their original case, and OpenTDM's `_` for unsafe characters is not
  reversed because the original character is unknowable.
- Digit tokens are range-checked (month 1–12, real day of month, hour 0–23, min/sec 0–59); an
  out-of-range reading is not a match. The date fact is wall-clock components
  `{ year, month, day, hour?, minute?, second? }`, not a `Date`, since a file name carries no time
  zone.
- Ambiguity is counted by a memoised DP (segment × offset, count capped at 2), not by a regex or
  backtracking: a regex returns one split and cannot count, and naive backtracking is exponential on
  names with many `-`.
- Code lives in `src/shared/replays/` because [[140]] validates templates in the renderer and the
  scan runs them in main; the i18n strings for the error keys belong to [[140]], which first shows
  them.
- AC7's "documented in the concept" is pinned by a doc test reading `docs/concepts/demo-browser.md`,
  mirroring `src/main/modules/home/images/deviation-doc.test.ts`.

## Plan

1. **D1** — `src/shared/replays/name-template.ts`: `compileNameTemplate(text)` (parse + validate →
   compiled segments or an error key) and `matchNameTemplate(compiled, fileName)` (normalise name,
   count splits via capped DP, range-check digits, build facts). Pure; brute-force oracle test.
2. **D2** — `src/shared/replays/name-patterns.ts`: `SHIPPED_NAME_PATTERNS` (four `{id, template}`
   in the decided order) and `parseDemoName(fileName, patterns)` returning
   `matched | ambiguous | none` with the pattern id; one test per shipped pattern plus AC4–AC6.
   Resolve concept §17.2 (and point §7's user-template bullet there) with the syntax; doc test.

Order: D1 → D2. No IPC, no UI, no persistence — [[140]] stores/edits the list, [[144]] runs it on
scan, [[148]] displays the pattern id.

## Deliverables

- **D1 — template compiler + matcher** (`src/shared/replays/name-template.ts`, test
  `src/shared/replays/name-template.test.ts`). New folder; `src/shared` may not import `node:*`,
  `electron` or DOM. Mirror the pure-module + colocated-test style of
  `src/shared/servers/list-filter.ts`.
  - `compileNameTemplate(text: string): { ok: true; template: CompiledNameTemplate } | { ok: false;
error: { key: string; params?: Record<string, string | number> } }`. Error keys under
    `replays.nameTemplate.error.*` (`empty`, `unclosedBrace`, `strayBrace`, `unknownToken`,
    `duplicateToken`, `adjacentTextTokens`, `capturesNothing`, `incompleteDate`, `timeWithoutDate`,
    `misplacedExtension`); export them as a const. No locale strings in this D.
  - Tokens: text `{map}` `{pov}` `{p1}`…`{p9}` `{teamA}` `{teamB}` `{host}` `{skip}` (non-empty,
    any characters); digit `{year}` (4 digits) `{month}` `{day}` `{hour}` `{min}` `{sec}` (2 digits);
    `{date}` expands to `{year}-{month}-{day}`, `{time}` to `{hour}-{min}-{sec}`. Export the
    vocabulary as `NAME_TEMPLATE_TOKENS`. Invalid: empty; unclosed `{` / stray `}`; unknown token;
    a token twice (`{skip}` excepted; `{date}` counts as year+month+day); two text tokens without a
    literal between (digit tokens may be adjacent to anything); no capturing token; any of
    year/month/day without the other two; hour/min/sec without a full date, or hour without min;
    `.dm2`/`.mvd2` anywhere but as the template's trailing literal.
  - `matchNameTemplate(t, fileName): { kind: 'none' } | { kind: 'ambiguous' } | { kind: 'match';
facts: NameFacts }`. Normalise: drop trailing `.gz`, require and strip `.dm2`/`.mvd2`
    (case-insensitive; else `none`); a template with a trailing extension only matches that format.
    Literals compare ASCII-case-insensitively; captures keep original case. Count all splits with a
    memoised DP over (segment, offset), capped at 2 — no regex, no unbounded backtracking; digit
    values out of range (month 1–12, real day incl. leap years, hour 0–23, min/sec 0–59) are not a
    split. Exactly one split → facts; ≥2 → `ambiguous`.
  - `NameFacts`: `{ date?: { year; month; day; hour?; minute?; second? }; map?; pov?;
players?: string[] (p1…p9 in index order, gaps skipped); teamA?; teamB?; host? }`; `{skip}`
    yields nothing. Missing `{sec}` → `second` absent.
  - Tests: one per rejection key; the four shipped shapes' happy paths; `.gz`/upper-case extension;
    extension restriction; out-of-range date → `none`; `{a}-{b}-{c}`-style ambiguity (three-way,
    where all-greedy and all-lazy readings differ _and_ a case where they agree); a property test
    comparing the DP's count (capped at 2) against a brute-force enumerator over random short names
    of `-`/`_`/letters/digits; a 250-character name with 120 `-` against a five-text-token template
    completes in < 100 ms.
- **D2 — shipped patterns, list resolution, concept §17.2** (`src/shared/replays/name-patterns.ts`,
  test `src/shared/replays/name-patterns.test.ts`, `docs/concepts/demo-browser.md`, doc test
  `src/main/modules/replays/name-template-doc.test.ts` mirroring
  `src/main/modules/home/images/deviation-doc.test.ts`). Uses D1's
  `compileNameTemplate`/`matchNameTemplate`/`NAME_TEMPLATE_TOKENS` from
  `src/shared/replays/name-template.ts`.
  - `SHIPPED_NAME_PATTERNS: readonly { id: string; template: string }[]`, in this order:
    `opentdm` `{pov}-{teamA}-{teamB}-{host}-{map}_{date}_{time}`; `aq2tng-mvd2`
    `{year}{month}{day}-{hour}{min}{sec}-{map}.mvd2`; `r1q2-autorecord`
    `{year}-{month}-{day}-{hour}{min}-{map}.dm2`; `q2pro-beginmapcmd` `{map}_{date}_{time}.dm2`.
    Plain template strings in the user syntax — no special-cased code path.
  - `parseDemoName(fileName, patterns: readonly { id; template }[]): { status: 'matched';
patternId; facts } | { status: 'ambiguous'; patternId } | { status: 'none' }`. Walk top to
    bottom; skip entries that fail to compile; first unique match wins; the first ambiguous match
    stops the walk (no fall-through). Compile once per distinct list (cache by array identity).
  - Tests: AC1 `2026-09-26-2130-q2dm1.dm2` → r1q2, 2026-09-26 21:30, `q2dm1`; AC1b
    `q2dm1_2026-09-26_21-30-00.dm2` → Q2PRO recipe; AC2 `Alice-Red_Team-Blue-TDM_Server-q2dm1_2026-09-26_21-30-00.dm2`
    → opentdm with pov/teams/host/map/date-time (not Q2PRO); AC3 `20260926-213000-urban.mvd2` →
    AQ2-TNG; AC4 each of those with `.gz` → same result; AC5 an OpenTDM name with `-` inside the
    host → `ambiguous` with `opentdm`, and does not fall through to Q2PRO; AC6 `final.dm2` → `none`,
    and a matched result carries its `patternId`; every shipped template compiles via
    `compileNameTemplate`; a user entry placed above a shipped one wins for a name both match.
  - Concept: rewrite §17.2 as **resolved** with the vocabulary, the digit-token date rule, the
    separator/ambiguity rule, the validity rules and the "one ordered list, first unique match,
    ambiguity stops" order (as in Decisions (Sprint) above); add a template column to §7's shipped
    table. Doc test: §17.2 is marked resolved and names every token in `NAME_TEMPLATE_TOKENS` and
    every shipped template string.

## Model Hints

- D1 → deliverable-hard — the split-counting DP is the whole of AC5's "no facts rather than wrong
  ones": a first-match regex or greedy/lazy comparison passes the obvious tests yet silently returns
  one of several readings, and naive backtracking is exponential on `-`-heavy names.
- D2 → default.
- Review: → default — D1's brute-force oracle property test and the timing test catch the
  plausible wrong matchers, so no second pass is needed.

## Acceptance Tests

- AC1 → unit `src/shared/replays/name-patterns.test.ts` › "r1q2 autorecord name yields date and map"
- AC1b → unit `src/shared/replays/name-patterns.test.ts` › "Q2PRO beginmapcmd name yields date, seconds and map"
- AC2 → unit `src/shared/replays/name-patterns.test.ts` › "OpenTDM name yields pov, teams, host, map and date"
- AC3 → unit `src/shared/replays/name-patterns.test.ts` › "AQ2-TNG mvd2 name yields date and map"
- AC4 → unit `src/shared/replays/name-patterns.test.ts` › "a .gz suffix matches as the uncompressed name"
- AC5 → unit `src/shared/replays/name-patterns.test.ts` › "an OpenTDM name with two possible splits yields no name facts"
  (engine-level: `src/shared/replays/name-template.test.ts` › "split count matches a brute-force enumerator")
- AC6 → unit `src/shared/replays/name-patterns.test.ts` › "an unmatched name yields no facts and a match names its pattern"
- AC7 → unit `src/shared/replays/name-patterns.test.ts` › "every shipped pattern compiles in the user template syntax"
  - unit `src/main/modules/replays/name-template-doc.test.ts` › "concept §17.2 documents the resolved template syntax"
- AC8 → unit `src/shared/replays/name-patterns.test.ts` (one test per shipped pattern, AC1–AC3 above);
  purity is enforced by `tsconfig.web.json`/`tsconfig.node.json` compiling `src/shared` without
  node/DOM (`npm run typecheck`).

## Done

Built the pure template compiler/matcher (`src/shared/replays/name-template.ts`) with a memoised
DP (capped at 2) counting ways a name splits along a compiled template — no regex, no unbounded
backtracking — plus the four shipped patterns and their resolution walk
(`src/shared/replays/name-patterns.ts`), and resolved concept §17.2 with the token vocabulary and
ordering rules, mirroring `deviation-doc.test.ts` for the doc test.

**Commit message:** `139: parse a file name into date/map/players/teams/host facts via templates`

**Changed files:**

- `src/shared/replays/name-template.ts`, `src/shared/replays/name-template.test.ts` (D1)
- `src/shared/replays/name-patterns.ts`, `src/shared/replays/name-patterns.test.ts` (D2)
- `src/main/modules/replays/name-template-doc.test.ts` (D2, mirrors `deviation-doc.test.ts`)
- `docs/concepts/demo-browser.md` (§7 table + §17.2 resolved)

**Verification (narrow gate):** `npm run build` green, `npm run typecheck` green (both tsconfig
projects — purity of `src/shared` confirmed), `npx vitest run --changed HEAD` green (3 files, 39
tests); re-run directly against the 3 new/changed test files to rule out a silent `--changed`
exclusion (also green, same 39 tests). No e2e — pure shared code, no UI surface, per this build's
instructions. AC1–AC8 each walked against their named test (see `## Acceptance Tests`): all ran
and passed, no `manual residue`.

**Review:** default-tier clean-agent review — PASS, no findings. Confirmed by hand-tracing: the
DP's `(state, i, pos)` memo key can't collude two different pending-date meanings (state is only
meaningful relative to the fixed segment index `i`); `parseDemoName`'s ambiguity stops the walk
with no fall-through (verified against the AC5 fixture, which is genuinely 2-way ambiguous, not
accidentally unique or ambiguous elsewhere); no `node:*`/`electron`/DOM import in either shared
file; all rejections are i18n key+params, no prose.

**Decisions** (implementation details not fully pinned by the plan, made here):

- Validation order in `compileNameTemplate`: empty → brace structure → unknown token → misplaced
  extension → duplicate → adjacent-text-tokens → captures-nothing → incomplete-date →
  time-without-date (first failing rule wins when several apply).
- `timeWithoutDate` fires when time tokens appear without a complete date, or `{hour}` without
  `{min}`; `{min}`/`{sec}` present alongside a full date but without `{hour}` is accepted (the
  story's wording only forbids the two named cases).
- Token names are case-sensitive (`{Map}` is `unknownToken`); a whitespace-only template is
  `capturesNothing`, not `empty`.
- Error `params`: `position` (brace errors), `token` (unknown/duplicate), `first`/`second`
  (adjacent text tokens), `extension` (misplaced extension) — for [[140]]'s locale strings to
  interpolate.
- No changelog entry: this story ships an internal engine with no wiring to any user-facing
  surface yet ([[140]]/[[144]]/[[148]] do that); nothing changed for the user.

tiers: D 2 / hard 1 · review default · cycles 1 · agents 4
