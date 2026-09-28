import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { absolutePathSchema } from '../schemas'
import {
  discoveredDemoSchema,
  nameTemplateTextSchema,
  REPLAYS_HANDLERS,
  REPLAYS_HANDLER_SCHEMAS,
  REPLAYS_PATH_PAYLOAD_HANDLERS,
} from './replays'

describe('replays module contract (story 135 D1)', () => {
  it('every replays handler has a zod schema', () => {
    for (const name of Object.values(REPLAYS_HANDLERS)) {
      expect(REPLAYS_HANDLER_SCHEMAS[name]).toBeDefined()
    }
  })

  it('no schema exists without a corresponding handler', () => {
    const handlerNames = new Set<string>(Object.values(REPLAYS_HANDLERS))
    for (const name of Object.keys(REPLAYS_HANDLER_SCHEMAS)) {
      expect(handlerNames.has(name)).toBe(true)
    }
  })

  it('the no-input overview handler accepts undefined', () => {
    expect(
      REPLAYS_HANDLER_SCHEMAS[REPLAYS_HANDLERS.overviewRead].safeParse(undefined).success,
    ).toBe(true)
  })

  it('demos.reveal and demos.copyPath reject a payload carrying a path', () => {
    const revealSchema = REPLAYS_HANDLER_SCHEMAS[REPLAYS_HANDLERS.demosReveal]
    const copyPathSchema = REPLAYS_HANDLER_SCHEMAS[REPLAYS_HANDLERS.demosCopyPath]
    expect(revealSchema.safeParse({ demoId: 'x', path: '/tmp/y' }).success).toBe(false)
    expect(copyPathSchema.safeParse({ demoId: 'x', path: '/tmp/y' }).success).toBe(false)
    expect(revealSchema.safeParse({ demoId: 'x' }).success).toBe(true)
  })

  it('no demo file action is a path-payload handler', () => {
    expect(REPLAYS_PATH_PAYLOAD_HANDLERS).not.toContain(REPLAYS_HANDLERS.demosReveal)
    expect(REPLAYS_PATH_PAYLOAD_HANDLERS).not.toContain(REPLAYS_HANDLERS.demosCopyPath)
  })

  it('nameTemplateTextSchema enforces the length cap and printable characters', () => {
    expect(nameTemplateTextSchema.safeParse('a'.repeat(129)).success).toBe(false)
    expect(nameTemplateTextSchema.safeParse('a'.repeat(128)).success).toBe(true)
    expect(nameTemplateTextSchema.safeParse('a\tb').success).toBe(false)
    expect(nameTemplateTextSchema.safeParse('café').success).toBe(false)
    expect(nameTemplateTextSchema.safeParse('a/b').success).toBe(false)
    expect(nameTemplateTextSchema.safeParse('{date}_{map}').success).toBe(true)
  })

  it('a discovered demo carries no filesystem path', () => {
    const parsed = discoveredDemoSchema.parse({
      id: '0123456789abcdef',
      fileName: 'match1.dm2',
      format: 'dm2',
      gzip: false,
      source: {
        kind: 'installation',
        installationId: 'inst-1',
        installationName: 'My Install',
        gameDir: 'baseq2',
      },
      archiveEntry: null,
      map: null,
      unparsableReason: null,
      readable: true,
      unreadable: null,
      gameDir: null,
      pov: null,
      players: [],
      durationMs: null,
      fileTime: { birthtimeMs: 0, mtimeMs: 0 },
      nameFacts: null,
    })

    const isSuspectKey = (key: string) => /path|dir$|folder/i.test(key) && key !== 'gameDir'

    for (const key of Object.keys(parsed)) {
      expect(isSuspectKey(key)).toBe(false)
    }
    for (const key of Object.keys(parsed.source)) {
      expect(isSuspectKey(key)).toBe(false)
    }
  })
})

/**
 * Walks a zod schema looking for a filesystem path: either `absolutePathSchema` itself, or an
 * object key whose name matches /path|dir$|folder|file/i. Unwraps optional/nullable/default
 * wrappers and recurses into object shapes and arrays. Not a general zod introspector - just
 * enough to prove no `replays` handler payload smuggles a renderer-supplied path (CLAUDE.md:
 * "Paths from the renderer are never trusted"). `dir$` (not a bare `dir`), same convention this
 * file's own `discoveredDemoSchema` test above uses for `gameDir` - story 152 D2's `direction`
 * (list-sort payload) merely contains "dir" as a substring and is not a path-shaped key.
 */
function findPathLeak(schema: z.ZodTypeAny, keyName?: string): string | undefined {
  if ((schema as unknown) === (absolutePathSchema as unknown)) {
    return keyName ? `key "${keyName}" uses absolutePathSchema` : 'schema is absolutePathSchema'
  }

  if (keyName && /path|dir$|folder|file/i.test(keyName)) {
    return `key "${keyName}" looks like a filesystem path`
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const def = (schema as any).def as Record<string, unknown> | undefined
  if (!def) return undefined

  // Unwrap optional/nullable/default (and any other single-inner-type wrapper).
  if (def.innerType) {
    return findPathLeak(def.innerType as z.ZodTypeAny, keyName)
  }

  if (def.type === 'object' && def.shape) {
    for (const [key, value] of Object.entries(def.shape as Record<string, z.ZodTypeAny>)) {
      const found = findPathLeak(value, key)
      if (found) return found
    }
    return undefined
  }

  if (def.type === 'array' && def.element) {
    return findPathLeak(def.element as z.ZodTypeAny, keyName)
  }

  if (def.type === 'union' && Array.isArray(def.options)) {
    for (const option of def.options as z.ZodTypeAny[]) {
      const found = findPathLeak(option, keyName)
      if (found) return found
    }
    return undefined
  }

  return undefined
}

describe('no replays handler payload carries a filesystem path', () => {
  it('REPLAYS_HANDLER_SCHEMAS is clean (empty of paths, as expected)', () => {
    for (const [name, schema] of Object.entries(REPLAYS_HANDLER_SCHEMAS)) {
      if (REPLAYS_PATH_PAYLOAD_HANDLERS.includes(name)) continue
      expect(findPathLeak(schema)).toBeUndefined()
    }
  })

  it('the walker itself is not vacuous: it flags a direct path-shaped key', () => {
    const dirty = z.object({ demoPath: z.string() })
    expect(findPathLeak(dirty)).toBeDefined()
  })

  it('the walker itself is not vacuous: it flags a nested absolutePathSchema', () => {
    const dirty = z.object({
      nested: z.object({
        target: absolutePathSchema,
      }),
    })
    expect(findPathLeak(dirty)).toBeDefined()
  })
})
