/**
 * Story 100 D1. `process.platform` is read-only in TypeScript's types but configurable at
 * runtime (Node defines it with `configurable: true`), so tests that need to prove behaviour for
 * a specific host platform - without actually running on that host - stub it with
 * `Object.defineProperty` and restore the original descriptor afterwards.
 *
 * This is the only file allowed to touch `process.platform` directly - see
 * `scripts/platform-assertions.test.mjs`, which fails the suite if any other test file asserts
 * against it (stubbed or not) instead of going through `stubPlatform`.
 */

const PLATFORM_DESCRIPTOR = Object.getOwnPropertyDescriptor(process, 'platform')

/**
 * Stubs `process.platform` to `value` and returns a restore function that puts the original
 * descriptor back. Typical use:
 *
 * ```ts
 * let restore: () => void
 * beforeEach(() => { restore = stubPlatform('linux') })
 * afterEach(() => restore())
 * ```
 */
export function stubPlatform(value: NodeJS.Platform): () => void {
  if (!PLATFORM_DESCRIPTOR) {
    throw new Error('process.platform has no own property descriptor to restore')
  }

  Object.defineProperty(process, 'platform', {
    ...PLATFORM_DESCRIPTOR,
    value,
  })

  return () => {
    Object.defineProperty(process, 'platform', PLATFORM_DESCRIPTOR)
  }
}
