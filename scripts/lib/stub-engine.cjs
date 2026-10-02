// Story 165 D4: the UI fixture's stand-in Q2PRO. `scripts/lib/fixture.mjs` installs it in place of
// the real client (`writeStubEngine()`), so a demo "plays" in a real child process that speaks story
// 164's playback transport the way the real engine does - the launcher's channel
// (`src/main/modules/replays/playback-channel/`) talks to it unmodified:
//
//   Windows: argv carries `+set logfile 2 +set logfile_name q2l_demo.log ... +exec q2l_loop.cfg`; the
//     stub runs a tiny Cbuf (alias / exec / wait / if / set / echo, `$cvar` macros) so the loop cfg
//     re-executes `q2l_ctl.cfg` every few frames, the `if $q2l_seq != N` guard runs each command once,
//     and every console line is appended to `<gamedir>/logs/<logfile_name>` stamped with
//     `logfile_prefix` (Q2PRO's default `[%Y-%m-%d %H:%M] `).
//   Linux: `+set sys_console 1` - console lines are read from stdin and printed to stdout.
//
// The demo is a simulated clock: `pause` toggles it, `seek [+-]N | m:ss | N%` moves it (clamped to
// the demo length), the `timescale` cvar scales it, and reaching the end prints `Demo finished`.
// Every steering command it executes (anything that is not console plumbing) is appended to the file
// named by `Q2L_UI_ENGINE_COMMAND_LOG`, so a flow can assert on what the engine actually ran.
// Story 171 D2: a `set vid_geometry …` / `set win_alwaysontop …` the launcher sends once the demo has
// started (its stage follower - never the launch argv) is appended to `Q2L_UI_ENGINE_WINDOW_LOG`
// instead; `set` never reaches the command log, so that log is unchanged. A set to the cvar's current
// value is not recorded (Q2PRO ignores it), so the follower's set-wait-re-set line logs once.
//
// Story 172 D7: `vid_fullscreen` is a cvar (`$vid_fullscreen` echoes it, `q2l_session` / `q2l_armpos`
// are plain cvars) and a bare `vid_fullscreen N` is appended to the command log. The file named by
// `Q2L_UI_ENGINE_KEYS_FILE` is a key-press lever: when it appears each line is appended to the console
// buffer (like a bind press - behind whatever is queued), then the file is deleted.
//
// Story 184 D4: two latency levers, both off when unset. `Q2L_UI_ENGINE_COMMAND_DELAY_MS=N` runs every
// launcher command (Windows: the guarded control-file sequence incl. its `ACK` echo; Linux: the stdin
// line) N ms after the stub first saw it - command-log line, state change and ACK all move together,
// in order. `Q2L_UI_ENGINE_OUTPUT_BURST_MS=N` holds all output (logfile and stdout) and writes it in one
// burst every N ms, modelling Q2PRO's buffered logfile. A launch cannot change its env per demo, so
// `Q2L_UI_ENGINE_LEVERS_FILE` may name a JSON `{commandDelayMs, outputBurstMs}` read at stub start
// (it wins over the env vars): a flow rewrites it between demos.
//
// Story 185 D3: `Q2L_UI_ENGINE_LOG_FLUSH_MS=N` buffers only the logfile appends and writes them in one
// burst every N ms (Q2PRO's buffered logfile; stdout is untouched), and stamps each command-log line
// with ` @<epoch ms>` so a flow can time when a command actually ran. Unset: nothing changes.
//
// Lifetime: `stub-engine.json` next to this file (written by the fixture) gives `demoMs` and
// `lifetimeMs`; the stub also exits when the file named by `Q2L_UI_ENGINE_QUIT_FILE` appears (a
// flow's "the game exits" lever), on `quit`, or when its parent (the launcher) is gone - so no run
// leaves an orphan behind.
//
// On Windows the fixture copies node.exe as `q2pro.exe` and this file as `<root>/+set.js`: node
// resolves the engine's first argument `+set` against the cwd (the install root), so the real launch
// argv reaches a real node process untouched. Off Windows `q2pro` is a shell wrapper around it.
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const FRAME_MS = 16
const MAX_LINES_PER_FRAME = 1000
const PARENT_CHECK_MS = 250

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'stub-engine.json'), 'utf8'))
  } catch {
    return {}
  }
}

