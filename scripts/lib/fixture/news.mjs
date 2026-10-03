import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { REPO_ROOT } from '../paths.mjs'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { variantUserDataDir } from '../harness.mjs'
import { deflateSync } from 'node:zlib'
import {
  FIXED_TIMESTAMP,
  STATE_FILE,
  WINDOW_STATE_FILE,
  emptyStateDocument,
  rmDirBestEffort,
  windowStateDocument,
  writeJson,
} from './core.mjs'

/** An older instant than `FIXED_TIMESTAMP`, used only by the `news-stale` variant below so its
 * "as of <date>" chip (`NewsHero.tsx`) reads as visibly aged rather than merely different. */
const NEWS_STALE_TIMESTAMP = '2025-01-01T00:00:00.000Z'

// --- story 083 D6: the home hero's news feed cache -------------------------
//
// Mirrors src/main/modules/home/news/feed-cache.ts's `NEWS_CACHE_VERSION`/`NEWS_FEED_CACHE_FILE`
// and the shape `NewsFeedCache`/`NewsFeedCacheData` persist - `{ cacheVersion, slides, etags,
// retrievedAt, lastRefreshFailed? }` under `userData/news-feed.json`. Written directly as JSON,
// the same way every other fixture writer below bypasses the real app's own write path (`JsonStore`)
// in favour of a plain `writeJson()` call - the point of a fixture is a known-good file already on
// disk before the app ever starts, not a round trip through the code under test.
//
// The home module's app-start fetch is unconditionally skipped under the UI-verification harness
// (`src/main/modules/home/index.ts`, gated via `resolveUiHarness` / `app.harness`), so this file is the ONLY
// source of truth for the three `home-hero*` screens - no fetch, loopback or otherwise, ever runs
// during `ui:verify`/`ui:flow`. `lastRefreshFailed` is a story 083 D6 addition to the persisted
// schema (`feed-cache.ts`) purely so the `news-stale` variant's aged cache can carry it verbatim,
// since a *real* refresh only ever sets that flag in memory, never in the file it did not manage to
// refresh.
const NEWS_CACHE_VERSION = 1

const NEWS_FEED_CACHE_FILE = 'news-feed.json'

/** Two real `text`-template slides - simple enough to need no image URL, but genuinely two so the
 * carousel this fixture feeds (`home-hero`, `scripts/flows/home-hero-carousel.mjs`) has something
 * to rotate through, dot between and reorder via prev/next. Mirrors `NewsSlide`
 * (`src/shared/modules/home.ts`). */
export const NEWS_FIXTURE_SLIDES = [
  {
    id: 'fixture-news-slide-one',
    template: 'text',
    order: 1,
    title: 'Fixture News Slide One',
    body: 'Seeded news body for the ui-verify home hero fixture - the first of two slides.',
    buttons: [],
  },
  {
    id: 'fixture-news-slide-two',
    template: 'text',
    order: 2,
    title: 'Fixture News Slide Two',
    body: 'A second seeded slide, so the carousel has more than one to rotate through.',
    buttons: [],
  },
]

/** Writes `userData/news-feed.json` in the exact shape `NewsFeedCache`/`ensureLoaded()` read back. */
export function writeNewsFeedCache(
  userDataDir,
  { slides, retrievedAt, lastRefreshFailed = false, etags = {} },
) {
  writeJson(join(userDataDir, NEWS_FEED_CACHE_FILE), {
    cacheVersion: NEWS_CACHE_VERSION,
    slides,
    etags,
    retrievedAt,
    lastRefreshFailed,
  })
}

