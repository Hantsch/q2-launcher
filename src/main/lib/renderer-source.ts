/**
 * Story 035: the whole decidable part of "how does the renderer document get to the window,
 * and what CSP travels with it" — kept free of `electron` so it can be unit-tested without
 * booting Electron. `src/main/index.ts` and `src/main/window.ts` wire this up; they own the
 * `protocol`/`session`/`BrowserWindow` calls this module has no business making.
 */

/** Privileged custom scheme the production renderer is served from instead of `file://`. */
export const RENDERER_SCHEME = 'q2launcher'

/** Host part of the scheme's URL — `q2launcher://app` is what `'self'` then resolves to. */
export const RENDERER_HOST = 'app'

export const RENDERER_ORIGIN = `${RENDERER_SCHEME}://${RENDERER_HOST}`

export const RENDERER_INDEX_URL = `${RENDERER_ORIGIN}/index.html`

/**
 * Defence in depth for the renderer: a strict CSP, no permission grants, and no navigation away
 * from our own content. The renderer is local, trusted code - these are the guardrails that keep
 * it that way if a dependency turns hostile.
 *
 * The dev server needs inline/eval for React Fast Refresh and a websocket for HMR.
 */
export const DEV_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss: http://localhost:* http://127.0.0.1:*"

/**
 * AC6: `style-src 'unsafe-inline'` stays for now even though this story makes the rest of the
 * policy genuinely enforced. Tightening it means auditing every inline style Tailwind/React emit
 * at runtime, which is a real piece of work on its own — it is deferred to a `docs/ROADMAP.md`
 * "Hardening" bullet, not folded into this story or spun out as a new one.
 */
export const PRODUCTION_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'"

export interface ResolveRendererSourceInput {
  isDev: boolean
  /** `ELECTRON_RENDERER_URL` when the Vite dev server is up, `undefined`/empty otherwise. */
  devServerUrl: string | undefined
}

export type RendererSource = { kind: 'dev-server'; url: string } | { kind: 'scheme' }

/**
 * The single mode decision both `index.ts` (which CSP hook to register) and `window.ts` (which
 * URL to load) read. Deliberately keyed off the dev server being present, not merely `isDev` -
 * an unpackaged dev build with no dev server (e.g. the UI-verification harness) must still get
 * the production scheme and policy.
 */
export function resolveRendererSource(input: ResolveRendererSourceInput): RendererSource {
  if (input.isDev && input.devServerUrl) {
    return { kind: 'dev-server', url: input.devServerUrl }
  }
  return { kind: 'scheme' }
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  // The boot splash hero (`src/renderer/src/assets/boot-hero.avif`) is the one bitmap the bundle
  // emits; without this entry it would be served as `application/octet-stream` and only render
  // because Chromium sniffs image bytes.
  '.avif': 'image/avif',
  '.ico': 'image/vnd.microsoft.icon',
  '.json': 'application/json',
}

const DEFAULT_MIME_TYPE = 'application/octet-stream'

function extensionOf(path: string): string {
  const lastDot = path.lastIndexOf('.')
  const lastSlash = path.lastIndexOf('/')
  if (lastDot === -1 || lastDot < lastSlash) return ''
  return path.slice(lastDot)
}

function mimeTypeFor(path: string): string {
  return MIME_TYPES[extensionOf(path)] ?? DEFAULT_MIME_TYPE
}

/**
 * Joins `root` with a request path the same way `node:path.join` would, then verifies the
 * result stays inside `root` - the pure equivalent of `path.join` + a containment check, kept
 * local so this file needs no `node:path` import (and stays testable with fake paths that don't
 * necessarily exist on disk).
 */
function resolveWithinRoot(root: string, requestPath: string): string | null {
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '')
  // A decoded segment can smuggle in a literal backslash (e.g. from `%5C` in the request URL).
  // `fs.readFile` treats `\` as a path separator on Windows, so it must be normalized to `/`
  // here - same as `root` above - before splitting into segments, or a token like `..\..\` would
  // be treated as one opaque segment instead of two `..` tokens the stack guard below rejects.
  const segments = requestPath.replace(/\\/g, '/').split('/')

  const stack: string[] = []
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (stack.length === 0) return null // would climb above root
      stack.pop()
      continue
    }
    stack.push(segment)
  }

  return `${normalizedRoot}/${stack.join('/')}`
}

export interface CreateRendererProtocolHandlerInput {
  /** Absolute path to the built renderer directory (`out/renderer` in production). */
  root: string
  /** CSP header value attached to every response this handler produces. */
  csp: string
  /** Injectable file reader so tests can supply an in-memory implementation. */
  readFile: (path: string) => Promise<Buffer>
}

/**
 * Builds the `(request: Request) => Promise<Response>` handler `protocol.handle(RENDERER_SCHEME,
 * ...)` registers. Owns the response instead of delegating to `net.fetch(file://...)` so the
 * content type and the CSP header are deterministic and unit-testable without Electron.
 */
export function createRendererProtocolHandler(
  input: CreateRendererProtocolHandlerInput,
): (request: Request) => Promise<Response> {
  const { root, csp, readFile } = input

  // Every response this handler returns must carry the CSP - including 404s, so a missing or
  // corrupt file inside the packaged asar still produces a policy-protected document instead of
  // a policy-less fail-open one. Built per handler instance since it closes over `csp`.
  const notFound = (): Response => new Response(null, { status: 404, headers: { 'Content-Security-Policy': csp } })

  return async function handleRendererRequest(request: Request): Promise<Response> {
    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      return notFound()
    }

    if (url.hostname !== RENDERER_HOST) return notFound()

    // `url.pathname` only collapses literal `/../` sequences - a segment smuggled in as `%2f`
    // (or an otherwise-encoded slash) survives the URL parser untouched and would still contain
    // a live `..` once decoded for the filesystem lookup below. Decoding the whole pathname
    // before splitting on `/` (matching how a real file server resolves it) is what lets
    // `resolveWithinRoot`'s segment-stack check see - and reject - that escape attempt.
    let decodedPath: string
    try {
      decodedPath = decodeURIComponent(url.pathname)
    } catch {
      return notFound()
    }

    const requestPath = decodedPath === '' || decodedPath === '/' ? '/index.html' : decodedPath

    const resolvedPath = resolveWithinRoot(root, requestPath)
    if (resolvedPath === null) return notFound()

    let contents: Buffer
    try {
      contents = await readFile(resolvedPath)
    } catch {
      return notFound()
    }

    return new Response(contents, {
      status: 200,
      headers: {
        'Content-Type': mimeTypeFor(resolvedPath),
        'Content-Security-Policy': csp,
      },
    })
  }
}
