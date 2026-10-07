import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fail, ok, type Outcome } from '@shared/types'
import type { X11Connection } from './connection'
import { createX11StageWindow } from './stage-window'

const ROOT = 0x2a0
const XRES_MAJOR = 140
const ATOMS: Record<string, number> = {
  _NET_CLIENT_LIST: 101,
  _NET_WM_STATE: 102,
  _NET_WM_STATE_ABOVE: 103,
  _MOTIF_WM_HINTS: 104,
}
const GAME_PID = 4242

/** Hand-built reply: marker byte 1, extra length in 4-byte units at offset 4. */
function reply(extraUnits: number): Buffer {
  const b = Buffer.alloc(32 + 4 * extraUnits)
  b[0] = 1
  b.writeUInt32LE(extraUnits, 4)
  return b
}

function internReply(atom: number): Buffer {
  const b = reply(0)
  b.writeUInt32LE(atom, 8)
  return b
}

function clientListReply(windows: number[]): Buffer {
  const b = reply(windows.length)
  b[1] = 32
  b.writeUInt32LE(6, 8)
  b.writeUInt32LE(windows.length, 16)
  windows.forEach((w, i) => b.writeUInt32LE(w, 32 + 4 * i))
  return b
}

function clientIdsReply(pid: number): Buffer {
  const b = reply(4)
  b.writeUInt32LE(1, 8)
  b.writeUInt32LE(2, 36) // mask: LocalClientPID
  b.writeUInt32LE(4, 40)
  b.writeUInt32LE(pid, 44)
  return b
}

interface Fake {
  conn: X11Connection
  sent: Buffer[]
  closed: () => boolean
}

interface FakeOptions {
  windows?: Record<number, number | 'BadWindow' | 'BadValue'>
  xres?: boolean
  failAtom?: boolean
}

function fakeConnection(options: FakeOptions = {}): Fake {
  const windows = options.windows ?? { 0x10: 1, 0x20: GAME_PID, 0x30: GAME_PID }
  const sent: Buffer[] = []
  let closed = false
  const conn: X11Connection = {
    root: ROOT,
    resourceIdBase: 0,
    resourceIdMask: 0,
    request(bytes, expectsReply): Promise<Outcome<Buffer>> {
      sent.push(bytes)
      if (!expectsReply) return Promise.resolve(ok(Buffer.alloc(0)))
      const opcode = bytes[0]
      if (opcode === 98) {
        const b = reply(0)
        b[8] = options.xres === false ? 0 : 1
        b[9] = XRES_MAJOR
        return Promise.resolve(ok(b))
      }
      if (opcode === 16) {
        if (options.failAtom) return Promise.resolve(fail('x11.requestFailed', { code: 5 }))
        const name = bytes.toString('latin1', 8, 8 + bytes.readUInt16LE(4))
        return Promise.resolve(ok(internReply(ATOMS[name])))
      }
      if (opcode === 20) {
        return Promise.resolve(ok(clientListReply(Object.keys(windows).map(Number))))
      }
      if (opcode === XRES_MAJOR) {
        const owner = windows[bytes.readUInt32LE(8)]
        if (owner === 'BadWindow') return Promise.resolve(fail('x11.requestFailed', { code: 3 }))
        if (owner === 'BadValue') return Promise.resolve(fail('x11.requestFailed', { code: 2 }))
        return Promise.resolve(ok(clientIdsReply(owner)))
      }
      return Promise.resolve(fail('x11.requestFailed', { code: 1 }))
    },
    close() {
      closed = true
    },
  }
  return { conn, sent, closed: () => closed }
}

/** Requests that change a window (ChangeProperty, ConfigureWindow, SendEvent), with the window they target. */
function mutations(sent: Buffer[]): Array<{ opcode: number; window: number; bytes: Buffer }> {
  return sent
    .filter((b) => [18, 12, 25].includes(b[0]))
    .map((bytes) => ({
      opcode: bytes[0],
      // SendEvent addresses the root; the subject window sits inside the event body.
      window: bytes[0] === 25 ? bytes.readUInt32LE(16) : bytes.readUInt32LE(4),
      bytes,
    }))
}

