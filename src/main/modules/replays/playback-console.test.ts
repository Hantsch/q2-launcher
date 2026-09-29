import { describe, expect, it, vi } from 'vitest'
import { fail, ok, type Outcome } from '@shared/types'
import { replaysConsoleSendSchema } from '@shared/modules/replays'
import { createPlaybackConsole } from './playback-console'

/** Story 166 D2: `playback.consoleSend` validates in main, sends once, and types its failures. */

function setup(result: Outcome<void> = ok(undefined)) {
  const send = vi.fn((_line: string): Outcome<void> => result)
  return { send, console: createPlaybackConsole({ playback: { send } }) }
}

describe('playback console', () => {
  it('a valid line is sent once, trimmed', () => {
    const { send, console } = setup()
    expect(console.send('  say "hi"; echo $x  ')).toEqual(ok(undefined))
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('say "hi"; echo $x')
  })

  it('an invalid line never reaches the channel and names its reason', () => {
    const { send, console } = setup()
    const cases: Array<[string, string]> = [
      ['   ', 'empty'],
      ['a\nb', 'multiline'],
      ['a\u0007b', 'control'],
      ['café', 'nonAscii'],
      ['x'.repeat(1025), 'tooLong'],
    ]
    for (const [line, reason] of cases) {
      expect(console.send(line)).toEqual(fail(`replays.console.error.${reason}`))
    }
    expect(send).not.toHaveBeenCalled()
    expect(replaysConsoleSendSchema.safeParse({ line: 'x'.repeat(1025) }).success).toBe(false)
    expect(replaysConsoleSendSchema.safeParse({ line: 'a', extra: 1 }).success).toBe(false)
  })

  it('no session is a typed noSession failure', () => {
    const { console } = setup(fail('replays.playback.error.noSession'))
    expect(console.send('echo hi')).toEqual(fail('replays.console.error.noSession'))
  })

  it('other channel failures pass through unchanged', () => {
    const { console } = setup(fail('replays.playback.error.busy'))
    expect(console.send('echo hi')).toEqual(fail('replays.playback.error.busy'))
  })
})
