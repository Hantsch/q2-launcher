import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  LIBRARY_HANDLERS,
  LIBRARY_HANDLER_SCHEMAS,
  type LibraryContract,
  type LibraryStats,
} from './library'

describe('LibraryContract', () => {
  it('LibraryContract req types are derived from LIBRARY_HANDLER_SCHEMAS', () => {
    expectTypeOf<LibraryContract['handlers']['stats']['req']>().toEqualTypeOf<void>()
    expectTypeOf<LibraryContract['handlers']['stats']['res']>().toEqualTypeOf<LibraryStats>()
  })

  it('LIBRARY_HANDLER_SCHEMAS has exactly one schema per LIBRARY_HANDLERS value', () => {
    expect(Object.keys(LIBRARY_HANDLER_SCHEMAS).sort()).toEqual(
      Object.values(LIBRARY_HANDLERS).sort(),
    )
  })
})
