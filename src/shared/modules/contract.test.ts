import { z } from 'zod'
import { describe, expectTypeOf, it } from 'vitest'
import type { ContractSchemas, EventPayload, HandlerReq, HandlerRes, PayloadArgs } from './contract'

const renameSchema = z.object({
  id: z.string(),
  // A transform makes the schema's input and output differ: the contract follows the output.
  title: z.string().transform((title) => title.trim()),
  note: z.string().optional(),
})

type RenameContract = {
  handlers: {
    rename: { req: z.infer<typeof renameSchema>; res: { renamed: boolean } }
    list: { req: void; res: string[] }
  }
  events: { renamed: { id: string } }
}

describe('module contract types', () => {
  it("a contract's req is the schema's z.infer", () => {
    expectTypeOf<HandlerReq<RenameContract, 'rename'>>().toEqualTypeOf<{
      id: string
      title: string
      note?: string | undefined
    }>()
    expectTypeOf<HandlerReq<RenameContract, 'rename'>>().toEqualTypeOf<
      z.output<typeof renameSchema>
    >()
    expectTypeOf(renameSchema).toExtend<ContractSchemas<RenameContract>['rename']>()
    expectTypeOf(z.void()).toExtend<ContractSchemas<RenameContract>['list']>()
    expectTypeOf(z.object({ id: z.number() })).not.toExtend<
      ContractSchemas<RenameContract>['rename']
    >()
  })

  it("a contract's res and event payloads are read back unchanged", () => {
    expectTypeOf<HandlerRes<RenameContract, 'rename'>>().toEqualTypeOf<{ renamed: boolean }>()
    expectTypeOf<HandlerRes<RenameContract, 'list'>>().toEqualTypeOf<string[]>()
    expectTypeOf<EventPayload<RenameContract, 'renamed'>>().toEqualTypeOf<{ id: string }>()
  })

  it('a payload argument is omitted only when req is void or undefined', () => {
    expectTypeOf<PayloadArgs<void>>().toEqualTypeOf<[]>()
    expectTypeOf<PayloadArgs<undefined>>().toEqualTypeOf<[]>()
    expectTypeOf<PayloadArgs<{ id: string }>>().toEqualTypeOf<[payload: { id: string }]>()
    // Does not distribute: an optional payload is still one argument, never `[] | [string]`.
    expectTypeOf<PayloadArgs<string | undefined>>().toEqualTypeOf<[payload: string | undefined]>()
  })
})
