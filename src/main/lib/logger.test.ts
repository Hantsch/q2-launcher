import log from 'electron-log/main'
import { describe, expect, it, vi } from 'vitest'
import { logger, scopedLogger } from './logger'

describe('scopedLogger', () => {
  it('caught logs at warn with the error object', () => {
    const warn = vi.spyOn(log.scope('caught-test'), 'warn')
    const error = new Error('boom')
    scopedLogger('caught-test').caught('could not read file', error)
    expect(warn).toHaveBeenCalledWith('could not read file', error)
    warn.mockRestore()
  })

  it('keeps the default logger usable for existing callers', () => {
    expect(() => logger.info('still works')).not.toThrow()
  })
})