const config = readConfig()
const DEMO_MS = Number(config.demoMs) > 0 ? Number(config.demoMs) : 41000
const LIFETIME_MS = Number(config.lifetimeMs) > 0 ? Number(config.lifetimeMs) : 400
const COMMAND_LOG = process.env.Q2L_UI_ENGINE_COMMAND_LOG || ''
const QUIT_FILE = process.env.Q2L_UI_ENGINE_QUIT_FILE || ''
const IGNORE_QUIT_FILE = process.env.Q2L_UI_ENGINE_IGNORE_QUIT_FILE || ''
const KEYS_FILE = process.env.Q2L_UI_ENGINE_KEYS_FILE || ''
const WINDOW_LOG = process.env.Q2L_UI_ENGINE_WINDOW_LOG || ''
function readLevers() {
  let file = {}
  const leversFile = process.env.Q2L_UI_ENGINE_LEVERS_FILE || ''
  if (leversFile) {
    try {
      file = JSON.parse(fs.readFileSync(leversFile, 'utf8'))
    } catch {
      file = {}
    }
  }
  const num = (v) => (Number(v) > 0 ? Number(v) : 0)
  return {
    commandDelayMs: num(file.commandDelayMs ?? process.env.Q2L_UI_ENGINE_COMMAND_DELAY_MS),
    outputBurstMs: num(file.outputBurstMs ?? process.env.Q2L_UI_ENGINE_OUTPUT_BURST_MS),
  }
}
const { commandDelayMs: COMMAND_DELAY_MS, outputBurstMs: OUTPUT_BURST_MS } = readLevers()
const LOG_FLUSH_MS =
  Number(process.env.Q2L_UI_ENGINE_LOG_FLUSH_MS) > 0
    ? Number(process.env.Q2L_UI_ENGINE_LOG_FLUSH_MS)
    : 0
/** Logfile appends held back by LOG_FLUSH_MS until the next flush. */
const heldLog = []
/** Commands held back by COMMAND_DELAY_MS: `{ dueAt, text, front }`, in arrival order. */
const delayed = []
/** Output held back by OUTPUT_BURST_MS until the next burst. */
const held = []
const WINDOW_CVARS = new Set(['vid_geometry', 'win_alwaysontop'])
/** Set once `demo` ran: the argv stage args come before it, the follower's lines after. */
let demoStarted = false
const startedAt = Date.now()

const cvars = new Map([
  ['logfile', '0'],
  ['logfile_flush', '0'],
  ['logfile_name', 'qconsole.log'],
  ['logfile_prefix', '[%Y-%m-%d %H:%M] '],
  ['sys_console', '0'],
  ['game', ''],
  ['timescale', '1'],
  ['vid_fullscreen', '0'],
])
const aliases = new Map()
const demo = { playing: false, paused: false, posMs: 0 }
let cbuf = ''
let waitFrames = 0

/** The engine's own argv: on Windows node consumed the leading `+set` as the script name. */
function engineArgs() {
  const script = path.basename(process.argv[1] || '')
  const rest = process.argv.slice(2)
  return script.startsWith('+') ? [script.replace(/\.js$/, ''), ...rest] : rest
}

const cvar = (name) => cvars.get(name) ?? ''

function gameDir() {
  return path.join(process.cwd(), cvar('game') || 'baseq2')
}

function searchDirs() {
  const base = path.join(process.cwd(), 'baseq2')
  const own = gameDir()
  return own === base ? [own] : [own, base]
}

const pad2 = (n) => String(n).padStart(2, '0')

function stamp(prefix, now) {
  const codes = {
    Y: String(now.getFullYear()),
    m: pad2(now.getMonth() + 1),
    d: pad2(now.getDate()),
    H: pad2(now.getHours()),
    M: pad2(now.getMinutes()),
    S: pad2(now.getSeconds()),
    '%': '%',
  }
  return prefix.replace(/%([YmdHMS%])/g, (_, c) => codes[c])
}

