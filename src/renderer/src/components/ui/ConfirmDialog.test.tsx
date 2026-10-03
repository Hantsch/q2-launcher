// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../../i18n'
import { ConfirmDialog } from './ConfirmDialog'

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
})

function renderDialog(busy = false) {
  const onConfirm = vi.fn()
  const onClose = vi.fn()
  render(
    <ConfirmDialog
      title="Remove it"
      body="Really?"
      confirmLabel="Remove"
      tone="danger"
      busy={busy}
      onConfirm={onConfirm}
      onClose={onClose}
      testIds={{ confirm: 'confirm', cancel: 'cancel' }}
    />,
  )
  return { onConfirm, onClose }
}

describe('ConfirmDialog', () => {
  it('confirm and cancel call their own callbacks', () => {
    const { onConfirm, onClose } = renderDialog()
    expect(screen.getByText('Really?')).toBeTruthy()

    fireEvent.click(screen.getByTestId('confirm'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('cancel'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape closes when not busy', () => {
    const { onClose } = renderDialog()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('busy disables confirm and blocks close', () => {
    const { onConfirm, onClose } = renderDialog(true)

    const confirm = screen.getByTestId('confirm') as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.click(confirm)
    expect(onConfirm).not.toHaveBeenCalled()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Close')).toBeNull()

    const cancel = screen.getByTestId('cancel') as HTMLButtonElement
    expect(cancel.disabled).toBe(true)
    fireEvent.click(cancel)
    expect(onClose).not.toHaveBeenCalled()
  })
})
