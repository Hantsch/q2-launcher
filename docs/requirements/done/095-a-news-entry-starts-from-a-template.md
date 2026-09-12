---
id: 095
title: A news entry starts from a template I can copy
status: done # draft -> ready -> in-progress -> done
created: 2026-09-12
---

## Requirement

Writing a news entry today means reading `q2_community_content/README.md` end to end and then
hand-assembling frontmatter from prose. There is no file to copy, no image next to the rules that
shows what "an image for this template" actually looks like, and nothing anywhere states how large
an image should be, which formats survive, or which part of it the launcher will crop away.

Two things follow from that.

**First, the launcher is missing a layout.** The three templates (`split`, `banner`, `text`) all
render their image as a *framed box beside or above the text* — a 45% column, or a 45% strip, each
`object-fit: cover` and centred (`src/renderer/src/styles/home-hero.css`). None of them puts the
image *behind* the text. An announcement slide built around one wide artwork — text over the quiet
left half, the subject pinned to the right edge so it survives every window width — cannot be
expressed with any of them. That is a launcher change, never a content change (concept
`docs/concepts/home-screen.md` §6.3: "A new template is a change **in the launcher**").

**Second, the content repository is missing its starter kit.** Every template the launcher offers —
the new one included — should have a folder in `Hantsch/q2_community_content` holding a
copy-and-fill `.md` skeleton, a README that explains that template's fields and rules, and an
example image in the size the template actually wants. Someone who wants to publish should copy a
folder, replace the text and the image, add one line to `index.json`, and be done — without opening
launcher source and without guessing pixel dimensions.

The story ends with a real entry written against the new kit: a community-welcome post using the
new template and the artwork already sitting at `news/community_welcome/community.png`.

As with story [[085]], work happens in the local checkout
`C:\development\Hantsch\q2_community_content` and in this repo's mirror at
`content/q2_community_content/`. Files are **written, not published** — no commit, no branch, no
push, in either repository.

## Acceptance Criteria

- [x] **AC1** — The launcher renders a fourth slide template whose image fills the whole slide
      behind the text, anchored to the slide's **right** edge: as the hero narrows, the image loses
      area on its left while its right-hand region stays fully visible.
- [x] **AC2** — That template's title, body and buttons stay legible over the image at every window
      width from `WINDOW_MIN_WIDTH` (940) upwards — contrast carried by the launcher's own scrim,
      not by the contributed image, and proven against a deliberately bright test image.
- [x] **AC3** — The new template is part of the shared contract the same way the other three are: a
      `NewsTemplate` value with its own content schema, validated in `feed-pipeline.ts`, and it
      falls back to `text` when its image is missing — exactly like `split` does.
- [x] **AC4** — A feed that declares the new template is still readable by a launcher build that
      predates it: the entry shows as a `text` slide, no entry is dropped and the rest of the feed
      is unaffected.
- [x] **AC5** — The content repository carries one folder per template under
      `news/_templates/<template>/`, each containing a fill-in-the-blanks `template.md`, a
      `README.md` for that template, and an example image where the template takes one.
- [x] **AC6** — Each template README states that template's complete field set, which fields are
      required, what happens when a field is missing, and — for image templates — the **accepted
      formats, the maximum file size, the maximum pixel dimensions, the recommended source size and
      which region of the image is guaranteed to stay visible** (the safe zone) versus what gets
      cropped at which window width.
- [x] **AC7** — `news/_templates/README.md` gives the one-screen overview: which template to pick
      for which kind of post, what `index.json` needs per entry, and the button rules — with a link
      into each template's own folder.
- [x] **AC8** — The repository's top-level `README.md` and the news contract it documents are
      updated for the fourth template and for the new `_templates/` directory; no statement in it
      contradicts the kit (specifically not "there are exactly three templates").
- [x] **AC9** — The community-welcome entry exists as a real feed entry: a `.md` file using the new
      template, an `index.json` row, and its image stored at the documented size and location.
- [x] **AC10** — The launcher validates the updated `index.json` and every entry in it — the welcome
      entry included — without a single warning, proven by a test reading the checked-in fixture
      copy under `content/q2_community_content/`; the `_templates/` folder is not part of the feed
      and is never fetched.
