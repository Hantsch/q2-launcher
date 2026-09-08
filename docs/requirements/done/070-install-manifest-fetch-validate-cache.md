---
id: 070
title: The launcher reads a curated manifest instead of hardcoded download URLs
status: done
created: 2026-09-08
---

## Requirement

Every engine build and free game-data package the launcher will ever offer to download comes
from one curated manifest in the public `Hantsch/q2_community_content` repository — the same
`raw.githubusercontent` transport the home screen already uses for `news/` (see
[concepts/home-screen.md](../concepts/home-screen.md)). No download URL is hardcoded in the
launcher: a dead mirror or a new engine version costs one commit to the content repo, never a
launcher release. This story delivers the manifest itself (real Q2PRO nightly + free
game-data entries, per [concepts/install-module.md §6-7](../concepts/install-module.md)) and the
main-process pipeline that fetches, validates, and caches it, so later stories (download,
wizard) have real data to work against.

## Acceptance Criteria

- [x] **AC1** — The manifest is fetched by main over `raw.githubusercontent` on `main` of
      `Hantsch/q2_community_content`, from a new `engines/` and `gamedata/` layout next to the
      existing `news/`.
- [x] **AC2** — Every package in the manifest carries `schemaVersion`, id, version, engine kind
      or role, primary URL, an ordered list of mirrors, size in bytes, and SHA256; the shape is
      validated with zod in main before any of it reaches the renderer.
- [x] **AC3** — A package that fails validation is dropped with a log line; the rest of a
      structurally valid manifest stays usable.
- [x] **AC4** — The last successfully validated manifest is cached in `userData`; when the
      network fetch fails, the cached copy is used and its age is exposed to callers.
- [x] **AC5** — Per engine, the manifest names one **pinned** version, retrievable as the
      default for a new installation or an update check.
- [x] **AC6** — The real manifest content ships in the content repository: the Q2PRO `nightly`
      build (pinned per the resolution of Open Question 1) and both free game-data packages
      (`q2-314-demo-x86.exe`, `q2-3.20-x86-full-ctf.exe`), each with a real SHA256 computed
      against the currently published asset.

- ~~Q2PRO's `nightly` release is a rolling tag...~~ answered → Decisions (Sprint)
- ~~How is a `schemaVersion` higher than the launcher knows handled...~~ answered → Decisions (Sprint)
- ~~Does the content repository need a README...~~ answered → Decisions (Sprint)

## Decisions (Sprint)

- **(User)** Nightly pinning: mirror the pinned Q2PRO asset into our own release under
  `Hantsch/q2_community_content` so the pin is truly immutable; the mirrored release/manifest
  entry mentions the original upstream repository as its source.
- **(User)** Unknown `schemaVersion`: refuse the manifest outright rather than ignore-with-note —
  fail loud rather than risk misinterpreting a newer format.
- **(User)** Manifest-format README: fast-follow, not in scope for this story.

### Refine decisions (one-sentence reason each)

- **Two manifest files, one snapshot.** `engines/manifest.json` and `gamedata/manifest.json` are
  fetched separately and merged into one in-memory snapshot — AC1 asks for both directories, and a
  per-content-type file is what the concept's later sections (mods, packs) extend without a redesign.
- **Home of the code: `src/main/modules/downloads/`, module main half registered now.** The
  `downloads` `MainModule` is added to `src/main/modules/index.ts` (ARCHITECTURE step 3) while the
  manifest entry stays `status: 'planned'` and the route keeps rendering `PlannedModuleView` until
  the renderer half lands in story 073/074 — main and renderer halves are independent steps.
- **The transport constant lives in `src/main/lib/content-repo.ts`.** The raw base URL for
  `Hantsch/q2_community_content@main` is shared infrastructure, not module-private, so the future
  home-screen news feed reuses one constant instead of a second copy.
