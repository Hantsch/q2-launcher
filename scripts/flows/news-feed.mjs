// Story 082 (docs/requirements/082-the-launcher-fetches-the-community-news-feed.md) D8: the
// story's own offline acceptance proof. Story 083 (the renderer surface) does not exist yet, so
// this flow cannot assert on rendered slides - it proves the pipeline through the same IPC path
// the renderer will eventually use (`window.q2.invoke('module:invoke', { moduleId: 'home', type:
// 'news.get' })`, the exact call `src/renderer/src/modules/home/client.ts`'s `getNews()` makes)
// plus the on-disk cache file `news-service.ts`'s cache writes to.
//
// Two phases, two full, independent app launches:
//
//   Phase 1 - the fixture server serves `docs/fixtures/news/*` normally. The app's own
//   fire-and-forget startup fetch (`src/main/modules/home/index.ts`) lands in the loopback case of
//   `resolveNewsSource()` (D4) because `setup()` below points `HARNESS_CONTENT_REPO_BASE_ENV` at
//   this server before the app is launched. Once `news.get` reports the fixture's three slides,
//   this flow asserts their `order` (1, 2, 3) does NOT match either the fixture's file names
//   (`a-banner.md`/`b-split.md`/`c-text.md`) or the order `index.json` lists them in - the ordering
//   comes only from each document's own `order:` frontmatter field (AC4). It also reads
//   `userData/news-feed.json` straight off disk and asserts the same slides plus a `retrievedAt`
//   landed there.
//
//   Phase 2 - the SAME server (never restarted) is flipped to answer HTTP 500 for every request,
//   and a second, independent `_electron.launch()` starts fresh - a real second process, with no
//   in-memory `news-service.ts` state left over from phase 1 - so `ensureLoaded()` has to prove it
//   for real from the cache file rather than an in-process variable. It cannot reuse phase 1's own
//   userData directory: `main/index.ts`'s single-instance lock refuses a second launch against a
//   directory another running instance already holds, and `flow.mjs`'s own `withApp()` (which owns
//   phase 1's `app`/`page`) only closes that instance once this whole function returns - there is no
//   supported way to close it early from inside here without the harness reporting an unexpected
//   crash (`assertStillRunning()` in `scripts/lib/harness.mjs`). So phase 2 gets its own fresh
//   userData directory, seeded with nothing but a byte-identical COPY of phase 1's own
//   `news-feed.json` - the same file a real second boot on the same machine would read, just under
//   a directory this flow does not have to fight the first process over. `news-service.ts`'s
//   `refreshNews()` then sees the index request fail (after its one retry) and returns the cached
//   feed with its ORIGINAL `retrievedAt` untouched - this flow asserts both the slides and the
//   `retrievedAt` are byte-for-byte what phase 1 saw, and that neither a toast (`[role="status"]`
//   under `Toasts.tsx`) nor a dialog (`getByRole('dialog')`) appears anywhere in the DOM (AC8).
//
// The only network access in the whole run is to this file's own `127.0.0.1` fixture server -
// `server.requested` is printed as the run's own evidence, the same convention
// `bootstrap-wizard.mjs` uses.
import { createServer } from 'node:http'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '../lib/paths.mjs'
import { variantUserDataDir, withApp } from '../lib/harness.mjs'

/** How long the flow waits for the app's own fire-and-forget startup fetch to land before giving
 * up and reporting the last state it saw. */
const POLL_TIMEOUT_MS = 15_000
const POLL_INTERVAL_MS = 50

/** Mirrors `HARNESS_CONTENT_REPO_BASE_ENV` (`src/main/lib/ui-harness.ts`) - the env var that points
 * `resolveNewsSource()` (`src/main/modules/home/news/harness.ts`) at a `127.0.0.1` fixture base
 * instead of `production`/`skip`. Plain `.mjs` scripts cannot import a `.ts` module (see every
 * other "mirrors" comment in `scripts/lib/fixture.mjs`), so the literal is copied here. */
