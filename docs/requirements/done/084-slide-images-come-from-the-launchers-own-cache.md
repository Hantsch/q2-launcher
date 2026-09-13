---
id: 084
title: Slide images come from the launcher's own cache
status: done # draft -> ready -> in-progress -> done
created: 2026-09-10
---

## Requirement

Two of the three slide templates carry an image, and a news front page without pictures is a
notice board. The images must still not weaken the app: the renderer never talks to a remote
origin, the production Content-Security-Policy stays exactly as it is, and a slide whose image is
missing or fails to download still renders — just without the picture.

So main fetches an entry's image, keeps it in its own cache and serves it over the privileged
`q2launcher://` scheme the launcher already uses. Once cached, the news looks the same offline as
online. The cache must not grow without a bound.

This is also the one place where a bitmap legitimately enters the UI: feed images are foreign
content, never a shipped asset. That deviation from the "no image assets" rule is recorded, not
bent quietly. See [concepts/home-screen.md](../concepts/home-screen.md) §9 and §10.

## Acceptance Criteria

- [x] **AC1** — A slide image is downloaded by main, stored in userData and rendered from a
      `q2launcher://` URL; no renderer request goes to a remote origin.
- [x] **AC2** — The production CSP is byte-for-byte unchanged by this story.
- [x] **AC3** — A slide whose image is missing, fails to download or is not an image renders
      without it, and the surrounding template stays intact rather than collapsing.
- [x] **AC4** — A cached image is shown offline, without a network attempt while offline.
- [x] **AC5** — The image cache stays inside a stated budget: when it is exceeded, the least
      recently used images are removed, and an image belonging to a currently visible slide is
      never removed.
- [x] **AC6** — `CLAUDE.md` carries a deviation row for feed images against the "no image assets
      in the UI" rule, naming this story and the reason.
- [x] **AC7** — `ui:verify` covers a slide with an image and a slide whose image failed, both from
      the fixture and without network access, at zero axe violations.

## Decisions (Sprint)

- **(User)** When a cached image's upstream source disappears, drop it — stop showing the slide
  image (falls back to text-only), rather than continuing to serve a stale copy indefinitely.
- **(User)** Cache budget: capped by item count, scoped to the current feed's slides (evicted on
  feed refresh) rather than a fixed disk-size cap.
- **(User)** Max accepted image size/dimension: ~5MB / 4000px; an image exceeding it is rejected
  and that slide's image is skipped (text-only fallback).
- URL shape is `q2launcher://app/news-image/<sha256-of-source-url>.<ext>` — same host `app` as the
  renderer document, because a second host would be a second origin and `img-src 'self'` would then
  need widening, which AC2 forbids.
- File names are content-addressed by the **source URL** (sha256 hex + extension), not by entry id:
  the same image survives a feed refresh and an entry rename without a re-download, and the name is
  "boring" by construction so the cache's delete path can refuse anything else.
- The protocol seam is an optional second root on `createRendererProtocolHandler`
  (`newsImages: { root, readFile }`) with a `/news-image/` prefix branch that accepts only a bare
  file name — reusing the renderer root would put foreign bytes inside `out/renderer`.
- Code lives in the `home` module (`src/main/modules/home/images/`), not a new module: feed images
  are home's own state, and CLAUDE.md's rule is "a feature is a module", not "a directory is".
- Only a **resolved** `imageUrl` (a `q2launcher://` URL) crosses IPC; the remote URL never does, so
  AC1's "no renderer request to a remote origin" is structurally true rather than a convention.
- "Really an image" and the 4000px check are one injectable `decodeImage` step (production:
  Electron `nativeImage.createFromBuffer`, empty result = not an image) — no new dependency, and it
  covers AC3's "is not an image" case with the same code as the dimension cap.
- Content-type is a cheap pre-filter (`image/png`, `image/jpeg`, `image/webp`); anything the decode
  step cannot read is treated as "not an image" and falls back to text-only, which AC3 allows.
- Images are fetched **only** during a successful feed fetch; a cache hit is served without any
  network call, so an offline start (cached feed → cache hits) makes no attempt at all (AC4).
