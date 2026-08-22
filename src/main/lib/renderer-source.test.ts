import { describe, expect, it } from 'vitest'
import {
  createRendererProtocolHandler,
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
})
