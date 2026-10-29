// Decision logic of the flow gate (scripts/flows-all.mjs). Pure: no spawning, no filesystem, so
// every rule is unit-testable. The caller supplies directory listings, the platform and a
// `runFlow` that seeds and runs one flow.

export const MAX_QUARANTINE_AGE = 3

const SPRINT_ID = /^S(\d+)$/
const PLATFORMS = ['win32', 'linux']

export function sprintNumber(id) {
  const match = SPRINT_ID.exec(String(id))
  return match ? Number(match[1]) : null
}

/** Parses `i/n` (1-based, integers, 1 <= i <= n); `null` when malformed. */
export function parseShard(text) {
  const match = /^(\d+)\/(\d+)$/.exec(String(text))
  if (!match) return null
  const index = Number(match[1])
  const count = Number(match[2])
  return index >= 1 && index <= count ? { index, count } : null
}

/** Round-robin so the slow, alphabetically adjacent flows of one area spread across shards. */
export function selectShard(names, index, count) {
  return names.filter((_, k) => k % count === index - 1)
}

/** Parses a count flag's value (`--repeat`, `--parallel`: integer >= 1); `null` when malformed. */
export function parseCount(text) {
  if (!/^\d+$/.test(String(text))) return null
  const count = Number(text)
  return count >= 1 ? count : null
}

export const parseRepeat = parseCount

/** Each flow n times in a row, so a flaky flow shows up as consecutive runs of one name. */
export function repeatFlows(names, count) {
  return names.flatMap((name) => Array.from({ length: count }, () => name))
}

const FLOW_PATH = /^(?:.*\/)?scripts\/flows\/([^/]+)\.mjs$/

/** A flow argument as a name: `scripts/flows/<name>.mjs` (either separator) or a bare name. */
export function flowNameOf(arg) {
  const text = String(arg).replace(/\\/g, '/')
  const match = FLOW_PATH.exec(text)
  return match ? match[1] : text
}

/**
 * Parses the gate's arguments against the known flow names. `errors` is non-empty on any
 * malformed flag or unknown flow; `affected` is `null` without `--affected`, else `{ ref }`
 * (`ref` is `null` for the bare flag, meaning HEAD); `parallel` is `null` without `--parallel`;
 * `tier` is `null` without `--tier`, else `smoke` or `full`.
 */
export function parseFlowArgs(args, known, defaultTimeoutSeconds = 300) {
  const errors = []
  const named = []
  let affected = null
  let shard = null
  let timeoutSeconds = defaultTimeoutSeconds
  let repeat = 1
  let parallel = null
  let tier = null
  let confirm = true
  for (const arg of args) {
    if (arg === '--no-confirm') {
      confirm = false
      continue
    }
    if (!arg.startsWith('--')) {
      const name = flowNameOf(arg)
      if (!known.includes(name)) errors.push(`unknown flow: ${arg}`)
      else if (!named.includes(name)) named.push(name)
      continue
    }
    const eq = arg.indexOf('=')
    const key = eq === -1 ? arg : arg.slice(0, eq)
    const value = eq === -1 ? '' : arg.slice(eq + 1)
    if (key === '--shard') {
      shard = parseShard(value)
      if (shard === null) errors.push(`malformed ${arg}`)
    } else if (key === '--timeout') {
      timeoutSeconds = /^\d+(\.\d+)?$/.test(value) ? Number(value) : 0
      if (!(timeoutSeconds > 0)) errors.push(`malformed ${arg}`)
    } else if (key === '--repeat') {
      repeat = parseCount(value)
      if (repeat === null) errors.push(`malformed ${arg}`)
    } else if (key === '--parallel') {
      parallel = parseCount(value)
      if (parallel === null) errors.push(`malformed ${arg}`)
    } else if (key === '--tier') {
      if (value === 'smoke' || value === 'full') tier = value
      else errors.push(`malformed ${arg}`)
    } else if (key === '--affected' && (eq === -1 || value !== '')) {
      affected = { ref: eq === -1 ? null : value }
    } else {
      errors.push(`unknown option: ${arg}`)
    }
  }
  if (tier !== null && (named.length > 0 || affected !== null)) {
    errors.push('--tier cannot be combined with flow names or --affected')
  }
  return { errors, named, affected, shard, timeoutSeconds, repeat, parallel, tier, confirm }
}

/**
 * The flows to run: the named ones, then those `--affected` adds (`picks` from selectAffected),
 * each once. Without `--affected` and without names that is every known flow; with `--affected`
 * and nothing named or picked it is empty, because nothing a change can break was found. With a
 * `tier` the flows are exactly `tierNames`.
 */
export function planFlows({ named, affected, picks = [], known, tier = null, tierNames = [] }) {
  if (tier) return { names: tierNames, added: [] }
  const added = affected ? picks.filter((pick) => !named.includes(pick.flow)) : []
  const names = affected || named.length > 0 ? [...named, ...added.map((pick) => pick.flow)] : known
  return { names, added }
}

