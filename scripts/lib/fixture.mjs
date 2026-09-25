// D2 — fixture seed data + writers for the UI-verification harness.
//
// `scripts/` is plain Node ESM outside both TS projects, so it cannot
// `import type`/`import` anything from `src/**/*.ts` at runtime. Instead, the
// small set of literal values this file needs are hardcoded below, each
// annotated with exactly the source file/constant it mirrors, so a future
// schema bump is easy to find via grep (search for "mirrors").
//
// Everything here is deterministic: fixed ids and fixed ISO timestamps, never
// `Date.now()`/`crypto.randomUUID()`. That is what makes `npm run ui:seed`
// idempotent — re-running it regenerates byte-identical files rather than
// merge-patching whatever is already on disk.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { assertInside, REPO_ROOT, UI_VERIFY_ROOT } from './paths.mjs'
import { variantUserDataDir } from './harness.mjs'
// Story 075 D7's two seeded `downloadFailures` entries. They live in their own module (which
// imports only the redaction mirror) so a unit test can assert the seeded record is exactly what
// the real `redactHome` produces, without dragging playwright in through this file.
import { populatedDownloadFailures } from './download-failures.mjs'

// --- literals mirrored from src/shared -------------------------------------

/** Mirrors src/shared/constants.ts:10 (`STATE_FILE`). */
const STATE_FILE = 'state.json'
/** Mirrors src/shared/constants.ts:11 (`WINDOW_STATE_FILE`). */
const WINDOW_STATE_FILE = 'window-state.json'
/** Deliberately kept one version behind the real `STATE_SCHEMA_VERSION`
 * (`src/shared/constants.ts`, currently `2`) rather than mirroring it - see the comment block
 * above `CONTROLS_SEED_SCHEMA_VERSION` below for why `populated`/`empty` need every reseed to run
 * story 052 D6's migration fresh. */
const STATE_SCHEMA_VERSION = 1

/** Mirrors src/shared/types/settings.ts:22-32 (`DEFAULT_SETTINGS`). */
const DEFAULT_SETTINGS = {
  locale: 'system',
  motion: 'system',
  activeInstallationId: null,
  lastRoute: '/home',
  minimizeOnLaunch: true,
  closeAfterLaunch: false,
  confirmBeforeRemoving: true,
  scanOnFirstRun: true,
  deepScanDrives: [],
}

/** Fixed instant used for every fixture timestamp — never `Date.now()` (idempotency). */
const FIXED_TIMESTAMP = '2026-01-01T00:00:00.000Z'

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
// (`src/main/modules/home/index.ts`, gated via `isUiHarnessEnabled()`), so this file is the ONLY
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
const NEWS_FIXTURE_SLIDES = [
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
function writeNewsFeedCache(userDataDir, { slides, retrievedAt, lastRefreshFailed = false, etags = {} }) {
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
const NEWS_IMAGE_SOURCE_FILE = join(REPO_ROOT, 'content', 'q2_community_content', 'news', 'img', 'split-bootstrap.png')
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
  for (let i = 0; i < buffer.length; i += 1) c = (CRC32_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)) >>> 0
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
    const value = inBand ? COVER_PROBE_MIN_CHANNEL : base + Math.round(((peak - base) * x) / (width - 1))
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

/** Root all fixture game directories live under: `.ui-verify/fixture/game/<install>/`. */
function gameRoot() {
  return join(UI_VERIFY_ROOT, 'fixture', 'game')
}

/**
 * Story 079 D3: the real on-disk path of installation `id`'s copy of a launcher-owned config file -
 * `<gameRoot>/<id>/baseq2/<fileName>`, the same `BASE_GAME_DIR` join `writer.ts`'s
 * `writeInstallationFiles` uses. Exported so a flow that writes/reads an installation's copy of a
 * config profile (`raw-save-cascades.mjs`, `external-edit-cascades.mjs`) builds the identical path
 * this module's own fixture writer would, instead of a second `join()` call that could drift from it.
 */
export function installationConfigFilePath(id, fileName) {
  return join(gameRoot(), id, 'baseq2', fileName)
}

/**
 * Story 092 D8: the real on-disk path of installation `id`'s copy of a file at `relativePath`
 * relative to its ROOT - not necessarily under `baseq2` (`installationConfigFilePath()` above is
 * `baseq2`-only). `engine-update.mjs` needs this for `q2pro64.exe`, which sits at the installation
 * root, alongside the `baseq2/...` engine files `installationConfigFilePath()` already reaches.
 * `relativePath` is always `/`-separated (mirrors `ENGINE_FIXTURE_FILES`' own keys), split here so
 * the join is correct on every platform.
 */
export function installationRootFilePath(id, relativePath) {
  return join(gameRoot(), id, ...relativePath.split('/'))
}

/**
 * Story 094 D4: the real on-disk root of installation `id` - the same join every
 * `populatedInstallations()` entry already builds inline for its own `rootPath`, exported here so
 * `scripts/flows/installation-remove-from-disk.mjs` can assert against the exact path the dialog
 * must show (AC2) without a second, hand-typed `join()` that could drift from the fixture's own.
 */
export function installationRootPath(id) {
  return join(gameRoot(), id)
}

// --- state.ts LauncherStateDocument ("defaults()") shape -------------------
// Mirrors src/main/services/state.ts:16-48 (`LauncherStateDocument`) and its
// `defaults()` (state.ts:50-60).

function emptyStateDocument() {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    // `scanOnFirstRun: false` overrides the default: with zero installations,
    // `useLauncher.bootstrap()` otherwise opens `DetectDialog` with
    // `autoStart: true`, which calls `detection:scan` on mount without
    // waiting for a click — exactly the real Steam/GOG/registry scan the
    // harness must never trigger (story 026 Decisions).
    settings: { ...DEFAULT_SETTINGS, scanOnFirstRun: false },
    installations: [],
    configProfiles: [],
    configPlayedMods: {},
    configPendingWrites: {},
    configSwitchBinds: {},
  }
}

// --- installation.ts Installation shape ------------------------------------
// Mirrors src/shared/types/installation.ts:68 (`Installation`).

function makeInstallation({
  id,
  name,
  rootPath,
  writeDirPath,
  favorite,
  sortOrder,
  gameDirs,
  engineKind,
  icon,
  status,
  checks,
  lastFailure,
  // Story 093 D7: an optional recorded `executablePath` - `undefined` for every caller that
  // predates this story (the hard-coded default below), so only the repair fixtures that need
  // `inspectInstallation` to compare a STALE recorded path against what it finds on disk
  // (`validation.executableMissing`) pass one.
  executablePath,
  // Story 087 D1: both default to the all-unplayed behavior every existing caller relies on, so
  // only a caller that passes them explicitly seeds a "filled" playtime/last-session state.
  lastPlayedAt,
  totalPlaytimeSeconds,
  // Story 092 D8: mirrors `icon`/`lastFailure`'s spread-only-when-present convention -
  // `Installation.moduleData` (`src/shared/types/installation.ts`). Only
  // `INSTALL_ENGINE_UPDATE_ID` below passes one (its recorded, out-of-date engine version, the
  // shape `readEngineState`/`writeEngineState` - `src/main/modules/downloads/engine/
  // installation-state.ts` - read/write under `moduleData['downloads']`); every other caller stays
  // `undefined`, exactly as before this story.
  moduleData,
  // Story 094 D4: an optional `InstallationSource` override, defaulting to the `'manual'` every
  // existing caller relied on before this story - only `INSTALL_REMOVE_STORE_ID` below passes
  // `'steam'`, so `isStoreManaged()` has a real store-managed fixture to gate on.
  source,
}) {
  return {
    id,
    name,
    rootPath,
    ...(writeDirPath ? { writeDirPath } : {}),
    // Story 065 D5: `engineKind` became a parameter (defaulting to the `r1q2` every caller
    // relied on before) purely so `INSTALL_UNKNOWN_ENGINE_ID` below can be a non-r1q2 install.
    engineKind: engineKind ?? 'r1q2',
    executablePath,
    launchArgs: [],
    activeGameDir: '',
    detectedVersion: undefined,
    source: source ?? 'manual',
    // Story 077 D5: `status`/`checks` became parameters (defaulting to the `ok`/`[]` every caller
    // relied on before) purely so `INSTALL_FAILED_ID` below can seed an honest `invalid` verdict -
    // the real app's own startup `validateAll()` re-derives both from the folder on disk anyway
    // (`main/index.ts`), so this only matters for a reader of the raw fixture `state.json` itself.
    status: status ?? 'ok',
    checks: checks ?? [],
    gameDirs: gameDirs ?? ['baseq2'],
    favorite,
    sortOrder,
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    lastValidatedAt: undefined,
    lastPlayedAt: lastPlayedAt ?? undefined,
    totalPlaytimeSeconds: totalPlaytimeSeconds ?? 0,
    ...(moduleData ? { moduleData } : { moduleData: undefined }),
    // Story 067 D5: mirrors src/shared/types/installation.ts's `InstallationIcon` -
    // `{ kind: 'shipped', id }` or `{ kind: 'custom' }`. Only set for the two installations
    // `populatedInstallations()` below wires up; every other caller (including
    // `controlsSeedStateDocument()`'s install) passes nothing and stays iconless.
    ...(icon ? { icon } : {}),
    // Story 077 D5: mirrors `icon`'s spread-only-when-present convention - `InstallationLastFailure`
    // (`src/shared/types/installation.ts`), `{ errorKey, at, jobId }`. Only `INSTALL_FAILED_ID` below
    // carries one; every other installation stays exactly as it rendered before this story (AC8).
    ...(lastFailure ? { lastFailure } : {}),
  }
}

// Story 079 D3: exported (were module-private before) so
// `scripts/flows/raw-save-cascades.mjs`/`scripts/flows/external-edit-cascades.mjs` can build the
// real on-disk `<gameRoot>/<id>/baseq2/<file>` path for each of Plain Profile's two assigned
// installations, rather than duplicating these literals.
export const INSTALL_ONE_ID = 'fixture-install-favorite'
export const INSTALL_TWO_ID = 'fixture-install-writedir'

/**
 * Story 067 D5: the shipped icon id `INSTALL_ONE_ID` is seeded with - one of the six basenames
 * under `src/renderer/src/assets/installations/` (`installation-icons.ts`'s `SHIPPED_ICONS`).
 * Exported so `scripts/flows/installation-icon-tile.mjs` asserts against the exact id the fixture
 * wrote rather than a copy that can drift.
 */
export const INSTALL_ONE_ICON_ID = 'gate'

/**
 * Story 067 D5: the smallest possible well-formed PNG - enough for `installations:iconDataUrl`
 * (D4) to read a real file back and for the rendered `<img>` to have a genuine `data:image/png;...`
 * source, without the fixture needing an image-encoding dependency.
 *
 * A single *opaque* pixel (RGB 255,90,31 - this app's own `flame` accent colour), not a
 * transparent one (review finding F5, story 067): a fully transparent pixel renders as an empty
 * box in every screenshot the D5/D6 flows take, which proves the plumbing (a real file is read and
 * delivered as a `data:` URL) but not that a real user image would actually be visible on the tile.
 */
const CUSTOM_ICON_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4HyUPAAPUAXnNtuHVAAAAAElFTkSuQmCC'

/**
 * Story 065 D5: a third populated installation whose only job is to make AC3 ("an `unknown`
 * engine still gets a labelled badge") and AC4 ("a long name truncates, the badge stays
 * visible") reachable in the real app at all - the two installs above are both `r1q2` with
 * short names, and `CreateInstallationDialog` needs a native folder dialog the harness cannot
 * drive, so there is no other way to get either case in front of a flow.
 *
 * Additive by design: every harness selector addresses an installation by its display label
 * (`scripts/lib/screens.mjs`'s `selectOption({ label: 'Fixture WriteDir Install' })`), never by
 * index or count, and this install is assigned to no config profile, so nothing that iterates
 * a profile's assignments (Files rows, `engineScope`, `RawFileTab`'s per-installation section)
 * gains a row either.
 */
const INSTALL_UNKNOWN_ENGINE_ID = 'fixture-install-unknown-long-name'

/**
 * 156 characters, exported so `scripts/flows/engine-badge-surfaces.mjs` selects on the exact
 * same literal the fixture wrote rather than a copy that can drift.
 *
 * The length is not decorative and is not "100+ because the story said so": AC4 is only proven
 * where the name element genuinely reports `scrollWidth > clientWidth`. The 320px assignments
 * popover clips anything past roughly 40 characters, but `InstallationProfilesPanel`'s row in
 * the config list is a `flex flex-wrap` box ~704px wide at the app's minimum window size, and a
 * ~100-character name measured exactly 704px there - it fitted, the badge simply wrapped to a
 * second line, and nothing truncated. This length clears that row's full width with margin, so
 * the long name truncates (rather than the row growing) on every surface the flow visits.
 */
export const INSTALL_UNKNOWN_ENGINE_NAME =
  'Fixture Unknown Engine Install With A Deliberately Very Long Display Name That Must Truncate Instead Of Pushing The Engine Badge Out Of Any Narrow Panel Row'

/** Story 042 D6: the second gamedir under `INSTALL_TWO_ID` that holds the own-file (launcher
 * "restore") fixture config, distinct from `baseq2`'s foreign-config fixture above. */
const RESTORE_GAME_DIR = 'q2l-restore-fixture'

/**
 * Story 077 D5: a fourth installation carrying a `lastFailure` - a bootstrap job that failed and,
 * per that story's own decision, left its registration behind instead of deleting it. Its own doc
 * comment on `populatedInstallations()`'s fourth entry below explains the additive rule this
 * follows; see that entry for what it proves and why its own doc comment (not this one) is where
 * the reasoning belongs.
 */
const INSTALL_FAILED_ID = 'fixture-install-failed'

/**
 * The i18n key `INSTALL_FAILED_ID` carries as its `lastFailure.errorKey` - a real, existing key
 * from `src/renderer/src/i18n/locales/en.json` ("Every download source failed. Check your
 * connection and try again."), not an invented one. Exported so both the seeded fixture row and
 * `scripts/flows/bootstrap-failure-retry.mjs` (whose own 404-both-URLs fixture-server option
 * produces this exact key via `fetcher.ts`'s `allMirrorsFailed` exit) can assert against the same
 * literal rather than two copies that could drift apart.
 */
export const INSTALL_FAILED_ERROR_KEY = 'downloads.error.allMirrorsFailed'

/**
 * Story 090 D6: a fifth installation - `scripts/flows/retail-upgrade.mjs`'s own demo installation,
 * real files on disk (never a hand-set status/checks): a demo-sized `pak0.pak` so
 * `inspectInstallation` derives `validation.pak0NotRetail` for real (`isDemoData`,
 * `src/renderer/src/lib/demo-data.ts`), an `r1q2.exe` marker so `classifyEngine`/`rankExecutables`
 * find both a known engine and a real executable (keeping every OTHER check clean, so this
 * installation's status is a plain `ok` before the upgrade rather than `invalid` for unrelated
 * reasons), and a marker file elsewhere in `baseq2` the upgrade must never touch (AC4). Additive,
 * the same convention `INSTALL_UNKNOWN_ENGINE_ID`/`INSTALL_FAILED_ID` document above: `sortOrder: 4`
 * puts it last, and it is assigned to no config profile.
 */
export const INSTALL_DEMO_UPGRADE_ID = 'fixture-install-demo-upgrade'
export const INSTALL_DEMO_UPGRADE_NAME = 'Fixture Demo Upgrade Install'

/** A file inside `baseq2`, deliberately not one of `UPGRADE_PAK_NAMES` (`pak0.pak`/`pak1.pak`,
 * `src/main/modules/downloads/retail/upgrade-job.ts`) - the retail-upgrade flow's on-disk proof
 * that the job touches only the two paks it is allowed to (AC4). */
export const RETAIL_UPGRADE_MARKER_FILE = 'q2l-fixture-marker.cfg'
const RETAIL_UPGRADE_MARKER_CONTENT =
  '// q2launcher fixture marker - must survive the retail upgrade untouched\n'

/**
 * Story 092 D8: a sixth installation - `scripts/flows/engine-update.mjs`'s own already-registered,
 * already-playable Q2PRO installation, seeded directly with a recorded engine version older than
 * the fixture manifest's own pin (`buildBootstrapPackages()`'s engine package, `version: 'fixture-1'`
 * - see `startBootstrapFixtureServer()` below) so `engine.updateStatus` reports `updateAvailable:
 * true` from the very first render, no bootstrap wizard run needed (Decisions (Sprint): "seeds an
 * out-of-date installation into the fixture ... instead of bootstrapping one first"). Additive, the
 * same convention `INSTALL_DEMO_UPGRADE_ID` documents just above: `sortOrder: 5` puts it last, and
 * it is assigned to no config profile.
 *
 * `moduleData` records the OLD version directly (`ENGINE_UPDATE_OLD_VERSION`) - the exact shape
 * `readEngineState()` (`src/main/modules/downloads/engine/installation-state.ts`) reads back under
 * `moduleData['downloads']`. Retail-sized `pak0.pak`/`pak1.pak`/`pak2.pak` (truncated, never real
 * bytes - the same trick `writeRetailSourceTree()` uses below) keep `inspectInstallation` reporting a
 * plain `ok` status with no demo-data check, so this installation reads as an ordinary, already-
 * working install rather than a demo one.
 */
export const INSTALL_ENGINE_UPDATE_ID = 'fixture-install-engine-update'
export const INSTALL_ENGINE_UPDATE_NAME = 'Fixture Engine Update Install'

/** The recorded "current" engine version this installation starts on - older than the fixture
 * manifest's own pin (`'fixture-1'`), so an update is available without any network comparison. */
export const ENGINE_UPDATE_OLD_VERSION = 'fixture-engine-old'

/**
 * Every `role: 'engine'` file `buildBootstrapPackages()`'s Q2PRO package carries, by its own
 * ARCHIVE-relative path (mirrors `BOOTSTRAP_FIXTURE_LAYOUT.engine` above - what the allowlist's
 * `from` candidates find in the extracted staging tree) - `sizeBytes`/`fillByte` are the exact bytes
 * the REAL fixture archive extracts onto these paths, so `engine-update.mjs` can assert the on-disk
 * result of a real update against the same literals the archive itself is built from, rather than a
 * second guess that could drift. Exported so `buildBootstrapPackages()` below and the flow's own
 * assertions share one definition.
 */
export const ENGINE_FIXTURE_FILES = {
  'q2pro64.exe': { sizeBytes: 96 * 1024, fillByte: 0x4d },
  'baseq2/gamex86_64.dll': { sizeBytes: 32 * 1024, fillByte: 0x44 },
  'baseq2/q2pro.menu': { sizeBytes: 512, fillByte: 0x4e },
}

/**
 * Where each `ENGINE_FIXTURE_FILES` archive path actually lands ONCE INSTALLED - `assemble.ts`'s
 * `buildQ2proEngineEntries()` renames the executable candidate it found (`q2pro.exe`/`q2pro64.exe`)
 * to `ENGINE_DEFINITIONS`'s own canonical name for Q2PRO (`q2pro.executables[0]`, `'q2pro.exe'`) -
 * the other two files keep their archive spelling. `update-job.ts`'s `engineAllowlistFor()` walks
 * that SAME allowlist, so this is also the spelling the update job looks for on an existing
 * installation and the spelling its backup slot files land under - a fixture installation whose
 * on-disk executable were still called `q2pro64.exe` would never be found or backed up at all.
 */
export const ENGINE_INSTALLED_RELATIVE = {
  'q2pro64.exe': 'q2pro.exe',
  'baseq2/gamex86_64.dll': 'baseq2/gamex86_64.dll',
  'baseq2/q2pro.menu': 'baseq2/q2pro.menu',
}

/** The fill byte this installation's engine files start on - distinct from every fill byte in
 * `ENGINE_FIXTURE_FILES` above, so a byte-for-byte read of any of the three files unambiguously
 * tells "still the old build" apart from "the update/rollback already touched this file". */
export const ENGINE_UPDATE_OLD_FILL_BYTE = 0x30

// --- story 093 D7: five additive repair-flow installations (the sixth, demo-pak0/AC3, reuses
// `INSTALL_DEMO_UPGRADE_ID` above verbatim rather than duplicating it) ---------------------------
//
// `scripts/flows/repair.mjs` needs each fixture's finding to be reachable through a REAL trigger
// (the action bar's primary button, gated on `isPlayable(installation.status)`, or the checks
// list's own `fix: 'install-game-files'` button) - not just present in `installation.checks`. Two
// real constraints from `src/main/services/inspector.ts`/`src/renderer/src/lib/status.ts` shaped
// every one of these:
//
//   1. `isPlayable()` treats `warning` (and `ok`) as playable, so the action bar only ever shows
//      Repair for a `status: 'invalid'` (an `error`-severity check) or `'missing'` installation. A
//      warn/info-only finding (`executableMissing`, `pointReleaseMissing`, `pak0NotRetail`,
//      `retailPaksMissing`, `notWritable`) is real and repairable, but reaches the dialog only
//      through the checks list - never the action bar.
//   2. `classifyEngine()` only recognises r1q2/q2pro by one of THEIR OWN executable file names
//      being present at the root - so once every such file is gone, a fresh inspection reports
//      `engineKind: 'unknown'` and raises `validation.noExecutable` (error). `buildRepairPlan`'s
//      `reinstall-engine` gate (`src/main/modules/downloads/repair/plan.ts`) asks the manifest about
//      the installation's *recorded* `engineKind`, not that fresh one, so `noExecutable` and "the
//      manifest can supply this installation's engine" CAN co-occur in the real app (see
//      `plan.test.ts`'s "gates reinstall-engine on the recorded engine kind..."). This flow doesn't
//      build that exact fixture, though: AC1 here is built as `validation.executableMissing` (a
//      STALE recorded `executablePath` next to a DIFFERENT, still-present engine file -
//      `r1q2ded.exe`, which is both an r1q2 marker and, being the only `.exe` on disk, the fallback
//      executable, so the fresh and recorded engine kind stay equal) - paired with an empty `baseq2`
//      (`pak0Missing`, error) purely so the installation's overall status is `invalid` and the action
//      bar's Repair button exists to click at all. Both offers (`reinstall-engine` and `retail-copy`)
//      end up on the same plan; the flow only ever drives the one each AC is about.

