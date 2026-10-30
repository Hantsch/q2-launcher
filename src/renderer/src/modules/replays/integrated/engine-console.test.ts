import { beforeEach, describe, expect, it } from 'vitest'
import { clearConsole, consoleLines, pushLine } from './engine-console'

beforeEach(clearConsole)

describe('engine console', () => {
  it('the ring keeps the newest 500 lines', () => {
    for (let i = 0; i < 503; i++) pushLine(`line ${i}`)
    const lines = consoleLines()
    expect(lines).toHaveLength(500)
    expect(lines[0]).toBe('line 3')
    expect(lines[499]).toBe('line 502')
  })

  it('clearing empties the ring', () => {
    pushLine('a')
    clearConsole()
    expect(consoleLines()).toEqual([])
  })

  it('a returned snapshot does not change when more lines arrive', () => {
    pushLine('a')
    const snapshot = consoleLines()
    pushLine('b')
    expect(snapshot).toEqual(['a'])
  })
})
