// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

function Boom({ fail }: { fail: boolean }) {
  if (fail) throw new Error('kaput')
  return <p>fine</p>
}

describe('ErrorBoundary', () => {
  let spy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    spy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    cleanup()
    spy.mockRestore()
  })

  it('fallback, onError, resetKeys and scope', () => {
    const onError = vi.fn()
    const { unmount } = render(
      <ErrorBoundary fallback={<p>custom</p>} onError={onError} scope="demo">
        <Boom fail />
      </ErrorBoundary>,
    )
    expect(screen.getByText('custom')).toBeTruthy()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls.some((c: unknown[]) => String(c[0]).startsWith('[demo]'))).toBe(true)
    unmount()

    let fail = true
    function Case() {
      return <Boom fail={fail} />
    }
    render(
      <ErrorBoundary fallback={(e, reset) => <button onClick={reset}>retry {e.message}</button>}>
        <Case />
      </ErrorBoundary>,
    )
    fail = false
    fireEvent.click(screen.getByText('retry kaput'))
    expect(screen.getByText('fine')).toBeTruthy()
  })

  it('clears the error when a reset key changes', () => {
    function Host() {
      const [key, setKey] = useState(0)
      return (
        <>
          <button onClick={() => setKey(1)}>bump</button>
          <ErrorBoundary resetKeys={[key]} fallback={<p>custom</p>}>
            <Boom fail={key === 0} />
          </ErrorBoundary>
        </>
      )
    }
    render(<Host />)
    expect(screen.getByText('custom')).toBeTruthy()
    fireEvent.click(screen.getByText('bump'))
    expect(screen.getByText('fine')).toBeTruthy()
  })
})
