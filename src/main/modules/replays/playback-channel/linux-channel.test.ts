import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLinuxChannel } from './linux-channel'
import type { EngineIo } from './types'

function makeIo() {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const written: string[] = []
  stdin.on('data', (d: Buffer) => written.push(d.toString()))
  const listeners = new Set<(l: string) => void>()
  let buf = ''
  stdout.on('data', (d: Buffer) => {
    buf += d.toString()
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      for (const cb of listeners) cb(line)
    }
  })
  const io: EngineIo = {
    writeLine: (line) => void stdin.write(line + '\n'),
    onLine: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
  }
  return { io, stdout, written }
}

const log = { debug: vi.fn(), warn: vi.fn() }

describe('linux playback channel', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('a command reaches the engine stdin and position is parsed from stdout', async () => {
    const { io, stdout, written } = makeIo()
    const ch = createLinuxChannel({ io, log })
    await ch.start()
    expect(ch.send('seek +10').ok).toBe(true)
    expect(written.join('')).toBe('seek +10\n')
    stdout.write('POS 0:14.5\n')
    expect(ch.latest().positionMs).toBe(14500)
    stdout.write('POS 0:2')
    stdout.write('0.0\n')
    expect(ch.latest().positionMs).toBe(20000)
    stdout.write('POS\n')
    expect(ch.latest().positionMs).toBeNull()
    await ch.close()
  })

  it('polls the position every 100 ms', async () => {
    const { io, written } = makeIo()
    const ch = createLinuxChannel({ io, log })
    await ch.start()
    vi.advanceTimersByTime(350)
    expect(written.filter((w) => w === 'echo POS $cl_demopos\n')).toHaveLength(3)
    await ch.close()
  })

  it('Demo finished stops the poll, fires onFinished and rejects later sends', async () => {
    const { io, stdout, written } = makeIo()
    const ch = createLinuxChannel({ io, log })
    const cb = vi.fn()
    ch.onFinished(cb)
    await ch.start()
    stdout.write('Demo finished\n')
    expect(cb).toHaveBeenCalledTimes(1)
    expect(ch.latest().finished).toBe(true)
    const before = written.length
    vi.advanceTimersByTime(500)
    expect(written.length).toBe(before)
    const r = ch.send('seek +10')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.key).toBe('replays.playback.error.noSession')
    await ch.close()
    await ch.close()
    expect(written.filter((w) => w === 'set sys_console 0\n')).toHaveLength(1)
  })

  it('rejects a line containing a newline and writes nothing', async () => {
    const { io, written } = makeIo()
    const ch = createLinuxChannel({ io, log })
    await ch.start()
    expect(ch.send('seek +10\nquit').ok).toBe(false)
    expect(written).toEqual([])
    await ch.close()
  })

  it('close stops the poll and writes set sys_console 0 once while live', async () => {
    const { io, written } = makeIo()
    const ch = createLinuxChannel({ io, log })
    await ch.start()
    await ch.close()
    await ch.close()
    vi.advanceTimersByTime(500)
    expect(written.filter((w) => w === 'set sys_console 0\n')).toHaveLength(1)
    expect(written.filter((w) => w.startsWith('echo POS'))).toHaveLength(0)
  })
})
