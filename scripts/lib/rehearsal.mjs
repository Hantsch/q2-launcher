// Decision logic of the release rehearsal (scripts/rehearse.mjs). Pure: no spawning, no
// filesystem, so the record, the shard parser and the verdict are unit-testable. The caller does
// the I/O and hands in log text, records and whether a pid is alive.

/** A ui-flows shard must finish inside this, or GitHub's job timeout is too close for comfort. */
export const MARGIN_SECONDS = 15 * 60

/** The commands every rehearsal runs, in order. */
export const CORE_COMMANDS = [{ name: 'verify:release' }, { name: 'ci:local' }]

/**
 * The Linux ui-flows leg: six act shards, ~24 min, with 20 flows quarantined for Linux — and
 * advisory on GitHub (`continue-on-error`), so a rehearsal runs it only on `--linux`. `shards`
 * marks its act log as per shard.
 */
export const LINUX_FLOWS_COMMAND = { name: 'ci:local:flows', shards: true }

export const LINUX_FLAG = '--linux'

/** The commands of one run: the core ones, plus the Linux leg when opted in. */
export function commandsFor({ linux = false } = {}) {
  return linux ? [...CORE_COMMANDS, LINUX_FLOWS_COMMAND] : [...CORE_COMMANDS]
}

/** The one line the launcher prints when the Linux leg stays out. */
export function skippedLinuxLine() {
  return (
    `skipped ${LINUX_FLOWS_COMMAND.name} (the Linux ui-flows leg: six act shards, ~24 min, ` +
    `advisory on GitHub); include it with: npm run rehearse -- ${LINUX_FLAG}`
  )
}

/**
 * The launcher's arguments: `{ mode: 'launch' | 'status' | 'run' | 'usage', linux, dir }`.
 * `--linux` is accepted by `launch` and by the runner it starts (`--run <dir>`), nowhere else.
 */
export function parseRehearseArgs(args) {
  const linux = args.includes(LINUX_FLAG)
  const rest = args.filter((arg) => arg !== LINUX_FLAG)
  if (rest.length === 0) return { mode: 'launch', linux, dir: null }
  if (!linux && rest.length === 1 && rest[0] === '--status') {
    return { mode: 'status', linux, dir: null }
  }
  if (rest.length === 2 && rest[0] === '--run') return { mode: 'run', linux, dir: rest[1] }
  return { mode: 'usage', linux, dir: null }
}

const pad = (n) => String(n).padStart(2, '0')

/** `yyyymmdd-hhmmss` in UTC - sorts lexically in start order, so the newest dir is the last name. */
export function runDirName(date) {
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  )
}

/** The newest run dir among `names`, or `null`. */
export function newestRunDir(names) {
  const runs = names.filter((name) => /^\d{8}-\d{6}$/.test(name)).sort()
  return runs.length > 0 ? runs[runs.length - 1] : null
}

/** A command's log file name: `:` is not allowed in Windows file names. */
export function logFileName(name) {
  return `${name.replaceAll(':', '-')}.log`
}

/**
 * The record before the runner has started: `pid` is set by the runner itself once it runs.
 * `skipped` names the legs left out on purpose (the Linux leg without `--linux`).
 */
export function initialRecord(startedAt, commands, skipped = []) {
  return {
    startedAt: startedAt.toISOString(),
    status: 'running',
    pid: null,
    commands: commands.map(({ name }) => ({ name, status: 'pending' })),
    skipped: [...skipped],
  }
}

/** Why the rehearsal cannot start, or `null` when act and Docker are both there. */
export function preflightReason({ act, docker }) {
  if (act === null) {
    return 'act not found: install it (Windows: `winget install nektos.act`) or set ACT=<path>'
  }
  if (!docker) return 'Docker is not running: start Docker Desktop'
  return null
}

/** Seconds in a Go duration as act prints it (`1h2m3.5s`, `850ms`); `null` when it is not one. */
export function parseGoDuration(text) {
  const match = /^(?:(\d+)h)?(?:(\d+)m(?!s))?(?:([\d.]+)s)?(?:([\d.]+)ms)?$/.exec(text.trim())
  if (!match || match.slice(1).every((part) => part === undefined)) return null
  const [, h = 0, m = 0, s = 0, ms = 0] = match
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000
}

