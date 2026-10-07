// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useControlsDrag } from './useControlsDrag'

describe('useControlsDrag', () => {
  it('spring-loads a category after the hover delay and cancels on drag end', () => {
    const { result, rerender } = renderHook(() =>
      useControlsDrag({ isRowId: (id) => id.startsWith('row') }),
    )
    const { onDragStarted, onDragFinished, onSpringLoad } = result.current

    act(() => onDragStarted('row-1'))
    expect(result.current.draggingRowId).toBe('row-1')
    act(() => onSpringLoad('cat-b'))
    expect(result.current.springCategoryId).toBe('cat-b')

    rerender()
    expect(result.current.onSpringLoad).toBe(onSpringLoad)
    expect(result.current.onDragStarted).toBe(onDragStarted)
    expect(result.current.onDragFinished).toBe(onDragFinished)

    act(() => onDragFinished())
    expect(result.current.springCategoryId).toBeNull()
    expect(result.current.draggingRowId).toBeNull()

    act(() => onSpringLoad('cat-c'))
    expect(result.current.springCategoryId).toBeNull()
  })

  it('ignores spring-load while a non-row is dragged', () => {
    const { result } = renderHook(() => useControlsDrag({ isRowId: (id) => id.startsWith('row') }))
    act(() => result.current.onDragStarted('category-drag:x'))
    act(() => result.current.onSpringLoad('cat-b'))
    expect(result.current.draggingRowId).toBeNull()
    expect(result.current.springCategoryId).toBeNull()
  })
})
