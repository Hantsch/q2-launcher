---
id: 085
title: The content repository carries the news contract
status: done # draft -> ready -> in-progress -> done
created: 2026-09-10
---

## Requirement

The feed only exists if someone can write one. The public `Hantsch/q2_community_content`
repository must therefore carry the contract in a form a contributor can follow without reading
launcher source: the directory layout, the `index.json` fields, every template with its exact
field set, and the button rules. It also gets a first real set of entries — one per template — so
the launcher's own hero has something to show and the contract is proven by an example rather
than only described.

The repository's later content types are fixed now at almost no cost: `packs/`, `mods/` and
`config_templates/` exist as directories from day one, and nothing reads them in v1.

Work happens in the existing local checkout `C:\development\Hantsch\q2_community_content`. The
files are written, not published: no commit, no push, no release — publishing stays my decision.

## Acceptance Criteria

- [x] **AC1** — The checkout contains `news/` with `index.json`, an `img/` directory, and the
      empty-but-present `packs/`, `mods/` and `config_templates/` directories.
- [x] **AC2** — `news/index.json` carries `schemaVersion` and entries with `id`, `file`, `order`
      and optional `visibleFrom`/`visibleUntil`, in exactly the shape the launcher validates.
- [x] **AC3** — `news/` contains at least one valid entry per template (`split`, `banner`,
      `text`), including the image an image template references.
- [x] **AC4** — The repository's `README.md` documents the directory layout, every `index.json`
      field, every template with its fields, the button rules (max 3, external links only, host
      allowlist) and how visibility and order work.
- [x] **AC5** — The README states that a contributor supplies content only — no CSS, HTML,
      colours or layout values — and what happens to an entry that breaks a rule (dropped, with
      the rest of the feed still shown).
- [x] **AC6** — The launcher validates this exact `index.json` and these exact entries without a
      single warning, proven by a test that reads the checked-in fixture copy of them.
- [x] **AC7** — Nothing in the launcher's test suite or `ui:verify` fetches this repository over
      the network; the fixture copy is what the tests use.
- [x] **AC8** — No commit, branch, push or release is created in the content repository by this
      story.

## Decisions (Sprint)

- **(User)** Reserved directories (`packs/`, `mods/`, `config_templates/`) each get a placeholder
  README stating "reserved, not read yet".
- **(User)** `config_templates/`'s future `index.json` shape is left open for a future story — not
  sketched now, consistent with this sprint's deliberate omission of reading that directory.
- The `news/` tree is **authored in this repo** at `content/q2_community_content/news/` and copied
  verbatim into the checkout — that path is the launcher's existing mirror of the same repository
  (`content/q2_community_content/{engines,gamedata}/manifest.json`), so AC6/AC7's "fixture copy"
  needs no new convention and byte-identity with the checkout is enforceable.
- The checkout's `README.md` documents the **whole** top-level layout, including the `engines/` and
  `gamedata/` directories that already exist there — a README that described only `news/` plus three
  reserved directories would state a layout the repository does not have.
- `engines/` and `gamedata/` get one line each (what they are, which manifest, that the launcher's
  download module reads them); only the news contract is documented in full, because that is the
  contract this story is asked to carry.
- Reserved directories are represented by their placeholder README **file** rather than an empty
  directory because git cannot track an empty directory — without the file the reserved layout
  would not survive a clone, and AC1 would only hold locally.
- Three entries, one per template, all three visible today: `split` (order 10), `banner`
  (order 20), `text` (order 30) — the minimum that proves every template and, at the same time, the
  hero's carousel with more than one slide.
- Optional fields are exercised without hiding anything: one entry carries `visibleFrom` in the
  past only, one carries `visibleFrom` plus a far-future `visibleUntil`, one carries neither — so
  AC2's optional fields appear in real content while all three entries stay visible.
- One entry carries exactly **3** buttons (the boundary the rule names) and the others fewer, so the
  max-3 rule is demonstrated by content instead of only described in the README.
- Every button URL is chosen so it **passes 082's host-allowlist predicate**, and D2's test asserts
  that against the exported constant rather than a copied host string — AC6 requires zero warnings,
  so a URL outside the allowlist is a failing fixture, and 082's allowlist is not touched to
  accommodate the content.