- "Upstream disappeared" means a definitive `404`/`410` only — that deletes the cached copy.
  A timeout, offline or `5xx` keeps it, otherwise one flaky refresh would destroy AC4's guarantee.
- Image requests reuse 082's network budget (~5 s timeout, 1 retry); an image is less important
  than the index, so it gets no larger budget.
- Hard item cap: **24** cached images on top of the current-feed keep-set — two full hand-curated
  feeds' worth, so the bound exists even if a feed references more images than it shows.
- Eviction runs on feed refresh with the current feed's file names as the protected keep-set; the
  plan is pure (`planImageEviction`) so AC5's "never removes a visible slide's image" is provable
  without a filesystem.
- AC6 gets a doc test asserting the CLAUDE.md row exists and names this story — a documentation
  promise with no test is exactly the line that silently disappears.

## Open Questions

- ~~What is the cache budget, and what happens when a cached image's source disappears upstream —
  keep serving the copy, or drop it? (Concept open point 5.)~~ answered → Decisions (Sprint)
- ~~Is there a maximum accepted image size or dimension, and what happens to an image that exceeds
  it?~~ answered → Decisions (Sprint)

## Plan

Depends on 081 (the `home` module), 082 (feed pipeline + slide shape) and 083 (the `split`/`banner`
templates that carry an image). Nothing here changes the CSP; the whole story is main-side.

1. **Cache layout + eviction (pure).** `src/main/modules/home/images/paths.ts` — `cache/news-images`
   segments, `newsImageFileName(sourceUrl, ext)` (sha256 hex), `isSafeNewsImageFileName()`.
   `image-cache.ts` — `planImageEviction({ entries, keep, maxItems })` (pure) plus
   `enforceKeepSet()` as the only unlink path. Mirrors `src/main/modules/downloads/{paths,cache}.ts`
   one-to-one, including the "re-check the rule at the statement that deletes" discipline.
2. **Fetch + validate.** `images/fetch-image.ts`: conditional GET with 082's `net.fetch` wrapper
   (injectable `fetchImpl`), content-type pre-filter, ≤5 MB (Content-Length *and* streamed bytes),
   injectable `decodeImage` for "is an image" + ≤4000 px, `.part`→rename promotion. Returns
   `{ kind: 'cached' | 'rejected' | 'gone' | 'unavailable' }`; `gone` (404/410) deletes the copy.
   Mirrors `downloads/fetcher.ts` + `verify.ts`, minus mirrors and manifest hashes.
3. **Serve over the scheme.** `src/main/lib/renderer-source.ts`: extend
   `CreateRendererProtocolHandlerInput` with optional `newsImages: { root, readFile }`; branch on
   the `/news-image/` prefix *before* `resolveWithinRoot(root, …)`, accept a single safe file name
   only (no traversal, no nesting), 404 otherwise, same CSP header on every response.
   Wire the second root in `src/main/index.ts:161-172` (`serveRendererFromScheme`).
4. **Pipeline wiring.** `images/resolve-feed-images.ts` runs between 082's validated feed and its
   IPC delivery: cache hit → URL, no network; miss → fetch only when this cycle reached the network;
   reject/gone/unavailable → slide keeps no image. Then `enforceKeepSet()`. `src/shared/modules/home.ts`
   gains the resolved optional `imageUrl` on the slide; the remote URL is dropped in main.
5. **Renderer fallback.** `split`/`banner` (083) render their text column full-width when `imageUrl`
   is absent — the frame keeps its 320px geometry instead of collapsing.
6. **Fixture + verify.** `scripts/lib/fixture.mjs`: cached feed with two image slides, one image
   byte-present in `userdata/cache/news-images/`, one referenced but absent; two `SCREENS` entries
   in `scripts/lib/screens.mjs`. Fully seeded ⇒ no network, per the download-failure precedent.
7. **Deviation row** in `CLAUDE.md` + its doc test.

## Deliverables

