import { describe, expect, it } from 'vitest'
import { SAFE_NEWS_IMAGE_EXTENSIONS } from '../modules/home/images/paths'
import {
  createRendererProtocolHandler,
  DEV_CSP,
  NEWS_IMAGE_PATH_PREFIX,
  PRODUCTION_CSP,
  resolveRendererSource,
} from './renderer-source'

/**
 * Story 035 D1: the pure decidable part of "how does the renderer document get to the window,
 * and what CSP travels with it" - no `electron` import, so this whole module is testable without
 * booting Electron. Mirrors `./schemas.test.ts`'s describe/it style.
 */
describe('resolveRendererSource', () => {
  it('picks dev-server when isDev is true and a dev-server URL is present', () => {
    const result = resolveRendererSource({ isDev: true, devServerUrl: 'http://localhost:5173' })
    expect(result).toEqual({ kind: 'dev-server', url: 'http://localhost:5173' })
  })

  it('picks scheme when isDev is true but no dev-server URL is present', () => {
    const result = resolveRendererSource({ isDev: true, devServerUrl: undefined })
    expect(result).toEqual({ kind: 'scheme' })
  })

  it('picks scheme when a dev-server URL is present but isDev is false', () => {
    const result = resolveRendererSource({ isDev: false, devServerUrl: 'http://localhost:5173' })
    expect(result).toEqual({ kind: 'scheme' })
  })

  it('picks scheme when neither isDev nor a dev-server URL is present', () => {
    const result = resolveRendererSource({ isDev: false, devServerUrl: undefined })
    expect(result).toEqual({ kind: 'scheme' })
  })

  it('picks scheme when the dev-server URL is an empty string', () => {
    const result = resolveRendererSource({ isDev: true, devServerUrl: '' })
    expect(result).toEqual({ kind: 'scheme' })
  })
})

describe('PRODUCTION_CSP', () => {
  it('the production CSP is unchanged', () => {
    // Story 067 AC7: installation icons are delivered as `data:` URLs from main, which
    // `img-src 'self' data: blob:` already allows - the feature needed no policy change at all.
    // Pinned verbatim, so relaxing any directive for an image feature later fails right here
    // instead of quietly widening the renderer's reach.
    expect(PRODUCTION_CSP).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
    )
  })

  it('allows no inline styles', () => {
    // Story 046 D2: the renderer has no `style="..."` attribute, no literal `<style>` block and
    // no `dangerouslySetInnerHTML` - dynamic values go through React's `style` prop, a CSSOM
    // write that `style-src` never governs. This would fail if `'unsafe-inline'` came back.
    expect(PRODUCTION_CSP).toContain("style-src 'self';")
    expect(PRODUCTION_CSP).not.toContain('unsafe-inline')
    expect(PRODUCTION_CSP).not.toContain('unsafe-eval')
  })
})

describe('DEV_CSP', () => {
  it('still allows inline styles for Vite/React Fast Refresh HMR', () => {
    // Deliberate dev-only allowance, not drift from PRODUCTION_CSP above: Vite/Fast Refresh
    // injects `<style>` blocks at dev time, which a locked-down style-src would block.
    expect(DEV_CSP).toContain("style-src 'self' 'unsafe-inline'")
  })
})

/**
 * An in-memory `readFile` fake, keyed by the absolute path the handler would pass in - never
 * touches real disk, so these tests exercise `createRendererProtocolHandler` on its own.
 */
function fakeFileSystem(files: Record<string, string>): (path: string) => Promise<Buffer> {
  return async (path: string): Promise<Buffer> => {
    const content = files[path]
    if (content === undefined) throw new Error(`ENOENT: no such file: ${path}`)
    return Buffer.from(content, 'utf-8')
  }
}

const ROOT = 'C:/app/out/renderer'