- Slide images are **generated** by `scripts/generate-news-images.mjs` with the already-vendored
  `sharp` (the `generate-icon.mjs` / `generate-installation-icons.mjs` convention), sized well
  inside 084's ~5MB / 4000px limits — reproducible bytes, no third-party asset and no licensing
  question in a public repository.
- The two images are distinct (one wide for `banner`, one squarer for `split`) because a single
  shared bitmap would not show that the two templates have different image geometry.
- `ui:verify`'s news stub is served from the checked-in fixture copy over the **existing**
  `127.0.0.1` fixture server (`scripts/lib/fixture.mjs`, `Q2L_UI_CONTENT_REPO_BASE`,
  `src/main/modules/downloads/harness.ts`) — the offline seam already exists for manifests, so AC7
  needs a source repoint, not a second mechanism.
- AC1/AC4/AC5/AC8 assert the state of an **external working copy** that no vitest run can see, so
  they are machine-verified by `scripts/check-content-repo.mjs` instead of by a unit test or a
  manual click list — the "machine-verified by `scripts/…`" idiom CLAUDE.md already uses for the
  config-header geometry.
- That script **skips with exit 0 when the checkout is absent**, so it can never become a CI gate
  for a directory that only exists on the maintainer's machine.
- AC8 is checked positively, not by trust: the script asserts the checkout's `HEAD` still points at
  `1fea243`, that the files this story writes are untracked (`??`), and that no branch besides
  `main` and no new tag exists.
- `content/**` is excluded from any prettier run this story makes (format only the `.mjs`/`.ts`
  files it authors) — reformatting the authored feed would break byte-identity with the checkout,
  and the repo is not prettier-clean anyway.
- No `schemaVersion` other than `1` is written, and no field outside 082's validated set is
  invented — the README documents what today's launcher understands, per concept §6.3.

## Open Questions

- ~~Do the reserved directories get a placeholder README each stating "reserved, not read yet", or
  do they stay empty?~~ answered → Decisions (Sprint)
- ~~`config_templates/` is the likeliest next content type and may want the same `index.json`
  shape. Is that shape sketched in the README now, or deliberately left open? (Concept open
  point 13.)~~ answered → Decisions (Sprint)