- [x] **AC11** — Nothing in the launcher's test suite or `ui:verify` fetches the content repository
      over the network, and no commit, branch, push or release is created in it by this story.

## Open Questions

All five resolved — see the Decisions below. Nothing blocks `status: ready`.

## Decisions (User)

- **(User)** Scope is both halves: the new launcher template **and** the kit for all templates —
  answered against the alternative of documenting only the existing three and postponing the
  template.
- **(User)** Kit location is `news/_templates/<template>/`, one folder per template, each with
  `template.md` + `README.md` + example image.
- **(User)** The community-welcome post ships with this story (`.md` + `index.json` row + image),
  written but not published.
- **(User)** Story is parked as 095 for S21; the running S20 is not touched.
- **(User)** The template is named **`cover`** — reads as "cover art", pairs with `banner`, and
  avoids the `hero` collision (the carousel itself is the news hero).
- **(User)** The community artwork is **re-exported to 2560×640** (4:1) from
  `news/community_welcome/community.png` (1916×821, 1.83 MB). Upscaling from 1916 px width is
  accepted in exchange for a source that matches the hero's own ratio and covers wide windows.
- **(User)** The `cover` text column is **`width: 45%; max-width: 560px`** — split's fraction at
  narrow windows, clamped so wide windows do not produce 1100 px-long lines. This clamp is the
  constant the documented safe zone is measured against.

## Decisions (Refine)

- **R1 — `schemaVersion` stays `1`.** Adding a template value is backwards-compatible (AC4), and
  bumping to `2` would make every older launcher show `schemaAhead` on a feed it renders correctly.
  The contract docs gain an explicit sentence: *template additions do not bump the schema version*.
- **R2 — Kit example images are generated placeholders**, not screenshots — extending the existing
  `scripts/generate-news-images.mjs` (sharp), matching the ~17 KB weight of today's
  `news/img/split-bootstrap.png`. They are binary weight in a repo every launcher fetches from, so
  they stay small and synthetic.
- **R3 — AC2 is not provable by axe.** `color-contrast` cannot compute a ratio against a background
  *image* — it reports `incomplete`, never a violation. The proof is a pixel probe in a `ui:flow`:
  render `cover` over a deliberately white test image, hide the text nodes, screenshot the text
  band, take the **lightest** pixel behind each text element and assert ≥ 4.5:1 against the rendered
  text colour. That machinery does not exist and is its own deliverable.
- **R4 — The mirror gains `README.md` and `news/_templates/`.** `content/q2_community_content/` is a
  subset today (no `README.md`). AC8 and AC10 both need those files checked in here to be testable
  at all.

## Plan

Two halves that barely touch: launcher code (D1–D3, D8) and content files (D4–D7).

**Launcher.** `cover` enters the contract exactly where the other three live: the `NewsTemplate`
union and a `.strict()` content schema in `src/shared/modules/home.ts`, the `NEWS_TEMPLATES` array
in `feed-cache.ts`, the `TEMPLATE_CONTENT_SCHEMAS` map and the `templateIsSatisfied()` rule in
`feed-pipeline.ts` (today literally `template !== 'split' || image !== undefined` — it becomes a set
of image-requiring templates). Forward compatibility (AC4) needs **no new code**: `resolveTemplate()`
already drops an unknown template to `text` with a warning — it needs a test that says so and keeps
saying so.

The renderer gets a fourth slide component next to `SlideSplit`/`SlideBanner`/`SlideText`, one more
entry in `NewsHero.tsx`'s `TEMPLATES` map and one more branch in `resolveSlideTemplate.ts`. The CSS
is the genuinely new part: `home-hero.css` has no overlay rule today except a `z-index: 1` stale
chip, so `cover` brings an absolutely positioned full-bleed `<img>` (`object-fit: cover;
object-position: 100% 50%`), a gradient scrim above it, and the content above that.

**Geometry the docs depend on.** The hero is 320 px tall at full content width. A 4:1 source crosses
over at a slide width of **~1280 px**: narrower → `cover` scales by height and crops horizontally
*from the left* (that is AC1); wider → it scales by width and crops vertically, centred. D3 measures
the real numbers on the real surface and D4/D6 write those measured numbers into the kit — so D3
runs before the docs.

