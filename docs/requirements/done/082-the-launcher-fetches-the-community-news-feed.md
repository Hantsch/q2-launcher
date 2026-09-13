---
id: 082
title: The launcher fetches the community news feed
status: done # draft -> ready -> in-progress -> done
created: 2026-09-10
---

## Requirement

The launcher must be able to tell me what is going on in Quake II. The maintainer publishes news
in the public `Hantsch/q2_community_content` repository; the launcher fetches that feed, decides
what is currently visible and in which order, and hands the result to the home screen. It does
that quietly: news is not important enough to interrupt me, so a failed fetch shows me the last
feed I had, with its age, and never a dialog or a toast.

This story is the pipeline, not the picture — it ends at a validated, filtered, ordered feed
available over IPC, plus its cache. The hero that renders it is story 083.

Foreign content from the network reaches the launcher here for the first time. It is data, never
instruction: nothing in a feed is executed, and nothing unvalidated reaches the renderer. See
[concepts/home-screen.md](../concepts/home-screen.md) §2 (non-goals), §6 and §10.

## Acceptance Criteria

- [x] **AC1** — Main fetches `news/index.json` and the `.md` files it references from
      `raw.githubusercontent` on `main`, at app start and on an explicit refresh — no other
      trigger, no interval, no focus refresh.
- [x] **AC2** — Every fetched document is validated in main before it is used or cached; an
      invalid entry (missing file, unparseable frontmatter, duplicate id, no title or body) is
      dropped with a log line and the remaining feed still arrives.
- [x] **AC3** — An entry outside its `visibleFrom`/`visibleUntil` window is filtered out in main
      and never reaches the renderer.
- [x] **AC4** — The feed's order is the entries' `order` value ascending; file name and date do
      not influence it.
- [x] **AC5** — An entry's frontmatter selects one of the templates `split`, `banner`, `text` and
      is validated against that template's field set; an unknown template value is delivered as a
      `text` slide when title and body exist.
- [x] **AC6** — At most 3 buttons per entry reach the renderer; further buttons are dropped with a
      log line, and a button URL outside the host allowlist is dropped.
- [x] **AC7** — The last successful feed is cached in userData and delivered when a refresh fails;
      the delivered feed states when it was retrieved.
- [x] **AC8** — A failed fetch produces no dialog, no toast and no error state in the shell; it is
      visible only as the feed's age plus a refresh affordance.
- [x] **AC9** — Every new channel exists in the shared contract with a zod payload schema before
      its handler, and the renderer receives a push when a refresh changed the feed.
- [x] **AC10** — The feed pipeline (validate, filter, sort, template fallback, drop invalid) is a
      pure, unit-tested module, and the whole test suite plus `ui:verify` run with no network
      access.

## Decisions (Sprint)

- **(User)** `schemaVersion` mismatch: an older launcher ignores unknown parts of a newer feed and
  shows a subtle note; it does not drop the feed.
- **(User)** Request uses ETag/`If-None-Match` conditional GET, ~5s timeout, 1 retry.
- **(User)** English-only feed prose is silent in v1 — no disclosure, consistent with the app
  itself shipping only `en` today.
- **(User)** Button/host allowlist: fixed constant containing only the community content repo's
  host, not user-configurable.
