import { expect } from 'vitest'

/** The value of a handler's `ok(...)` envelope; fails the test when the handler answered `fail(...)`. */
export function unwrapOk<T>(outcome: unknown): T {
  const o = outcome as { ok: boolean; value?: unknown }
  expect(o.ok).toBe(true)
  return o.value as T
}