const HARNESS_CONTENT_REPO_BASE_ENV = 'Q2L_UI_CONTENT_REPO_BASE'

/** Mirrors `NEWS_FEED_CACHE_FILE` (`src/main/modules/home/news/feed-cache.ts`). */
const NEWS_FEED_CACHE_FILE = 'news-feed.json'

const FIXTURE_DIR = join(REPO_ROOT, 'docs', 'fixtures', 'news')

/**
 * The fixture's own three slides, in the order `news.get` must deliver them (ascending `order:`
 * frontmatter, per `docs/fixtures/news/*.md`) - deliberately NOT alphabetical-by-filename
 * (`a-banner.md`, `b-split.md`, `c-text.md`) and NOT `index.json`'s own entry order
 * (`point-release-2026-1`, `community-server-survey`, `welcome-news-feed`), so a flow that passed
 * by accidentally matching either of those would be caught by a reader diffing this list against
 * the fixture files, not by the assertion itself.
 */
const EXPECTED_SLIDES_IN_ORDER = [
  { id: 'point-release-2026-1', template: 'split', order: 1 },
  { id: 'welcome-news-feed', template: 'text', order: 2 },
  { id: 'community-server-survey', template: 'banner', order: 3 },
]

/**
 * A minimal static-file server for `docs/fixtures/news/*`, on `127.0.0.1:0`. Not built on top of
 * `scripts/lib/fixture.mjs`'s `startBootstrapFixtureServer()` - that helper's routes, manifest
 * envelopes and archive streaming are specific to the bootstrap wizard's download packages and
 * have nothing this flow could reuse; this is the same `node:http`-on-a-loopback-port shape as
 * that helper, sized for what news actually fetches: `news/index.json` and `news/<file>` (the
 * exact paths `feed-fetcher.ts`'s `contentRepoUrl()` builds).
 */
async function startNewsFixtureServer() {
  let failing = false
  const requested = []

  const server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0]
    requested.push(path)

    if (failing) {
      response.writeHead(500, { 'content-type': 'text/plain' })
      response.end('fixture: simulated server error (phase 2)')
      return
    }

    const match = path.match(/^\/news\/([A-Za-z0-9_.-]+)$/)
    const filePath = match ? join(FIXTURE_DIR, match[1]) : undefined
    if (!filePath || !existsSync(filePath)) {
      response.writeHead(404, { 'content-type': 'text/plain' })
      response.end('not found')
      return
    }

    const bytes = readFileSync(filePath)
    const contentType = filePath.endsWith('.json') ? 'application/json' : 'text/markdown; charset=utf-8'
    response.writeHead(200, { 'content-type': contentType, 'content-length': bytes.byteLength })
    response.end(bytes)
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  const { port } = server.address()
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requested,
    setFailing: (value) => {
      failing = value
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      }),
  }
}

/** Module-scoped, same reason `bootstrap-wizard.mjs` keeps its server this way: `setup()` starts
 * it, `teardown()` has to close it, and phase 2 needs to flip its `failing` flag from inside
 * `default()`. */
let server

export async function setup() {
  server = await startNewsFixtureServer()
  console.log(`  fixture server: ${server.baseUrl}`)
  return {
    env: { [HARNESS_CONTENT_REPO_BASE_ENV]: server.baseUrl },
  }
}

export async function teardown() {
  if (server) {
    await server.close()
    server = null
  }
}

/**
 * Calls `news.get` through the exact IPC path the renderer's typed client
 * (`src/renderer/src/modules/home/client.ts`) uses - `module:invoke` with a `{ moduleId, type }`
 * envelope, answering `Outcome<NewsFeed>`.
 */
async function getNews(page) {
  return page.evaluate(() =>
    window.q2.invoke('module:invoke', { moduleId: 'home', type: 'news.get' }),
  )
}