- Allowlist content: the constant holds exactly `github.com` and `raw.githubusercontent.com` (the
  repo's web host and its raw host), https only, exact host match, no subdomain or path wildcards —
  "the community content repo's host" has two spellings, and the concept's own button example
  (`github.com/.../releases`) is on the first of them.
- No new top-level IPC channel: the feed rides the shell's existing `module:invoke` /
  `module:event` seam as `home` handlers `news.get` / `news.refresh` plus the `news.changed` event,
  each with its zod schema at `handle()` — that is how `library`, `config` and `downloads` already
  satisfy AC9, and `src/shared/ipc.ts` needs no edit.
- Feed cache lives in its own userData file (`news-feed.json`, via `JsonStore`), not in
  `state.json` — concept §10 says so, and it keeps `state.ts` and its schema untouched.
- The cache stores validated-but-**unfiltered** slides; the visibility filter and the `order` sort
  run on every delivery, so a cache read back three days later ages correctly instead of showing an
  expired entry.
- Conditional GET is per document (index and each `.md`), with the ETag map in the cache file; a
  refresh where every document answers `304` reuses the cached slides, refreshes `retrievedAt` and
  emits nothing — raw.githubusercontent ETags are per-file, so an index-only ETag would miss a
  `.md` edit.
- The 1 retry applies to timeouts, network errors and 5xx only; a 4xx is a content mistake that a
  second identical request cannot fix.
- Under the ui-harness gate with no loopback base named, the start fetch is **skipped entirely**
  instead of falling back to the production URL (downloads' behaviour) — the news fetch runs at
  every app start, so a fallback would put real network traffic into every `ui:verify` run and
  break AC10.
- `HARNESS_CONTENT_REPO_BASE_ENV` and the `127.0.0.1`-only base parser move from
  `src/main/modules/downloads/harness.ts` into `src/main/lib/ui-harness.ts` so `home` can reuse
  them without a module-to-module import; the downloads gate keeps its four-case test unchanged.
- Frontmatter is parsed by a hand-written, restricted subset reader (scalars plus one `buttons`
  list of `label`/`url`), not a YAML dependency — the repo has no YAML parser, and a full YAML
  surface on foreign network data is more attack surface than the contract needs.
- `schemaVersion` ahead of what the launcher knows is delivered as a boolean flag on the feed
  (`schemaAhead`); 082 sets it, 083 renders the subtle note the user decided on.
- 082 carries an entry's `image` through as the declared relative path only — downloading, caching
  and `q2launcher://` serving is story 084's scope, and a slide renders without an image anyway.
- Equal `order` values keep `index.json`'s array order (stable sort), so a duplicate `order` is a
  cosmetic mistake and not a nondeterministic feed.
- The realistic feed fixture (index + one entry per template) lands in `docs/fixtures/news/`,
  next to the existing `docs/fixtures/*.cfg` real-content fixtures that tests already read; story
  085 keeps the content repo's copy in sync with it.
- AC8 is the story's only user-visible criterion and is proven by a new `ui:flow` script against a
  loopback fixture server, since the surface that _renders_ the feed arrives in 083.

## Open Questions

- ~~How does an older launcher react to a `schemaVersion` higher than it knows — ignore the
  unknown parts with a note, or drop the feed? (Concept open point 7.)~~ answered → Decisions
  (Sprint)
- ~~Does the request use ETag/`If-None-Match`, and what are its timeout and retry budget?
  (Concept open point 8.)~~ answered → Decisions (Sprint)
- ~~Feed prose is English only in v1. Is that stated anywhere the user can see, or silent?
  (Concept open point 9.)~~ answered → Decisions (Sprint)
- ~~Which hosts does the button allowlist contain, and is it a constant or configurable?
  (Concept open point 6 — shared with 083.)~~ answered → Decisions (Sprint)

## Plan

Depends on story 081: the `home` module (manifest entry, `src/main/modules/home/`,
`src/renderer/src/modules/home/`) must already exist. 082 adds a `news/` half inside it and does
not touch the shell.

Shape: **pure pipeline in the middle, effects at the edges.**

```
raw.githubusercontent  ──fetch (5s, 1 retry, If-None-Match)──►  feed-fetcher.ts
                                                                     │ documents
                                        feed-pipeline.ts (PURE) ◄────┘
                                        validate · drop invalid · per-template fields
                                        text fallback · ≤3 buttons · host allowlist
                                                │ slides + warnings
                          feed-cache.ts (JsonStore, userData/news-feed.json + etags)
                                                │
                          news-service.ts  filter(now) · sort(order) · stale/retrievedAt
                                                │ module:invoke / module:event
                                        renderer typed client (no UI yet)
```

Order of work: contract → pure parsers → harness gate → effects → wiring → real-surface flow.

1. `src/shared/modules/home.ts` — `HOME_HANDLERS`, `HOME_EVENTS`, `NewsFeed`/`NewsSlide`/
   `NewsTemplate`, the content zod schemas and `NEWS_BUTTON_HOST_ALLOWLIST`. Mirror
   `src/shared/modules/downloads.ts` + its `.test.ts`.
2. `frontmatter.ts` — restricted subset reader (`---` block, scalars, one `buttons` list).
3. `feed-pipeline.ts` — the whole AC2–AC6 logic, pure, `(documents, now) => { slides, warnings }`.
4. Lift `HARNESS_CONTENT_REPO_BASE_ENV` + loopback base parser into `src/main/lib/ui-harness.ts`;
   add `news/harness.ts` `resolveNewsSource()` (production | loopback | **skip**).
5. `feed-fetcher.ts` (conditional GET on `fetch`, per-document ETag) + `feed-cache.ts` (`JsonStore`,
   defensive parse, corrupt cache degrades to "no cache").
6. `news-service.ts` + `src/main/modules/home/index.ts` — handlers, `news.changed` emit, one
   fire-and-forget fetch at module registration; `network` capability onto the `home` manifest.
7. `moduleClient.ts` gains `onModuleEvent`; `renderer/src/modules/home/client.ts` typed client.
8. `scripts/flows/news-feed.mjs` + news files served by the existing `127.0.0.1` fixture server;
   `docs/fixtures/news/*`; a section in `docs/UI-VERIFICATION.md`.

Not in this story: rendering (083), image download/cache (084), the content repo's own files (085),
dashboard/layout channels (086).

## Deliverables

- [x] **D1 — The contract, before any handler.** `src/shared/modules/home.ts` (news handler names, the
  `news.changed` event name, `NewsFeed`/`NewsSlide`/`NewsTemplate`/`NewsButton`, per-template
  content zod schemas, `NEWS_BUTTON_HOST_ALLOWLIST`, `NEWS_SCHEMA_VERSION`) plus
  `src/shared/modules/home.test.ts`. Mirror: `src/shared/modules/downloads.ts` +
  `downloads.test.ts`. _Accepted when:_ the file imports nothing from node/DOM/electron, every
  handler name has an exported schema, and the contract test proves it.
- [x] **D2 — Frontmatter, read defensively.** `src/main/modules/home/news/frontmatter.ts` +
  `frontmatter.test.ts`. Pure `parseFrontmatter(text) => { data, body } | undefined`; supports a
  leading `---` block, `key: value` scalars and a `buttons:` list of `label`/`url`; anything else in
  the block is ignored, malformed input answers `undefined` instead of throwing. _Accepted when:_ no
  YAML dependency is added and the tests cover missing block, unterminated block, CRLF, quoted
  values, empty body.
- [x] **D3 — The pure feed pipeline.** `src/main/modules/home/news/feed-pipeline.ts` +
  `feed-pipeline.test.ts`. `buildFeed({ index, documents, now })` → `{ slides, warnings,
schemaAhead }`: validate the index, drop invalid/duplicate/file-less entries into `warnings`,
  validate per template, fall back to `text` on unknown template or missing image when title+body
  exist, drop otherwise, cap buttons at 3, drop off-allowlist URLs, filter the visibility window,
  sort by `order` (stable). No fs, no fetch, no logger. _Accepted when:_ AC2–AC6 each have a test
  and every drop produces a warning entry the caller can log.
- [x] **D4 — One place may name a loopback origin.** Move `HARNESS_CONTENT_REPO_BASE_ENV` and the
  `127.0.0.1`-only base parser from `src/main/modules/downloads/harness.ts` to
  `src/main/lib/ui-harness.ts` (re-imported by the former, its public API unchanged); add
  `src/main/modules/home/news/harness.ts` `resolveNewsSource()` returning production, a loopback
  base, or `skip`. Tests: `src/main/lib/ui-harness.test.ts`, `news/harness.test.ts` (four-case
  gate). Mirror: `src/main/modules/downloads/harness.test.ts`. _Accepted when:_ `downloads`'
  existing gate tests still pass untouched and the news gate skips rather than falling back.
- [x] **D5 — Fetch and cache.** `src/main/modules/home/news/feed-fetcher.ts` (index + `.md` fetch, 5s
  `AbortSignal.timeout`, 1 retry on timeout/network/5xx, `If-None-Match` per document, `304` →
  reuse) and `feed-cache.ts` (`JsonStore` on `userData/news-feed.json`: slides, per-document ETag
  map, `retrievedAt`; corrupt or unparseable file degrades to "no cache"). Tests
  `feed-fetcher.test.ts` and `feed-cache.test.ts` against a real `node:http` server on `127.0.0.1`
  — mirror `src/main/modules/downloads/fetcher.test.ts`. _Accepted when:_ no test mocks global
  `fetch`, and 304/timeout/retry/5xx/4xx each have a case.
- [x] **D6 — The module answers.** `src/main/modules/home/news/news-service.ts` +
  `news-service.test.ts`, wired in `src/main/modules/home/index.ts`; `network` added to the `home`
  manifest in `src/shared/types/module.ts`. Handlers `news.get` / `news.refresh` (`z.void()`),
  `news.changed` emitted only when the delivered feed differs, one fire-and-forget fetch at
  registration that never delays startup, warnings logged through `log.warn`. Mirror:
  `src/main/modules/library/index.ts`. _Accepted when:_ AC1's "no other trigger" is a test (no
  interval, no focus hook) and a failed refresh still resolves with the cached feed.
- [x] **D7 — The renderer can listen.** `onModuleEvent(moduleId, type, listener)` in
  `src/renderer/src/modules/moduleClient.ts` (+ `moduleClient.test.ts`) and a typed
  `src/renderer/src/modules/home/client.ts` (`getNews`, `refreshNews`, `onNewsChanged`). No
  component, no store, no string — 083 consumes this. Mirror:
  `src/renderer/src/modules/library/client.ts`.
- [x] **D8 — Proven offline, on the real app.** `scripts/flows/news-feed.mjs`: phase 1 serves
  `docs/fixtures/news/*` from the existing loopback fixture server (`scripts/lib/fixture.mjs`) and
  asserts the app fetched, cached and delivers the fixture's slides in `order`; phase 2 restarts
  with the server answering 500 and asserts the cached feed with its `retrievedAt` plus **no toast
  and no dialog** in the DOM. Adds `docs/fixtures/news/index.json` and one entry per template, and
  a section in `docs/UI-VERIFICATION.md`. Mirror: `scripts/flows/bootstrap-wizard.mjs`. _Accepted
  when:_ `npm run ui:verify` (unchanged screen registry) and the flow both run with no outbound
  request.

## Model Hints

- `D3 → deliverable-hard` — five acceptance criteria live in this one pure module and its
  fallback/drop rules interact (unknown template _and_ missing image _and_ missing title all fold
  into one decision), so a shallow pass produces a pipeline that silently drops valid entries.
- `D5 → deliverable-hard` — conditional GET with a per-document ETag map, `304`-reuse out of the
  cache, retry budget and cache-corruption degradation is the subtle cross-file behaviour of this
  story, and getting the 304 path wrong shows up as a permanently frozen feed, not as a failure.
- All other Ds → default tier.
- `Review: → story-review-hard` — this is the first foreign network data reaching the launcher and
  D4 moves an existing security gate; a reviewer has to check both the "data, never instruction"
  promise and that the downloads override did not widen.

## Acceptance Tests

- AC1 → unit `src/main/modules/home/news/news-service.test.ts` › fake-timer fetch-count test
  (fetch count stays 1 after 30 virtual days with no explicit refresh, `getNews()` never
  increments it, one explicit `refreshNews()` brings it to 2) plus flow
  `scripts/flows/news-feed.mjs` › "assert the index was requested exactly once (AC1: only the
  startup fetch, no polling refetch)"
