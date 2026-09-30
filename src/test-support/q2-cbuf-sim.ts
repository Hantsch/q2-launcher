/**
 * A small model of Q2PRO's command buffer, for tests that need to know what a bound console body
 * really does (story 172 D1). Modelled on `scripts/lib/stub-engine.cjs` (the launcher's stub
 * engine), minus the process and file-system plumbing.
 *
 * What it reproduces, because the demo guard depends on each of it:
 * - **insert vs append**: an alias body, an `exec`'d file and an `if` branch are *inserted* before
 *   whatever is still buffered; a key press is *appended* behind it (`press`).
 * - `;` and newline split commands outside quotes; `$name` expands per command, when it runs,
 *   outside quotes and mid-token (`x$cl_demopos`). An unset name expands to nothing.
 * - `set`/`seta`, `alias`, `exec` (from an in-memory file map; a missing file prints
 *   `Couldn't exec <name>`), `wait` (parks the rest of the buffer until `frame()`), `echo`, and
 *   `if <a> <op> <b> then <cmd> [else <cmd>]` with `== != eq ne` (`eq`/`ne` always compare as
 *   strings, `==`/`!=` numerically when both sides are numbers).
 * - `cl_demopos` is a settable macro (`setDemoPos`), standing in for the engine's live position.
 *
 * `log` holds every executed command that is not plumbing, e.g. `seek +10`; anything that is
 * neither plumbing, an alias nor a cvar is also reported as `Unknown command "x"` in `output`.
 */

export interface CbufSim {
  /** Cvars by name (`q2l_armpos`, `timescale`, ...). Read and write freely from a test. */
  cvars: Map<string, string>
  aliases: Map<string, string>
  /** In-memory files `exec` reads. */
  files: Map<string, string>
  /** Executed non-plumbing commands, tokens joined by a space, in execution order. */
  log: string[]
  /** Printed engine text (`echo`, `Couldn't exec ...`, `Unknown command ...`). */
  output: string[]
  setDemoPos: (pos: string) => void
  /** Append console text behind everything buffered - what a key press does. */
  press: (text: string) => void
  /** Insert console text before everything buffered (`Cbuf_InsertText`). */
  insert: (text: string) => void
  /** Run the buffer until it is empty or a `wait` parks the rest. */
  run: () => void
  /** One frame passes: a parked buffer resumes. */
  frame: () => void
}

export function createCbufSim(
  init: { cvars?: Record<string, string>; files?: Record<string, string>; demoPos?: string } = {},
): CbufSim {
  const cvars = new Map(Object.entries(init.cvars ?? {}))
  const files = new Map(Object.entries(init.files ?? {}))
  const aliases = new Map<string, string>()
  const log: string[] = []
  const output: string[] = []
  let demoPos = init.demoPos ?? ''
  let cbuf = ''
  let waiting = false

  const macro = (name: string): string => (name === 'cl_demopos' ? demoPos : (cvars.get(name) ?? ''))

  function expandMacros(line: string): string {
    let out = ''
    let quoted = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]!
      if (c === '"') quoted = !quoted
      if (c !== '$' || quoted) {
        out += c
        continue
      }
      const m = /^\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))/.exec(line.slice(i))
      if (!m) {
        out += c
        continue
      }
      out += macro((m[1] ?? m[2])!)
      i += m[0].length - 1
    }
    return out
  }

  function tokenize(line: string): string[] {
    const tokens: string[] = []
    const re = /"([^"]*)"?|(\S+)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(line)) !== null) tokens.push((m[1] ?? m[2])!)
    return tokens
  }

  function nextLine(): string {
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

  const insert = (text: string): void => {
    cbuf = `${text}\n${cbuf}`
  }

  function compare(a: string, op: string, b: string): boolean {
    if (op === 'eq') return a === b
    if (op === 'ne') return a !== b
    const numeric = a !== '' && b !== '' && !Number.isNaN(Number(a)) && !Number.isNaN(Number(b))
    const x = numeric ? Number(a) : a
    const y = numeric ? Number(b) : b
    switch (op) {
      case '==':
        return x === y
      case '!=':
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

  function execLine(raw: string): void {
    const line = raw.trim()
    if (line === '' || line.startsWith('//')) return
    const tokens = tokenize(expandMacros(line))
    if (tokens.length === 0) return
    const [cmd, ...args] = tokens as [string, ...string[]]
    switch (cmd.toLowerCase()) {
      case 'set':
      case 'seta':
        if (args.length >= 2) cvars.set(args[0]!, args[1]!)
        return
      case 'alias':
        if (args.length >= 1) aliases.set(args[0]!, args.slice(1).join(' '))
        return
      case 'exec': {
        const name = args[0]
        if (!name) return
        const text = files.get(name)
        if (text === undefined) output.push(`Couldn't exec ${name}`)
        else insert(text)
        return
      }
      case 'wait':
        waiting = true
        return
      case 'echo':
        output.push(args.join(' '))
        return
      case 'if': {
        if (args.length < 5 || args[3] !== 'then') return
        const rest = args.slice(4)
        const elseAt = rest.indexOf('else')
        const thenPart = elseAt === -1 ? rest : rest.slice(0, elseAt)
        const elsePart = elseAt === -1 ? [] : rest.slice(elseAt + 1)
        const branch = compare(args[0]!, args[1]!, args[2]!) ? thenPart : elsePart
        if (branch.length > 0) insert(branch.join(' '))
        return
      }
    }
    if (aliases.has(cmd)) {
      insert(aliases.get(cmd)!)
      return
    }
    if (cvars.has(cmd)) {
      if (args.length === 0) output.push(`"${cmd}" is "${cvars.get(cmd)}"`)
      else {
        if (cmd === 'timescale') log.push(tokens.join(' '))
        cvars.set(cmd, args[0]!)
      }
      return
    }
    log.push(tokens.join(' '))
    output.push(`Unknown command "${cmd}"`)
  }

  function run(): void {
    while (!waiting && cbuf !== '') execLine(nextLine())
  }

  return {
    cvars,
    aliases,
    files,
    log,
    output,
    setDemoPos: (pos) => {
      demoPos = pos
    },
    press: (text) => {
      cbuf += `${text}\n`
    },
    insert,
    run,
    frame: () => {
      waiting = false
      run()
    },
  }
}