export const INSTALL_REPAIR_ENGINE_ID = 'fixture-install-repair-engine'
export const INSTALL_REPAIR_ENGINE_NAME = 'Fixture Repair Engine Install'

export const INSTALL_REPAIR_POINT_RELEASE_ID = 'fixture-install-repair-point-release'
export const INSTALL_REPAIR_POINT_RELEASE_NAME = 'Fixture Repair Point Release Install'

export const INSTALL_REPAIR_RETAIL_ID = 'fixture-install-repair-retail'
export const INSTALL_REPAIR_RETAIL_NAME = 'Fixture Repair Retail Install'

export const INSTALL_REPAIR_WRITEDIR_ID = 'fixture-install-repair-writedir'
export const INSTALL_REPAIR_WRITEDIR_NAME = 'Fixture Repair WriteDir Install'

export const INSTALL_REPAIR_UNREPAIRABLE_ID = 'fixture-install-repair-unrepairable'
export const INSTALL_REPAIR_UNREPAIRABLE_NAME = 'Fixture Repair Unrepairable Install'

/**
 * A real, never-created path under the machine's genuine `%ProgramFiles%` - the same "a real
 * unelevated Program Files path is not writable by this test's own user account" fact
 * `bootstrapProgramFilesProbePath()` documents and `bootstrap-wizard.mjs` relies on, applied here
 * as an installation's *recorded* `writeDirPath` rather than a wizard target. Deliberately never
 * created (unlike a real write-dir): `isWritableDir()` (`src/main/lib/fs-utils.ts`) is a plain
 * `fs.access(target, W_OK)` that fails closed on a non-existent path exactly as it does on a
 * genuinely locked-down one, so this is deterministic on every machine this flow runs on -
 * elevated or not - rather than depending on this specific process's own Program Files ACLs.
 */
export function repairNonWritableDir() {
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
  return join(programFiles, 'Q2 Launcher UI Verify Fixture Repair', 'writedir')
}

// --- story 094 D4: two additive installations for `installation-remove-from-disk.mjs` -----------
//
// `INSTALL_REMOVE_STORE_ID` is a plain, playable `source: 'steam'` installation - store-managed
// (`isStoreManaged`), so its remove dialog only ever offers entry-only removal plus the store note
// (AC4). `INSTALL_REMOVE_DISK_ID` is a plain, playable `source: 'manual'` installation - the one the
// flow actually deletes from disk (AC1-AC3, AC5/AC6), reused for the running-game refusal check
// (`dev:simulateLaunch`) before the flow restores `idle` and proceeds with the real deletion, per
// this deliverable's own plan (simpler than a third fixture). Both mirror the simplest existing
// entry (`INSTALL_ONE_ID`'s shape, minus the icon/playtime specifics) and are additive: last
// `sortOrder`s, assigned to no config profile, the same convention every fixture since 090 documents.

export const INSTALL_REMOVE_STORE_ID = 'fixture-install-remove-store'
export const INSTALL_REMOVE_STORE_NAME = 'Fixture Remove Store Install'

export const INSTALL_REMOVE_DISK_ID = 'fixture-install-remove-disk'
export const INSTALL_REMOVE_DISK_NAME = 'Fixture Remove Disk Install'

/**
 * A sentinel file in a directory that sits NEXT TO (not inside) `INSTALL_REMOVE_DISK_ID`'s own
 * `rootPath` - `writePopulatedFixture()` writes it below, and
 * `scripts/flows/installation-remove-from-disk.mjs` reads it back after deleting that
 * installation's folder to prove AC3's "nothing outside that folder is touched": a plain sibling
 * directory, not a subfolder, so a mis-scoped `fs.rm` that walked one level too far would still be
 * caught.
 */
export function installRemoveDiskSiblingSentinelPath() {
  return join(gameRoot(), `${INSTALL_REMOVE_DISK_ID}-sibling`, 'sentinel.txt')
}
export const INSTALL_REMOVE_DISK_SIBLING_SENTINEL_CONTENT =
  '// q2launcher fixture sentinel - must survive installation-remove-from-disk untouched\n'

function populatedInstallations() {
  return [
    makeInstallation({
      id: INSTALL_ONE_ID,
      name: 'Fixture Favorite Install',
      rootPath: join(gameRoot(), INSTALL_ONE_ID),
      favorite: true,
      sortOrder: 0,
      // Story 067 D5: a shipped icon, resolved by `useInstallationIcon` synchronously (no IPC) -
      // see `INSTALL_ONE_ICON_ID` for why `gate` specifically.
      icon: { kind: 'shipped', id: INSTALL_ONE_ICON_ID },
      // Story 087 D1: the one installation seeded with real playtime, so the library stats' new
      // `lastSession` and the existing playtime tile both show a "filled" state rather than every
      // fixture install reading as never-played. `FIXED_TIMESTAMP` (also `createdAt`/`updatedAt`
      // above) keeps this reproducible across `ui:verify` runs - never `Date.now()`.
      lastPlayedAt: FIXED_TIMESTAMP,
      totalPlaytimeSeconds: 13500, // 3h 45m
    }),
    makeInstallation({
      id: INSTALL_TWO_ID,
      name: 'Fixture WriteDir Install',
      rootPath: join(gameRoot(), INSTALL_TWO_ID),
      writeDirPath: join(gameRoot(), INSTALL_TWO_ID, 'writedir'),
      favorite: false,
      sortOrder: 1,
      // Story 067 D5: a custom icon - `writeCustomIconFile()` below writes the matching PNG into
      // this variant's userData at `installation-icons/<INSTALL_TWO_ID>.png`, which
      // `installations:iconDataUrl` (D4) reads back. `INSTALL_UNKNOWN_ENGINE_ID` below stays
      // iconless on purpose, so the fixture also proves the code-tile fallback still renders.
      icon: { kind: 'custom' },
      // Story 042 D6: a second gamedir, `RESTORE_GAME_DIR`, holding a launcher-written
      // (own-file) fixture config alongside the plain `baseq2` foreign-config one - `baseq2`
      // always sorts first (decision 12), so this is additive and does not change what
      // `config-import-preview`/`config-import-review` auto-select.
      gameDirs: ['baseq2', RESTORE_GAME_DIR],
    }),
    // Story 065 D5 - see `INSTALL_UNKNOWN_ENGINE_ID`/`INSTALL_UNKNOWN_ENGINE_NAME` above.
    // `sortOrder: 2` puts it last in the rail/library order, so the two installs the existing
    // screens and flows already reach stay exactly where they were.
    makeInstallation({
      id: INSTALL_UNKNOWN_ENGINE_ID,
      name: INSTALL_UNKNOWN_ENGINE_NAME,
      rootPath: join(gameRoot(), INSTALL_UNKNOWN_ENGINE_ID),
      engineKind: 'unknown',
      favorite: false,
      sortOrder: 2,
    }),
    // Story 077 D5 - see `INSTALL_FAILED_ID`/`INSTALL_FAILED_ERROR_KEY` above. ADDITIVE, following
    // the same convention `INSTALL_UNKNOWN_ENGINE_ID` documents just above: `sortOrder: 3` puts it
    // last, after every installation already in this array, and it is assigned to no config
    // profile, so nothing that iterates a profile's assignments gains a row either. Nothing about
    // the three installations above changes.
    //
    // This is what proves AC1's "after an app restart" e2e half (`npm run ui:verify
    // --screens=library`): a `state.json` written with a `lastFailure` already on it, the app
    // boots from THAT file (never clicking through a wizard), and the library still shows the
    // badge, the translated reason and a disabled Play button - and AC8, since the three
    // installations above render exactly as they did before this story alongside it. The real
    // failing *run* (create -> fail -> retry -> succeed) is proven separately, by
    // `scripts/flows/bootstrap-failure-retry.mjs` against a FRESH installation that flow creates
    // itself - this row is deliberately not reused for that, since AC1's restart proof needs a
    // failure that was never observed live by this session, only read back from disk.
    makeInstallation({
      id: INSTALL_FAILED_ID,
      name: 'Fixture Failed Install',
      rootPath: join(gameRoot(), INSTALL_FAILED_ID),
      engineKind: 'q2pro',
      favorite: false,
      sortOrder: 3,
      // `writePopulatedFixture()` below gives this installation's root folder no `baseq2` at all -
      // the same shape `bootstrap/job.ts`'s failure cleanup leaves behind (D2's `removeAssembled`
      // `rmdir`s an emptied `baseq2` away once the target root itself stays) - so `status: 'invalid'`
      // here matches what the real app's own startup `validateAll()` will re-derive from that folder
      // a moment later, rather than disagreeing with it for one render.
      status: 'invalid',
      gameDirs: [],
      lastFailure: {
        errorKey: INSTALL_FAILED_ERROR_KEY,
        at: Date.parse(FIXED_TIMESTAMP),
        jobId: 'fixture-bootstrap-job-failed',
      },
    }),
    // Story 090 D6 - see INSTALL_DEMO_UPGRADE_ID above. `checks` is seeded here to mirror exactly
    // what a live `inspectInstallation()` produces for the real, on-disk demo-sized `pak0.pak`
    // `writePopulatedFixture()` writes below (`validation.pak0NotRetail`, info severity -
    // `src/main/services/inspector.ts`) - NOT left to the real app's own startup `validateAll()` to
    // derive, unlike `INSTALL_FAILED_ID` above. That startup revalidation is asynchronous
    // (`did-finish-load`), and this flow's very first assertion (AC1's trigger visibility) cannot
    // race it: `isDemoData()` reads `installation.checks` straight from whatever `state.json` seeded,
    // and a flow that only clicked through the UI fast enough would otherwise see `checks: []` and
    // no trigger at all, depending on timing this repo's harness does not guarantee. Seeding the
    // pre-derived value here is the same trick `status: 'invalid'` uses for `INSTALL_FAILED_ID`
    // above, just applied to `checks` too because this story's very first assertion needs it, not
    // only its status dot.
    makeInstallation({
      id: INSTALL_DEMO_UPGRADE_ID,
      name: INSTALL_DEMO_UPGRADE_NAME,
      rootPath: join(gameRoot(), INSTALL_DEMO_UPGRADE_ID),
      engineKind: 'r1q2',
      // Story 093 D1 (already done): the real inspector now puts `fix: 'install-game-files'` on
      // this message key too - mirrored here so this hand-seeded array matches what a live
      // `inspectInstallation()` produces, which is what `scripts/flows/repair.mjs` (093 D7) needs
      // for its own demo-pak0 (AC3) case: the checks list's fix button only appears when `fix` is
      // present.
      checks: [
        {
          id: 'base-paks',
          severity: 'info',
          messageKey: 'validation.pak0NotRetail',
          fix: 'install-game-files',
        },
      ],
      favorite: false,
      sortOrder: 4,
    }),
    // Story 092 D8 - see INSTALL_ENGINE_UPDATE_ID above.
    makeInstallation({
      id: INSTALL_ENGINE_UPDATE_ID,
      name: INSTALL_ENGINE_UPDATE_NAME,
      rootPath: join(gameRoot(), INSTALL_ENGINE_UPDATE_ID),
      engineKind: 'q2pro',
      favorite: false,
      sortOrder: 5,
      moduleData: { downloads: { version: ENGINE_UPDATE_OLD_VERSION } },
    }),
    // Story 093 D7 - see the block comment above `INSTALL_REPAIR_ENGINE_ID` for why this finding
    // is `executableMissing` (a stale recorded `executablePath`), not `noExecutable`.
    //
    // `status`/`checks` are seeded directly, byte-for-byte what a live `inspectInstallation()`
    // produces for the real files `writePopulatedFixture()` writes below (measured, not guessed -
    // the same `installations:validate` call this flow itself could make) - not left for the app's
    // own startup `validateAll()` to derive: that revalidation is asynchronous
    // (`did-finish-load`), and was measured to still be unfinished 8s into a fresh launch with
    // eleven installations to re-check, which every one of `scripts/flows/repair.mjs`'s assertions
    // would otherwise race. The same trick `INSTALL_FAILED_ID`/`INSTALL_DEMO_UPGRADE_ID` already use.
    makeInstallation({
      id: INSTALL_REPAIR_ENGINE_ID,
      name: INSTALL_REPAIR_ENGINE_NAME,
      rootPath: join(gameRoot(), INSTALL_REPAIR_ENGINE_ID),
      engineKind: 'r1q2',
      executablePath: join(gameRoot(), INSTALL_REPAIR_ENGINE_ID, 'r1q2.exe'),
      status: 'invalid',
      checks: [
        { id: 'base-paks', severity: 'error', messageKey: 'validation.pak0Missing', fix: 'install-game-files' },
        {
          id: 'executable',
          severity: 'warn',
          messageKey: 'validation.executableMissing',
          params: { path: join(gameRoot(), INSTALL_REPAIR_ENGINE_ID, 'r1q2.exe') },
          fix: 'select-executable',
        },
      ],
      favorite: false,
      sortOrder: 6,
    }),
    // `validation.pointReleaseMissing` (warn) - reachable only via the checks list's own
    // `install-game-files` fix button, per this block's constraint 1 above.
    makeInstallation({
      id: INSTALL_REPAIR_POINT_RELEASE_ID,
      name: INSTALL_REPAIR_POINT_RELEASE_NAME,
      rootPath: join(gameRoot(), INSTALL_REPAIR_POINT_RELEASE_ID),
      engineKind: 'r1q2',
      status: 'warning',
      checks: [
        {
          id: 'base-paks',
          severity: 'warn',
          messageKey: 'validation.pointReleaseMissing',
          fix: 'install-game-files',
        },
      ],
      favorite: false,
      sortOrder: 7,
    }),
    // `validation.pak0Missing` (error, empty `baseq2`) - `status: 'invalid'`, reachable via both
    // the action bar and the checks list.
    makeInstallation({
      id: INSTALL_REPAIR_RETAIL_ID,
      name: INSTALL_REPAIR_RETAIL_NAME,
      rootPath: join(gameRoot(), INSTALL_REPAIR_RETAIL_ID),
      engineKind: 'r1q2',
      status: 'invalid',
      checks: [
        { id: 'base-paks', severity: 'error', messageKey: 'validation.pak0Missing', fix: 'install-game-files' },
      ],
      favorite: false,
      sortOrder: 8,
    }),
    // `validation.pak0Missing` (error, same as above, so the action bar reaches it) PLUS
    // `validation.notWritable` (warn, `writeDirPath` pointed at a real, never-created Program
    // Files path - see `repairNonWritableDir()`) - the plan carries both `retail-copy` and
    // `set-write-dir` offers; this flow only asserts the latter is present (AC5).
    makeInstallation({
      id: INSTALL_REPAIR_WRITEDIR_ID,
      name: INSTALL_REPAIR_WRITEDIR_NAME,
      rootPath: join(gameRoot(), INSTALL_REPAIR_WRITEDIR_ID),
      writeDirPath: repairNonWritableDir(),
      engineKind: 'r1q2',
      status: 'invalid',
      checks: [
        { id: 'base-paks', severity: 'error', messageKey: 'validation.pak0Missing', fix: 'install-game-files' },
        {
          id: 'write-access',
          severity: 'warn',
          messageKey: 'validation.notWritable',
          params: { path: repairNonWritableDir() },
          fix: 'set-write-dir',
        },
      ],
      favorite: false,
      sortOrder: 9,
    }),
    // `validation.noExecutable` (error) with an otherwise fully-valid, fully-retail `baseq2` and no
    // engine marker anywhere - `engineKind` inspects fresh as `'unknown'` (which also raises its own
    // `validation.engineUnknown`, warn). The *recorded* `engineKind` below is `'unknown'` too, not a
    // once-known one: `InstallationsService`'s ordinary revalidation (`installations.ts`'s
    // `preserveKnownEngine` guard, scoped to `lastFailure`) overwrites the record with exactly this
    // fresh verdict the moment every engine marker disappears from an otherwise-healthy install, so
    // this is what the record genuinely becomes, not a fixture shortcut. `canSupplyEngine('unknown')`
    // is false (no manifest package is ever keyed by `'unknown'`), so `buildRepairPlan` offers
    // nothing for either finding (AC6). Recorded and fresh are both `'unknown'` here, so this
    // fixture passes under either gate - it is `plan.test.ts`'s
    // "gates reinstall-engine on the recorded engine kind..." that actually guards against a
    // regression back to the fresh-kind gate, not this fixture.
    makeInstallation({
      id: INSTALL_REPAIR_UNREPAIRABLE_ID,
      name: INSTALL_REPAIR_UNREPAIRABLE_NAME,
      rootPath: join(gameRoot(), INSTALL_REPAIR_UNREPAIRABLE_ID),
      engineKind: 'unknown',
      status: 'invalid',
      checks: [
        { id: 'engine-identified', severity: 'warn', messageKey: 'validation.engineUnknown', fix: 'select-executable' },
        { id: 'executable', severity: 'error', messageKey: 'validation.noExecutable', fix: 'select-executable' },
      ],
      favorite: false,
      sortOrder: 10,
    }),
    // Story 094 D4 - see the block comment above `INSTALL_REMOVE_STORE_ID` for why these two exist.
    makeInstallation({
      id: INSTALL_REMOVE_STORE_ID,
      name: INSTALL_REMOVE_STORE_NAME,
      rootPath: join(gameRoot(), INSTALL_REMOVE_STORE_ID),
      source: 'steam',
      favorite: false,
      sortOrder: 11,
    }),
    makeInstallation({
      id: INSTALL_REMOVE_DISK_ID,
      name: INSTALL_REMOVE_DISK_NAME,
      rootPath: join(gameRoot(), INSTALL_REMOVE_DISK_ID),
      favorite: false,
      sortOrder: 12,
    }),
  ]
}

// --- config.ts ConfigProfile shape ------------------------------------------
// Mirrors src/shared/modules/config.ts:181 (`ConfigProfile`), `:45`
// (`ProfileAssignment`) and `:56` (`UnrecognizedConfigLine`).
// AltLayer mirrors src/shared/config/alt-layers.ts:55 (`AltLayer`).
//
// Story 038 D4: `plain.actions` below (+ its `binds` mirror) makes the
// writer's dead-alias-line fix (`src/shared/config/alias-references.ts`)
// visible on the `config-raw`/`config-write-preview` screens. This file
// cannot import `aliasNameFor`/`bindValueFor` (plain Node ESM outside both TS
// projects - see the file doc comment), so `binds.q` below is that
// algorithm's output hand-computed for action 2 and must stay in lockstep
// with it if either changes: `q2l_a_` + `slugAliasName('Weapon Combo', 14)`
// (`weapon_combo`) + `_` + the action id's first 4 alnum chars (`fixt`).

