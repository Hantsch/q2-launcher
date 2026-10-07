// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { initI18n } from '../../i18n'
import { MultiSelect } from './MultiSelect'

beforeAll(async () => {
  await initI18n('en')
})
afterEach(() => {
  cleanup()
})

function Harness({ options, initial }: { options: string[]; initial: string[] }) {
  const [value, setValue] = useState(initial)
  return (
    <MultiSelect
      label="Mods"
      options={options}
      value={value}
      onChange={setValue}
      summaryCount={(n) => `${n} mods`}
      data-testid="ms"
    />
  )
}

const trigger = () => screen.getByTestId('ms')

describe('MultiSelect', () => {
  it('the closed label lists names up to 24 characters, then the count', () => {
    const a = 'a'.repeat(11)
    const b = 'b'.repeat(11)
    const { unmount } = render(<Harness options={[a, b]} initial={[a, b]} />)
    expect(trigger().textContent).toBe(`${a}, ${b}`)
    unmount()
    const longer = b + 'b'
    render(<Harness options={[a, longer]} initial={[a, longer]} />)
    expect(trigger().textContent).toBe('2 mods')
  })

  it('shows Any when empty and the single name when one is selected', () => {
    const { unmount } = render(<Harness options={['x', 'y']} initial={[]} />)
    expect(trigger().textContent).toBe('Any')
    unmount()
    render(<Harness options={['x', 'y']} initial={['y']} />)
    expect(trigger().textContent).toBe('y')
  })

  it('a selected value missing from the options is appended and stays checked', () => {
    render(<Harness options={['x', 'y']} initial={['gone']} />)
    fireEvent.click(trigger())
    const rows = screen.getAllByRole('option')
    expect(rows.map((r) => r.textContent)).toEqual(['x', 'y', 'gone'])
    expect(rows[2].getAttribute('aria-selected')).toBe('true')
  })

  it('checks and unchecks case-insensitively', () => {
    render(<Harness options={['Action', 'Ctf']} initial={['action', 'ACTION']} />)
    fireEvent.click(trigger())
    const rows = screen.getAllByRole('option')
    expect(rows).toHaveLength(2)
    expect(rows[0].getAttribute('aria-selected')).toBe('true')
    fireEvent.click(rows[0])
    expect(screen.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('false')
    expect(trigger().textContent).toBe('Any')
    fireEvent.click(screen.getAllByRole('option')[1])
    expect(trigger().textContent).toBe('Ctf')
  })

  it('keyboard opens, moves, toggles with Space and closes with Escape', async () => {
    render(<Harness options={['x', 'y', 'z']} initial={[]} />)
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' })
    const list = screen.getByRole('listbox', { name: 'Mods' })
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    await Promise.resolve()
    expect(document.activeElement).toBe(list)
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    fireEvent.keyDown(list, { key: ' ' })
    expect(trigger().textContent).toBe('y')
    expect(screen.getByRole('listbox')).toBeTruthy()
    fireEvent.keyDown(list, { key: 'End' })
    fireEvent.keyDown(list, { key: 'Enter' })
    expect(trigger().textContent).toBe('y, z')
    fireEvent.keyDown(list, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  it('the live region announces the selected count', () => {
    render(<Harness options={['x', 'y']} initial={['x', 'y']} />)
    expect(screen.getByRole('status').textContent).toBe('2 selected')
  })

  it('the trigger name carries the field label and the current selection', () => {
    render(<Harness options={['x', 'y']} initial={['y']} />)
    expect(trigger().getAttribute('aria-label')).toBe('Mods: y')
  })

  it('Enter and ArrowDown on the trigger open the panel', () => {
    render(<Harness options={['x', 'y']} initial={[]} />)
    fireEvent.keyDown(trigger(), { key: 'Enter' })
    expect(screen.getByRole('listbox')).toBeTruthy()
    cleanup()
    render(<Harness options={['x', 'y']} initial={[]} />)
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' })
    expect(screen.getByRole('listbox')).toBeTruthy()
  })

  it('aria-activedescendant follows Home, ArrowDown and ArrowUp', () => {
    render(<Harness options={['x', 'y', 'z']} initial={[]} />)
    fireEvent.click(trigger())
    const list = screen.getByRole('listbox')
    const activeText = () =>
      document.getElementById(list.getAttribute('aria-activedescendant')!)?.textContent
    expect(activeText()).toBe('x')
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(activeText()).toBe('z')
    fireEvent.keyDown(list, { key: 'ArrowUp' })
    expect(activeText()).toBe('y')
    fireEvent.keyDown(list, { key: 'Home' })
    expect(activeText()).toBe('x')
  })

  it('omits aria-activedescendant when there are no options', () => {
    render(<Harness options={[]} initial={[]} />)
    fireEvent.click(trigger())
    expect(screen.getByRole('listbox').hasAttribute('aria-activedescendant')).toBe(false)
  })

  it('Tab and focus leaving the component close the panel', () => {
    render(
      <>
        <Harness options={['x']} initial={[]} />
        <button data-testid="outside">out</button>
      </>,
    )
    fireEvent.click(trigger())
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Tab' })
    expect(screen.queryByRole('listbox')).toBeNull()
    fireEvent.click(trigger())
    fireEvent.blur(screen.getByRole('listbox'), { relatedTarget: screen.getByTestId('outside') })
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('options differing only by case render as separate rows', () => {
    render(<Harness options={['Ctf', 'ctf']} initial={[]} />)
    fireEvent.click(trigger())
    expect(screen.getAllByRole('option')).toHaveLength(2)
  })
})