- **Exposed to callers through the module seam.** One `module:invoke` handler
  `downloads/manifest.get` returns the snapshot with `fetchedAt`, `ageMs` and `fromCache`, so AC4's
  "exposed to callers" is a real path stories 071/074 consume rather than an internal return value.
- **Manifest zod schemas are main-only** (`src/main/modules/downloads/schemas.ts`) — the manifest is
  foreign *remote* data validated in main, not a renderer-supplied payload, so it does not belong in
  `src/shared/ipc-schemas.ts`; only the handler's (empty-ish) request payload schema does.
- **`schemaVersion` is an exact match on `1`.** Anything else refuses the whole manifest, per the
  binding (User) decision, and a refused fetch is treated exactly like a failed one — the last good
  cached copy is served with its age, because a loud refusal must not also mean "no data at all".
- **Envelope refuses, packages drop.** A structurally broken envelope (missing `schemaVersion` or
  `packages`) refuses the file; inside a valid envelope each package is parsed row by row and a bad
  one is dropped with a log line — that is the split AC2/AC3 describe, mirroring the row-by-row
  installation parse in `src/main/lib/schemas.ts`.
- **Cache via `JsonStore` at `userData/cache/downloads/manifest-cache.json`.** Reusing the existing
  atomic tmp+rename+`.bak`+quarantine writer beats hand-rolled `fs` for a file we must never leave
  half-written; the envelope carries its own `cacheVersion` to stay distinct from `schemaVersion`.
- **Pinned per engine as an id reference.** `engines/manifest.json` carries `pinned: { q2pro: <id> }`;
  if the pinned id does not resolve to a surviving package, there is no pin and it is logged — a
  dropped package must not silently promote a different version to default.
- **Fetch on demand only, 15-minute in-memory freshness, no boot fetch.** Nothing fetches until a
  caller asks, which is what keeps a `ui:verify` run offline (INST-A5) and what the concept's "fetch
  on demand (wizard open, update check, repair)" says.
- **10 s per-request timeout, no retries in this story.** `AbortSignal.timeout` bounds a hanging
  mirror; the retry budget and mirror fallback are the download job's business (story 071), not the
  manifest's.
- **Pinned Q2PRO asset: `q2pro-client_win64_x64.zip`, version `r3834~601a8df8`.** Verified live on
  2026-09-08 (2 115 832 B, published 2025-12-11); the 32-bit client is not offered in v1 because
  every Windows the launcher supports runs the x64 build.
- **Primary URL = our immutable mirror, first mirror = the upstream nightly asset.** The (User)
  mirror decision makes the pin immutable, and keeping the upstream URL as the ordered fallback means
  the manifest already works before the mirrored release is published and fails loudly (hash
  mismatch) only once upstream rotates.
- **Manifest content is authored in this repo under `content/q2_community_content/`.** The files are
  byte-identical to what gets committed to the content repository, so they are reviewable, testable
  and diffable here; publishing them (git push plus a release upload of the mirrored binary) needs
  credentials and the authority to publish binaries publicly, which this run has neither of — see
  the manual residue on AC6.
- **Hashes come from `scripts/manifest-hashes.mjs`.** One script downloads every URL in the shipped
  manifests, computes size + SHA256 and `--check`s them against the files, so real hashes are
  produced reproducibly instead of by hand — and it stays out of `npm test`, which must not touch the
  network.
- **No `ui:verify` screen and no i18n-visible surface beyond one error key.** This story has no user
  action in it; the wizard, the Downloads tab and their screens arrive with stories 073/074.

## Plan

Net-new main-process pipeline; nothing existing changes behaviour. Order matters — each step
compiles on the previous one.