function populatedConfigProfiles() {
  const plain = {
    id: 'fixture-profile-plain',
    name: 'Plain Profile',
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    // Story 047 D2: `r` is a `$r`-style colour cvar (mirrors
    // src/shared/config/color-cvars.ts:33 `isColorCvar` - every byte is 0x7f
    // or 0x80-0xff) so the message editor's colour-cvar badge has a real
    // token to resolve for the two message actions below.
    //
    // Story 059 D10: `q2l_fixture_note` is a name `ALL_CVARS` (src/shared/config/cvar-catalog.ts)
    // does not know - it exists purely so the Settings tab has a real `PlainCvarRow` to show
    // (D7's "the catalogue does not know this name" row), placed into `PLAIN_FIXTURE_SECTION_ID`
    // below alongside a real catalogue cvar so the `config-settings` screen's screenshot shows a
    // user-named section header with both kinds of row under it, not just one.
    cvars: {
      sensitivity: '3',
      crosshair: '0',
      r: '\x7f\x88\x88\x7f',
      q2l_fixture_note: 'shown in raw file',
    },
    // Story 059 D10: a real, user-named `ConfigCvarSection` (mirrors `ConfigCvarSection`,
    // src/shared/modules/config.ts) - this profile's `cvarSections` predates D1, so without this
    // the migration (`materialiseCvarSections`, src/main/services/migrations.ts D6) would seed the
    // four template group sections instead and there would be no *user-named* section anywhere in
    // the populated fixture, which is exactly what D10's `config-settings` screen and the
    // `settings-section-rename-add-cvar` flow both need to show/rename. Holds one real catalogue
    // cvar (`sensitivity`) alongside the plain one above, so the section's own row list already
    // demonstrates both a rich `CvarRow` and a `PlainCvarRow` line up together (AC3).
    cvarSections: [
      {
        id: 'fixture-section-custom',
        name: 'Fixture Section',
        cvars: ['sensitivity', 'q2l_fixture_note'],
      },
    ],
    binds: {
      MOUSE1: '+attack',
      SPACE: '+moveup',
      // Mirrors action 2 ("weapons") below - a multi-command action's mirror
      // is always its alias name, never a bare command (`bindValueFor`).
      q: 'q2l_a_weapon_combo_fixt',
    },
    // Story 079 D3: also assigned to `INSTALL_TWO_ID` (not its default there - `withLayers` below
    // keeps that role), so `scripts/flows/raw-save-cascades.mjs` and
    // `scripts/flows/external-edit-cascades.mjs` have a second real installation to prove "every
    // assigned installation" against, not just the one every other Plain Profile flow already reads.
    assignments: [
      { installationId: INSTALL_ONE_ID, isDefault: true },
      { installationId: INSTALL_TWO_ID, isDefault: false },
    ],
    // Actions 1-3 exercise the writer's three alias-line outcomes
    // (`actionsWithAliasLine`, `src/shared/config/alias-references.ts`);
    // actions 4-5 (story 047 D2) give the message editor something to show.
    actions: [
      // 1. Catalogue row whose single command is a bare `+attack` (story
      //    034/038's own case): `bindValueFor` returns the command itself,
      //    not the alias, so `binds.MOUSE1` above already carries `+attack`
      //    directly and nothing calls `q2l_a_attack_*` by name. Its alias
      //    line must be entirely absent from the rendered file (AC1).
      {
        id: 'fixture-action-attack',
        categoryId: 'movement',
        name: 'Attack',
        kind: 'bind',
        catalogId: 'movement:attack',
        commands: [{ kind: 'raw', text: '+attack' }],
        key: 'MOUSE1',
      },
      // 2. Free-form, two-command "weapons" row bound on `q`: more than one
      //    command means `bindValueFor` falls back to the alias name, so
      //    `binds.q` above names it and its `alias q2l_a_weapon_combo_fixt …`
      //    line must survive (AC2).
      {
        id: 'fixture-action-weapons',
        categoryId: 'weapons',
        name: 'Weapon Combo',
        kind: 'bind',
        commands: [
          { kind: 'raw', text: 'use shotgun' },
          { kind: 'raw', text: 'use super shotgun' },
        ],
        key: 'q',
      },
      // 3. Keyless, unreferenced action (the User decision): kept regardless
      //    - user-authored content the user may be about to bind, unlike the
      //    catalogue-mirror case above. No `key`, so no `binds` entry.
      {
        id: 'fixture-action-keyless',
        categoryId: 'weapons',
        name: 'Keyless Combo',
        kind: 'bind',
        commands: [
          { kind: 'raw', text: 'wait' },
          { kind: 'raw', text: '+attack' },
        ],
      },
      // 4. Story 047 D2: a `drops` catalogue row with a message command, so
      //    the drop-row "Edit message" path (`ControlsTab.tsx:701`) and the
      //    message editor's `$r` colour-cvar badge both have something real
      //    to show. `catalogId`/`commands` mirror what `applyMessage`
      //    (src/renderer/src/modules/config/lib/catalog-binds.ts:309) would
      //    write for the `railgun` droppable (`dropWeapon:railgun`,
      //    `action-catalog.ts`'s `DROPPABLES`/`catalog-rows.ts`'s
      //    `makeCatalogId`): the row's own raw `drop <item>` command, plus a
      //    trailing `{ kind: 'message' }` command whose text references the
      //    `r` colour cvar above via `$r`.
      {
        id: 'fixture-action-drop-message',
        categoryId: 'drops',
        name: 'Railgun',
        kind: 'bind',
        catalogId: 'dropWeapon:railgun',
        commands: [
          { kind: 'raw', text: 'drop railgun' },
          { kind: 'message', channel: 'say', text: 'Dropped railgun $r' },
        ],
      },
      // 5. Story 047 D2: a free-form `kind: 'message'` action (no
      //    `catalogId`) for the Team-messages path (`ControlsTab.tsx:1237`,
      //    `editingAction.kind === 'message'`) - a named chat message kept on
      //    a `say_team` channel, distinct from the drops row above which is
      //    catalogue-backed and uses `say`.
      {
        id: 'fixture-action-team-message',
        categoryId: 'weapons',
        name: 'Team Update',
        kind: 'message',
        commands: [{ kind: 'message', channel: 'say_team', text: 'Need ammo $r' }],
      },
      // 6. Story 056 D5: a free-form, three-key action ("Multi Bind") so the extra-keys group
      //    (folded "+2" chevron, indented sub-rows) has a real row to render against - AC 6's
      //    "hand-added third key" is now editable/clearable in Controls itself, not only in Care.
      //    `categoryId: 'movement'` puts it in the rail's default first category (mirrors action 1)
      //    so the new `config-controls-extra-keys-*` screens below need no category-chip click.
      //    `keys` (not the legacy singular `key`, see `ConfigAction.keys` in
      //    src/shared/modules/config.ts) uses three keys not already claimed by `binds`/any other
      //    action's `key`/`keys` above (`MOUSE1`, `SPACE`, `q`). No `binds` entry: `binds` only
      //    mirrors the PRIMARY key of a single-command action for the base bind table
      //    (`action-mirror.ts`), and this fixture's whole point is to view/edit the action in the
      //    Controls tab, not round-trip a specific alias line.
      {
        id: 'fixture-action-multibind',
        categoryId: 'movement',
        name: 'Multi Bind',
        kind: 'bind',
        commands: [
          { kind: 'raw', text: 'wait' },
          { kind: 'raw', text: '+attack' },
        ],
        keys: [{ key: 'G' }, { key: 'H' }, { key: 'J' }],
      },
      // 7-8. Story 063 D4: two already-damaged, keyless Weapons entries - one per grenade command -
      //   seeded as `kind: 'alias'` so the Controls tab's "Make bindable" row-menu item
      //   (`applyEntryKindBindable`) has real inert rows to repair. These are the shape a profile
      //   that hit story 063's root-cause bug is stuck with forever (a keyless bind/message entry
      //   that got silently misread back as `kind: 'alias'` on a file->state pass, decision 4) - and,
      //   distinct from the catalogue's own `weaponUse:use_grenades`/`weaponUse:use_glauncher` rows
      //   (which already round-trip correctly since D1/D2 and are not inert), these are user-created
      //   entries with their own synthetic ids/names, same idea as `fixture-action-weapons`
      //   ("Weapon Combo") above but one command each and no key, mirroring the real damaged
      //   `Grenade + Launcher` entry the story's root-cause section describes split one-command-per-
      //   entry per the D4 acceptance ("one keyless kind: 'alias' Weapons entry per grenade
      //   command").
      {
        id: 'fixture-action-inert-grenades',
        categoryId: 'weapons',
        name: 'Grenades (inert)',
        kind: 'alias',
        commands: [{ kind: 'raw', text: 'use grenades' }],
      },
      {
        id: 'fixture-action-inert-glauncher',
        categoryId: 'weapons',
        name: 'Grenade Launcher (inert)',
        kind: 'alias',
        commands: [{ kind: 'raw', text: 'use grenade launcher' }],
      },
    ],
  }

  const withLayers = {
    id: 'fixture-profile-layers',
    name: 'Layered Profile',
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    cvars: { sensitivity: '5' },
    binds: { w: '+forward', s: '+back' },
    assignments: [{ installationId: INSTALL_TWO_ID, isDefault: false }],
    layers: [
      {
        id: 'fixture-layer-drops',
        name: 'Drops',
        mode: 'hold',
        triggerKey: 'ALT',
        overrides: { 1: 'drop rl', 2: 'drop rg' },
      },
    ],
  }

  const withUnrecognized = {
    id: 'fixture-profile-unrecognized',
    name: 'Imported Profile',
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    cvars: {},
    binds: {},
    assignments: [],
    unrecognized: [{ file: 'config.cfg', line: 42, text: 'seta cl_oddcvar "1"' }],
  }

  return [plain, withLayers, withUnrecognized]
}

// --- downloads.ts DownloadsSettings shape + archive-cache fixture ----------
// Mirrors src/shared/modules/downloads.ts's `DownloadsSettings`/
// `DEFAULT_DOWNLOADS_SETTINGS` (2 / 5 GB / true) and
// src/main/modules/downloads/paths.ts's `userData/cache/downloads/<fileName>` layout
// (verified files, no `.part` suffix).
//
// Story 072 D6: deliberately non-default on every field, so the
// `settings-downloads-section` flow's boot-side assertion (AC6) can tell "the fixture's
// seeded values" apart from "whatever DEFAULT_DOWNLOADS_SETTINGS would have rendered anyway".
/** Mirrors src/shared/modules/downloads.ts's `DownloadsSettings`. Exported so the flow asserts
 * against the exact seeded literals rather than a copy that could drift. */
export const DOWNLOADS_SETTINGS_SEED = {
  concurrentJobs: 4,
  archiveCacheBudgetGB: 10,
  downloadWhilePlayingAllowed: false,
}

/**
 * Two plain (non-`.part`) dummy archives under `userdata/cache/downloads/`, distinct sizes and
 * distinct mtimes - enough for `cacheStatus`'s sum/count (AC3) to be unambiguous without
 * exercising eviction ordering (D3/D4's unit tests already cover that exhaustively). Exported so
 * `scripts/flows/settings-downloads-section.mjs` asserts against the exact same literals.
 */
export const DOWNLOADS_CACHE_ARCHIVE_ONE = {
  fileName: 'fixture-archive-one.pk3',
  sizeBytes: 3 * 1024 * 1024,
  mtime: '2026-01-01T00:00:00.000Z',
}
export const DOWNLOADS_CACHE_ARCHIVE_TWO = {
  fileName: 'fixture-archive-two.pk3',
  sizeBytes: 1 * 1024 * 1024,
  mtime: '2026-01-02T00:00:00.000Z',
}
/** Total evictable bytes/count the two archives above sum to - what `cacheStatus` should report. */
export const DOWNLOADS_CACHE_TOTAL_BYTES =
  DOWNLOADS_CACHE_ARCHIVE_ONE.sizeBytes + DOWNLOADS_CACHE_ARCHIVE_TWO.sizeBytes
export const DOWNLOADS_CACHE_ITEM_COUNT = 2

// --- servers.ts ServersState fixture (story 115) ----------------------------
// Mirrors src/shared/modules/servers.ts's `ServersState`/`ServersScanSettings`/
// `DEFAULT_MASTER_SOURCES` (hardcoded, not imported - see this file's own header comment).
//
// GB-A5 (this project's own testing rule): no test or `ui:flow`/`ui:verify` run may ever touch a
// real master or game server. The `populated` variant's fresh boot falls back to
// `DEFAULT_SERVERS_STATE` - whose three `DEFAULT_MASTER_SOURCES` are all `enabled: true` and point
// at real internet hosts (`master.q2servers.com`, `master.quakeservers.net`, `q2servers.com`) -
// which is exactly what story 111's own `servers-master-sources` flow needs to find there (a fresh
// profile's three defaults, enabled). Story 115 D5's `servers-scan-settings` flow instead triggers
// a real `scan.start` (AC3), so it gets its OWN dedicated fixture variant (`servers-scan`, below)
// rather than mutating `populated`'s shared `servers` key: every shipped source present (never
// silently deleted from the user's view) but disabled, plus one manual server on a dead,
// unused-looking loopback port that only ever needs to time out harmlessly - the same safety
// property `scan-integration.test.ts`'s own seed uses, minus the real dgram responder this fixture
// doesn't need.
export const SERVERS_DISABLED_SOURCES = [
  {
    id: 'default-q2servers-udp',
    type: 'udp-master',
    address: 'master.q2servers.com:27900',
    enabled: false,
  },
  {
    id: 'default-quakeservers-udp',
    type: 'udp-master',
    address: 'master.quakeservers.net:27900',
    enabled: false,
  },
  {
    id: 'default-q2servers-http',
    type: 'http-list',
    address: 'https://q2servers.com/?raw=1',
    enabled: false,
  },
]

/** A manual server address on a fixed, dead loopback port - nothing listens on it, so a scan
 * against it always times out locally and never reaches the real internet. */
export const SERVERS_MANUAL_SERVER_ADDRESS = '127.0.0.1:27921'

/** Mirrors src/shared/modules/servers.ts's `ServersScanSettings`. Deliberately non-default on
 * every field except `autoRefreshIntervalMs` (which happens to coincide with
 * `DEFAULT_SERVERS_STATE.scan`'s own 60000 - every other field still tells "the fixture's seeded
 * values" apart from "whatever the default would have rendered anyway", same discipline as
 * `DOWNLOADS_SETTINGS_SEED` above). `timeoutMs: 500`/`retries: 0` is the shortest combination the
 * Settings `<Select>` can actually show - `500` is `SCAN_TIMEOUT_CHOICES_MS`'s (servers.ts) own
 * lowest choice, deliberately not the schema's raw `MIN_SCAN_TIMEOUT_MS` (250) floor, which the
 * `<Select>` has no option for and would leave the control showing no matching value at boot - so
 * the one dead loopback target still fails fast (~500ms, no retry) without the flow's own boot-side
 * assertion breaking against a value the UI cannot render. Exported so
 * `scripts/flows/servers-scan-settings.mjs` asserts against the exact seeded literals. */
export const SERVERS_SCAN_SETTINGS_SEED = {
  concurrency: 4,
  timeoutMs: 500,
  retries: 0,
  minSpacingMs: 15000,
  autoScanOnOpen: false,
  autoRefreshEnabled: true,
  autoRefreshIntervalMs: 60000,
}

/** Writes the two dummy archives above into `<userDataDir>/cache/downloads/`, each with its own
 * distinct mtime (`fs.utimesSync` - the only way to backdate a file Node itself just wrote). */
function writeDownloadsCacheArchives(userDataDir) {
  const cacheDir = join(userDataDir, 'cache', 'downloads')
  mkdirSync(cacheDir, { recursive: true })
  for (const archive of [DOWNLOADS_CACHE_ARCHIVE_ONE, DOWNLOADS_CACHE_ARCHIVE_TWO]) {
    const path = join(cacheDir, archive.fileName)
    writeFileSync(path, Buffer.alloc(archive.sizeBytes, 0))
    const mtime = new Date(archive.mtime)
    utimesSync(path, mtime, mtime)
  }
}

/**
 * `overrides` is merged onto the base document with a plain shallow spread - a top-level key
 * present in `overrides` replaces that key wholesale (never deep-merged), which is exactly what
 * the `servers-scan` variant needs (a whole `servers` key, built from scratch) and cheap enough not
 * to need anything fancier. No caller today overrides more than one top-level key at a time.
 */
function populatedStateDocument(overrides = {}) {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, activeInstallationId: INSTALL_ONE_ID },
    installations: populatedInstallations(),
    configProfiles: populatedConfigProfiles(),
    configPlayedMods: {},
    configPendingWrites: {},
    configSwitchBinds: {},
    // Story 072 D6: non-default downloads settings (mirrors src/shared/modules/downloads.ts's
    // `downloads` state.json key, see `DOWNLOADS_SETTINGS_SEED` above).
    downloads: { ...DOWNLOADS_SETTINGS_SEED },
    // Story 075 D7: two static failure-log entries, one with diagnostics and one without (AC8).
    downloadFailures: populatedDownloadFailures(),
    // Story 086 D3: a gapped, non-default dashboard arrangement (mirrors
    // src/shared/modules/home.ts's `TilePlacement`/`HomeLayout` shape exactly - this file is plain
    // JS with no type import). Deliberately different from `DEFAULT_HOME_LAYOUT`'s `{0,0,6,5}`/
    // `{6,0,6,5}` pair: both tiles stay within the 12-column grid, neither overlaps the other, both
    // clear the 2x2 minimum, and there is visible empty space around and between them - proof that
    // `home-dashboard`'s screenshot renders the *stored* cells, gap intact, not a compacted layout.
    homeLayout: {
      tiles: [
        { moduleId: 'playtime', x: 1, y: 0, w: 4, h: 4 },
        { moduleId: 'configProfiles', x: 7, y: 2, w: 4, h: 5 },
      ],
    },
    ...overrides,
  }
}

// --- settings.ts WindowState shape ------------------------------------------
// Mirrors src/shared/types/settings.ts:34-41 (`WindowState`).

function windowStateDocument() {
  return {
    width: 1280,
    height: 800,
    maximized: false,
    fullScreen: false,
  }
}

// --- config.cfg importable fixture ------------------------------------------
// Fixed-content `baseq2/config.cfg` written under `fixture-install-writedir`
// only, so the config-import/preview flow has something real to read. Used by
// `config-import-preview` and `config-import-review`; see
// src/main/modules/config/core/import-reader.ts for how `seta`/`bind`/`alias`
// lines are recognized.
//
// - `bind w` appears twice with no `unbind w` in between: import-reader.ts's
//   `applyBind` records that as a duplicate bind (mirrors its own test,
//   "reports a key bound twice with no unbind in between as a duplicate").
// - `alias +fixture_unrecognized "echo hi"` is a plain alias definition
//   (story 041 taught `config-parser.ts` to recognize `alias`, so this no
//   longer lands in `preserved` the way it used to pre-story-041).
// - `alias q2l_fixture_layer "bind e +use"` is story 041's ambiguous
//   construct: its body contains a top-level `bind`, so it lands in
//   `ImportPreviewResult.ambiguousRebindAliases` and is what makes the
//   `config-import-review` screen's review step reachable.
const FIXTURE_CONFIG_CFG = `seta sensitivity "5"
seta cl_run "1"
seta name "FixtureUser"
seta cl_particles "1"
bind w "+forward"
bind s "+back"
bind MOUSE1 "+attack"
bind w "+moveup"
alias +fixture_unrecognized "echo hi"
alias q2l_fixture_layer "bind e +use"
`

// --- own-file ("restore") importable fixture -------------------------------
// Story 042 D6: fixed-content config carrying the `OWNERSHIP_MARKER` sentinel
// (`@shared/config/render.ts`) plus a well-formed `[q2l v=1]` header tag
// (`@shared/config/profile-metadata.ts`), written under `INSTALL_TWO_ID`'s
// `RESTORE_GAME_DIR` gamedir - used by the `config-import-restore` screen to
// exercise `ImportPreviewResult.ownWrittenFile`/`sourceProfileId`/
// `metadataWarnings`.
//
// - Line 1 is the literal sentinel line naming `fixture-profile-plain` (the
//   `plain` profile's own id, `populatedConfigProfiles()` below) - so the
//   import dialog's restore banner resolves and names a real local profile
//   rather than falling back to the bare id.
// - Line 3 carries the header block's `[q2l v=1]` version marker - required
//   for `restoreProfileParts` to take the tagged path at all (an untagged
//   sentinel-only file delegates wholesale to story 041's import instead).
// - The last `bind` line's trailing comment carries a deliberately malformed
//   tag (`[q2l bogus]`, no `key=value` pairs) so `metadataWarnings` is
//   non-empty on this screen (`tag-malformed`, `profile-restore.ts`) -
//   without it the warnings list would never render on any fixture screen.
// - No entry (`e=`)/category (`cat=`) tags at all: this is a minimal
//   launcher file with no actions/layers, same as a freshly created empty
//   profile would restore to (`actions`/`categories`/`layers` all empty).
// - Line 1's trailing clause is deliberately the OLD (pre-story-043) sentinel wording, not the
//   current one - a live exercise of the wording-tolerant ownership check
//   (`ownedProfileId`/`findOwnCanonicalFile`, `@shared/config/render.ts` + `canonical.ts`) rather
//   than a copy/paste that happened to go stale. Line 4, in contrast, must stay byte-identical to
//   `HAND_EDIT_SENTENCE` (`@shared/config/render.ts`) - `profile-restore.ts`'s
//   `consumeHeaderDecoration` matches it exactly so this line is recognised as understood header
//   decoration and folded out of the import dialog's "unrecognised leftovers" list; letting it
//   drift out of sync (as it did across story 043's D1 wording change) reintroduces the exact
//   `scrollable-region-focusable` axe violation story 042's fix-cycle-5 closed, because an
//   unrecognised long comment line renders as its own scrollable single-line code block with no
//   keyboard access.
// - Story 051 (the header-block rewrite: sentinel line dropped from profile files, ownership id
//   moved into the `[q2l ...]` tag's `id` field, four-line `=`-ruled banner replacing this five-line
//   block) deliberately leaves this whole literal in the OLD/legacy shape rather than updating it to
//   match `buildHeaderBlock`'s new output. That is not staleness: this fixture is now the
//   live-smoke regression probe for story 051's AC7 - "a file carrying the previous header shape is
//   still recognised as launcher-owned and is rewritten in the new shape on its next save" - so
//   `npm run ui:verify`'s config-import-restore screen exercises the legacy-shape read path in the
//   real app on every run. Do not "fix" this to the new banner shape in a future change; that would
//   delete the one place in the repo that keeps the legacy-shape reader honest end to end.
const FIXTURE_RESTORE_CONFIG_CFG = `// q2-launcher profile fixture-profile-plain - generated, do not edit
// ================================================================
// Fixture Restored Profile [q2l v=1]
// Q2 Launcher - hand-edited changes to this file are read back
// ================================================================

// --- General ---
set sensitivity "5"

// --- Other binds ---
bind w "+forward"
bind s "+back" // note [q2l bogus]
`

// --- writers ----------------------------------------------------------------

// --- story 052 D10: template-seeded / imported-only Controls fixtures --------
//
// `populated`'s `STATE_SCHEMA_VERSION` mirror above (`1`) is deliberately never bumped in step
// with `src/shared/constants.ts` (currently `2`): every `populated`/`empty` run starts one schema
// version behind the real app on purpose, so the real migration
// (`src/main/services/migrations.ts`, story 052 D6) runs fresh on every reseed and materialises
// `TEMPLATE_ACTION_CATEGORIES` plus one action per `allCatalogRows()` row into every pre-existing
// profile at runtime - exactly the "existing profiles migrate once" behaviour AC8 describes. That
// is what already makes the `config-controls`/`config-controls-message`/
// `config-controls-drop-message` screens and the `drop-message-checkbox` flow show Plain Profile's
// full Movement/Weapons/Weapon-dropping rail today, without hand-authoring roughly fifty catalogue
// rows here.
//
// The two profiles below need the opposite guarantee: a profile with only its own "Imported"
// category must show *only* that (AC1/AC7). If it shared a document with `STATE_SCHEMA_VERSION`
// still at `1`, that very same migration would blindly add Movement/Weapons/Weapon dropping to it
// too - the migration has no way to tell "predates story 052" apart from "genuinely has just one
// category". A dedicated third fixture variant, seeded at the real, current schema version (so no
// migration runs for anyone in this document), is what keeps that guarantee intact without
// touching `populated`/`empty` at all.
/** Mirrors src/shared/constants.ts:14 (`STATE_SCHEMA_VERSION`), unlike the deliberately-stale
 * `STATE_SCHEMA_VERSION` above - see the comment block just above this constant. */
const CONTROLS_SEED_SCHEMA_VERSION = 2

/** Mirrors src/shared/modules/config.ts:146-150 (`TEMPLATE_ACTION_CATEGORIES`). */
const TEMPLATE_CATEGORIES = [
  { id: 'movement', name: 'Movement', nameKey: 'config.controls.categories.movement' },
  { id: 'weapons', name: 'Weapons', nameKey: 'config.controls.categories.weapons' },
  { id: 'drops', name: 'Weapon dropping', nameKey: 'config.controls.categories.drops' },
]

