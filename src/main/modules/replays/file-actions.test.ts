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

    expect(revealResult).toEqual({ ok: false, reason: 'unknownDemo' })
    expect(copyResult).toEqual({ ok: false, reason: 'unknownDemo' })
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

    expect(revealResult).toEqual({ ok: false, reason: 'fileMissing' })
    expect(copyResult).toEqual({ ok: false, reason: 'fileMissing' })
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
