import { readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { sourceFiles } from '../../../test-support/source-files'
import { describe, expect, it, vi } from 'vitest'
import { toastOutcomeError, toastRefusal } from './toast'

describe('toast helpers', () => {
  it('toastOutcomeError forwards key and params, sticky', () => {
    const push = vi.fn()
    toastOutcomeError(push, { ok: false, error: { key: 'a.b', params: { n: 2 } } })
    expect(push).toHaveBeenCalledWith({
      level: 'error',
      messageKey: 'a.b',
      timeoutMs: 0,
      params: { n: 2 },
    })
    push.mockClear()
    toastOutcomeError(push, { ok: false, error: { key: 'a.b' } })
    expect(push.mock.calls[0][0]).toEqual({ level: 'error', messageKey: 'a.b', timeoutMs: 0 })
    expect('params' in push.mock.calls[0][0]).toBe(false)
  })

  it('toastRefusal forwards reasonKey and params, sticky', () => {
    const push = vi.fn()
    toastRefusal(push, { ok: false, reasonKey: 'x.y', params: { name: 'q' } })
    expect(push).toHaveBeenCalledWith({
      level: 'error',
      messageKey: 'x.y',
      timeoutMs: 0,
      params: { name: 'q' },
    })
    push.mockClear()
    toastRefusal(push, { ok: false, reasonKey: 'x.y' })
    expect('params' in push.mock.calls[0][0]).toBe(false)
  })
})

describe('toast literal guard', () => {
  it('no inline error-toast literal remains outside toast.ts', () => {
    const root = join(process.cwd(), 'src', 'renderer', 'src')
    const toastModule = join(root, 'lib', 'toast.ts')
    const hits = sourceFiles(root)
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\./.test(file) && file !== toastModule)
      .filter((file) => /messageKey:\s*\w+\.error\.key/.test(readFileSync(file, 'utf8')))
      .map((file) => file.split(sep).join('/'))
    expect(hits).toEqual([])
  })
})