/** Polls `news.get` until it reports the fixture's three slides (the fire-and-forget startup
 * fetch is asynchronous - there is no event to await from outside the page, and the real UI this
 * would otherwise drive does not exist yet, per story 083). Throws with the last outcome seen if
 * the deadline passes first. */
async function waitForSlideCount(page, count) {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  let last
  while (Date.now() < deadline) {
    last = await getNews(page)
    if (last?.ok && last.value.slides.length === count) return last
    await new Promise((done) => setTimeout(done, POLL_INTERVAL_MS))
  }
  throw new Error(
    `news.get never reported ${count} slide(s) within ${POLL_TIMEOUT_MS}ms; last outcome: ` +
      JSON.stringify(last),
  )
}

function assertSlidesMatchExpected(slides, label) {
  const actual = slides.map((slide) => ({
    id: slide.id,
    template: slide.template,
    order: slide.order,
  }))
  const expected = EXPECTED_SLIDES_IN_ORDER
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label}: expected slides ${JSON.stringify(expected)} in that exact order, got ` +
        JSON.stringify(actual),
    )
  }
}

/** The cache stores validated-but-unfiltered slides (see story 082's Decisions); the visibility
 * filter and the `order` sort run only at delivery time (`news.get`). So the cache file's slide
 * array is NOT required to be in `order`-sorted sequence - only that it holds exactly the same
 * set of slides `news.get` delivered, unsorted. */
function assertSlidesMatchExpectedSet(slides, label) {
  const actual = slides
    .map((slide) => ({ id: slide.id, template: slide.template, order: slide.order }))
    .sort((a, b) => a.id.localeCompare(b.id))
  const expected = [...EXPECTED_SLIDES_IN_ORDER].sort((a, b) => a.id.localeCompare(b.id))
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label}: expected slides ${JSON.stringify(expected)} (any order), got ` +
        JSON.stringify(actual),
    )
  }
}

function readCacheFile(userDataDir) {
  const path = join(userDataDir, NEWS_FEED_CACHE_FILE)
  if (!existsSync(path)) {
    throw new Error(`expected ${path} to exist after the startup fetch`)
  }
  return JSON.parse(readFileSync(path, 'utf8'))
}

