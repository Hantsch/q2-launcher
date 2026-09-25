import { describe, expect, it } from 'vitest'
import { MODULE_MANIFESTS } from './types/module'
import {
  iconDataUrlInputSchema,
  installationIconSchema,
  launchInputSchema,
  moduleInvokeSchema,
  pickIconFileInputSchema,
  setInstallationIconInputSchema,
  shippedIconIdSchema,
  updateCheckSchema,
  updateGetStateSchema,
} from './ipc-schemas'

/**
 * `moduleInvokeSchema`'s `moduleId` is a hand-written zod enum with no structural link to
 * `ModuleId`/`MODULE_MANIFESTS` (`src/shared/types/module.ts`) - a reviewer found it had silently
 * omitted `'home'`, which made the whole module unreachable through real IPC while the rest of the
 * test suite stayed green (nothing else exercises the enum against the manifest list). This test is
 * the coupling guard: a future module added to `MODULE_MANIFESTS` without a matching update here
 * fails immediately instead of silently breaking IPC.
 */
describe('moduleInvokeSchema', () => {
  it('accepts exactly the module ids known to MODULE_MANIFESTS, no more, no fewer', () => {
    const manifestIds = MODULE_MANIFESTS.map((manifest) => manifest.id).sort()

    for (const id of manifestIds) {
      const result = moduleInvokeSchema.safeParse({ moduleId: id, type: 'anything' })
      expect(result.success).toBe(true)
    }

    // `moduleInvokeSchema` is exported as the widened `z.ZodType`, so its object/enum shape is only
    // reachable at runtime - `as any` here is a test-only introspection, not a production cast.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enumSchema = (moduleInvokeSchema as any).shape.moduleId
    expect([...enumSchema.options].sort()).toEqual(manifestIds)

    // Also reject a module id that is not in the manifest at all, so this test cannot pass by the
    // enum being trivially permissive.
    expect(moduleInvokeSchema.safeParse({ moduleId: 'not-a-real-module', type: 'x' }).success).toBe(
      false,
    )
  })
})

/**
 * Story 067 D3: the shipped-icon id is a bounded slug, never a path. This is a
 * security-relevant acceptance criterion - a renderer-supplied id must not be
 * usable to escape `src/renderer/src/assets/installations`. The lookup itself
 * (`shippedIconUrl`, `src/renderer/src/lib/installation-icons.ts`) is a plain
 * manifest map, never a filesystem join - this bound is defence-in-depth, not
 * something a real path traversal could otherwise reach, but any path-shaped
 * id is still rejected here rather than trusted to be harmless downstream.
 */
describe('shippedIconIdSchema', () => {
  it('accepts a plain lowercase slug', () => {
    expect(shippedIconIdSchema.safeParse('classic-q2').success).toBe(true)
  })

  it.each([
    ['relative traversal', '../foo'],
    ['nested relative traversal', '../../etc/passwd'],
    ['unix absolute path', '/etc/passwd'],
    ['windows absolute path', 'C:\\evil'],
    ['forward slash', 'foo/bar'],
    ['backslash', 'foo\\bar'],
    ['uppercase', 'Foo'],
    ['empty string', ''],
    ['too long', 'a'.repeat(65)],
  ])('rejects %s (%j)', (_label, value) => {
    expect(shippedIconIdSchema.safeParse(value).success).toBe(false)
  })
})

describe('installationIconSchema', () => {
  it('accepts a shipped icon with a valid id', () => {
    const result = installationIconSchema.safeParse({ kind: 'shipped', id: 'classic-q2' })
    expect(result.success).toBe(true)
  })

  it('rejects a shipped icon whose id is a path', () => {
    const result = installationIconSchema.safeParse({ kind: 'shipped', id: '../../etc/passwd' })
    expect(result.success).toBe(false)
  })

  it('accepts a custom icon', () => {
    expect(installationIconSchema.safeParse({ kind: 'custom' }).success).toBe(true)
  })

  it('rejects an unknown kind', () => {
    expect(installationIconSchema.safeParse({ kind: 'bogus' }).success).toBe(false)
  })
})

