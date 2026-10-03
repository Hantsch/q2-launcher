import { ok, type Outcome } from '@shared/types'
import { parseGeometry } from '../geometry'
import type { X11Connection } from './connection'
import {
  decodeGetPropertyReply,
  decodeInternAtomReply,
  decodeQueryClientIdsReply,
  decodeQueryExtensionReply,
  encodeChangeProperty,
  encodeConfigureWindow,
  encodeGetProperty,
  encodeInternAtom,
  encodeQueryClientIds,
  encodeQueryExtension,
  encodeSendClientMessage,
  type WireResult,
} from './wire'

export interface X11StageWindowOptions {
  connect: () => Promise<Outcome<X11Connection>>
  /** The launched game's PID; undefined until the process has spawned. */
  pid: () => number | undefined
  /** Called at most once, with a stable cause key; afterwards the keeper does nothing. */
  onFailure: (cause: string) => void
  now?: () => number
  setTimeout?: (fn: () => void, ms: number) => unknown
  clearTimeout?: (handle: unknown) => void
}

export interface X11StageWindow {
  setTop(top: 0 | 1): Outcome<void>
  /** Records the `WxH+X+Y` physical-pixel geometry the game was told to open at. */
  placed(geometry: string): void
  dispose(): void
}

const POLL_MS = 250
const LOOKUP_DEADLINE_MS = 15_000
const BAD_VALUE = 2
const BAD_WINDOW = 3
/** SubstructureRedirect | SubstructureNotify: the mask EWMH requires for root-window requests. */
const ROOT_EVENT_MASK = 0x100000 | 0x80000
/** _MOTIF_WM_HINTS: flags = MWM_HINTS_DECORATIONS, decorations = none. */
const MOTIF_NO_DECORATIONS = [2, 0, 0, 0, 0]

/**
 * Keeps the game window borderless, placed and (un)topmost over X11. The window is identified by
 * the X-Resource PID of its owning client matching the launched game's PID - never by title or
 * recency, so another application's window is never touched (story 198).
 */
export function createX11StageWindow(opts: X11StageWindowOptions): X11StageWindow {
  const now = opts.now ?? Date.now
  const schedule = opts.setTimeout ?? ((fn, ms) => setTimeout(fn, ms))
  const cancel = opts.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))

  let conn: X11Connection | null = null
  let stopped = false
  let timer: unknown = null
  let geometry: string | null = null
  let wantTop: 0 | 1 = 1
  let appliedTop: 0 | 1 | null = null
  let game: { id: number; atoms: Atoms } | null = null
  let ready = false

  interface Atoms {
    clientList: number
    wmState: number
    above: number
    motifHints: number
  }

  const stop = (): void => {
    stopped = true
    if (timer !== null) cancel(timer)
    timer = null
    conn?.close()
  }
  const failWith = (cause: string): void => {
    if (stopped) return
    stop()
    opts.onFailure(cause)
  }

  /** A request whose failure ends the keeper; the outcome is null once it has. */
  async function send(bytes: Buffer, expectsReply: boolean): Promise<Buffer | null> {
    if (stopped || !conn) return null
    const result = await conn.request(bytes, expectsReply)
    if (stopped) return null
    if (!result.ok) {
      failWith(result.error.key)
      return null
    }
    return result.value
  }
  const decoded = <T>(wire: WireResult<T>): T | null => {
    if (wire.ok) return wire.value
    failWith('x11.protocolError')
    return null
  }

  async function applyTop(): Promise<void> {
    if (!ready || !game || !conn || appliedTop === wantTop) return
    appliedTop = wantTop
    await send(
      encodeSendClientMessage({
        destination: conn.root,
        eventMask: ROOT_EVENT_MASK,
        window: game.id,
        messageType: game.atoms.wmState,
        data: [wantTop === 1 ? 1 : 0, game.atoms.above, 0, 1, 0],
      }),
      false,
    )
    // setTop may have changed again while the message was in flight.
    if (appliedTop !== wantTop) await applyTop()
  }

  async function adopt(id: number, atoms: Atoms): Promise<void> {
    game = { id, atoms }
    await send(
      encodeChangeProperty({
        window: id,
        property: atoms.motifHints,
        type: atoms.motifHints,
        values: MOTIF_NO_DECORATIONS,
      }),
      false,
    )
    const box = geometry ? parseGeometry(geometry) : null
    if (box) await send(encodeConfigureWindow({ window: id, ...box }), false)
    ready = true
    await applyTop()
  }

  /** The first top-level window whose owning client is the game, or null if none (yet). */
  async function findGame(xres: number, atoms: Atoms, pid: number): Promise<number | null> {
    if (!conn) return null
    const list = await send(
      encodeGetProperty({
        window: conn.root,
        property: atoms.clientList,
        type: 0,
        longLength: 4096,
      }),
      true,
    )
    if (!list) return null
    const windows = decoded(decodeGetPropertyReply(list))
    if (!windows) return null
    for (const id of windows.values) {
      if (stopped || !conn) return null
      const result: Outcome<Buffer> = await conn.request(encodeQueryClientIds(xres, id), true)
      if (stopped) return null
      if (!result.ok) {
        // The window vanished between the list and the query; skip it.
        const code = result.error.params?.code
        if (code === BAD_WINDOW || code === BAD_VALUE) continue
        failWith(result.error.key)
        return null
      }
      const owner = decoded(decodeQueryClientIdsReply(result.value))
      if (stopped) return null
      if (owner === pid) return id
    }
    return null
  }

  async function intern(name: string): Promise<number | null> {
    const reply = await send(encodeInternAtom(name), true)
    return reply ? decoded(decodeInternAtomReply(reply)) : null
  }

  async function start(): Promise<void> {
    const connected = await opts.connect()
    if (stopped) {
      if (connected.ok) connected.value.close()
      return
    }
    if (!connected.ok) return failWith(connected.error.key)
    conn = connected.value

    const ext = await send(encodeQueryExtension('X-Resource'), true)
    if (!ext) return
    const xres = decoded(decodeQueryExtensionReply(ext))
    if (!xres) return
    if (!xres.present) return failWith('x11.noXResource')

    const clientList = await intern('_NET_CLIENT_LIST')
    const wmState = await intern('_NET_WM_STATE')
    const above = await intern('_NET_WM_STATE_ABOVE')
    const motifHints = await intern('_MOTIF_WM_HINTS')
    if (clientList === null || wmState === null || above === null || motifHints === null) return
    const atoms: Atoms = { clientList, wmState, above, motifHints }

    const deadline = now() + LOOKUP_DEADLINE_MS
    const poll = async (): Promise<void> => {
      timer = null
      if (stopped) return
      const pid = opts.pid()
      if (pid !== undefined) {
        const id = await findGame(xres.majorOpcode, atoms, pid)
        if (stopped) return
        if (id !== null) return adopt(id, atoms)
      }
      if (now() >= deadline) return failWith('windowNotFound')
      timer = schedule(() => void poll(), POLL_MS)
    }
    await poll()
  }

  void start().catch(() => failWith('x11.connectionLost'))

  return {
    setTop(top) {
      wantTop = top
      void applyTop()
      return ok(undefined)
    },
    placed(next) {
      geometry = next
    },
    dispose: stop,
  }
}