/** `$cl_demopos`: `m:ss.f` (or `h:mm:ss.f` past an hour) while a demo plays, empty otherwise. */
function demoPos() {
  if (!demo.playing) return ''
  const tenths = Math.floor(demo.posMs / 100)
  const f = tenths % 10
  const total = Math.floor(tenths / 10)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}.${f}` : `${m}:${pad2(s)}.${f}`
}

process.stdout.on('error', () => undefined)

function emit(entry) {
  if (entry.stdout !== null) process.stdout.write(entry.stdout)
  if (entry.file !== null) {
    if (LOG_FLUSH_MS > 0) {
      heldLog.push({ file: entry.file, line: entry.line })
      return
    }
    appendLog(entry.file, entry.line)
  }
}

function appendLog(file, line) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, line)
  } catch {
    // the launcher may be deleting the log at the same moment - the next line tries again
  }
}

function print(text) {
  const entry = { stdout: null, file: null, line: '' }
  if (cvar('sys_console') === '1') entry.stdout = `${text}\n`
  if (Number(cvar('logfile')) > 0) {
    entry.file = path.join(gameDir(), 'logs', cvar('logfile_name'))
    entry.line = `${stamp(cvar('logfile_prefix'), new Date())}${text}\n`
  }
  if (OUTPUT_BURST_MS > 0) held.push(entry)
  else emit(entry)
}

function flushLog() {
  while (heldLog.length > 0) {
    const { file, line } = heldLog.shift()
    appendLog(file, line)
  }
}

function flushHeld() {
  while (held.length > 0) emit(held.shift())
}

/** A launcher command: runs now, or after COMMAND_DELAY_MS (in arrival order). `front`: Cbuf_Insert. */
function launcherCommand(text, front) {
  if (COMMAND_DELAY_MS <= 0) {
    if (front) insertText(text)
    else addText(text)
    return
  }
  delayed.push({ dueAt: Date.now() + COMMAND_DELAY_MS, text, front })
}

function releaseDelayed() {
  while (delayed.length > 0 && delayed[0].dueAt <= Date.now()) {
    const { text, front } = delayed.shift()
    if (front) insertText(text)
    else addText(text)
  }
}

function logWindow(tokens) {
  if (!WINDOW_LOG || !demoStarted) return
  try {
    fs.appendFileSync(WINDOW_LOG, `${tokens.join(' ')}\n`)
  } catch {
    // a missing log dir only loses the record, never the command
  }
}

function logCommand(tokens) {
  if (!COMMAND_LOG) return
  try {
    const suffix = LOG_FLUSH_MS > 0 ? ` @${Date.now()}` : ''
    fs.appendFileSync(COMMAND_LOG, `${tokens.join(' ')}${suffix}\n`)
  } catch {
    // a missing log dir only loses the record, never the command
  }
}

/** Q2's macro expansion: `$name` / `${name}` outside quotes becomes the cvar's value. */
function expandMacros(line) {
  let out = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') quoted = !quoted
    if (c !== '$' || quoted) {
      out += c
      continue
    }
    const m = /^\$(\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))/.exec(line.slice(i))
    if (!m) {
      out += c
      continue
    }
    const name = m[2] ?? m[3]
    // `$cl_paused` mirrors Q2PRO: 2 while a demo is paused, 0 otherwise.
    out +=
      name === 'cl_demopos'
        ? demoPos()
        : name === 'cl_paused'
          ? demo.playing && demo.paused
            ? '2'
            : '0'
          : cvar(name)
    i += m[0].length - 1
  }
  return out
}

function tokenize(line) {
  const tokens = []
  const re = /"([^"]*)"?|(\S+)/g
  let m
  while ((m = re.exec(line)) !== null) tokens.push(m[1] ?? m[2])
  return tokens
}

/** Cbuf_InsertText: runs before whatever is already buffered. */
function insertText(text) {
  cbuf = `${text}\n${cbuf}`
}

function addText(text) {
  cbuf += `${text}\n`
}

function nextLine() {
  let quoted = false
  for (let i = 0; i < cbuf.length; i++) {
    const c = cbuf[i]
    if (c === '"') quoted = !quoted
    if (c === '\n' || (c === ';' && !quoted)) {
      const line = cbuf.slice(0, i)
      cbuf = cbuf.slice(i + 1)
      return line
    }
  }
  const line = cbuf
  cbuf = ''
  return line
}

function execFile(name) {
  for (const dir of searchDirs()) {
    let text
    try {
      text = fs.readFileSync(path.join(dir, name), 'utf8')
    } catch {
      continue // missing, or mid-rename by the launcher: the loop re-execs it a few frames later
    }
    insertText(text)
    return
  }
  print(`Couldn't exec ${name}`)
}