/**
 * Mirrors src/shared/config/catalog-rows.ts's `allCatalogRows()` (in turn built from
 * src/shared/config/action-catalog.ts's `MOVEMENT_ACTIONS`/`WEAPONS`/`WEAPON_ACTIONS`/
 * `WEAPON_EXTRA_ACTIONS`/`DROPPABLES`), in the exact order the real function produces them:
 * movement, `use <weapon>`, weapon cycling, then the three drop groups (weapon/ammo/misc). Each
 * tuple is `[kind, id, categoryId, command]`; `catalogId` is `${kind}:${id}` (`makeCatalogId`) and
 * a row's display name is its own raw command (`nameForCatalogRow`), since every row here carries
 * exactly one command.
 */
const TEMPLATE_CATALOG_ROW_TUPLES = [
  // movement (MOVEMENT_ACTIONS)
  ['movement', 'forward', 'movement', '+forward'],
  ['movement', 'back', 'movement', '+back'],
  ['movement', 'moveleft', 'movement', '+moveleft'],
  ['movement', 'moveright', 'movement', '+moveright'],
  ['movement', 'moveup', 'movement', '+moveup'],
  ['movement', 'movedown', 'movement', '+movedown'],
  ['movement', 'attack', 'movement', '+attack'],
  ['movement', 'speed', 'movement', '+speed'],
  ['movement', 'strafe', 'movement', '+strafe'],
  ['movement', 'left', 'movement', '+left'],
  ['movement', 'right', 'movement', '+right'],
  ['movement', 'klook', 'movement', '+klook'],
  ['movement', 'mlook', 'movement', '+mlook'],
  ['movement', 'centerview', 'movement', 'centerview'],
  // weaponUse (WEAPON_ACTIONS, one per WEAPONS entry)
  ['weaponUse', 'blaster', 'weapons', 'use blaster'],
  ['weaponUse', 'shotgun', 'weapons', 'use shotgun'],
  ['weaponUse', 'sshotgun', 'weapons', 'use super shotgun'],
  ['weaponUse', 'machinegun', 'weapons', 'use machinegun'],
  ['weaponUse', 'chaingun', 'weapons', 'use chaingun'],
  ['weaponUse', 'grenades', 'weapons', 'use grenades'],
  ['weaponUse', 'glauncher', 'weapons', 'use grenade launcher'],
  ['weaponUse', 'rlauncher', 'weapons', 'use rocket launcher'],
  ['weaponUse', 'hyperblaster', 'weapons', 'use hyperblaster'],
  ['weaponUse', 'railgun', 'weapons', 'use railgun'],
  ['weaponUse', 'bfg', 'weapons', 'use bfg10k'],
  // weaponExtra (WEAPON_EXTRA_ACTIONS)
  ['weaponExtra', 'weapnext', 'weapons', 'weapnext'],
  ['weaponExtra', 'weapprev', 'weapons', 'weapprev'],
  ['weaponExtra', 'weaplast', 'weapons', 'weaplast'],
  // dropWeapon (DROPPABLES kind === 'weapon', i.e. WEAPONS minus blaster)
  ['dropWeapon', 'shotgun', 'drops', 'drop shotgun'],
  ['dropWeapon', 'sshotgun', 'drops', 'drop super shotgun'],
  ['dropWeapon', 'machinegun', 'drops', 'drop machinegun'],
  ['dropWeapon', 'chaingun', 'drops', 'drop chaingun'],
  ['dropWeapon', 'grenades', 'drops', 'drop grenades'],
  ['dropWeapon', 'glauncher', 'drops', 'drop grenade launcher'],
  ['dropWeapon', 'rlauncher', 'drops', 'drop rocket launcher'],
  ['dropWeapon', 'hyperblaster', 'drops', 'drop hyperblaster'],
  ['dropWeapon', 'railgun', 'drops', 'drop railgun'],
  ['dropWeapon', 'bfg', 'drops', 'drop bfg10k'],
  // dropAmmo (DROPPABLES kind === 'ammo')
  ['dropAmmo', 'shells', 'drops', 'drop shells'],
  ['dropAmmo', 'bullets', 'drops', 'drop bullets'],
  ['dropAmmo', 'rockets', 'drops', 'drop rockets'],
  ['dropAmmo', 'cells', 'drops', 'drop cells'],
  ['dropAmmo', 'slugs', 'drops', 'drop slugs'],
  ['dropAmmo', 'hgrenades', 'drops', 'drop grenades'],
  // dropMisc (DROPPABLES kind === 'powerup' || 'tech')
  ['dropMisc', 'powershield', 'drops', 'drop power shield'],
  ['dropMisc', 'powerscreen', 'drops', 'drop power screen'],
  ['dropMisc', 'quad', 'drops', 'drop quad damage'],
  ['dropMisc', 'invuln', 'drops', 'drop invulnerability'],
  ['dropMisc', 'silencer', 'drops', 'drop silencer'],
  ['dropMisc', 'rebreather', 'drops', 'drop rebreather'],
  ['dropMisc', 'envsuit', 'drops', 'drop environment suit'],
  ['dropMisc', 'adrenaline', 'drops', 'drop adrenaline'],
  ['dropMisc', 'bandolier', 'drops', 'drop bandolier'],
  ['dropMisc', 'ammopack', 'drops', 'drop ammo pack'],
  ['dropMisc', 'tech', 'drops', 'drop tech'],
]

const TEMPLATE_CATALOG_ROWS = TEMPLATE_CATALOG_ROW_TUPLES.map(
  ([kind, id, categoryId, command]) => ({
    catalogId: `${kind}:${id}`,
    categoryId,
    command,
  }),
)

/** Mirrors src/shared/modules/config.ts's `TEMPLATE_BOUND_CATALOG_IDS` and `STANDARD_TEMPLATE.binds`
 * - the six catalogue rows a freshly created template profile binds immediately, and the key each
 * is bound to. */
const TEMPLATE_BOUND_KEYS = {
  'movement:forward': 'UPARROW',
  'movement:back': 'DOWNARROW',
  'movement:moveup': 'SPACE',
  'movement:movedown': 'c',
  'movement:speed': 'SHIFT',
  'movement:attack': 'MOUSE1',
}

/**
 * Story 053 D8: mirrors `src/shared/modules/config.ts`'s five template sub-category ids/names
 * (`WEAPONS_USE_SUBCATEGORY_ID` etc., added by D5) and its `TEMPLATE_SUBCATEGORY_ID_BY_CATALOG_PREFIX`
 * - this fixture's `templateSeededConfigProfile()` predates D5 and, until this deliverable, never
 * carried any `subcategories`/`subcategoryId`, so the `config-controls-template-seeded` screen never
 * actually showed a sub-categorised view even after D5 landed. Kept as its own literal block, not
 * imported, for the same "plain Node ESM can't import from the src TS trees" reason every other
 * mirror in this file gives (see the file's own doc comment at the top).
 */
const WEAPONS_USE_SUBCATEGORY_ID = 'weapons-use'
const WEAPONS_CYCLING_SUBCATEGORY_ID = 'weapons-cycling'
const DROPS_WEAPONS_SUBCATEGORY_ID = 'drops-weapons'
const DROPS_AMMO_SUBCATEGORY_ID = 'drops-ammo'
const DROPS_MISC_SUBCATEGORY_ID = 'drops-misc'

/** `CatalogRowKind` prefix (`row.catalogId.split(':')[0]`) -> the template sub-category it seeds
 * into. Mirrors `TEMPLATE_SUBCATEGORY_ID_BY_CATALOG_PREFIX` (`src/shared/modules/config.ts`). A
 * prefix missing here (`movement`) gets no `subcategoryId` - it lands in the ungrouped run. */
const TEMPLATE_SUBCATEGORY_ID_BY_CATALOG_PREFIX = {
  weaponUse: WEAPONS_USE_SUBCATEGORY_ID,
  weaponExtra: WEAPONS_CYCLING_SUBCATEGORY_ID,
  dropWeapon: DROPS_WEAPONS_SUBCATEGORY_ID,
  dropAmmo: DROPS_AMMO_SUBCATEGORY_ID,
  dropMisc: DROPS_MISC_SUBCATEGORY_ID,
}

function templateSubcategoryIdFor(catalogId) {
  const prefix = catalogId.split(':')[0] ?? ''
  return TEMPLATE_SUBCATEGORY_ID_BY_CATALOG_PREFIX[prefix]
}

/**
 * A profile shaped exactly like "create from template" would produce (mirrors
 * `STANDARD_TEMPLATE`/`buildTemplateActions` in src/shared/modules/config.ts): the three template
 * categories, and one action per catalogue row - unbound (`commands: []`) except the six rows
 * `TEMPLATE_BOUND_KEYS` names, which carry their real command and key exactly as a fresh template
 * profile's first commit would. Demonstrates AC4 on the `config-controls-template-seeded` screen.
 */
function templateSeededConfigProfile() {
  const binds = {}
  for (const [catalogId, key] of Object.entries(TEMPLATE_BOUND_KEYS)) {
    const row = TEMPLATE_CATALOG_ROWS.find((candidate) => candidate.catalogId === catalogId)
    binds[key] = row.command
  }

  return {
    id: 'fixture-profile-template-seeded',
    name: 'Template Profile',
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    // Mirrors STANDARD_TEMPLATE.cvars (src/shared/modules/config.ts).
    cvars: {
      sensitivity: '3',
      cl_run: '0',
      crosshair: '0',
      cl_gun: '1',
      m_pitch: '0.022',
      volume: '0.7',
    },
    binds,
    assignments: [],
    // Story 053 D8: `weapons`/`drops` now carry the same `subcategories` STANDARD_TEMPLATE.categories
    // seeds (D5) - so a template-seeded profile shows real group headers, not just three flat
    // categories, matching what "create from template" actually produces today.
    categories: TEMPLATE_CATEGORIES.map((category) => ({
      ...category,
      ...(category.id === 'weapons'
        ? {
            subcategories: [
              { id: WEAPONS_USE_SUBCATEGORY_ID, name: 'Use weapon' },
              { id: WEAPONS_CYCLING_SUBCATEGORY_ID, name: 'Cycling' },
            ],
          }
        : {}),
      ...(category.id === 'drops'
        ? {
            subcategories: [
              { id: DROPS_WEAPONS_SUBCATEGORY_ID, name: 'Weapons' },
              { id: DROPS_AMMO_SUBCATEGORY_ID, name: 'Ammunition' },
              { id: DROPS_MISC_SUBCATEGORY_ID, name: 'Misc' },
            ],
          }
        : {}),
    })),
    actions: TEMPLATE_CATALOG_ROWS.map((row) => {
      const key = TEMPLATE_BOUND_KEYS[row.catalogId]
      const slug = row.catalogId.replace(/[^a-z0-9]+/gi, '-')
      const subcategoryId = templateSubcategoryIdFor(row.catalogId)
      return {
        id: `fixture-template-seed-${slug}`,
        categoryId: row.categoryId,
        name: row.command,
        kind: 'bind',
        catalogId: row.catalogId,
        commands: key ? [{ kind: 'raw', text: row.command }] : [],
        ...(key ? { key } : {}),
        ...(subcategoryId ? { subcategoryId } : {}),
      }
    }),
  }
}

/**
 * Story 058 D7: the `controls-seed` variant's own installation, used only so
 * `importedOnlyConfigProfile()` below can be assigned to one for the `config-care-clear` screen
 * (the healthy Care fixture). None of `config-controls-imported-only`/`config-controls-template-
 * seeded`/`config-controls-template-subcategories` or the `controls-subcategory` flow touch
 * installations at all, so adding one here does not change anything about how those screens read.
 */
const INSTALL_CONTROLS_SEED_ID = 'fixture-install-controls-seed'

/**
 * A profile with a single, non-template category ("Imported") and a few free-form entries of its
 * own - no `movement`/`weapons`/`drops` at all. Demonstrates AC1/AC7: "a profile with only an
 * Imported category shows only that" on the `config-controls-imported-only` screen.
 *
 * Story 058 D7: also the `config-care-clear` screen's healthy fixture - deliberately NOT
 * `templateSeededConfigProfile()`/a migrated `populated` profile, both of which carry the full
 * movement/weapons/drops catalogue and therefore always raise `aliasShadowsCommand` findings for
 * several of its rows (`+moveleft` etc. resolve to alias names that collide with a reserved
 * command name - `validate-actions.ts`'s own doc comment confirms this fires for a catalogue row
 * too, not just a hand-typed one). This profile's three free-form entries do not collide with
 * anything reserved, so it is the one fixture profile that can actually reach Care's "All clear".
 * Assigned to `INSTALL_CONTROLS_SEED_ID` below so AC 1's "assigned, in-sync installation" is real,
 * not merely "nothing to validate against".
 */
function importedOnlyConfigProfile() {
  return {
    id: 'fixture-profile-imported-only',
    name: 'Imported Category Profile',
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    cvars: {},
    // No `binds` mirror for the "Use item" action below: unlike a catalogue-backed row,
    // `bindValueFor` (@shared/config/action-mirror.ts) only passes a bare `+command` through
    // verbatim when the action carries a `catalogId` - a free-form action's mirror is always its
    // alias name, so a hand-authored `binds.e: '+use'` here would read as a *second*, independent
    // claimant on `e` to `bind-conflicts.ts`'s scan and raise a spurious conflict badge that has
    // nothing to do with this screen's own point (AC1/AC7's "shows only its own category").
    binds: {},
    assignments: [{ installationId: INSTALL_CONTROLS_SEED_ID, isDefault: true }],
    categories: [{ id: 'imported', name: 'Imported' }],
    actions: [
      {
        id: 'fixture-imported-use',
        categoryId: 'imported',
        name: 'Use item',
        kind: 'bind',
        // Story 058 D7: real Quake II has no continuous `+use`/`-use` pair (the actual console
        // command is the discrete `use <item>`), so a signed `+use` token here reads to
        // `validate-actions.ts`'s `undefinedAlias` rule exactly like a hand-typed reference to an
        // alias that does not exist - it is neither a known engine command nor a defined alias.
        // Harmless for this profile's original purpose (`config-controls-imported-only` only checks
        // that the "Imported" category renders, never this row's exact command), but it is also now
        // the `config-care-clear` screen's healthy fixture (added in this deliverable), which needs
        // this profile to carry zero validation findings. The bare `use` command is exactly what a
        // real "Use item" bind would send.
        commands: [{ kind: 'raw', text: 'use' }],
        key: 'e',
      },
      {
        id: 'fixture-imported-inventory',
        categoryId: 'imported',
        name: 'Inventory',
        kind: 'bind',
        commands: [{ kind: 'raw', text: 'inven' }],
      },
      {
        id: 'fixture-imported-gg',
        categoryId: 'imported',
        name: 'GG',
        kind: 'message',
        commands: [{ kind: 'message', channel: 'say', text: 'gg' }],
      },
    ],
  }
}

function controlsSeedStateDocument() {
  return {
    schemaVersion: CONTROLS_SEED_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, scanOnFirstRun: false },
    installations: [
      makeInstallation({
        id: INSTALL_CONTROLS_SEED_ID,
        name: 'Controls Seed Install',
        rootPath: join(gameRoot(), INSTALL_CONTROLS_SEED_ID),
        favorite: false,
        sortOrder: 0,
      }),
    ],
    configProfiles: [templateSeededConfigProfile(), importedOnlyConfigProfile()],
    configPlayedMods: {},
    configPendingWrites: {},
    configSwitchBinds: {},
  }
}

/** Deletes and rewrites the `controls-seed` variant's userdata, plus its one installation's game
 * dir (story 058 D7 - see `INSTALL_CONTROLS_SEED_ID`'s own doc comment). */
export function writeControlsSeedFixture() {
  const userDataDir = variantUserDataDir('controls-seed')
  rmDirBestEffort(userDataDir)
  mkdirSync(userDataDir, { recursive: true })

  writeJson(join(userDataDir, STATE_FILE), controlsSeedStateDocument())
  writeJson(join(userDataDir, WINDOW_STATE_FILE), windowStateDocument())

  const installRoot = join(gameRoot(), INSTALL_CONTROLS_SEED_ID)
  const baseq2Dir = join(installRoot, 'baseq2')
  rmDirBestEffort(installRoot)
  mkdirSync(baseq2Dir, { recursive: true })

  // This root used to hold nothing but an empty `baseq2`, and got away with it because the app's
  // own startup `validateAll()` (`main/index.ts`) never actually ran: it hung off a
  // `did-finish-load` listener registered after the event had already fired, so every fixture kept
  // whatever `makeInstallation()` seeded - here `status: 'ok'`, `engineKind: 'r1q2'`. Now that the
  // listener is gone and `validateAll()` really runs, the verdict is re-derived from the files
  // below, and an empty root inspects as `engineKind: 'unknown'` plus an error-level `pak0Missing`.
  //
  // `config-care-clear` is the screen that notices, and it fails rather than merely looking
  // different: its Care "All clear" block needs `ProfileValidation.status === 'ok'`, which
  // `engineScope()` (renderer/src/modules/config/lib/engine-scope.ts) only answers when an assigned
  // installation runs an engine the cvar catalogue has facts for. `unknown` has none, so the tab
  // renders `healthNotChecked` and the screen's own `waitFor` times out.
  //
  // So the folder now holds what this variant's `state.json` has always claimed. The engine marker
  // is matched by NAME, on every platform (`classifyEngine`, src/main/services/inspector.ts), but
  // `looksExecutable` (src/main/lib/fs-utils.ts) is extension-only on Windows and execute-bit-only
  // off it - the same split `writeLinuxJourneyInstallRoot()` below already documents at length, so
  // the name and the `chmodSync` follow its lead rather than inventing a second convention. Without
  // it the root would classify as r1q2 yet carry no runnable client, i.e. an error-level
  // `noExecutable` and `status: 'invalid'` on Linux only.
  const executableName = process.platform === 'win32' ? 'r1q2.exe' : 'r1q2'
  const executablePath = join(installRoot, executableName)
  // Contents are never read - `classifyEngine`/`rankExecutables` look at the name and the mode.
  writeFileSync(executablePath, '')
  if (process.platform !== 'win32') chmodSync(executablePath, 0o755)

  // The exact pak combination `inspectInstallation` turns into zero checks: `pak0.pak` at its real
  // retail length (the size comparison is genuine - anything else raises `pak0NotRetail` and paints
  // a Demo marker on an installation this screen wants to read as plain and healthy) with
  // `pak1.pak`/`pak2.pak` beside it, which are only ever tested for existence. `writeSizedFile` is
  // `truncateSync`, the same trick `INSTALL_ENGINE_UPDATE_ID`'s block above uses, so the 184 MB is
  // a hole rather than bytes; it and `RETAIL_PAK_SIZES` are declared further down this file as plain
  // module-level bindings, forward-referenced exactly as that block already does.
  writeSizedFile(join(baseq2Dir, 'pak0.pak'), RETAIL_PAK_SIZES['pak0.pak'])
  writeSizedFile(join(baseq2Dir, 'pak1.pak'), RETAIL_PAK_SIZES['pak1.pak'])
  writeSizedFile(join(baseq2Dir, 'pak2.pak'), RETAIL_PAK_SIZES['pak2.pak'])

  return { userDataDir, installations: 1, configProfiles: 2 }
}

function writeJson(path, value) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writeConfigCfg(baseq2Dir) {
  writeFileSync(join(baseq2Dir, 'config.cfg'), FIXTURE_CONFIG_CFG, 'utf8')
}

/** Story 042 D6: writes the own-file ("restore") fixture into `RESTORE_GAME_DIR`. */
function writeRestoreConfigCfg(installDir) {
  const dir = join(installDir, RESTORE_GAME_DIR)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'config.cfg'), FIXTURE_RESTORE_CONFIG_CFG, 'utf8')
}

/**
 * Story 067 D5: writes the custom-icon PNG an `icon: { kind: 'custom' }` installation's file lives
 * at - `userData/installation-icons/<installationId>.png` (mirrors `InstallationIcon`'s own doc
 * comment, `src/shared/types/installation.ts`), which is what `installations:iconDataUrl` (D4)
 * reads back as a `data:` URL.
 */