// --- story 084 D6: the hero's cached-image slides ("image present" / "image failed") ----------
//
// Mirrors src/main/lib/content-repo.ts's `CONTENT_REPO_RAW_BASE`, src/main/modules/home/news/
// feed-fetcher.ts's `NEWS_DIRECTORY` ('news') and src/main/modules/home/images/paths.ts's
// `newsImageFileName()` (sha256-hex-of-source-url + extension) - the same three facts
// `resolve-feed-images.ts`'s `imageSourceUrl()`/`imageUrlFor()` combine in production. This file
// cannot `import` that TS module at runtime (see the top-of-file note), so the hashing is
// replicated here byte-for-byte instead of hand-typing a name, which is what keeps the fixture's
// file name provably the one `newsImageFileName(sourceUrl, 'png')` would have produced for the
// same URL.
const CONTENT_REPO_RAW_BASE = 'https://raw.githubusercontent.com/Hantsch/q2_community_content/main'

const NEWS_DIRECTORY = 'news'

/** Mirrors `newsImageFileName()` (`src/main/modules/home/images/paths.ts`): sha256 hex of the
 * source URL, plus extension. */
function newsImageFileName(sourceUrl, ext) {
  const digest = createHash('sha256').update(sourceUrl).digest('hex')
  return `${digest}.${ext}`
}

/** The declared frontmatter path resolved against `NEWS_DIRECTORY`/`CONTENT_REPO_RAW_BASE`, the
 * same join `resolve-feed-images.ts`'s `imageSourceUrl()` performs. */
function newsImageSourceUrl(relativeImagePath) {
  return `${CONTENT_REPO_RAW_BASE}/${NEWS_DIRECTORY}/${relativeImagePath}`
}

/** The real fixture image `story 085` already stages under `content/q2_community_content/news/
 * img/` - reused here rather than inventing new bytes, so the "image present" screen shows a real
 * picture. */
const NEWS_IMAGE_SOURCE_FILE = join(
  REPO_ROOT,
  'content',
  'q2_community_content',
  'news',
  'img',
  'split-bootstrap.png',
)

const NEWS_IMAGE_RELATIVE_PATH = 'img/split-bootstrap.png'

const NEWS_IMAGE_EXT = 'png'

/** `id`/`title`/`body` for the two `news-images`-variant slides - exported so `screens.mjs` can
 * wait on their exact title text rather than guessing. */
export const NEWS_IMAGE_PRESENT_SLIDE_ID = 'fixture-news-slide-image-present'

export const NEWS_IMAGE_FAILED_SLIDE_ID = 'fixture-news-slide-image-failed'

/**
 * `home-hero-slide-image`'s slide (AC6/D6): a `split`-template slide whose `imageUrl` is a real
 * `q2launcher://` URL for a file this fixture actually writes to
 * `userData/cache/news-images/<name>.png` below - the exact cache-hit shape `resolve-feed-images.ts`
 * produces (D4), just built by hand since the fixture never runs that pipeline. Per `NewsSlide`'s
 * own doc comment ("resolved slides never carry `image` forward"), only `imageUrl` is set here.
 */
function newsImagePresentSlide() {
  const fileName = newsImageFileName(newsImageSourceUrl(NEWS_IMAGE_RELATIVE_PATH), NEWS_IMAGE_EXT)
  return {
    id: NEWS_IMAGE_PRESENT_SLIDE_ID,
    template: 'split',
    order: 1,
    title: 'Bootstrap Wizard Arrives',
    body: "A real cached slide image, served from the launcher's own userData cache - never a remote origin.",
    imageUrl: `q2launcher://app/news-image/${fileName}`,
    buttons: [],
  }
}

/**
 * `home-hero-slide-image-failed`'s slide (AC6/D6): same `split` template, but a cache miss baked
 * in at seed time rather than a live fetch attempt - nothing under this name is ever written to
 * `cache/news-images/` by this fixture. `image` is set here purely as authoring metadata (mirrors
 * what a real un-resolved/rejected entry would still declare in its frontmatter); it plays no part
 * in template selection - `resolveSlideTemplate()`
 * (`src/renderer/src/modules/home/components/resolveSlideTemplate.ts`) keeps a `split`/`banner`
 * slide on its own template unconditionally (084 AC3: the template stays intact without an image),
 * so this slide proves the `split` template's own full-width no-image fallback (D5) purely via the
 * absence of `imageUrl`, not via any branching on `image`.
 */
