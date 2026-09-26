---
id: 124
title: how this server has answered
status: done # draft -> ready -> in-progress -> done
created: 2026-09-24
---

## Requirement

[[122]] shows who is on a server right now; [[123]] shows the rules it plays by. This story answers
the question left once you're actually thinking about joining: has this server actually been
answering?

Reachability (GB-D4): the browser measures a round-trip every time it queries a server this session
— the stage-1 sweep, a scoped refresh, a manual detail-view refresh. Concept §9 item 5 asks for that
history, not just the latest number, because a single ping cannot tell "reliable" apart from
"answered once and has gone quiet since". The same section also requires a plain statement of
whether the *last* scan round got an answer at all — GB-N6 already establishes that a non-answering
server keeps its last known state rather than being shown as empty; this story is where that "stale"
fact becomes something the user actually reads in the detail view, next to the history that explains
it.

**Not in this story:** local context (GB-D5, concept §9 item 6 — does the server's mod and current
map exist locally). Without a `mods`/`assets` module there is no honest definition of "the mod is
there", and stock maps live inside `pak0.pak`, which nothing in the launcher reads yet. It is
deferred to the mods/assets modules (see Decisions); the detail view ships without that section.

Renders inside the same detail view [[122]] and [[123]] build out ([[106]] the container, [[108]]
the parsed protocol data this reads); GB-D6's per-field degradation applies here too. Out of scope:
the actions row (Join/Spectate/Favourite/Add-to-address-book/Copy-address), covered in milestone 9.6
by [[125]]/[[126]]/[[127]] — this story states facts, it does not act on them.

## Acceptance Criteria

- [x] **AC1** — The view shows the response times this server has measured during the current
      session as a history (more than just the single latest value), not only the most recent ping.
- [x] **AC2** — The view states plainly whether the last scan round received an answer from this
      server at all.

## Open Questions

- [x] ~~**Q1 — What counts as "the mod is there" before the `mods` module exists?** (concept open
      point #14)~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Local mod/map availability before the `mods`/`assets` modules exist: **deferred** — the
  former AC3/AC4 (mod exists / map exists, yes/no) are cut from this story and move to the
  mods/assets modules (2026-09-25, planning).
- **History lives in main, on `ServerListEntry`** — a new optional `rttHistory` field filled by the
  scan service, not accumulated in the renderer from `scan.server` pushes, because the renderer
  view unmounts between visits and "this session" has to mean the launcher's process lifetime.
- **"Session" = main-process lifetime, not persisted** — the history is in-memory only (no
  `state.json` key), because concept §2 lists cross-session uptime history as a non-goal.
- **One sample per measured reply, plus one "no answer" sample per completed round the server was
  in scope for and did not answer** — so the history itself shows "answered once, then went quiet";
  an aborted sweep adds nothing (same rule `mergeStaleRound` already follows).
- **Bounded to the last 20 samples** (`RTT_HISTORY_LIMIT`), oldest dropped first, because an
  unbounded per-server array over a long session with auto-refresh is a slow memory leak.
- **"Last scan round answered" is read from the existing `status: 'online' | 'stale'`** (plus
  `lastSeenAt` for the "last answered at" time), not from a new flag, because that field is already
  the GB-N6 round-outcome and a second source of truth could disagree with the list row's marker.
- **Rendered as a text list, newest first** (no chart), because a list is accessible without extra
  work and AC1 only asks for the history to be visible; a sparkline is a later polish story.

## Plan

Builds on [[122]]'s detail view (a server's entry rendered in a detail container inside
`src/renderer/src/modules/servers/`); plan against 122 as written — if 122's component names differ
at build time, attach to whatever 122 shipped.

1. **Main/shared (D1):** add `RttSample { at: string; rttMs: number | null }` and
   `rttHistory?: RttSample[]` to `ServerListEntry` in `src/shared/modules/servers.ts`, plus
   `RTT_HISTORY_LIMIT = 20` and a pure `appendRttSample(history, sample)` helper (in
   `scan-merge.ts`). `scan-service.ts`'s `mergeSuccessfulReply` appends `{ at: now, rttMs }` on every
   successful reply; `mergeStaleRound` appends `{ at, rttMs: null }` for every in-scope,
   non-answering target that has an entry (never on `aborted`). Unit tests.