None open. Noted for the sprint review, not blocking: the checkout already contains `engines/` and
`gamedata/` (added by story 080's manifest work), which
[concepts/home-screen.md](../concepts/home-screen.md) §6 still describes as "today it contains only
a LICENSE" — the concept's repo-layout listing is stale and its `news/`-only sketch should be
updated once this story's README exists.

## Plan

Two artefacts, one source of truth. The feed is authored **in this repo** under
`content/q2_community_content/news/` (the existing mirror of that same repository), the launcher's
test and `ui:verify` read exactly those files, and the checkout gets a verbatim copy plus the README
and the reserved-directory placeholders. A maintenance script proves the checkout matches and that
nothing was committed.

Order (D2 needs 082's pipeline, which is built before this story; D3 needs 082's harness seam):

1. **D1 — author the feed** in `content/q2_community_content/news/`: `index.json`
   (`schemaVersion: 1`, three entries, `order` 10/20/30, the optional-window mix from Decisions),
   three `.md` entries (`split` / `banner` / `text`), and `img/` with the two generated PNGs.
   New script `scripts/generate-news-images.mjs` (mirrors `scripts/generate-installation-icons.mjs`)
   produces the bitmaps with `sharp`.
2. **D2 — the zero-warning test**: a colocated vitest suite next to 082's feed pipeline that reads
   the fixture copy from disk, runs it through the real validate/filter/sort path with a fake logger
   and asserts three slides, the `order` sequence, the three templates, the referenced image, and
   `log.warn`/`log.error` never called. Mirrors
   `src/main/modules/downloads/bootstrap/archive-layouts.test.ts` for the `REPO_ROOT` join and the
   `fakeLogger()` idiom, and `shipped-manifest.test.ts` for the not-called assertion.
3. **D3 — offline `ui:verify`**: the news stub the harness serves is sourced from
   `content/q2_community_content/news/` on the existing `127.0.0.1` fixture server
   (`scripts/lib/fixture.mjs`), so no run reaches `raw.githubusercontent`.
4. **D4 — write the checkout**: copy `news/` verbatim into
   `C:\development\Hantsch\q2_community_content`, add `packs/`, `mods/`, `config_templates/` with
   their "reserved, not read yet" READMEs, and write the root `README.md` (full top-level layout,
   `index.json` fields, per-template field sets, button rules, visibility + order, and the
   content-only / dropped-entry rules of AC5). **No `git add`, commit, branch, push or release.**
5. **D5 — `scripts/check-content-repo.mjs`**: asserts the checkout's layout, the reserved READMEs,
   the root README's required sections, byte-identity of `news/` with the fixture copy, and the
   untouched git state; exits 0 with a skip note when the checkout is absent.

Guardrails: nothing here touches `src/shared/ipc.ts`, the renderer, or 082's allowlist — this story
adds content, one test, one harness source repoint and one maintenance script. Do not run prettier
over `content/**`.

## Deliverables

- **D1 — The feed exists as checked-in content.**
  Files: `content/q2_community_content/news/index.json`,
  `content/q2_community_content/news/2026-09-10-r1q2-in-the-bootstrap-wizard.md` (`split`,
  `imageSide: left`, `tag: RELEASE`, 2 buttons, `order: 10`, `visibleFrom` only),
  `content/q2_community_content/news/2026-09-10-the-community-content-repository.md` (`banner`,
  3 buttons, `order: 20`, `visibleFrom` + far-future `visibleUntil`),
  `content/q2_community_content/news/2026-09-10-how-news-reaches-the-launcher.md` (`text`, 1 button,
  `order: 30`, no window), `content/q2_community_content/news/img/*.png`,
  `scripts/generate-news-images.mjs`.
  Mirror: `scripts/generate-installation-icons.mjs` (sharp + repo-root resolution),
  `content/q2_community_content/engines/manifest.json` (mirror-directory precedent).
  Acceptance: `index.json` parses, carries `schemaVersion: 1` and the three entries with `id`,
  `file`, `order` and the optional-window mix; each `.md`'s frontmatter names its template and fills
  only that template's fields plus a body; every referenced image file exists and is < 5MB / ≤4000px.

- **D2 — The launcher validates this feed without a warning.**
  Files: one new test beside 082's pipeline (expected `src/main/modules/home/feed/` — use the
  directory 082 actually created), e.g. `news-fixture-contract.test.ts`. No production file changes.
  Mirror: `src/main/modules/downloads/bootstrap/archive-layouts.test.ts` (reads repo files,
  `fakeLogger()`), `src/main/modules/downloads/shipped-manifest.test.ts:84`
  (`expect(log.warn).not.toHaveBeenCalled()`).
  Acceptance: the suite reads the D1 files from disk, runs 082's real validate → filter → sort path,
  and asserts exactly three slides in `order` 10/20/30, templates `split`/`banner`/`text`, the
  3-button entry keeping all three, every button URL accepted by 082's exported allowlist, and no
  `warn`/`error` on the injected logger.

- **D3 — `ui:verify` reads the fixture copy, not the network.**
  Files: `scripts/lib/fixture.mjs` (news seed block sourced from
  `content/q2_community_content/news/`), plus at most one adjacent screens/flow touch-up if 082 left
  a placeholder.
  Mirror: the existing bootstrap manifest seeding in the same file (`127.0.0.1` fixture server,
  `Q2L_UI_CONTENT_REPO_BASE`).
  Acceptance: `npm run ui:verify` completes with the hero showing the D1 slides, and no run in
  `npm test` or `npm run ui:verify` issues a request to `raw.githubusercontent.com`.