function newsImageFailedSlide() {
  return {
    id: NEWS_IMAGE_FAILED_SLIDE_ID,
    template: 'split',
    order: 2,
    title: 'Point Release Notes',
    body: 'This slide references an image that never made it into the cache - the template still renders full width, no broken-image icon.',
    image: 'img/point-release-missing.png',
    buttons: [],
  }
}

/** Writes the real fixture PNG into `userData/cache/news-images/<name>.png` - a genuine cache hit,
 * not a stub - so the `q2launcher://news-image/...` route actually serves bytes back (AC5's
 * "image present" half). Mirrors the downloads-cache seeding style at `writeDownloadsCacheArchives()`
 * below: create the cache directory, then write real file bytes into it. */
function writeNewsImageCacheFile(userDataDir) {
  const cacheDir = join(userDataDir, 'cache', 'news-images')
  mkdirSync(cacheDir, { recursive: true })
  const fileName = newsImageFileName(newsImageSourceUrl(NEWS_IMAGE_RELATIVE_PATH), NEWS_IMAGE_EXT)
  const bytes = readFileSync(NEWS_IMAGE_SOURCE_FILE)
  writeFileSync(join(cacheDir, fileName), bytes)
}

/**
 * Deletes and rewrites the `news-images` variant's userdata: no installations/profiles (this
 * fixture's only job is the hero's two image slides), a fresh feed cache carrying
 * `newsImagePresentSlide()`/`newsImageFailedSlide()`, and the one real cached PNG the "present"
 * slide's `imageUrl` resolves to. A dedicated variant, not an extension of `populated`'s own
 * two-slide feed (`NEWS_FIXTURE_SLIDES`): `scripts/flows/home-hero-carousel.mjs` documents and
 * relies on `populated` seeding "exactly two slides to dot/prev/next through", so growing that
 * feed here would silently invalidate that flow's own assumption instead of adding a screen.
 */
export function writeNewsImagesFixture() {
  const userDataDir = variantUserDataDir('news-images')
  rmDirBestEffort(userDataDir)
  mkdirSync(userDataDir, { recursive: true })

  writeJson(join(userDataDir, STATE_FILE), emptyStateDocument())
  writeJson(join(userDataDir, WINDOW_STATE_FILE), windowStateDocument())
  writeNewsFeedCache(userDataDir, {
    slides: [newsImagePresentSlide(), newsImageFailedSlide()],
    retrievedAt: FIXED_TIMESTAMP,
    lastRefreshFailed: false,
  })
  writeNewsImageCacheFile(userDataDir)

  return { userDataDir, installations: 0, configProfiles: 0 }
}

// --- story 095 D3: the `cover` template's contrast probe ---------------------------------------
//
// AC2 is "the launcher's own scrim carries the contrast, not the contributed image". A probe that
// used one of the existing fixture PNGs (both dark: `split-bootstrap.png` is #2e2840) would pass
// whether or not the scrim does anything at all, so this variant seeds an image that is
// deliberately hostile instead: every pixel of it is at least `COVER_PROBE_MIN_CHANNEL`/255 bright,
// so ANY contrast measured behind the text can only have come from the scrim.
//
// The bytes are generated here rather than checked in, for two reasons: a 2560x640 near-white PNG
// is dead weight in git for a file only the harness ever reads, and generating it keeps the
// fixture's own "no `Date.now()`, byte-identical on every reseed" promise (`deflateSync` over the
// same raw bytes is deterministic). `sharp` - which `scripts/generate-news-images.mjs` uses for the
// checked-in content images - is async, and `scripts/seed.mjs` calls `writeFixture()` synchronously,
// so the encoder below is a minimal synchronous PNG writer instead (8-bit truecolour, one IDAT, no
// interlacing - the whole of what this one image needs).

/** The `cover` template's recommended source size (story 095 Decisions: 2560x640, 4:1). Exported so
 * the flow can assert the `<img>`'s natural size is really this, rather than trusting it. */
export const COVER_PROBE_IMAGE_WIDTH = 2560

