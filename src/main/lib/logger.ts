import log from 'electron-log/main'

/**
 * Central logging. `electron-log` writes to a rotating file next to the
 * launcher's state (see `AppInfo.logPath`), which is what we ask users to attach
 * to bug reports.
 */
log.initialize()
log.transports.file.level = 'info'
log.transports.console.level = 'debug'
log.errorHandler.startCatching({ showDialog: false })

export type Logger = ReturnType<typeof log.scope>

export function scopedLogger(scope: string): Logger {
  return log.scope(scope)
}

export const logger = scopedLogger('main')

export function logFilePath(): string {
  return log.transports.file.getFile().path
}