function writeCustomIconFile(userDataDir, installationId) {
  const dir = join(userDataDir, 'installation-icons')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${installationId}.png`), Buffer.from(CUSTOM_ICON_PNG_BASE64, 'base64'))
}

/**
 * On Windows, closing an Electron session's GPU process (Dawn's WebGPU/Graphite disk cache
 * under `userData`) doesn't release its cache files immediately - `app.close()` returns before
 * Windows (observed: real-time AV scanning the freshly-closed cache blobs, anywhere from a few
 * seconds up to several minutes under load, with no live process holding the handle) actually
 * lets go, so the very next fixture reseed can hit `EPERM`/`EBUSY` on a directory nothing still
 * wants. `maxRetries`/`retryDelay` are Node's own documented remedy for exactly this class of
 * transient Windows delete failure, but the observed worst case is unbounded enough that no
 * fixed budget can be sized to always win.
 *
 * So this is a best-effort delete, not an all-or-nothing one: what a fixture reseed actually
 * needs is `state.json`/`window-state.json` to hold this run's fresh data, never a byte-clean
 * `userData` directory - a stale, still-locked cache subfolder left behind is harmless (Chromium
 * happily reuses or extends an existing disk cache) and must never fail the whole run. On a
 * still-locked path after the retry budget, this logs a warning and moves on so `mkdirSync` +
 * the two `writeJson` calls right after it can still put the run in a known-good state.
 */
const RM_RETRY_OPTIONS = { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }

function rmDirBestEffort(path) {
  try {
    rmSync(path, RM_RETRY_OPTIONS)
  } catch (error) {
    console.warn(
      `[fixture] could not fully clear ${path} (${error.code ?? error.message}) - a locked ` +
        'leftover (e.g. GPU disk cache) is harmless and the fixture reseed continues regardless.',
    )
  }
}

/**
 * Deletes and rewrites the `populated` variant's userdata + game dirs - or, when `variant`/
 * `stateOverrides` are passed, a different variant that needs every one of those same side effects
 * (installations, config profiles, news cache, download-cache archives) but a different top-level
 * `state.json` key or two on top of the base document. `writeFixture('servers-scan')` below is the
 * one caller that passes both, rather than this function being duplicated near-verbatim for one
 * extra `servers` key.
 */
export function writePopulatedFixture({ variant = 'populated', stateOverrides = {} } = {}) {
  const userDataDir = variantUserDataDir(variant)
  rmDirBestEffort(userDataDir)
  mkdirSync(userDataDir, { recursive: true })

  writeJson(join(userDataDir, STATE_FILE), populatedStateDocument(stateOverrides))
  writeJson(join(userDataDir, WINDOW_STATE_FILE), windowStateDocument())
  writeDownloadsCacheArchives(userDataDir)
  // Story 083 D6: a fresh, successful feed cache - the `home-hero` screen's filled state.
  writeNewsFeedCache(userDataDir, {
    slides: NEWS_FIXTURE_SLIDES,
    retrievedAt: FIXED_TIMESTAMP,
    lastRefreshFailed: false,
  })

  const installIds = [
    INSTALL_ONE_ID,
    INSTALL_TWO_ID,
    INSTALL_UNKNOWN_ENGINE_ID,
    INSTALL_REMOVE_STORE_ID,
    INSTALL_REMOVE_DISK_ID,
  ]
  for (const id of installIds) {
    const baseq2Dir = join(gameRoot(), id, 'baseq2')
    rmDirBestEffort(join(gameRoot(), id))
    mkdirSync(baseq2Dir, { recursive: true })
    if (id === INSTALL_TWO_ID) {
      writeConfigCfg(baseq2Dir)
      writeRestoreConfigCfg(join(gameRoot(), id))
      // Story 067 D5: this is also the installation seeded with `icon: { kind: 'custom' }`.
      writeCustomIconFile(userDataDir, id)
    }
  }

  // Story 094 D4: a sentinel file in a directory NEXT TO `INSTALL_REMOVE_DISK_ID`'s own root
  // (created just above, in the loop) - not inside it. `installation-remove-from-disk.mjs` deletes
  // that installation's root and then reads this file back untouched to prove AC3's "nothing
  // outside that folder is touched".
  {
    const sentinelPath = installRemoveDiskSiblingSentinelPath()
    rmDirBestEffort(dirname(sentinelPath))
    mkdirSync(dirname(sentinelPath), { recursive: true })
    writeFileSync(sentinelPath, INSTALL_REMOVE_DISK_SIBLING_SENTINEL_CONTENT, 'utf8')
  }

  // Story 077 D5: `INSTALL_FAILED_ID`'s root, deliberately WITHOUT a `baseq2` subfolder - unlike
  // every id in the loop above. A folder that exists but holds nothing is exactly what
  // `bootstrap/job.ts`'s failure cleanup leaves behind (see that installation's own doc comment in
  // `populatedInstallations()`), and it is what makes the real app's own startup `validateAll()`
  // re-derive `status: 'invalid'` here rather than disagreeing with the value already seeded above.
  rmDirBestEffort(join(gameRoot(), INSTALL_FAILED_ID))
  mkdirSync(join(gameRoot(), INSTALL_FAILED_ID), { recursive: true })

  // Story 090 D6: `INSTALL_DEMO_UPGRADE_ID`'s real files - see that constant's own doc comment for
  // why each one is there. `writeSizedFile`/`UNVERIFIED_PAK0_BYTES` are declared further down this
  // file (story 088's own retail-fixture section) but are plain module-level bindings, already
  // initialised by the time any exported function here actually runs.
  {
    const demoRoot = join(gameRoot(), INSTALL_DEMO_UPGRADE_ID)
    const demoBaseq2 = join(demoRoot, 'baseq2')
    rmDirBestEffort(demoRoot)
    mkdirSync(demoBaseq2, { recursive: true })
    // An empty file is enough: `classifyEngine`/`rankExecutables` (src/main/services/inspector.ts)
    // only look at the file name, never its contents.
    writeFileSync(join(demoRoot, 'r1q2.exe'), '')
    writeSizedFile(join(demoBaseq2, 'pak0.pak'), UNVERIFIED_PAK0_BYTES)
    writeFileSync(join(demoBaseq2, RETAIL_UPGRADE_MARKER_FILE), RETAIL_UPGRADE_MARKER_CONTENT, 'utf8')
  }

  // Story 092 D8: `INSTALL_ENGINE_UPDATE_ID`'s real files - an already-playable Q2PRO installation
  // whose three engine files start on `ENGINE_UPDATE_OLD_FILL_BYTE`, distinct from every fill byte
  // the REAL fixture archive extracts onto those same paths - so `engine-update.mjs` can tell "still
  // the old build" apart from "the update/rollback job touched this file" with a plain byte
  // comparison. Written under `ENGINE_INSTALLED_RELATIVE`'s spelling (the executable as `q2pro.exe`,
  // not the archive's own `q2pro64.exe` - see that constant's own doc comment for why the rename
  // matters: `update-job.ts`'s allowlist would never find or back up a `q2pro64.exe` on disk).
  // Retail-sized paks (`writeSizedFile`, `RETAIL_PAK_SIZES`, both declared further down this file -
  // see the comment on the demo-upgrade block above for why forward references to them are safe)
  // keep this installation reading as a plain, working `ok` install with no demo-data check, unlike
  // `INSTALL_DEMO_UPGRADE_ID` above.
  {
    const engineRoot = join(gameRoot(), INSTALL_ENGINE_UPDATE_ID)
    const engineBaseq2 = join(engineRoot, 'baseq2')
    rmDirBestEffort(engineRoot)
    mkdirSync(engineBaseq2, { recursive: true })
    for (const [archiveRelative, { sizeBytes }] of Object.entries(ENGINE_FIXTURE_FILES)) {
      const segments = ENGINE_INSTALLED_RELATIVE[archiveRelative].split('/')
      const fileName = segments.pop()
      writeFileIn(join(engineRoot, ...segments), fileName, filler(sizeBytes, ENGINE_UPDATE_OLD_FILL_BYTE))
    }
    writeSizedFile(join(engineBaseq2, 'pak0.pak'), RETAIL_PAK_SIZES['pak0.pak'])
    writeSizedFile(join(engineBaseq2, 'pak1.pak'), RETAIL_PAK_SIZES['pak1.pak'])
    writeSizedFile(join(engineBaseq2, 'pak2.pak'), RETAIL_PAK_SIZES['pak2.pak'])
  }

  // Story 093 D7: the five additive repair-flow installations - see the block comment above
  // `INSTALL_REPAIR_ENGINE_ID` for what each finding is and why. `writeSizedFile`/`RETAIL_PAK_SIZES`
  // are declared further down this file, forward-referenced exactly as the demo/engine-update
  // blocks above already do (module-level bindings, initialised before any exported function runs).
  {
    // AC1: `r1q2ded.exe` is the only executable on disk (an r1q2 marker AND, being the sole `.exe`,
    // the fallback executable `inspectInstallation` picks) - the recorded `executablePath` above
    // names a `r1q2.exe` that does not exist, so the two disagree (`validation.executableMissing`).
    // `baseq2` exists but holds no pak file at all (`validation.pak0Missing`, error - what makes the
    // action bar's Repair button exist to click).
    const root = join(gameRoot(), INSTALL_REPAIR_ENGINE_ID)
    rmDirBestEffort(root)
    mkdirSync(join(root, 'baseq2'), { recursive: true })
    writeFileSync(join(root, 'r1q2ded.exe'), '')
  }
  {
    // AC2: a real executable (no engine finding), retail-sized pak0/pak1, no pak2.pak at all ->
    // `validation.pointReleaseMissing` (warn).
    const root = join(gameRoot(), INSTALL_REPAIR_POINT_RELEASE_ID)
    const baseq2 = join(root, 'baseq2')
    rmDirBestEffort(root)
    mkdirSync(baseq2, { recursive: true })
    writeFileSync(join(root, 'r1q2.exe'), '')
    writeSizedFile(join(baseq2, 'pak0.pak'), RETAIL_PAK_SIZES['pak0.pak'])
    writeSizedFile(join(baseq2, 'pak1.pak'), RETAIL_PAK_SIZES['pak1.pak'])
  }
  {
    // AC4: a real executable, `baseq2` present but entirely empty -> `validation.pak0Missing`
    // (error), offering `retail-copy`.
    const root = join(gameRoot(), INSTALL_REPAIR_RETAIL_ID)
    rmDirBestEffort(root)
    mkdirSync(join(root, 'baseq2'), { recursive: true })
    writeFileSync(join(root, 'r1q2.exe'), '')
  }
  {
    // AC5: same shape as the retail-pak-less installation above (so the action bar reaches it too),
    // plus a `writeDirPath` (set on the installation record itself, above) that is never created.
    const root = join(gameRoot(), INSTALL_REPAIR_WRITEDIR_ID)
    rmDirBestEffort(root)
    mkdirSync(join(root, 'baseq2'), { recursive: true })
    writeFileSync(join(root, 'r1q2.exe'), '')
  }
  {
    // AC6: no executable anywhere, but a fully valid, fully retail `baseq2` - the only finding is
    // `validation.noExecutable`, and it offers nothing (see the block comment above).
    const root = join(gameRoot(), INSTALL_REPAIR_UNREPAIRABLE_ID)
    const baseq2 = join(root, 'baseq2')
    rmDirBestEffort(root)
    mkdirSync(baseq2, { recursive: true })
    writeSizedFile(join(baseq2, 'pak0.pak'), RETAIL_PAK_SIZES['pak0.pak'])
    writeSizedFile(join(baseq2, 'pak1.pak'), RETAIL_PAK_SIZES['pak1.pak'])
    writeSizedFile(join(baseq2, 'pak2.pak'), RETAIL_PAK_SIZES['pak2.pak'])
  }

  return {
    userDataDir,
    // + INSTALL_FAILED_ID + INSTALL_DEMO_UPGRADE_ID + INSTALL_ENGINE_UPDATE_ID + the five 093 D7
    // repair installations
    installations: installIds.length + 3 + 5,
    configProfiles: populatedConfigProfiles().length,
  }
}

/** Deletes and rewrites the `empty` variant's userdata (defaults only).
 *
 * Deliberately writes no `news-feed.json` at all - "no cache file exists" is exactly the
 * `home-hero-welcome` screen's precondition (story 083 D6): `feedState()` reads an empty `slides`
 * array as `'welcome'` regardless of `lastRefreshFailed`, and `NewsFeedCache.read()` already answers
 * `undefined` for a missing file, so this variant needs no news-specific writer of its own. */
export function writeEmptyFixture() {
  const userDataDir = variantUserDataDir('empty')
  rmDirBestEffort(userDataDir)
  mkdirSync(userDataDir, { recursive: true })

  writeJson(join(userDataDir, STATE_FILE), emptyStateDocument())
  writeJson(join(userDataDir, WINDOW_STATE_FILE), windowStateDocument())

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

export function writeFixture(variant) {
  // Story 066 D8: staged independently of which variant is being (re)written - see
  // `writeImportFilesFixture()`'s own doc comment for why this has to happen on every reseed
  // regardless of variant (AC9 points the same three files at the `empty` variant too).
  writeImportFilesFixture()
  if (variant === 'populated') return writePopulatedFixture()
  if (variant === 'empty') return writeEmptyFixture()
  if (variant === 'controls-seed') return writeControlsSeedFixture()
  if (variant === 'news-stale') return writeNewsStaleFixture()
  if (variant === 'news-images') return writeNewsImagesFixture()
  if (variant === 'news-cover') return writeNewsCoverFixture()
  // Story 115 D5: `scripts/flows/servers-scan-settings.mjs`'s own dedicated variant - see the
  // `servers.ts ServersState fixture` comment block above for why it is not a `servers` key added
  // to `populated` instead. Reuses `writePopulatedFixture()`'s installations/config-profiles/news
  // cache/download-cache-archive side effects verbatim, under a different variant's userData dir
  // and with the `servers` key `populatedStateDocument()` used to carry added back on top.
  if (variant === 'servers-scan') {
    return writePopulatedFixture({
      variant: 'servers-scan',
      stateOverrides: {
        servers: {
          sources: SERVERS_DISABLED_SOURCES,
          favourites: [],
          manualServers: [
            {
              address: SERVERS_MANUAL_SERVER_ADDRESS,
              origin: 'manual',
              addedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
          history: [],
          scan: { ...SERVERS_SCAN_SETTINGS_SEED },
        },
      },
    })
  }
  throw new Error(`unknown fixture variant: ${variant}`)
}

export const FIXTURE_VARIANTS = [
  'populated',
  'empty',
  'controls-seed',
  'news-stale',
  'news-images',
  // Story 095 D3: no screen in `screens.mjs` uses this one - it exists for
  // `scripts/flows/news-cover-template.mjs` alone, which is why it still has to be listed here
  // (`ui:verify` only reseeds the variants its screens name; `ui:seed` is what writes this one).
  'news-cover',
  // Story 115 D5: same reasoning as `news-cover` right above - no screen in `screens.mjs` names
  // this one, it exists for `scripts/flows/servers-scan-settings.mjs` alone.
  'servers-scan',
]

// --- story 066 D8: the import-from-files flow's staged real-config corpus ---------------------
//
// `docs/requirements/066-new-profile-starts-empty-from-a-template-or-from-my-files.md`'s own
// reference case: `docs/fixtures/{dm,dmalias,gfx}.cfg`, the same three real (anonymized) player
// config files `import-fixtures.test.ts` (D2) reads straight out of the repo. This story's harness
// stub (`DialogService.pickConfigFiles()`, `src/main/services/dialog.ts`) returns fixed paths from
// `Q2L_UI_PICK_FILES` instead of opening a real OS dialog - those paths have to point at real files
// on disk, so this stages byte-identical copies under `.ui-verify/` rather than pointing the env var
// back into the repo tree itself (every other harness-owned artifact already lives under
// `.ui-verify/`, never the repo).
//
// Deliberately NOT nested under any single variant's userData: `Q2L_UI_PICK_FILES` (built in
// `scripts/lib/harness.mjs`'s `childEnv()`) is the same for every launch regardless of which
// fixture variant the app under test is running against - AC9 ("import from files needs no
// installation") is proven by pointing this exact corpus at the zero-installation `empty` variant,
// not a copy of it.

/** In the exact order `Q2L_UI_PICK_FILES` must hand back - dm.cfg, then dmalias.cfg, then gfx.cfg -
 * matching the load order D2's fixture-corpus test pins (`bind RIGHTARROW "exec dmalias.cfg"`
 * resolves as a preserved bind text, never a real config-time exec, only because dmalias.cfg is
 * ALSO one of the picked files - see that test's own top comment). */
const IMPORT_FILES_FIXTURE_NAMES = ['dm.cfg', 'dmalias.cfg', 'gfx.cfg']

function importFilesFixtureDir() {
  return join(UI_VERIFY_ROOT, 'fixture', 'import-files')
}

/** The staged, absolute paths in the fixed order above - what `harness.mjs` joins with
 * `path.delimiter` for `Q2L_UI_PICK_FILES`. Exported so `scripts/flows/import-from-files.mjs` can
 * assert against the exact same paths/order rather than a copy that could drift. */
export function importFilesFixturePaths() {
  return IMPORT_FILES_FIXTURE_NAMES.map((name) => join(importFilesFixtureDir(), name))
}

/**
 * Copies `docs/fixtures/{dm,dmalias,gfx}.cfg` byte-for-byte into `.ui-verify/fixture/import-files/`.
 * Raw `Buffer` in, raw `Buffer` out - these are real player files with latin1-only bytes in places
 * (`import-fixtures.test.ts`'s own discipline for the same three files), so this never round-trips
 * through a text encoding that could silently mangle one.
 *
 * Idempotent (same source bytes every call, `ui:seed`'s own guarantee) and cheap enough to call
 * unconditionally on every `writeFixture()` reseed - see that function above.
 */
export function writeImportFilesFixture() {
  const dir = importFilesFixtureDir()
  mkdirSync(dir, { recursive: true })
  for (const name of IMPORT_FILES_FIXTURE_NAMES) {
    const bytes = readFileSync(join(REPO_ROOT, 'docs', 'fixtures', name))
    writeFileSync(join(dir, name), bytes)
  }
  return importFilesFixturePaths()
}

// --- story 074 D8: the offline bootstrap-wizard fixture -----------------------------------------
//
// `scripts/flows/bootstrap-wizard.mjs` runs the REAL bootstrap job - real manifest fetch, three
// real verified downloads, three real `7za.exe` extractions, the real assemble/revalidate passes -
// and must do so with no outbound network access whatsoever. That needs three things, and all
// three are built here:
//
//   1. three real, 7-Zip-extractable archives, laid out the way the REAL archives are - not the
//      way `bootstrap/assemble.ts`'s allowlist was once guessed to expect (story 076 measured and
//      fixed that gap): `q2pro64.exe` + `baseq2/{gamex86_64.dll,q2pro.menu}` for the engine,
//      `Install/Data/baseq2/{pak0.pak,players/...}` for the demo, and
//      `baseq2/{pak1.pak,pak2.pak,players/...}` for the point release - plus `ctf/`, `xatrix/`
//      and `rogue/` payloads inside the point-release archive so AC8's "no ctf/xatrix/rogue
//      directory is created" is a claim about real, discarded input rather than about an input
//      that never had any. `BOOTSTRAP_FIXTURE_LAYOUT` below is this layout as data;
//   2. a `127.0.0.1` server serving both manifest files and those archives - with the real
//      sha256/size of the archives on disk, so nothing about the verification step is faked; and
//   3. a target folder that is deliberately BOTH under a fake `Program Files` root (AC2) and
//      non-empty (AC3), so one pass through the wizard renders and acknowledges both warnings.
//
// Everything lands under `.ui-verify/fixture/bootstrap/` and nowhere else - the paths go through
// `assertInside(UI_VERIFY_ROOT, ...)`, the same containment discipline `harness.mjs` applies to
// `--user-data-dir`.
//
// None of this is part of `writeFixture()`/`ui:seed`: these artefacts are only ever wanted by that
// one flow, they cost a few seconds and ~10 MB to build, and (unlike the `populated`/`empty` state
// documents) they are not byte-identical per run, since a zip stores mtimes. That is harmless
// because every digest below is computed from the bytes that were actually written.

/** `.ui-verify/fixture/bootstrap` - everything this section writes lives under it. */
function bootstrapFixtureRoot() {
  return assertInside(
    UI_VERIFY_ROOT,
    join(UI_VERIFY_ROOT, 'fixture', 'bootstrap'),
    'bootstrap fixture root',
  )
}

/**
 * A path under the machine's REAL `%ProgramFiles%` that is only ever *named*, never created and
 * never written to - the target the flow points the wizard's step 2 at to make AC2's Program Files
 * warning appear, before re-picking the real fixture target below.
 *
 * Story 074's refine expected this to work the other way round ("the e2e flow can exercise the
 * verdict by pointing the child process's `ProgramFiles` at a fixture dir - no production backdoor
 * needed"). On Windows it cannot: `ProgramFiles`, `ProgramFiles(x86)` and `NUMBER_OF_PROCESSORS`
 * are regenerated by the loader for every new process from the process's own bitness, so a value
 * handed to `CreateProcess` in the environment block is simply replaced - measured, not assumed.
 * `bootstrap/target.test.ts` can still inject a fake root, because it calls
 * `computeTargetVerdict(path, { env })` in-process; a child process cannot be lied to this way.
 *
 * Naming a real Program Files path is safe here because `computeTargetVerdict` is a read-only
 * verdict: the folder does not have to exist (`programFiles` is a prefix comparison,
 * `alreadyInstalled`/`entries` are skipped for a non-existent directory) and the only write it
 * attempts is the same throwaway probe marker in the nearest existing ancestor that a real user
 * picking that folder would trigger - which fails harmlessly without elevation. The flow never
 * proceeds past the target step with this path selected, so nothing is ever installed there.
 */
export function bootstrapProgramFilesProbePath() {
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
  return join(programFiles, 'Q2 Launcher UI Verify Fixture')
}

/** The folder the wizard actually installs into: writable, under `.ui-verify/`, and non-empty (AC3). */
export function bootstrapTargetDir() {
  return join(bootstrapFixtureRoot(), 'target', 'Q2PRO Demo')
}

/**
 * The one pre-existing file that makes the target non-empty (AC3). A name that could plausibly be
 * the user's own, since that warning exists precisely because they may have put something here.
 */
export const BOOTSTRAP_TARGET_LOOSE_FILE = 'user-notes.txt'

/**
 * Story 080 D4: the folder `scripts/flows/bootstrap-r1q2.mjs` installs into - a sibling of
 * `bootstrapTargetDir()`, not that same folder (the two flows must not race over one directory).
 * Program-Files/non-empty target warnings are already proven by the Q2PRO flow (AC2/AC3 there), so
 * this one stays fresh and empty rather than re-proving them.
 */
export function bootstrapR1q2TargetDir() {
  return join(bootstrapFixtureRoot(), 'target', 'R1Q2 Fixture')
}

/** Fresh, empty target folder for the R1Q2 flow - deletes any leftover from a previous run. */
export function writeBootstrapR1q2TargetDir() {
  const target = assertInside(UI_VERIFY_ROOT, bootstrapR1q2TargetDir(), 'bootstrap r1q2 target')
  rmDirBestEffort(target)
  mkdirSync(target, { recursive: true })
  return target
}

/** Where the built archives are served from. */
function bootstrapPackagesDir() {
  return join(bootstrapFixtureRoot(), 'packages')
}

/** Scratch trees the archives are built out of; kept afterwards, so a build is easy to inspect. */
function bootstrapStagingDir() {
  return join(bootstrapFixtureRoot(), 'staging')
}

/** The vendored extractor - the same binary the app spawns (`7za-path.ts`, its dev branch). */
function vendoredSevenZaPath() {
  return join(REPO_ROOT, 'resources', 'bin', '7za.exe')
}

/** True when that binary is present; the flow refuses to pretend an extraction happened without it. */
export function vendoredExtractorExists() {
  return existsSync(vendoredSevenZaPath())
}

// --- story 100 D10: the Linux user-journey flow's own, unregistered install root ---------------
//
// `linux-user-journey.mjs` adds this folder through the real `AddExistingDialog` (the
// `Q2L_UI_PICK_FOLDER` stub), so unlike every `INSTALL_*` constant above it is never written into
// `state.json` by a fixture writer - the flow registers it itself, through the real UI, the same
// way a user would. What has to exist on disk beforehand is a folder `inspectInstallation` ranks
// as playable AND that the real `spawn()` call the Play button drives can actually execute.
//
// The stand-in client is named `q2pro`/`q2pro.exe` on purpose, not just "some executable": q2pro's
// own `defaultArgs` is empty and its markers/executables list both the Windows and the
// extension-less Linux name (`ENGINE_DEFINITIONS`, `src/shared/types/engine.ts`), and the action
// bar's Play button passes no `gameDir`/`connect`/`extraArgs` (`play(installation.id)`,
// `ActionBar.tsx`) - so the real launch this flow drives spawns the file below with ZERO
// arguments, which is exactly what both stand-ins are built to tolerate:
//
//   off Windows: a real, tiny POSIX shell script (`#!/bin/sh`, sleeps briefly, exits 0),
//     `chmodSync(..., 0o755)` - `looksExecutable` off Windows needs a real execute bit, not an
//     extension (`fs-utils.ts`, story 100 D3). The brief sleep gives the launch state's `running`
//     phase a real, non-zero-width window, though the flow does not actually depend on that
//     window - see its own header for why listening to every `launch:state` broadcast makes this
//     race-proof regardless of how fast the child exits.
//   on Windows: a copy of the vendored `resources/bin/7za.exe` - a real, spawnable Win32 binary
//     that exits almost immediately when given no arguments. Copied under the name `q2pro.exe`,
//     not left as `7za.exe`, so `classifyEngine`/`rankExecutables` (`inspector.ts`) pick it up as
//     the installation's ranked client executable instead of leaving it without one.
//
// When `resources/bin/7za.exe` was never vendored locally (`npm run fetch:7za` never ran) -
// Windows only, since the shell-script stub off Windows needs no vendored binary at all - a
// placeholder file is written instead: `looksExecutable`'s Windows rule is extension-only
// (`fs-utils.ts`), so the installation still adds and classifies as q2pro and the config-edit half
// of the journey is entirely unaffected. Only the flow's own Play/launch assertions are skipped in
// that case - loudly, the same "state the reason, never pretend" gate every other flow's own
// `vendoredExtractorExists()` check already uses (e.g. `bootstrap-existing-folder.mjs`'s
// `setup()`), just scoped to one step of this flow instead of refusing the whole run.

export const LINUX_JOURNEY_INSTALL_NAME = 'Fixture Linux Journey Install'

const LINUX_JOURNEY_INSTALL_DIR = 'fixture-linux-journey-install'

/** `q2pro.exe` on Windows, extension-less `q2pro` elsewhere - both real q2pro markers. */
const LINUX_JOURNEY_EXECUTABLE_NAME = process.platform === 'win32' ? 'q2pro.exe' : 'q2pro'

/** A tiny, real POSIX shell script: sleeps briefly, then exits cleanly. Only ever written off
 * Windows - see the block comment above for why. */
const LINUX_JOURNEY_SHELL_SCRIPT = '#!/bin/sh\nsleep 0.4\nexit 0\n'

/** The real, absolute path to this repo's vendored Windows 7-Zip binary - the same file
 * `vendoredExtractorExists()` above checks for, reused here as a real spawnable stand-in. */
function vendoredWindowsExtractorPath() {
  return join(REPO_ROOT, 'resources', 'bin', '7za.exe')
}

/** True once `npm run fetch:7za` has vendored the real Windows binary. Irrelevant off Windows,
 * where the shell-script stub needs no vendored binary at all - callers only ever consult this
 * on `process.platform === 'win32'`. */
export function vendoredWindowsExtractorExists() {
  return existsSync(vendoredWindowsExtractorPath())
}

/** The real, on-disk root the flow points the folder-pick stub at - never written into
 * `state.json`; the flow registers it itself through the real Add Existing dialog. */
export function linuxJourneyInstallRoot() {
  return join(gameRoot(), LINUX_JOURNEY_INSTALL_DIR)
}

/** The real, on-disk path of the executable the journey's Play step spawns. */
export function linuxJourneyExecutablePath() {
  return join(linuxJourneyInstallRoot(), LINUX_JOURNEY_EXECUTABLE_NAME)
}

/**
 * Builds a fresh install root: `baseq2/pak0.pak` (any bytes - just needs to exist so
 * `inspectInstallation` never reports `pak0Missing`) plus the platform's stand-in client
 * executable. Returns `{ root, executablePath, spawnable }` - `spawnable` is `false` only on
 * Windows when `resources/bin/7za.exe` was never vendored, and the flow uses it to decide whether
 * to run its own Play/launch assertions or skip them loudly.
 */
export function writeLinuxJourneyInstallRoot() {
  const root = linuxJourneyInstallRoot()
  rmDirBestEffort(root)
  const baseq2Dir = join(root, 'baseq2')
  mkdirSync(baseq2Dir, { recursive: true })
  writeFileSync(join(baseq2Dir, 'pak0.pak'), 'not a real pak, just needs to exist')

  const executablePath = linuxJourneyExecutablePath()
  if (process.platform === 'win32') {
    if (vendoredWindowsExtractorExists()) {
      copyFileSync(vendoredWindowsExtractorPath(), executablePath)
      return { root, executablePath, spawnable: true }
    }
    writeFileSync(executablePath, 'placeholder - resources/bin/7za.exe was not vendored locally')
    return { root, executablePath, spawnable: false }
  }

  writeFileSync(executablePath, LINUX_JOURNEY_SHELL_SCRIPT)
  chmodSync(executablePath, 0o755)
  return { root, executablePath, spawnable: true }
}

/**
 * `pak0.pak`'s fixture size: 8 MiB - deliberately NOT `RETAIL_PAK_SIZES['pak0.pak']`
 * (183,997,730, `src/shared/constants.ts`). `inspectInstallation` tells the demo from the retail
 * game by exactly that comparison, and AC7's Demo marker is derived from the
 * `validation.pak0NotRetail` warning it raises, so a retail-sized fixture would make this flow
 * prove the opposite of what it exists for.
 */
const FIXTURE_PAK0_BYTES = 8 * 1024 * 1024

/** Mirrors `RETAIL_PAK_SIZES['pak2.pak']` (45,055). Nothing depends on it; free realism. */
const FIXTURE_PAK2_BYTES = 45_055

/** `pak1.pak`'s fixture size - distinct from `FIXTURE_PAK2_BYTES` so the two files are never confused on disk. */
const FIXTURE_PAK1_BYTES = 38_912

/**
 * How many files the discarded `ctf/` payload holds. Two jobs: it makes AC8's negative assertion
 * meaningful (a real payload the allowlist walks past), and it gives the job's tail - the final
 * revalidation plus the `rm -r` of the three extract trees, both of which happen AFTER
 * `markPlayable` - enough real work that "Play is enabled while the job is still running" (AC6) is
 * an observable window rather than a coin flip. See the sampler in
 * `scripts/flows/bootstrap-wizard.mjs`.
 *
 * Measured, not guessed: at 300 files the flow's sampler caught that window in ~60ms of samples, at
 * 900 in ~80ms. Most of it turns out to be the two `jobs:changed` round trips and their React
 * renders rather than the disk work, so raising this further buys little - it is kept at 900 for the
 * ~33% margin it does buy, and because the real 3.20 point release ships a `ctf/` payload of
 * comparable size, which makes AC8's negative assertion less artificial rather than more.
 */
const FIXTURE_CTF_FILE_COUNT = 900

/** Deterministic filler, never random, so two builds are comparable. */
function filler(bytes, byte) {
  return Buffer.alloc(bytes, byte)
}

function writeFileIn(dir, name, contents) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), contents)
}