- [x] **D1 — image cache layout + pure eviction.** `src/main/modules/home/images/paths.ts`,
  `image-cache.ts`, plus its test `image-cache.test.ts`. Mirror:
  `src/main/modules/downloads/paths.ts` and `cache.ts` (`planEviction`/`enforceBudget` shape).
  *Accepted when:* `planImageEviction` never returns a keep-set member, evicts unreferenced entries
  oldest-mtime-first, respects the 24-item cap, and returns `[]` for a non-finite cap;
  `enforceKeepSet()` refuses any name `isSafeNewsImageFileName()` rejects and any path that is not a
  direct child of the cache dir.
- [x] **D2 — download + validation of one image.** `src/main/modules/home/images/fetch-image.ts` +
  `fetch-image.test.ts`. Mirror: `src/main/modules/downloads/fetcher.ts` (injectable fetch,
  `.part`-then-promote) and `verify.ts` (size gate).
  *Accepted when:* >5 MB, a non-image content type, an undecodable body and >4000 px each yield
  `rejected` and write no promoted file; `404`/`410` yields `gone` and deletes an existing copy;
  timeout/`5xx`/offline yields `unavailable` and leaves the copy alone; a good PNG lands under its
  content-addressed name.
- [x] **D3 — the `q2launcher://` news-image route.** `src/main/lib/renderer-source.ts`,
  `src/main/index.ts`, `src/main/lib/renderer-source.test.ts`.
  *Accepted when:* `q2launcher://app/news-image/<name>.png` serves the cached bytes with
  `Content-Type: image/png`; a traversal, a nested path, an unsafe name and a missing file all 404;
  every response (200 and 404) carries the CSP; `PRODUCTION_CSP` is asserted byte-for-byte against
  its literal current value.
- [x] **D4 — resolve a feed's images and enforce the keep-set.**
  `src/main/modules/home/images/resolve-feed-images.ts` + test, `src/shared/modules/home.ts`,
  the home module's feed path (`src/main/modules/home/index.ts` / 082's feed service).
  *Accepted when:* a resolved slide carries only a `q2launcher://` `imageUrl` and no remote URL;
  a cache hit calls `fetchImpl` zero times; a refresh evicts every cached image the new feed does
  not reference; a rejected/gone/unavailable image leaves the slide image-less.
- [x] **D5 — templates survive a missing image.** `split` and `banner` from 083 (under
  `src/renderer/src/modules/home/`) + their component test.
  *Accepted when:* with no `imageUrl` both templates render title, tag, body and buttons at full
  width, the hero keeps its height, and no broken-image element or empty reserved box remains.
- [x] **D6 — fixture and two verify screens.** `scripts/lib/fixture.mjs`, `scripts/lib/screens.mjs`.
  Mirror: the downloads-cache seeding at `scripts/lib/fixture.mjs:545-589` and
  `scripts/lib/download-failures.mjs`.
  *Accepted when:* `npm run ui:verify` reaches `home-hero-slide-image` and
  `home-hero-slide-image-failed` from the populated fixture with no network access and zero
  serious/critical axe violations.
- [x] **D7 — the deviation row.** `CLAUDE.md` (Deviations table) + a doc test asserting it.
  *Accepted when:* the row names the "no image assets in the UI" rule, story 084 and the
  foreign-content reason, and the test fails if the row is removed.

## Model Hints

- `D3 → deliverable-hard` — it edits the privileged-scheme handler: a wrong prefix branch either
  bypasses `resolveWithinRoot`'s traversal guard for the *renderer* root or lets a request escape
  the image cache dir, and it sits next to the CSP header AC2 pins byte-for-byte.
- D1, D2, D4, D5, D6, D7 → default tier (each is a bounded single-layer piece with an existing
  file to mirror).
- `Review: → story-review-hard` — the diff touches the app's only privileged protocol handler, the
  CSP surface and the only code path that deletes files under `userData`.

## Acceptance Tests

- AC1 → unit `src/main/modules/home/images/resolve-feed-images.test.ts` › "a resolved slide carries
  a q2launcher URL and no remote origin" **and** e2e `npm run ui:verify` › screen
  `home-hero-slide-image` (image rendered from the fixture cache, offline)