- AC2 → unit `src/main/modules/home/news/feed-pipeline.test.ts` › "an invalid entry is dropped with
  a warning and the rest of the feed survives"
- AC3 → unit `src/main/modules/home/news/feed-pipeline.test.ts` › "an entry outside its visibility
  window never reaches the feed" plus `resolveFeed`/`buildFeed` split tests (not-yet-visible and
  expired entries present in `resolveFeed()`, absent from `buildFeed()`) plus
  `news-service.test.ts` › cached-then-expired and cached-with-future-`visibleFrom`-becomes-visible
  regression tests (delivery-time re-filtering against a cache that stores unfiltered slides)
- AC4 → unit `src/main/modules/home/news/feed-pipeline.test.ts` › "order decides the sequence,
  filename and date do not" plus flow `scripts/flows/news-feed.mjs` phase 1's delivered-order
  assertion (fixture filenames/index order deliberately scrambled vs `order`)
- AC5 → unit `src/main/modules/home/news/feed-pipeline.test.ts` › "each template is validated
  against its own fields, and an unknown template is delivered as text"
- AC6 → unit `src/main/modules/home/news/feed-pipeline.test.ts` › "a fourth button and an
  off-allowlist URL are dropped with a warning"
- AC7 → unit `src/main/modules/home/news/news-service.test.ts` › "a failed refresh delivers the
  cached feed with its retrievedAt" plus flow `scripts/flows/news-feed.mjs` phase 2 (cached feed +
  its original `retrievedAt` survive a 500)