describe('createRendererProtocolHandler', () => {
  const files: Record<string, string> = {
    [`${ROOT}/index.html`]: '<html>index</html>',
    [`${ROOT}/assets/app.js`]: 'console.log("hi")',
    [`${ROOT}/secret.txt`]: 'top secret',
  }

  function handlerFor(csp: string): (request: Request) => Promise<Response> {
    return createRendererProtocolHandler({ root: ROOT, csp, readFile: fakeFileSystem(files) })
  }

  it('serves index.html with a 200, the production CSP header and text/html content type', async () => {
    const handler = handlerFor(PRODUCTION_CSP)
    const response = await handler(new Request('q2launcher://app/index.html'))

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Security-Policy')).toBe(PRODUCTION_CSP)
    expect(response.headers.get('Content-Type')).toBe('text/html')
    await expect(response.text()).resolves.toBe('<html>index</html>')
  })

  it('serves an asset with a 200, the production CSP header and its own content type', async () => {
    const handler = handlerFor(PRODUCTION_CSP)
    const response = await handler(new Request('q2launcher://app/assets/app.js'))

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Security-Policy')).toBe(PRODUCTION_CSP)
    expect(response.headers.get('Content-Type')).toBe('text/javascript')
    await expect(response.text()).resolves.toBe('console.log("hi")')
  })

  it('maps an empty/root path ("/") to index.html', async () => {
    const handler = handlerFor(PRODUCTION_CSP)
    const response = await handler(new Request('q2launcher://app/'))

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe('<html>index</html>')
  })

  it('gives a 404 with no body for a foreign host', async () => {
    const handler = handlerFor(PRODUCTION_CSP)
    const response = await handler(new Request('q2launcher://evil/index.html'))

    expect(response.status).toBe(404)
    await expect(response.text()).resolves.toBe('')
  })

  it('gives a 404 with no body for a path that resolves outside root via ../ traversal', async () => {
    const handler = handlerFor(PRODUCTION_CSP)
    // A literal `../` is already collapsed by the URL parser before the handler ever sees it -
    // this is the realistic escape route: a slash smuggled in as `%2f` survives that collapse and
    // only becomes a live `..` once the pathname is decoded for the filesystem lookup.
    const response = await handler(new Request('q2launcher://app/assets/..%2f..%2fsecret.txt'))

    expect(response.status).toBe(404)
    await expect(response.text()).resolves.toBe('')
  })

  it('gives a 404 with no body for a missing file', async () => {
    const handler = handlerFor(PRODUCTION_CSP)
    const response = await handler(new Request('q2launcher://app/does-not-exist.html'))

    expect(response.status).toBe(404)
    await expect(response.text()).resolves.toBe('')
  })

  it('gives a 404 with no body for a path that resolves outside root via a backslash-smuggled ../ traversal', async () => {
    const handler = handlerFor(PRODUCTION_CSP)
    // On Windows, `\` is a path separator to `fs.readFile` even though the segment-stack guard
    // only recognizes `..` as a `/`-delimited token. A literal backslash in the decoded path
    // (e.g. from `%5C` in the request URL) must be normalized to `/` before the guard runs, or
    // `..\..\secret.txt` is treated as one opaque segment and escapes `root` once the OS resolves
    // the resulting path.
    const response = await handler(new Request('q2launcher://app/assets/..%5C..%5Csecret.txt'))

    expect(response.status).toBe(404)
    await expect(response.text()).resolves.toBe('')
  })

  it('carries the Content-Security-Policy header on a 404 response', async () => {
    const handler = handlerFor(PRODUCTION_CSP)
    const response = await handler(new Request('q2launcher://app/does-not-exist.html'))

    expect(response.status).toBe(404)
    expect(response.headers.get('Content-Security-Policy')).toBe(PRODUCTION_CSP)
  })

  it('leaves the renderer root reachable when a news-image root is configured', async () => {
    // The new branch must not change what the pre-existing root serves: the document, the assets
    // and their content types are exactly as above, and the CSP still travels with them.
    const handler = createRendererProtocolHandler({
      root: ROOT,
      csp: PRODUCTION_CSP,
      readFile: fakeFileSystem(files),
      newsImages: { root: IMAGE_ROOT, readFile: fakeFileSystem({}) },
    })
    const response = await handler(new Request('q2launcher://app/index.html'))

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/html')
    expect(response.headers.get('Content-Security-Policy')).toBe(PRODUCTION_CSP)
    await expect(response.text()).resolves.toBe('<html>index</html>')
  })
})

/**
 * Story 084 D3: the `q2launcher://app/news-image/<name>` route. Two facts are being pinned here -
 * that a cached image is served with its real content type and the same CSP as everything else,
 * and that this branch is a dead end for anything that is not a bare, cache-shaped file name. The
 * second is the one that matters: it must neither escape the image cache directory nor fall
 * through into the renderer root's resolution path, where a `..` token could be spent against a
 * *different* root than the one it was aimed at.
 */
