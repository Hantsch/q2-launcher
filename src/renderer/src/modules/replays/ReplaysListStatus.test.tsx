// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mockClient } from '../../test-support/mock-client'
import type { ReplaysScanProgress, ReplaysSourceError } from '@shared/modules/replays'
import { initI18n } from '../../i18n'
import { demoFoldersRead } from './client'
import { ReplaysListStatus } from './ReplaysListStatus'

vi.mock('./client', (importOriginal) =>
  mockClient<typeof import('./client')>(importOriginal as never),
)

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
  vi.mocked(demoFoldersRead).mockReset()
})

const progress = (sourceErrors: ReplaysSourceError[] = []): ReplaysScanProgress => ({
  running: false,
  sources: [],
  sourceErrors,
})

const missingFor = (installationId: string): ReplaysSourceError => ({
  source: {
    kind: 'installation',
    installationId,
    installationName: installationId,
    gameDir: 'baseq2',
  },
  archiveName: null,
  reason: 'missing',
})

function renderStatus(props: Partial<Parameters<typeof ReplaysListStatus>[0]>) {
  return render(
    createElement(ReplaysListStatus, {
      listState: 'populated',
      progress: progress(),
      scope: { kind: 'installation', installationId: 'a' },
      installationName: 'Alpha',
      onOpenSettings: () => {},
      ...props,
    }),
  )
}

describe('ReplaysListStatus', () => {
  it('an empty installation names its demo folders and shows no warning', async () => {
    vi.mocked(demoFoldersRead).mockResolvedValue({
      ok: true,
      value: { folders: ['C:/q2/baseq2/demos', 'C:/q2/ctf/demos'] },
    })
    renderStatus({ listState: 'emptyForInstallation' })

    await waitFor(() => expect(screen.getAllByTestId('replays-list-empty-folder')).toHaveLength(2))
    expect(demoFoldersRead).toHaveBeenCalledWith('a')
    const block = screen.getByTestId('replays-list-empty-installation')
    expect(block.textContent).toContain('No demos in Alpha yet.')
    expect(block.textContent).toContain('C:/q2/ctf/demos')
    expect(block.querySelector('svg')).toBeNull()
    expect(screen.queryByTestId('replays-list-source-error')).toBeNull()
    expect(screen.getByTestId('replays-list-empty-settings')).toBeTruthy()
  })

  it('another installation source error is not shown in scope', () => {
    renderStatus({ progress: progress([missingFor('b')]) })
    expect(screen.queryByTestId('replays-list-source-error')).toBeNull()

    cleanup()
    renderStatus({ progress: progress([missingFor('a')]) })
    expect(screen.getAllByTestId('replays-list-source-error')).toHaveLength(1)

    cleanup()
    renderStatus({ progress: progress([missingFor('b')]), scope: { kind: 'all' } })
    expect(screen.getAllByTestId('replays-list-source-error')).toHaveLength(1)
  })

  it('no installation and none selected each say why', () => {
    renderStatus({ listState: 'noInstallation', scope: { kind: 'none' }, installationName: null })
    expect(screen.getByTestId('replays-list-no-installation').textContent).toContain(
      'No installation yet',
    )
    cleanup()
    renderStatus({ listState: 'noneSelected', scope: { kind: 'none' }, installationName: null })
    expect(screen.getByTestId('replays-list-none-selected').textContent).toContain(
      'Select an installation',
    )
  })
})
