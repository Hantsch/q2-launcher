// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../../../i18n'

let ModMissingConfirmDialog: typeof import('./ModMissingConfirmDialog').ModMissingConfirmDialog

beforeAll(async () => {
  await initI18n('en')
  ;({ ModMissingConfirmDialog } = await import('./ModMissingConfirmDialog'))
})
afterEach(cleanup)

describe('ModMissingConfirmDialog (story 180 D3)', () => {
  it('names the mod and offers Cancel and Play anyway', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(createElement(ModMissingConfirmDialog, { gameDir: 'opentdm', onCancel, onConfirm }))
    expect(screen.getByTestId('replays-mod-missing-dialog').textContent).toContain('opentdm')
    fireEvent.click(screen.getByTestId('replays-mod-missing-cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('replays-mod-missing-confirm'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})
