import type { ReplaysIntegratedPrepareResult } from '@shared/modules/replays'
import type { LocalizedMessage, Outcome } from '@shared/types'
import { integratedPrepare, integratedRelease } from '../client'
import { engineLoader } from './engine-loader'
import { runConsole, type RawEngineModule } from './engine-module'

const BASE_DIR = '/q2'
const HOME_DIR = '/q2home'
const LAUNCHER_DIR = '_launcher'
const LOAD_FAILED = 'replays.integrated.error.loadFailed'

/**
 * Sent on every start and again before every later demo, so a console change between plays never
 * sticks. Never through `exec` or a cfg file: both print plumbing into the console capture. (story 291)
 */
export const SESSION_CVARS: readonly (readonly [name: string, value: string])[] = [
  ['scr_showpause', '0'],
  ['cl_autopause', '0'],
  ['con_notifylines', '0'],
  ['scr_demobar', '0'],
  ['cl_demowait', '1'],
  ['s_enable', '0'],
]

export type IntegratedRefusal = LocalizedMessage & { canPlayInEngineMode: true }

export interface IntegratedHooks {
  onLoading(): void
  onPlaying(): void
  onFinished(): void
  onRefused(reason: IntegratedRefusal): void
}

interface Session {
  stopped: boolean
  preparing: Promise<Outcome<ReplaysIntegratedPrepareResult>> | null
  token: string | null
  /** Set once the demo command ran: only then is there something to disconnect. */
  module: RawEngineModule | null
  frame: number | null
}

interface InstanceState {
  started: boolean
  gameDir: string | null
  demoPath: string | null
}

// Keyed by the Emscripten module: a discarded instance takes its MEMFS and started state with it.
const instances = new WeakMap<RawEngineModule, InstanceState>()

let current: Session | null = null

function stateOf(module: RawEngineModule): InstanceState {
  let state = instances.get(module)
  if (!state) {
    state = { started: false, gameDir: null, demoPath: null }
    instances.set(module, state)
  }
  return state
}

async function releaseQuietly(token: string): Promise<void> {
  try {
    await integratedRelease(token)
  } catch {
    // Nothing left to do: main drops the token with the next prepare anyway.
  }
}

/**
 * Never throws and always releases: after a lost GL context the instance may still look active,
 * and a token kept past Stop would block nothing but leak the pinned files. (story 291)
 */
export async function stopIntegrated(): Promise<void> {
  const session = current
  current = null
  if (!session) return
  session.stopped = true
  if (session.frame !== null) cancelAnimationFrame(session.frame)
  session.frame = null
  if (session.module) {
    try {
      runConsole(session.module, 'disconnect')
    } catch {
      // A dead instance has nothing to disconnect; the token must still go.
    }
  }
  let token = session.token
  session.token = null
  // A prepare still in flight would hand out a token after this release; wait for it so the next
  // prepare never overlaps it (main keeps a single active token).
  if (token === null && session.preparing) {
    const outcome = await session.preparing.catch(() => null)
    token = outcome?.ok ? outcome.value.token : null
  }
  if (token) await releaseQuietly(token)
}

