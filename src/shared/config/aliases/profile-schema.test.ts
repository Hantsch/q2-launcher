import { describe, expect, expectTypeOf, it } from 'vitest'
import type { z } from 'zod'
import type { AltLayer } from './alt-layers'
import type { ModifierTrigger } from './modifier-layers'
import type {
  ActionEntryKind,
  ActionEntryPart,
  ActionKeySlot,
  ConfigAction,
  ConfigActionCategory,
  ConfigActionSubcategory,
  ConfigCommand,
  ConfigCvarSection,
  ConfigCvarSubsection,
} from '../../modules/config'
import {
  actionEntryKindSchema,
  actionEntryPartObjectSchema,
  actionKeySlotObjectSchema,
  actionTextSchema,
  altLayerObjectSchema,
  configActionCategoryObjectSchema,
  configActionObjectSchema,
  configActionSchema,
  configActionSubcategoryObjectSchema,
  configCommandSchema,
  configCvarSectionObjectSchema,
  configCvarSubsectionObjectSchema,
  modifierTriggerSchema,
} from './profile-schema'

// Compared against the plain object schemas: the `z.ZodType<…>`-annotated consts would make any
// `z.infer` on them a comparison of the annotation with itself. Each shape is checked in both
// directions (mutual assignability, so loosening or tightening a contract field fails) plus the
// key sets (a contract key the object schema does not declare would be stripped on every parse).
type Assignable<From, To> = [From] extends [To] ? true : false

describe('profile sub-shape object schemas match their contract types', () => {
  it('configActionSchema infers exactly ConfigAction', () => {
    // `keepEmptyAlias` is the one ConfigAction key no reader declares yet, so zod strips it on parse.
    type Out = z.output<typeof configActionObjectSchema>
    // Out -> ConfigAction holds as is. The reverse is checked without `keys` and `keepEmptyAlias`, which the contract
    // declares `readonly` (a mutable array schema output is assignable to it, not the other way);
    // the `keys` element type is pinned separately.
    type Shared = Exclude<keyof ConfigAction, 'keys' | 'keepEmptyAlias'>
    expectTypeOf<Assignable<Out, ConfigAction>>().toEqualTypeOf<true>()
    expectTypeOf<Assignable<Pick<ConfigAction, Shared>, Pick<Out, Shared>>>().toEqualTypeOf<true>()
    expectTypeOf<Out['keys']>().toEqualTypeOf<ActionKeySlot[] | undefined>()
    expectTypeOf<ConfigAction['keys']>().toEqualTypeOf<readonly ActionKeySlot[] | undefined>()
    expectTypeOf<keyof Out>().toEqualTypeOf<Exclude<keyof ConfigAction, 'keepEmptyAlias'>>()
  })

  it('every other object schema is mutually assignable with its contract and has its keys', () => {
    expectTypeOf<z.output<typeof actionEntryPartObjectSchema>>().toEqualTypeOf<ActionEntryPart>()
    expectTypeOf<z.output<typeof actionKeySlotObjectSchema>>().toEqualTypeOf<ActionKeySlot>()
    expectTypeOf<
      z.output<typeof configActionCategoryObjectSchema>
    >().toEqualTypeOf<ConfigActionCategory>()
    expectTypeOf<
      z.output<typeof configActionSubcategoryObjectSchema>
    >().toEqualTypeOf<ConfigActionSubcategory>()
    expectTypeOf<
      z.output<typeof configCvarSectionObjectSchema>
    >().toEqualTypeOf<ConfigCvarSection>()
    expectTypeOf<
      z.output<typeof configCvarSubsectionObjectSchema>
    >().toEqualTypeOf<ConfigCvarSubsection>()
    expectTypeOf<z.output<typeof altLayerObjectSchema>>().toEqualTypeOf<AltLayer>()
  })

  it('the vocabulary schemas infer exactly their contract types', () => {
    expectTypeOf<z.infer<typeof configCommandSchema>>().toEqualTypeOf<ConfigCommand>()
    expectTypeOf<z.infer<typeof modifierTriggerSchema>>().toEqualTypeOf<ModifierTrigger>()
    expectTypeOf<z.infer<typeof actionEntryKindSchema>>().toEqualTypeOf<ActionEntryKind>()
  })
})

describe('profile sub-shape schemas enforce the rules both readers share', () => {
  it('action text rejects double quotes and non-latin-1 characters', () => {
    expect(actionTextSchema.safeParse('say hi').success).toBe(true)
    expect(actionTextSchema.safeParse('say "hi"').success).toBe(false)
    expect(actionTextSchema.safeParse('say 世').success).toBe(false)
  })

  it('a two-part action needs exactly two parts', () => {
    const action = { id: 'a', categoryId: 'c', name: 'A', kind: 'toggle', commands: [] }
    expect(configActionSchema.safeParse({ ...action, parts: [{ commands: [] }] }).success).toBe(
      false,
    )
    expect(
      configActionSchema.safeParse({ ...action, parts: [{ commands: [] }, { commands: [] }] })
        .success,
    ).toBe(true)
  })
})
