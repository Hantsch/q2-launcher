import { describe, expect, it } from 'vitest'
import { createEngineDataPort } from './engine-data-port'

describe('createEngineDataPort', () => {
  it('a port nobody provided resolves to null', async () => {
    expect(await createEngineDataPort().resolve('t', 0)).toBeNull()
  })

  it('a provided resolver answers resolve with its entry', async () => {
    const port = createEngineDataPort()
    port.provide(async (token, index) => ({
      kind: 'bytes',
      bytes: new Uint8Array([index]),
      size: token.length,
    }))
    expect(await port.resolve('abc', 7)).toEqual({
      kind: 'bytes',
      bytes: new Uint8Array([7]),
      size: 3,
    })
  })
})
