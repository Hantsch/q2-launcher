// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ConfigProfile,
  ImportFilesCommitInput,
  ImportFilesPreviewInput,
  ImportPreviewResult,
  PickedConfigFile,
} from '@shared/modules/config'
import type { Outcome } from '@shared/types'
import { initI18n } from '../../i18n'
import { ImportProfileDialog } from './ImportProfileDialog'

/**
 * Story 066 D7: `ImportProfileDialog`'s file-picker flow - the installation/gamedir selects are
 * gone, replaced by a "Choose files" button and an ordered list with move-up/move-down/remove per
 * row. These tests cover this deliverable's own three acceptance points (AC5's "list order is the
 * load order" and "reordering/removing re-triggers the preview", plus the path-trust guarantee):
 * the reader/parser behaviour itself (AC6-AC8) is `import-reader.test.ts`'s job, not this
 * component's.
 *
 * `./client` is mocked (`CreateProfileDialog.test.tsx`'s own precedent for this module) rather than
 * stubbing `window.q2`, because these tests need to see exactly which `fileIds`, in which order,
 * each call carried - not just that a call happened.
 */

let pickCalls = 0
let previewCalls: ImportFilesPreviewInput[] = []
let commitCalls: ImportFilesCommitInput[] = []

/** Every field a real `PickedConfigFile` may ever carry - nothing path-shaped, by the shared
 * type's own definition (`@shared/modules/config`). Used verbatim as the mock's return value so a
 * test can prove the component works with exactly this shape and nothing more. */
const FILE_A: PickedConfigFile = { id: 'id-a', fileName: 'config.cfg', dirName: 'baseq2' }
const FILE_B: PickedConfigFile = { id: 'id-b', fileName: 'dmalias.cfg', dirName: 'baseq2' }
const FILE_C: PickedConfigFile = { id: 'id-c', fileName: 'gfx.cfg', dirName: 'baseq2' }

const PREVIEW_OK: ImportPreviewResult = {
  cvarCount: 3,
  bindCount: 2,
  aliasCount: 0,
  messageCount: 0,
  preserved: [],
  filesRead: ['config.cfg'],
  duplicateBinds: [],
  duplicateAliases: [],
  ambiguousRebindAliases: [],
  ownWrittenFile: false,
  metadataVersion: null,
  sourceProfileId: null,
  metadataWarnings: [],
  cvarSections: [],
}

vi.mock('./client', () => ({
  pickImportFiles: vi.fn(async (): Promise<Outcome<PickedConfigFile[]>> => {
    pickCalls += 1
    return { ok: true, value: [FILE_A, FILE_B, FILE_C] }
  }),
  previewImportFiles: vi.fn(
    async (input: ImportFilesPreviewInput): Promise<Outcome<ImportPreviewResult>> => {
      previewCalls.push(input)
      return { ok: true, value: PREVIEW_OK }
    },
  ),
  commitImportFiles: vi.fn(async (input: ImportFilesCommitInput): Promise<Outcome<ConfigProfile[]>> => {
    commitCalls.push(input)
    return { ok: true, value: [] }
  }),
}))

beforeAll(async () => {
  await initI18n('en')
})

beforeEach(() => {
  pickCalls = 0
  previewCalls = []
  commitCalls = []
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderDialog(): { onCreated: ReturnType<typeof vi.fn> } {
  const onCreated = vi.fn()
  render(
    createElement(ImportProfileDialog, {
      profiles: [] as ConfigProfile[],
      onClose: () => {},
      onCreated,
    }),
  )
  return { onCreated }
}

function fileRows(): HTMLElement[] {
  return screen.getAllByTestId('config-import-file-row')
}

async function choose(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /Choose files/ }))
  await waitFor(() => expect(fileRows()).toHaveLength(3))
}

