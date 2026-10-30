// Pure helpers for the WebAssembly engine build (`scripts/engine/`); no I/O, no dependencies. (story 281)

const HEX40 = /^[0-9a-f]{40}$/
const PATCH_NAME = /^(\d{4})-\S+\.patch$/
const OPTS = ['O0', 'O1', 'O2']

export function readUpstream(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim())
  const [repo, commit] = lines
  if (!repo) throw new Error('UPSTREAM: missing repo line')
  if (!commit) throw new Error('UPSTREAM: missing commit line')
  if (!HEX40.test(commit)) throw new Error(`UPSTREAM: commit is not a full 40-hex sha: ${commit}`)
  return { repo, commit }
}

export function orderPatches(names) {
  const seen = new Map()
  for (const name of names) {
    const m = PATCH_NAME.exec(name)
    if (!m) throw new Error(`malformed patch name: ${name}`)
    if (seen.has(m[1]))
      throw new Error(`duplicate patch prefix ${m[1]}: ${seen.get(m[1])}, ${name}`)
    seen.set(m[1], name)
  }
  return [...seen.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, name]) => name)
}

export function parseArgs(argv) {
  const out = { opt: 'O2', checkConfig: false, patchesDir: undefined }
  for (const arg of argv) {
    if (arg.startsWith('--opt=')) {
      const value = arg.slice('--opt='.length)
      if (!OPTS.includes(value))
        throw new Error(`--opt must be one of ${OPTS.join(', ')}: ${value}`)
      out.opt = value
    } else if (arg === '--check-config') {
      out.checkConfig = true
    } else if (arg.startsWith('--patches-dir=')) {
      out.patchesDir = arg.slice('--patches-dir='.length)
    }
  }
  return out
}

const REPORTED_OPTIONS = [
  'libcurl',
  'openal',
  'sdl2',
  'x11',
  'wayland',
  'avcodec',
  'libjpeg',
  'system-console',
  'client-gtv',
  'client-ui',
  'mvd-server',
  'save-games',
  'tests',
  'zlib',
  'libpng',
  'software-sound',
  'optimization',
]

export function configReport(buildoptionsJson, targetsJson) {
  const byName = new Map(buildoptionsJson.map((o) => [o.name, o.value]))
  const lines = REPORTED_OPTIONS.map(
    (name) => `${name}=${byName.has(name) ? byName.get(name) : 'unset'}`,
  )
  for (const t of targetsJson) lines.push(`target: ${t.name}`)
  return lines
}

// The client links the listen server (src/server/*), so SV_* names are legitimate; forbidden
// covers only code that must be absent. Names are what --profiling-funcs keeps after wasm-opt,
// so a function inlined at -O2 vanishes from the dump either way. (story 281)
export const defaultSymbolRules = {
  forbidden: [
    /^GetGameAPI$/, // src/game/g_main.c: entry point of the game library, which is not built
    /^curl_/, // libcurl (option `libcurl`)
    /^alc?[A-Z]/, // OpenAL (option `openal`)
    /^Sys_RunConsole$/, // src/unix/tty.c: the dedicated server's terminal console (option `system-console`)
  ],
  // Com_Printf is a macro over Com_LPrintf (inc/shared/shared.h).
  required: ['main', 'Com_LPrintf', 'CL_Init'],
}

const NAME_LINE = /^\s*-\s*(?:func|global|table|memory)\[\d+\][^<\n]*<([^>]+)>/
const EXPORT_LINE = /->\s*"([^"]+)"/

export function checkSymbols(objdumpText, rules = defaultSymbolRules) {
  const names = new Set()
  for (const line of objdumpText.split(/\r?\n/)) {
    const m = NAME_LINE.exec(line)
    if (m) {
      names.add(m[1])
      // Imports read `<env.name>`; the bare name is what rules match.
      const dot = m[1].indexOf('.')
      if (dot >= 0) names.add(m[1].slice(dot + 1))
    }
    const e = EXPORT_LINE.exec(line)
    if (e) names.add(e[1])
  }
  const forbidden = [...names].filter((n) => rules.forbidden.some((re) => re.test(n))).sort()
  const missingRequired = rules.required.filter((n) => !names.has(n))
  return { ok: forbidden.length === 0 && missingRequired.length === 0, forbidden, missingRequired }
}
