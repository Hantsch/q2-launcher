// Decision logic of the release rehearsal (scripts/rehearse.mjs). Pure: no spawning, no
// filesystem, so the record and the verdict are unit-testable. The caller does the I/O and hands in
// records and whether a pid is alive.

/** The commands every rehearsal runs. */
export const CORE_COMMANDS = [{ name: 'verify:release' }]

/**
 * The Linux checks (act + Docker, advisory on their own): opt-in, and run before the core
 * commands, one after the other - both use act's containers and Docker's resources.
 */
export const LINUX_COMMAND = { name: 'verify:linux' }

export const LINUX_FLAG = '--linux'

/** The commands of one run, in order: the Linux checks first when opted in, then the core ones. */
export function commandsFor({ linux = false } = {}) {
  return linux ? [LINUX_COMMAND, ...CORE_COMMANDS] : [...CORE_COMMANDS]
}

/** The one line the launcher prints when the Linux checks stay out. */
export function skippedLinuxLine() {
  return (
    `skipped ${LINUX_COMMAND.name} (the Linux checks, advisory); include it with: ` +
    `npm run rehearse -- ${LINUX_FLAG}`
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
 * `skipped` names the legs left out on purpose (the Linux checks without `--linux`).
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

/** `passed` only when every command passed. */
export function finalStatus(record) {
  return record.commands.every((command) => command.status === 'passed') ? 'passed' : 'failed'
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
  }
  for (const name of record.skipped ?? []) {
    lines.push(`  ${'skipped'.padEnd(8)} ${name} (opt in with: npm run rehearse -- ${LINUX_FLAG})`)
  }
  if (record.reason) lines.push(`  reason: ${record.reason}`)
  lines.push(`verdict: ${verdict.toUpperCase()}`)
  const exitCode = verdict === 'passed' ? 0 : verdict === 'failed' ? 1 : 2
  return { lines, exitCode }
}