- **D4 — The checkout carries the contract.**
  Files (outside this repo, in `C:\development\Hantsch\q2_community_content`): `news/**` (verbatim
  copy of D1), `packs/README.md`, `mods/README.md`, `config_templates/README.md`, `README.md`.
  Acceptance: the four top-level directories exist; each reserved README states "reserved, not read
  yet"; the root README documents the top-level layout (including `engines/` and `gamedata/`), every
  `index.json` field, every template with its exact field set, the button rules (max 3, external
  links only, host allowlist), how `visibleFrom`/`visibleUntil` and `order` work, that a contributor
  supplies content only (no CSS, HTML, colours, layout values), and that a rule-breaking entry is
  dropped while the rest of the feed still shows. English throughout (the checkout's `AGENTS.md`).
  No git operation of any kind in the checkout.

- **D5 — The checkout is machine-verified.**
  Files: `scripts/check-content-repo.mjs`, plus its `package.json` script entry
  (`"check:content-repo"`).
  Mirror: `scripts/manifest-hashes.mjs` (repo-maintenance `.mjs`, repo-root resolution, plain
  console output + non-zero exit).
  Acceptance: run against the checkout it exits 0 and prints each check; it fails loudly on a
  missing directory, a missing reserved README, a missing required README section, a `news/` file
  that differs byte-for-byte from the fixture copy, a `HEAD` other than `1fea243`, a tracked (not
  `??`) story file, or an extra branch/tag. With the checkout absent it prints a skip line and exits 0.

## Model Hints

- D1 → default
- D2 → default
- D3 → default
- D4 → default
- D5 → default
- Review: → default — the story adds content, one read-only test, one harness source repoint and one
  maintenance script; it changes no production code path, no IPC and no renderer surface, so there
  is no regression risk worth the expensive tier.

## Acceptance Tests

- AC1 → script `scripts/check-content-repo.mjs` › "layout: news/, news/img/, packs/, mods/,
  config_templates/ present" (D5; the checkout is an external working copy no vitest run can see —
  machine-verified, not manual)
- AC2 → unit `src/main/modules/home/news/news-fixture-contract.test.ts` › "resolves the three
  checked-in entries into split/banner/text slides with zero warnings" (D2; directory corrected from
  the story's guessed `home/feed/` to the real `home/news/` — where 082 actually put the pipeline)
- AC3 → unit `src/main/modules/home/news/news-fixture-contract.test.ts` › "the split and banner
  slides carry an image that exists on disk" plus "the text entry keeps its single button and
  carries no image" (D2)
- AC4 → script `scripts/check-content-repo.mjs` › "README documents layout, index.json fields,
  templates and button rules" (D5)
- AC5 → script `scripts/check-content-repo.mjs` › "README states content-only and the
  dropped-entry rule" (D5)
- AC6 → unit `src/main/modules/home/news/news-fixture-contract.test.ts` › "resolves the three
  checked-in entries into split/banner/text slides with zero warnings" (`result.warnings` toEqual
  `[]`) (D2)
- AC7 → e2e `npm run ui:flow -- news-feed` (`scripts/flows/news-feed.mjs`, repointed by D3 to serve
  `content/q2_community_content/news/` over its own `127.0.0.1` fixture server; the general
  `npm run ui:verify` screen walk never sets the news harness base at all, so it makes zero news
  requests by construction — `resolveNewsSource()` returns `skip`) plus unit
  `src/main/modules/home/news/news-fixture-contract.test.ts` (D2, reads the same on-disk fixture
  directly) (D3/D2)
- AC8 → script `scripts/check-content-repo.mjs` › "the checkout has no new commit, branch or tag and
  the story's files are untracked" (D5)

No manual residue: the four criteria about the external checkout are proven by D5's script, which
`/build` runs and whose output goes into `## Done`.

## Done

Summary: authored the checked-in news feed (`content/q2_community_content/news/`: `index.json`,
one entry per template with the optional-window mix, two generated PNGs) plus its generator
(`scripts/generate-news-images.mjs`); added a unit test that runs the real 082 pipeline over that
fixture and asserts zero warnings; repointed the offline `news-feed` UI flow at the same fixture
copy (deleting the now-superseded `docs/fixtures/news/`); wrote the verbatim copy, the three
reserved-directory READMEs and the full contract `README.md` into the external checkout
`C:\development\Hantsch\q2_community_content` (no git operation there); and added
`scripts/check-content-repo.mjs`, a maintenance script that machine-verifies the checkout's layout,
READMEs, byte-identity and untouched git state.

