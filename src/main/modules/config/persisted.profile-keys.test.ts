import { describe, expectTypeOf, it } from 'vitest'
import type { z } from 'zod'
import type { ConfigProfile } from '@shared/modules/config'
import type { configProfileObjectSchema } from './persisted'

describe('persisted profile schema keys', () => {
  // A ConfigProfile key the object schema does not declare would be stripped on every load.
  it("the persisted profile schema's output keys are ConfigProfile's keys", () => {
    expectTypeOf<keyof z.output<typeof configProfileObjectSchema>>().toEqualTypeOf<
      keyof ConfigProfile
    >()
  })
})
