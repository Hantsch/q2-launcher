import { vi } from 'vitest'

/**
 * Factory body for `vi.mock('./client', ...)`: every function export of the real module becomes a
 * bare `vi.fn()`, so an export the test did not list can never reach the real `window.api` bridge.
 * `overrides` is typed against the module, so a renamed or removed export fails `npm run typecheck`
 * instead of silently mocking nothing. Constants keep their original value.
 *
 * `vi.mock` is hoisted and resolves its path relative to the test file, hence the
 * `importOriginal` argument instead of a path:
 * `vi.mock('./client', (importOriginal) => mockClient<typeof import('./client')>(importOriginal, {...}))`.
 */
export async function mockClient<M extends object>(
  importOriginal: () => Promise<M>,
  overrides: Partial<M> = {},
): Promise<M> {
  const original = await withBridgeStub(importOriginal)
  const stubbed = Object.fromEntries(
    Object.entries(original).map(([name, value]) => [
      name,
      typeof value === 'function' ? vi.fn() : value,
    ]),
  )
  return { ...stubbed, ...overrides } as M
}

/**
 * Client modules import `lib/bridge`, which throws at import time without `window.q2`. Give the
 * import a throw-away stub (the bridge captures it once, so nothing real is reached) and put the
 * previous state back afterwards, in node (no `window`) and jsdom alike.
 */
async function withBridgeStub<T>(load: () => Promise<T>): Promise<T> {
  const g = globalThis as { window?: { q2?: unknown } }
  if (g.window?.q2) return load()
  const stub = { invoke: vi.fn(), on: vi.fn() }
  const hadWindow = g.window !== undefined
  if (!hadWindow) g.window = { q2: stub }
  else g.window!.q2 = stub
  try {
    return await load()
  } finally {
    if (!hadWindow) delete g.window
    else delete g.window!.q2
  }
}