1. **Contract + validator (shared + main core).** `src/shared/modules/downloads.ts` gets
   `DOWNLOADS_HANDLERS` (mirror `src/shared/modules/library.ts`) plus the wire types:

   ```ts
   ManifestPackage = { id, version, sizeBytes, sha256, url, mirrors: string[],
                       contents: { from: string; to: 'root' | 'baseq2' }[] }
                     & ({ kind: 'engine'; engine: EngineKind }
                        | { kind: 'gamedata'; role: 'demo' | 'point-release' })
   ManifestSnapshot = { schemaVersion: 1; packages: ManifestPackage[];
                        pinned: Partial<Record<EngineKind, string>>;
                        fetchedAt: string; ageMs: number; fromCache: boolean }
   ```

   `src/main/modules/downloads/schemas.ts` holds the zod mirrors (`sha256Schema` = 64 lowercase hex,
   `httpsUrlSchema` in the style of `urlSchema` in `src/shared/ipc-schemas.ts`), and
   `manifest-parse.ts` the pure `parseManifestFile()` (refuse envelope / drop package / resolve pin).
2. **Transport.** `src/main/lib/content-repo.ts`: `CONTENT_REPO_RAW_BASE`, `contentRepoUrl(path)`,
   `fetchContentJson(path, { timeoutMs })` over built-in `fetch` with `AbortSignal.timeout`.
3. **Service.** `src/main/modules/downloads/manifest-service.ts`: fetch both files, merge, cache via
   `JsonStore` at `userData/cache/downloads/manifest-cache.json`, 15-min in-memory freshness,
   `getManifest({ refresh })`, `pinnedEnginePackage(kind)`, offline fallback with `ageMs`/`fromCache`.
4. **Seam.** `src/main/modules/downloads/index.ts` (`MainModule`) registered in
   `src/main/modules/index.ts`, one handler `manifest.get` returning `Outcome<ManifestSnapshot>`,
   failing with `downloads.error.manifestUnavailable` when neither network nor cache has anything;
   one i18n key in `src/renderer/src/i18n/locales/en.json`. Module manifest stays `planned`.
5. **Content.** `content/q2_community_content/engines/manifest.json` +
   `gamedata/manifest.json` with the three real packages, `scripts/manifest-hashes.mjs` to compute
   and `--check` sizes/hashes, and a test that the shipped files validate against the schema.

Untouched on purpose: `src/shared/ipc.ts` (module traffic rides `module:invoke`), the CSP, the
`ui:verify` screen registry, `state.json`.

## Deliverables

- [x] **D1 — Contract, zod schemas and the pure manifest parser.** Adds
      `src/shared/modules/downloads.ts` (types + `DOWNLOADS_HANDLERS`, mirror
      `src/shared/modules/library.ts`), `src/main/modules/downloads/schemas.ts` (mirror
      `src/main/modules/config/schemas.ts`) and `src/main/modules/downloads/manifest-parse.ts` with
      `parseManifestFile()`: exact `schemaVersion === 1` or refuse, row-by-row package parse that
      drops a bad package with a `log.warn` line, pin resolved only against surviving packages.
      Plus its test in `src/main/modules/downloads/manifest-parse.test.ts` (covers AC2, AC3, AC5).
      Accept: a fixture with one broken package yields the good ones and one warn; a
      `schemaVersion: 2` fixture yields a refusal, not a partial result.
- [x] **D2 — Content-repo transport helper.** Adds `src/main/lib/content-repo.ts`
      (`CONTENT_REPO_RAW_BASE` = `https://raw.githubusercontent.com/Hantsch/q2_community_content/main`,
      `contentRepoUrl()`, `fetchContentJson()` with a 10 s `AbortSignal.timeout`, non-2xx → thrown
      error carrying status). Plus `src/main/lib/content-repo.test.ts` with a stubbed global `fetch`
      (first such test in the repo — `vi.stubGlobal('fetch', …)`) asserting the two request URLs
      (`engines/manifest.json`, `gamedata/manifest.json`) and the timeout/non-2xx paths. Covers AC1.