- AC8 → flow `scripts/flows/news-feed.mjs` phase 2's no-toast/no-dialog DOM assertion
- AC9 → unit `src/shared/modules/home.test.ts` › "every news handler has a payload schema" plus
  `src/shared/ipc-schemas.test.ts` › moduleId-enum/`MODULE_MANIFESTS` coupling test plus
  `src/main/modules/home/news/news-service.test.ts` › "a changed feed emits news.changed, an
  identical one does not" plus `src/renderer/src/modules/moduleClient.test.ts` › "a module event
  reaches its subscriber"
- AC10 → unit `src/main/modules/home/news/harness.test.ts` (four-case gate, incl. "gate open,
  non-loopback host → skip") plus `src/main/modules/home/news/feed-pipeline.test.ts` › "the
  pipeline touches neither fs nor network"; `npm run ui:verify`'s screen registry is unchanged and
  the flow's evidence log names only `127.0.0.1`

Coverage: AC1→D6+D8, AC2–AC6→D3 (on D1's schemas and D2's parser), AC7→D5+D6+D8, AC8→D8,
AC9→D1+D6+D7, AC10→D4+D3+D8. No manual residue.

Post-review fix: a first clean-agent review (story-review-hard) found the cache was persisting
already visibility-filtered slides, contradicting the Decisions section ("cache stores
validated-but-unfiltered slides"); `feed-pipeline.ts` was split into `resolveFeed()` (validate/
resolve, unfiltered) and `buildFeed()` (`resolveFeed()` + `filterAndSortSlides()`), and
`news-service.ts`'s cache-write path now calls `resolveFeed()`. A second review pass confirmed the
fix and the regression tests added for it. Four low-severity residuals were accepted as-is (see
Done → Decisions).

## Done

Built the whole news pipeline inside the existing `home` module: a shared contract (handler names,
event, per-template zod schemas, button allowlist), a hand-written frontmatter reader, a pure
validate/filter/sort pipeline, a lifted harness gate shared with `downloads`, a conditional-GET
fetcher + `JsonStore` cache, the `news-service` wiring (`news.get`/`news.refresh`/`news.changed`),
a renderer-side typed client with a new `onModuleEvent` primitive on `moduleClient`, and a
dedicated offline e2e flow (`scripts/flows/news-feed.mjs`) with a three-template fixture feed. No
UI renders it yet — that is story 083.

**Commit message:**
```
082: the launcher fetches the community news feed
```

### Verification

- `npm run build` — green.
- `npm run typecheck` — green (node + web).
- `npm test` — 3385/3386 passed; the one failure
  (`src/main/modules/config/core/import-reader.test.ts` › "refuses further exec once 512 files have
  been opened…") is a pre-existing timing flake under parallel load, unrelated to this story —
  confirmed green standalone, twice, before and after this story's changes.
- `npm run ui:verify` — 34/34 screens, 0 axe violations, screen registry unchanged (this story adds
  no screen).
- `node scripts/flow.mjs news-feed` — both phases green (fetch/cache/deliver in order; cached feed
  + original `retrievedAt` survive a 500; no toast/dialog in the DOM).
- Clean-agent review (`story-review-hard`, two rounds): round 1 found one blocking issue (cache
  persisted already-filtered slides) plus six smaller findings; a fix-it round addressed all of
  them; round 2 verdict **PASS**, four low-severity residuals accepted (below).

### AC → test mapping, as verified

- AC1 → `news-service.test.ts` fetch-count test (1 stays 1 over 30 virtual days, `getNews()` never
  increments it, `refreshNews()` → 2) + flow's exactly-once `/news/index.json` count — PASS
- AC2 → `feed-pipeline.test.ts` › "an invalid entry is dropped with a warning and the rest of the
  feed survives" — PASS
- AC3 → `feed-pipeline.test.ts` visibility-window test + `resolveFeed`/`buildFeed` split tests +
  `news-service.test.ts` expired-then-cached and future-`visibleFrom`-becomes-visible regression
  tests — PASS
- AC4 → `feed-pipeline.test.ts` order test + flow's scrambled-fixture delivery assertion — PASS
- AC5 → `feed-pipeline.test.ts` template-validation/fallback test — PASS
- AC6 → `feed-pipeline.test.ts` button-cap/allowlist test (filter-then-cap, verified correct order)
  — PASS
- AC7 → `news-service.test.ts` failed-refresh-keeps-cache test + flow phase 2 — PASS
- AC8 → flow phase 2's no-toast/no-dialog DOM assertion — PASS
- AC9 → `home.test.ts` handler-schema test + `ipc-schemas.test.ts` moduleId coupling test +
  `news-service.test.ts` changed-vs-identical emit test + `moduleClient.test.ts` subscriber test —
  PASS
- AC10 → `harness.test.ts` four-case gate + `feed-pipeline.test.ts` no-fs/no-network test +
  `ui:verify`'s unchanged registry + the flow's 127.0.0.1-only evidence — PASS

No manual residue.

### Decisions

- Split `feed-pipeline.ts`'s `buildFeed()` into `resolveFeed({index, documents})` (validate/resolve,
  no `now`, unfiltered) and `buildFeed({index, documents, now})` (`resolveFeed()` +
  `filterAndSortSlides()`) so the cache can genuinely hold "validated-but-unfiltered" slides per the
  story's Decisions section, while `buildFeed()`'s existing external behavior for D3's own tests
  stays unchanged. `news-service.ts`'s cache-write path uses `resolveFeed()`; every delivery path
  (`getNews()`, all `refreshNews()` branches) re-applies `filterAndSortSlides()` against a fresh
  `now()`.
- Per-template content schemas (`split`/`banner`/`text`) are structurally similar (title+body
  required, image optional) rather than deliberately divergent, kept as separate exports so they can
  diverge later without a breaking rename.
- `NEWS_HANDLER_SCHEMAS` introduced as a small shared registry (no prior module had this exact
  shape) so AC9's "every handler has a schema" has something concrete to assert against.
- Buttons: filter-then-cap — off-allowlist/malformed buttons are dropped first, then the survivors
  are capped at 3, so a disallowed button never consumes one of the 3 slots a valid button could
  have used.
- A malformed `visibleFrom`/`visibleUntil` is treated as "no bound on that side" (entry stays
  visible) plus a warning, rather than dropping the entry — consistent with the pipeline's general
  "drop only what's actually broken" philosophy.
- Fixed, while implementing D8, a real IPC-reachability bug found end-to-end: `src/shared/
  ipc-schemas.ts`'s `moduleInvokeSchema` enum was missing `'home'`, making every `home` handler
  unreachable through the real bridge despite being correctly registered server-side. Added a
  coupling test (`ipc-schemas.test.ts`) asserting the enum matches `MODULE_MANIFESTS`'s ids exactly,
  so this class of gap fails a test immediately for any future module.
- Accepted as-is, flagged by review, non-blocking:
  - `image` (declared relative path) carries through with only a non-empty-string check; no
    path-traversal/URL-shape guard — deliberately deferred to story 084's image handling scope.
  - `schemaAhead` is not persisted in the cache; if every document 304s across a restart, a
    schema-ahead feed is delivered with `schemaAhead: false` until content actually changes. Known,
    documented inline; the "subtle note" story 083 renders would lapse in that narrow window.
  - `news-service.test.ts`'s "sorts by order ascending on every delivery" test is weakly
    discriminating for its exact fixture (index order already equals sort order there); the real
    coverage for delivery-time sorting sits in `feed-pipeline.test.ts` and the e2e flow.
  - A couple of comments in `feed-fetcher.ts` still say the caller re-runs "buildFeed" on fetched
    material; the actual caller (`news-service.ts`) calls `resolveFeed()`. Cosmetic, not corrected in
    this pass.
