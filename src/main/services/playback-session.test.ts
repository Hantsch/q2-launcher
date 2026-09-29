import { PassThrough } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openPlaybackSession } from './playback-session'

/**
 * Story 163 D1. The session runs over real `PassThrough` streams standing in for a child's pipes,
 * so backpressure, a broken pipe and an ended stdin behave as they do on a real process.
 */

const logMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  verbose: vi.fn(),
  silly: vi.fn(),
  log: vi.fn(),
}))
vi.mock('../lib/logger', () => ({
  scopedLogger: () => logMock,
  logger: logMock,
  logFilePath: () => '',
}))

/** Everything the child has read from its stdin so far. */
function collect(stream: PassThrough): () => string {
  let text = ''
  stream.on('data', (chunk: Buffer) => {
    text += chunk.toString('utf8')
  })
  return () => text
}

beforeEach(() => {
  for (const fn of Object.values(logMock)) fn.mockClear()
})

describe('PlaybackSession', () => {
  it("write reaches the child's stdin and returns false once the session has ended", async () => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const received = collect(stdin)
    const { session, end } = openPlaybackSession('inst-1', stdin, stdout)

    expect(session.installationId).toBe('inst-1')
    expect(session.ended).toBe(false)
    expect(session.write('demo_seek 1:30\n')).toBe(true)
    await vi.waitFor(() => expect(received()).toBe('demo_seek 1:30\n'))

    end()

    expect(session.ended).toBe(true)
    expect(session.write('pause\n')).toBe(false)
    expect(stdin.writableEnded).toBe(true)
    await new Promise((resolve) => setImmediate(resolve))
    expect(received()).toBe('demo_seek 1:30\n')
  })

  it('stdout is drained with no subscriber attached, so a chatty engine never fills the pipe', async () => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    openPlaybackSession('inst-1', stdin, stdout)

    // Far past the pipe's buffer: an undrained PassThrough stops completing writes after about
    // two highWaterMarks, which is a real engine blocking on its own console output.
    const chunk = Buffer.alloc(stdout.writableHighWaterMark, 'x')
    const writes = 64
    let completed = 0
    for (let i = 0; i < writes; i++) {
      stdout.write(chunk, () => {
        completed++
      })
    }

    await vi.waitFor(() => expect(completed).toBe(writes))
    expect(stdout.readableLength).toBe(0)
  })

  it("a write after the child's stdin broke is logged, not thrown", async () => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const { session } = openPlaybackSession('inst-1', stdin, stdout)
    const onEnd = vi.fn()
    session.onEnd(onEnd)

    // The game closed its end: the pipe reports EPIPE. Without a listener this 'error' event
    // would be an uncaught exception in main.
    stdin.destroy(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))
    await new Promise((resolve) => setImmediate(resolve))

    let result: boolean | undefined
    expect(() => {
      result = session.write('pause\n')
    }).not.toThrow()
    expect(result).toBe(false)
    expect(logMock.warn).toHaveBeenCalledWith(expect.stringContaining('stdin'), expect.any(Error))
    expect(logMock.warn).toHaveBeenCalledWith(expect.stringContaining('dropped a write'))
    // A broken stdin does not end the session on its own - the process lifecycle does.
    expect(session.ended).toBe(false)
    expect(onEnd).not.toHaveBeenCalled()
  })
})