- [x] **D3 — ManifestService: fetch, merge, cache, age, offline.** Adds
      `src/main/modules/downloads/manifest-service.ts` using `JsonStore`
      (`src/main/lib/json-store.ts` is the mirror for options/defensive parse) at
      `userData/cache/downloads/manifest-cache.json`, `cacheVersion` envelope with `fetchedAt`;
      `getManifest({ refresh })` with a 15-min in-memory window, `pinnedEnginePackage(kind)`,
      network failure *and* a refused manifest both falling back to the cache with `ageMs` and
      `fromCache: true`. Plus `src/main/modules/downloads/manifest-service.test.ts` (mock `electron`'s
      `app.getPath` like `src/main/services/installation-icons.test.ts`, stub `fetch`). Covers AC4,
      AC5. Accept: constructing the service issues zero fetches; a fetch failure after one good fetch
      returns the cached snapshot with a plausible `ageMs`; a cold cache plus a dead network fails.
- [x] **D4 — The downloads module main half and its `manifest.get` handler.** Adds
      `src/main/modules/downloads/index.ts` (`MainModule`, mirror `src/main/modules/config/index.ts`),
      registers it in `src/main/modules/index.ts`, adds the request payload schema to
      `schemas.ts` and the `downloads.error.manifestUnavailable` key to
      `src/renderer/src/i18n/locales/en.json`. `MODULE_MANIFESTS`' `downloads` entry keeps
      `status: 'planned'`. Plus `src/main/modules/downloads/index.test.ts` asserting the handler is
      registered under `downloads/manifest.get`, returns `ok` with a snapshot, and returns the i18n
      key (never prose) when nothing is available.
- [x] **D5 — The real manifest content plus the hash tool.** Adds
      `content/q2_community_content/engines/manifest.json` (Q2PRO `q2pro-client_win64_x64.zip`,
      version `r3834~601a8df8`, primary = the planned `Hantsch/q2_community_content` mirror release
      asset, first mirror = `github.com/q2pro/q2pro/releases/download/nightly/…`, pinned) and
      `gamedata/manifest.json` (`q2-314-demo-x86.exe`, 39 015 499 B, role `demo`;
      `q2-3.20-x86-full-ctf.exe`, 19 267 584 B, role `point-release`; yamagi primary, tastyspleen
      mirror), plus `scripts/manifest-hashes.mjs` (`--check`) and
      `src/main/modules/downloads/shipped-manifest.test.ts` reading the two shipped files through
      D1's parser. Covers AC6. Accept: `node scripts/manifest-hashes.mjs --check` exits 0 against the
      live assets and its output is pasted into `## Done`; the offline test asserts the three ids,
      the two exact byte sizes and 64-hex hashes.

## Model Hints

- D3 → `deliverable-hard` — the cache/offline path is where this story silently gets AC4 wrong: a
  refused manifest and a dead network must both land on the cached copy with a *correct* age, while a
  cold cache must fail rather than serve an empty snapshot, and the `JsonStore` quarantine path adds a
  third way to end up with "no cache" that must not be confused with "empty manifest".
- D1, D2, D4, D5 → default tier (small, single-layer, pattern-mirroring pieces).
- Review: → `story-review-hard` — this is the launcher's first code that parses foreign data off the
  network, and the refuse-the-envelope / drop-the-package distinction plus "no URL is ever hardcoded"
  are exactly the kind of thing an implementation can satisfy plausibly and wrongly.

## Acceptance Tests

No acceptance criterion in this story describes a user action — the story is main-process only and
adds no surface — so `ui:verify` gets no new screen and every criterion is proven at `test` level.
The user-facing surfaces that consume this pipeline (wizard, Downloads tab) carry their own e2e
criteria in stories 073/074.

- AC1 → unit `src/main/lib/content-repo.test.ts` › "the manifest is fetched from engines/ and
  gamedata/ on main of the content repository" (D2)
- AC2 → unit `src/main/modules/downloads/manifest-parse.test.ts` › "a package without size, sha256
  or mirrors is not a valid package" (D1)
