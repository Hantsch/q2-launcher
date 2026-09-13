import { delimiter } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DialogService } from './dialog'

/**
 * Story 066 D4: `DialogService` is the one place `dialog.showOpenDialog` is called for the config
 * import flow, and it carries a test-harness backdoor (`Q2L_UI_HARNESS=1`) that must be provably
 * unreachable unless `isDev` is *also* true - a hard requirement, since this runs in the same main
 * process a packaged build ships. `electron` is mocked as in `../services/installation-icons.test.ts`:
 * under plain vitest, `import('electron')` resolves to a path string, so `dialog` has to be supplied
 * here. No real OS dialog is ever spawned.
 */

const dialogMock = vi.hoisted(() => ({ showOpenDialog: vi.fn() }))

vi.mock('electron', () => ({
  dialog: dialogMock,
}))

const FAKE_WINDOW = { id: 'fake-window' } as unknown as Electron.BrowserWindow

beforeEach(() => {
  dialogMock.showOpenDialog.mockReset()
  dialogMock.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [] })
})

afterEach(() => {
  delete process.env['Q2L_UI_HARNESS']
  delete process.env['Q2L_UI_PICK_FILES']
})

function service(isDev: boolean): DialogService {
  return new DialogService({ getMainWindow: () => FAKE_WINDOW, isDev })
}

describe('pickConfigFiles: the real dialog branch', () => {
  it('is multi-select and filtered to .cfg', async () => {
    dialogMock.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['C:\\configs\\dm.cfg'],
    })

    await service(false).pickConfigFiles({})

    expect(dialogMock.showOpenDialog).toHaveBeenCalledTimes(1)
    const [window, options] = dialogMock.showOpenDialog.mock.calls[0]
    expect(window).toBe(FAKE_WINDOW)
    expect(options.properties).toEqual(expect.arrayContaining(['openFile', 'multiSelections']))
    expect(options.filters).toEqual(
      expect.arrayContaining([expect.objectContaining({ extensions: expect.arrayContaining(['cfg']) })]),
    )
  })

  it('passes defaultPath through when given', async () => {
    await service(false).pickConfigFiles({ defaultPath: 'C:\\Games\\Quake2\\baseq2' })

    const [, options] = dialogMock.showOpenDialog.mock.calls[0]
    expect(options.defaultPath).toBe('C:\\Games\\Quake2\\baseq2')
  })

  it('cancel (canceled: true) yields an empty array', async () => {
    dialogMock.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })

    await expect(service(false).pickConfigFiles({})).resolves.toEqual([])
  })

  it('an empty filePaths list yields an empty array even when canceled is false', async () => {
    dialogMock.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [] })

    await expect(service(false).pickConfigFiles({})).resolves.toEqual([])
  })
})

describe('the harness stub is unreachable with either gate off', () => {
  it('both flags off: the real dialog runs, Q2L_UI_PICK_FILES is ignored', async () => {
    delete process.env['Q2L_UI_HARNESS']
    process.env['Q2L_UI_PICK_FILES'] = `C:\\fixtures\\dm.cfg${delimiter}C:\\fixtures\\gfx.cfg`
    dialogMock.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })

    const result = await service(false).pickConfigFiles({})

    expect(dialogMock.showOpenDialog).toHaveBeenCalledTimes(1)
    expect(result).toEqual([])
  })

  it('only Q2L_UI_HARNESS=1 (isDev false): the real dialog still runs', async () => {
    process.env['Q2L_UI_HARNESS'] = '1'
    process.env['Q2L_UI_PICK_FILES'] = `C:\\fixtures\\dm.cfg${delimiter}C:\\fixtures\\gfx.cfg`
    dialogMock.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })

    const result = await service(false).pickConfigFiles({})

    expect(dialogMock.showOpenDialog).toHaveBeenCalledTimes(1)
    expect(result).toEqual([])
  })

  it('only isDev=true (Q2L_UI_HARNESS unset): the real dialog still runs', async () => {
    delete process.env['Q2L_UI_HARNESS']
    process.env['Q2L_UI_PICK_FILES'] = `C:\\fixtures\\dm.cfg${delimiter}C:\\fixtures\\gfx.cfg`
    dialogMock.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })

    const result = await service(true).pickConfigFiles({})

    expect(dialogMock.showOpenDialog).toHaveBeenCalledTimes(1)
    expect(result).toEqual([])
  })

  it('only isDev=true and Q2L_UI_HARNESS set to something other than "1": the real dialog still runs', async () => {
    process.env['Q2L_UI_HARNESS'] = 'true'
    process.env['Q2L_UI_PICK_FILES'] = `C:\\fixtures\\dm.cfg${delimiter}C:\\fixtures\\gfx.cfg`
    dialogMock.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })

    const result = await service(true).pickConfigFiles({})

    expect(dialogMock.showOpenDialog).toHaveBeenCalledTimes(1)
    expect(result).toEqual([])
  })

  it('both flags on: no dialog opens, paths come from Q2L_UI_PICK_FILES instead', async () => {
    process.env['Q2L_UI_HARNESS'] = '1'
    process.env['Q2L_UI_PICK_FILES'] = `C:\\fixtures\\dm.cfg${delimiter}C:\\fixtures\\gfx.cfg`

    const result = await service(true).pickConfigFiles({})

    expect(dialogMock.showOpenDialog).not.toHaveBeenCalled()
    // `canonicalizePath` falls back to a plain resolve for a path that does not exist on disk,
    // which is exactly the fixture's situation here - no real files were created for this test.
    expect(result).toHaveLength(2)
    expect(result[0]).toContain('dm.cfg')
    expect(result[1]).toContain('gfx.cfg')
  })

  it('both flags on but Q2L_UI_PICK_FILES unset: the stub yields an empty array, still without opening a dialog', async () => {
    process.env['Q2L_UI_HARNESS'] = '1'
    delete process.env['Q2L_UI_PICK_FILES']

    const result = await service(true).pickConfigFiles({})

    expect(dialogMock.showOpenDialog).not.toHaveBeenCalled()
    expect(result).toEqual([])
  })
})
