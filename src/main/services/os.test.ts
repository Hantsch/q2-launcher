import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installTempDir } from '../../test-support/temp-dir'

const record = vi.hoisted(() => ({
  url: vi.fn(async () => {}),
  path: vi.fn(async () => {}),
  trash: vi.fn(async () => {}),
}))

vi.mock('../lib/ui-harness', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/ui-harness')>()),
  recordHarnessExternalUrl: record.url,
  recordHarnessRevealedPath: record.path,
  trashHarnessItem: record.trash,
}))

import { resolveUiHarness } from '../lib/ui-harness'
import { createOsService } from './os'

const shell = {
  openPath: vi.fn(async () => ''),
  showItemInFolder: vi.fn(),
  openExternal: vi.fn(async () => {}),
  trashItem: vi.fn(async (_path: string) => {}),
}
const clipboard = { writeText: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('os service', () => {
  it('under the harness the os service records and never calls the shell', async () => {
    const harness = resolveUiHarness({ Q2L_UI_HARNESS: '1' })
    const os = createOsService({ harness, shell, clipboard })

    expect(await os.openPath('/tmp/a')).toBe('')
    await os.showItemInFolder('/tmp/b')
    await os.openExternal('https://example.test/')
    os.copyText('text')
    await os.trashItem('/tmp/c')

    expect(record.trash).toHaveBeenCalledWith(harness, '/tmp/c')
    expect(shell.trashItem).not.toHaveBeenCalled()
    expect(record.path).toHaveBeenNthCalledWith(1, harness, '/tmp/a')
    expect(record.path).toHaveBeenNthCalledWith(2, harness, '/tmp/b')
    expect(record.url).toHaveBeenCalledWith(harness, 'https://example.test/')
    expect(shell.openPath).not.toHaveBeenCalled()
    expect(shell.showItemInFolder).not.toHaveBeenCalled()
    expect(shell.openExternal).not.toHaveBeenCalled()
    expect(clipboard.writeText).toHaveBeenCalledWith('text')
  })

  it('outside the harness each call reaches the shell exactly once', async () => {
    shell.openPath.mockResolvedValueOnce('boom')
    const os = createOsService({ harness: resolveUiHarness({}), shell, clipboard })

    expect(await os.openPath('/a')).toBe('boom')
    await os.showItemInFolder('/b')
    await os.openExternal('https://example.test/')
    os.copyText('text')

    expect(shell.openPath).toHaveBeenCalledOnce()
    expect(shell.openPath).toHaveBeenCalledWith('/a')
    expect(shell.showItemInFolder).toHaveBeenCalledOnce()
    expect(shell.openExternal).toHaveBeenCalledOnce()
    expect(clipboard.writeText).toHaveBeenCalledOnce()
    expect(record.path).not.toHaveBeenCalled()
    expect(record.url).not.toHaveBeenCalled()
  })

  describe('trash', () => {
    const tempDir = installTempDir('q2-launcher-os-trash-')

    it('trashItem hands the path to shell.trashItem and never removes it itself', async () => {
      const file = join(tempDir(), 'a.dm2')
      await writeFile(file, 'demo')
      const os = createOsService({ harness: resolveUiHarness({}), shell, clipboard })

      await os.trashItem(file)
      expect(shell.trashItem).toHaveBeenCalledExactlyOnceWith(file)
      expect(await readFile(file, 'utf8')).toBe('demo')

      shell.trashItem.mockRejectedValueOnce(new Error('Failed to move item to trash'))
      await expect(os.trashItem(file)).rejects.toThrow('Failed to move item to trash')
      expect(await readFile(file, 'utf8')).toBe('demo')
      expect(record.trash).not.toHaveBeenCalled()
    })
  })
})