- AC3 → unit `src/main/modules/downloads/manifest-parse.test.ts` › "one invalid package is dropped
  and the rest of the manifest stays usable" (D1)
- AC4 → unit `src/main/modules/downloads/manifest-service.test.ts` › "a failed fetch serves the
  cached manifest and reports its age" (D3)
- AC5 → unit `src/main/modules/downloads/manifest-parse.test.ts` › "the pinned version is the
  engine's default" and `manifest-service.test.ts` › "pinnedEnginePackage returns the pinned Q2PRO
  package" (D1, D3)
- AC6 → unit `src/main/modules/downloads/shipped-manifest.test.ts` › "the shipped manifests validate
  and carry the pinned Q2PRO nightly and both free game-data packages" (D5)
- AC6 → manual residue: committing the two manifest files into `Hantsch/q2_community_content` and
  uploading the mirrored Q2PRO asset as a release there — a push and a public binary release on an
  external repository needs credentials this run does not have and is a publishing decision, not
  code. The reviewed files live in `content/q2_community_content/` byte-identical to what gets
  committed, and `scripts/manifest-hashes.mjs --check` proves the hashes against the live assets.

## Done

**Summary.** Built the main-process manifest pipeline end to end: shared wire types
(`ManifestPackage`/`ManifestSnapshot`), zod schemas and a pure envelope-refuses/package-drops
parser with pin resolution (D1); a `content-repo.ts` transport helper over `raw.githubusercontent`
with a 10s timeout (D2); a `ManifestService` that merges the two manifest files, caches via
`JsonStore`, serves the cache with a real age on any fetch or refusal failure, and throws rather
than fabricate an empty snapshot on a cold cache + dead network (D3, hard tier); the `downloads`
module's main half with a `manifest.get` handler returning an i18n key (never prose) when nothing
is available, registered while the module manifest stays `status: 'planned'` (D4); and the real,
live-verified manifest content for the Q2PRO nightly mirror plus both free game-data packages,
with a standalone hash-check script (D5).

**Commit message:**
```
070: fetch, validate and cache the install manifest
```

**Verification:**
- `npm run build` — clean.
- `npm run typecheck` — clean (node + web).
- `npm test` (full suite) — 2792/2792 pass on a clean run; one unrelated flake was observed once in
  `src/main/modules/config/core/import-reader.test.ts` (a pre-existing timing-sensitive test,
  untouched by this story) under parallel load, and passed cleanly in isolation and on re-run —
  not a regression from this story.
- `e2e` (`npm run ui:verify`) — not run; this story adds no UI surface (main-process only, no new
  screen), as the `## Acceptance Tests` section states up front. The wizard/Downloads tab that
  consume this pipeline carry their own e2e criteria in stories 073/074.
- Code review: `story-review-hard` (hard tier per `## Model Hints`) — verdict **PASS** on all six
  criteria after one fix cycle (see Decisions below). No weakened/deleted tests, no scope creep;
  full findings list is in the review transcript, most-severe two were fixed, the rest are
  documented below as known, non-blocking coverage gaps.

**AC → test mapping, as verified:**
- AC1 → `src/main/lib/content-repo.test.ts` — asserts the literal fetch URLs for
  `engines/manifest.json` and `gamedata/manifest.json` against
  `https://raw.githubusercontent.com/Hantsch/q2_community_content/main`. PASS.
- AC2 → `src/main/modules/downloads/manifest-parse.test.ts` — a package missing `sha256`/
  `mirrors`/`sizeBytes` is invalid and dropped. PASS.
- AC3 → same file — one invalid package is dropped, the rest of a structurally valid manifest
  stays usable (not a refusal), with an asserted `log.warn` call. PASS.
