// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { NavJobBadge } from './NavJobBadge'

afterEach(() => {
  cleanup()
})

describe('NavJobBadge', () => {
  it('renders nothing when count is 0', () => {
    const { container } = render(<NavJobBadge count={0} testId="nav-job-badge" />)

    expect(container.innerHTML).toBe('')
    expect(screen.queryByTestId('nav-job-badge')).toBeNull()
  })

  it('renders the exact count at 3', () => {
    render(<NavJobBadge count={3} testId="nav-job-badge" />)

    expect(screen.getByTestId('nav-job-badge').textContent).toBe('3')
  })

  it('caps the display at "99+" above 99', () => {
    render(<NavJobBadge count={120} testId="nav-job-badge" />)

    expect(screen.getByTestId('nav-job-badge').textContent).toBe('99+')
  })

  it('renders the shared Badge primitive, not bespoke pill markup', () => {
    render(<NavJobBadge count={3} testId="nav-job-badge" />)

    const badge = screen.getByTestId('nav-job-badge')
    // Badge's own class list (primitives.tsx) - proves this is the shared
    // component, not a one-off pill with its own colour/markup.
    expect(badge.className).toContain('rounded-sm')
    expect(badge.className).toContain('border-flame-700')
    expect(badge.className).toContain('bg-flame-900/50')
    expect(badge.className).toContain('text-flame-300')
  })
})