/**
 * Builds one staging tree and zips its named top-level entries into `packages/<fileName>`.
 *
 * A `.zip` rather than a self-extracting `.exe`: the point of this fixture is that the app's REAL
 * extractor runs against a REAL archive, and a hand-forged byte sequence that merely looked like an
 * installer would prove nothing. `7za.exe` is the same binary `extractor.ts` spawns, so an archive
 * it wrote is certainly one the app can read. The entries are named explicitly rather than globbed,
 * so the archive's internal layout is stated here instead of inherited from a directory walk.
 */
function buildFixturePackage({ fileName, stagingName, entries, build }) {
  const staging = join(bootstrapStagingDir(), stagingName)
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  build(staging)

  const archivePath = join(bootstrapPackagesDir(), fileName)
  mkdirSync(bootstrapPackagesDir(), { recursive: true })
  // `7za a` APPENDS to an existing archive, so a stale one has to go first.
  rmSync(archivePath, { force: true })
  execFileSync(
    vendoredSevenZaPath(),
    ['a', '-tzip', '-mx1', '-bso0', '-bse0', '-bd', archivePath, ...entries],
    { cwd: staging, windowsHide: true },
  )

  const bytes = readFileSync(archivePath)
  return {
    fileName,
    path: archivePath,
    sizeBytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

/**
 * The three archives, in the order the job downloads them. Package ids satisfy `job.ts`'s
 * `SAFE_PATH_SEGMENT` (an id becomes an extract-directory name) and the file names satisfy
 * `paths.ts`'s `isSafeDownloadFileName` (a name becomes a cache file name) - both are refused
 * rather than sanitised, so a fixture that ignored either would fail before a byte moved.
 *
 * `wrapperNestedLayout` (story 078 D9): every package's payload moves one wrapper level deeper
 * than any candidate `assemble.ts`'s allowlist (`buildFixedEntries()`) accepts - real enough that
 * the extractor and the allowlist search genuinely run over it, not a simulated failure. See
 * `scripts/flows/bootstrap-failure.mjs`'s own header comment for exactly what this variant proves
 * and the one thing it deliberately cannot prove (a real `installationNotPlayable` failure).
 */
/** Story 080 D4: the r1q2 fixture engine package's id/version - a distinct id from the q2pro one
 * (`'q2pro-fixture-client'`), so a manifest/server can tell the two engine packages apart. Exported
 * so `scripts/flows/bootstrap-r1q2.mjs` can pass it straight to `failPrimaryOnlyFor` rather than
 * duplicating the literal. */
export const R1Q2_FIXTURE_ENGINE_ID = 'r1q2-fixture-client'
const R1Q2_FIXTURE_ENGINE_VERSION = 'r1q2-fixture-1'

/**
 * Every source-relative path `buildR1q2EnginePackage()` writes that the real allowlist
 * (`buildR1q2EngineEntries()`, `bootstrap/assemble.ts`) is expected to find - mirrors
 * `BOOTSTRAP_FIXTURE_LAYOUT`'s style, but only the engine role: demo/point-release are unchanged
 * and engine-independent, so they stay documented once, above.
 */
export const BOOTSTRAP_R1Q2_ENGINE_FIXTURE_LAYOUT = ['r1q2.exe', 'ref_r1gl.dll', 'baseq2/gamex86.dll']

/** The one file the r1q2 fixture archive carries that the allowlist must never assemble (AC3). */
export const BOOTSTRAP_R1Q2_DEDICATED_EXE_NAME = 'dedicated.exe'

/**
 * Story 080 D4: a second, R1Q2-shaped fixture engine package - real enough that the app's real
 * extractor and the real `buildR1q2EngineEntries()` allowlist both run over it, not a simulated
 * stand-in. Ships `dedicated.exe` at the archive root alongside the three required files, exactly
 * like the real pinned package (`docs/requirements/080-*.md`'s measured archive table) - so the
 * flow that consumes this package can assert the allowlist excluded a file that was genuinely
 * there, not one that never existed.
 */
function buildR1q2EnginePackage() {
  const archiveInfo = buildFixturePackage({
    fileName: 'r1q2-fixture-client.zip',
    stagingName: 'r1q2-engine',
    entries: ['r1q2.exe', 'ref_r1gl.dll', 'baseq2', 'dedicated.exe'],
    build: (staging) => {
      writeFileIn(staging, 'r1q2.exe', filler(64 * 1024, 0x52))
      writeFileIn(staging, 'ref_r1gl.dll', filler(32 * 1024, 0x67))
      writeFileIn(join(staging, 'baseq2'), 'gamex86.dll', filler(16 * 1024, 0x67))
      // Excluded by the allowlist on purpose (AC3) - a distinct fill byte from every other file
      // here, so a stray byte-for-byte comparison could never mistake it for one of the required
      // three.
      writeFileIn(staging, 'dedicated.exe', filler(24 * 1024, 0x64))
    },
  })
  return {
    role: 'engine',
    id: R1Q2_FIXTURE_ENGINE_ID,
    version: R1Q2_FIXTURE_ENGINE_VERSION,
    ...archiveInfo,
  }
}

/**
 * Story 092 D8: the Q2PRO fixture engine package's id/version - already a magic literal ("fixture-1")
 * below before this story, now named and exported so `engine-update.mjs` can assert the update job
 * landed on the manifest's own pin (`engine-update-target`) without a second, driftable copy of the
 * string.
 */
export const BOOTSTRAP_ENGINE_FIXTURE_ID = 'q2pro-fixture-client'
export const BOOTSTRAP_ENGINE_FIXTURE_VERSION = 'fixture-1'

function buildBootstrapPackages({
  demoContributesNothing = false,
  wrapperNestedLayout = false,
  includeR1q2 = false,
} = {}) {
  const engine = buildFixturePackage({
    fileName: 'q2pro-fixture-client.zip',
    stagingName: 'engine',
    entries: wrapperNestedLayout ? ['Install'] : ['q2pro64.exe', 'baseq2'],
    build: (staging) => {
      // `wrapperNestedLayout`: everything the healthy build writes at the archive root or under a
      // plain `baseq2/` instead lands under `Install/Data/` - `assemble.ts`'s engine candidates
      // (`['q2pro.exe', 'q2pro64.exe']` at the root, `baseq2/gamex86_64.dll`) have no `Install/
      // Data/` fallback at all, so this package genuinely stops contributing anything, the same as
      // the demo/point-release packages below.
      const root = wrapperNestedLayout ? join(staging, 'Install', 'Data') : staging
      // At the archive root, matching both the pinned Q2PRO release zip's own layout - which
      // calls its binary `q2pro64.exe`, not `q2pro.exe` - and `assemble.ts`'s
      // `{ from: ['q2pro.exe', 'q2pro64.exe'] }` allowlist entry (story 076 D1).
      // Story 092 D8: sizes/fill bytes come from `ENGINE_FIXTURE_FILES` (declared above,
      // module-level, already initialised by the time this build function actually runs - see that
      // constant's own doc comment) rather than repeating the literals here, so `engine-update.mjs`'s
      // on-disk byte assertions can never drift from what this archive actually contains.
      writeFileIn(
        root,
        'q2pro64.exe',
        filler(ENGINE_FIXTURE_FILES['q2pro64.exe'].sizeBytes, ENGINE_FIXTURE_FILES['q2pro64.exe'].fillByte),
      )
      // Not allowlisted, on purpose: the real engine build does ship a `baseq2/` of its own (game
      // DLLs), and AC8's guarantee has to hold for that too.
      writeFileIn(
        join(root, 'baseq2'),
        'gamex86_64.dll',
        filler(
          ENGINE_FIXTURE_FILES['baseq2/gamex86_64.dll'].sizeBytes,
          ENGINE_FIXTURE_FILES['baseq2/gamex86_64.dll'].fillByte,
        ),
      )
      // Ships alongside the binary and DLL in the same package (story 076 D1's allowlist, marked
      // optional). A few hundred bytes is enough - only its presence is ever checked.
      writeFileIn(
        join(root, 'baseq2'),
        'q2pro.menu',
        filler(
          ENGINE_FIXTURE_FILES['baseq2/q2pro.menu'].sizeBytes,
          ENGINE_FIXTURE_FILES['baseq2/q2pro.menu'].fillByte,
        ),
      )
    },
  })

  const demo = buildFixturePackage({
    fileName: 'q2-demo-fixture.zip',
    stagingName: 'demo',
    entries: ['Install'],
    build: (staging) => {
      // Nested under `Install/Data/` - the real id Software InstallShield demo installer's actual
      // layout (measured 2026-09-08, story 076's Requirement table), not the flat `baseq2/` the
      // fixture used to guess. No `video/` anywhere in this package: the real archive has none
      // (AC4 - an absent `video/` is a normal outcome, never an error).
      //
      // `wrapperNestedLayout` (story 078 D9) nests one level deeper still, under `Install/Data/
      // Setup/` - `assemble.ts`'s demo candidate list already accepts plain `Install/Data/baseq2/
      // pak0.pak` as a fallback (story 076 D1), so matching that exact shape would leave this
      // package healthy rather than broken. `demoContributesNothing` (story 076 D6) is a
      // different, narrower brokenness (the required file withheld outright, not moved) and stays
      // independent of this option - both default off, so neither changes the other's behaviour.
      const baseq2 = wrapperNestedLayout
        ? join(staging, 'Install', 'Data', 'Setup', 'baseq2')
        : join(staging, 'Install', 'Data', 'baseq2')
      if (!demoContributesNothing) {
        writeFileIn(baseq2, 'pak0.pak', filler(FIXTURE_PAK0_BYTES, 0x50))
      }
      writeFileIn(join(baseq2, 'players', 'male'), 'tris.md2', filler(4 * 1024, 0x54))
    },
  })

  const pointRelease = buildFixturePackage({
    fileName: 'q2-point-release-fixture.zip',
    stagingName: 'point-release',
    // The `ctf`/`xatrix`/`rogue` discard payload (AC8's negative assertion, and the file count
    // that gives `bootstrap-wizard.mjs`'s AC6 sampler something to catch) is dropped entirely for
    // `wrapperNestedLayout`: this variant's flow never asserts either of those, and the discard
    // payload's only other job - slowing the run down enough for a mid-job sample - is not needed
    // for a run this flow expects to fail, not catch mid-flight.
    entries: wrapperNestedLayout ? ['Install'] : ['baseq2', 'ctf', 'xatrix', 'rogue'],
    build: (staging) => {
      if (wrapperNestedLayout) {
        // Nested under `Install/Data/`, same wrapper as the demo package above. Unlike demo's
        // `baseq2/pak0.pak`, `assemble.ts` has no `Install/Data/` fallback candidate at all for
        // `baseq2/pak1.pak`/`baseq2/pak2.pak` (story 076 D1's Requirement table only measured the
        // demo installer nesting its payload, not the point-release one) - so this single wrapper
        // level is already enough to break it, no extra nesting needed.
        const baseq2 = join(staging, 'Install', 'Data', 'baseq2')
        writeFileIn(baseq2, 'pak1.pak', filler(FIXTURE_PAK1_BYTES, 0x51))
        writeFileIn(baseq2, 'pak2.pak', filler(FIXTURE_PAK2_BYTES, 0x52))
        writeFileIn(join(baseq2, 'players', 'male'), 'tris.md2', filler(4 * 1024, 0x54))
        return
      }
      writeFileIn(join(staging, 'baseq2'), 'pak1.pak', filler(FIXTURE_PAK1_BYTES, 0x51))
      writeFileIn(join(staging, 'baseq2'), 'pak2.pak', filler(FIXTURE_PAK2_BYTES, 0x52))
      // The real 3.20 full/CTF package ships `baseq2/players/` directly under its own `baseq2/`
      // - not nested under `Install/Data/` like the demo above.
      writeFileIn(join(staging, 'baseq2', 'players', 'male'), 'tris.md2', filler(4 * 1024, 0x54))
      for (let index = 0; index < FIXTURE_CTF_FILE_COUNT; index += 1) {
        writeFileIn(join(staging, 'ctf'), `ctf-payload-${index}.dat`, filler(4 * 1024, 0x43))
      }
      writeFileIn(join(staging, 'xatrix'), 'pak0.pak', filler(8 * 1024, 0x58))
      writeFileIn(join(staging, 'rogue'), 'pak0.pak', filler(8 * 1024, 0x47))
    },
  })

  const result = [
    { role: 'engine', id: BOOTSTRAP_ENGINE_FIXTURE_ID, version: BOOTSTRAP_ENGINE_FIXTURE_VERSION, ...engine },
    { role: 'demo', id: 'q2-demo-fixture', version: '3.14-fixture', ...demo },
    {
      role: 'point-release',
      id: 'q2-point-release-fixture',
      version: '3.20-fixture',
      ...pointRelease,
    },
  ]
  // Story 080 D4: additive, defaulted off - every existing caller keeps getting exactly the three
  // entries above, in the same order, with the same fields.
  if (includeR1q2) result.push(buildR1q2EnginePackage())
  return result
}

/**
 * Every source-relative path `buildBootstrapPackages()` actually writes, by role - literal, not
 * computed, so a later deliverable (076 D5) can cross-check it against a real-archive listing and
 * against `assemble.ts`'s allowlist candidates without re-deriving it. Deliberately excludes the
 * `ctf`/`xatrix`/`rogue` discard payloads: this documents what the ALLOWLIST is expected to find,
 * not everything the archive contains.
 */
export const BOOTSTRAP_FIXTURE_LAYOUT = {
  engine: ['q2pro64.exe', 'baseq2/gamex86_64.dll', 'baseq2/q2pro.menu'],
  demo: ['Install/Data/baseq2/pak0.pak', 'Install/Data/baseq2/players/male/tris.md2'],
  'point-release': ['baseq2/pak1.pak', 'baseq2/pak2.pak', 'baseq2/players/male/tris.md2'],
}

/**
 * Creates the target folder fresh, holding exactly one loose file. Called on every run, which is
 * what makes the flow re-runnable: a previous run left a whole assembled installation in there.
 */
export function writeBootstrapTargetDir() {
  const target = assertInside(UI_VERIFY_ROOT, bootstrapTargetDir(), 'bootstrap target')
  rmDirBestEffort(target)
  mkdirSync(target, { recursive: true })
  writeFileSync(
    join(target, BOOTSTRAP_TARGET_LOOSE_FILE),
    'A file of the user that was already sitting in this folder.\n',
    'utf8',
  )
  return target
}

/**
 * Story 077 D5: the target `scripts/flows/bootstrap-failure-retry.mjs`'s OWN wizard-created
 * installation uses - a sibling of `bootstrapTargetDir()` above, not that same folder. That one is
 * deliberately pre-seeded non-empty (AC3's warning, story 074); this one has to be genuinely FRESH -
 * the story's own "Decided during refine" note is explicit that the failing-then-succeeding run
 * happens against an installation the flow creates itself, distinct from the pre-seeded fixture row
 * `populatedInstallations()` adds for AC1's restart proof.
 */
export function bootstrapFailureRetryTargetDir() {
  return join(bootstrapFixtureRoot(), 'target', 'Failure Retry Demo')
}

/**
 * Deletes any leftover from a previous run and returns the (non-existent) path - what makes the
 * flow re-runnable without a manual reseed: a previous run's second (succeeding) wizard pass would
 * otherwise leave a fully assembled installation sitting where the next run needs a fresh folder.
 * Unlike `writeBootstrapTargetDir()`, this never recreates the directory or seeds a loose file in
 * it - the wizard's own `create()` step is what brings it into being, on the flow's first run.
 */
export function resetBootstrapFailureRetryTargetDir() {
  const target = assertInside(
    UI_VERIFY_ROOT,
    bootstrapFailureRetryTargetDir(),
    'bootstrap failure-retry target',
  )
  rmDirBestEffort(target)
  return target
}

/** How many body chunks each archive response is split into, and the pause between them. */
const BOOTSTRAP_SERVE_CHUNKS = 10
const BOOTSTRAP_SERVE_CHUNK_DELAY_MS = 45

/**
 * Starts the loopback fixture server and returns `{ baseUrl, packages, totalSizeBytes, close }`.
 *
 * **Bound to `127.0.0.1` explicitly, on an OS-assigned port.** The address is not decoration: the
 * app's harness override (`src/main/modules/downloads/harness.ts`) refuses any base URL whose
 * hostname is not literally `127.0.0.1`, and so does the harness-only package-URL schema
 * (`harnessLoopbackUrlSchema`) - a fixture server on any other interface could not be reached even
 * with both gates open.
 *
 * Archive bodies are streamed in `BOOTSTRAP_SERVE_CHUNKS` chunks with a small pause between them.
 * That is not throttling for its own sake: on loopback these archives transfer in single-digit
 * milliseconds, and the flow needs the download phase to last long enough to activate the freshly
 * registered installation before the job reaches its playable moment (AC6). `content-length` is
 * still the real, full size, so `fetcher.ts`'s size pre-check and its 30s stall detector both see
 * exactly what they would see from a real mirror.
 *
 * Only the paths registered below exist; everything else answers 404, so a request the app should
 * never make shows up as a failure rather than as silence.
 *
 * `demoContributesNothing` (story 076 D6) forwards straight into `buildBootstrapPackages()` - see
 * its own doc comment. Defaulted off, so every existing caller keeps working unchanged.
 *
 * `failFirstAttemptFor` (story 077 D5): a package id (`buildBootstrapPackages()`'s own `id`, e.g.
 * `'q2pro-fixture-client'`) whose PRIMARY url and MIRROR url each 404 on their own first request,
 * then serve that same package normally on every request after. This has to be a property of the
 * *server*, not of the flow driving it: `Q2L_UI_CONTENT_REPO_BASE` is fixed for the whole app
 * session (`src/main/lib/ui-harness.ts` reads it once), so a single flow that wants to prove both
 * the failing first run (AC1/AC5) and the adopting, succeeding retry (AC4/AC7) in one app session
 * has no other way to make the second attempt succeed where the first did not (Decisions (Refine)).
 * Undefined/omitted changes nothing about how every existing caller behaves.
 *
 * `wrapperNestedLayout` (story 078 D9) forwards straight into `buildBootstrapPackages()` too - see
 * its own doc comment and `scripts/flows/bootstrap-failure.mjs`. Defaulted off, like the two above.
 *
 * `includeR1q2` (story 080 D4) forwards into `buildBootstrapPackages()` and, when true, also makes
 * `/engines/manifest.json` list a second `kind:'engine', engine:'r1q2'` package and pin it
 * (`pinned.r1q2`) alongside q2pro's. Defaulted off - a server started without it emits byte-identical
 * output to every caller that predates this option.
 *
 * `failPrimaryOnlyFor` (story 080 D4, AC2): a package id, or an array of ids, whose PRIMARY url
 * (`/packages/<file>`) 404s on EVERY request, forever, while its MIRROR url (`/mirror/<file>`) serves
 * normally from the very first request. Unlike `failFirstAttemptFor` above (which models a whole
 * failed job that a retry then adopts), this models a single download attempt whose community/primary
 * transport is down but whose original/mirror URL works - the literal AC2 wording. Independent of
 * `failFirstAttemptFor`: both can be given for *different* package ids without either silently
 * disabling the other; combining them for the SAME id is not a supported/needed combination.
 *
 * `bleedingEdgeVersion` (story 092 D8): when given, registers `/packages/version.txt` - a plain-text
 * body of this string - alongside the Q2PRO engine package's own `/packages/<fileName>` route.
 * `probeBleedingEdge()` (`src/main/modules/downloads/engine/bleeding-edge.ts`) derives its
 * `version.txt` request by swapping the pinned package's asset URL's own final path segment, which
 * for this server is always `/packages/<engine fileName>` - so the sibling path is always
 * `/packages/version.txt`, regardless of the engine package's own file name. Defaulted off (`undefined`
 * registers no route at all), so every caller that predates this option keeps getting exactly the
 * same 404-everything-else behaviour it always has.
 */
export async function startBootstrapFixtureServer({
  demoContributesNothing = false,
  failFirstAttemptFor,
  wrapperNestedLayout = false,
  includeR1q2 = false,
  failPrimaryOnlyFor,
  bleedingEdgeVersion,
} = {}) {
  const packages = buildBootstrapPackages({ demoContributesNothing, wrapperNestedLayout, includeR1q2 })

  const failFirstPackage = failFirstAttemptFor
    ? packages.find((pkg) => pkg.id === failFirstAttemptFor)
    : undefined
  if (failFirstAttemptFor && !failFirstPackage) {
    throw new Error(
      `startBootstrapFixtureServer: failFirstAttemptFor ${JSON.stringify(failFirstAttemptFor)} ` +
        `matches no package id (have: ${packages.map((pkg) => pkg.id).join(', ')})`,
    )
  }
  /** The primary and mirror request paths that must 404 exactly once. Empty when the option is
   * unused, so nothing about a server started without it changes. */
  const failFirstPaths = failFirstPackage
    ? new Set([`/packages/${failFirstPackage.fileName}`, `/mirror/${failFirstPackage.fileName}`])
    : new Set()
  /** Which of `failFirstPaths` has already 404'd once - so the SECOND request to it (the retry) is
   * served normally. */
  const failedOnce = new Set()

  const failPrimaryIds = new Set(
    failPrimaryOnlyFor === undefined
      ? []
      : Array.isArray(failPrimaryOnlyFor)
        ? failPrimaryOnlyFor
        : [failPrimaryOnlyFor],
  )
  for (const id of failPrimaryIds) {
    if (!packages.some((pkg) => pkg.id === id)) {
      throw new Error(
        `startBootstrapFixtureServer: failPrimaryOnlyFor ${JSON.stringify(id)} matches no package ` +
          `id (have: ${packages.map((pkg) => pkg.id).join(', ')})`,
      )
    }
  }
  /** PRIMARY-only request paths that 404 on every request, forever - never the mirror path. */
  const failPrimaryPaths = new Set(
    packages
      .filter((pkg) => failPrimaryIds.has(pkg.id))
      .map((pkg) => `/packages/${pkg.fileName}`),
  )

  /** Everything this server is willing to serve, by request path. */
  const routes = new Map()
  /** Every path that was requested, in order - the flow prints it as its own offline evidence. */
  const requested = []

  const server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0]
    requested.push(path)
    if (failPrimaryPaths.has(path)) {
      response.writeHead(404, { 'content-type': 'text/plain' })
      response.end('not found (failPrimaryOnlyFor - primary permanently down)')
      return
    }
    if (failFirstPaths.has(path) && !failedOnce.has(path)) {
      failedOnce.add(path)
      response.writeHead(404, { 'content-type': 'text/plain' })
      response.end('not found (failFirstAttemptFor - first attempt only)')
      return
    }
    const route = routes.get(path)
    if (!route) {
      response.writeHead(404, { 'content-type': 'text/plain' })
      response.end('not found')
      return
    }
    void route(response)
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  const { port } = server.address()
  const baseUrl = `http://127.0.0.1:${port}`

  const jsonRoute = (body) => (response) => {
    const bytes = Buffer.from(JSON.stringify(body), 'utf8')
    response.writeHead(200, {
      'content-type': 'application/json',
      'content-length': bytes.byteLength,
    })
    response.end(bytes)
  }

  const archiveRoute = (archivePath) => async (response) => {
    const bytes = readFileSync(archivePath)
    response.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': bytes.byteLength,
    })
    const chunkSize = Math.ceil(bytes.byteLength / BOOTSTRAP_SERVE_CHUNKS)
    for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
      response.write(bytes.subarray(offset, Math.min(offset + chunkSize, bytes.byteLength)))
      await new Promise((done) => setTimeout(done, BOOTSTRAP_SERVE_CHUNK_DELAY_MS))
    }
    response.end()
  }

  const manifestPackage = (pkg, extra) => ({
    ...extra,
    id: pkg.id,
    version: pkg.version,
    sizeBytes: pkg.sizeBytes,
    sha256: pkg.sha256,
    url: `${baseUrl}/packages/${pkg.fileName}`,
    // A non-empty `mirrors` array, so the schema's mirror rule is exercised rather than bypassed.
    // Both entries work; the primary always succeeds here, so the mirror is never actually read.
    mirrors: [`${baseUrl}/mirror/${pkg.fileName}`],
    contents: [{ from: '.', to: extra.kind === 'engine' ? 'root' : 'baseq2' }],
  })

  // `q2pro-fixture-client` is always first in `packages` (see `buildBootstrapPackages()`), so this
  // finds it even when the r1q2 entry below is also present with the same `role`.
  const engine = packages.find((pkg) => pkg.role === 'engine')
  const demo = packages.find((pkg) => pkg.role === 'demo')
  const pointRelease = packages.find((pkg) => pkg.role === 'point-release')
  const r1q2Engine = includeR1q2 ? packages.find((pkg) => pkg.id === R1Q2_FIXTURE_ENGINE_ID) : undefined

  // Mirrors `ENGINES_MANIFEST_PATH`/`GAMEDATA_MANIFEST_PATH` (`manifest-service.ts`) and the
  // envelope shape of the real shipped files (`content/q2_community_content/*/manifest.json`).
  // `includeR1q2` false (the default): byte-identical to the envelope every existing caller reads.
  routes.set(
    '/engines/manifest.json',
    jsonRoute(
      r1q2Engine
        ? {
            schemaVersion: 1,
            packages: [
              manifestPackage(engine, { kind: 'engine', engine: 'q2pro' }),
              manifestPackage(r1q2Engine, { kind: 'engine', engine: 'r1q2' }),
            ],
            pinned: { q2pro: engine.id, r1q2: r1q2Engine.id },
          }
        : {
            schemaVersion: 1,
            packages: [manifestPackage(engine, { kind: 'engine', engine: 'q2pro' })],
            pinned: { q2pro: engine.id },
          },
    ),
  )
  routes.set(
    '/gamedata/manifest.json',
    jsonRoute({
      schemaVersion: 1,
      packages: [
        manifestPackage(demo, { kind: 'gamedata', role: 'demo' }),
        manifestPackage(pointRelease, { kind: 'gamedata', role: 'point-release' }),
      ],
    }),
  )
  for (const pkg of packages) {
    routes.set(`/packages/${pkg.fileName}`, archiveRoute(pkg.path))
    routes.set(`/mirror/${pkg.fileName}`, archiveRoute(pkg.path))
  }
  if (bleedingEdgeVersion !== undefined) {
    routes.set('/packages/version.txt', (response) => {
      const bytes = Buffer.from(`${bleedingEdgeVersion}\n`, 'utf8')
      response.writeHead(200, { 'content-type': 'text/plain', 'content-length': bytes.byteLength })
      response.end(bytes)
    })
  }

  return {
    baseUrl,
    packages,
    requested,
    /** Sum of the three archives' real sizes - the figure the confirm step must state (AC4). */
    totalSizeBytes: packages.reduce((total, pkg) => total + pkg.sizeBytes, 0),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      }),
  }
}