describe('X11 stage window keeper', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function start(fake: Fake, pid: () => number | undefined = () => GAME_PID) {
    const onFailure = vi.fn()
    const keeper = createX11StageWindow({
      connect: () => Promise.resolve(ok(fake.conn)),
      pid,
      onFailure,
    })
    return { keeper, onFailure }
  }

  const stateMessages = (fake: Fake) => mutations(fake.sent).filter((m) => m.opcode === 25)

  it('changes only the first window owned by the launched game', async () => {
    const fake = fakeConnection()
    start(fake)
    await vi.advanceTimersByTimeAsync(250)
    const changed = mutations(fake.sent)
    expect(changed.length).toBeGreaterThan(0)
    expect(new Set(changed.map((m) => m.window))).toEqual(new Set([0x20]))
  })

  it('never touches a window while the game pid is unknown', async () => {
    const fake = fakeConnection()
    start(fake, () => undefined)
    await vi.advanceTimersByTimeAsync(5000)
    expect(mutations(fake.sent)).toEqual([])
    expect(fake.sent.some((b) => b[0] === XRES_MAJOR)).toBe(false)
  })

  it('changes nothing while no window belongs to the game', async () => {
    const fake = fakeConnection({ windows: { 0x10: 1, 0x11: 2 } })
    const { onFailure } = start(fake)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(mutations(fake.sent)).toEqual([])
    expect(onFailure).not.toHaveBeenCalled()
  })

  it('skips a candidate that disappears with BadWindow and continues', async () => {
    const fake = fakeConnection({ windows: { 0x10: 'BadWindow', 0x20: GAME_PID } })
    const { onFailure } = start(fake)
    await vi.advanceTimersByTimeAsync(250)
    expect(onFailure).not.toHaveBeenCalled()
    expect(new Set(mutations(fake.sent).map((m) => m.window))).toEqual(new Set([0x20]))
  })

  it('skips a candidate that fails with BadValue and continues', async () => {
    const fake = fakeConnection({ windows: { 0x10: 'BadValue', 0x20: GAME_PID } })
    const { onFailure } = start(fake)
    await vi.advanceTimersByTimeAsync(250)
    expect(onFailure).not.toHaveBeenCalled()
    expect(new Set(mutations(fake.sent).map((m) => m.window))).toEqual(new Set([0x20]))
  })

  it('removes decorations, moves to the last placed geometry, then sets topmost', async () => {
    const fake = fakeConnection()
    const { keeper } = start(fake)
    keeper.placed('1280x720+-40+-20')
    await vi.advanceTimersByTimeAsync(250)
    const changed = mutations(fake.sent)
    expect(changed.map((m) => m.opcode)).toEqual([18, 12, 25])
    const [hints, configure, state] = changed.map((m) => m.bytes)
    expect(hints.readUInt32LE(8)).toBe(ATOMS._MOTIF_WM_HINTS)
    expect(hints.readUInt32LE(12)).toBe(ATOMS._MOTIF_WM_HINTS)
    expect(hints.readUInt32LE(20)).toBe(5)
    expect([0, 1, 2, 3, 4].map((i) => hints.readUInt32LE(24 + 4 * i))).toEqual([2, 0, 0, 0, 0])
    expect(configure.readInt32LE(12)).toBe(-40)
    expect(configure.readInt32LE(16)).toBe(-20)
    expect(configure.readUInt32LE(20)).toBe(1280)
    expect(configure.readUInt32LE(24)).toBe(720)
    expect(state.readUInt32LE(4)).toBe(ROOT)
    expect(state.readUInt32LE(8)).toBe(0x180000)
    expect(state.readUInt32LE(20)).toBe(ATOMS._NET_WM_STATE)
    expect(state.readUInt32LE(24)).toBe(1)
    expect(state.readUInt32LE(28)).toBe(ATOMS._NET_WM_STATE_ABOVE)
  })

  it('skips ConfigureWindow for an unparseable geometry', async () => {
    const fake = fakeConnection()
    const { keeper } = start(fake)
    keeper.placed('not-a-geometry')
    await vi.advanceTimersByTimeAsync(250)
    expect(mutations(fake.sent).map((m) => m.opcode)).toEqual([18, 25])
  })

  it('sends remove for a setTop(0) cached before the window is found', async () => {
    const fake = fakeConnection()
    let pid: number | undefined
    const { keeper } = start(fake, () => pid)
    expect(keeper.setTop(0)).toEqual({ ok: true, value: undefined })
    await vi.advanceTimersByTimeAsync(500)
    pid = GAME_PID
    await vi.advanceTimersByTimeAsync(250)
    const states = stateMessages(fake)
    expect(states).toHaveLength(1)
    expect(states[0].bytes.readUInt32LE(24)).toBe(0)
    expect(states[0].bytes.readUInt32LE(28)).toBe(ATOMS._NET_WM_STATE_ABOVE)
  })

  it('adds then removes topmost on later changes and ignores an unchanged value', async () => {
    const fake = fakeConnection()
    const { keeper } = start(fake)
    await vi.advanceTimersByTimeAsync(250)
    expect(stateMessages(fake)).toHaveLength(1)
    keeper.setTop(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(stateMessages(fake)).toHaveLength(1)
    keeper.setTop(0)
    await vi.advanceTimersByTimeAsync(0)
    keeper.setTop(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(stateMessages(fake).map((s) => s.bytes.readUInt32LE(24))).toEqual([1, 0, 1])
  })

  it('reports one failure when connecting fails', async () => {
    const onFailure = vi.fn()
    const keeper = createX11StageWindow({
      connect: () => Promise.resolve(fail('x11.noDisplay')),
      pid: () => GAME_PID,
      onFailure,
    })
    await vi.advanceTimersByTimeAsync(1000)
    keeper.setTop(0)
    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(onFailure).toHaveBeenCalledWith('x11.noDisplay')
  })

  it('reports one failure when X-Resource is missing', async () => {
    const fake = fakeConnection({ xres: false })
    const { onFailure } = start(fake)
    await vi.advanceTimersByTimeAsync(1000)
    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(fake.closed()).toBe(true)
  })

  it('reports one failure when the window is not found by the deadline', async () => {
    const fake = fakeConnection({ windows: { 0x10: 1 } })
    const { onFailure } = start(fake)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(onFailure).toHaveBeenCalledWith('windowNotFound')
  })

  it('reports windowNotFound after the deadline when the pid is never known', async () => {
    const fake = fakeConnection()
    const { onFailure } = start(fake, () => undefined)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(onFailure).toHaveBeenCalledWith('windowNotFound')
    expect(mutations(fake.sent)).toEqual([])
    expect(fake.sent.some((b) => b[0] === XRES_MAJOR)).toBe(false)
  })

  it('reports one failure on an X error and then stays inert', async () => {
    const fake = fakeConnection({ failAtom: true })
    const { keeper, onFailure } = start(fake)
    await vi.advanceTimersByTimeAsync(1000)
    keeper.setTop(0)
    keeper.dispose()
    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(onFailure).toHaveBeenCalledWith('x11.requestFailed')
  })

  it('stops polling, closes the connection and reports nothing on dispose', async () => {
    const fake = fakeConnection({ windows: { 0x10: 1 } })
    const { keeper, onFailure } = start(fake)
    await vi.advanceTimersByTimeAsync(500)
    keeper.dispose()
    const before = fake.sent.length
    await vi.advanceTimersByTimeAsync(30_000)
    expect(fake.sent.length).toBe(before)
    expect(fake.closed()).toBe(true)
    expect(onFailure).not.toHaveBeenCalled()
  })
})