**Content.** `news/_templates/` gets four folders plus an overview README, then the example images,
then the community-welcome entry. Everything is authored in this repo's mirror
`content/q2_community_content/` and copied verbatim into the checkout at
`C:\development\Hantsch\q2_community_content`. **No commit, no branch, no push in either repo.**

Order: D1 → D2 → D3 → D4 → D5 → D6 → D7 → D8.

## Deliverables

### D1 — `cover` in the shared contract and the feed pipeline

Add `'cover'` to `NewsTemplate`, a `newsCoverContentSchema` (base shape + optional `image`,
`.strict()`), the `NEWS_TEMPLATES` array and the `TEMPLATE_CONTENT_SCHEMAS` map, and generalise
`templateIsSatisfied()` from the split-only literal to a `TEMPLATES_REQUIRING_IMAGE` set holding
`split` and `cover`.

- Files: `src/shared/modules/home.ts`, `src/main/modules/home/news/feed-cache.ts`,
  `src/main/modules/home/news/feed-pipeline.ts`
- Mirror: `newsSplitContentSchema` (`home.ts:268-273`), `templateIsSatisfied` (`feed-pipeline.ts:147-149`)
- Tests in `src/main/modules/home/news/feed-pipeline.test.ts` — extend the existing template-fallback
  table (`:181-218`) with `cover-ok → cover` and `cover-no-image → text`, plus the AC4 case: a
  template value that is *not* in `NEWS_TEMPLATES` still resolves to `text`, keeps the entry, emits
  exactly one warning and leaves the neighbouring entries untouched.
- Accepted when: `npm test` and `npm run typecheck` green, and every `Record<NewsTemplate, …>` in the
  repo still type-checks exhaustively.

### D2 — The `cover` slide component and its full-bleed CSS

A `SlideCover.tsx` next to the other three: absolutely positioned `<img>` filling the slide, a scrim
over it, content over that. When `slide.imageUrl` is absent the component is never reached (D1
already downgraded such an entry to `text`), but it renders content-only defensively.

- Files: `src/renderer/src/modules/home/components/SlideCover.tsx`,
  `src/renderer/src/modules/home/components/resolveSlideTemplate.ts`,
  `src/renderer/src/modules/home/NewsHero.tsx`, `src/renderer/src/styles/home-hero.css`
- Mirror: `SlideSplit.tsx` for the component shape; `.home-hero-media` / `.home-hero-content`
  (`home-hero.css:154-197`) for class naming
- CSS: `.home-hero-slide-cover` (`position: relative`), `.home-hero-cover-image`
  (`position: absolute; inset: 0; object-fit: cover; object-position: 100% 50%`),
  `.home-hero-cover-scrim` (left-to-right gradient, **tokens only** — no hex literals,
  `/design-tokens`), `.home-hero-slide-cover .home-hero-content`
  (`width: 45%; max-width: 560px; position: relative`). Stacking stays below the existing
  `.home-hero-stale` chip (`z-index: 1`).
- Tests in `src/renderer/src/modules/home/slides.test.tsx` — a `cover` slide renders title, body and
  buttons and carries the image element; `resolveSlideTemplate` maps `'cover'` → `'cover'`.
- Accepted when: `npm test` + `npm run typecheck` green; no raw colour value in the new CSS.

### D3 — `ui:flow` proof: right-anchoring and measured contrast

The acceptance surface for AC1 and AC2. A new flow drives the real app with a `cover` slide whose
image is a deliberately bright (near-white) generated PNG, at viewports 940, 1280 and 1920.

- Files: `scripts/flows/news-cover-template.mjs` (new), `scripts/lib/fixture.mjs` (a `news-cover`
  variant seeding one `cover` slide plus the bright test image into the news image cache)
- Mirror: `scripts/flows/home-hero-carousel.mjs` for flow shape; `fixture.mjs`'s `news-images`
  variant (`newsImagePresentSlide()`) for image seeding
- AC1 check: read the `<img>`'s `getBoundingClientRect()` plus its natural size, compute the visible
  source rectangle, and assert (a) the rectangle's **right** edge equals the image's right edge at
  every viewport and (b) its left edge moves right as the viewport narrows below the crossover.
- AC2 check: `page.evaluate` sets `visibility: hidden` on title/body/buttons, screenshot the slide,
  decode with `sharp`, take the **lightest** pixel inside each text element's box and assert ≥ 4.5:1
  against the computed text colour. Any viewport missing it fails the flow.