async function fetchFile(token: string, index: number): Promise<Uint8Array> {
  const response = await fetch(`/engine-data/${token}/${index}`)
  if (!response.ok) throw new Error(`engine data ${index}: HTTP ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

function writeFile(module: RawEngineModule, path: string, bytes: Uint8Array): void {
  module.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')))
  module.FS.writeFile(path, bytes)
}

/** Returns false when the session was stopped mid-way: no fetch may follow a release. */
async function writeManifest(
  module: RawEngineModule,
  prepared: ReplaysIntegratedPrepareResult,
  session: Session,
): Promise<boolean> {
  const fs = module.FS
  for (const file of prepared.files) {
    const path = `${BASE_DIR}/${file.vpath}`
    if (fs.analyzePath(path).exists && fs.stat(path).size === file.size) continue
    const bytes = await fetchFile(prepared.token, file.index)
    if (session.stopped) return false
    writeFile(module, path, bytes)
  }
  const bytes = await fetchFile(prepared.token, prepared.demo.index)
  if (session.stopped) return false
  const state = stateOf(module)
  if (state.demoPath !== null && fs.analyzePath(state.demoPath).exists) fs.unlink(state.demoPath)
  const demoPath = `${BASE_DIR}/${prepared.demo.vpath}`
  writeFile(module, demoPath, bytes)
  state.demoPath = demoPath
  return true
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

/** The demo command blocks while the engine loads the map; it is the measurable start. */
function startDemo(module: RawEngineModule, prepared: ReplaysIntegratedPrepareResult): void {
  const state = stateOf(module)
  const demo = `${LAUNCHER_DIR}/${prepared.demo.vpath.slice(prepared.demo.vpath.lastIndexOf('/') + 1)}`
  if (!state.started) {
    // callMain may run once per Emscripten instance: a start that threw is never retried as one.
    state.started = true
    state.gameDir = prepared.gameDir
    module.FS.mkdirTree(HOME_DIR)
    module.callMain([
      '+set',
      'basedir',
      BASE_DIR,
      '+set',
      'homedir',
      HOME_DIR,
      '+set',
      'game',
      prepared.gameDir,
      ...SESSION_CVARS.flatMap(([name, value]) => ['+set', name, value]),
      '+demo',
      demo,
    ])
    return
  }
  runConsole(module, 'disconnect')
  if (state.gameDir !== prepared.gameDir) {
    runConsole(module, `game ${prepared.gameDir}`)
    state.gameDir = prepared.gameDir
  }
  runConsole(module, SESSION_CVARS.map(([name, value]) => `set ${name} ${value}`).join('\n'))
  runConsole(module, `demo ${demo}`)
}

function pollEnd(session: Session, module: RawEngineModule, hooks: IntegratedHooks): void {
  const tick = (): void => {
    session.frame = null
    if (session.stopped) return
    if (module._q2l_demo_eof() === 1) {
      // The engine keeps drawing the last frame: the picture stays until Stop.
      hooks.onFinished()
      return
    }
    session.frame = requestAnimationFrame(tick)
  }
  session.frame = requestAnimationFrame(tick)
}

async function fail(session: Session, hooks: IntegratedHooks): Promise<void> {
  if (current === session) current = null
  session.stopped = true
  const token = session.token
  session.token = null
  if (token) await releaseQuietly(token)
  hooks.onRefused({ key: LOAD_FAILED, canPlayInEngineMode: true })
}

/** Plays a demo in the in-app engine; a running session is stopped (and its token released) first. */
export async function playIntegrated(
  args: { demoId: string; installationId: string },
  hooks: IntegratedHooks,
): Promise<void> {
  await stopIntegrated()
  const session: Session = {
    stopped: false,
    preparing: null,
    token: null,
    module: null,
    frame: null,
  }
  current = session
  session.preparing = integratedPrepare(args)
  let prepared: Outcome<ReplaysIntegratedPrepareResult>
  try {
    prepared = await session.preparing
  } catch {
    if (!session.stopped) await fail(session, hooks)
    return
  }
  // A Stop during prepare owns the release of this token.
  if (session.stopped) return
  if (!prepared.ok) {
    current = null
    hooks.onRefused({ ...prepared.error, canPlayInEngineMode: true })
    return
  }
  session.token = prepared.value.token
  hooks.onLoading()

  let module: RawEngineModule
  try {
    module = (await engineLoader.load()).module
    if (session.stopped) return
    if (!(await writeManifest(module, prepared.value, session))) return
    // One frame lets the loading state paint before the demo command blocks the thread.
    await nextFrame()
    if (session.stopped) return
    startDemo(module, prepared.value)
  } catch {
    if (!session.stopped) await fail(session, hooks)
    return
  }
  session.module = module
  hooks.onPlaying()
  pollEnd(session, module, hooks)
}