- AC4 → `src/main/modules/downloads/manifest-service.test.ts` — a failed fetch *and* a
  fetch-succeeds-but-manifest-is-refused case both serve the cached snapshot with `fromCache: true`
  and a real, non-zero `ageMs`; a cold cache + dead network rejects rather than returning an empty
  snapshot; constructing the service issues zero fetches. PASS.
- AC5 → `manifest-parse.test.ts` (pin resolves only against surviving packages, no silent
  substitution) and `manifest-service.test.ts` (`pinnedEnginePackage('q2pro')` returns the pinned
  package, and — after the review fix — returns `undefined` rather than a wrong-kind package if the
  pinned id ever resolved to a non-matching package). PASS.
- AC6 → `src/main/modules/downloads/shipped-manifest.test.ts` — the two shipped manifest files
  parse and validate through the real parser, with the 3 real ids, exact byte sizes (39 015 499,
  19 267 584) and 64-hex sha256 shapes, and the Q2PRO pin resolving correctly. PASS.
  - **Manual residue (as planned in refine):** publishing the two manifest files to the public
    `Hantsch/q2_community_content` repository and uploading the mirrored Q2PRO asset as a GitHub
    release there. This run has no push credentials and no authority to publish a public binary
    release; the reviewed files in `content/q2_community_content/` are meant to be byte-identical
    to what gets committed there. `node scripts/manifest-hashes.mjs --check` was run against the
    real, live-published assets during D5 and exited 0:
    ```
    q2pro-nightly-win64          size=2115832    sha256=47e18f72f116512f97b42f4ba47c285ba5b60fe6839e380be23bab5eb8288f4b  (upstream nightly, mirror not yet published)
    q2-314-demo-x86               size=39015499   sha256=7ace5a43983f10d6bdc9d9b6e17a1032ba6223118d389bd170df89b945a04a1e
    q2-320-x86-full-ctf           size=19267584   sha256=f82197c8c8089202a4b3a85d8833b0c2e827a709d205c760369407c212488baa
    all packages verified OK
    ```

**Decisions (Build):**
- Merge semantics: if either `engines/manifest.json` or `gamedata/manifest.json` fails to fetch or
  is refused by the parser, the whole combined fetch attempt counts as failed and falls back to the
  cache — no partial merge that would silently drop a whole content type while looking current.
- Cold-cache-and-dead-network error contract: `ManifestUnavailableError` (`.code ===
  'manifest-unavailable'`), so the D4 handler distinguishes it from any other failure and maps it to
  the `downloads.error.manifestUnavailable` i18n key rather than leaking a stack/message across IPC.
- Review fix cycle (1 of 3 max): fixed two real correctness findings before accepting the review —
  (1) `pinnedEnginePackage()` now verifies the resolved package is actually `kind: 'engine'` with a
  matching `engine` field before returning it, instead of trusting the id match alone; (2) a
  package's `engine` field is now validated with `engineKindSchema` instead of being cast
  (`as EngineKind`) unchecked, so a bogus engine-kind string is dropped and logged rather than
  crossing IPC as a type lie. Both are now covered by dedicated regression tests. A third,
  comment-only finding (an inaccurate "one shared 10s budget" comment where the two fetches
  actually each get their own parallel 10s timeout) was also corrected.
- Known, accepted non-blocking gaps from the review (not fixed — coverage notes, not defects):
  a malformed `pinned` *value* (e.g. a non-string) currently refuses the whole envelope, which is
  slightly wider than the Decisions section's literal wording ("missing `schemaVersion` or
  `packages`") — fail-loud is consistent with the story's overall bias and is left as is;
  `manifest-parse.test.ts`'s AC2 coverage does not separately exercise a missing `url`, a
  wrong/missing `kind` discriminator, a non-https URL or an uppercase sha256 (these already rest on
  the zod schema, which is itself reviewed); the `JsonStore` quarantine/corrupt-cache route to "no
  cache" is exercised indirectly (via the `cacheVersion`-mismatch path) but not via a real quarantine
  file.