/**
 * Story 100 D8 (AC7): the "no engine for this platform" host process never actually runs on
 * (`process.platform` is always `'win32'`, `'linux'` or `'darwin'` - see `manifest-parse.ts`'s
 * `packagePlatforms()`) - a literal that can never equal the running host's own platform, on any
 * machine this flow runs on (a dev box or either CI leg), so the fixture manifest below is honest
 * everywhere rather than only off one specific host.
 */
const NO_ENGINE_FOR_PLATFORM_PLATFORM = 'q2l-fixture-unsupported-platform'

/**
 * Story 100 D8 (AC7): a second, much smaller fixture server than `startBootstrapFixtureServer()`
 * above, for `scripts/flows/bootstrap-no-engine-for-platform.mjs` - the D7/D8 "manifest pins
 * something, just not for this host" case (`bootstrapEngineOptions`'s `emptyReason:
 * 'none-for-platform'`, `src/main/modules/downloads/index.ts`).
 *
 * `engines/manifest.json` pins Q2PRO, but only for `NO_ENGINE_FOR_PLATFORM_PLATFORM` above - a
 * platform no real host ever reports as - so `hasAnyPin` is true (the manifest DOES configure a
 * pin) while `pinnedEnginePackage()` resolves nothing for the running host, which is exactly what
 * turns an empty `options` array into `'none-for-platform'` rather than `'none-pinned'`
 * (`manifest-parse.ts`'s `resolvePinned`/`packageRunsOnPlatform`). `gamedata/manifest.json` carries
 * no packages and no pins at all - `ManifestService.fetchAndMerge()` needs both files to parse, but
 * nothing about this flow ever reaches a package download, so it only has to be a well-formed,
 * empty envelope.
 *
 * Unlike `startBootstrapFixtureServer()`, no archive is staged and no `/packages/...` route is
 * registered at all: the flow never gets past the engine step's empty state, so a request there
 * would be this fixture's own bug, not something to serve.
 */
export async function startNoEngineForPlatformFixtureServer() {
  const routes = new Map()
  const requested = []

  const server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0]
    requested.push(path)
    const route = routes.get(path)
    if (!route) {
      response.writeHead(404, { 'content-type': 'text/plain' })
      response.end('not found')
      return
    }
    route(response)
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  const { port } = server.address()
  const baseUrl = `http://127.0.0.1:${port}`

  const jsonRoute = (body) => (response) => {
    const bytes = Buffer.from(JSON.stringify(body), 'utf8')
    response.writeHead(200, { 'content-type': 'application/json', 'content-length': bytes.byteLength })
    response.end(bytes)
  }

  const packageId = 'q2pro-fixture-unsupported-platform'
  routes.set(
    '/engines/manifest.json',
    jsonRoute({
      schemaVersion: 1,
      packages: [
        {
          id: packageId,
          version: 'fixture-unsupported-1',
          sizeBytes: 1024,
          sha256: createHash('sha256').update(packageId).digest('hex'),
          url: `${baseUrl}/packages/${packageId}.zip`,
          mirrors: [`${baseUrl}/mirror/${packageId}.zip`],
          contents: [{ from: '.', to: 'root' }],
          kind: 'engine',
          engine: 'q2pro',
          platforms: [NO_ENGINE_FOR_PLATFORM_PLATFORM],
        },
      ],
      pinned: { q2pro: { [NO_ENGINE_FOR_PLATFORM_PLATFORM]: packageId } },
    }),
  )
  routes.set('/gamedata/manifest.json', jsonRoute({ schemaVersion: 1, packages: [] }))

  return {
    baseUrl,
    requested,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      }),
  }
}

/**
 * Every entry in `targetPath`, one level deep, as `{ dirs, files }`. Read from Node rather than
 * scraped off the UI, because AC8 is a statement about the filesystem, not about a rendered list.
 */
export function readTargetTree(targetPath) {
  const dirs = []
  const files = []
  for (const name of readdirSync(targetPath)) {
    if (statSync(join(targetPath, name)).isDirectory()) dirs.push(name)
    else files.push(name)
  }
  return { dirs: dirs.sort(), files: files.sort() }
}

// --- story 088 D6: the fixture "store installations" the retail-import flow copies from ----------
//
// `scripts/flows/bootstrap-retail-import.mjs` needs two detected Steam/GOG installations that
// genuinely exist on disk: the job re-verifies the chosen source's paks before copying and then
// copies the real bytes through `assemble.ts`'s allowlist, so nothing here can be a stub. What CAN
// be avoided is writing 184 MB of content - the launcher's retail check is a SIZE comparison
// (`RETAIL_PAK_SIZES`, `src/shared/constants.ts`), so every pak below is created empty and then
// `truncateSync`d to its exact retail length (story 088's own "Decided during refine" note:
// "Fixture paks are created with `truncate` at the exact retail sizes, not by writing bytes ... a
// 184 MB fixture costs metadata, not I/O"). The copy the job performs afterwards is of course real.
//
// Two installations, deliberately different verdicts, because one wizard run has to show both
// halves of the picker at once (AC2 "identified by its store and its path", AC3 "listed but not
// selectable, with the reason"):
//
//   gog   - `baseq2/pak0.pak` at the 8 MiB demo size instead of the retail one, `pak1.pak` correct.
//           The ONLY defect is pak0's size, so its verdict is exactly `pak0SizeMismatch` and not
//           some incidental "pak1 is missing" instead.
//   steam - pak0/pak1/pak2 all at their exact `RETAIL_PAK_SIZES` length: verified, and the one the
//           flow installs from.
//
// Both also carry payload the allowlist must DISCARD - `ctf/`, `xatrix/`, `rogue/`, a `pak3.pak`
// and a loose `quake2.exe` - so AC7 ("no ctf/xatrix/rogue directory is created even if the source
// installation has one") is a claim about real, rejected input rather than about input that never
// existed. Neither has `baseq2/video` or `baseq2/players`, which is also what makes the confirm
// step's video/players toggle render disabled with its reason (story 088's binding user decision).

/**
 * Mirrors src/shared/constants.ts:54 (`RETAIL_PAK_SIZES`) - classic Quake II 3.20, the sizes
 * `inspectRetailSource` compares against. Exported so the flow can assert the copied files' sizes
 * against the same numbers rather than re-deriving them from the fixture it just wrote.
 */
export const RETAIL_PAK_SIZES = {
  'pak0.pak': 183_997_730,
  'pak1.pak': 12_992_754,
  'pak2.pak': 45_055,
}

/** The unverified fixture's deliberately wrong `pak0.pak` length: the 8 MiB demo pak0 size, the
 * single most plausible "this is not retail" case a user could actually have. */
const UNVERIFIED_PAK0_BYTES = 8 * 1024 * 1024

/** `baseq2/pak3.pak` - present in both sources, in the allowlist of neither. */
const RETAIL_SOURCE_STRAY_PAK = 'pak3.pak'
/** A loose file in the source root that must not be copied either. */
const RETAIL_SOURCE_STRAY_FILE = 'quake2.exe'
/** Mission-pack directories AC7 forbids in the target; both fixture sources ship all three. */
const RETAIL_SOURCE_DISCARDED_DIRS = ['ctf', 'xatrix', 'rogue']

/** Where the two fixture store installations live - siblings under the bootstrap fixture root. */
function retailSourceRoot(store) {
  return join(bootstrapFixtureRoot(), 'store-sources', store)
}

/** The folder `scripts/flows/bootstrap-retail-import.mjs` installs into - its own sibling of
 * `bootstrapTargetDir()`/`bootstrapR1q2TargetDir()`, so the three bootstrap flows never race over
 * one directory. Fresh and empty: target warnings are already proven by `bootstrap-wizard.mjs`. */
export function bootstrapRetailTargetDir() {
  return join(bootstrapFixtureRoot(), 'target', 'Retail Import')
}

/** Fresh, empty target folder for the retail-import flow - deletes any leftover from a previous run. */
export function writeBootstrapRetailTargetDir() {
  const target = assertInside(UI_VERIFY_ROOT, bootstrapRetailTargetDir(), 'bootstrap retail target')
  rmDirBestEffort(target)
  mkdirSync(target, { recursive: true })
  return target
}

/** Story 089 D6: the folder `scripts/flows/bootstrap-existing-folder.mjs` installs into - its own
 * sibling of `bootstrapTargetDir()`/`bootstrapRetailTargetDir()`, so the bootstrap flows never race
 * over one directory. Fresh and empty: target warnings are already proven by `bootstrap-wizard.mjs`. */
export function bootstrapExistingFolderTargetDir() {
  return join(bootstrapFixtureRoot(), 'target', 'Existing Folder Import')
}

/** Fresh, empty target folder for the existing-folder flow - deletes any leftover from a previous run. */
export function writeBootstrapExistingFolderTargetDir() {
  const target = assertInside(
    UI_VERIFY_ROOT,
    bootstrapExistingFolderTargetDir(),
    'bootstrap existing-folder target',
  )
  rmDirBestEffort(target)
  mkdirSync(target, { recursive: true })
  return target
}

/** An empty file stretched to `sizeBytes` - metadata only, no content written (see above). */
function writeSizedFile(path, sizeBytes) {
  writeFileSync(path, '')
  truncateSync(path, sizeBytes)
}