const TIMESTAMPED = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z) (.*)$/
const SHARD_PREFIX = /^\[[^\]/]+\/[^\]]*\bshard (\d+)\/(\d+)[^\]]*\]/
const JOB_END = /\bJob (succeeded|failed)\b(?:\s*\[([^\]]+)\])?/

/**
 * Per-shard wall time and outcome from a rehearsal log. Every log line starts with the time the
 * runner received it, and act prefixes each line of a job with `[<workflow>/<job name>]`, so a
 * shard runs from its first prefixed line to its last - which is its wall time because the
 * workflow runs with `--concurrent-jobs 1`. When act prints a duration on the job's end line, that
 * duration wins. A shard without an end line did not finish and counts as failed.
 */
export function parseShards(logText) {
  const shards = new Map()
  for (const raw of logText.split(/\r?\n/)) {
    const stamped = TIMESTAMPED.exec(raw)
    if (!stamped) continue
    const at = Date.parse(stamped[1])
    const line = stamped[2].trimStart()
    const prefix = SHARD_PREFIX.exec(line)
    if (!prefix) continue
    const shard = `${prefix[1]}/${prefix[2]}`
    const entry = shards.get(shard) ?? { first: at, last: at, status: 'failed', duration: null }
    entry.last = at
    const end = JOB_END.exec(line.slice(prefix[0].length))
    if (end) {
      entry.status = end[1] === 'succeeded' ? 'passed' : 'failed'
      if (end[2] !== undefined) entry.duration = parseGoDuration(end[2])
    }
    shards.set(shard, entry)
  }
  return [...shards.entries()]
    .sort(([a], [b]) => Number(a.split('/')[0]) - Number(b.split('/')[0]))
    .map(([shard, { first, last, status, duration }]) => ({
      shard,
      seconds: Math.round(duration ?? (last - first) / 1000),
      status,
    }))
}

/** No shard parsed means the margin is unproven, not met. */
export function marginOk(shards) {
  return shards.length > 0 && shards.every((shard) => shard.seconds <= MARGIN_SECONDS)
}

/** `passed` only when every command passed and, if one was sharded, its margin held. */
export function finalStatus(record) {
  const allPassed = record.commands.every((command) => command.status === 'passed')
  const sharded = record.commands.some((command) => command.shards !== undefined)
  return allPassed && (!sharded || record.marginOk === true) ? 'passed' : 'failed'
}

/**
 * The `--status` view of a record: summary lines and the exit code (0 passed, 1 failed, 2 still
 * running or aborted). A record still `running` whose pid is gone was killed mid-run: aborted.
 */
export function statusView(dirName, record, pidAlive) {
  const verdict =
    record.status === 'running' ? (pidAlive ? 'running' : 'aborted') : String(record.status)
  const lines = [`rehearsal ${dirName} (started ${record.startedAt})`]
  for (const command of record.commands) {
    const detail = [
      command.seconds === undefined ? null : `${command.seconds}s`,
      command.exitCode === undefined || command.exitCode === 0 ? null : `exit ${command.exitCode}`,
    ].filter((part) => part !== null)
    lines.push(
      `  ${command.status.padEnd(8)} ${command.name}${detail.length ? ` (${detail.join(', ')})` : ''}`,
    )
    for (const shard of command.shards ?? []) {
      const over = shard.seconds > MARGIN_SECONDS ? ` - over the ${MARGIN_SECONDS}s margin` : ''
      lines.push(`    shard ${shard.shard}: ${shard.status} (${shard.seconds}s)${over}`)
    }
  }
  for (const name of record.skipped ?? []) {
    lines.push(`  ${'skipped'.padEnd(8)} ${name} (opt in with: npm run rehearse -- ${LINUX_FLAG})`)
  }
  if (record.marginOk === false) lines.push(`  shard margin (<= ${MARGIN_SECONDS}s): not met`)
  if (record.reason) lines.push(`  reason: ${record.reason}`)
  lines.push(`verdict: ${verdict.toUpperCase()}`)
  const exitCode = verdict === 'passed' ? 0 : verdict === 'failed' ? 1 : 2
  return { lines, exitCode }
}