- The flow **logs the measured crossover width and the safe-zone fractions**; D4/D6 copy those
  numbers rather than re-deriving them.
- Accepted when: `npm run ui:flow -- news-cover-template` exits 0 and prints the measured geometry;
  `npm run ui:verify` still exits 0.

### D4 — `news/_templates/<template>/` skeletons and per-template READMEs

Four folders (`split`, `banner`, `text`, `cover`), each with a copy-and-fill `template.md` (complete
frontmatter, required fields as `<placeholders>`, optional ones commented) and a `README.md`.

- Files: `content/q2_community_content/news/_templates/{split,banner,text,cover}/{template.md,README.md}`
  (authored here, then copied to the checkout)
- Each README states: the complete field set, which fields are required, what happens when one is
  missing (`cover`/`split` without `image` → delivered as `text`; no title/body → entry dropped), and
  for image templates the **accepted formats (`png`, `jpeg`, `webp`), max file size (5 MB,
  `MAX_IMAGE_BYTES`), max pixel dimension (4000 px, `MAX_IMAGE_DIMENSION_PX`), the recommended source
  size** (`cover`: 2560×640) **and the safe zone** — for `cover`, the right-anchored crop and the
  crossover width measured in D3. Also states R1: template additions do not bump `schemaVersion`.
- Test: `src/main/modules/home/news/templates-kit.test.ts` (new) — for every value of
  `NEWS_TEMPLATES` a folder exists with `template.md` + `README.md`; each `template.md` parses through
  the real `resolveFeed()` path as its own template; each image template's README names the formats,
  both caps, the recommended size and a safe zone.
- Accepted when: `npm test` green, and adding a template to `NEWS_TEMPLATES` without a kit folder
  fails that test.

### D5 — Kit overview and the repository's top-level README

- Files: `content/q2_community_content/news/_templates/README.md` (new),
  `content/q2_community_content/README.md` (new in the mirror — copied from the checkout, then updated
  in both)
- Overview: which template for which kind of post, what `index.json` needs per entry, the button rules
  (max 3, `label` + `url`), and a link into each template folder.
- Top-level README: the fourth template documented alongside the other three, the `_templates/`
  directory described, and **every "exactly three templates" statement removed** — including the
  sentence listing one real example per template.
- Test: extend `templates-kit.test.ts` — the overview links every `NEWS_TEMPLATES` value's folder; the
  top-level README mentions every template name and contains no "three templates" claim.
- Accepted when: `npm test` green; the mirror's `README.md` is byte-identical to the checkout's.

### D6 — Example images for the kit

Extend the existing generator and produce one synthetic example per image template, at that
template's own recommended source size, ≤ 25 KB each.

- Files: `scripts/generate-news-images.mjs`,
  `content/q2_community_content/news/_templates/{split,banner,cover}/example.png`
- Mirror: `news/img/split-bootstrap.png` (17 KB) for weight and style
- The `cover` example is 2560×640 and visibly marks its safe zone / crop line, so a contributor sees
  what survives.
- Test: extend `templates-kit.test.ts` — every image template's folder has `example.png`, it is a PNG
  within `MAX_IMAGE_BYTES` / `MAX_IMAGE_DIMENSION_PX`, and its dimensions equal the size its README
  recommends; `text/` has no example image.
- Accepted when: `npm test` green.

### D7 — The community-welcome entry

