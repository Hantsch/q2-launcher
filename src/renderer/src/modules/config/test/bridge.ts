import { vi } from 'vitest'

/**
 * `lib/bridge.ts` resolves `window.q2` at module scope and throws when it is missing, so the stub
 * must exist before any component is imported: a test file imports this harness first, and ES
 * imports evaluate in order.
 */
const stub = {
  invoke: vi.fn((..._args: unknown[]) => Promise.resolve({ ok: true, value: [] as unknown })),
  on: () => () => {},
}
;(globalThis as unknown as { q2: unknown }).q2 = stub

/** Resets the shared stub to "every invoke succeeds with an empty list" and returns it. */
export function stubBridge(): typeof stub {
  stub.invoke.mockReset()
  stub.invoke.mockImplementation(() => Promise.resolve({ ok: true, value: [] }))
  return stub
}