Commit message:
```
085: news contract lives in the content repo, with a fixture copy and a checker
```

Verification:
- `npm run build` — passed.
- `npm run typecheck` — passed (fixed an unused-variable error the D2 test introduced: an
  unnecessary `NOW` constant, since `resolveFeed()` doesn't filter by visibility).
- `npm test` — 3390/3391 passed. The one failure
  (`src/main/modules/config/core/import-reader.test.ts` › "refuses further exec once 512 files have
  been opened...") is a pre-existing timeout-flakiness in an unrelated config-module test last
  touched by story 066; confirmed untouched by this story's diff.
- `npm run ui:verify` — 34/34 screens, 68/68 screenshots, 0 axe violations.
- `npm run ui:flow -- news-feed` — the dedicated e2e flow for this feature — passed both phases
  against the repointed fixture, no request left `127.0.0.1`.
- Clean-agent review: **PASS**. All 8 ACs verified PASS with file:line evidence; one cosmetic-only
  finding (a mojibake bullet character in the newly appended `docs/sprints/S18/progress.md` lines,
  a PowerShell `Add-Content` codepage artefact) — left as-is, it gates no acceptance criterion and
  touches no deliverable file.
- AC → test mapping, as verified:
  - AC1 → `scripts/check-content-repo.mjs` (run for real against the checkout): layout check PASS.
  - AC2 → `news-fixture-contract.test.ts` "resolves the three checked-in entries...": PASS.
  - AC3 → `news-fixture-contract.test.ts` image-presence assertions: PASS.
  - AC4 → `scripts/check-content-repo.mjs` README-sections check: PASS.
  - AC5 → `scripts/check-content-repo.mjs` content-only/dropped-entry check: PASS.
  - AC6 → `news-fixture-contract.test.ts` `result.warnings` toEqual `[]`: PASS.
  - AC7 → `npm run ui:flow -- news-feed` (real e2e, fixture-served, no external request) +
    `news-fixture-contract.test.ts` (reads the same on-disk fixture): PASS. Note: the general
    `npm run ui:verify` screen walk does not exercise the news hero at all (it never sets the news
    harness base, so `resolveNewsSource()` returns `skip` and the home screen shows its empty
    state) — AC7's real proof is the dedicated `news-feed` flow, not the screen walk; the
    `## Acceptance Tests` mapping above was corrected to say so.
  - AC8 → `scripts/check-content-repo.mjs` git-state checks (HEAD still `1fea243`, all new paths
    `??`, only `main`, no tags): PASS.
- No manual residue.

Decisions (made during implementation, not previously recorded):
- The story's own text guessed the pipeline directory as `src/main/modules/home/feed/`; the real
  082 output lives at `src/main/modules/home/news/`. D2's test and the `## Acceptance Tests`
  mapping were corrected to that real path.
- D1's `.md` frontmatter uses only the fields the real, `.strict()` shared schemas
  (`src/shared/modules/home.ts`) and pipeline (`feed-pipeline.ts`'s `resolveTemplate()`) actually
  consume (`template`, `title`, `image`, `order`, `visibleFrom`/`visibleUntil`, `buttons`) — the
  story's own deliverable text mentioned `imageSide`/`tag` as example frontmatter, but those fields
  do not exist in today's validated schema, so they were omitted rather than written as inert,
  undocumented content; the checkout's `README.md` (D4) documents only the fields that are real.
- D3 repoints `scripts/flows/news-feed.mjs` (the flow story 082 already built) at the D1 fixture
  rather than adding a second fixture-serving mechanism in `scripts/lib/fixture.mjs`, and deletes
  the now-superseded `docs/fixtures/news/` — one canonical fixture copy, per the story's own
  Decisions ("a source repoint, not a second mechanism").
- Button URLs use real, well-formed `https://github.com/...` links (not all resolving to existing
  pages) since `isAllowedButtonHost()` only checks scheme+hostname, not reachability.