- AC2 → unit `src/main/lib/renderer-source.test.ts` › "the production CSP is unchanged by the
  news-image route" (literal string equality, plus the header on 200 and 404)
- AC3 → unit `src/main/modules/home/images/fetch-image.test.ts` › "an oversized, undecodable or
  non-image body is rejected" + unit `src/renderer/src/modules/home/templates/SlideTemplates.test.tsx`
  › "split and banner render full-width without an image" + e2e `npm run ui:verify` › screen
  `home-hero-slide-image-failed`
- AC4 → unit `src/main/modules/home/images/resolve-feed-images.test.ts` › "a cached image makes no
  network attempt" (fetch impl asserted uncalled) — the `ui:verify` screens above run offline and
  are the same guarantee on the real surface
- AC5 → unit `src/main/modules/home/images/image-cache.test.ts` › "eviction respects the item cap
  and never removes a current feed's image"
- AC6 → unit `src/main/modules/home/images/deviation-doc.test.ts` › "CLAUDE.md records the feed-image
  deviation for story 084"
- AC7 → e2e `npm run ui:verify` › screens `home-hero-slide-image` and `home-hero-slide-image-failed`
  at zero serious/critical axe violations, seeded entirely from the fixture

No manual residue.

## Decisions (Build / review-fix cycle)

- **resolveSlideTemplate no longer falls back to `text` for a known template (`split`/`banner`)
  just because an image is absent.** 083's original rule ("a known template with a missing image
  is rendered by `text`") is superseded by this story's AC3, which literally lists "image is
  missing" as one of the three cases the template must survive without collapsing. D4 (which
  strips the pre-resolution `image` field from every resolved slide) made the old check dead in
  production regardless: a resolved slide never carries `image`, so the old `slide.image ? … :
  'text'` check always chose `text`, and D5's full-width fallback rendering was unreachable outside
  a hand-built fixture. Fixed in `resolveSlideTemplate.ts` (now: unknown `template` → `text`; known
  `template` → itself, always) and its test in `slides.test.tsx`. Caught by the clean-agent review,
  not by any of D1–D7's own tests — a real cross-deliverable integration gap between D4 and D5/083.
- **A declared `image` path is now validated before it is turned into a fetch URL**
  (`isSafeDeclaredImagePath()` in `resolve-feed-images.ts`): boring `/`-separated path segments, no
  `..`, no leading `/`, no scheme. `feed-fetcher.ts`'s own `isSafeNewsDocumentName()` couldn't be
  reused as-is (it forbids `/` outright, and an image legitimately lives under `img/`). An unsafe
  path is treated as "no image" and logged, mirroring the document-name precedent. No AC required
  this, but the module's own doc comments already hold `.md` document names to this discipline and
  the image path is the same class of foreign content.
- **The persisted `imageUrl` cache field is now shape-constrained** (`feed-cache.ts`'s
  `cachedSlideSchema`, `z.string().startsWith(...)`) to exactly the `q2launcher://app/news-image/`
  prefix `resolve-feed-images.ts` ever writes, closing the gap where a hand-edited or corrupted
  cache file could otherwise put an arbitrary string into a field the renderer trusts and puts
  straight into `<img src>`. A round-trip test for `imageUrl` was added to
  `feed-cache.test.ts` (previously the field had zero test coverage — deleting the schema line
  would not have failed anything).
- **`src/main/modules/downloads/layering.test.ts`** needed a one-line allowlist addition for
  `fetch-image.ts` (mentions `net.fetch` only in a doc comment, same as the pre-existing
  `feed-fetcher.ts` entry) — a regression the D2/D3 agents' own directory-scoped test runs did not
  catch because neither ran the full suite.
- **Known, accepted gap (not fixed, does not block any AC):** the "(User) drop a cached image when
  its upstream source disappears" decision is implemented (`fetch-image.ts`'s `gone` branch deletes
  the cached file on 404/410) but is only reachable from a cache *miss*'s first fetch —
  `resolve-feed-images.ts` never re-requests an image that already exists on disk, so an upstream
  withdrawal is never actually observed once an image is cached. A real fix needs conditional-GET
  revalidation on every refresh (the Plan's step 2 mentions "conditional GET" but D2 did not
  implement it), which is a larger change than any deliverable's "Accepted when" describes and is
  not covered by any of AC1–AC7's tests. Left as a follow-up rather than expanded scope mid-review.