/** Problems with the quarantine list itself, each message naming the offending entry. */
export function validateQuarantine(entries, knownFlows) {
  if (!Array.isArray(entries)) return ['quarantine list: expected an array of entries']
  const problems = []
  entries.forEach((entry, index) => {
    const label = `quarantine entry ${index + 1}${entry?.flow ? ` (${entry.flow})` : ''}`
    if (entry === null || typeof entry !== 'object') {
      problems.push(`${label}: not an object`)
      return
    }
    for (const field of ['flow', 'reason', 'story', 'since']) {
      if (typeof entry[field] !== 'string' || entry[field].trim() === '') {
        problems.push(`${label}: missing field "${field}"`)
      }
    }
    if (
      typeof entry.since === 'string' &&
      entry.since !== '' &&
      sprintNumber(entry.since) === null
    ) {
      problems.push(`${label}: "since" must look like S32, got "${entry.since}"`)
    }
    if (typeof entry.story === 'string' && entry.story.trim().toLowerCase() === 'unattributed') {
      problems.push(`${label}: "story" must name a story or TD id, got "unattributed"`)
    }
    if ('platform' in entry && !PLATFORMS.includes(entry.platform)) {
      problems.push(
        `${label}: "platform" must be one of ${PLATFORMS.join(', ')}, got "${entry.platform}"`,
      )
    }
    if (typeof entry.flow === 'string' && entry.flow !== '' && !knownFlows.includes(entry.flow)) {
      problems.push(`${label}: no flow named "${entry.flow}" in scripts/flows/`)
    }
  })
  return problems
}

/**
 * The sprint being worked on: the lowest SNN directory still open, otherwise the one after the
 * highest finished sprint. `null` when neither listing holds a sprint.
 */
export function currentSprint(openDirs, doneDirs) {
  const open = openDirs.map(sprintNumber).filter((n) => n !== null)
  if (open.length > 0) return Math.min(...open)
  const done = doneDirs.map(sprintNumber).filter((n) => n !== null)
  return done.length > 0 ? Math.max(...done) + 1 : null
}

/** Entries that have been quarantined for more than MAX_QUARANTINE_AGE sprints. */
export function staleEntries(entries, current) {
  if (current === null) return []
  // Linux is a manually-run qualification target: its entries list known platform differences.
  return entries
    .filter((entry) => entry.platform !== 'linux')
    .filter((entry) => current - sprintNumber(entry.since) > MAX_QUARANTINE_AGE)
    .map(
      (entry) =>
        `${entry.flow}: quarantined since ${entry.since}, older than three sprints — fix or make it a story`,
    )
}

export function entriesFor(entries, platform = process.platform) {
  return entries.filter((entry) => entry.platform === undefined || entry.platform === platform)
}

/**
 * Runs every flow and decides the verdict. `runFlow(name)` returns whether the flow passed (it
 * may be async); a quarantined flow that passes is run once more before judging.
 */
export async function runGate({
  names,
  entries,
  runFlow,
  platform = process.platform,
  current = null,
  knownFlows = names,
  now = Date.now,
}) {
  const configErrors = [...validateQuarantine(entries, knownFlows)]
  if (configErrors.length === 0) configErrors.push(...staleEntries(entries, current))

  const quarantined = new Map(
    configErrors.length === 0 ? entriesFor(entries, platform).map((e) => [e.flow, e]) : [],
  )
  const failed = []
  const expectedFails = []
  const unexpectedPasses = []
  const flaky = []
  const notes = []
  const flows = []
  const timed = async (name, index) => {
    const start = now()
    const ok = await runFlow(name, index)
    flows.push({ name, seconds: Math.round((now() - start) / 100) / 10, ok })
    return ok
  }

  for (const [index, name] of names.entries()) {
    const entry = quarantined.get(name)
    const passed = await timed(name, index)
    if (!entry) {
      if (!passed) failed.push(name)
    } else if (!passed) {
      expectedFails.push(name)
      notes.push(`expected fail: ${name} (${entry.reason}, story ${entry.story})`)
    } else if (await timed(name, index)) {
      unexpectedPasses.push(name)
      notes.push(`unexpected pass twice: ${name} — remove it from quarantine`)
    } else {
      flaky.push(name)
      notes.push(`unexpected pass (flaky): ${name} passed once, then failed on re-run`)
    }
  }

  const ok = failed.length === 0 && unexpectedPasses.length === 0 && configErrors.length === 0
  return { ok, failed, expectedFails, unexpectedPasses, flaky, configErrors, notes, flows }
}

/**
 * Re-runs only the flows that failed. `runPass(names)` returns a gate result over exactly those
 * names. A flow that then passes is flaky, which is reported but does not fail the run; one that
 * fails twice stays failed. Quarantined outcomes are never re-run.
 */
export async function confirmFailures(first, runPass) {
  if (first.failed.length === 0) return first
  const second = await runPass(first.failed)
  const failed = first.failed.filter((name) => second.failed.includes(name))
  const recovered = first.failed.filter((name) => !failed.includes(name))
  return {
    ...first,
    ok:
      failed.length === 0 && first.unexpectedPasses.length === 0 && first.configErrors.length === 0,
    failed,
    flaky: [...first.flaky, ...recovered],
    flows: [...(first.flows ?? []), ...(second.flows ?? [])],
  }
}

/** Process exit status of a (confirmed) gate result. */
export const exitStatus = (result) => (result.ok ? 0 : 1)

/** The `count` slowest flow runs, slowest first; runs without a measured time are skipped. */
export function slowestLines(flows, count = 10) {
  const timed = flows.filter((flow) => flow.seconds !== null)
  if (timed.length === 0) return []
  timed.sort((a, b) => b.seconds - a.seconds)
  return ['slowest:', ...timed.slice(0, count).map((flow) => `  ${flow.name} ${flow.seconds}s`)]
}

export function summaryLines(result, total, seconds) {
  const passed =
    total -
    result.failed.length -
    result.expectedFails.length -
    result.unexpectedPasses.length -
    (result.flaky?.length ?? 0)
  const lines = [`${passed}/${total} flows passed in ${seconds}s`]
  if (result.failed.length > 0) lines.push(`failed: ${result.failed.join(', ')}`)
  if ((result.flaky?.length ?? 0) > 0) lines.push(`flaky: ${result.flaky.join(', ')}`)
  lines.push(...result.notes)
  lines.push(...result.configErrors)
  if (result.flows?.length > 0) lines.push(...slowestLines(result.flows))
  return lines
}
