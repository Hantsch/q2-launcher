/**
 * What `electron-log/main` resolves to under vitest (aliased in `vitest.config.ts`). The real one
 * requires `electron` from inside `node_modules` - which no alias reaches - and prints every log
 * line to the console, burying test output. This stub covers exactly the surface
 * `src/main/lib/logger.ts` touches and writes nothing anywhere.
 *
 * The log file path is deliberately outside any directory a test mocks as `userData`: tests that
 * check the log file is a reveal target must be carried by the log root itself, not by a
 * neighbouring root that happens to contain it. It is built without `node:os`/`node:path`, which
 * some tests replace with partial mocks of their own.
 */

const noop = (): void => {}

const scoped = {
  error: noop,
  warn: noop,
  info: noop,
  verbose: noop,
  debug: noop,
  silly: noop,
  log: noop,
}

const CWD = process.cwd()
const LOG_FILE = [CWD, 'out', 'test-logs', 'main.log'].join(CWD.includes('\\') ? '\\' : '/')

const log = {
  ...scoped,
  initialize: noop,
  scope: (): typeof scoped => scoped,
  transports: {
    file: { level: 'info' as string | false, getFile: () => ({ path: LOG_FILE }) },
    console: { level: 'debug' as string | false },
  },
  errorHandler: { startCatching: noop, stopCatching: noop },
}

export default log