export const COVER_PROBE_IMAGE_HEIGHT = 640

/** No pixel in the generated image is darker than this in any channel (0-255). The flow prints it
 * and re-proves it against the *rendered* pixels, where the image shows through past the scrim. */
export const COVER_PROBE_MIN_CHANNEL = 236

/** Faint marker bands (still near-white) every this many pixels, so a human looking at the flow's
 * screenshots can see which part of the source was cropped away. Never dark enough to carry
 * contrast: `COVER_PROBE_MIN_CHANNEL` is the band's own value. */
const COVER_PROBE_BAND_PERIOD_PX = 320

const COVER_PROBE_BAND_WIDTH_PX = 6

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1)
    c = (CRC32_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)) >>> 0
  return (c ^ 0xffffffff) >>> 0
}

/** One PNG chunk: length, type, data, CRC over type+data. */
function pngChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData), 0)
  return Buffer.concat([length, typeAndData, crc])
}

/** `rowFor(y)` returns that row's `width * 3` RGB bytes; filter byte 0 ("none") on every scanline. */
function encodeRgbPng(width, height, rowFor) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // colour type: truecolour RGB
  header[10] = 0 // deflate
  header[11] = 0 // adaptive filtering
  header[12] = 0 // no interlace

  const stride = width * 3 + 1
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0
    rowFor(y).copy(raw, y * stride + 1)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * The probe image itself: a near-white field brightening left-to-right from `COVER_PROBE_MIN_CHANNEL
 * + 10` to pure white, crossed by faint `COVER_PROBE_MIN_CHANNEL` marker bands both ways. The
 * left-to-right brightening is deliberate - the right-hand region is the part `cover` keeps visible
 * at every width, so the hardest pixels sit exactly where the scrim is thinnest.
 */
function coverProbeImageBytes() {
  const width = COVER_PROBE_IMAGE_WIDTH
  const height = COVER_PROBE_IMAGE_HEIGHT
  const base = COVER_PROBE_MIN_CHANNEL + 10
  const peak = 255

  const plainRow = Buffer.alloc(width * 3)
  for (let x = 0; x < width; x += 1) {
    const inBand = x % COVER_PROBE_BAND_PERIOD_PX < COVER_PROBE_BAND_WIDTH_PX
    const value = inBand
      ? COVER_PROBE_MIN_CHANNEL
      : base + Math.round(((peak - base) * x) / (width - 1))
    plainRow[x * 3] = value
    plainRow[x * 3 + 1] = value
    plainRow[x * 3 + 2] = value
  }
  const bandRow = Buffer.alloc(width * 3, COVER_PROBE_MIN_CHANNEL)

  return encodeRgbPng(width, height, (y) =>
    y % COVER_PROBE_BAND_PERIOD_PX < COVER_PROBE_BAND_WIDTH_PX ? bandRow : plainRow,
  )
}

/** Authoring path of the probe image, used only to derive the cache file name the way
 * `resolve-feed-images.ts` would - nothing ever fetches it. */
const COVER_PROBE_RELATIVE_PATH = 'img/cover-contrast-probe.png'

export const NEWS_COVER_SLIDE_ID = 'fixture-news-slide-cover'

/** The flow waits on this exact title rather than on "some slide rendered". */
export const NEWS_COVER_SLIDE_TITLE = 'Welcome To The Community'

/**
 * Exactly ONE slide, on purpose: with `count === 1` `NewsHero` renders no dots/prev/next and starts
 * no interval, so every measurement this variant exists for is taken on a hero that cannot rotate
 * out from under the screenshot. The hero's stage still reserves the control bar's 44px
 * (`.home-hero-stage`'s unconditional `inset: 0 0 var(--home-hero-controls-h) 0`), so the slide box
 * this fixture produces is the same one a multi-slide feed produces.
 *
 * Body and button labels are real prose of a realistic length: the body has to wrap across the full
 * width of the content pane, because AC2's probe reads the lightest pixel inside the *box* the text
 * may occupy, not only where glyphs happen to land today.
 */