- Files: `content/q2_community_content/news/2026-09-12-welcome-to-the-community.md` (new),
  `content/q2_community_content/news/index.json` (one row, `order: 40`),
  `content/q2_community_content/news/img/cover-community-welcome.png` (new, 2560×640, exported from
  the checkout's `news/community_welcome/community.png`) — plus the same three in the checkout
- Mirror: `2026-09-10-r1q2-in-the-bootstrap-wizard.md` for frontmatter shape
- The export is a one-off `sharp` step (1916×821 → 2560×640, right-anchored crop and upscale per the
  user decision); record the exact command in `## Done`. Result stays under 1.5 MB.
- `schemaVersion` stays `1` (R1).
- Accepted when: `npm test` green (proven by D8) and the entry renders as a `cover` slide in the
  news-feed path of `npm run ui:verify`.

### D8 — Fixture contract: zero warnings, `_templates/` excluded, no network

- Files: `src/main/modules/home/news/news-fixture-contract.test.ts`
- Extend the existing on-disk fixture test (`NEWS_DIR`, `:24`) to assert: the four entries resolve in
  order `split, banner, text, cover`; **`resolveFeed()` returns an empty warnings array**; the welcome
  entry resolves as `cover` with its image at the documented size; no path under `_templates/` appears
  in `index.json` or in any resolved slide; and the test reads only from the filesystem — `fetch` is
  stubbed to throw, so any network access fails it.
- Accepted when: `npm test` green with `fetch` stubbed to throw.

## Model Hints

- D3 → `deliverable-hard` — the pixel-probe contrast check is new machinery with no precedent in the
  repo, and it has to distinguish "the scrim carries the contrast" from "the test image happened to be
  dark"; a wrong implementation passes silently and AC2 is then unproven.
- D1, D2, D4, D5, D6, D7, D8 → default. Each follows an existing file it can mirror line for line.
- Review: → `story-review-hard` — the story widens a shared contract that an *external* repository
  writes against and claims a backwards-compatibility guarantee (AC4) that no single diff hunk shows;
  the review also has to check content files in two repositories against each other, which no
  per-deliverable acceptance covers.

## Acceptance Tests

- AC1 → e2e `scripts/flows/news-cover-template.mjs` › "the cover image stays anchored to the slide's
  right edge and loses area on its left as the hero narrows"
- AC2 → e2e `scripts/flows/news-cover-template.mjs` › "title, body and buttons keep 4.5:1 over a
  deliberately bright image at 940, 1280 and 1920"
- AC3 → unit `src/main/modules/home/news/feed-pipeline.test.ts` › "a cover entry resolves to cover and
  falls back to text without an image"
- AC4 → unit `src/main/modules/home/news/feed-pipeline.test.ts` › "a template an older build does not
  know is delivered as text and leaves the rest of the feed intact"
- AC5 → unit `src/main/modules/home/news/templates-kit.test.ts` › "every template has a kit folder
  with template.md, README.md and an example image where it takes one"
- AC6 → unit `src/main/modules/home/news/templates-kit.test.ts` › "each template README names its
  required fields and, for image templates, the formats, both caps, the recommended size and the safe
  zone"
- AC7 → unit `src/main/modules/home/news/templates-kit.test.ts` › "the kit overview links every
  template's folder and states the index.json and button rules"
- AC8 → unit `src/main/modules/home/news/templates-kit.test.ts` › "the top-level README covers every
  template and no longer claims there are exactly three"
- AC9 → unit `src/main/modules/home/news/news-fixture-contract.test.ts` › "the community-welcome entry
  is a cover slide with its image at the documented size"
- AC10 → unit `src/main/modules/home/news/news-fixture-contract.test.ts` › "the checked-in feed
  resolves without warnings and never references _templates/"
- AC11 → unit `src/main/modules/home/news/news-fixture-contract.test.ts` › "the fixture feed is read
  from disk with fetch stubbed to throw" — **plus** the no-publish half, verified by command rather
  than by hand: after the last deliverable,
  `git -C C:\development\Hantsch\q2_community_content status --porcelain` shows the new files as
  untracked/modified and `git -C C:\development\Hantsch\q2_community_content rev-parse HEAD` matches
  the commit recorded at the story's start. Both outputs go into `## Done`.

No `manual residue` in this story.

### Coverage gate

| AC | Deliverable | Test |
| --- | --- | --- |
| AC1 | D2 + D3 | e2e `news-cover-template.mjs` |
| AC2 | D2 + D3 | e2e `news-cover-template.mjs` |
| AC3 | D1 | `feed-pipeline.test.ts` |
| AC4 | D1 | `feed-pipeline.test.ts` |
| AC5 | D4 + D6 | `templates-kit.test.ts` |
| AC6 | D4 | `templates-kit.test.ts` |
| AC7 | D5 | `templates-kit.test.ts` |
| AC8 | D5 | `templates-kit.test.ts` |
| AC9 | D7 | `news-fixture-contract.test.ts` |
| AC10 | D8 | `news-fixture-contract.test.ts` |
| AC11 | D8 | `news-fixture-contract.test.ts` + the two `git -C` commands above |

## Done

### AC11 verification (recorded during review-fix)

`git -C C:\development\Hantsch\q2_community_content status --porcelain`:

```
A  config_templates/README.md
A  mods/README.md
A  packs/README.md
?? README.md
?? docs/
?? news/
```

`git -C C:\development\Hantsch\q2_community_content rev-parse HEAD`:

```
1fea243f4814a0b3e38fb93f26d59190b714e667
```

No commit, branch or push was made in the checkout; the new/changed files above show as
untracked/staged-only, and `HEAD` is unchanged.

### D7 export command

The community-welcome image was re-exported from the checkout's source artwork with a one-off
`sharp` script (deleted after use):

```js
await sharp('C:/development/Hantsch/q2_community_content/news/community_welcome/community.png')
  .resize(2560, 640, { fit: 'cover', position: 'right' })
  .png({ compressionLevel: 9, quality: 85 })
  .toFile('C:/development/Hantsch/q2-launcher/content/q2_community_content/news/img/cover-community-welcome.png')
```

Result: 545,203 bytes (well under the 1.5 MB budget), 2560×640.

### Summary

- The `cover` news template now exists end-to-end: shared contract (`NewsTemplate`, content
  schema, pipeline validation and forward-compatible fallback to `text`), a renderer slide
  component with full-bleed, right-anchored artwork and a scrim carrying all text contrast, and
  an `npm run ui:flow -- news-cover-template` proof measuring the real anchoring and contrast
  geometry (crossover at 1101px slide width, safe zone fractions 0.775/0.601).
- The community content repository gained a `news/_templates/<template>/` starter kit (skeleton
  + README + example image) for all four templates, an overview README, and an updated
  top-level README with no remaining "three templates" claims — authored in this repo's mirror
  and copied byte-for-byte (LF) into the local checkout, never committed there.
- A real community-welcome entry ships using the new template (`order: 40`), and the checked-in
  fixture now resolves all four entries with zero warnings, excludes `_templates/` from the feed,
  and is proven to touch no network (`fetch` stubbed to throw).
- Two review-fix cycles corrected: a dead (unfalsifiable) e2e assertion, missing/inverted
  safe-zone documentation for `split`/`banner`, three contradictions in the top-level README, a
  dead link in the shipped entry, and byte-parity between the mirror and the checkout.

### Verification

- `npm run build`, `npm run typecheck` — green.
- `npm test` — 217 files / 3865 passed, 1 skipped; one known pre-existing flake
  (`import-reader.test.ts`, unrelated 512-file fan-out timeout) confirmed to pass in isolation.
- `npm run ui:verify` — 82/82 screenshots, 0 axe violations.
- `npm run ui:flow -- news-cover-template` — green; measured geometry matches the numbers written
  into the kit docs.
- `npm run ui:flow -- news-feed` (story 082's flow, not this story's own gate) — its phase-1
  slide-count/order assertion was updated for the new 4th entry and passes; its phase-2 failure
  (`/engines/manifest.json`, `/gamedata/manifest.json`) is confirmed pre-existing via `git stash`
  against the unmodified tree — unrelated to this story, not fixed here.
- Code review (`story-review-hard`, per Model Hints): cycle 1 FAIL (AC6/AC8 unmet, one dead
  assertion, empty Done, byte-identity gap) → fixed; cycle 2 FAIL (split/banner safe-zone
  direction was inverted, one dead link) → fixed; cycle 3 **PASS**.
- AC → test mapping verified as written in the Coverage gate table above; no `manual residue`.
- Two minor items left as-is per the reviewer's own call: `templates-kit.test.ts`'s AC7 test
  checks only the folder links, not the index.json/button-rules prose (the prose is correct,
  just untested); `resolveSlideTemplate.ts`'s local `RenderedTemplate` type duplicates
  `NewsTemplate` verbatim (harmless today, flagged as a drift risk if the two ever diverge).
- `scripts/check-content-repo.mjs` (story 085, "never a CI gate") reports content differences
  between mirror and checkout driven by pre-existing CRLF-vs-LF convention differences that
  predate this story (three 2026-09-10 entries, `community_welcome/community.png`, and
  pre-existing staged files in the checkout unrelated to 095); not a regression introduced here.

### Commit message

```
095: a news entry starts from a template
```