2. **Renderer (D2):** `ServerReachabilitySection.tsx` takes the `ServerListEntry` and renders
   (a) the last-round statement — `online`: "Answered the last scan"; `stale`: "Did not answer the
   last scan — showing what it last reported" + "last answered {{time}}" from `lastSeenAt`;
   (b) the history newest-first, each sample "{{ms}} ms" or "No answer" with its time; no samples →
   stated empty line. GB-D6: a malformed sample (non-finite `rttMs`, unparsable `at`) degrades to
   "unknown" for that line only; missing `rttHistory` → the empty line. Mounted as the
   reachability section of 122's detail view. i18n keys under `module.servers.detail.reachability.*`.
3. **E2e (in D2):** flow `servers-detail-reachability` with a loopback UDP responder: two refreshes
   answered → ≥2 ms samples; navigate away and back (history survives); stop responder, refresh →
   stale statement + a "No answer" sample on top.

Order: D1 → D2. No IPC channel change (the field rides the existing `scan.read` snapshot).

## Deliverables

- **D1 — per-server RTT history in the scan service (shared + main).**
  Files: `src/shared/modules/servers.ts` (add `export interface RttSample { at: string; rttMs:
  number | null }` — `null` = no answer that round; `rttHistory?: RttSample[]` on
  `ServerListEntry` with a doc comment; `export const RTT_HISTORY_LIMIT = 20`),
  `src/main/modules/servers/scan-merge.ts` (new pure `appendRttSample(history: RttSample[] |
  undefined, sample: RttSample): RttSample[]` — returns a new array, keeps the last
  `RTT_HISTORY_LIMIT`; `mergeStaleRound` gets a `now: string` parameter and appends
  `{ at: now, rttMs: null }` to each target it flips stale — unchanged early return when `aborted`,
  targets without an entry still get no row), `src/main/modules/servers/scan-service.ts`
  (`mergeSuccessfulReply` sets `rttHistory: appendRttSample(existing?.rttHistory, { at: now, rttMs:
  result.rttMs })`; pass `new Date().toISOString()` to `mergeStaleRound`). `rttMs` (latest) stays as
  it is. History is in-memory only — do not persist it.
  Tests: `src/main/modules/servers/scan-merge.test.ts` › "appendRttSample keeps only the newest
  RTT_HISTORY_LIMIT samples", › "a stale-flipped server gets a no-answer sample", › "an aborted
  round adds no sample"; `src/main/modules/servers/scan-service.test.ts` › "every successful reply
  appends one RTT sample across rounds" (two rounds answered → 2+ samples with the measured values,
  oldest first; a third round timed out → last sample `rttMs: null`, `status: 'stale'`).