/**
 * Mirrors `inspectRetailSource` (`src/main/modules/downloads/bootstrap/retail-source.ts`) closely
 * enough to describe THESE fixtures: every field is read off the files just written, so the
 * `DetectedRetailSource[]` handed to the app through `Q2L_UI_HARNESS_STORE_SOURCES` states facts
 * about real bytes on disk rather than a hand-authored verdict. That matters beyond tidiness: the
 * job re-checks `inspection.verified` before copying (`verifyCopySource`, `bootstrap/job.ts`), so a
 * fixture whose injected verdict disagreed with its own files would either fail the run or - worse -
 * make a passing run prove nothing.
 */
function inspectFixtureRetailSource(rootPath) {
  const baseq2 = join(rootPath, 'baseq2')
  const inspectPak = (name) => {
    const path = join(baseq2, name)
    if (!existsSync(path)) return { exists: false, sizeBytes: null, matchesRetailSize: false }
    const sizeBytes = statSync(path).size
    return { exists: true, sizeBytes, matchesRetailSize: sizeBytes === RETAIL_PAK_SIZES[name] }
  }

  const pak0 = inspectPak('pak0.pak')
  const pak1 = inspectPak('pak1.pak')
  const pak2 = inspectPak('pak2.pak')

  let unverifiedReason
  if (!existsSync(baseq2)) unverifiedReason = 'bootstrap.retailSource.baseDirMissing'
  else if (!pak0.exists) unverifiedReason = 'bootstrap.retailSource.pak0Missing'
  else if (!pak0.matchesRetailSize) unverifiedReason = 'bootstrap.retailSource.pak0SizeMismatch'
  else if (!pak1.exists) unverifiedReason = 'bootstrap.retailSource.pak1Missing'
  else if (!pak1.matchesRetailSize) unverifiedReason = 'bootstrap.retailSource.pak1SizeMismatch'

  return {
    rootPath,
    pak0,
    pak1,
    pak2,
    verified: unverifiedReason === undefined,
    ...(unverifiedReason ? { unverifiedReason } : {}),
    hasVideo: existsSync(join(baseq2, 'video')),
    hasPlayers: existsSync(join(baseq2, 'players')),
  }
}

/** One fixture store installation on disk: `baseq2` with the requested pak sizes, plus the payload
 * the allowlist has to discard. */
function writeRetailSourceTree(store, { pak0Bytes, pak1Bytes, pak2Bytes }) {
  const root = assertInside(UI_VERIFY_ROOT, retailSourceRoot(store), `retail source ${store}`)
  rmDirBestEffort(root)

  const baseq2 = join(root, 'baseq2')
  mkdirSync(baseq2, { recursive: true })
  writeSizedFile(join(baseq2, 'pak0.pak'), pak0Bytes)
  writeSizedFile(join(baseq2, 'pak1.pak'), pak1Bytes)
  if (pak2Bytes !== undefined) writeSizedFile(join(baseq2, 'pak2.pak'), pak2Bytes)
  writeSizedFile(join(baseq2, RETAIL_SOURCE_STRAY_PAK), 4096)
  writeFileSync(join(root, RETAIL_SOURCE_STRAY_FILE), 'not the launcher’s engine\n', 'utf8')
  for (const dir of RETAIL_SOURCE_DISCARDED_DIRS) {
    mkdirSync(join(root, dir), { recursive: true })
    writeSizedFile(join(root, dir, 'pak0.pak'), 2048)
  }

  return root
}

/**
 * Writes both fixture store installations and returns them as the `DetectedRetailSource[]` the
 * `Q2L_UI_HARNESS_STORE_SOURCES` override expects (`resolveDetectedRetailSourcesOverride`,
 * `src/main/modules/downloads/harness.ts`) - `{ source, rootPath, inspection }` per entry, the exact
 * shape `listDetectedRetailSources` would have produced had a real Steam/GOG library been there.
 *
 * The GOG (unverified) entry comes FIRST on purpose: it puts the not-selectable row at the top of
 * the picker, where a list that silently dropped it would be most obvious, and it makes the
 * wizard's "default to the first verified source" convenience (`selectDataSource`,
 * `BootstrapWizard.tsx`) genuinely skip a row rather than trivially land on row 0.
 */
export function writeBootstrapStoreSources() {
  const gogRoot = writeRetailSourceTree('gog', {
    pak0Bytes: UNVERIFIED_PAK0_BYTES,
    pak1Bytes: RETAIL_PAK_SIZES['pak1.pak'],
  })
  const steamRoot = writeRetailSourceTree('steam', {
    pak0Bytes: RETAIL_PAK_SIZES['pak0.pak'],
    pak1Bytes: RETAIL_PAK_SIZES['pak1.pak'],
    pak2Bytes: RETAIL_PAK_SIZES['pak2.pak'],
  })

  return [
    { source: 'gog', rootPath: gogRoot, inspection: inspectFixtureRetailSource(gogRoot) },
    { source: 'steam', rootPath: steamRoot, inspection: inspectFixtureRetailSource(steamRoot) },
  ]
}

// --- story 089 D6: the hand-picked "existing folder" game-data source ---------------------------
//
// `scripts/flows/bootstrap-existing-folder.mjs` needs a plain folder on disk - deliberately NOT one
// of `writeBootstrapStoreSources()`'s "detected store" fixtures, since the whole point of this data
// source is that the launcher never found it on its own. Same truncate-to-exact-size trick as
// `writeRetailSourceTree` above (no real 184 MB written), and the same discarded payload
// (`ctf`/`xatrix`/`rogue`, a stray `pak3.pak`, a loose file) so AC7's "no forbidden directory is
// created even though the source has one" has something real to prove against.

/** Where the fixture "existing folder" source lives - a sibling of `retailSourceRoot()`'s "store
 * sources" dir, but its own top-level name: this folder was never detected, so it must not read as
 * one of the detected-store fixtures even by its path. */
function existingFolderSourceRoot() {
  return join(bootstrapFixtureRoot(), 'existing-folder-source')
}

export function bootstrapExistingFolderSourceDir() {
  return existingFolderSourceRoot()
}

/**
 * Writes a plain folder with `baseq2/pak0.pak` (+`pak1.pak` for a retail folder), sized exactly for
 * the case requested - `retail: true` for a `kind: 'retail'` verdict (both paks at their exact
 * `RETAIL_PAK_SIZES` length), `retail: false` for a `kind: 'demo'` verdict (only a demo-sized pak0,
 * no pak1 at all - `inspectGameDataSource` reports `kind: 'demo'` whenever pak0 exists but the pair
 * does not verify as retail). Also writes the same discarded payload
 * `writeRetailSourceTree` writes for the detected-store fixtures - `ctf`/`xatrix`/`rogue`,
 * `pak3.pak`, a loose `quake2.exe` - so AC7 has real bytes to prove were never copied.
 */
export function writeBootstrapExistingFolderSource({ retail }) {
  const root = assertInside(UI_VERIFY_ROOT, existingFolderSourceRoot(), 'existing-folder source')
  rmDirBestEffort(root)

  const baseq2 = join(root, 'baseq2')
  mkdirSync(baseq2, { recursive: true })
  writeSizedFile(
    join(baseq2, 'pak0.pak'),
    retail ? RETAIL_PAK_SIZES['pak0.pak'] : UNVERIFIED_PAK0_BYTES,
  )
  if (retail) writeSizedFile(join(baseq2, 'pak1.pak'), RETAIL_PAK_SIZES['pak1.pak'])
  writeSizedFile(join(baseq2, RETAIL_SOURCE_STRAY_PAK), 4096)
  writeFileSync(join(root, RETAIL_SOURCE_STRAY_FILE), 'not the launcher’s engine\n', 'utf8')
  for (const dir of RETAIL_SOURCE_DISCARDED_DIRS) {
    mkdirSync(join(root, dir), { recursive: true })
    writeSizedFile(join(root, dir, 'pak0.pak'), 2048)
  }

  return root
}

/**
 * Story 089 D5: the AC5 counterpart to `writeBootstrapExistingFolderSource({ retail: false })` -
 * a folder that exists but has no `baseq2/pak0.pak` at all, so `inspectGameDataSource` reports
 * `kind: 'unusable'` with `bootstrap.gameDataSource.baseDirMissing` (no `baseq2` directory
 * whatsoever - the simplest, least ambiguous way to be pak0-less). Same root as the retail/demo
 * fixture (`existingFolderSourceRoot()`) so the flow needs no second `Q2L_UI_PICK_FOLDER` path.
 */
export function writeBootstrapExistingFolderUnusableSource() {
  const root = assertInside(UI_VERIFY_ROOT, existingFolderSourceRoot(), 'existing-folder source')
  rmDirBestEffort(root)
  mkdirSync(root, { recursive: true })
  return root
}

// --- story 103 D8: the windows-build-on-linux e2e proof's own install root ---------------------
//
// `windows-build-on-linux.mjs` needs an install root `inspectInstallation` ranks exactly the way a
// real "someone copied their Windows Quake II folder onto a Linux machine" install would: a real
// MZ-header `quake2.exe` (D1/D2's `readBinaryKind` has to classify it as `'pe'`, not merely exist),
// retail-sized paks so nothing OTHER than the runner story shows up in `installation.checks`, and -
// the story's own fixture requirement for this deliverable - a real ELF-header `quake2` alongside it,
// execute bit and all.
//
// The two cannot both be active ranking candidates at once, though: D2's own `rankExecutables`
// ranks a native ELF/script ahead of a PE unconditionally off Windows (see that function's own doc
// comment - "a folder holding both `quake2` and `quake2.exe` on Linux must pick the one the machine
// can actually execute"), so a root carrying both would have Linux pick the ELF file and never raise
// AC2's `executable-runnable` check at all - the opposite of what half of this flow needs to prove.
// `includeNativeElf` (default `true`, matching the deliverable's own fixture description literally -
// "an install root ... containing a real MZ-header quake2.exe and (for the ranking half) a native
// quake2") lets the flow's Windows branch use the combined root as-is (ranking is a non-event there:
// `looksExecutable` is extension-only on win32, so the extension-less `quake2` is never even a
// candidate - AC8), while the Linux branch's AC2/AC6/AC7 half explicitly asks for
// `includeNativeElf: false` - a genuinely PE-only folder - so the chosen executable is unambiguously
// `quake2.exe`.
export const WINDOWS_BUILD_INSTALL_NAME = 'Fixture Windows Build Install'

const WINDOWS_BUILD_INSTALL_DIR = 'fixture-windows-build-install'
const WINDOWS_BUILD_EXE_NAME = 'quake2.exe'
const WINDOWS_BUILD_ELF_NAME = 'quake2'

/** `MZ`, then filler bytes - `readBinaryKind` only ever reads the first 4 bytes of a file. */
const PE_HEADER_BYTES = Buffer.from([0x4d, 0x5a, 0x90, 0x00])
/** `\x7fELF`, then filler bytes. */
const ELF_HEADER_BYTES = Buffer.from([0x7f, 0x45, 0x4c, 0x46])

export function windowsBuildInstallRoot() {
  return join(gameRoot(), WINDOWS_BUILD_INSTALL_DIR)
}

/** The real, on-disk path of the fixture's Windows executable - always written. */
export function windowsBuildExecutablePath() {
  return join(windowsBuildInstallRoot(), WINDOWS_BUILD_EXE_NAME)
}

/** The real, on-disk path of the fixture's native (ELF) executable - only written when
 * `includeNativeElf` is not explicitly `false`; see the block comment above. */
export function windowsBuildNativeExecutablePath() {
  return join(windowsBuildInstallRoot(), WINDOWS_BUILD_ELF_NAME)
}

/**
 * Builds a fresh install root: retail-sized `baseq2/pak0.pak`/`pak1.pak`/`pak2.pak` (so nothing but
 * the runner story shows up in `installation.checks`), a real MZ-header `quake2.exe` with the
 * execute bit set (needed off Windows too - `looksExecutable` there is a plain exec-bit stat, not an
 * extension check, so an unexecutable `quake2.exe` would never even be ranked as a candidate), and -
 * unless `includeNativeElf` is `false` - a real ELF-header `quake2`, execute bit set, alongside it.
 * Returns `{ root, exePath, elfPath }` - `elfPath` is `null` when `includeNativeElf` is `false`.
 */
export function writeWindowsBuildFixture({ includeNativeElf = true } = {}) {
  const root = assertInside(UI_VERIFY_ROOT, windowsBuildInstallRoot(), 'windows-build install root')
  rmDirBestEffort(root)
  const baseq2Dir = join(root, 'baseq2')
  mkdirSync(baseq2Dir, { recursive: true })
  writeSizedFile(join(baseq2Dir, 'pak0.pak'), RETAIL_PAK_SIZES['pak0.pak'])
  writeSizedFile(join(baseq2Dir, 'pak1.pak'), RETAIL_PAK_SIZES['pak1.pak'])
  writeSizedFile(join(baseq2Dir, 'pak2.pak'), RETAIL_PAK_SIZES['pak2.pak'])

  const exePath = windowsBuildExecutablePath()
  writeFileSync(exePath, PE_HEADER_BYTES)
  chmodSync(exePath, 0o755)

  let elfPath = null
  if (includeNativeElf) {
    elfPath = windowsBuildNativeExecutablePath()
    writeFileSync(elfPath, ELF_HEADER_BYTES)
    chmodSync(elfPath, 0o755)
  }

  return { root, exePath, elfPath }
}

// --- story 103 D8: a real, on-PATH `wine` stub ---------------------------------------------------
//
// A tiny POSIX shell script that execs its first argument with the rest as its own arguments -
// `resolveRunner()`/`LaunchService.plan()` only need something named `wine` on `PATH` with the
// execute bit set (`findOnPath()`, `src/main/services/runners.ts`); what it actually does once
// spawned is this flow's own business. Node's `child_process.spawn()` reports the wrapper script
// itself as `'spawn'`/`'exit'` regardless of whether the `exec` inside it against the fixture's own
// (content-wise inert) `quake2.exe` succeeds - the same "the wrapper process itself is real, so the
// launch-state sequence is real" trick `writeLinuxJourneyInstallRoot()`'s own shell-script stub
// relies on for an unwrapped launch.
function wineStubBinDir() {
  return join(UI_VERIFY_ROOT, 'fixture', 'windows-build-wine-bin')
}

const WINE_STUB_SCRIPT = '#!/bin/sh\nexec "$@"\n'

/** Writes a fresh `<dir>/wine` stub and returns `dir` - the flow prepends this onto `PATH` (inside
 * the running app's own main process, via Playwright's `app.evaluate()`) once it wants wine to be
 * "found". Never called on `win32` - the flow's own branch gate keeps this off Windows entirely. */
export function writeWineStub() {
  const dir = assertInside(UI_VERIFY_ROOT, wineStubBinDir(), 'wine stub bin dir')
  rmDirBestEffort(dir)
  mkdirSync(dir, { recursive: true })
  const wine = join(dir, 'wine')
  writeFileSync(wine, WINE_STUB_SCRIPT)
  chmodSync(wine, 0o755)
  return dir
}

// --- story 103 review finding N1: a second, distinct stub runner (`umu-run`) -------------------
//
// A single stub (`wine`) could not distinguish "the user explicitly chose this runner" from "this
// runner became available and `resolveRunner()`'s cascade default (`src/main/services/runners.ts`,
// `WRAPPING_KINDS = ['wine', 'umu']`, wine ranked first) picked it automatically" - both produce the
// exact same visible preview change. A second wrapping-kind stub, in its own directory so it can be
// written/removed independently of the wine stub above, lets a flow put both on PATH at once: the
// cascade still defaults to wine, so explicitly picking `umu-run` instead is the only way to reach
// the umu-wrapped preview, and that can only happen through a genuine, persisted explicit choice.
function umuStubBinDir() {
  return join(UI_VERIFY_ROOT, 'fixture', 'windows-build-umu-bin')
}

const UMU_STUB_SCRIPT = '#!/bin/sh\nexec "$@"\n'

/** Writes a fresh `<dir>/umu-run` stub and returns `dir` - same shape as `writeWineStub()`, for the
 * second wrapping runner kind `findOnPath('umu', 'umu-run')` looks for (`src/main/services/
 * runners.ts`). Never called on `win32`, same as `writeWineStub()`. */
export function writeUmuStub() {
  const dir = assertInside(UI_VERIFY_ROOT, umuStubBinDir(), 'umu-run stub bin dir')
  rmDirBestEffort(dir)
  mkdirSync(dir, { recursive: true })
  const umu = join(dir, 'umu-run')
  writeFileSync(umu, UMU_STUB_SCRIPT)
  chmodSync(umu, 0o755)
  return dir
}

// --- story 104 D6: the steam-handoff e2e proof's own fixtures -----------------------------------
//
// `scripts/flows/steam-handoff.mjs` needs two things `windows-build-on-linux.mjs`'s own fixtures
// don't provide: an install root Steam itself would recognise as one of its own
// (`readSteamAppId()`, `src/main/services/steam.ts` - a folder living directly inside some Steam
// library's `steamapps/common/`, with a sibling `appmanifest_<appid>.acf` naming it), and a stub
// `steam` binary that behaves like a real handoff target rather than a wrapper.

/**
 * The exact `"key" "value"` shape `scrapeVdfPairs()` (`src/main/services/steam.ts`) reads, mirroring
 * the literal fixture already proven correct by `steam.test.ts`'s own "reads the appid from the
 * manifest whose installdir matches the folder" case - not hand-rolled a second time here.
 */
const STEAM_LIBRARY_INSTALL_DIR_NAME = 'Quake 2'

function steamLibraryFixtureRoot(appid) {
  return join(gameRoot(), `steam-handoff-${appid}`)
}

/** `<root>/steamapps/common/Quake 2` - what `readSteamAppId()` requires an install root to be:
 * `dirname(installRoot)` named `common`, `dirname(dirname(installRoot))` named `steamapps`. */
export function steamLibraryInstallRoot(appid) {
  return join(steamLibraryFixtureRoot(appid), 'steamapps', 'common', STEAM_LIBRARY_INSTALL_DIR_NAME)
}

/**
 * Builds a fresh Steam-owned install root for `appid`: retail-sized `baseq2/pak0.pak`/`pak1.pak`/
 * `pak2.pak` (so nothing but the runner story shows up in `installation.checks`, same reasoning as
 * `writeWindowsBuildFixture()`), a real MZ-header `quake2.exe` (execute bit set), and a sibling
 * `steamapps/appmanifest_<appid>.acf` whose `"appid"`/`"installdir"` pair names this exact folder -
 * the one thing that makes `readSteamAppId()` recognise it as Steam-owned at all. A distinct root
 * per appid (rather than one shared `steamapps` with several manifests) keeps the two call sites
 * `steam-handoff.mjs` needs (a known appid with a client table, and an unknown one without) fully
 * independent - deleting/rewriting one never touches the other's manifest.
 *
 * Returns `{ root, exePath, manifestPath }` - `root` is what a flow hands to
 * `Q2L_UI_PICK_FOLDER`/the Add Existing dialog.
 */
export function writeSteamLibraryFixture({ appid }) {
  const installRoot = assertInside(
    UI_VERIFY_ROOT,
    steamLibraryInstallRoot(appid),
    'steam library install root',
  )
  rmDirBestEffort(steamLibraryFixtureRoot(appid))
  const baseq2Dir = join(installRoot, 'baseq2')
  mkdirSync(baseq2Dir, { recursive: true })
  writeSizedFile(join(baseq2Dir, 'pak0.pak'), RETAIL_PAK_SIZES['pak0.pak'])
  writeSizedFile(join(baseq2Dir, 'pak1.pak'), RETAIL_PAK_SIZES['pak1.pak'])
  writeSizedFile(join(baseq2Dir, 'pak2.pak'), RETAIL_PAK_SIZES['pak2.pak'])

  const exePath = join(installRoot, 'quake2.exe')
  writeFileSync(exePath, PE_HEADER_BYTES)
  chmodSync(exePath, 0o755)

  const steamappsDir = join(steamLibraryFixtureRoot(appid), 'steamapps')
  const manifestPath = join(steamappsDir, `appmanifest_${appid}.acf`)
  writeFileSync(
    manifestPath,
    `"AppState"\n{\n\t"appid"\t\t"${appid}"\n\t"installdir"\t\t"${STEAM_LIBRARY_INSTALL_DIR_NAME}"\n}\n`,
    'utf8',
  )

  return { root: installRoot, exePath, manifestPath }
}

function steamStubBinDir() {
  return join(UI_VERIFY_ROOT, 'fixture', 'steam-handoff-steam-bin')
}

/** `<dir>/steam-stub.log` - where the stub below records every invocation's argv. */
export function steamStubLogPath() {
  return join(steamStubBinDir(), 'steam-stub.log')
}

/**
 * Unlike `writeWineStub()`/`writeUmuStub()`, a Steam handoff's only argument is a
 * `steam://launch/<appid>/client/<n>` URL, never another executable to run - `exec "$@"` would try
 * (and fail) to run that URL as a program. So this stub just records its own argv to a log file
 * (`steamStubLogPath()`) and exits 0: still a real process spawn/exit (`LaunchService.handOff()`'s
 * `'spawn'`/`'error'` listeners see a genuine child process, the same "the wrapper process itself is
 * real" trick the wine/umu stubs use), just one whose recorded argv is what the flow asserts against
 * instead of a nested exec. Never called on `win32` - the flow's own branch gate keeps this off
 * Windows entirely (the Windows branch never presses Play).
 */
export function writeSteamStub() {
  const dir = assertInside(UI_VERIFY_ROOT, steamStubBinDir(), 'steam stub bin dir')
  rmDirBestEffort(dir)
  mkdirSync(dir, { recursive: true })
  const logPath = steamStubLogPath()
  const steam = join(dir, 'steam')
  writeFileSync(steam, `#!/bin/sh\necho "$@" >> "${logPath}"\nexit 0\n`)
  chmodSync(steam, 0o755)
  return { dir, logPath }
}
