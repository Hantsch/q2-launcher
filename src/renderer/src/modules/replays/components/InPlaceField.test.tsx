// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../../../i18n'
import type { CommitResult, InPlaceFieldProps } from './InPlaceField'

let InPlaceField: typeof import('./InPlaceField').InPlaceField

beforeAll(async () => {
  await initI18n('en')
  ;({ InPlaceField } = await import('./InPlaceField'))
})

afterEach(() => cleanup())

function field(overrides: Partial<InPlaceFieldProps> = {}, result: CommitResult = 'saved') {
  const onCommit = vi.fn<(text: string) => Promise<CommitResult>>(() => Promise.resolve(result))
  const props: InPlaceFieldProps = {
    value: 'Dust',
    placeholder: 'Map',
    label: 'Map',
    validate: () => null,
    onCommit,
    testId: 'f',
    ...overrides,
  }
  const view = render(createElement(InPlaceField, props))
  return { onCommit, view, props, input: screen.getByTestId('f') as HTMLInputElement }
}

describe('InPlaceField', () => {
  it('Enter commits and Escape reverts', async () => {
    const { input, onCommit } = field()
    fireEvent.change(input, { target: { value: 'Rust' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe('Dust')
    expect(onCommit).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: 'Rust' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith('Rust'))
  })

  it('blur commits a changed value, once even while the save is pending', async () => {
    let finish: (result: CommitResult) => void = () => {}
    const pending = new Promise<CommitResult>((resolve) => {
      finish = resolve
    })
    const onCommit = vi.fn<(text: string) => Promise<CommitResult>>(() => pending)
    const { input } = field({ onCommit })
    fireEvent.change(input, { target: { value: 'Rust' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(input)
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith('Rust')
    finish('saved')
    await waitFor(() => expect(input.value).toBe('Dust'))
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('reverting by hand clears the reason and follows the on-disk value', () => {
    const validate = (text: string) =>
      text === 'bad' ? { key: 'replays.editor.error.date' } : null
    const { input, view, props } = field({ validate })
    fireEvent.change(input, { target: { value: 'bad' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByTestId('f-error')).toBeTruthy()
    fireEvent.change(input, { target: { value: 'Dust' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.queryByTestId('f-error')).toBeNull()
    view.rerender(createElement(InPlaceField, { ...props, value: 'Sand' }))
    expect(input.value).toBe('Sand')
  })

  it('text typed while a commit is in flight is kept', async () => {
    let finish: (result: CommitResult) => void = () => {}
    const onCommit = vi.fn<(text: string) => Promise<CommitResult>>(
      () =>
        new Promise<CommitResult>((resolve) => {
          finish = resolve
        }),
    )
    const { input } = field({ onCommit })
    fireEvent.change(input, { target: { value: 'Rust' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.change(input, { target: { value: 'Rusty' } })
    finish('saved')
    await Promise.resolve()
    await Promise.resolve()
    expect(input.value).toBe('Rusty')
  })

  it('an invalid value shows its reason and is not committed', () => {
    const { input, onCommit } = field({
      validate: () => ({ key: 'replays.editor.error.tooLong', params: { max: 3 } }),
    })
    fireEvent.change(input, { target: { value: 'Rust' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).not.toHaveBeenCalled()
    expect(screen.getByTestId('f-error').textContent).toContain('3')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toBe(screen.getByTestId('f-error').id)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByTestId('f-error')).toBeNull()
  })

  it('a failed commit keeps the typed text', async () => {
    const { input, onCommit } = field({}, 'failed')
    fireEvent.change(input, { target: { value: 'Rust' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onCommit).toHaveBeenCalled())
    expect(input.value).toBe('Rust')
  })

  it('a dirty field commits on unmount', () => {
    const { input, onCommit, view } = field()
    fireEvent.change(input, { target: { value: 'Rust' } })
    view.unmount()
    expect(onCommit).toHaveBeenCalledWith('Rust')
  })

  it('looks like text at rest and an input on focus', () => {
    const { input } = field({ display: 'May 1' })
    expect(input.value).toBe('May 1')
    expect(input.className).toContain('border-transparent')
    expect(input.className).toContain('bg-transparent')
    expect(input.className).toContain('hover:border-line-strong')
    expect(input.className).toContain('focus:border-flame-600')
    fireEvent.focus(input)
    expect(input.value).toBe('Dust')
  })

  it('a read-only field renders plain text', () => {
    field({ readOnly: true, value: '' })
    const el = screen.getByTestId('f')
    expect(el.tagName).toBe('SPAN')
    expect(el.textContent).toBe('Map')
  })
})