function startDemo(file) {
  if (!file) return
  const candidates = path.isAbsolute(file)
    ? [file]
    : searchDirs().map((dir) => path.join(dir, 'demos', file))
  if (!candidates.some((p) => fs.existsSync(p))) {
    print(`Couldn't open demos/${file}`)
    return
  }
  demo.playing = true
  demo.paused = false
  demo.posMs = 0
}

function seek(arg) {
  if (!demo.playing || arg === undefined) return
  const m = /^([+-]?)(?:(\d+):)?(\d+(?:\.\d+)?)(%?)$/.exec(arg)
  if (!m) {
    print(`Invalid seek position: ${arg}`)
    return
  }
  const ms = m[4] ? (DEMO_MS * Number(m[3])) / 100 : (Number(m[2] ?? 0) * 60 + Number(m[3])) * 1000
  const target = m[1] === '+' ? demo.posMs + ms : m[1] === '-' ? demo.posMs - ms : ms
  demo.posMs = Math.min(DEMO_MS, Math.max(0, target))
}

function compare(a, op, b) {
  const numeric = a !== '' && b !== '' && !Number.isNaN(Number(a)) && !Number.isNaN(Number(b))
  const x = numeric ? Number(a) : a
  const y = numeric ? Number(b) : b
  switch (op) {
    case '==':
    case 'eq':
      return x === y
    case '!=':
    case 'ne':
      return x !== y
    case '<':
      return x < y
    case '>':
      return x > y
    case '<=':
      return x <= y
    case '>=':
      return x >= y
    default:
      return false
  }
}

/** `if <a> <op> <b> then <cmd> [else <cmd>]` - the branch is inserted as console text. */
function runIf(args) {
  if (args.length < 5 || args[3] !== 'then') return
  const rest = args.slice(4)
  const elseAt = rest.indexOf('else')
  const thenPart = elseAt === -1 ? rest : rest.slice(0, elseAt)
  const elsePart = elseAt === -1 ? [] : rest.slice(elseAt + 1)
  const branch = compare(args[0], args[1], args[2]) ? thenPart : elsePart
  if (branch.length === 0) return
  const text = branch.join(' ')
  // The launcher's guarded command (`exec q2l_cmd_N.cfg; ...; echo ACK N`) is seen on every loop tick
  // until it ran: only its first sighting is held back, the guard stays true meanwhile.
  if (COMMAND_DELAY_MS > 0 && text.includes('q2l_cmd_')) {
    if (!pendingGuards.has(text)) {
      pendingGuards.add(text)
      launcherCommand(text, true)
    }
    return
  }
  insertText(text)
}
const pendingGuards = new Set()

function quit() {
  process.exit(0)
}

