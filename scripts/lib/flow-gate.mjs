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
  return entries
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

  for (const [index, name] of names.entries()) {
    const entry = quarantined.get(name)
    const passed = await runFlow(name, index)
    if (!entry) {
      if (!passed) failed.push(name)
    } else if (!passed) {
      expectedFails.push(name)
      notes.push(`expected fail: ${name} (${entry.reason}, story ${entry.story})`)
    } else if (await runFlow(name, index)) {
      unexpectedPasses.push(name)
      notes.push(`unexpected pass twice: ${name} — remove it from quarantine`)
    } else {
      flaky.push(name)
      notes.push(`unexpected pass (flaky): ${name} passed once, then failed on re-run`)
    }
  }

  const ok = failed.length === 0 && unexpectedPasses.length === 0 && configErrors.length === 0
  return { ok, failed, expectedFails, unexpectedPasses, flaky, configErrors, notes }
}

export function summaryLines(result, total, seconds) {
  const passed =
    total - result.failed.length - result.expectedFails.length - result.unexpectedPasses.length
  const lines = [`${passed}/${total} flows passed in ${seconds}s`]
  if (result.failed.length > 0) lines.push(`failed: ${result.failed.join(', ')}`)
  lines.push(...result.notes)
  lines.push(...result.configErrors)
  return lines
}