- **Known, accepted layering note:** `src/main/lib/renderer-source.ts` (a `lib/` file) now imports
  `isSafeNewsImageFileName` from `src/main/modules/home/images/paths.ts` (a module), the first
  `lib/*` file to import a main-side feature module. Deliberate (one owner for "what may a cached
  image be called," per D3's own reasoning) and has no import cycle, but it inverts the shell/module
  direction CLAUDE.md otherwise holds to; noted for whoever next touches the protocol handler.
- Orphaned `.part` files from a crash mid-download are excluded from `planImageEviction` by design
  (same as the pre-existing `downloads` cache) and are therefore not subject to the item cap; noted,
  not fixed — same accepted shape as the precedent this story mirrors.

## Done

**Summary:** Main-side image cache (`src/main/modules/home/images/`: `paths.ts`, `image-cache.ts`,
`fetch-image.ts`, `resolve-feed-images.ts`) downloads, validates (size/dimension/decodability),
content-addresses and evicts (24-item cap, current-feed keep-set) slide images, served over a new
`/news-image/` branch of the existing `q2launcher://app` protocol handler
(`src/main/lib/renderer-source.ts`) with the production CSP byte-for-byte unchanged. `split`/
`banner` templates (`SlideSplit.tsx`/`SlideBanner.tsx`) render the image when present and fall back
to a full-width text layout when absent, keeping the hero's height. `CLAUDE.md` records the
deviation for this story. Fixture + two `ui:verify` screens (`home-hero-slide-image`,
`home-hero-slide-image-failed`) prove both cases offline at zero axe violations.

**Commit message:** `084: slide images come from the launcher's own cache`

**Verification:**
- `npm run typecheck` — clean (node + web).
- `npm test` — 183 files / 3493 tests passed.
- `npm run build` — clean.
- `npm run ui:verify` — full run, 39/39 screens (78 shot variants), 0 axe violations of any
  severity; `home-hero-slide-image` and `home-hero-slide-image-failed` both reached and rendered
  correctly, from the fixture, with no network access.
- Clean-agent review (`story-review-hard`): first pass **FAIL** (findings below), fixed directly by
  the orchestrator (not a re-delegated D), then verification re-run green as above. One review-fix
  cycle used of the 3 allowed.

**AC → test mapping, as verified:**
- AC1 → `resolve-feed-images.test.ts` › "a resolved slide carries a q2launcher URL and no remote
  origin" (PASS) + e2e `home-hero-slide-image` (reached, image rendered, offline) — PASS.
- AC2 → `renderer-source.test.ts` › "the production CSP is unchanged by the news-image route"
  (literal string equality; header asserted on 200 and 404) — PASS.
- AC3 → `fetch-image.test.ts` › oversized/undecodable/non-image rejection (PASS) + `slides.test.tsx`
  › split/banner full-width without an image (PASS, and now actually reachable in production after
  the `resolveSlideTemplate` fix — see Decisions) + e2e `home-hero-slide-image-failed` — PASS.
- AC4 → `resolve-feed-images.test.ts` › "a cached image makes no network attempt" (`fetchImpl`
  asserted uncalled) — PASS; both e2e screens run with no network access.
- AC5 → `image-cache.test.ts` › "eviction respects the item cap and never removes a current feed's
  image" (keep-set member seeded as the *oldest* entry, so it can't pass by accident) — PASS.
- AC6 → `deviation-doc.test.ts` › "CLAUDE.md records the feed-image deviation for story 084"
  (verified to fail when the row is removed) — PASS.
- AC7 → e2e screens `home-hero-slide-image` / `home-hero-slide-image-failed`, 0 serious/critical
  (in fact 0 of any severity) axe violations, seeded entirely from the fixture — PASS.

No manual residue. No open points beyond the two "known, accepted" items recorded above (neither
blocks an acceptance criterion).