export default async function newsFeed({ page, shot, step, variant }) {
  const userDataDir = variantUserDataDir(variant)

  // --- Phase 1: a clean fetch, cached and delivered in order (AC1, AC4, AC7's cache half) --------
  step('wait for the startup fetch to deliver the fixture feed (AC1)')
  const firstOutcome = await waitForSlideCount(page, EXPECTED_SLIDES_IN_ORDER.length)
  if (!firstOutcome.ok) {
    throw new Error(`news.get failed: ${JSON.stringify(firstOutcome.error)}`)
  }
  const firstFeed = firstOutcome.value

  step('assert the delivered order is the frontmatter order, not filename or index order (AC4)')
  assertSlidesMatchExpected(firstFeed.slides, 'phase 1 news.get')
  if (firstFeed.schemaAhead) {
    throw new Error('expected schemaAhead=false for a fixture at or below NEWS_SCHEMA_VERSION')
  }
  await shot('phase1-slides-delivered')

  step('assert the on-disk cache holds the same slides plus a retrievedAt (AC7)')
  const firstCache = readCacheFile(userDataDir)
  assertSlidesMatchExpectedSet(firstCache.slides, 'phase 1 cache file')
  if (firstCache.retrievedAt !== firstFeed.retrievedAt) {
    throw new Error(
      `cache retrievedAt (${firstCache.retrievedAt}) does not match the delivered feed's ` +
        `(${firstFeed.retrievedAt})`,
    )
  }

  step('assert only the loopback fixture server was ever contacted (AC10)')
  const unexpectedPhase1 = server.requested.filter((path) => !path.startsWith('/news/'))
  if (unexpectedPhase1.length > 0) {
    throw new Error(`unexpected request path(s) in phase 1: ${JSON.stringify(unexpectedPhase1)}`)
  }
  console.log(`phase 1 fixture server served: ${JSON.stringify([...new Set(server.requested)])}`)

  step('assert the index was requested exactly once (AC1: only the startup fetch, no polling refetch)')
  const indexRequestsPhase1 = server.requested.filter((path) => path === '/news/index.json')
  if (indexRequestsPhase1.length !== 1) {
    throw new Error(
      `expected exactly one request for /news/index.json during phase 1's wait, saw ` +
        `${indexRequestsPhase1.length}: ${JSON.stringify(server.requested)}`,
    )
  }

  // --- Phase 2: the SAME server starts failing, and a fresh app start still shows the cache -------
  step('flip the fixture server to answer 500 for every request')
  server.requested.length = 0
  server.setFailing(true)

  step('seed a fresh userData directory with a copy of phase 1\'s cache file')
  const restartVariant = `${variant}-newsfeed-restart`
  const restartUserDataDir = variantUserDataDir(restartVariant)
  mkdirSync(restartUserDataDir, { recursive: true })
  copyFileSync(join(userDataDir, NEWS_FEED_CACHE_FILE), join(restartUserDataDir, NEWS_FEED_CACHE_FILE))

  step('restart the app, fresh process, seeded only with phase 1\'s cache file (AC7, AC8)')
  await withApp(
    {
      variant: restartVariant,
      viewport: { width: 1280, height: 800 },
      env: { [HARNESS_CONTENT_REPO_BASE_ENV]: server.baseUrl },
    },
    async ({ page: secondPage }) => {
      const secondOutcome = await waitForSlideCount(secondPage, EXPECTED_SLIDES_IN_ORDER.length)
      if (!secondOutcome.ok) {
        throw new Error(`news.get failed after the simulated 500: ${JSON.stringify(secondOutcome.error)}`)
      }
      const secondFeed = secondOutcome.value

      assertSlidesMatchExpected(secondFeed.slides, 'phase 2 news.get')
      if (secondFeed.retrievedAt !== firstFeed.retrievedAt) {
        throw new Error(
          `a failed refresh must not change retrievedAt - phase 1 had ${firstFeed.retrievedAt}, ` +
            `phase 2 reports ${secondFeed.retrievedAt}`,
        )
      }

      const toastCount = await secondPage.locator('[role="status"]').count()
      if (toastCount > 0) {
        throw new Error(`expected no toast after a failed news refresh, found ${toastCount} (AC8)`)
      }
      const dialogCount = await secondPage.getByRole('dialog').count()
      if (dialogCount > 0) {
        throw new Error(`expected no dialog after a failed news refresh, found ${dialogCount} (AC8)`)
      }

      await secondPage.screenshot({
        path: join(REPO_ROOT, '.ui-verify', 'screenshots', 'flows', 'news-feed-phase2-no-error-ui.png'),
      })
    },
  )

  step('assert the second app instance never asked for anything but news/* on the same server')
  const unexpectedPhase2 = server.requested.filter((path) => !path.startsWith('/news/'))
  if (unexpectedPhase2.length > 0) {
    throw new Error(`unexpected request path(s) in phase 2: ${JSON.stringify(unexpectedPhase2)}`)
  }
  console.log(`phase 2 fixture server served (all 500): ${JSON.stringify([...new Set(server.requested)])}`)

  step('assert the cache file on disk still holds phase 1\'s retrievedAt (a failed refresh never rewrites it)')
  const secondCache = readCacheFile(restartUserDataDir)
  if (secondCache.retrievedAt !== firstFeed.retrievedAt) {
    throw new Error(
      `cache file retrievedAt changed after a failed refresh: was ${firstFeed.retrievedAt}, now ` +
        secondCache.retrievedAt,
    )
  }

  console.log(
    'news feed: phase 1 fetched, cached and delivered the fixture\'s three slides in their ' +
      "frontmatter order; phase 2 restarted against a failing server and the SAME cached feed " +
      'and retrievedAt survived, with no toast and no dialog anywhere in the DOM',
  )
}