describe('setInstallationIconInputSchema', () => {
  it('accepts a shipped icon payload', () => {
    const result = setInstallationIconInputSchema.safeParse({
      installationId: 'inst-1',
      icon: { kind: 'shipped', id: 'classic-q2' },
    })
    expect(result.success).toBe(true)
  })

  it('accepts a custom icon payload', () => {
    const result = setInstallationIconInputSchema.safeParse({
      installationId: 'inst-1',
      icon: { kind: 'custom' },
    })
    expect(result.success).toBe(true)
  })

  it('accepts a null icon (clearing it)', () => {
    const result = setInstallationIconInputSchema.safeParse({
      installationId: 'inst-1',
      icon: null,
    })
    expect(result.success).toBe(true)
  })

  it('rejects a shipped icon id shaped like a path', () => {
    const result = setInstallationIconInputSchema.safeParse({
      installationId: 'inst-1',
      icon: { kind: 'shipped', id: '../../etc/passwd' },
    })
    expect(result.success).toBe(false)
  })

  it('rejects a missing installationId', () => {
    const result = setInstallationIconInputSchema.safeParse({ icon: null })
    expect(result.success).toBe(false)
  })
})

describe('pickIconFileInputSchema', () => {
  it('accepts a bare installationId', () => {
    expect(pickIconFileInputSchema.safeParse({ installationId: 'inst-1' }).success).toBe(true)
  })

  it('rejects an empty installationId', () => {
    expect(pickIconFileInputSchema.safeParse({ installationId: '' }).success).toBe(false)
  })
})

describe('iconDataUrlInputSchema', () => {
  it('accepts a bare id string', () => {
    expect(iconDataUrlInputSchema.safeParse('inst-1').success).toBe(true)
  })

  it('rejects an empty string', () => {
    expect(iconDataUrlInputSchema.safeParse('').success).toBe(false)
  })
})

/**
 * Story 097 D1: `update:getState` and `update:check` are declared, no-payload
 * channels (mirrors `launch:getState`'s `z.void()` convention) - a non-void
 * payload must be rejected, not silently accepted.
 */
describe('updateGetStateSchema', () => {
  it('accepts undefined (void)', () => {
    expect(updateGetStateSchema.safeParse(undefined).success).toBe(true)
  })

  it('rejects a non-void payload', () => {
    expect(updateGetStateSchema.safeParse({ foo: 1 }).success).toBe(false)
  })
})

describe('updateCheckSchema', () => {
  it('accepts undefined (void)', () => {
    expect(updateCheckSchema.safeParse(undefined).success).toBe(true)
  })

  it('rejects a non-void payload', () => {
    expect(updateCheckSchema.safeParse({ foo: 1 }).success).toBe(false)
  })
})

/**
 * Story 125 D1: `launch:start`/`launch:plan` share `launchInputSchema` - `connect` must go through
 * `serverAddressSchema` (rejecting an argument-token or unparsable address) and `userinfo.password`/
 * `userinfo.spectator` must go through `launchUserinfoValueSchema` (rejecting a forbidden character),
 * same "paths/values from the renderer are never trusted" rule as every other IPC payload here.
 */
describe('launch:start refuses an unvalidated connect or userinfo value', () => {
  it('rejects a connect value carrying a console argument token', () => {
    const result = launchInputSchema.safeParse({
      installationId: 'inst-1',
      connect: '1.2.3.4:27910 +quit',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a connect value with a forbidden character', () => {
    const result = launchInputSchema.safeParse({
      installationId: 'inst-1',
      connect: 'evil;quit:27910',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a userinfo password containing forbidden characters', () => {
    const result = launchInputSchema.safeParse({
      installationId: 'inst-1',
      userinfo: { password: 'x";quit;"' },
    })
    expect(result.success).toBe(false)
  })

  it('accepts a valid address and normalises it', () => {
    const result = launchInputSchema.safeParse({
      installationId: 'inst-1',
      connect: 'Q2.Example.COM:27910',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.connect).toBe('q2.example.com:27910')
    }
  })
})
