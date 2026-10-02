import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createDemoFileActions, type DemoFileActionsDeps } from './file-actions'

function makeDeps(overrides: Partial<DemoFileActionsDeps> = {}): {
  deps: DemoFileActionsDeps
  reveal: ReturnType<typeof vi.fn>
  writeClipboard: ReturnType<typeof vi.fn>
} {
  const reveal = vi.fn()
  const writeClipboard = vi.fn()
  const deps: DemoFileActionsDeps = {
    resolveFile: (id) =>
      id === 'known' ? { absolutePath: 'C:\\demos\\one.dm2', archiveEntry: null } : undefined,
    stat: async () => ({}),
    reveal,
    writeClipboard,
    ...overrides,
  }
  return { deps, reveal, writeClipboard }
}

describe('createDemoFileActions', () => {
  it('AC1: reveal hands the resolved absolute path to the reveal dependency', async () => {
    const { deps, reveal } = makeDeps()
    const actions = createDemoFileActions(deps)

    const result = await actions.reveal('known')

    expect(result).toEqual({ ok: true })
    expect(reveal).toHaveBeenCalledWith('C:\\demos\\one.dm2')
  })

  it('AC2: copyPath writes the resolved absolute path to the clipboard and never returns it', async () => {
    const { deps, writeClipboard } = makeDeps()
    const actions = createDemoFileActions(deps)

    const result = await actions.copyPath('known')

    expect(result).toEqual({ ok: true })
    expect(writeClipboard).toHaveBeenCalledWith('C:\\demos\\one.dm2')
    expect(JSON.stringify(result)).not.toContain('demos')
  })

  it("AC3: an archive entry reveals and copies the archive file's own path", async () => {
    const { deps, reveal, writeClipboard } = makeDeps({
      resolveFile: (id) =>
        id === 'archived'
          ? {
              absolutePath: 'C:\\demos\\archive.zip',
              archiveEntry: { archivePath: 'C:\\demos\\archive.zip', entryPath: 'inner.dm2' },
            }
          : undefined,
    })
    const actions = createDemoFileActions(deps)

    await actions.reveal('archived')
    await actions.copyPath('archived')

    expect(reveal).toHaveBeenCalledWith('C:\\demos\\archive.zip')
    expect(writeClipboard).toHaveBeenCalledWith('C:\\demos\\archive.zip')
  })

  it('AC4: an unknown id is refused as unknownDemo without touching the shell or clipboard', async () => {
    const { deps, reveal, writeClipboard } = makeDeps()
    const actions = createDemoFileActions(deps)

    const revealResult = await actions.reveal('missing')
    const copyResult = await actions.copyPath('missing')

    expect(revealResult).toEqual({ ok: false, reasonKey: 'replays.fileActions.unknownDemo' })
    expect(copyResult).toEqual({ ok: false, reasonKey: 'replays.fileActions.unknownDemo' })
    expect(reveal).not.toHaveBeenCalled()
    expect(writeClipboard).not.toHaveBeenCalled()
  })

  it('AC5: a vanished file is refused as fileMissing for both actions', async () => {
    const { deps, reveal, writeClipboard } = makeDeps({
      stat: async () => {
        throw Object.assign(new Error('not found'), { code: 'ENOENT' })
      },
    })
    const actions = createDemoFileActions(deps)

    const revealResult = await actions.reveal('known')
    const copyResult = await actions.copyPath('known')

    expect(revealResult).toEqual({ ok: false, reasonKey: 'replays.fileActions.fileMissing' })
    expect(copyResult).toEqual({ ok: false, reasonKey: 'replays.fileActions.fileMissing' })
    expect(reveal).not.toHaveBeenCalled()
    expect(writeClipboard).not.toHaveBeenCalled()
  })

  it('a non-ENOENT/ENOTDIR stat error never blocks the action', async () => {
    const { deps, reveal } = makeDeps({
      stat: async () => {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
      },
    })
    const actions = createDemoFileActions(deps)

    const result = await actions.reveal('known')

    expect(result).toEqual({ ok: true })
    expect(reveal).toHaveBeenCalledWith('C:\\demos\\one.dm2')
  })
})

function resolvesInEn(key: string): boolean {
  const en = JSON.parse(
    readFileSync(join(process.cwd(), 'src/renderer/src/i18n/locales/en.json'), 'utf-8'),
  ) as Record<string, unknown>
  const value = key
    .split('.')
    .reduce<unknown>((acc, part) => (acc as Record<string, unknown> | undefined)?.[part], en)
  return typeof value === 'string'
}

describe('refusal keys', () => {
  it('a refused file action carries the full replays.fileActions key', async () => {
    const unknown = createDemoFileActions(makeDeps().deps)
    const missing = createDemoFileActions(
      makeDeps({
        stat: async () => {
          throw Object.assign(new Error('not found'), { code: 'ENOENT' })
        },
      }).deps,
    )
    const keys = [
      await unknown.reveal('missing'),
      await unknown.copyPath('missing'),
      await missing.reveal('known'),
      await missing.copyPath('known'),
    ].map((result) => (result.ok ? null : result.reasonKey))
    expect(keys).toEqual([
      'replays.fileActions.unknownDemo',
      'replays.fileActions.unknownDemo',
      'replays.fileActions.fileMissing',
      'replays.fileActions.fileMissing',
    ])
    for (const key of keys) expect(resolvesInEn(key as string)).toBe(true)
  })
})
