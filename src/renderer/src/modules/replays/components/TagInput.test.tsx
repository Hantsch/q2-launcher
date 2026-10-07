// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { initI18n } from '../../../i18n'

let TagInput: typeof import('./TagInput').TagInput

beforeAll(async () => {
  await initI18n('en')
  ;({ TagInput } = await import('./TagInput'))
})

afterEach(() => cleanup())

describe('TagInput', () => {
  it('the tag input suggests tags from other demos and adds one from the keyboard', () => {
    const onAddTag = vi.fn()
    const onRemoveTag = vi.fn()
    const onInputChange = vi.fn()

    const { rerender } = render(
      createElement(TagInput, {
        tags: [],
        suggestions: [],
        onAddTag,
        onRemoveTag,
        onInputChange,
      }),
    )

    const input = screen.getByTestId('replays-tag-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'gru' } })
    expect(onInputChange).toHaveBeenCalledWith('gru')

    rerender(
      createElement(TagInput, {
        tags: [],
        suggestions: ['grudge match', 'group stage'],
        onAddTag,
        onRemoveTag,
        onInputChange,
      }),
    )

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    const options = screen.getAllByTestId('replays-tag-option')
    expect(options[0]?.getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onAddTag).toHaveBeenCalledWith('grudge match')
  })

  it('a too-long tag is refused with its reason', () => {
    const onAddTag = vi.fn()
    render(
      createElement(TagInput, {
        tags: [],
        suggestions: [],
        onAddTag,
        onRemoveTag: vi.fn(),
        onInputChange: vi.fn(),
        validate: (tag: string) =>
          tag.length > 3 ? { key: 'replays.editor.error.tooLong', params: { max: 3 } } : null,
      }),
    )
    const input = screen.getByTestId('replays-tag-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'toolong' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onAddTag).not.toHaveBeenCalled()
    expect(input.value).toBe('toolong')
    expect(screen.getByTestId('replays-tag-error').textContent).toContain('3')
  })
})