function newsCoverSlide() {
  const fileName = newsImageFileName(newsImageSourceUrl(COVER_PROBE_RELATIVE_PATH), NEWS_IMAGE_EXT)
  return {
    id: NEWS_COVER_SLIDE_ID,
    template: 'cover',
    order: 1,
    title: NEWS_COVER_SLIDE_TITLE,
    body:
      'A cover slide puts its artwork behind the text instead of beside it, anchored to the right ' +
      'edge so the subject survives every window width. This body is deliberately long enough to ' +
      'wrap across the whole content pane, so the contrast probe measures the full box the text is ' +
      'allowed to occupy rather than only the pixels a shorter line happens to cover.',
    imageUrl: `q2launcher://app/news-image/${fileName}`,
    buttons: [
      { label: 'Read the announcement', url: 'https://github.com/Hantsch/q2_community_content' },
      { label: 'Browse the repository', url: 'https://github.com/Hantsch/q2-launcher' },
    ],
  }
}

/** Same genuine-cache-hit shape as `writeNewsImageCacheFile()`, but with generated bytes. */
function writeCoverProbeImageCacheFile(userDataDir) {
  const cacheDir = join(userDataDir, 'cache', 'news-images')
  mkdirSync(cacheDir, { recursive: true })
  const fileName = newsImageFileName(newsImageSourceUrl(COVER_PROBE_RELATIVE_PATH), NEWS_IMAGE_EXT)
  writeFileSync(join(cacheDir, fileName), coverProbeImageBytes())
}

/**
 * Deletes and rewrites the `news-cover` variant's userdata: no installations/profiles, a fresh feed
 * cache carrying the single `cover` slide above, and the generated near-white probe PNG its
 * `imageUrl` resolves to. Its own variant rather than a slide added to `news-images`, for the same
 * reason `news-images` is not an extension of `populated`: `scripts/flows/home-hero-carousel.mjs`
 * and the `home-hero-slide-image*` screens both document and rely on their variant's exact slide
 * count.
 */
export function writeNewsCoverFixture() {
  const userDataDir = variantUserDataDir('news-cover')
  rmDirBestEffort(userDataDir)
  mkdirSync(userDataDir, { recursive: true })

  writeJson(join(userDataDir, STATE_FILE), emptyStateDocument())
  writeJson(join(userDataDir, WINDOW_STATE_FILE), windowStateDocument())
  writeNewsFeedCache(userDataDir, {
    slides: [newsCoverSlide()],
    retrievedAt: FIXED_TIMESTAMP,
    lastRefreshFailed: false,
  })
  writeCoverProbeImageCacheFile(userDataDir)

  return { userDataDir, installations: 0, configProfiles: 0 }
}

/**
 * Story 083 D6: the `home-hero-stale` screen's fixture - an aged, already-failed feed cache and
 * nothing else (no installations/profiles are needed to show the hero). Reuses `emptyStateDocument()`
 * for `state.json` since this variant's only job is the hero; `NEWS_STALE_TIMESTAMP` is a full year
 * behind `FIXED_TIMESTAMP` so the "as of <date>" chip reads as visibly old, and
 * `lastRefreshFailed: true` is what routes `feedState()` to `'stale'` instead of `'filled'` - see
 * `writeNewsFeedCache()`'s own doc comment for why this is the one place that field is ever written.
 */
export function writeNewsStaleFixture() {
  const userDataDir = variantUserDataDir('news-stale')
  rmDirBestEffort(userDataDir)
  mkdirSync(userDataDir, { recursive: true })

  writeJson(join(userDataDir, STATE_FILE), emptyStateDocument())
  writeJson(join(userDataDir, WINDOW_STATE_FILE), windowStateDocument())
  writeNewsFeedCache(userDataDir, {
    slides: NEWS_FIXTURE_SLIDES,
    retrievedAt: NEWS_STALE_TIMESTAMP,
    lastRefreshFailed: true,
  })

  return { userDataDir, installations: 0, configProfiles: 0 }
}