- **D2 — reachability section in the detail view (renderer) + its e2e flow.**
  Files: new `src/renderer/src/modules/servers/ServerReachabilitySection.tsx` (props `{ entry:
  ServerListEntry }`; mirror the section structure/tokens of the detail sections story 122 added in
  the same folder), the detail-view component 122 added (mount the section; locate it via 122's
  players panel), `src/renderer/src/i18n/locales/en.json` (`module.servers.detail.reachability.*`:
  `title`, `lastRound.answered` "Answered the last scan", `lastRound.noAnswer` "Did not answer the
  last scan — showing what it last reported", `lastAnswered` "Last answered {{time}}", `sample.ms`
  "{{ms}} ms", `sample.noAnswer` "No answer", `sample.unknown` "Unknown", `empty` "No response time
  measured yet this session"), new test `src/renderer/src/modules/servers/
  ServerReachabilitySection.test.tsx`, new flow `scripts/flows/servers-detail-reachability.mjs`
  (mirror `scripts/flows/servers-scoped-refresh.mjs`: its loopback `dgram` responder helpers,
  `SERVERS_DISABLED_SOURCES` fixture seeding with one manual loopback server, never a real host).
  Behaviour: statement from `entry.status` (`online` → answered; `stale` → no-answer + last
  answered from `lastSeenAt`); history newest-first, one line per sample; the statement and each
  line are text (no colour-only status — `/design-tokens`); a sample with non-finite `rttMs` (and
  not `null`) or unparsable `at` renders "Unknown" for that line only; absent/empty `rttHistory` →
  `empty` line. Stable `data-testid`s: `server-reachability`, `server-reachability-last-round`,
  `server-reachability-sample`.
  Tests: unit › "online entry states it answered the last scan", › "stale entry states it did not
  answer and shows the last-answered time", › "renders samples newest first, null as No answer",
  › "a malformed sample degrades alone", › "no history shows the empty line"; e2e flow
  "servers-detail-reachability" (see Acceptance Tests).

## Model Hints

(no `deliverable-hard` — D1 is a bounded append in two existing merge points, D2 a presentational
section)

Review: → default — the tempting wrong implementation (history accumulated in renderer state from
`scan.server` pushes) is caught by the flow's navigate-away-and-back step and D1's service test.

## Acceptance Tests

- AC1 → e2e `scripts/flows/servers-detail-reachability.mjs` › flow "servers-detail-reachability"
  (loopback server answers two refreshes → its detail view's `server-reachability-sample` lines
  show ≥2 ms values; after navigating to another module and back the same samples are still
  listed) + unit `src/main/modules/servers/scan-service.test.ts` › "every successful reply appends
  one RTT sample across rounds" + unit `src/renderer/src/modules/servers/
  ServerReachabilitySection.test.tsx` › "renders samples newest first, null as No answer".
- AC2 → e2e `scripts/flows/servers-detail-reachability.mjs` › flow "servers-detail-reachability"
  (while answering, `server-reachability-last-round` reads "Answered the last scan"; responder
  stopped + refresh → it reads "Did not answer the last scan…" with a "Last answered" time, and the
  newest sample is "No answer") + unit `src/main/modules/servers/scan-merge.test.ts` › "a
  stale-flipped server gets a no-answer sample" + unit `ServerReachabilitySection.test.tsx` ›
  "stale entry states it did not answer and shows the last-answered time".
- GB-D6 floor (from [[122]]) → unit `ServerReachabilitySection.test.tsx` › "a malformed sample
  degrades alone", › "no history shows the empty line".

## Done

Added `RttSample`/`rttHistory`/`RTT_HISTORY_LIMIT` to `ServerListEntry` (shared), a pure
`appendRttSample` helper and `mergeStaleRound`/`mergeSuccessfulReply` wiring in
`scan-merge.ts`/`scan-service.ts` (main), and a new `ServerReachabilitySection.tsx` mounted as the
detail view's fourth section, rendering the last-round statement (`entry.status`/`lastSeenAt`) and
the newest-first sample history with per-line GB-D6 degradation. New e2e flow
`servers-detail-reachability.mjs` covers both ACs including the history-survives-remount
regression the plan called out.

Commit message: `124: how this server has answered`

Verification: narrow gate only. `npm run build` green, `npm run typecheck` green,
`npx vitest run --changed HEAD` green (98 files, 1575 tests), `npm run ui:flow --
servers-detail-reachability` green. AC1/AC2/GB-D6 each confirmed against their named unit/e2e
tests per `## Acceptance Tests` — all present and passing; clean-agent review independently
re-walked both ACs PASS with file:line evidence. One confirmed finding (a malformed-`at`,
valid-`rttMs` sample rendered its ms text instead of degrading to "Unknown", per GB-D6/D2's own
degradation spec) was fixed and covered by a new test case, then the narrow gate re-ran green.
No manual residue.

Decisions: the "ui:verify registry entry" mentioned in this story's build brief is read as the
`scripts/flows/servers-detail-reachability.mjs` flow file itself (looked up by name via
`npm run ui:flow -- <name>`) — 122/123 likewise added only flow files, not `scripts/lib/screens.mjs`
entries, for the detail view; no `screens.mjs` entry was added for consistency with that
precedent. i18n keys landed under the existing `servers.detail.*` namespace (matching
`ServerRulesPanel`/`ServerDetailHeader`), not the `module.servers.detail.*` shape suggested in
the plan text.

tiers: D 2 / hard 0 · review default · cycles 1 · agents 6

Full regression gate (`npm test`, `npm run ui:verify`, `npm run ui:flows`) has not run — run it
before merging, or use `/build 124 --full`.
