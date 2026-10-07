// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../../i18n'
import { NameDialog } from './NameDialog'

beforeAll(async () => {
  await initI18n('en')
})

afterEach(() => {
  cleanup()
})

function renderDialog(
  props: {
    initialName?: string
    validate?: (s: string) => string | null
    onSubmit?: () => unknown
  } = {},
) {
  const onSubmit = props.onSubmit ?? vi.fn()
  render(
    <NameDialog
      titleKey="common.action.save"
      labelKey="common.action.cancel"
      initialName={props.initialName ?? ''}
      maxLength={20}
      validate={props.validate}
      onSubmit={onSubmit}
      onClose={() => undefined}
      testIds={{ input: 'name', submit: 'submit' }}
    />,
  )
  return {
    onSubmit,
    input: screen.getByTestId('name') as HTMLInputElement,
    submit: screen.getByTestId('submit') as HTMLButtonElement,
  }
}

describe('NameDialog', () => {
  it('one canSubmit gates the button and the Enter key', () => {
    const validate = (s: string): string | null => (s === 'bad' ? 'common.action.close' : null)
    const { onSubmit, input, submit } = renderDialog({ validate })

    // Empty: both refuse.
    expect(submit.disabled).toBe(true)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()

    // Invalid: both refuse.
    fireEvent.change(input, { target: { value: ' bad ' } })
    expect(submit.disabled).toBe(true)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()

    // Valid: both accept, with the trimmed name.
    fireEvent.change(input, { target: { value: ' good ' } })
    expect(submit.disabled).toBe(false)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith('good')
  })

  it('two Enters in one tick submit once', () => {
    const onSubmit = vi.fn(() => new Promise(() => undefined))
    const { input } = renderDialog({ initialName: 'name', onSubmit })

    // One act(): no state flush between the two keydowns, so only the ref guard can stop the second.
    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' })
      fireEvent.keyDown(input, { key: 'Enter' })
    })

    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('submittable gates the button, suffix renders, error gets its own alert', () => {
    render(
      <NameDialog
        titleKey="common.action.save"
        labelKey="common.action.cancel"
        initialName="a"
        maxLength={20}
        submittable={(s) => s !== 'a'}
        suffix=".dm2"
        error="refused"
        onSubmit={vi.fn()}
        onClose={() => undefined}
        testIds={{ input: 'name', submit: 'submit', error: 'err' }}
      />,
    )
    expect((screen.getByTestId('submit') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('.dm2')).toBeTruthy()
    expect(screen.getByTestId('err').textContent).toBe('refused')
    fireEvent.change(screen.getByTestId('name'), { target: { value: 'b' } })
    expect((screen.getByTestId('submit') as HTMLButtonElement).disabled).toBe(false)
  })

  it('function children get the gated submit, so an extra field submits on Enter only when allowed', () => {
    const onSubmit = vi.fn()
    render(
      <NameDialog
        titleKey="common.action.save"
        labelKey="common.action.cancel"
        initialName=""
        maxLength={20}
        onSubmit={onSubmit}
        onClose={() => undefined}
        testIds={{ input: 'name' }}
      >
        {(submit) => (
          <input
            data-testid="extra"
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit()
            }}
          />
        )}
      </NameDialog>,
    )
    fireEvent.keyDown(screen.getByTestId('extra'), { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.change(screen.getByTestId('name'), { target: { value: ' ok ' } })
    fireEvent.keyDown(screen.getByTestId('extra'), { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith('ok')
  })

  it('focus lands in the name field', () => {
    const { input } = renderDialog({ initialName: 'name' })
    expect(document.activeElement).toBe(input)
  })
})