function execLine(raw) {
  const line = raw.trim()
  if (line === '' || line.startsWith('//')) return
  const tokens = tokenize(expandMacros(line))
  if (tokens.length === 0) return
  const [cmd, ...args] = tokens
  switch (cmd.toLowerCase()) {
    case 'set':
    case 'seta':
      if (args.length >= 2) {
        // Like Q2PRO, a set to the value the cvar already has changes nothing, so it is not recorded.
        if (WINDOW_CVARS.has(args[0]) && cvars.get(args[0]) !== args[1]) logWindow(tokens)
        cvars.set(args[0], args[1])
      }
      return
    case 'alias':
      if (args.length >= 1) aliases.set(args[0], args.slice(1).join(' '))
      return
    case 'exec':
      if (args[0]) execFile(args[0])
      return
    case 'wait':
      waitFrames = Math.max(1, Number(args[0]) || 1)
      return
    case 'echo':
      print(args.join(' '))
      return
    case 'if':
      runIf(args)
      return
    case 'demo':
      demoStarted = true
      startDemo(args[0])
      return
    case 'pause':
      logCommand(tokens)
      if (demo.playing) demo.paused = !demo.paused
      return
    case 'seek':
      logCommand(tokens)
      seek(args[0])
      return
    case 'quit':
      logCommand(tokens)
      // Story 173: a game that ignores `quit` while this file exists (the launcher must terminate it).
      if (IGNORE_QUIT_FILE && fs.existsSync(IGNORE_QUIT_FILE)) return
      quit()
      return
  }
  if (aliases.has(cmd)) {
    insertText(aliases.get(cmd))
    return
  }
  if (cvars.has(cmd)) {
    if (args.length === 0) {
      print(`"${cmd}" is "${cvar(cmd)}"`)
      return
    }
    if (cmd === 'timescale' || cmd === 'vid_fullscreen') logCommand(tokens)
    cvars.set(cmd, args[0])
    return
  }
  logCommand(tokens)
  print(`Unknown command "${cmd}"`)
}

/** Cbuf_Execute: run buffered lines until a `wait` parks the rest for later frames. */
function runCbuf() {
  if (waitFrames > 0) {
    waitFrames -= 1
    return
  }
  for (let n = 0; n < MAX_LINES_PER_FRAME && cbuf.length > 0; n++) {
    execLine(nextLine())
    if (waitFrames > 0) return
  }
}

/** Command-line `+cmd args` groups become console lines, in order. */
function queueCommandLine(argv) {
  let current = null
  for (const arg of argv) {
    if (arg.startsWith('+')) {
      if (current) addText(current.join(' '))
      current = [arg.slice(1)]
    } else if (current) {
      current.push(/\s/.test(arg) ? `"${arg}"` : arg)
    }
  }
  if (current) addText(current.join(' '))
}

/** The keys file's lines join the console buffer like bind presses, then the file is consumed. */
function pressKeys() {
  if (!KEYS_FILE || !fs.existsSync(KEYS_FILE)) return
  let text
  try {
    text = fs.readFileSync(KEYS_FILE, 'utf8')
    fs.unlinkSync(KEYS_FILE)
  } catch {
    return // mid-write: the next frame reads it
  }
  for (const line of text.split('\n')) if (line.trim() !== '') addText(line.trim())
}

let last = Date.now()
function frame() {
  const now = Date.now()
  const dt = now - last
  last = now
  if (demo.playing && !demo.paused) {
    demo.posMs += dt * (Number(cvar('timescale')) || 1)
    if (demo.posMs >= DEMO_MS) {
      demo.posMs = DEMO_MS
      demo.playing = false
      print('Demo finished')
    }
  }
  pressKeys()
  releaseDelayed()
  runCbuf()
  if (QUIT_FILE && fs.existsSync(QUIT_FILE)) quit()
  if (now - startedAt >= LIFETIME_MS) quit()
}

queueCommandLine(engineArgs())

// With `sys_console 1` the console reads commands from stdin (the launcher's Linux channel).
let pendingInput = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  pendingInput += chunk
  const lines = pendingInput.split(/\r?\n/)
  pendingInput = lines.pop() ?? ''
  if (cvar('sys_console') !== '1') return
  for (const line of lines) launcherCommand(line, false)
})
process.stdin.on('error', () => undefined)

setInterval(frame, FRAME_MS)
if (OUTPUT_BURST_MS > 0) setInterval(flushHeld, OUTPUT_BURST_MS)
if (LOG_FLUSH_MS > 0) setInterval(flushLog, LOG_FLUSH_MS)
setInterval(() => {
  try {
    process.kill(process.ppid, 0)
  } catch (err) {
    // EPERM means the parent exists but is not ours to signal - only a vanished parent ends the run.
    if (err && err.code !== 'EPERM') quit()
  }
}, PARENT_CHECK_MS)