const IMAGE_ROOT = 'C:/Users/u/AppData/Roaming/q2-launcher/cache/news-images'

/** A cache-shaped name: 64 lowercase hex characters plus an allowed extension. */
const HASH = 'ab'.repeat(32)

describe('createRendererProtocolHandler news-image route', () => {
  const rendererFiles: Record<string, string> = {
    [`${ROOT}/index.html`]: '<html>index</html>',
    // Bait for a fallthrough: if a `/news-image/..%2f<name>` request ever reached
    // `resolveWithinRoot(rendererRoot, ...)`, its single `..` would be spent on the `news-image`
    // segment and these would be served with a 200 instead of the 404 the route promises.
    [`${ROOT}/secret.txt`]: 'top secret',
    [`${ROOT}/${HASH}.png`]: 'renderer-root impostor',
  }

  /** Records every path the image root was asked for, so a rejected name can be shown to read nothing. */
  function imageHandler(
    imageFiles: Record<string, string>,
  ): { handler: (request: Request) => Promise<Response>; reads: string[] } {
    const reads: string[] = []
    const read = fakeFileSystem(imageFiles)
    const handler = createRendererProtocolHandler({
      root: ROOT,
      csp: PRODUCTION_CSP,
      readFile: fakeFileSystem(rendererFiles),
      newsImages: {
        root: IMAGE_ROOT,
        readFile: async (path) => {
          reads.push(path)
          return read(path)
        },
      },
    })
    return { handler, reads }
  }

  it('serves the cached bytes with Content-Type image/png and the CSP header', async () => {
    const { handler } = imageHandler({ [`${IMAGE_ROOT}/${HASH}.png`]: 'PNG-BYTES' })
    const response = await handler(new Request(`q2launcher://app/news-image/${HASH}.png`))

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(response.headers.get('Content-Security-Policy')).toBe(PRODUCTION_CSP)
    await expect(response.text()).resolves.toBe('PNG-BYTES')
  })

  it('serves every extension the cache may hold with a real image content type', async () => {
    // Pinned against D1's allowlist rather than a hand-written list: an extension added to
    // `SAFE_NEWS_IMAGE_EXTENSIONS` without a matching MIME entry would be served as
    // `application/octet-stream` and only render because Chromium sniffs the bytes.
    for (const ext of SAFE_NEWS_IMAGE_EXTENSIONS) {
      const { handler } = imageHandler({ [`${IMAGE_ROOT}/${HASH}.${ext}`]: 'BYTES' })
      const response = await handler(new Request(`q2launcher://app/news-image/${HASH}.${ext}`))

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toMatch(/^image\//)
    }
  })

  it('resolves inside the cache root when that root is a Windows path with backslashes', async () => {
    // Production passes `join(userData, 'cache', 'news-images')`, i.e. backslashes on Windows.
    const backslashRoot = 'C:\\Users\\u\\AppData\\Roaming\\q2-launcher\\cache\\news-images'
    const handler = createRendererProtocolHandler({
      root: ROOT,
      csp: PRODUCTION_CSP,
      readFile: fakeFileSystem(rendererFiles),
      newsImages: {
        root: backslashRoot,
        readFile: fakeFileSystem({ [`${IMAGE_ROOT}/${HASH}.png`]: 'PNG-BYTES' }),
      },
    })
    const response = await handler(new Request(`q2launcher://app/news-image/${HASH}.png`))

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe('PNG-BYTES')
  })

  it('gives a 404 for a traversal attempt, without reading anything', async () => {
    const { handler, reads } = imageHandler({})
    for (const path of [
      `news-image/..%2f..%2fetc%2fpasswd`,
      // The dangerous one: a single `..` that would be spent on the `news-image` segment itself
      // if this request ever reached the renderer root's resolver.
      `news-image/..%2fsecret.txt`,
      `news-image/..%5C..%5Csecret.txt`,
      `news-image/..%2f${HASH}.png`,
    ]) {
      const response = await handler(new Request(`q2launcher://app/${path}`))

      expect(response.status).toBe(404)
      expect(response.headers.get('Content-Security-Policy')).toBe(PRODUCTION_CSP)
      await expect(response.text()).resolves.toBe('')
    }
    expect(reads).toEqual([])
  })

  it('gives a 404 for a nested path under the news-image prefix', async () => {
    const { handler, reads } = imageHandler({ [`${IMAGE_ROOT}/sub/${HASH}.png`]: 'PNG-BYTES' })
    const response = await handler(new Request(`q2launcher://app/news-image/sub/${HASH}.png`))

    expect(response.status).toBe(404)
    expect(response.headers.get('Content-Security-Policy')).toBe(PRODUCTION_CSP)
    await expect(response.text()).resolves.toBe('')
    expect(reads).toEqual([])
  })

  it('gives a 404 for a file name the cache would never have written', async () => {
    const { handler, reads } = imageHandler({
      [`${IMAGE_ROOT}/${HASH}.svg`]: '<svg/>',
      [`${IMAGE_ROOT}/${HASH.toUpperCase()}.png`]: 'PNG-BYTES',
      [`${IMAGE_ROOT}/index.html`]: '<html>nope</html>',
    })
    for (const name of [
      `${HASH}.svg`, // extension outside the allowlist
      `${HASH}.png.svg`, // double extension
      `${HASH.toUpperCase()}.png`, // uppercase hex - would still hit a case-insensitive filesystem
      `${HASH.slice(0, 32)}.png`, // too short for a sha256 digest
      `zz${HASH.slice(2)}.png`, // not hex
      `${HASH}`, // no extension at all
      'index.html',
      '', // the bare prefix, `q2launcher://app/news-image/`
    ]) {
      const response = await handler(new Request(`q2launcher://app/news-image/${name}`))

      expect(response.status).toBe(404)
      expect(response.headers.get('Content-Security-Policy')).toBe(PRODUCTION_CSP)
      await expect(response.text()).resolves.toBe('')
    }
    expect(reads).toEqual([])
  })

  it('gives a 404 for a safe name whose file is not on disk', async () => {
    // AC3's cache-miss path: the slide simply renders without its image, and the response is
    // still policy-protected rather than a policy-less fail-open one.
    const { handler } = imageHandler({})
    const response = await handler(new Request(`q2launcher://app/news-image/${HASH}.png`))

    expect(response.status).toBe(404)
    expect(response.headers.get('Content-Security-Policy')).toBe(PRODUCTION_CSP)
    await expect(response.text()).resolves.toBe('')
  })

  it('never serves a cache-shaped name out of the renderer root', async () => {
    // The two roots stay separate in both directions: a name that happens to exist under
    // `out/renderer` is not reachable through this route.
    const { handler } = imageHandler({})
    const response = await handler(new Request(`q2launcher://app/news-image/${HASH}.png`))

    expect(response.status).toBe(404)
    await expect(response.text()).resolves.toBe('')
  })

  it('gives a 404 instead of throwing when no news-image root was configured', async () => {
    // Backward compatible: a handler built without `newsImages` (every pre-084 caller and test)
    // answers the route with a plain 404 - the feature is absent, not broken.
    const handler = createRendererProtocolHandler({
      root: ROOT,
      csp: PRODUCTION_CSP,
      readFile: fakeFileSystem(rendererFiles),
    })
    const response = await handler(new Request(`q2launcher://app/news-image/${HASH}.png`))

    expect(response.status).toBe(404)
    expect(response.headers.get('Content-Security-Policy')).toBe(PRODUCTION_CSP)
    await expect(response.text()).resolves.toBe('')
  })

  it('the production CSP is unchanged by the news-image route', async () => {
    // Story 084 AC2, byte-for-byte. The route was deliberately built as a second *path* on the
    // existing `q2launcher://app` origin - a second host would have been a second origin, and
    // `img-src 'self'` would then have needed widening. Nothing here may relax the policy, and
    // both the served image and the 404 carry exactly the same header the document does.
    expect(PRODUCTION_CSP).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
    )
    expect(NEWS_IMAGE_PATH_PREFIX).toBe('/news-image/')

    const { handler } = imageHandler({ [`${IMAGE_ROOT}/${HASH}.png`]: 'PNG-BYTES' })
    const served = await handler(new Request(`q2launcher://app/news-image/${HASH}.png`))
    const rejected = await handler(new Request('q2launcher://app/news-image/nope.png'))

    expect(served.status).toBe(200)
    expect(rejected.status).toBe(404)
    expect(served.headers.get('Content-Security-Policy')).toBe(PRODUCTION_CSP)
    expect(rejected.headers.get('Content-Security-Policy')).toBe(PRODUCTION_CSP)
  })
})