describe('ImportProfileDialog file list', () => {
  it('the list order is the load order (AC5): the on-screen row order is exactly the fileIds sent to preview and commit', async () => {
    const { onCreated } = renderDialog()

    await choose()

    // Rows render in pick order.
    const rows = fileRows()
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('config.cfg'),
      expect.stringContaining('dmalias.cfg'),
      expect.stringContaining('gfx.cfg'),
    ])

    await waitFor(() => expect(previewCalls.at(-1)?.fileIds).toEqual(['id-a', 'id-b', 'id-c']))

    const submit = screen.getByRole('button', { name: 'Create profile' }) as HTMLButtonElement
    await waitFor(() => expect(submit.disabled).toBe(false))
    fireEvent.click(submit)

    await waitFor(() => expect(commitCalls).toHaveLength(1))
    expect(commitCalls[0].fileIds).toEqual(['id-a', 'id-b', 'id-c'])
    expect(onCreated).toHaveBeenCalledTimes(1)
  })

  it('removing and reordering re-trigger the preview with the updated fileIds (AC5)', async () => {
    renderDialog()

    await choose()
    await waitFor(() => expect(previewCalls).toHaveLength(1))
    expect(previewCalls[0].fileIds).toEqual(['id-a', 'id-b', 'id-c'])

    // Move the first row ("config.cfg") down: a -> [b, a, c].
    fireEvent.click(
      within(fileRows()[0]).getByRole('button', { name: 'Move file down' }),
    )
    await waitFor(() => expect(previewCalls).toHaveLength(2))
    expect(previewCalls[1].fileIds).toEqual(['id-b', 'id-a', 'id-c'])
    expect(fileRows().map((row) => row.textContent)).toEqual([
      expect.stringContaining('dmalias.cfg'),
      expect.stringContaining('config.cfg'),
      expect.stringContaining('gfx.cfg'),
    ])

    // Move the second row ("config.cfg", now at index 1) back up: [b, a, c] -> [a, b, c].
    fireEvent.click(
      within(fileRows()[1]).getByRole('button', { name: 'Move file up' }),
    )
    await waitFor(() => expect(previewCalls).toHaveLength(3))
    expect(previewCalls[2].fileIds).toEqual(['id-a', 'id-b', 'id-c'])

    // Remove the last row ("gfx.cfg"): [a, b, c] -> [a, b].
    fireEvent.click(
      within(fileRows()[2]).getByRole('button', { name: 'Remove file' }),
    )
    await waitFor(() => expect(previewCalls).toHaveLength(4))
    expect(previewCalls[3].fileIds).toEqual(['id-a', 'id-b'])
    expect(fileRows()).toHaveLength(2)
  })

  it('the component never holds an absolute path: it works end to end from bare {id, fileName, dirName} handles alone', async () => {
    // Every mocked file above is already typed as `PickedConfigFile` - the shared type with no
    // path field at all - so `Object.keys` pins that the mock (and therefore the component,
    // which renders straight from it) never reaches for anything beyond these three fields.
    expect(Object.keys(FILE_A).sort()).toEqual(['dirName', 'fileName', 'id'])

    const { onCreated } = renderDialog()
    await choose()

    // Nothing rendered anywhere in the dialog looks like a filesystem path: no drive letter, no
    // path separator. Only bare `fileName`/`dirName` values (and UI chrome) ever reach the DOM.
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).not.toMatch(/[a-zA-Z]:[\\/]/)
    expect(dialog.textContent).not.toMatch(/[\\/]/)

    const submit = screen.getByRole('button', { name: 'Create profile' }) as HTMLButtonElement
    await waitFor(() => expect(submit.disabled).toBe(false))
    fireEvent.click(submit)

    await waitFor(() => expect(commitCalls).toHaveLength(1))
    // The commit payload itself is exactly `{ fileIds, name, layerAliases }` - ids, never paths.
    expect(Object.keys(commitCalls[0]).sort()).toEqual(['fileIds', 'layerAliases', 'name'])
    expect(commitCalls[0].fileIds).toEqual(['id-a', 'id-b', 'id-c'])
    expect(onCreated).toHaveBeenCalledTimes(1)
  })
})
